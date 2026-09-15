import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { MediaHit } from "@/lib/solana/types";
import { formatBytes } from "@/lib/wav";
import { cn } from "@/lib/utils";

export function MediaGallery({
  items,
  name,
}: {
  items: MediaHit[];
  name: string | null;
}) {
  const identity = useMemo(
    () => items.map((item) => `${item.field}:${item.src.slice(0, 80)}`).join("|"),
    [items],
  );
  const [index, setIndex] = useState(0);
  const total = items.length;
  const current = items[Math.min(index, Math.max(total - 1, 0))];

  useEffect(() => {
    setIndex(0);
  }, [identity]);

  if (!current) return null;
  const mimeLabel = current.mime.replace("image/", "").replace("+xml", "");
  const many = total > 1;

  function step(delta: number) {
    if (total < 1) return;
    setIndex((i) => (i + delta + total) % total);
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        className="relative overflow-hidden rounded-md bg-surface"
        tabIndex={0}
        role="group"
        aria-label="Token image gallery"
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            step(-1);
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            step(1);
          }
        }}
      >
        <img
          src={current.src}
          alt={name ? `${name} ${index + 1}` : `Media ${index + 1}`}
          className="mx-auto max-h-72 w-full object-contain"
        />
        <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-between px-2">
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="pointer-events-auto bg-surface/90"
            aria-label="Previous"
            onClick={() => step(-1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="pointer-events-auto bg-surface/90"
            aria-label="Next"
            onClick={() => step(1)}
          >
            <ChevronRight />
          </Button>
        </div>
        <p
          className={cn(
            "absolute bottom-3 left-1/2 -translate-x-1/2 rounded-sm border border-border bg-surface-2 px-2.5 py-1",
            "font-mono text-xs tabular-nums text-fg",
          )}
        >
          {index + 1} / {total}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={current.kind === "gif" ? "ok" : "accent"}>
          {current.kind === "gif" ? "gif" : "image"}
        </Badge>
        <Badge variant={current.storage === "on-chain" ? "ok" : "warn"}>
          {current.storage === "on-chain" ? "on-chain bytes" : "off-chain link"}
        </Badge>
        <Badge>{mimeLabel}</Badge>
        {current.bytes != null ? <Badge>{formatBytes(current.bytes)}</Badge> : null}
      </div>
      <p className="text-sm text-muted">
        Field <span className="font-mono text-fg">{current.field}</span>
        {current.kind === "gif" ? " · animated" : null}
      </p>
    </div>
  );
}
