import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { test } from "node:test";
import {
  decodeChunkedPacks,
  extraForDisplay,
  extraPairs,
  hasChunkedPack,
  parseChunkedManifest,
} from "./chunked.ts";

const MINI_JPEG = Buffer.from(
  "ffd8ffe000104a46494600010100000100010000ffd9",
  "hex",
);

test("parse chunked manifest", () => {
  assert.deepEqual(parseChunkedManifest("image", "chunked:image/jpeg+gzip;n=7"), {
    prefix: "image",
    mime: "image/jpeg",
    codec: "gzip",
    n: 7,
  });
  assert.deepEqual(
    parseChunkedManifest("image", "chunked:image/svg+xml+gzip;n=3"),
    {
      prefix: "image",
      mime: "image/svg+xml",
      codec: "gzip",
      n: 3,
    },
  );
  assert.equal(parseChunkedManifest("image", "https://ipfs.io/x"), null);
});

test("display extras hide packed slices after a successful decode", () => {
  const packed = gzipSync(MINI_JPEG).toString("base64");
  const mid = Math.ceil(packed.length / 2);
  const fields = extraPairs([
    ["token", "4MMQY9bwkxxTtsK3W227Q5ABT6yFY8Pmn9Ze7wmAXKY8"],
    ["image", "chunked:image/jpeg+gzip;n=2"],
    ["image.0", packed.slice(0, mid)],
    ["image.1", packed.slice(mid)],
  ]);
  const shown = extraForDisplay(fields);
  assert.deepEqual(
    shown.map((f) => f.key),
    ["token"],
  );
  assert.equal(hasChunkedPack(fields), true);
});

test("display extras keep slices if the pack cannot be decoded", () => {
  const fields = extraPairs([
    ["token", "4MMQY9bwkxxTtsK3W227Q5ABT6yFY8Pmn9Ze7wmAXKY8"],
    ["image", "chunked:image/jpeg+gzip;n=2"],
    ["image.0", "H4sIAAAA"],
  ]);
  const shown = extraForDisplay(fields);
  assert.deepEqual(
    shown.map((f) => f.key),
    ["token", "image", "image.0"],
  );
});

test("decode gzip jpeg slices into one on-mint image", () => {
  const packed = gzipSync(MINI_JPEG).toString("base64");
  const mid = Math.ceil(packed.length / 2);
  const hits = decodeChunkedPacks([
    { key: "image", value: "chunked:image/jpeg+gzip;n=2" },
    { key: "image.0", value: packed.slice(0, mid) },
    { key: "image.1", value: packed.slice(mid) },
  ]);
  assert.equal(hits.images.length, 1);
  assert.equal(hits.audios.length, 0);
  const image = hits.images[0]!;
  assert.equal(image.mime, "image/jpeg");
  assert.equal(image.storage, "on-chain");
  assert.equal(image.bytes, MINI_JPEG.length);
  assert.match(image.src, /^data:image\/jpeg;base64,/);
  const body = image.src.split(",")[1]!;
  assert.deepEqual(Buffer.from(body, "base64"), MINI_JPEG);
});

const MINI_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

test("assemble animation.N gif slices without a chunked manifest", () => {
  const packed = MINI_GIF.toString("base64");
  const mid = Math.ceil(packed.length / 2);
  const fields = extraPairs([
    ["image", "data:image/webp;base64,AAAA"],
    ["animation.0", packed.slice(0, mid)],
    ["animation.1", packed.slice(mid)],
  ]);
  const hits = decodeChunkedPacks(fields);
  assert.equal(hits.images.length, 1);
  const gif = hits.images[0]!;
  assert.equal(gif.mime, "image/gif");
  assert.equal(gif.kind, "gif");
  assert.equal(gif.animated, true);
  assert.equal(gif.storage, "on-chain");
  assert.equal(gif.bytes, MINI_GIF.length);
  assert.deepEqual(
    extraForDisplay(fields).map((f) => f.key),
    ["image"],
  );
});

