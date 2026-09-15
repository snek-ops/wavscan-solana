import { useEffect, useMemo, useRef, useState } from "react";
import { MediaPreview } from "@/components/media-preview";
import { Badge } from "@/components/ui/badge";
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
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);
  const total = items.length;
  const current = items[Math.min(index, Math.max(total - 1, 0))];

  useEffect(() => {
    setIndex(0);
    scrollerRef.current?.scrollTo({ left: 0 });
  }, [identity]);

  if (!current) return null;
  if (total === 1) return <MediaPreview media={current} name={name} />;

  const mimeLabel = current.mime.replace("image/", "").replace("+xml", "");

  function go(next: number) {
    const el = scrollerRef.current;
    if (!el) return;
    const width = el.clientWidth;
    if (width <= 0) return;
    el.scrollTo({ left: next * width, behavior: "smooth" });
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={scrollerRef}
        className="scrollbar-none flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-md bg-surface touch-pan-x select-none"
        tabIndex={0}
        role="region"
        aria-roledescription="carousel"
        aria-label="Packed images"
        onScroll={(event) => {
          const el = event.currentTarget;
          const width = el.clientWidth;
          if (width <= 0) return;
          const next = Math.round(el.scrollLeft / width);
          setIndex(Math.min(Math.max(next, 0), total - 1));
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            go((index - 1 + total) % total);
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            go((index + 1) % total);
          }
        }}
      >
        {items.map((item, i) => (
          <div key={`${item.field}-${i}`} className="min-w-full shrink-0 snap-center">
            <img
              src={item.src}
              alt={name ? `${name} ${i + 1}` : `Media ${i + 1}`}
              draggable={false}
              className="mx-auto max-h-72 w-full object-contain"
            />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-1">
        {items.map((item, i) => (
          <button
            key={`${item.field}-dot-${i}`}
            type="button"
            className="flex size-11 items-center justify-center"
            aria-label={`Image ${i + 1} of ${total}`}
            aria-current={i === index ? "true" : undefined}
            onClick={() => go(i)}
          >
            <span
              className={cn(
                "size-2 rounded-full transition-colors duration-(--motion-quick) ease-(--ease-out)",
                i === index ? "bg-fg" : "bg-border-strong",
              )}
            />
          </button>
        ))}
        <p className="px-2 font-mono text-xs tabular-nums text-muted">
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
