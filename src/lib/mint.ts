const BASE58_RE = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

export const EXAMPLES = [
  {
    label: "bruh",
    mint: "Bepk57mCZnVYPuE9qUVqFTxScq2yX6gLMjVMWmzS5FUn",
    hint: "on-chain wav",
  },
  {
    label: "Hypnotize",
    mint: "AdKH1t84SAEW2YRuy1tEGt1Na4PtsSbyLyvfiLwUkA39",
    hint: "gif",
  },
  {
    label: "USDC",
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    hint: "silent",
  },
] as const;

export function extractMint(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);
    const keys = new Set(["token", "address", "account", "mint"]);
    for (let i = 0; i < parts.length; i += 1) {
      if (keys.has(parts[i]!.toLowerCase())) {
        const next = parts[i + 1]?.split("?")[0] ?? "";
        if (next && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(next)) return next;
      }
    }
  } catch {
    /* not a url */
  }

  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)) return trimmed;

  const matches = trimmed.match(BASE58_RE);
  return matches?.[0] ?? trimmed;
}

export function shortMint(mint: string): string {
  if (mint.length <= 12) return mint;
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}
