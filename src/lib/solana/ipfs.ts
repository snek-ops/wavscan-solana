const CID_RE =
  /(Qm[1-9A-HJ-NP-Za-km-z]{44,}|bafy[a-z0-9]{20,}|bafk[a-z0-9]{20,}|bafz[a-z0-9]{20,})/i;

const GATEWAYS = [
  "https://gateway.pinata.cloud/ipfs/",
  "https://ipfs.filebase.io/ipfs/",
  "https://4everland.io/ipfs/",
  "https://ipfs.io/ipfs/",
];

export function extractIpfsCid(url: string): string | null {
  const trimmed = url.trim();
  if (/^ipfs:\/\//i.test(trimmed)) {
    return trimmed.slice("ipfs://".length).split(/[/?#]/)[0] || null;
  }
  const path = trimmed.match(/\/ipfs\/([^/?#]+)/i);
  if (path?.[1]) return path[1];
  const sub = trimmed.match(/^https?:\/\/(Qm[1-9A-HJ-NP-Za-km-z]{44,}|baf[a-z0-9]+)\.ipfs\./i);
  if (sub?.[1]) return sub[1];
  if (CID_RE.test(trimmed) && !trimmed.includes("://")) return trimmed;
  return null;
}

export function ipfsDisplayUrl(url: string): string {
  const cid = extractIpfsCid(url);
  if (!cid) return url;
  return `${GATEWAYS[0]}${cid}`;
}

export function ipfsCandidates(url: string): string[] {
  const cid = extractIpfsCid(url);
  if (!cid) return [url];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const gateway of GATEWAYS) {
    const next = `${gateway}${cid}`;
    if (!seen.has(next)) {
      seen.add(next);
      out.push(next);
    }
  }
  if (!seen.has(url)) out.push(url);
  return out;
}
