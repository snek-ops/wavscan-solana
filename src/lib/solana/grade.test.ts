import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildExplanation,
  companionSeed,
  decidePrimaryGrade,
  explicitLinkMints,
  extractMintAddresses,
  gradeClaimMismatch,
  hasOnMintFile,
  isDexNoise,
  linkedMintCandidates,
  looksLikeClaim,
  looksLikeLpName,
} from "./grade.ts";

test("G4 requires a real data: media blob", () => {
  assert.equal(
    hasOnMintFile("data:image/jpeg;base64,AAAA", []),
    true,
  );
  assert.equal(
    hasOnMintFile("data:application/json,{\"image\":\"data:image/svg+xml,x\"}", []),
    true,
  );
  assert.equal(
    hasOnMintFile("data:application/json,{\"image\":\"https://ipfs.io/x\"}", []),
    false,
  );
  assert.equal(hasOnMintFile("https://ipfs.io/foo", []), false);
  assert.equal(
    hasOnMintFile(null, [{ key: "image", value: "chunked:image/jpeg+gzip;n=7" }]),
    true,
  );
});

test("decision order", () => {
  assert.equal(
    decidePrimaryGrade({
      exists: true,
      uri: "https://anyscribe.fun/inscriptions/abc",
      onMintFile: false,
      packedHasFile: false,
      game: false,
      onlyTx: false,
      anyscribe: true,
    }),
    "G5",
  );
  assert.equal(
    decidePrimaryGrade({
      exists: true,
      uri: "data:image/jpeg;base64,AA",
      onMintFile: true,
      packedHasFile: true,
      game: true,
      onlyTx: false,
    }),
    "G4",
  );
  assert.equal(
    decidePrimaryGrade({
      exists: true,
      uri: "https://ipfs.io/x",
      onMintFile: false,
      packedHasFile: true,
      game: false,
      onlyTx: false,
    }),
    "G3",
  );
  assert.equal(
    decidePrimaryGrade({
      exists: true,
      uri: "https://ipfs.io/x",
      onMintFile: false,
      packedHasFile: false,
      game: true,
      onlyTx: false,
    }),
    "G1",
  );
  assert.equal(
    decidePrimaryGrade({
      exists: true,
      uri: null,
      onMintFile: false,
      packedHasFile: false,
      game: true,
      onlyTx: true,
    }),
    "G2",
  );
  assert.equal(
    decidePrimaryGrade({
      exists: true,
      uri: "https://ipfs.io/x",
      onMintFile: false,
      packedHasFile: false,
      game: false,
      onlyTx: false,
    }),
    "G1",
  );
});

test("claim mismatch is orthogonal to G4", () => {
  assert.equal(looksLikeClaim("THE FIRST IMAGE INSCRIBED IN A COIN"), true);
  assert.equal(looksLikeClaim("a 4kb game packed on chain"), true);
  assert.equal(gradeClaimMismatch("G4", false, true), false);
  assert.equal(gradeClaimMismatch("G5", false, true), false);
  assert.equal(gradeClaimMismatch("G3", false, true), true);
  assert.equal(gradeClaimMismatch("G1", true, true), true);
  assert.equal(gradeClaimMismatch("G1", false, false), false);
});

test("companion seed is 32 bytes: img: + mint prefix", () => {
  const mint = "A9AHYeqb7nQk7LZUraw7rBCzYRjy2DRvE6NqWfFHKRdH";
  const seed = companionSeed(mint);
  assert.equal(seed.length, 32);
  assert.equal(seed, "img:A9AHYeqb7nQk7LZUraw7rBCzYRjy");
});

test("explanations only describe the grade", () => {
  const g4 = buildExplanation({
    grade: "G4",
    name: "bruh",
    mediaMime: "image/svg+xml",
    mediaBytes: 451,
    hasGame: false,
  });
  assert.equal(g4.includes("v1"), false);
  assert.equal(/wallet/i.test(g4), false);
  assert.equal(/wire/i.test(g4), false);
  assert.match(g4, /G4/);
  assert.match(g4, /this mint/);

  const g3 = buildExplanation({
    grade: "G3",
    name: "HUHCAT",
    mediaMime: "image/jpeg",
    mediaBytes: 1898,
    hasGame: false,
  });
  assert.match(g3, /G3/);
  assert.match(g3, /linked mint/);

  const g5 = buildExplanation({
    grade: "G5",
    name: "scribe",
    mediaMime: "image/png",
    mediaBytes: 12000,
    hasGame: false,
    anyscribeBytes: 12000,
  });
  assert.match(g5, /G5/);
  assert.match(g5, /AnyScribe/);
  assert.match(g5, /gateway/);
});

test("extract mint addresses from prose, not IPFS CIDs", () => {
  const desc =
    "the sound is on-chain in Bepk57mCZnVYPuE9qUVqFTxScq2yX6gLMjVMWmzS5FUn (token-2022 metadata).";
  assert.deepEqual(extractMintAddresses(desc), [
    "Bepk57mCZnVYPuE9qUVqFTxScq2yX6gLMjVMWmzS5FUn",
  ]);
  const cid =
    "https://ipfs.io/ipfs/bafkreibgxzczdcgi5v2wugf5br7c4qdungvmcykw7yy7ss2ekebki6swsq";
  assert.equal(extractMintAddresses(cid).length, 0);
});

test("image and pool URLs do not count as sidecar mints", () => {
  const image =
    "https://axiomtrading.sfo3.cdn.digitaloceanspaces.com/3jt62QcVQvTu2gCCYFWPBnVNgQ2uv5fVxkSa9hFepump.webp";
  assert.deepEqual(extractMintAddresses(image), []);
  const explorer =
    "see https://solscan.io/token/Bepk57mCZnVYPuE9qUVqFTxScq2yX6gLMjVMWmzS5FUn";
  assert.deepEqual(extractMintAddresses(explorer), [
    "Bepk57mCZnVYPuE9qUVqFTxScq2yX6gLMjVMWmzS5FUn",
  ]);
});

test("linked candidates include extra coin field and description mint", () => {
  const self = "6tRotGypA5QJKwmfgGFe4yp36eNQ4Vz7m8MNNpBnpYmq";
  const nft = "Bepk57mCZnVYPuE9qUVqFTxScq2yX6gLMjVMWmzS5FUn";
  const fromExtra = linkedMintCandidates(
    [{ key: "coin", value: self }],
    {},
    [],
    nft,
  );
  assert.deepEqual(fromExtra, [self]);
  const fromDesc = linkedMintCandidates(
    [],
    { description: `the sound is on-chain in ${nft}` },
    [],
    self,
  );
  assert.deepEqual(fromDesc, [nft]);
  const fromImage = linkedMintCandidates(
    [],
    {
      image:
        "https://axiomtrading.sfo3.cdn.digitaloceanspaces.com/3jt62QcVQvTu2gCCYFWPBnVNgQ2uv5fVxkSa9hFepump.webp",
    },
    [],
    "4MMQY9bwkxxTtsK3W227Q5ABT6yFY8Pmn9Ze7wmAXKY8",
  );
  assert.deepEqual(fromImage, []);
});

test("explicit links are extra fields that are a mint, not URL scrapes", () => {
  const self = "Bepk57mCZnVYPuE9qUVqFTxScq2yX6gLMjVMWmzS5FUn";
  const token = "6tRotGypA5QJKwmfgGFe4yp36eNQ4Vz7m8MNNpBnpYmq";
  assert.deepEqual(
    explicitLinkMints([{ key: "coin", value: token }], {}, self),
    [token],
  );
  assert.deepEqual(
    explicitLinkMints(
      [],
      {
        image:
          "https://axiomtrading.sfo3.cdn.digitaloceanspaces.com/3jt62QcVQvTu2gCCYFWPBnVNgQ2uv5fVxkSa9hFepump.webp",
      },
      "4MMQY9bwkxxTtsK3W227Q5ABT6yFY8Pmn9Ze7wmAXKY8",
    ),
    [],
  );
});

test("Raydium LP names and AMM authorities are liquidity noise", () => {
  assert.equal(looksLikeLpName("Raydium ALLINU-SOL", "ALLINU-SOL"), true);
  assert.equal(looksLikeLpName("Raydium LP Token", "LP"), true);
  assert.equal(looksLikeLpName("bruh", "bruh"), false);
  assert.equal(looksLikeLpName("ALLINU", "ALLINU"), false);
  assert.equal(
    isDexNoise({
      owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      name: "bruh",
      symbol: "bruh",
      mintAuthority: null,
      freezeAuthority: "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
    }),
    true,
  );
  assert.equal(
    isDexNoise({
      owner: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
      name: null,
      symbol: null,
      mintAuthority: null,
      freezeAuthority: null,
    }),
    true,
  );
  assert.equal(
    isDexNoise({
      owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      name: "bruh",
      symbol: "bruh",
      mintAuthority: null,
      freezeAuthority: null,
    }),
    false,
  );
});
