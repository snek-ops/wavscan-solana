import { dataUriBytes, dataUriMime } from "./detect-audio";
import type { MediaHit } from "./types";
import { ipfsDisplayUrl } from "./ipfs";

const IMAGE_KEYS = new Set([
  "image",
  "image_url",
  "imageurl",
  "icon",
  "animation",
  "animation_url",
  "animationurl",
  "gif",
  "imageuri",
]);

const IMAGE_EXT = /\.(gif|png|jpe?g|webp|svg|avif|bmp)(\?|#|$)/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;

function storageFor(src: string): MediaHit["storage"] {
  return src.startsWith("data:") ? "on-chain" : "off-chain";
}

export function guessImageMime(url: string): string {
  const match = url.match(IMAGE_EXT);
  if (!match) return "image/*";
  const ext = match[1].toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "svg") return "image/svg+xml";
  return `image/${ext}`;
}

export function isGifMime(mime: string): boolean {
  return mime.toLowerCase() === "image/gif" || mime.toLowerCase() === "image/gif;charset=utf-8";
}

export function looksLikeImage(
  value: string,
  key?: string,
): { mime: string; kind: MediaHit["kind"] } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:audio/")) return null;
  if (VIDEO_EXT.test(trimmed)) return null;

  if (trimmed.startsWith("data:image/")) {
    const mime = dataUriMime(trimmed) ?? "image/*";
    const gif = isGifMime(mime) || mime.includes("gif");
    return { mime, kind: gif ? "gif" : "image" };
  }

  if (IMAGE_EXT.test(trimmed) && /^(https?:|ipfs:|ar:|data:)/i.test(trimmed)) {
    const mime = guessImageMime(trimmed);
    return { mime, kind: isGifMime(mime) || /\.gif(\?|#|$)/i.test(trimmed) ? "gif" : "image" };
  }

  const keyNorm = key?.toLowerCase().replace(/[\s_-]/g, "");
  if (keyNorm && IMAGE_KEYS.has(keyNorm)) {
    if (
      trimmed.startsWith("http://") ||
      trimmed.startsWith("https://") ||
      trimmed.startsWith("data:") ||
      trimmed.startsWith("ipfs://") ||
      trimmed.startsWith("ar://")
    ) {
      if (trimmed.startsWith("data:audio")) return null;
      const mime = trimmed.startsWith("data:")
        ? (dataUriMime(trimmed) ?? "image/*")
        : guessImageMime(trimmed);
      const gif =
        keyNorm === "gif" ||
        isGifMime(mime) ||
        /\.gif(\?|#|$)/i.test(trimmed);
      return { mime, kind: gif ? "gif" : "image" };
    }
  }

  return null;
}

function toHit(field: string, src: string, mime: string, kind: MediaHit["kind"]): MediaHit {
  const display = src.startsWith("data:") ? src : ipfsDisplayUrl(src);
  return {
    field,
    src: display,
    mime,
    kind,
    animated: kind === "gif",
    storage: storageFor(src),
    bytes: dataUriBytes(src),
  };
}

function walk(value: unknown, path: string, hits: MediaHit[], depth: number): void {
  if (depth > 8 || hits.length > 12) return;
  if (typeof value === "string") {
    const key = path.split(".").pop();
    const match = looksLikeImage(value, key);
    if (match) hits.push(toHit(path || key || "image", value.trim(), match.mime, match.kind));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, `${path}[${i}]`, hits, depth + 1));
    return;
  }
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    if (typeof rec.uri === "string" && typeof rec.type === "string") {
      if (rec.type.toLowerCase().startsWith("image")) {
        const match = looksLikeImage(rec.uri, "uri") ?? {
          mime: rec.type,
          kind: rec.type.toLowerCase().includes("gif") ? ("gif" as const) : ("image" as const),
        };
        hits.push(toHit(path ? `${path}.uri` : "uri", rec.uri.trim(), match.mime, match.kind));
      }
    }
    for (const [k, v] of Object.entries(rec)) {
      walk(v, path ? `${path}.${k}` : k, hits, depth + 1);
    }
  }
}

export function findImageHits(meta: unknown, extra: MediaHit[] = []): MediaHit[] {
  const hits: MediaHit[] = [...extra];
  walk(meta, "", hits, 0);
  const seen = new Set<string>();
  return hits
    .filter((h) => {
      const key = `${h.field}|${h.src.slice(0, 80)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const rank = (hit: MediaHit) => {
        if (hit.kind === "gif") return -2;
        if (hit.field.includes("animation")) return -1;
        if (hit.field === "image" || hit.field.endsWith(".image")) return 0;
        return 1;
      };
      return rank(a) - rank(b);
    });
}

export function hitsFromImageRaw(raw: string): MediaHit[] {
  const hits: MediaHit[] = [];
  const marker = "data:image/";
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
    const mime = dataUriMime(src) ?? "image/*";
    const gif = mime.includes("gif");
    hits.push(toHit("account-data", src, mime, gif ? "gif" : "image"));
    from = end;
    if (hits.length >= 4) break;
  }
  return hits;
}
