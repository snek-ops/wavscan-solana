import { gunzipSync } from "node:zlib";

type ExtraField = { key: string; value: string };

type MediaHit = {
  field: string;
  src: string;
  mime: string;
  kind: "gif" | "image";
  animated: boolean;
  storage: "on-chain" | "off-chain";
  bytes: number | null;
};

type AudioHit = {
  field: string;
  src: string;
  mime: string;
  storage: "on-chain" | "off-chain";
  bytes: number | null;
};

const MANIFEST_RE = /^chunked:([^;]+);n=(\d+)$/i;
const CODEC_RE = /\+(gzip|br|zstd|deflate)$/i;

export type ChunkedManifest = {
  prefix: string;
  mime: string;
  codec: string | null;
  n: number;
};

export function parseChunkedManifest(
  prefix: string,
  value: string,
): ChunkedManifest | null {
  const match = MANIFEST_RE.exec(value.trim());
  if (!match) return null;
  const n = Number(match[2]);
  if (!Number.isInteger(n) || n < 1 || n > 32) return null;
  let mime = match[1]!.toLowerCase();
  let codec: string | null = null;
  const codecMatch = CODEC_RE.exec(mime);
  if (codecMatch) {
    codec = codecMatch[1]!.toLowerCase();
    mime = mime.slice(0, -codecMatch[0].length);
  }
  if (!/^[a-z0-9]+\/[a-z0-9.+-]+$/.test(mime)) return null;
  return { prefix, mime, codec, n };
}

export function isChunkPartKey(key: string, prefix: string): boolean {
  return new RegExp(`^${escapeRe(prefix)}\\.\\d+$`, "i").test(key);
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extraPairs(pairs: unknown): ExtraField[] {
  if (!Array.isArray(pairs)) return [];
  const out: ExtraField[] = [];
  for (const pair of pairs) {
    if (Array.isArray(pair) && pair.length >= 2) {
      out.push({ key: String(pair[0] ?? ""), value: String(pair[1] ?? "") });
      continue;
    }
    if (pair && typeof pair === "object") {
      const rec = pair as { key?: unknown; value?: unknown };
      if (rec.key != null && rec.value != null) {
        out.push({ key: String(rec.key), value: String(rec.value) });
      }
    }
  }
  return out;
}

function decodedPrefixes(extra: ExtraField[]): Set<string> {
  const names = new Set<string>();
  const { images, audios } = decodeChunkedPacks(extra);
  for (const hit of [...images, ...audios]) {
    names.add(hit.field.replace(/^additionalMetadata\./i, "").toLowerCase());
  }
  return names;
}

/** Drop packed slices from the extras list — those belong in the gallery. */
export function extraForDisplay(fields: ExtraField[]): ExtraField[] {
  const prefixes = decodedPrefixes(fields);
  const out: ExtraField[] = [];
  for (const field of fields) {
    const key = field.key.toLowerCase();
    if (prefixes.has(key)) continue;
    const part = key.match(/^(.+)\.(\d+)$/);
    if (part && prefixes.has(part[1]!)) continue;
    let value = field.value;
    if (value.length > 240) value = `${value.slice(0, 237)}…`;
    out.push({ key: field.key, value });
    if (out.length >= 24) break;
  }
  return out;
}

export function hasChunkedPack(extra: ExtraField[]): boolean {
  return extra.some((field) => parseChunkedManifest(field.key, field.value));
}

function padBase64(value: string): string {
  const clean = value.replace(/\s/g, "");
  const pad = (4 - (clean.length % 4)) % 4;
  return clean + "=".repeat(pad);
}

function toDataUri(mime: string, bytes: Buffer): string {
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

function imageKind(mime: string): MediaHit["kind"] {
  return mime.includes("gif") ? "gif" : "image";
}

function matchesMime(mime: string, bytes: Buffer): boolean {
  if (bytes.length < 4) return false;
  if (mime === "image/jpeg" || mime === "image/jpg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mime === "image/png") {
    return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e;
  }
  if (mime === "image/gif") {
    return bytes.subarray(0, 3).toString("ascii") === "GIF";
  }
  if (mime === "image/webp") {
    return bytes.subarray(0, 4).toString("ascii") === "RIFF";
  }
  if (mime === "image/svg+xml") {
    const head = bytes.subarray(0, 96).toString("utf8").trimStart().toLowerCase();
    return head.startsWith("<svg") || head.startsWith("<?xml");
  }
  if (mime.startsWith("audio/") || mime.startsWith("video/") || mime.startsWith("image/")) {
    return true;
  }
  return false;
}

export function decodeChunkedPacks(extra: ExtraField[]): {
  images: MediaHit[];
  audios: AudioHit[];
} {
  const images: MediaHit[] = [];
  const audios: AudioHit[] = [];
  const byKey = new Map<string, string>();
  for (const field of extra) byKey.set(field.key, field.value);

  for (const field of extra) {
    const manifest = parseChunkedManifest(field.key, field.value);
    if (!manifest) continue;
    const parts: string[] = [];
    let missing = false;
    for (let i = 0; i < manifest.n; i += 1) {
      const part =
        byKey.get(`${manifest.prefix}.${i}`) ??
        byKey.get(`${field.key}.${i}`);
      if (part == null || part.length === 0) {
        missing = true;
        break;
      }
      parts.push(part);
    }
    if (missing) continue;
    let bytes: Buffer;
    try {
      bytes = Buffer.from(padBase64(parts.join("")), "base64");
      if (manifest.codec === "gzip") bytes = gunzipSync(bytes);
    } catch {
      continue;
    }
    if (bytes.length < 8 || bytes.length > 1_500_000) continue;
    if (!matchesMime(manifest.mime, bytes)) continue;
    const src = toDataUri(manifest.mime, bytes);
    if (manifest.mime.startsWith("audio/")) {
      audios.push({
        field: `additionalMetadata.${manifest.prefix}`,
        src,
        mime: manifest.mime,
        storage: "on-chain",
        bytes: bytes.length,
      });
      continue;
    }
    if (manifest.mime.startsWith("image/")) {
      const kind = imageKind(manifest.mime);
      images.push({
        field: `additionalMetadata.${manifest.prefix}`,
        src,
        mime: manifest.mime,
        kind,
        animated: kind === "gif",
        storage: "on-chain",
        bytes: bytes.length,
      });
    }
  }
  return { images, audios };
}
