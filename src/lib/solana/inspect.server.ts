import { PublicKey } from "@solana/web3.js";
import {
  findAudioHits,
  looksLikeAudio,
  parseDataJson,
  uriKind,
  dataUriMime,
} from "./detect-audio";
import { EMPTY_SCAN, type AudioHit, type ExtraField, type TokenScan } from "./types";

const RPCS = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
];

const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const TOKEN_KLEGG = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const METADATA_PROGRAM = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

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

function metaplexPda(mint: string): string {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      METADATA_PROGRAM.toBuffer(),
      new PublicKey(mint).toBuffer(),
    ],
    METADATA_PROGRAM,
  );
  return pda.toBase58();
}

function readBorshString(buf: Buffer, offset: number): [string, number] {
  if (offset + 4 > buf.length) return ["", offset];
  const len = buf.readUInt32LE(offset);
  if (len > 2048 || offset + 4 + len > buf.length) return ["", offset];
  const raw = buf.subarray(offset + 4, offset + 4 + len).toString("utf8");
  return [raw.replace(/\0/g, "").trim(), offset + 4 + len];
}

function parseMetaplex(dataBase64: string): {
  name: string;
  symbol: string;
  uri: string;
} | null {
  try {
    const buf = Buffer.from(dataBase64, "base64");
    if (buf.length < 70) return null;
    let offset = 1 + 32 + 32;
    const [name, o1] = readBorshString(buf, offset);
    const [symbol, o2] = readBorshString(buf, o1);
    const [uri] = readBorshString(buf, o2);
    if (!name && !uri) return null;
    return { name, symbol, uri };
  } catch {
    return null;
  }
}

function rewriteGateway(url: string): string {
  if (url.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${url.slice("ipfs://".length)}`;
  }
  if (url.startsWith("ar://")) {
    return `https://arweave.net/${url.slice("ar://".length)}`;
  }
  return url;
}

async function fetchJson(uri: string): Promise<unknown | null> {
  const url = rewriteGateway(uri);
  if (!url.startsWith("http://") && !url.startsWith("https://")) return null;
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json, text/plain, */*" },
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len > 2_000_000) return null;
    const text = await res.text();
    if (text.length > 2_000_000) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

function extraFromPairs(pairs: unknown): ExtraField[] {
  if (!Array.isArray(pairs)) return [];
  const out: ExtraField[] = [];
  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const key = String(pair[0] ?? "");
    let value = String(pair[1] ?? "");
    if (value.length > 240) value = `${value.slice(0, 237)}…`;
    out.push({ key, value });
    if (out.length >= 24) break;
  }
  return out;
}

function hitsFromPairs(pairs: unknown): AudioHit[] {
  if (!Array.isArray(pairs)) return [];
  const hits: AudioHit[] = [];
  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const key = String(pair[0] ?? "");
    const value = String(pair[1] ?? "");
    const match = looksLikeAudio(value, key);
    if (match) {
      hits.push({
        field: `additionalMetadata.${key}`,
        src: value.trim(),
        mime: match.mime,
        storage: value.startsWith("data:") ? "on-chain" : "off-chain",
        bytes: value.startsWith("data:")
          ? Math.max(0, Math.floor(((value.split(",")[1] ?? "").length * 3) / 4))
          : null,
      });
    }
  }
  return hits;
}

function hitsFromRawUtf8(raw: string): AudioHit[] {
  const hits: AudioHit[] = [];
  const marker = "data:audio/";
  let from = 0;
  while (from < raw.length) {
    const i = raw.indexOf(marker, from);
    if (i < 0) break;
    let end = i;
    while (end < raw.length) {
      const c = raw[end];
      if (c === '"' || c === "'" || c === " " || c === "\n" || c === "\r") break;
      end += 1;
    }
    const src = raw.slice(i, end);
    const mime = dataUriMime(src) ?? "audio/*";
    hits.push({
      field: "account-data",
      src,
      mime,
      storage: "on-chain",
      bytes: Math.max(0, Math.floor(((src.split(",")[1] ?? "").length * 3) / 4)),
    });
    from = end;
    if (hits.length >= 4) break;
  }
  return hits;
}

function pickName(meta: unknown, fallback: string | null): string | null {
  if (meta && typeof meta === "object" && "name" in meta) {
    const n = (meta as { name?: unknown }).name;
    if (typeof n === "string" && n.trim()) return n.trim();
  }
  return fallback;
}

function pickSymbol(meta: unknown, fallback: string | null): string | null {
  if (meta && typeof meta === "object" && "symbol" in meta) {
    const n = (meta as { symbol?: unknown }).symbol;
    if (typeof n === "string" && n.trim()) return n.trim();
  }
  return fallback;
}

function pickImage(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") return null;
  const rec = meta as Record<string, unknown>;
  for (const key of ["image", "image_url", "icon"]) {
    if (typeof rec[key] === "string" && rec[key]) return rec[key] as string;
  }
  return null;
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
  const extraHits: AudioHit[] = [];

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
        extraHits.push(...hitsFromPairs(ext.state.additionalMetadata));
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
                  extraHits.push(...hitsFromPairs(e.state.additionalMetadata));
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
      extraHits.push(...hitsFromRawUtf8(uri));
    } else if (/^(https?:|ipfs:|ar:)/i.test(uri)) {
      metaJson = await fetchJson(uri);
    }
  }

  if (typeof account.data === "object" && Array.isArray(account.data)) {
    try {
      const raw = Buffer.from(account.data[0] as string, "base64").toString(
        "utf8",
      );
      extraHits.push(...hitsFromRawUtf8(raw));
    } catch {
      /* ignore */
    }
  }

  const hits = findAudioHits(metaJson, extraHits).sort((a, b) => {
    const rank = (hit: AudioHit) =>
      hit.field === "account-data" ? 1 : hit.field.includes("sound") ? -1 : 0;
    return rank(a) - rank(b);
  });
  const audio = hits[0] ?? null;

  return {
    mint,
    exists: true,
    program,
    name: pickName(metaJson, name),
    symbol: pickSymbol(metaJson, symbol),
    image: pickImage(metaJson),
    uri,
    uriKind: uriKind(uri),
    accountSpace: account.space ?? null,
    additionalMetadata,
    audio,
    extraAudioCount: Math.max(0, hits.length - (audio ? 1 : 0)),
    error: null,
  };
}
