import assert from "node:assert/strict";
import { test } from "node:test";
import {
  V1_PREFIX,
  configFromRpcMessage,
  detectTxVersion,
  parseV1Transaction,
} from "./v1-tx.ts";

function minimalV1(opts?: { sigs?: number; accounts?: number; ixs?: number }): Uint8Array {
  const sigs = opts?.sigs ?? 1;
  const accounts = opts?.accounts ?? 1;
  const ixs = opts?.ixs ?? 1;
  const prefix = 42 + accounts * 32 + ixs * 4;
  const total = prefix + sigs * 64;
  const bytes = new Uint8Array(total);
  bytes[0] = V1_PREFIX;
  bytes[1] = sigs;
  bytes[2] = 0;
  bytes[3] = 0;
  bytes[40] = ixs;
  bytes[41] = accounts;
  return bytes;
}

test("detectTxVersion reads 0x81 as v1", () => {
  assert.equal(detectTxVersion(new Uint8Array([0x81])), 1);
  assert.equal(detectTxVersion(new Uint8Array([0x80])), 0);
  assert.equal(detectTxVersion(new Uint8Array([1])), "legacy");
});

test("parseV1Transaction reads signatures from the tail", () => {
  const bytes = minimalV1({ sigs: 2, accounts: 1, ixs: 1 });
  bytes[bytes.length - 1] = 0xab;
  bytes[bytes.length - 64] = 0xcd;
  const parsed = parseV1Transaction(bytes);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.prefix, 0x81);
  assert.equal(parsed.signatures.length, 2);
  assert.equal(parsed.signatures[1]![63], 0xab);
  assert.equal(parsed.signatures[1]![0], 0xcd);
  assert.equal(parsed.signedMessageBytes, bytes.length - 128);
  assert.equal(parsed.accountKeys.length, 1);
  assert.equal(parsed.instructions.length, 1);
});

test("parseV1Transaction rejects a wrong prefix", () => {
  const bytes = minimalV1();
  bytes[0] = 0x80;
  assert.throws(() => parseV1Transaction(bytes), /not a v1/);
});

test("transactionConfig is read from the RPC message, not ComputeBudget ixs", () => {
  const cfg = configFromRpcMessage({
    transactionConfig: {
      computeUnitLimit: 30_000,
      heapSize: null,
      loadedAccountsDataSizeLimit: 200_000,
      priorityFee: 12,
    },
  });
  assert.deepEqual(cfg, {
    priorityFeeLamports: 12,
    computeUnitLimit: 30_000,
    loadedAccountsDataSizeLimit: 200_000,
    heapSize: null,
  });
  assert.equal(configFromRpcMessage({ instructions: [] }), null);
});
