import { Gamepad2, Square } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { GameHit } from "@/lib/solana/types";
import { PAGE_BUDGET } from "@/lib/solana/types";
import { formatBytes } from "@/lib/wav";
import { cn } from "@/lib/utils";

function buildSrcDoc(source: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<style>
  html,body{margin:0;height:100%;background:#050605;display:flex;align-items:center;justify-content:center;overflow:hidden}
  canvas{width:100%;height:auto;image-rendering:pixelated;image-rendering:crisp-edges;touch-action:none;display:block;outline:none}
</style>
</head>
<body>
<canvas id="c" width="320" height="180" tabindex="0"></canvas>
<script type="module">
const source = ${JSON.stringify(source).replace(/<\//g, "<\\/")};
const blob = new Blob([source], { type: "text/javascript" });
const url = URL.createObjectURL(blob);
const mod = await import(url);
const canvas = document.getElementById("c");
const AudioCtx = window.AudioContext || window.webkitAudioContext;
const audio = new AudioCtx();
mod.boot(canvas, audio);
canvas.focus();
const resume = () => { audio.resume(); canvas.focus(); };
window.addEventListener("pointerdown", resume);
window.addEventListener("keydown", resume);
</script>
</body>
</html>`;
}

export function GamePlayer({ game }: { game: GameHit }) {
  const [booted, setBooted] = useState(false);
  const srcDoc = useMemo(() => buildSrcDoc(game.source), [game.source]);
  const fill = Math.min(1, game.cartBytes / PAGE_BUDGET);

  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          "relative overflow-hidden rounded-md bg-surface-2",
          "aspect-[16/9]",
        )}
      >
        {booted ? (
          <iframe
            title="Ledger cart"
            sandbox="allow-scripts allow-pointer-lock"
            srcDoc={srcDoc}
            className="absolute inset-0 h-full w-full border-0"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
            <p className="font-mono text-xs tabular-nums text-faint">
              {game.cartBytes} / {PAGE_BUDGET}
            </p>
            <Button type="button" onClick={() => setBooted(true)}>
              <Gamepad2 />
              Boot ledger cart
            </Button>
            <p className="max-w-xs text-xs leading-relaxed text-faint">
              Inflates instruction 0 of a v1 memo and runs{" "}
              <span className="font-mono text-muted">boot(canvas, audio)</span>
              {" "}in a sandbox. Ledger blob — not copied into the mint.
            </p>
          </div>
        )}
      </div>
      <div
        className="h-1 overflow-hidden rounded-full bg-surface-2"
        aria-hidden
      >
        <div
          className="h-full bg-accent"
          style={{ width: `${Math.max(4, fill * 100)}%` }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="ok">game</Badge>
        <Badge variant="accent">v1 memo</Badge>
        <Badge>{game.prefix.replace(/\.$/, "")}</Badge>
        <Badge>
          cart {formatBytes(game.cartBytes)} / {formatBytes(PAGE_BUDGET)}
        </Badge>
        {game.wireBytes != null ? (
          <Badge>wire {formatBytes(game.wireBytes)}</Badge>
        ) : null}
        <Badge>memo {formatBytes(game.memoBytes)}</Badge>
        {booted ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => setBooted(false)}
          >
            <Square />
            Stop
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-muted">
        A / D or arrows steer · W thrust · space fire · tap for audio
      </p>
    </div>
  );
}
