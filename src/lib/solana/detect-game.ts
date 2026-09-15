import { gunzipSync } from "node:zlib";

export const TX_SIG_RE = /[1-9A-HJ-NP-Za-km-z]{86,90}/g;
const TX_SIG_EXACT = /^[1-9A-HJ-NP-Za-km-z]{86,90}$/;
const MINT_EXACT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const MEMO_V1 = "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo";
const MEMO_V2 = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

const SKIP_HOSTS = new Set([
  "x.com",
  "www.x.com",
  "twitter.com",
  "www.twitter.com",
  "t.me",
  "discord.com",
  "discord.gg",
  "pump.fun",
  "www.pump.fun",
  "coincommunities.org",
  "www.coincommunities.org",
  "gateway.pinata.cloud",
  "ipfs.filebase.io",
  "4everland.io",
  "arweave.net",
  "cf-ipfs.com",
  "cloudflare-ipfs.com",
  "nftstorage.link",
  "w3s.link",
]);

const CART_MAX = 80_000;
const PAGE_MAX = 300_000;

export function isTxSignature(value: string): boolean {
  return TX_SIG_EXACT.test(value.trim());
}

export function isMintAddress(value: string): boolean {
  const v = value.trim();
  return MINT_EXACT.test(v) && !isTxSignature(v);
}

export function extractSignatures(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = new RegExp(TX_SIG_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const sig = m[0]!;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(sig);
    if (out.length >= 8) break;
  }
  return out;
}

export function collectMetaStrings(meta: unknown): string[] {
  const out: string[] = [];
  const walk = (value: unknown, depth: number) => {
    if (depth > 6 || out.length > 40) return;
    if (typeof value === "string") {
      if (value.length > 4 && value.length < 400_000) out.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.slice(0, 24).forEach((item) => walk(item, depth + 1));
      return;
    }
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (
          /^(website|twitter|external_url|animation_url|description|uri|image)$/i.test(
            k,
          ) ||
          typeof v === "string"
        ) {
          walk(v, depth + 1);
        }
      }
    }
  };
  walk(meta, 0);
  return out;
}

export type DecodedCart = {
  prefix: string;
  memoBytes: number;
  cartBytes: number;
  source: string;
};

export function decodeOnepageMemo(memo: string): DecodedCart | null {
  const trimmed = memo.trim();
  if (!trimmed) return null;
  let prefix = "";
  let rest = trimmed;
  if (trimmed.startsWith("ONEPAGE.")) {
    prefix = "ONEPAGE.";
    rest = trimmed.slice("ONEPAGE.".length);
  } else if (trimmed.startsWith("ONEPAGE")) {
    prefix = "ONEPAGE";
    rest = trimmed.slice("ONEPAGE".length);
  } else {
    return null;
  }
  rest = rest.replace(/\s/g, "");
  if (!rest) return null;
  let gz: Buffer;
  try {
    gz = Buffer.from(rest, "base64");
  } catch {
    return null;
  }
  if (gz.length < 10 || gz[0] !== 0x1f || gz[1] !== 0x8b) return null;
  let source: string;
  try {
    source = gunzipSync(gz).toString("utf8");
  } catch {
    return null;
  }
  if (!source || source.length > CART_MAX) return null;
  if (!/\bboot\b/.test(source)) return null;
  return {
    prefix,
    memoBytes: trimmed.length,
    cartBytes: source.length,
    source,
  };
}

type RpcIx = {
  program?: string;
  programId?: string;
  parsed?: unknown;
  data?: unknown;
};

export function memosFromParsedTx(tx: unknown): string[] {
  const out: string[] = [];
  const rec = tx as {
    transaction?: { message?: { instructions?: RpcIx[] } };
    meta?: { logMessages?: string[]; innerInstructions?: Array<{ instructions?: RpcIx[] }> };
  };
  const ixs = [
    ...(rec.transaction?.message?.instructions ?? []),
    ...(rec.meta?.innerInstructions ?? []).flatMap((g) => g.instructions ?? []),
  ];
  for (const ix of ixs) {
    const programId = ix.programId ?? "";
    const isMemo =
      ix.program === "spl-memo" || programId === MEMO_V1 || programId === MEMO_V2;
    const parsed = ix.parsed;
    if (typeof parsed === "string" && parsed) {
      if (isMemo || parsed.startsWith("ONEPAGE")) out.push(parsed);
      continue;
    }
    if (parsed && typeof parsed === "object") {
      const info = parsed as { type?: string; info?: unknown; memo?: unknown };
      if (typeof info.memo === "string") out.push(info.memo);
      if (typeof info.info === "string") out.push(info.info);
      if (info.info && typeof info.info === "object" && "memo" in info.info) {
        const m = (info.info as { memo?: unknown }).memo;
        if (typeof m === "string") out.push(m);
      }
    }
  }
  for (const log of rec.meta?.logMessages ?? []) {
    const match = log.match(/Memo \(len \d+\): "([\s\S]*)"$/);
    if (match?.[1]) out.push(match[1]);
  }
  return out;
}

export function skipHarvestHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (SKIP_HOSTS.has(host)) return true;
    if (host.endsWith(".ipfs.io") || host.includes("ipfs.")) return true;
    if (host.endsWith(".pinata.cloud")) return true;
    if (host.endsWith(".arweave.net")) return true;
    return false;
  } catch {
    return true;
  }
}

export function pageScriptUrls(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let origin: string;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return [];
  }
  const re =
    /<(?:script|link)[^>]+(?:src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1]!;
    if (!/\.m?js(\?|#|$)/i.test(href) && !m[0].toLowerCase().includes("script")) {
      continue;
    }
    if (!/\.m?js(\?|#|$)/i.test(href)) continue;
    try {
      const abs = new URL(href, pageUrl);
      if (abs.origin !== origin) continue;
      if (seen.has(abs.href)) continue;
      seen.add(abs.href);
      out.push(abs.href);
      if (out.length >= 2) break;
    } catch {
      /* skip */
    }
  }
  return out;
}

export async function harvestPageSignatures(
  pageUrl: string,
  fetchText: (url: string, maxBytes: number) => Promise<string | null>,
): Promise<string[]> {
  if (skipHarvestHost(pageUrl)) return [];
  const html = await fetchText(pageUrl, PAGE_MAX);
  if (!html) return [];
  const found = new Set(extractSignatures(html));
  if (found.size > 0) return [...found];
  for (const src of pageScriptUrls(html, pageUrl)) {
    const js = await fetchText(src, PAGE_MAX);
    if (!js) continue;
    for (const sig of extractSignatures(js)) found.add(sig);
    if (found.size >= 4) break;
  }
  return [...found];
}
