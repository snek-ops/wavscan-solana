/** Solana transaction v1 (SIMD-0385): 0x81 prefix, 4096-byte envelope. */

export const V1_PREFIX = 0x81;
export const V1_MAX_BYTES = 4096;

export type TxVersion = "legacy" | 0 | 1;

export type TransactionConfig = {
  priorityFeeLamports: number | null;
  computeUnitLimit: number | null;
  loadedAccountsDataSizeLimit: number | null;
  heapSize: number | null;
};

export type V1Transaction = {
  version: 1;
  prefix: typeof V1_PREFIX;
  numRequiredSignatures: number;
  numReadonlySignedAccounts: number;
  numReadonlyUnsignedAccounts: number;
  recentBlockhash: Uint8Array;
  accountKeys: Uint8Array[];
  config: TransactionConfig;
  instructions: Array<{
    programIdIndex: number;
    accountIndexes: number[];
    data: Uint8Array;
  }>;
  signatures: Uint8Array[];
  signedMessageBytes: number;
};

function u32(buf: Uint8Array, offset: number): number {
  return (
    buf[offset]! |
    (buf[offset + 1]! << 8) |
    (buf[offset + 2]! << 16) |
    (buf[offset + 3]! << 24)
  ) >>> 0;
}

function u16(buf: Uint8Array, offset: number): number {
  return buf[offset]! | (buf[offset + 1]! << 8);
}

function popcount32(n: number): number {
  n = n >>> 0;
  n = n - ((n >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Parse a raw v1 transaction. Signatures sit at the tail; count comes from the header. */
export function parseV1Transaction(bytes: Uint8Array): V1Transaction {
  if (bytes.length < 42) throw new Error("v1 transaction too short");
  if (bytes[0] !== V1_PREFIX) {
    throw new Error(`not a v1 transaction (prefix 0x${bytes[0]!.toString(16)})`);
  }
  if (bytes.length > V1_MAX_BYTES) {
    throw new Error(`v1 transaction exceeds ${V1_MAX_BYTES} bytes`);
  }

  const numRequiredSignatures = bytes[1]!;
  const numReadonlySignedAccounts = bytes[2]!;
  const numReadonlyUnsignedAccounts = bytes[3]!;
  const mask = u32(bytes, 4);
  const recentBlockhash = bytes.subarray(8, 40);
  const numInstructions = bytes[40]!;
  const numAddresses = bytes[41]!;

  let offset = 42;
  const accountKeys: Uint8Array[] = [];
  for (let i = 0; i < numAddresses; i += 1) {
    if (offset + 32 > bytes.length) throw new Error("v1 truncated account keys");
    accountKeys.push(bytes.subarray(offset, offset + 32));
    offset += 32;
  }

  const config: TransactionConfig = {
    priorityFeeLamports: null,
    computeUnitLimit: null,
    loadedAccountsDataSizeLimit: null,
    heapSize: null,
  };

  if ((mask & 0x03) !== 0) {
    if (offset + 8 > bytes.length) throw new Error("v1 truncated priority fee");
    const lo = u32(bytes, offset);
    const hi = u32(bytes, offset + 4);
    config.priorityFeeLamports = lo + hi * 0x100000000;
    offset += 8;
  }
  if ((mask & 0x04) !== 0) {
    if (offset + 4 > bytes.length) throw new Error("v1 truncated compute limit");
    config.computeUnitLimit = u32(bytes, offset);
    offset += 4;
  }
  if ((mask & 0x08) !== 0) {
    if (offset + 4 > bytes.length) throw new Error("v1 truncated loaded-accounts limit");
    config.loadedAccountsDataSizeLimit = u32(bytes, offset);
    offset += 4;
  }
  if ((mask & 0x10) !== 0) {
    if (offset + 4 > bytes.length) throw new Error("v1 truncated heap size");
    config.heapSize = u32(bytes, offset);
    offset += 4;
  }

  const extraBits = mask & ~0x1f;
  if (extraBits !== 0) {
    offset += popcount32(extraBits) * 4;
  }

  const headers: Array<{ programIdIndex: number; numAccounts: number; dataLen: number }> = [];
  for (let i = 0; i < numInstructions; i += 1) {
    if (offset + 4 > bytes.length) throw new Error("v1 truncated instruction headers");
    headers.push({
      programIdIndex: bytes[offset]!,
      numAccounts: bytes[offset + 1]!,
      dataLen: u16(bytes, offset + 2),
    });
    offset += 4;
  }

  const instructions = headers.map((header) => {
    if (offset + header.numAccounts + header.dataLen > bytes.length) {
      throw new Error("v1 truncated instruction payload");
    }
    const accountIndexes = Array.from(bytes.subarray(offset, offset + header.numAccounts));
    offset += header.numAccounts;
    const data = bytes.subarray(offset, offset + header.dataLen);
    offset += header.dataLen;
    return { programIdIndex: header.programIdIndex, accountIndexes, data };
  });

  const sigBytes = numRequiredSignatures * 64;
  if (offset + sigBytes !== bytes.length) {
    throw new Error(
      `v1 signature tail mismatch: expected ${sigBytes} trailing bytes at ${offset}, have ${bytes.length - offset}`,
    );
  }
  const signatures: Uint8Array[] = [];
  for (let i = 0; i < numRequiredSignatures; i += 1) {
    signatures.push(bytes.subarray(offset, offset + 64));
    offset += 64;
  }

  return {
    version: 1,
    prefix: V1_PREFIX,
    numRequiredSignatures,
    numReadonlySignedAccounts,
    numReadonlyUnsignedAccounts,
    recentBlockhash,
    accountKeys,
    config,
    instructions,
    signatures,
    signedMessageBytes: bytes.length - sigBytes,
  };
}

export function detectTxVersion(bytes: Uint8Array): TxVersion | null {
  if (!bytes.length) return null;
  if (bytes[0] === V1_PREFIX) return 1;
  if ((bytes[0]! & 0x80) !== 0 && (bytes[0]! & 0x7f) === 0) return 0;
  if ((bytes[0]! & 0x80) === 0) return "legacy";
  return null;
}

export function configFromRpcMessage(message: unknown): TransactionConfig | null {
  if (!message || typeof message !== "object") return null;
  const rec = message as Record<string, unknown>;
  const raw = rec.transactionConfig ?? rec.config;
  if (!raw || typeof raw !== "object") return null;
  const cfg = raw as Record<string, unknown>;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  return {
    priorityFeeLamports: num(cfg.priorityFee ?? cfg.priorityFeeLamports),
    computeUnitLimit: num(cfg.computeUnitLimit),
    loadedAccountsDataSizeLimit: num(cfg.loadedAccountsDataSizeLimit),
    heapSize: num(cfg.heapSize),
  };
}
