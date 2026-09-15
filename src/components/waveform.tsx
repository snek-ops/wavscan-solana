import { useMemo } from "react";
import { cn } from "@/lib/utils";

type WaveformProps = {
  samples: Float32Array | null;
  progress: number;
  className?: string;
  onSeek?: (ratio: number) => void;
};

const BUCKETS = 160;

export function Waveform({ samples, progress, className, onSeek }: WaveformProps) {
  const bars = useMemo(() => {
    if (!samples || samples.length === 0) return [];
    const step = samples.length / BUCKETS;
    const out: { min: number; max: number }[] = [];
    for (let i = 0; i < BUCKETS; i += 1) {
      const start = Math.floor(i * step);
      const end = Math.min(samples.length, Math.floor((i + 1) * step));
      let min = 0;
      let max = 0;
      for (let s = start; s < end; s += 1) {
        const v = samples[s] ?? 0;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (max - min < 0.04) {
        max += 0.02;
        min -= 0.02;
      }
      out.push({ min, max });
    }
    return out;
  }, [samples]);

  const playedUntil = Math.floor(BUCKETS * Math.min(1, Math.max(0, progress)));

  return (
    <button
      type="button"
      className={cn(
        "relative block h-28 w-full overflow-hidden rounded-md bg-surface-2",
        onSeek ? "cursor-pointer" : "cursor-default",
        className,
      )}
      onClick={(event) => {
        if (!onSeek) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const ratio = (event.clientX - rect.left) / rect.width;
        onSeek(Math.min(1, Math.max(0, ratio)));
      }}
      aria-label="Waveform"
    >
      <svg
        viewBox={`0 0 ${BUCKETS} 64`}
        className="h-full w-full"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <line
          x1="0"
          y1="32"
          x2={BUCKETS}
          y2="32"
          className="stroke-faint"
          strokeWidth="0.4"
          vectorEffect="non-scaling-stroke"
        />
        {bars.map((bar, i) => (
          <line
            key={i}
            x1={i + 0.5}
            x2={i + 0.5}
            y1={32 + bar.min * 26}
            y2={32 + bar.max * 26}
            className={i < playedUntil ? "stroke-accent" : "stroke-faint"}
            strokeOpacity={i < playedUntil ? 1 : 0.55}
            strokeWidth="1.1"
            strokeLinecap="round"
          />
        ))}
      </svg>
    </button>
  );
}
