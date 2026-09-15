import { PublicKey } from "@solana/web3.js";
import {
  findAudioHits,
  looksLikeAudio,
  parseDataJson,
  uriKind,
  dataUriMime,
} from "./detect-audio";
import {
  findImageHits,
  hitsFromImageRaw,
  isGifMime,
  looksLikeImage,
} from "./detect-image";
import { findAnyScribeForMint } from "./anyscribe.server";
import { gradeScan } from "./grade";
import { ipfsCandidates, ipfsDisplayUrl } from "./ipfs";
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
