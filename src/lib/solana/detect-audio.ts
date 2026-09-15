import type { AudioHit } from "./types";

const AUDIO_KEYS = new Set([
  "sound",
  "audio",
  "audio_url",
  "audiourl",
  "audioUri",
  "audiouri",
  "wav",
  "music",
  "theme",
  "theme_song",
  "themesong",
]);

const AUDIO_EXT = /\.(wav|wave|mp3|ogg|oga|m4a|aac|flac|weba)(\?|#|$)/i;

export function dataUriMime(uri: string): string | null {
  if (!uri.startsWith("data:")) return null;
  const comma = uri.indexOf(",");
  if (comma < 0) return null;
  const header = uri.slice(5, comma);
  const mime = header.split(";")[0]?.trim();
  return mime || null;
}

export function dataUriBytes(uri: string): number | null {
  if (!uri.startsWith("data:")) return null;
  const comma = uri.indexOf(",");
  if (comma < 0) return null;
  const header = uri.slice(0, comma);
  const payload = uri.slice(comma + 1);
  if (header.includes(";base64")) {
    const clean = payload.replace(/\s/g, "");
    const pad = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((clean.length * 3) / 4) - pad);
  }
  try {
    return new TextEncoder().encode(decodeURIComponent(payload)).length;
  } catch {
    return payload.length;
  }
}

export function guessMimeFromUrl(url: string): string {
  const match = url.match(AUDIO_EXT);
  if (!match) return "audio/*";
  const ext = match[1].toLowerCase();
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "wav" || ext === "wave") return "audio/wav";
  if (ext === "oga") return "audio/ogg";
  if (ext === "weba") return "audio/webm";
  return `audio/${ext}`;
}

export function looksLikeAudio(
  value: string,
  key?: string,
): { mime: string } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("data:audio/")) {
    return { mime: dataUriMime(trimmed) ?? "audio/*" };
  }

  if (AUDIO_EXT.test(trimmed) && /^(https?:|ipfs:|ar:|data:)/i.test(trimmed)) {
    return { mime: guessMimeFromUrl(trimmed) };
  }

  const keyNorm = key?.toLowerCase().replace(/[\s_-]/g, "");
  if (keyNorm && AUDIO_KEYS.has(keyNorm)) {
    if (
      trimmed.startsWith("http://") ||
      trimmed.startsWith("https://") ||
      trimmed.startsWith("data:") ||
      trimmed.startsWith("ipfs://") ||
      trimmed.startsWith("ar://")
    ) {
      if (trimmed.startsWith("data:image")) return null;
      if (/\.(mp4|webm|mov|gif|png|jpg|jpeg|svg|webp)(\?|#|$)/i.test(trimmed)) {
        return null;
      }
      return { mime: guessMimeFromUrl(trimmed) };
    }
  }

  return null;
}

function storageFor(src: string): AudioHit["storage"] {
  return src.startsWith("data:") ? "on-chain" : "off-chain";
}

function toHit(field: string, src: string, mime: string): AudioHit {
  return {
    field,
    src,
    mime,
    storage: storageFor(src),
    bytes: dataUriBytes(src),
  };
}

type WalkHit = AudioHit;

function walk(
  value: unknown,
  path: string,
  hits: WalkHit[],
  depth: number,
): void {
  if (depth > 8 || hits.length > 12) return;
  if (typeof value === "string") {
    const key = path.split(".").pop();
    const match = looksLikeAudio(value, key);
    if (match) hits.push(toHit(path || key || "uri", value.trim(), match.mime));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, `${path}[${i}]`, hits, depth + 1));
    return;
  }
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    if (typeof rec.uri === "string" && typeof rec.type === "string") {
      if (rec.type.toLowerCase().startsWith("audio")) {
        const match = looksLikeAudio(rec.uri, "uri") ?? {
          mime: rec.type,
        };
        hits.push(toHit(path ? `${path}.uri` : "uri", rec.uri.trim(), match.mime));
      }
    }
    for (const [k, v] of Object.entries(rec)) {
      const next = path ? `${path}.${k}` : k;
      walk(v, next, hits, depth + 1);
    }
  }
}

export function findAudioHits(meta: unknown, extra: WalkHit[] = []): AudioHit[] {
  const hits: WalkHit[] = [...extra];
  walk(meta, "", hits, 0);
  const seen = new Set<string>();
  return hits.filter((h) => {
    const key = `${h.field}|${h.src.slice(0, 80)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parseDataJson(uri: string): unknown | null {
  if (!uri.startsWith("data:")) return null;
  const comma = uri.indexOf(",");
  if (comma < 0) return null;
  const header = uri.slice(0, comma);
  const payload = uri.slice(comma + 1);
  let text: string;
  try {
    if (header.includes(";base64")) {
      if (typeof atob === "function") {
        text = atob(payload);
      } else {
        text = Buffer.from(payload, "base64").toString("utf8");
      }
    } else {
      try {
        text = decodeURIComponent(payload);
      } catch {
        text = payload;
      }
    }
    return JSON.parse(text);
  } catch {
    try {
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }
}

export function uriKind(uri: string | null): "data" | "http" | "other" | null {
  if (!uri) return null;
  if (uri.startsWith("data:")) return "data";
  if (/^(https?:|ipfs:|ar:)/i.test(uri)) return "http";
  return "other";
}
