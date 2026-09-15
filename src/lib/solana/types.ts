export type MediaStorage = "on-chain" | "off-chain";

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

export type ExtraField = {
  key: string;
  value: string;
};

export type TokenScan = {
  mint: string;
  exists: boolean;
  program: "token-2022" | "spl-token" | "unknown";
  name: string | null;
  symbol: string | null;
  image: string | null;
  uri: string | null;
  uriKind: "data" | "http" | "other" | null;
  accountSpace: number | null;
  additionalMetadata: ExtraField[];
  audio: AudioHit | null;
  media: MediaHit | null;
  extraAudioCount: number;
  error: string | null;
  totalScans: number | null;
};

export const EMPTY_SCAN: TokenScan = {
  mint: "",
  exists: false,
  program: "unknown",
  name: null,
  symbol: null,
  image: null,
  uri: null,
  uriKind: null,
  accountSpace: null,
  additionalMetadata: [],
  audio: null,
  media: null,
  extraAudioCount: 0,
  error: null,
  totalScans: null,
};
