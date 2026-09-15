import { PublicKey } from "@solana/web3.js";
import {
  looksLikeAudio,
  dataUriMime,
} from "./detect-audio";
import {
  isGifMime,
  looksLikeImage,
} from "./detect-image";
import { ipfsCandidates, ipfsDisplayUrl } from "./ipfs";
import type { AudioHit, ExtraField, MediaHit } from "./types";

export const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const TOKEN_KLEGG = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const METADATA_PROGRAM = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

export function metaplexPda(mint: string): string {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      METADATA_PROGRAM.toBuffer(),
      new PublicKey(mint).toBuffer(),
    ],
    METADATA_PROGRAM,
  );
  return pda.toBase58();
}

export function readBorshString(buf: Buffer, offset: number): [string, number] {
  if (offset + 4 > buf.length) return ["", offset];
  const len = buf.readUInt32LE(offset);
  if (len > 2048 || offset + 4 + len > buf.length) return ["", offset];
  const raw = buf.subarray(offset + 4, offset + 4 + len).toString("utf8");
  return [raw.replace(/\0/g, "").trim(), offset + 4 + len];
}

export function parseMetaplex(dataBase64: string): {
  name: string;
  symbol: string;
  uri: string;
} | null {
  try {
    const buf = Buffer.from(dataBase64, "base64");
    if (buf.length < 70) return null;
    let offset = 1 + 32 + 32;
    const [name, o1] = readBorshString(buf, offset);
    const [symbol, o2] = readBorshString(buf, o1);
    const [uri] = readBorshString(buf, o2);
    if (!name && !uri) return null;
    return { name, symbol, uri };
  } catch {
    return null;
  }
}

export function rewriteGateway(url: string): string {
  if (url.startsWith("ipfs://")) return ipfsDisplayUrl(url);
  if (url.startsWith("ar://")) {
    return `https://arweave.net/${url.slice("ar://".length)}`;
  }
  return ipfsDisplayUrl(url);
}

export async function fetchJson(uri: string): Promise<unknown | null> {
  const urls = ipfsCandidates(rewriteGateway(uri));
  for (const url of urls) {
    if (!url.startsWith("http://") && !url.startsWith("https://")) continue;
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json, text/plain, */*" },
        signal: AbortSignal.timeout(10_000),
        redirect: "follow",
      });
      if (!res.ok) continue;
      const len = Number(res.headers.get("content-length") ?? "0");
      if (len > 2_000_000) continue;
      const text = await res.text();
      if (text.length > 2_000_000) continue;
      try {
        return JSON.parse(text);
      } catch {
        continue;
      }
    } catch {
      continue;
    }
  }
  return null;
}

export function extraFromPairs(pairs: unknown): ExtraField[] {
  if (!Array.isArray(pairs)) return [];
  const out: ExtraField[] = [];
  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const key = String(pair[0] ?? "");
    let value = String(pair[1] ?? "");
    if (value.length > 240) value = `${value.slice(0, 237)}…`;
    out.push({ key, value });
    if (out.length >= 24) break;
  }
  return out;
}

export function audioHitsFromPairs(pairs: unknown): AudioHit[] {
  if (!Array.isArray(pairs)) return [];
  const hits: AudioHit[] = [];
  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const key = String(pair[0] ?? "");
    const value = String(pair[1] ?? "");
    const match = looksLikeAudio(value, key);
    if (match) {
      hits.push({
        field: `additionalMetadata.${key}`,
        src: value.trim(),
        mime: match.mime,
        storage: value.startsWith("data:") ? "on-chain" : "off-chain",
        bytes: value.startsWith("data:")
          ? Math.max(0, Math.floor(((value.split(",")[1] ?? "").length * 3) / 4))
          : null,
      });
    }
  }
  return hits;
}

export function imageHitsFromPairs(pairs: unknown): MediaHit[] {
  if (!Array.isArray(pairs)) return [];
  const hits: MediaHit[] = [];
  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const key = String(pair[0] ?? "");
    const value = String(pair[1] ?? "");
    const match = looksLikeImage(value, key);
    if (match) {
      hits.push({
        field: `additionalMetadata.${key}`,
        src: value.startsWith("data:") ? value.trim() : ipfsDisplayUrl(value.trim()),
        mime: match.mime,
        kind: match.kind,
        animated: match.kind === "gif",
        storage: value.startsWith("data:") ? "on-chain" : "off-chain",
        bytes: value.startsWith("data:")
          ? Math.max(0, Math.floor(((value.split(",")[1] ?? "").length * 3) / 4))
          : null,
      });
    }
  }
  return hits;
}

export function audioHitsFromRawUtf8(raw: string): AudioHit[] {
  const hits: AudioHit[] = [];
  const marker = "data:audio/";
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
    const mime = dataUriMime(src) ?? "audio/*";
    hits.push({
      field: "account-data",
      src,
      mime,
      storage: "on-chain",
      bytes: Math.max(0, Math.floor(((src.split(",")[1] ?? "").length * 3) / 4)),
    });
    from = end;
    if (hits.length >= 4) break;
  }
  return hits;
}

export function pickName(meta: unknown, fallback: string | null): string | null {
  if (meta && typeof meta === "object" && "name" in meta) {
    const n = (meta as { name?: unknown }).name;
    if (typeof n === "string" && n.trim()) return n.trim();
  }
  return fallback;
}

export function pickSymbol(meta: unknown, fallback: string | null): string | null {
  if (meta && typeof meta === "object" && "symbol" in meta) {
    const n = (meta as { symbol?: unknown }).symbol;
    if (typeof n === "string" && n.trim()) return n.trim();
  }
  return fallback;
}

export function pickImage(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") return null;
  const rec = meta as Record<string, unknown>;
  for (const key of ["image", "image_url", "icon", "animation_url"]) {
    if (typeof rec[key] === "string" && rec[key]) {
      return ipfsDisplayUrl(rec[key] as string);
    }
  }
  return null;
}

export function gifMagic(bytes: Uint8Array): boolean {
  if (bytes.length < 6) return false;
  const tag = String.fromCharCode(
    bytes[0]!,
    bytes[1]!,
    bytes[2]!,
    bytes[3]!,
    bytes[4]!,
    bytes[5]!,
  );
  return tag === "GIF87a" || tag === "GIF89a";
}

export async function sniffRemote(hit: MediaHit): Promise<MediaHit> {
  if (hit.src.startsWith("data:")) return hit;
  const urls = ipfsCandidates(hit.src);
  for (const url of urls) {
    try {
      const head = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(8_000),
        redirect: "follow",
      });
      if (head.ok) {
        const mime = (head.headers.get("content-type") ?? hit.mime)
          .split(";")[0]
          ?.trim()
          .toLowerCase() || hit.mime;
        const len = head.headers.get("content-length");
        const bytes = len && /^\d+$/.test(len) ? Number(len) : hit.bytes;
        const gif = isGifMime(mime) || hit.kind === "gif";
        if (mime.startsWith("image/") || gif) {
          return {
            ...hit,
            src: url,
            mime: gif ? "image/gif" : mime,
            kind: gif ? "gif" : "image",
            animated: gif,
            bytes,
          };
        }
      }
    } catch {
      /* try GET range */
    }
    try {
      const res = await fetch(url, {
        headers: { Range: "bytes=0-15", accept: "image/*,*/*" },
        signal: AbortSignal.timeout(8_000),
        redirect: "follow",
      });
      if (!res.ok && res.status !== 206) continue;
      const mime = (res.headers.get("content-type") ?? hit.mime)
        .split(";")[0]
        ?.trim()
        .toLowerCase() || hit.mime;
      const lenHeader = res.headers.get("content-length");
      let bytes = hit.bytes;
      if (lenHeader && /^\d+$/.test(lenHeader) && Number(lenHeader) > 64) {
        bytes = Number(lenHeader);
      }
      const range = res.headers.get("content-range");
      if (range) {
        const total = range.split("/")[1];
        if (total && total !== "*" && /^\d+$/.test(total)) bytes = Number(total);
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      const gif = isGifMime(mime) || gifMagic(buf) || hit.kind === "gif";
      return {
        ...hit,
        src: url,
        mime: gif ? "image/gif" : mime || hit.mime,
        kind: gif ? "gif" : "image",
        animated: gif,
        bytes,
      };
    } catch {
      continue;
    }
  }
  return { ...hit, src: ipfsDisplayUrl(hit.src) };
}
