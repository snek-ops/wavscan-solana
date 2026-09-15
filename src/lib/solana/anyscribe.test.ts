import assert from "node:assert/strict";
import { test } from "node:test";
import { PublicKey } from "@solana/web3.js";
import {
  ANYSCRIBE_HEADER_BYTES,
  ANYSCRIBE_MAGIC,
  ANYSCRIBE_PROGRAM,
  ANYSCRIBE_STATE,
  isAnyScribeProof,
  looksLikeAnyScribeGateway,
  parseAnyScribeHeader,
  storageHintFromUri,
  type AnyScribeProof,
} from "./anyscribe.ts";

test("gateway URI is a reader, not the store", () => {
  assert.equal(
    looksLikeAnyScribeGateway(
      "https://anyscribe.fun/inscriptions/Fn7ASHWWA8dBEPQgXhcQTgRxeWVgadHZ11pTBar4VdLx",
    ),
    true,
  );
  assert.equal(looksLikeAnyScribeGateway("https://ipfs.io/ipfs/abc"), false);
  assert.equal(
    storageHintFromUri(
      "https://anyscribe.fun/inscriptions/Bepk57mCZnVYPuE9qUVqFTxScq2yX6gLMjVMWmzS5FUn",
    ),
    "Bepk57mCZnVYPuE9qUVqFTxScq2yX6gLMjVMWmzS5FUn",
  );
});

test("ANYSCRIB header parses mint bind and published state", () => {
  const buf = new Uint8Array(ANYSCRIBE_HEADER_BYTES);
  buf.set(ANYSCRIBE_MAGIC, 0);
  buf[8] = 1;
  buf[9] = ANYSCRIBE_STATE.published;
  const authority = new PublicKey(Buffer.alloc(32, 1));
  const mint = new PublicKey(Buffer.alloc(32, 2));
  buf.set(authority.toBytes(), 16);
  buf.set(mint.toBytes(), 48);
  buf[80] = 100;
  buf[84] = 100;
  const mime = new TextEncoder().encode("image/png");
  buf.set(mime, 152);
  const header = parseAnyScribeHeader(buf);
  assert.equal(header.magic, "ANYSCRIB");
  assert.equal(header.stateName, "published");
  assert.equal(header.authority, authority.toBase58());
  assert.equal(header.mint, mint.toBase58());
  assert.equal(header.contentLength, 100);
  assert.equal(header.written, 100);
  assert.equal(header.mime, "image/png");
});

test("isAnyScribeProof requires published, mint bind, owner, magic", () => {
  const proof: AnyScribeProof = {
    address: "x",
    owner: ANYSCRIBE_PROGRAM,
    space: 1024,
    header: {
      magic: "ANYSCRIB",
      version: 1,
      state: 2,
      stateName: "published",
      authority: "a",
      mint: "m",
      contentLength: 10,
      written: 10,
      commitment: "",
      runningHash: "",
      mime: "image/png",
      name: "",
      symbol: "",
      description: "",
      pool: null,
      quoteMint: null,
      config: null,
    },
    published: true,
    mintBound: true,
    ownerOk: true,
    magicOk: true,
    lengthOk: true,
    poolBound: false,
    configBound: false,
    commitmentAlgorithm: "anyscribe-sha256-chain-v1",
    commitmentChecked: false,
    commitmentOk: null,
    gatewayUri: true,
  };
  assert.equal(isAnyScribeProof(proof), true);
  assert.equal(isAnyScribeProof({ ...proof, published: false }), false);
  assert.equal(isAnyScribeProof({ ...proof, mintBound: false }), false);
  assert.equal(isAnyScribeProof({ ...proof, ownerOk: false }), false);
  assert.equal(isAnyScribeProof({ ...proof, commitmentOk: false }), false);
});
