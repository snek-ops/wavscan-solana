import { Pause, Play, Repeat } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Waveform } from "@/components/waveform";
import { formatBytes, formatDuration, loadWavFromSrc, type WavInfo } from "@/lib/wav";
import type { AudioHit } from "@/lib/solana/types";
import { cn } from "@/lib/utils";

type PlayerProps = {
  audio: AudioHit;
  name: string | null;
};

export function Player({ audio, name }: PlayerProps) {
  const elRef = useRef<HTMLAudioElement | null>(null);
  const [info, setInfo] = useState<WavInfo | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [loop, setLoop] = useState(true);
  const [time, setTime] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    setProgress(0);
    setTime(0);
    setPlaying(false);
    void loadWavFromSrc(audio.src).then((parsed) => {
      if (!cancelled) setInfo(parsed);
    });
    return () => {
      cancelled = true;
    };
  }, [audio.src]);

  useEffect(() => {
    const node = elRef.current;
    if (!node) return;
    node.loop = loop;
  }, [loop]);

  useEffect(() => {
    const node = elRef.current;
    if (!node) return;

    const onTime = () => {
      const duration = node.duration || info?.duration || 0;
      setTime(node.currentTime);
      setProgress(duration > 0 ? node.currentTime / duration : 0);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      if (!loop) {
        setPlaying(false);
        setProgress(1);
      }
    };

    node.addEventListener("timeupdate", onTime);
    node.addEventListener("play", onPlay);
    node.addEventListener("pause", onPause);
    node.addEventListener("ended", onEnded);
    return () => {
      node.removeEventListener("timeupdate", onTime);
      node.removeEventListener("play", onPlay);
      node.removeEventListener("pause", onPause);
      node.removeEventListener("ended", onEnded);
    };
  }, [info, loop]);

  const duration = info?.duration ?? 0;
  const mimeLabel = audio.mime.replace("audio/", "");

  const toggle = async () => {
    const node = elRef.current;
    if (!node) return;
    if (playing) {
      node.pause();
      return;
    }
    try {
      await node.play();
    } catch {
      /* autoplay rules */
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <audio ref={elRef} src={audio.src} preload="auto" playsInline />
      <Waveform
        samples={info?.samples ?? null}
        progress={progress}
        onSeek={(ratio) => {
          const node = elRef.current;
          if (!node) return;
          const dur = node.duration || duration;
          if (!dur) return;
          node.currentTime = ratio * dur;
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={() => void toggle()}
          aria-label={playing ? "Pause" : "Play"}
          className="min-w-28"
        >
          {playing ? <Pause /> : <Play />}
          {playing ? "Pause" : "Play"}
        </Button>
        <Button
          type="button"
          variant={loop ? "secondary" : "ghost"}
          size="icon"
          aria-label="Loop"
          aria-pressed={loop}
          onClick={() => setLoop((v) => !v)}
        >
          <Repeat />
        </Button>
        <span className="font-mono text-sm tabular-nums text-muted">
          {formatDuration(time)}
          <span className="text-faint"> / </span>
          {formatDuration(duration)}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Badge variant={audio.storage === "on-chain" ? "ok" : "warn"}>
            {audio.storage === "on-chain" ? "on-chain bytes" : "off-chain link"}
          </Badge>
          <Badge>{mimeLabel}</Badge>
          <Badge>{formatBytes(audio.bytes)}</Badge>
        </div>
      </div>
      <p className="text-sm text-muted">
        Field <span className="font-mono text-fg">{audio.field}</span>
        {info
          ? ` · ${info.sampleRate.toLocaleString()} Hz · ${info.bits}-bit · ${info.channels === 1 ? "mono" : `${info.channels} ch`}`
          : null}
        {name ? ` · ${name}` : null}
      </p>
    </div>
  );
}

export function SilentTrack({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <Waveform samples={null} progress={0} />
      <p className="text-sm text-muted">
        No audio field in this mint’s metadata. Token-2022 `sound` keys, data URIs,
        and Metaplex files with an audio type are all checked.
      </p>
    </div>
  );
}
