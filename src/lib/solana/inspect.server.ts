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
import {
  collectMetaStrings,
  decodeOnepageMemo,
  harvestPageSignatures,
  isMintAddress,
  isTxSignature,
  memosFromParsedTx,
  skipHarvestHost,
} from "./detect-game";
import {
  GRADE_META,
  buildExplanation,
  collectClaimText,
  companionSeed,
  decidePrimaryGrade,
  gradeClaimMismatch,
  hasOnMintFile,
  linkedMintCandidates,
  looksLikeClaim,
  pointerMints,
} from "./grade";
import { findAnyScribeForMint } from "./anyscribe.server";
import { isAnyScribeProof, type AnyScribeProof } from "./anyscribe";
import { rpc, rpcErrorMessage } from "./rpc.server";
import {
  configFromRpcMessage,
  detectTxVersion,
  parseV1Transaction,
  type TransactionConfig,
  type TxVersion,
} from "./v1-tx";
import { ipfsCandidates, ipfsDisplayUrl } from "./ipfs";
import {
  EMPTY_SCAN,
  EMPTY_FLAGS,
  type AccountKind,
  type AnyScribeHit,
  type AudioHit,
  type ExtraField,
  type GameHit,
  type LinkedMint,
  type LinkedRole,
  type MediaHit,
  type TokenScan,
} from "./types";

/** Every tx read must opt into v1. Legacy-only nodes drop 0x81 envelopes. */
export const V1_TX_READ = {
  encoding: "base64" as const,
  maxSupportedTransactionVersion: 1 as const,
};

export const V1_TX_JSON_READ = {
  encoding: "jsonParsed" as const,
  maxSupportedTransactionVersion: 1 as const,
};

const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const TOKEN_KLEGG = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const METADATA_PROGRAM = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type RpcAccount = {
  owner: string;
  space: number;
  executable?: boolean;
  data: unknown;
};

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    }),
  ]);
}

async function firstOk<T>(promises: Array<Promise<T>>): Promise<T | null> {
  if (promises.length === 0) return null;
  try {
    return await Promise.any(promises);
  } catch {
    return null;
  }
}

export type ReadTx = {
  signature: string;
  version: TxVersion | null;
  config: TransactionConfig | null;
  wireBytes: number | null;
  parsed: unknown;
  slot: number | null;
};

/**
 * Fetch a confirmed tx as a v1-capable read.
 * Wire encoding sees prefix 0x81 and the signature tail.
 * jsonParsed is for memos; transactionConfig is never inferred from ComputeBudget ixs.
 */
export async function readTransaction(signature: string): Promise<ReadTx | null> {
  const [wire, parsed] = await Promise.all([
    rpc<{
      transaction?: [string, string];
      version?: number | string;
      slot?: number;
    } | null>("getTransaction", [signature, V1_TX_READ]).catch(() => null),
    rpc<{
      transaction?: { message?: unknown };
      meta?: unknown;
      version?: number | string;
      slot?: number;
    } | null>("getTransaction", [signature, V1_TX_JSON_READ]).catch(() => null),
  ]);

  if (!wire && !parsed) return null;

  let config: TransactionConfig | null =
    configFromRpcMessage(parsed) ??
    configFromRpcMessage(
      parsed && typeof parsed === "object" && "transaction" in parsed
        ? (parsed.transaction as { message?: unknown } | undefined)?.message
        : null,
    );

  let version: TxVersion | null = null;
  let wireBytes: number | null = null;
  const encoded = wire && typeof wire === "object" ? wire.transaction : null;
  if (Array.isArray(encoded) && typeof encoded[0] === "string") {
    const bytes = Uint8Array.from(Buffer.from(encoded[0], "base64"));
    wireBytes = bytes.length;
    version = detectTxVersion(bytes);
    if (version === 1) {
      try {
        const v1 = parseV1Transaction(bytes);
        config = v1.config;
      } catch {
        /* keep RPC config */
      }
    }
  }
  if (version == null) {
    const raw = parsed?.version ?? wire?.version;
    if (raw === 0 || raw === 1) version = raw;
    else if (raw === "legacy" || raw === undefined) version = "legacy";
  }

  return {
    signature,
    version,
    config,
    wireBytes,
    parsed,
    slot: parsed?.slot ?? wire?.slot ?? null,
  };
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
  if (url.startsWith("ipfs://")) return ipfsDisplayUrl(url);
  if (url.startsWith("ar://")) {
    return `https://arweave.net/${url.slice("ar://".length)}`;
  }
  return ipfsDisplayUrl(url);
}

async function fetchJson(uri: string): Promise<unknown | null> {
  const urls = ipfsCandidates(rewriteGateway(uri)).filter(
    (url) => url.startsWith("http://") || url.startsWith("https://"),
  );
  const attempts = urls.slice(0, 3).map(async (url) => {
    const res = await fetch(url, {
      headers: { accept: "application/json, text/plain, */*" },
      signal: AbortSignal.timeout(3_500),
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`json ${res.status}`);
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len > 2_000_000) throw new Error("json too large");
    const text = await res.text();
    if (text.length > 2_000_000) throw new Error("json too large");
    return JSON.parse(text) as unknown;
  });
  return firstOk(attempts);
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

function audioHitsFromPairs(pairs: unknown): AudioHit[] {
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

function imageHitsFromPairs(pairs: unknown): MediaHit[] {
  if (!Array.isArray(pairs)) return [];
  const hits: MediaHit[] = [];
  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const key = String(pair[0] ?? "");
    const value = String(pair[1] ?? "");
    const match = looksLikeImage(value, key);
    if (match) {
      hits.push({
        field: `additionalMetadata.${key}`,
        src: value.startsWith("data:") ? value.trim() : ipfsDisplayUrl(value.trim()),
        mime: match.mime,
        kind: match.kind,
        animated: match.kind === "gif",
        storage: value.startsWith("data:") ? "on-chain" : "off-chain",
        bytes: value.startsWith("data:")
          ? Math.max(0, Math.floor(((value.split(",")[1] ?? "").length * 3) / 4))
          : null,
      });
    }
  }
  return hits;
}

function audioHitsFromRawUtf8(raw: string): AudioHit[] {
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
  for (const key of ["image", "image_url", "icon", "animation_url"]) {
    if (typeof rec[key] === "string" && rec[key]) {
      return ipfsDisplayUrl(rec[key] as string);
    }
  }
  return null;
}

function gifMagic(bytes: Uint8Array): boolean {
  if (bytes.length < 6) return false;
  const tag = String.fromCharCode(
    bytes[0]!,
    bytes[1]!,
    bytes[2]!,
    bytes[3]!,
    bytes[4]!,
    bytes[5]!,
  );
  return tag === "GIF87a" || tag === "GIF89a";
}

async function sniffRemote(hit: MediaHit): Promise<MediaHit> {
  if (hit.src.startsWith("data:")) return hit;
  const urls = ipfsCandidates(hit.src).slice(0, 3);
  const attempts = urls.map(async (url) => {
    const res = await fetch(url, {
      headers: { Range: "bytes=0-15", accept: "image/*,*/*" },
      signal: AbortSignal.timeout(2_500),
      redirect: "follow",
    });
    if (!res.ok && res.status !== 206) throw new Error(`sniff ${res.status}`);
    const mime = (res.headers.get("content-type") ?? hit.mime)
      .split(";")[0]
      ?.trim()
      .toLowerCase() || hit.mime;
    const lenHeader = res.headers.get("content-length");
    let bytes = hit.bytes;
    if (lenHeader && /^\d+$/.test(lenHeader) && Number(lenHeader) > 64) {
      bytes = Number(lenHeader);
    }
    const range = res.headers.get("content-range");
    if (range) {
      const total = range.split("/")[1];
      if (total && total !== "*" && /^\d+$/.test(total)) bytes = Number(total);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const gif = isGifMime(mime) || gifMagic(buf) || hit.kind === "gif";
    return {
      ...hit,
      src: url,
      mime: gif ? "image/gif" : mime || hit.mime,
      kind: gif ? "gif" : "image",
      animated: gif,
      bytes,
    } satisfies MediaHit;
  });
  return (await firstOk(attempts)) ?? { ...hit, src: ipfsDisplayUrl(hit.src) };
}

async function fetchTextLimited(
  url: string,
  maxBytes: number,
): Promise<string | null> {
  if (!url.startsWith("http://") && !url.startsWith("https://")) return null;
  try {
    const res = await fetch(url, {
      headers: { accept: "text/html,application/javascript,text/javascript,*/*" },
      signal: AbortSignal.timeout(3_000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len > maxBytes) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > maxBytes) return null;
    return new TextDecoder("utf-8", { fatal: false }).decode(buf);
  } catch {
    return null;
  }
}

async function inspectGameTx(signature: string): Promise<GameHit | null> {
  const tx = await readTransaction(signature).catch(() => null);
  if (!tx?.parsed) return null;
  const memos = memosFromParsedTx(tx.parsed);
  for (const memo of memos) {
    const cart = decodeOnepageMemo(memo);
    if (!cart) continue;
    return {
      signature,
      prefix: cart.prefix,
      memoBytes: cart.memoBytes,
      cartBytes: cart.cartBytes,
      wireBytes: tx.wireBytes,
      source: cart.source,
      slot: tx.slot,
      version: tx.version,
    };
  }
  return null;
}

async function findGame(meta: unknown, extra: string[]): Promise<GameHit | null> {
  const texts = [...collectMetaStrings(meta), ...extra];
  const sigs: string[] = [];
  const seen = new Set<string>();
  const add = (sig: string) => {
    if (seen.has(sig)) return;
    seen.add(sig);
    sigs.push(sig);
  };
  for (const text of texts) {
    for (const sig of text.match(/[1-9A-HJ-NP-Za-km-z]{86,90}/g) ?? []) add(sig);
  }
  const pages = texts.filter((t) => {
    if (!/^https?:\/\//i.test(t)) return false;
    if (skipHarvestHost(t)) return false;
    try {
      const path = new URL(t).pathname;
      if (/\.(gif|png|jpe?g|webp|svg|avif|mp3|wav|mp4|webm)$/i.test(path)) {
        return false;
      }
    } catch {
      return false;
    }
    return true;
  }).slice(0, 1);
  const harvested = await Promise.all(
    pages.map((page) => harvestPageSignatures(page, fetchTextLimited).catch(() => [])),
  );
  harvested.flat().forEach(add);
  for (const sig of sigs.slice(0, 3)) {
    const game = await inspectGameTx(sig);
    if (game) return game;
  }
  return null;
}

async function pumpCoin(mint: string): Promise<{
  creator: string | null;
  description: string | null;
}> {
  const hit = pumpMemo.get(mint);
  if (hit) return hit;
  if (pumpMemo.size > 32) pumpMemo.clear();
  const pending = (async () => {
    try {
      const res = await fetch(
        `https://frontend-api-v3.pump.fun/coins/${mint}`,
        {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(3_000),
        },
      );
      if (!res.ok) return { creator: null, description: null };
      const body = (await res.json()) as {
        creator?: unknown;
        description?: unknown;
      };
      const creator =
        typeof body.creator === "string" &&
        /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(body.creator)
          ? body.creator
          : null;
      const description =
        typeof body.description === "string" && body.description.trim()
          ? body.description
          : null;
      return { creator, description };
    } catch {
      return { creator: null, description: null };
    }
  })();
  pumpMemo.set(mint, pending);
  return pending;
}

const pumpMemo = new Map<
  string,
  Promise<{ creator: string | null; description: string | null }>
>();

async function firstTxVersion(address: string, space: number | null): Promise<number | string | null> {
  if (space != null && space > 8_000) return null;
  try {
    const sigs = await rpc<Array<{ signature: string }>>("getSignaturesForAddress", [
      address,
      { limit: 12 },
    ]);
    if (!sigs?.length || sigs.length >= 12) return null;
    const first = sigs[sigs.length - 1];
    if (!first) return null;
    const tx = await readTransaction(first.signature);
    if (!tx) return null;
    return tx.version;
  } catch {
    return null;
  }
}

async function findPackedCompanion(
  mint: string,
  authorities: string[],
  extra: ExtraField[],
  meta: unknown,
): Promise<string | null> {
  const pointed = pointerMints(extra, meta, mint);
  const bases: string[] = [];
  const addBase = (value: string | null | undefined) => {
    if (!value) return;
    if (value === "None" || value === mint) return;
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return;
    if (!bases.includes(value)) bases.push(value);
  };
  authorities.forEach(addBase);
  pointed.forEach(addBase);
  addBase((await pumpCoin(mint)).creator);

  const program = new PublicKey(TOKEN_2022);
  const seed = companionSeed(mint);
  for (const base of bases) {
    try {
      const pk = await PublicKey.createWithSeed(new PublicKey(base), seed, program);
      const addr = pk.toBase58();
      if (addr === mint) continue;
      const acc = await rpc<{ value: RpcAccount | null }>("getAccountInfo", [
        addr,
        { encoding: "jsonParsed" },
      ]);
      if (acc?.value) return addr;
    } catch {
      /* invalid base or missing account */
    }
  }
  for (const other of pointed) {
    try {
      const acc = await rpc<{ value: RpcAccount | null }>("getAccountInfo", [
        other,
        { encoding: "jsonParsed" },
      ]);
      if (acc?.value) return other;
    } catch {
      /* skip */
    }
  }
  return null;
}

function programFromOwner(
  owner: string,
): "token-2022" | "spl-token" | "unknown" {
  if (owner === TOKEN_2022) return "token-2022";
  if (owner === TOKEN_KLEGG) return "spl-token";
  return "unknown";
}

function parsedInfo(data: unknown): {
  type?: string;
  info?: Record<string, unknown>;
} | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const rec = data as { parsed?: { type?: unknown; info?: unknown } };
  if (!rec.parsed || typeof rec.parsed !== "object") return null;
  return {
    type: typeof rec.parsed.type === "string" ? rec.parsed.type : undefined,
    info:
      rec.parsed.info && typeof rec.parsed.info === "object"
        ? (rec.parsed.info as Record<string, unknown>)
        : undefined,
  };
}

function classifyAccount(account: RpcAccount | null): {
  kind: AccountKind;
  decimals: number | null;
  supply: string | null;
  tokenAccountMint: string | null;
} {
  if (!account) {
    return { kind: "none", decimals: null, supply: null, tokenAccountMint: null };
  }
  if (account.executable) {
    return { kind: "program", decimals: null, supply: null, tokenAccountMint: null };
  }
  if (account.owner === SYSTEM_PROGRAM) {
    return { kind: "wallet", decimals: null, supply: null, tokenAccountMint: null };
  }
  const parsed = parsedInfo(account.data);
  if (parsed?.type === "mint") {
    const decimals =
      typeof parsed.info?.decimals === "number" ? parsed.info.decimals : null;
    const supply =
      typeof parsed.info?.supply === "string" ? parsed.info.supply : null;
    let raw: bigint | null = null;
    if (supply != null && /^\d+$/.test(supply)) {
      try {
        raw = BigInt(supply);
      } catch {
        raw = null;
      }
    }
    const nft = decimals === 0 && (raw === null || raw <= 1n);
    return {
      kind: nft ? "nft" : "token",
      decimals,
      supply,
      tokenAccountMint: null,
    };
  }
  if (parsed?.type === "account") {
    const mint = typeof parsed.info?.mint === "string" ? parsed.info.mint : null;
    const ta = parsed.info?.tokenAmount as
      | { decimals?: unknown; amount?: unknown }
      | undefined;
    return {
      kind: "token-account",
      decimals: typeof ta?.decimals === "number" ? ta.decimals : null,
      supply: typeof ta?.amount === "string" ? ta.amount : null,
      tokenAccountMint: mint && isMintAddress(mint) ? mint : null,
    };
  }
  if (account.owner === TOKEN_2022 || account.owner === TOKEN_KLEGG) {
    if (account.space === 165) {
      return {
        kind: "token-account",
        decimals: null,
        supply: null,
        tokenAccountMint: null,
      };
    }
    return { kind: "token", decimals: null, supply: null, tokenAccountMint: null };
  }
  return { kind: "other", decimals: null, supply: null, tokenAccountMint: null };
}

function tokenMetaFromAccount(account: RpcAccount): {
  name: string | null;
  uri: string | null;
  extra: ExtraField[];
} {
  const parsed = parsedInfo(account.data);
  const exts = parsed?.info?.extensions as
    | Array<{ extension?: string; state?: Record<string, unknown> }>
    | undefined;
  for (const ext of exts ?? []) {
    if (ext.extension === "tokenMetadata" && ext.state) {
      return {
        name: typeof ext.state.name === "string" ? ext.state.name : null,
        uri: typeof ext.state.uri === "string" ? ext.state.uri : null,
        extra: extraFromPairs(ext.state.additionalMetadata),
      };
    }
  }
  return { name: null, uri: null, extra: [] };
}

function linkHint(
  role: LinkedRole,
  uri: string | null,
  extra: ExtraField[],
): string {
  const blob = `${uri ?? ""} ${extra.map((field) => `${field.key} ${field.value}`).join(" ")}`.toLowerCase();
  if (role === "token") return "Tradeable token this NFT points at.";
  if (role === "packed-mint") {
    if (blob.includes("data:audio") || blob.includes("sound")) {
      return "Packed audio mint linked to this token.";
    }
    if (blob.includes("data:image")) return "Packed image mint linked to this token.";
    return "Packed file mint linked to this token.";
  }
  if (role === "sidecar-nft") {
    if (blob.includes("data:audio") || /\bsound\b/.test(blob)) {
      return "On-chain audio lives here, not on this token.";
    }
    if (blob.includes("data:image")) {
      return "On-chain image lives here, not on this token.";
    }
    return "On-chain file lives here, not on this token.";
  }
  if (role === "nft") return "Linked NFT mint.";
  return "Linked on-chain account.";
}

function roleForLink(
  kind: AccountKind,
  hasFile: boolean,
  packedMint: string | null,
  address: string,
): LinkedRole | null {
  if (packedMint === address) return "packed-mint";
  if (kind === "token") return "token";
  if (kind === "nft" && hasFile) return "sidecar-nft";
  if (kind === "nft") return "nft";
  if (kind === "none" || kind === "wallet" || kind === "program") return null;
  return "other";
}

async function peekLinkedMint(
  address: string,
  packedMint: string | null,
): Promise<LinkedMint | null> {
  try {
    const parsed = await rpc<{ value: RpcAccount | null }>("getAccountInfo", [
      address,
      { encoding: "jsonParsed" },
    ]);
    if (!parsed?.value) return null;
    const classified = classifyAccount(parsed.value);
    const meta = tokenMetaFromAccount(parsed.value);
    const hasFile = hasOnMintFile(meta.uri, meta.extra);
    const role = roleForLink(classified.kind, hasFile, packedMint, address);
    if (!role) return null;
    return {
      address,
      role,
      name: meta.name,
      hint: linkHint(role, meta.uri, meta.extra),
      hasOnMintFile: hasFile,
    };
  } catch {
    return null;
  }
}

async function peekLinkedMints(
  addresses: string[],
  packedMint: string | null,
): Promise<LinkedMint[]> {
  const uniq: string[] = [];
  for (const address of addresses) {
    if (!uniq.includes(address)) uniq.push(address);
    if (uniq.length >= 4) break;
  }
  const rows = await Promise.all(
    uniq.map((address) => peekLinkedMint(address, packedMint)),
  );
  const rank: Record<LinkedRole, number> = {
    "sidecar-nft": 0,
    "packed-mint": 1,
    token: 2,
    nft: 3,
    other: 4,
  };
  return rows
    .filter((row): row is LinkedMint => Boolean(row))
    .sort((a, b) => rank[a.role] - rank[b.role]);
}

function attachGrade(
  scan: TokenScan,
  hop: number,
  onlyTx: boolean,
  claimSource = "",
  anyscribe: AnyScribeProof | null = null,
): TokenScan {
  const onMintFile = hasOnMintFile(scan.uri, scan.additionalMetadata);
  const grade = decidePrimaryGrade({
    exists: scan.exists,
    uri: scan.uri,
    onMintFile,
    packedHasFile: Boolean(scan.flags.packedMint) && !onMintFile && hop === 0,
    game: Boolean(scan.game),
    onlyTx,
    anyscribe: isAnyScribeProof(anyscribe),
  });
  const meta = GRADE_META[grade];
  const claim = looksLikeClaim(claimSource);
  const claimMismatch = gradeClaimMismatch(grade, Boolean(scan.game), claim);
  const explanation = buildExplanation({
    grade,
    name: scan.name,
    mediaMime: scan.media?.mime ?? scan.audio?.mime ?? anyscribe?.header.mime ?? null,
    mediaBytes: scan.media?.bytes ?? scan.audio?.bytes ?? anyscribe?.header.contentLength ?? null,
    hasGame: Boolean(scan.game),
    anyscribeBytes: anyscribe?.header.contentLength ?? null,
  });
  const hit: AnyScribeHit | null = anyscribe
    ? {
        address: anyscribe.address,
        mime: anyscribe.header.mime,
        contentLength: anyscribe.header.contentLength,
        published: anyscribe.published,
        mintBound: anyscribe.mintBound,
        ownerOk: anyscribe.ownerOk,
        gatewayUri: anyscribe.gatewayUri,
      }
    : null;
  return {
    ...scan,
    grade,
    gradeLabel: meta.label,
    gradeExplanation: explanation,
    inscribed: meta.inscribed,
    flags: { ...scan.flags, claimMismatch },
    anyscribe: hit,
  };
}

export async function inspectMint(rawMint: string, hop = 0): Promise<TokenScan> {
  const mint = rawMint.trim();
  if (isTxSignature(mint)) {
    const game = await inspectGameTx(mint);
    if (!game) {
      return {
        ...EMPTY_SCAN,
        mint,
        error: "No ONEPAGE memo in this transaction.",
      };
    }
    return attachGrade(
      {
        ...EMPTY_SCAN,
        mint: game.signature,
        exists: true,
        accountKind: "other",
        name: "ONEPAGE",
        symbol: "cart",
        game,
        error: null,
      },
      0,
      true,
      "4096-byte cart",
    );
  }
  if (!isMintAddress(mint) && !BASE58_RE.test(mint)) {
    return {
      ...EMPTY_SCAN,
      mint,
      error: "That does not look like a Solana mint or transaction signature.",
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
  } catch (err) {
    return {
      ...EMPTY_SCAN,
      mint,
      error: rpcErrorMessage(err),
    };
  }

  if (!parsed?.value) {
    return {
      ...EMPTY_SCAN,
      mint,
      exists: false,
      accountKind: "none",
      error: null,
    };
  }

  const account = parsed.value;
  const classified = classifyAccount(account);
  const program = programFromOwner(account.owner);
  const pumpP = hop === 0 ? pumpCoin(mint) : null;

  if (
    classified.kind === "wallet" ||
    classified.kind === "program" ||
    classified.kind === "other" ||
    classified.kind === "token-account"
  ) {
    return {
      ...EMPTY_SCAN,
      mint,
      exists: true,
      accountKind: classified.kind,
      decimals: classified.decimals,
      supply: classified.supply,
      tokenAccountMint: classified.tokenAccountMint,
      program,
      accountSpace: account.space ?? null,
      error: null,
    };
  }

  let name: string | null = null;
  let symbol: string | null = null;
  let uri: string | null = null;
  let additionalMetadata: ExtraField[] = [];
  let updateAuthority: string | null = null;
  let mintAuthority: string | null = null;
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
    const info = parsedData.parsed?.info as
      | {
          mintAuthority?: unknown;
          extensions?: Array<{
            extension?: string;
            state?: Record<string, unknown>;
          }>;
        }
      | undefined;
    if (typeof info?.mintAuthority === "string" && info.mintAuthority !== "None") {
      mintAuthority = info.mintAuthority;
    }
    const extensions = info?.extensions ?? [];
    for (const ext of extensions) {
      if (ext.extension === "tokenMetadata" && ext.state) {
        name = typeof ext.state.name === "string" ? ext.state.name : name;
        symbol = typeof ext.state.symbol === "string" ? ext.state.symbol : symbol;
        uri = typeof ext.state.uri === "string" ? ext.state.uri : uri;
        if (
          typeof ext.state.updateAuthority === "string" &&
          ext.state.updateAuthority !== "None"
        ) {
          updateAuthority = ext.state.updateAuthority;
        }
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
      metaJson = await withTimeout(fetchJson(uri), 4_000, null);
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
  let audio = audioHits[0] ?? null;

  let mediaHits = findImageHits(metaJson, extraImage);
  const onMintFile = hasOnMintFile(uri, additionalMetadata);
  const sniffPromise =
    mediaHits[0] && !mediaHits[0].src.startsWith("data:")
      ? sniffRemote(mediaHits[0])
      : Promise.resolve(mediaHits[0] ?? null);
  const extraStrings = [
    uri ?? "",
    ...additionalMetadata.map((f) => f.value),
  ].filter(Boolean);
  const huntGame = hop === 0 && !onMintFile;
  const huntPacked = hop === 0 && !onMintFile;
  const huntTxVersion =
    hop === 0 && (classified.decimals == null || classified.decimals === 0);
  const huntAnyScribe = hop === 0;
  const pointed = pointerMints(additionalMetadata, metaJson, mint);
  const [bundle, anyscribe] = await Promise.all([
    withTimeout(
      Promise.all([
        sniffPromise.catch(() => mediaHits[0] ?? null),
        huntGame
          ? findGame(metaJson, extraStrings).catch(() => null)
          : Promise.resolve(null),
        huntTxVersion
          ? firstTxVersion(mint, account.space ?? null)
          : Promise.resolve(null),
        huntPacked
          ? findPackedCompanion(
              mint,
              [updateAuthority ?? "", mintAuthority ?? ""],
              additionalMetadata,
              metaJson,
            ).catch(() => null)
          : Promise.resolve(null),
      ]),
      6_000,
      [mediaHits[0] ?? null, null, null, null] as const,
    ),
    huntAnyScribe
      ? withTimeout(
          findAnyScribeForMint({
            mint,
            uri,
            extras: additionalMetadata,
          }).catch(() => null),
          8_000,
          null,
        )
      : Promise.resolve(null),
  ]);
  const [sniffed, game, txVersionCreate, derivedPacked] = bundle;
  if (sniffed) mediaHits = [sniffed, ...mediaHits.slice(1)];
  let media = mediaHits[0] ?? null;
  let image = media?.src ?? pickImage(metaJson);

  let packedMint: string | null = null;
  let packedHasFile = false;
  if (onMintFile) {
    packedMint = pointed[0] ?? null;
  } else if (derivedPacked) {
    const companion = await withTimeout(
      inspectMint(derivedPacked, hop + 1),
      4_000,
      null as TokenScan | null,
    );
    if (companion) {
      packedHasFile = hasOnMintFile(companion.uri, companion.additionalMetadata);
      if (packedHasFile) {
        packedMint = derivedPacked;
        if (companion.media) {
          media = {
            ...companion.media,
            field: `packed.${companion.media.field}`,
          };
        }
        if (!audio && companion.audio) audio = companion.audio;
        image = image ?? companion.image;
      }
    }
  }

  const pump = pumpP ? await pumpP : null;
  const linkPacked = packedMint && (onMintFile || packedHasFile) ? packedMint : null;
  const linkCandidates = [
    ...linkedMintCandidates(
      additionalMetadata,
      metaJson,
      [
        collectClaimText(name, additionalMetadata, metaJson),
        pump?.description ?? "",
      ],
      mint,
    ),
    ...(linkPacked ? [linkPacked] : []),
    ...(derivedPacked ? [derivedPacked] : []),
  ];
  const links =
    hop === 0
      ? await withTimeout(peekLinkedMints(linkCandidates, linkPacked), 4_000, [])
      : [];

  const scan: TokenScan = {
    mint,
    exists: true,
    accountKind: classified.kind,
    decimals: classified.decimals,
    supply: classified.supply,
    tokenAccountMint: classified.tokenAccountMint,
    program,
    name: pickName(metaJson, name),
    symbol: pickSymbol(metaJson, symbol),
    image,
    uri,
    uriKind: uriKind(uri),
    accountSpace: account.space ?? null,
    additionalMetadata,
    links,
    audio,
    media,
    game,
    extraAudioCount: Math.max(0, audioHits.length - (audio ? 1 : 0)),
    error: null,
    totalScans: null,
    grade: null,
    gradeLabel: null,
    gradeExplanation: null,
    inscribed: false,
    flags: {
      ...EMPTY_FLAGS,
      txVersionCreate,
      mutable: Boolean(updateAuthority),
      packedMint: linkPacked,
    },
    anyscribe: null,
  };

  return attachGrade(
    scan,
    hop,
    false,
    collectClaimText(scan.name, additionalMetadata, metaJson),
    anyscribe,
  );
}
