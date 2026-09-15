const BASE58_RE = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
const TX_SIG_RE = /[1-9A-HJ-NP-Za-km-z]{86,90}/g;

export function isTxSignature(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{86,90}$/.test(value);
}

export function isMintAddress(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value) && !isTxSignature(value);
}

export function extractMint(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);
    const txKeys = new Set(["tx", "transaction"]);
    const mintKeys = new Set(["token", "address", "account", "mint"]);
    for (let i = 0; i < parts.length; i += 1) {
      const key = parts[i]!.toLowerCase();
      const next = parts[i + 1]?.split("?")[0] ?? "";
      if (txKeys.has(key) && isTxSignature(next)) return next;
      if (mintKeys.has(key) && isMintAddress(next)) return next;
    }
  } catch {
    /* not a url */
  }

  if (isTxSignature(trimmed) || isMintAddress(trimmed)) return trimmed;

  const tx = trimmed.match(TX_SIG_RE);
  if (tx?.[0]) return tx[0];

  const matches = trimmed.match(BASE58_RE);
  return matches?.[0] ?? trimmed;
}

export function shortMint(mint: string): string {
  if (mint.length <= 12) return mint;
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}
