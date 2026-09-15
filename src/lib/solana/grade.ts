import { parseDataJson, uriKind } from "./detect-audio.ts";

export type Grade = "G0" | "G1" | "G2" | "G3" | "G4" | "G5";

export const GRADES: Grade[] = ["G0", "G1", "G2", "G3", "G4", "G5"];

export function isGrade(value: string | null | undefined): value is Grade {
  return GRADES.includes(value as Grade);
}

/** Visual tone for the grade number. Dim = off-chain. Bright = inscribed. */
export const GRADE_TONE: Record<
  Grade,
  "faint" | "muted" | "warn" | "accent" | "ok" | "fg"
> = {
  G0: "faint",
  G1: "muted",
  G2: "warn",
  G3: "accent",
  G4: "ok",
  G5: "fg",
};

export type ScanFlags = {
  txVersionCreate: number | string | null;
  mutable: boolean;
  claimMismatch: boolean;
  packedMint: string | null;
};

export type GradeInfo = {
  grade: Grade;
  label: string;
  walletImage: string;
  inscribed: boolean;
  explanation: string;
};

export const GRADE_META: Record<
  Grade,
  { label: string; walletImage: string; inscribed: boolean; short: string }
> = {
  G0: {
    label: "Off-chain file",
    walletImage: "Remote",
    inscribed: false,
    short: "No usable pointer and no packed bytes. Typical HTTP/IPFS/Arweave fetch.",
  },
  G1: {
    label: "On-chain metadata, off-chain file",
    walletImage: "Remote",
    inscribed: false,
    short: "Name, symbol, and uri sit on the mint. The uri is still HTTP, IPFS, or Arweave.",
  },
  G2: {
    label: "Ledger-packed artifact",
    walletImage: "No",
    inscribed: false,
    short: "Bytes in a memo or instruction of a confirmed tx, not copied into the mint.",
  },
  G3: {
    label: "Inscription on linked mint",
    walletImage: "Only if you follow the companion",
    inscribed: false,
    short: "This CA’s URI is HTTP/IPFS. A companion mint holds the packed data: file.",
  },
  G4: {
    label: "On-mint file",
    walletImage: "If the wallet decodes data:",
    inscribed: true,
    short: "This mint’s uri or additionalMetadata is a data: URI. Rent pays for a couple of KB.",
  },
  G5: {
    label: "Fully on-chain file",
    walletImage: "Gateway is a reader only",
    inscribed: true,
    short:
      "AnyScribe program account (Fn7ASHW…) with ANYSCRIB header, published, mint-bound. HTTP is a gateway onto RPC dataSlice, not the store.",
  },
};

const CLAIM_RE =
  /inscrib|on-?chain (image|file|photo|wav|audio|program|game|bytes)|in(side)? the coin|in a coin|4\s*k[b]? game|4096.byte|forever on-chain|bytes (are )?the program/i;

const COMPANION_KEYS = new Set(["token", "ca", "pump", "packed"]);

function isMintAddress(value: string): boolean {
  const v = value.trim();
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v) && !/^[1-9A-HJ-NP-Za-km-z]{86,90}$/.test(v);
}

const MINT_IN_TEXT_RE = /(?:^|[^1-9A-HJ-NP-Za-km-z])([1-9A-HJ-NP-Za-km-z]{32,44})(?![1-9A-HJ-NP-Za-km-z])/g;

const URL_RE = /\b(?:https?|ipfs|ar):\/\/[^\s"'<>]+/gi;
const EXPLORER_MINT_RE =
  /\/(?:token|account|address|mint)\/([1-9A-HJ-NP-Za-km-z]{32,44})/i;
const FILE_EXT_AFTER =
  /^\.(webp|png|jpe?g|gif|svg|avif|bmp|mp3|wav|mp4|webm|json)(\?|#|$)/i;

/** Programs / wrapped SOL / well-known accounts that are never sidecar mints. */
export const NOT_LINK_MINTS = new Set([
  "11111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
  "ComputeBudget111111111111111111111111111111",
  "So11111111111111111111111111111111111111112",
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo",
]);

/** AMM / launchpad / pool programs. Their accounts are not sidecar NFTs. */
export const DEX_PROGRAM_IDS = new Set([
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
  "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
  "5quBtoiQqxF9Jv6KYKctB59NT3gtJD2Y65kdnB1Uev3h",
  "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj",
  "routeUGWgNLdP4YMzuN92RHQ4FCrv4dP5UKHtAKj2bx",
  "EhhTKczWMGQt46ynNeRX1WfeagwwJd7ufHvCDjRxjo5Q",
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
  "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
  "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB",
  "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",
  "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
]);

/** Freeze / mint authorities used by Raydium LP mints. */
export const DEX_AUTHORITIES = new Set([
  "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
  "GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL",
]);

function stripLinkUrls(text: string): string {
  return text.replace(URL_RE, (url) => {
    const hit = url.match(EXPLORER_MINT_RE);
    return hit?.[1] ? ` ${hit[1]} ` : " ";
  });
}

/** Pull standalone Solana addresses out of prose, not substrings of IPFS CIDs or image URLs. */
export function extractMintAddresses(text: string): string[] {
  const out: string[] = [];
  const source = stripLinkUrls(text);
  const re = new RegExp(MINT_IN_TEXT_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const value = match[1]!;
    const mintStart = match.index + match[0].length - value.length;
    const after = source.slice(mintStart + value.length);
    if (FILE_EXT_AFTER.test(after)) continue;
    if (!isMintAddress(value) || out.includes(value)) continue;
    if (NOT_LINK_MINTS.has(value)) continue;
    out.push(value);
    if (out.length >= 8) break;
  }
  return out;
}

export function looksLikeLpName(
  name: string | null | undefined,
  symbol: string | null | undefined,
): boolean {
  const blob = `${name ?? ""} ${symbol ?? ""}`.toLowerCase();
  if (!blob.trim()) return false;
  if (blob.includes("raydium")) return true;
  if (blob.includes("lp token")) return true;
  if (/\b(clmm|cpmm|dlmm|whirlpool)\b/.test(blob)) return true;
  if (/\b(meteora|orca)\b/.test(blob) && /\blp\b/.test(blob)) return true;
  if (/\blp\b/.test(blob) && /\b(sol|wsol|usdc|usdt|ray)\b/.test(blob)) return true;
  if (blob.includes("position nft") || blob.includes("position-nft")) return true;
  return false;
}

export function isDexNoise(input: {
  owner: string;
  name: string | null;
  symbol: string | null;
  mintAuthority: string | null;
  freezeAuthority: string | null;
}): boolean {
  if (DEX_PROGRAM_IDS.has(input.owner)) return true;
  if (input.mintAuthority && DEX_AUTHORITIES.has(input.mintAuthority)) return true;
  if (input.freezeAuthority && DEX_AUTHORITIES.has(input.freezeAuthority)) {
    return true;
  }
  if (looksLikeLpName(input.name, input.symbol)) return true;
  return false;
}

export function looksLikeClaim(text: string | null | undefined): boolean {
  if (!text) return false;
  return CLAIM_RE.test(text);
}

export function collectClaimText(
  name: string | null,
  extra: Array<{ key: string; value: string }>,
  meta: unknown,
): string {
  const parts: string[] = [];
  if (name) parts.push(name);
  for (const f of extra) parts.push(`${f.key} ${f.value}`);
  const walk = (value: unknown, depth: number) => {
    if (depth > 4 || parts.length > 40) return;
    if (typeof value === "string") {
      if (value.length > 8 && value.length < 8_000) parts.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.slice(0, 12).forEach((item) => walk(item, depth + 1));
      return;
    }
    if (value && typeof value === "object") {
      for (const v of Object.values(value as Record<string, unknown>)) {
        walk(v, depth + 1);
      }
    }
  };
  walk(meta, 0);
  return parts.join("\n");
}

function isDataMedia(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v.startsWith("data:")) return false;
  if (v.startsWith("data:image/")) return true;
  if (v.startsWith("data:audio/")) return true;
  if (v.startsWith("data:video/")) return true;
  if (v.startsWith("data:application/octet")) return true;
  return false;
}

function jsonHoldsDataMedia(value: unknown, depth: number): boolean {
  if (depth > 6) return false;
  if (typeof value === "string") {
    if (isDataMedia(value)) return true;
    if (value.trimStart().startsWith("{") || value.trimStart().startsWith("[")) {
      try {
        return jsonHoldsDataMedia(JSON.parse(value), depth + 1);
      } catch {
        return false;
      }
    }
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => jsonHoldsDataMedia(item, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((v) =>
      jsonHoldsDataMedia(v, depth + 1),
    );
  }
  return false;
}

/** G4 needs a real media blob. A data:application/json of https links is G1. */
export function hasOnMintFile(
  uri: string | null,
  extra: Array<{ key: string; value: string }>,
): boolean {
  const values = [uri ?? "", ...extra.map((f) => f.value)];
  for (const raw of values) {
    const v = raw.trim();
    if (!v.startsWith("data:")) continue;
    if (isDataMedia(v)) return true;
    if (v.toLowerCase().startsWith("data:application/json") || v.startsWith("data:text/")) {
      const parsed = parseDataJson(v);
      if (jsonHoldsDataMedia(parsed ?? v, 0)) return true;
    }
  }
  return false;
}

export function pointerMints(
  extra: Array<{ key: string; value: string }>,
  meta: unknown,
  self: string,
): string[] {
  const out: string[] = [];
  const add = (value: string) => {
    const v = value.trim();
    if (!isMintAddress(v) || v === self) return;
    if (NOT_LINK_MINTS.has(v)) return;
    if (!out.includes(v)) out.push(v);
  };
  for (const f of extra) {
    if (COMPANION_KEYS.has(f.key.toLowerCase().replace(/[\s_-]/g, ""))) add(f.value);
  }
  if (meta && typeof meta === "object") {
    for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
      if (typeof v === "string" && COMPANION_KEYS.has(k.toLowerCase())) add(v);
    }
  }
  return out;
}

/** Extra fields whose whole value is a mint — not a URL with a mint buried in it. */
export function explicitLinkMints(
  extra: Array<{ key: string; value: string }>,
  meta: unknown,
  self: string,
): string[] {
  const out = pointerMints(extra, meta, self);
  const add = (value: string) => {
    const v = value.trim();
    if (!isMintAddress(v) || v === self || NOT_LINK_MINTS.has(v)) return;
    if (!out.includes(v)) out.push(v);
  };
  for (const field of extra) add(field.value);
  return out;
}

export function linkedMintCandidates(
  extra: Array<{ key: string; value: string }>,
  meta: unknown,
  texts: string[],
  self: string,
): string[] {
  const out: string[] = [];
  const add = (value: string) => {
    for (const mint of extractMintAddresses(value)) {
      if (mint === self || out.includes(mint)) continue;
      out.push(mint);
    }
  };
  for (const field of extra) add(field.value);
  for (const text of texts) add(text);
  if (meta && typeof meta === "object") {
    for (const value of Object.values(meta as Record<string, unknown>)) {
      if (typeof value === "string") add(value);
    }
  }
  return out.slice(0, 5);
}

export function companionSeed(mint: string): string {
  return (`img:${mint}`).slice(0, 32);
}

export function decidePrimaryGrade(input: {
  exists: boolean;
  uri: string | null;
  onMintFile: boolean;
  packedHasFile: boolean;
  game: boolean;
  onlyTx: boolean;
  anyscribe?: boolean;
}): Grade {
  if (input.anyscribe) return "G5";
  if (input.onlyTx && input.game) return "G2";
  if (input.onMintFile) return "G4";
  if (input.packedHasFile) return "G3";
  if (!input.exists) return "G0";
  const kind = uriKind(input.uri);
  if (kind === "http") return "G1";
  if (kind === "data" && !input.onMintFile) return "G1";
  if (input.game) return "G2";
  if (kind === "other") return "G0";
  return "G0";
}

export function buildExplanation(input: {
  grade: Grade;
  name: string | null;
  mediaMime: string | null;
  mediaBytes: number | null;
  hasGame: boolean;
  anyscribeBytes?: number | null;
}): string {
  const name = input.name ?? "This mint";
  const blob = blobPhrase(input.mediaMime, input.mediaBytes);
  if (input.grade === "G5") {
    const size =
      input.anyscribeBytes != null ? ` ${input.anyscribeBytes} content bytes.` : "";
    return `${name} is G5. File lives in an AnyScribe program account, not a 4 KB v1 pack. The HTTP URI is a gateway onto those slices.${size}`;
  }
  if (input.grade === "G4") {
    return `${name} is G4. The file is in this mint: ${blob}.`;
  }
  if (input.grade === "G3") {
    return `${name} is G3. This mint only has a URL. The file is on a linked mint.`;
  }
  if (input.grade === "G2") {
    return `${name} is G2. The bytes live in a transaction, not in this mint.`;
  }
  if (input.grade === "G1" && input.hasGame) {
    return `${name} is G1. The file is a URL. A cart in a memo is G2 — still not in the mint.`;
  }
  if (input.grade === "G1") {
    return `${name} is G1. Name and URI are on-chain. The file is still a URL.`;
  }
  return `${name} is G0. Off-chain. No file in this account.`;
}

function blobPhrase(mime: string | null, bytes: number | null): string {
  if (!mime && bytes == null) return "a data URI with real media";
  if (mime && bytes != null) return `${mime} (${bytes} bytes)`;
  if (mime) return mime;
  return `${bytes} bytes`;
}

export function gradeClaimMismatch(
  grade: Grade,
  hasGame: boolean,
  claim: boolean,
): boolean {
  if (!claim) return false;
  if (grade === "G4" || grade === "G5") return false;
  if (hasGame && (grade === "G1" || grade === "G2" || grade === "G0" || grade === "G3")) {
    return true;
  }
  return grade === "G0" || grade === "G1" || grade === "G2" || grade === "G3";
}
