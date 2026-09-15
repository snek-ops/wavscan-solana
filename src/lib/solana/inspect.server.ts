import {
  findAudioHits,
  parseDataJson,
  uriKind,
} from "./detect-audio";
import {
  findImageHits,
  hitsFromImageRaw,
} from "./detect-image";
import { findAnyScribeForMint } from "./anyscribe.server";
import { gradeScan } from "./grade";
import {
  EMPTY_SCAN,
  type AudioHit,
  type ExtraField,
  type MediaHit,
  type TokenScan,
} from "./types";
import {
  configFromRpcMessage,
  detectTxVersion,
  parseV1Transaction,
  type TransactionConfig,
  type TxVersion,
} from "./v1-tx";
import {
  TOKEN_2022,
  TOKEN_KLEGG,
  audioHitsFromPairs,
  audioHitsFromRawUtf8,
  extraFromPairs,
  fetchJson,
  imageHitsFromPairs,
  metaplexPda,
  parseMetaplex,
  pickImage,
  pickName,
  pickSymbol,
  sniffRemote,
} from "./inspect-helpers";

/** Every tx read must opt into v1. Legacy-only nodes drop 0x81 envelopes. */
export const V1_TX_READ = {
  encoding: "base64" as const,
  maxSupportedTransactionVersion: 1 as const,
};

export const V1_TX_JSON_READ = {
  encoding: "json" as const,
  maxSupportedTransactionVersion: 1 as const,
};

const RPCS = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
];

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type RpcAccount = {
  owner: string;
  space: number;
  data: unknown;
};

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  let lastError: Error | null = null;
  for (const url of RPCS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) {
        lastError = new Error(`RPC ${res.status}`);
        continue;
      }
      const body = (await res.json()) as {
        result?: T;
        error?: { message?: string };
      };
      if (body.error) {
        lastError = new Error(body.error.message ?? "RPC error");
        continue;
      }
      return body.result as T;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError ?? new Error("All Solana RPC endpoints failed");
}

export type ReadTx = {
  signature: string;
  version: TxVersion | null;
  config: TransactionConfig | null;
  wireBytes: number | null;
  signatures: string[];
};

/**
 * Fetch a confirmed tx as a v1-capable read.
 * Wire encoding is used to see prefix 0x81 and the signature tail.
 * JSON encoding is used only for `transactionConfig` (not ComputeBudget ixs).
 */
export async function readTransaction(signature: string): Promise<ReadTx | null> {
  const [wire, json] = await Promise.all([
    rpc<{ transaction?: [string, string] } | null>("getTransaction", [
      signature,
      V1_TX_READ,
    ]).catch(() => null),
    rpc<{ transaction?: { message?: unknown } } | null>("getTransaction", [
      signature,
      V1_TX_JSON_READ,
    ]).catch(() => null),
  ]);

  if (!wire && !json) return null;

  const jsonTx =
    json && typeof json === "object" && "transaction" in json
      ? (json as { transaction?: { message?: unknown } }).transaction
      : null;
  let config: TransactionConfig | null =
    configFromRpcMessage(jsonTx) ??
    configFromRpcMessage(jsonTx && typeof jsonTx === "object" ? jsonTx.message : null) ??
    configFromRpcMessage(json);

  let version: TxVersion | null = null;
  let wireBytes: number | null = null;
  const signatures: string[] = [];

  const encoded = wire && typeof wire === "object" ? wire.transaction : null;
  if (Array.isArray(encoded) && typeof encoded[0] === "string") {
    const bytes = Uint8Array.from(Buffer.from(encoded[0], "base64"));
    wireBytes = bytes.length;
    version = detectTxVersion(bytes);
    if (version === 1) {
      const parsed = parseV1Transaction(bytes);
      config = parsed.config;
      for (const sig of parsed.signatures) {
        signatures.push(Buffer.from(sig).toString("base64"));
      }
    }
  }

  return { signature, version, config, wireBytes, signatures };
}

export async function inspectMint(rawMint: string): Promise<TokenScan> {
  const mint = rawMint.trim();
  if (!BASE58_RE.test(mint)) {
    return {
      ...EMPTY_SCAN,
      mint,
      error: "That does not look like a Solana mint address.",
    };
  }

  let parsed: {
    value: RpcAccount | null;
  };
  try {
    parsed = await rpc<{ value: RpcAccount | null }>("getAccountInfo", [
      mint,
      { encoding: "jsonParsed" },
    ]);
  } catch {
    return {
      ...EMPTY_SCAN,
      mint,
      error: "Could not reach Solana RPC. Try again in a moment.",
    };
  }

  if (!parsed?.value) {
    return {
      ...EMPTY_SCAN,
      mint,
      exists: false,
      error: "No account at this address on mainnet.",
    };
  }

  const account = parsed.value;
  const program =
    account.owner === TOKEN_2022
      ? "token-2022"
      : account.owner === TOKEN_KLEGG
        ? "spl-token"
        : "unknown";

  let name: string | null = null;
  let symbol: string | null = null;
  let uri: string | null = null;
  let additionalMetadata: ExtraField[] = [];
  const extraAudio: AudioHit[] = [];
  const extraImage: MediaHit[] = [];

  const parsedData = account.data as
    | {
        parsed?: {
          info?: {
            extensions?: Array<{
              extension?: string;
              state?: Record<string, unknown>;
            }>;
          };
        };
      }
    | string[]
    | undefined;

  if (parsedData && typeof parsedData === "object" && "parsed" in parsedData) {
    const extensions = parsedData.parsed?.info?.extensions ?? [];
    for (const ext of extensions) {
      if (ext.extension === "tokenMetadata" && ext.state) {
        name = typeof ext.state.name === "string" ? ext.state.name : name;
        symbol = typeof ext.state.symbol === "string" ? ext.state.symbol : symbol;
        uri = typeof ext.state.uri === "string" ? ext.state.uri : uri;
        additionalMetadata = extraFromPairs(ext.state.additionalMetadata);
        extraAudio.push(...audioHitsFromPairs(ext.state.additionalMetadata));
        extraImage.push(...imageHitsFromPairs(ext.state.additionalMetadata));
      }
    }
    if (!uri) {
      for (const ext of extensions) {
        if (ext.extension === "metadataPointer" && ext.state) {
          const pointed = ext.state.metadataAddress;
          if (typeof pointed === "string" && pointed && pointed !== mint) {
            try {
              const other = await rpc<{ value: RpcAccount | null }>(
                "getAccountInfo",
                [pointed, { encoding: "jsonParsed" }],
              );
              const od = other.value?.data as
                | {
                    parsed?: {
                      info?: {
                        extensions?: Array<{
                          extension?: string;
                          state?: Record<string, unknown>;
                        }>;
                      };
                    };
                  }
                | undefined;
              const exts = od?.parsed?.info?.extensions ?? [];
              for (const e of exts) {
                if (e.extension === "tokenMetadata" && e.state) {
                  name = typeof e.state.name === "string" ? e.state.name : name;
                  symbol =
                    typeof e.state.symbol === "string" ? e.state.symbol : symbol;
                  uri = typeof e.state.uri === "string" ? e.state.uri : uri;
                  additionalMetadata = extraFromPairs(e.state.additionalMetadata);
                  extraAudio.push(...audioHitsFromPairs(e.state.additionalMetadata));
                  extraImage.push(...imageHitsFromPairs(e.state.additionalMetadata));
                }
              }
            } catch {
              /* ignore pointer fetch */
            }
          }
        }
      }
    }
  }

  if (!uri && (program === "spl-token" || program === "token-2022")) {
    try {
      const pda = metaplexPda(mint);
      const metaAcc = await rpc<{
        value: { data: [string, string] } | null;
      }>("getAccountInfo", [pda, { encoding: "base64" }]);
      if (metaAcc?.value?.data?.[0]) {
        const parsedMeta = parseMetaplex(metaAcc.value.data[0]);
        if (parsedMeta) {
          name = name ?? parsedMeta.name;
          symbol = symbol ?? parsedMeta.symbol;
          uri = uri ?? parsedMeta.uri;
        }
      }
    } catch {
      /* no metaplex account */
    }
  }

  let metaJson: unknown = null;
  if (uri) {
    if (uri.startsWith("data:")) {
      metaJson = parseDataJson(uri);
      extraAudio.push(...audioHitsFromRawUtf8(uri));
      extraImage.push(...hitsFromImageRaw(uri));
    } else if (/^(https?:|ipfs:|ar:)/i.test(uri)) {
      metaJson = await fetchJson(uri);
    }
  }

  if (typeof account.data === "object" && Array.isArray(account.data)) {
    try {
      const raw = Buffer.from(account.data[0] as string, "base64").toString(
        "utf8",
      );
      extraAudio.push(...audioHitsFromRawUtf8(raw));
      extraImage.push(...hitsFromImageRaw(raw));
    } catch {
      /* ignore */
    }
  }

  const audioHits = findAudioHits(metaJson, extraAudio).sort((a, b) => {
    const rank = (hit: AudioHit) =>
      hit.field === "account-data" ? 1 : hit.field.includes("sound") ? -1 : 0;
    return rank(a) - rank(b);
  });
  const audio = audioHits[0] ?? null;

  let mediaHits = findImageHits(metaJson, extraImage);
  if (mediaHits[0] && !mediaHits[0].src.startsWith("data:")) {
    mediaHits = [await sniffRemote(mediaHits[0]), ...mediaHits.slice(1)];
  }
  const media = mediaHits[0] ?? null;
  const image = media?.src ?? pickImage(metaJson);

  let anyscribe = null;
  try {
    anyscribe = await findAnyScribeForMint({
      mint,
      uri,
      extras: additionalMetadata,
    });
  } catch {
    anyscribe = null;
  }

  const draft: TokenScan = {
    mint,
    exists: true,
    program,
    name: pickName(metaJson, name),
    symbol: pickSymbol(metaJson, symbol),
    image,
    uri,
    uriKind: uriKind(uri),
    accountSpace: account.space ?? null,
    additionalMetadata,
    audio,
    media,
    extraAudioCount: Math.max(0, audioHits.length - (audio ? 1 : 0)),
    error: null,
    totalScans: null,
    grade: null,
    gradeLabel: null,
    gradeReasons: [],
    claimMismatch: false,
    packedMint: null,
  };

  const graded = gradeScan(draft, { anyscribe });
  return {
    ...draft,
    grade: graded.grade,
    gradeLabel: graded.label,
    gradeReasons: graded.reasons,
    claimMismatch: graded.claimMismatch,
    packedMint: graded.packedMint,
  };
}
