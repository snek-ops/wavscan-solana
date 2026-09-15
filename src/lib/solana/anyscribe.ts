import { PublicKey } from "@solana/web3.js";

export const ANYSCRIBE_PROGRAM = "Fn7ASHWWA8dBEPQgXhcQTgRxeWVgadHZ11pTBar4VdLx";
export const ANYSCRIBE_MAGIC = new TextEncoder().encode("ANYSCRIB");
export const ANYSCRIBE_HEADER_BYTES = 512;
export const ANYSCRIBE_CHUNK_DOMAIN = new TextEncoder().encode("anyscribe:chunk:v1");
export const ANYSCRIBE_COMMITMENT_ALG = "anyscribe-sha256-chain-v1";
export const ANYSCRIBE_CHUNK_SIZE = 3500;

export const ANYSCRIBE_STATE = {
  unpublished: 1,
  published: 2,
} as const;

export type AnyScribeHeader = {
  magic: "ANYSCRIB";
  version: number;
  state: number;
  stateName: "unpublished" | "published" | "unknown";
  authority: string;
  mint: string;
  contentLength: number;
  written: number;
  commitment: string;
  runningHash: string;
  mime: string;
  name: string;
  symbol: string;
  description: string;
  pool: string | null;
  quoteMint: string | null;
  config: string | null;
};

export type AnyScribeProof = {
  address: string;
  owner: string;
  space: number;
  header: AnyScribeHeader;
  published: boolean;
  mintBound: boolean;
  ownerOk: boolean;
  magicOk: boolean;
  lengthOk: boolean;
  poolBound: boolean;
  configBound: boolean;
  commitmentAlgorithm: typeof ANYSCRIBE_COMMITMENT_ALG;
  commitmentChecked: boolean;
  commitmentOk: boolean | null;
  gatewayUri: boolean;
};

const ZERO32 = new Uint8Array(32);

function u32le(buf: Uint8Array, offset: number): number {
  return (
    buf[offset]! |
    (buf[offset + 1]! << 8) |
    (buf[offset + 2]! << 16) |
    (buf[offset + 3]! << 24)
  ) >>> 0;
}

function cstr(buf: Uint8Array, offset: number, len: number): string {
  let end = offset;
  const last = Math.min(buf.length, offset + len);
  while (end < last && buf[end] !== 0) end += 1;
  return new TextDecoder().decode(buf.subarray(offset, end)).trim();
}

function pk(buf: Uint8Array, offset: number): string | null {
  if (offset + 32 > buf.length) return null;
  const slice = buf.subarray(offset, offset + 32);
  if (slice.every((b) => b === 0)) return null;
  return new PublicKey(slice).toBase58();
}

function hex(buf: Uint8Array): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function parseAnyScribeHeader(bytes: Uint8Array): AnyScribeHeader {
  if (bytes.length < ANYSCRIBE_HEADER_BYTES) {
    throw new Error("AnyScribe header shorter than 512 bytes");
  }
  for (let i = 0; i < 8; i += 1) {
    if (bytes[i] !== ANYSCRIBE_MAGIC[i]) throw new Error("AnyScribe magic missing");
  }
  const version = bytes[8]!;
  const state = bytes[9]!;
  const stateName =
    state === ANYSCRIBE_STATE.published
      ? "published"
      : state === ANYSCRIBE_STATE.unpublished
        ? "unpublished"
        : "unknown";
  const authority = pk(bytes, 16);
  const mint = pk(bytes, 48);
  if (!authority || !mint) throw new Error("AnyScribe header missing authority or mint");
  return {
    magic: "ANYSCRIB",
    version,
    state,
    stateName,
    authority,
    mint,
    contentLength: u32le(bytes, 80),
    written: u32le(bytes, 84),
    commitment: hex(bytes.subarray(88, 120)),
    runningHash: hex(bytes.subarray(120, 152)),
    mime: cstr(bytes, 152, 64),
    name: cstr(bytes, 216, 32),
    symbol: cstr(bytes, 248, 16),
    description: cstr(bytes, 264, 160),
    pool: pk(bytes, 424),
    quoteMint: pk(bytes, 456),
    config: bytes.length >= 520 ? pk(bytes, 488) : null,
  };
}

export async function chainCommitment(
  content: Uint8Array,
  chunkSize = ANYSCRIBE_CHUNK_SIZE,
): Promise<Uint8Array> {
  let hash = ZERO32;
  for (let offset = 0; offset < content.length; offset += chunkSize) {
    const chunk = content.subarray(offset, Math.min(content.length, offset + chunkSize));
    const packed = new Uint8Array(ANYSCRIBE_CHUNK_DOMAIN.length + 32 + 4 + chunk.length);
    packed.set(ANYSCRIBE_CHUNK_DOMAIN, 0);
    packed.set(hash, ANYSCRIBE_CHUNK_DOMAIN.length);
    const o = ANYSCRIBE_CHUNK_DOMAIN.length + 32;
    packed[o] = offset & 0xff;
    packed[o + 1] = (offset >>> 8) & 0xff;
    packed[o + 2] = (offset >>> 16) & 0xff;
    packed[o + 3] = (offset >>> 24) & 0xff;
    packed.set(chunk, o + 4);
    hash = new Uint8Array(await crypto.subtle.digest("SHA-256", packed));
  }
  return hash;
}

const STORAGE_RE =
  /(?:\/inscriptions?\/|account=)([1-9A-HJ-NP-Za-km-z]{32,44})/;

export function storageHintFromUri(uri: string | null): string | null {
  if (!uri) return null;
  const match = uri.match(STORAGE_RE);
  return match?.[1] ?? null;
}

export function looksLikeAnyScribeGateway(uri: string | null): boolean {
  if (!uri) return false;
  return /anyscribe\.fun|anyscribe\.ong/i.test(uri) && /inscription/i.test(uri);
}

export function isAnyScribeProof(proof: AnyScribeProof | null | undefined): boolean {
  return Boolean(
    proof &&
      proof.magicOk &&
      proof.ownerOk &&
      proof.published &&
      proof.mintBound &&
      proof.lengthOk &&
      proof.commitmentOk !== false,
  );
}
