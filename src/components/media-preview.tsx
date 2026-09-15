import { Badge } from "@/components/ui/badge";
import type { MediaHit } from "@/lib/solana/types";
import { formatBytes } from "@/lib/wav";

export function MediaPreview({ media, name }: { media: MediaHit; name: string | null }) {
  const mimeLabel = media.mime.replace("image/", "").replace("+xml", "");

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-md bg-surface-2">
        <img
          src={media.src}
          alt={name ? `${name} media` : "Token media"}
          className="mx-auto max-h-72 w-full object-contain"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={media.kind === "gif" ? "ok" : "accent"}>
          {media.kind === "gif" ? "gif" : "image"}
        </Badge>
        <Badge variant={media.storage === "on-chain" ? "ok" : "warn"}>
          {media.storage === "on-chain" ? "on-chain bytes" : "off-chain link"}
        </Badge>
        <Badge>{mimeLabel}</Badge>
        {media.bytes != null ? <Badge>{formatBytes(media.bytes)}</Badge> : null}
      </div>
      <p className="text-sm text-muted">
        Field <span className="font-mono text-fg">{media.field}</span>
        {media.kind === "gif" ? " · animated" : null}
      </p>
    </div>
  );
}
