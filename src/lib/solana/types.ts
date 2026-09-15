import type { Grade, ScanFlags } from "./grade";

export type MediaStorage = "on-chain" | "off-chain";

export const PAGE_BUDGET = 4096;

export type AccountKind =
  | "none"
  | "token"
  | "nft"
  | "wallet"
  | "token-account"
  | "program"
  | "other";

export const KIND_META: Record<
  AccountKind,
  { label: string; short: string }
> = {
  none: {
    label: "Nothing on-chain",
    short: "No account on Solana mainnet at this address.",
  },
  token: {
    label: "Token",
    short: "A token mint — the contract address.",
  },
  nft: {
    label: "NFT",
    short: "An NFT mint. That is not the same as a tradeable token.",
  },
  wallet: {
    label: "Wallet",
    short: "A wallet. Not a token contract.",
  },
  "token-account": {
    label: "Token account",
    short: "Holds a balance. The contract is the mint, not this address.",
  },
  program: {
    label: "Program",
    short: "An executable program. Not a token contract.",
  },
  other: {
    label: "Other account",
    short: "On-chain, but not a token, an NFT, or a wallet.",
  },
};

export type AudioHit = {
  field: string;
  src: string;
  mime: string;
  storage: MediaStorage;
  bytes: number | null;
};

export type MediaHit = {
  field: string;
  src: string;
  mime: string;
  kind: "gif" | "image";
  animated: boolean;
  storage: MediaStorage;
  bytes: number | null;
};

export type GameHit = {
  signature: string;
  prefix: string;
  memoBytes: number;
  cartBytes: number;
  wireBytes: number | null;
  source: string;
  slot: number | null;
  version: number | string | null;
};

export type ExtraField = {
  key: string;
  value: string;
};

export type LinkedRole =
  | "sidecar-nft"
  | "packed-mint"
  | "token"
  | "nft"
  | "other";

export type LinkedMint = {
  address: string;
  role: LinkedRole;
  name: string | null;
  hint: string;
  hasOnMintFile: boolean;
  image: string | null;
  media: MediaHit | null;
  audio: AudioHit | null;
};

export const LINK_ROLE_META: Record<LinkedRole, { label: string }> = {
  "sidecar-nft": { label: "Sidecar NFT" },
  "packed-mint": { label: "Packed mint" },
  token: { label: "Token contract" },
  nft: { label: "Linked NFT" },
  other: { label: "Linked account" },
};

export type AnyScribeHit = {
  address: string;
  mime: string;
  contentLength: number;
  published: boolean;
  mintBound: boolean;
  ownerOk: boolean;
  gatewayUri: boolean;
};

export type TokenScan = {
  mint: string;
  exists: boolean;
  accountKind: AccountKind;
  decimals: number | null;
  supply: string | null;
  tokenAccountMint: string | null;
  program: "token-2022" | "spl-token" | "unknown";
  name: string | null;
  symbol: string | null;
  image: string | null;
  uri: string | null;
  uriKind: "data" | "http" | "other" | null;
  accountSpace: number | null;
  additionalMetadata: ExtraField[];
  links: LinkedMint[];
  audio: AudioHit | null;
  media: MediaHit | null;
  game: GameHit | null;
  extraAudioCount: number;
  error: string | null;
  totalScans: number | null;
  grade: Grade | null;
  gradeLabel: string | null;
  gradeExplanation: string | null;
  inscribed: boolean;
  flags: ScanFlags;
  anyscribe: AnyScribeHit | null;
};

export const EMPTY_FLAGS: ScanFlags = {
  txVersionCreate: null,
  mutable: false,
  claimMismatch: false,
  packedMint: null,
};

export const EMPTY_SCAN: TokenScan = {
  mint: "",
  exists: false,
  accountKind: "none",
  decimals: null,
  supply: null,
  tokenAccountMint: null,
  program: "unknown",
  name: null,
  symbol: null,
  image: null,
  uri: null,
  uriKind: null,
  accountSpace: null,
  additionalMetadata: [],
  links: [],
  audio: null,
  media: null,
  game: null,
  extraAudioCount: 0,
  error: null,
  totalScans: null,
  grade: null,
  gradeLabel: null,
  gradeExplanation: null,
  inscribed: false,
  flags: EMPTY_FLAGS,
  anyscribe: null,
};
