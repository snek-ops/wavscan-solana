import type { AudioHit, ExtraField, MediaHit, TokenScan } from "./types";

export type FileGrade = "G0" | "G1" | "G2" | "G3" | "G4" | "G5";

export type LedgerArtifact = {
  kind: "memo" | "ix" | "log";
  prefix?: string;
  signature: string;
  mime?: string | null;
  decodedBytes?: number | null;
};

export type GradeExtras = {
  packedMint?: string | null;
  artifacts?: LedgerArtifact[];
  inscriptionProgram?: boolean;
  chunkedWrites?: boolean;
};

export type GradeResult = {
  grade: FileGrade;
  label: string;
  reasons: string[];
  claimMismatch: boolean;
  packedMint: string | null;
};

export const GRADE_LABEL: Record<FileGrade, string> = {
  G0: "off-chain file",
  G1: "on-chain metadata, off-chain file",
  G2: "ledger-packed artifact",
  G3: "inscription on linked mint",
  G4: "on-mint file",
  G5: "fully on-chain file",
};

const CLAIM_RE =
  /inscrib|on[- ]chain (image|file|media|wav|gif|game)|in the coin|4k.?b game|4096|data:image/i;

const DATA_MEDIA_RE =
  /^data:(image|audio|video|text\/html|text\/javascript|application\/javascript|application\/octet-stream)\b/i;

function dataHasPackedMedia(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.startsWith("data:")) return false;
  if (DATA_MEDIA_RE.test(trimmed)) return true;
  if (!trimmed.startsWith("data:application/json")) return false;
  return /data:(image|audio|video)\//i.test(trimmed);
}

function extraPacked(fields: ExtraField[]): boolean {
  return fields.some((field) => dataHasPackedMedia(field.value));
}

function onMintHit(hit: AudioHit | MediaHit | null): boolean {
  return Boolean(hit && hit.storage === "on-chain" && hit.src.startsWith("data:"));
}

function claimHaystack(scan: Pick<TokenScan, "name" | "symbol" | "additionalMetadata" | "uri">): string {
  const extras = scan.additionalMetadata.map((f) => `${f.key} ${f.value}`).join(" ");
  return [scan.name ?? "", scan.symbol ?? "", extras].join(" ");
}

export function gradeScan(
  scan: Pick<
    TokenScan,
    | "exists"
    | "program"
    | "name"
    | "symbol"
    | "uri"
    | "uriKind"
    | "additionalMetadata"
    | "audio"
    | "media"
  >,
  extras: GradeExtras = {},
): GradeResult {
  const reasons: string[] = [];
  const packedMint = extras.packedMint?.trim() || null;
  const artifacts = extras.artifacts ?? [];

  if (extras.inscriptionProgram || extras.chunkedWrites) {
    reasons.push(
      extras.inscriptionProgram
        ? "Inscription program account holds media bytes"
        : "Media written across multiple realloc / write txs",
    );
    return finish("G5", reasons, scan, packedMint);
  }

  const uri = scan.uri?.trim() || "";
  const uriPacked = dataHasPackedMedia(uri);
  const extrasPacked = extraPacked(scan.additionalMetadata);
  const audioPacked = onMintHit(scan.audio);
  const imagePacked = onMintHit(scan.media);

  if (uriPacked || extrasPacked || audioPacked || imagePacked) {
    if (uriPacked) reasons.push("Mint URI is a data: payload with media bytes");
    else if (uri.startsWith("data:application/json")) {
      reasons.push("data:application/json on the mint embeds data: media");
    }
    if (extrasPacked) reasons.push("additionalMetadata holds a data: media blob");
    if (audioPacked) reasons.push(`On-mint audio (${scan.audio?.mime ?? "audio"})`);
    if (imagePacked) reasons.push(`On-mint image (${scan.media?.mime ?? "image"})`);
    return finish("G4", reasons, scan, packedMint);
  }

  if (packedMint) {
    reasons.push(`Packed file lives on companion mint ${packedMint}`);
    if (scan.uriKind === "http" || /^https?:|^ipfs:|^ar:/i.test(uri)) {
      reasons.push("This mint URI is HTTP/IPFS/Arweave");
    }
    return finish("G3", reasons, scan, packedMint);
  }

  if (artifacts.length > 0 && !uriPacked && !audioPacked && !imagePacked) {
    const first = artifacts[0]!;
    reasons.push(
      `Ledger ${first.kind} in ${first.signature.slice(0, 8)}… is packed; not copied into this mint`,
    );
    if (scan.uriKind === "http" || /^https?:|^ipfs:|^ar:/i.test(uri)) {
      reasons.push("Mint URI still points off-chain");
    }
    return finish("G2", reasons, scan, null);
  }

  const hasPointer =
    Boolean(uri) ||
    Boolean(scan.name) ||
    Boolean(scan.symbol) ||
    scan.program === "token-2022" ||
    scan.program === "spl-token";

  if (uri.startsWith("data:application/json") && !uriPacked) {
    reasons.push("data: JSON wrapper on the mint, but nested files are HTTP/IPFS");
    return finish("G1", reasons, scan, null);
  }

  if (hasPointer && (scan.uriKind === "http" || /^https?:|^ipfs:|^ar:/i.test(uri))) {
    reasons.push("Name/symbol/URI live on-chain; file is fetched off-chain");
    return finish("G1", reasons, scan, null);
  }

  if (hasPointer && !uri) {
    reasons.push("On-chain token account, no metadata URI, no packed bytes");
    return finish("G0", reasons, scan, null);
  }

  reasons.push("No on-chain file and no usable metadata pointer");
  return finish("G0", reasons, scan, null);
}

function finish(
  grade: FileGrade,
  reasons: string[],
  scan: Pick<TokenScan, "name" | "symbol" | "additionalMetadata" | "uri">,
  packedMint: string | null,
): GradeResult {
  const claimed = CLAIM_RE.test(claimHaystack(scan));
  const claimMismatch = claimed && (grade === "G0" || grade === "G1" || grade === "G2");
  if (claimMismatch) reasons.push("Copy claims inscribed / on-chain file; bytes are not on this mint");
  return {
    grade,
    label: GRADE_LABEL[grade],
    reasons,
    claimMismatch,
    packedMint,
  };
}
