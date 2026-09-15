import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gradeScan } from "./grade.ts";
import type { ExtraField, TokenScan } from "./types.ts";

function base(over: Partial<TokenScan> = {}): TokenScan {
  return {
    mint: "So11111111111111111111111111111111111111112",
    exists: true,
    program: "token-2022",
    name: "Test",
    symbol: "TST",
    image: null,
    uri: null,
    uriKind: null,
    accountSpace: 400,
    additionalMetadata: [],
    audio: null,
    media: null,
    extraAudioCount: 0,
    error: null,
    totalScans: null,
    grade: null,
    gradeLabel: null,
    gradeReasons: [],
    claimMismatch: false,
    packedMint: null,
    ...over,
  };
}

describe("gradeScan", () => {
  it("G4 for data:image on the mint URI", () => {
    const out = gradeScan(
      base({
        uri: "data:image/jpeg;base64,/9j/4AAQ",
        uriKind: "data",
        media: {
          field: "uri",
          src: "data:image/jpeg;base64,/9j/4AAQ",
          mime: "image/jpeg",
          kind: "image",
          animated: false,
          storage: "on-chain",
          bytes: 12,
        },
      }),
    );
    assert.equal(out.grade, "G4");
    assert.equal(out.label, "on-mint file");
    assert.equal(out.claimMismatch, false);
  });

  it("G4 for data:json that embeds data:audio", () => {
    const out = gradeScan(
      base({
        name: "bruh",
        uri: 'data:application/json,{"image":"data:image/svg+xml,x","sound":"data:audio/wav;base64,UklG"}',
        uriKind: "data",
        audio: {
          field: "sound",
          src: "data:audio/wav;base64,UklG",
          mime: "audio/wav",
          storage: "on-chain",
          bytes: 3,
        },
      }),
    );
    assert.equal(out.grade, "G4");
  });

  it("G1 for data:json that only points at https images", () => {
    const out = gradeScan(
      base({
        uri: 'data:application/json,{"image":"https://ipfs.io/ipfs/QmX"}',
        uriKind: "data",
        media: {
          field: "image",
          src: "https://ipfs.io/ipfs/QmX",
          mime: "image/png",
          kind: "image",
          animated: false,
          storage: "off-chain",
          bytes: null,
        },
      }),
    );
    assert.equal(out.grade, "G1");
  });

  it("G1 for ordinary IPFS Token-2022", () => {
    const out = gradeScan(
      base({
        uri: "https://ipfs.io/ipfs/bafyexample",
        uriKind: "http",
      }),
    );
    assert.equal(out.grade, "G1");
    assert.match(out.label, /off-chain file/);
  });

  it("G3 when a companion mint is packed", () => {
    const extras: ExtraField[] = [{ key: "token", value: "A9AHYxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxpump" }];
    const out = gradeScan(
      base({
        uri: "https://ipfs.io/ipfs/QmCat",
        uriKind: "http",
        additionalMetadata: extras,
        name: "HUHCAT inscribed in a coin",
      }),
      { packedMint: "DVD4qCompanionMint111111111111111111111111" },
    );
    assert.equal(out.grade, "G3");
    assert.equal(out.claimMismatch, false);
    assert.equal(out.packedMint, "DVD4qCompanionMint111111111111111111111111");
  });

  it("G2 for memo cart when mint URI is IPFS", () => {
    const out = gradeScan(
      base({
        name: "onepage.surf",
        symbol: "onepage",
        uri: "https://ipfs.io/ipfs/bafkreiaytt63uwzxagat22ncg34lk2gncryglsxizqgvch2m5glhfyc4nq",
        uriKind: "http",
      }),
      {
        artifacts: [
          {
            kind: "memo",
            prefix: "ONEPAGE",
            signature: "67ALt4vVZHcUQcw9Mu9AvUhceuL3dbrRDpUcAc9E39N4",
          },
        ],
      },
    );
    assert.equal(out.grade, "G2");
    assert.equal(out.claimMismatch, false);
  });

  it("flags claim mismatch on G1 inscribed copy", () => {
    const out = gradeScan(
      base({
        name: "Inscribed JPEG in the coin",
        uri: "https://ipfs.io/ipfs/QmFake",
        uriKind: "http",
      }),
    );
    assert.equal(out.grade, "G1");
    assert.equal(out.claimMismatch, true);
  });

  it("G0 when there is no URI and no packed bytes", () => {
    const out = gradeScan(
      base({
        name: null,
        symbol: null,
        uri: null,
        uriKind: null,
        program: "unknown",
      }),
    );
    assert.equal(out.grade, "G0");
  });
});
