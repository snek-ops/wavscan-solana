import { AudioLines, Copy, ExternalLink, LoaderCircle, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Player, SilentTrack } from "@/components/player";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { EXAMPLES, extractMint, shortMint } from "@/lib/mint";
import { checkToken } from "@/lib/solana/check-token";
import type { TokenScan } from "@/lib/solana/types";
import { formatBytes } from "@/lib/wav";
import { cn } from "@/lib/utils";

const RECENTS_KEY = "wavscan:recents";

type Recent = { mint: string; name: string | null; hasAudio: boolean };

function readRecents(): Recent[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Recent[];
    return Array.isArray(parsed) ? parsed.slice(0, 6) : [];
  } catch {
    return [];
  }
}

function writeRecents(next: Recent[]) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next.slice(0, 6)));
  } catch {
    /* ignore quota */
  }
}

export function Checker() {
  const [value, setValue] = useState<string>(EXAMPLES[0].mint);
  const [status, setStatus] = useState<"idle" | "loading" | "done">("loading");
  const [scan, setScan] = useState<TokenScan | null>(null);
  const [copied, setCopied] = useState(false);
  const [recents, setRecents] = useState<Recent[]>([]);

  useEffect(() => {
    setRecents(readRecents());
    void runScan(EXAMPLES[0].mint);
  }, []);

  async function runScan(raw: string) {
    const mint = extractMint(raw);
    setValue(mint);
    if (!mint) return;
    setStatus("loading");
    try {
      const result = await checkToken({ data: { mint } });
      setScan(result);
      setStatus("done");
      if (result.exists && !result.error) {
        const entry: Recent = {
          mint: result.mint,
          name: result.name,
          hasAudio: Boolean(result.audio),
        };
        setRecents((prev) => {
          const next = [entry, ...prev.filter((r) => r.mint !== entry.mint)];
          writeRecents(next);
          return next;
        });
      }
    } catch (err) {
      setScan({
        mint,
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
        extraAudioCount: 0,
        error: err instanceof Error ? err.message : "Scan failed.",
      });
      setStatus("done");
    }
  }

  const hasAudio = Boolean(scan?.audio);
  const failed = Boolean(scan?.error);

  return (
    <div className="relative mx-auto flex w-full max-w-3xl flex-col gap-10 px-5 pb-24 pt-10 sm:px-8 sm:pt-16">
      <header className="flex flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 text-accent">
            <AudioLines className="size-5" strokeWidth={1.75} />
            <span className="font-display text-sm font-semibold tracking-[0.18em] text-fg">
              WAVSCAN
            </span>
          </div>
          <p className="hidden text-xs text-faint sm:block">
            Solana · tx v1 · 4 KB budget
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <h1 className="font-display text-4xl font-semibold leading-tight tracking-tight text-fg text-balance sm:text-5xl">
            Does this mint make a sound?
          </h1>
          <p className="max-w-xl text-pretty text-base leading-relaxed text-muted">
            Paste a Solana token address. We read Token-2022 metadata and Metaplex
            JSON for a real audio payload — on-chain bytes, not a tweet.
          </p>
        </div>
      </header>

      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void runScan(value);
        }}
      >
        <label htmlFor="mint" className="text-xs font-medium uppercase tracking-[0.16em] text-faint">
          Mint address
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            id="mint"
            name="mint"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="Paste mint or Solscan URL"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="sm:flex-1"
          />
          <Button type="submit" disabled={status === "loading"} className="sm:w-40">
            {status === "loading" ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <Search />
            )}
            {status === "loading" ? "Scanning" : "Scan"}
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.mint}
              type="button"
              onClick={() => void runScan(ex.mint)}
              className={cn(
                "h-9 rounded-full border px-3 text-xs font-medium transition-colors duration-(--motion-quick)",
                value === ex.mint
                  ? "border-accent/40 bg-accent/10 text-fg"
                  : "border-border bg-transparent text-muted hover:text-fg",
              )}
            >
              {ex.label}
              <span className="ml-1.5 text-faint"> {ex.hint}</span>
            </button>
          ))}
        </div>
      </form>

      <section
        className={cn(
          "rounded-2xl border border-border bg-surface p-5 sm:p-6",
          "transition-opacity duration-(--motion-slow) ease-(--ease-out)",
          status === "loading" && scan ? "opacity-70" : "opacity-100",
        )}
      >
        {status === "idle" && !scan ? (
          <p className="text-sm text-muted">Waiting for a mint.</p>
        ) : status === "loading" && !scan ? (
          <div className="flex items-center gap-3 text-sm text-muted">
            <LoaderCircle className="size-4 animate-spin" />
            Reading on-chain metadata…
          </div>
        ) : scan && failed ? (
          <div className="flex flex-col gap-2">
            <p className="font-display text-2xl font-semibold text-fg">Not found</p>
            <p className="text-sm text-muted">{scan.error}</p>
          </div>
        ) : scan ? (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-4">
                <TokenMark src={scan.image} hasAudio={hasAudio} />
                <div className="flex min-w-0 flex-col gap-1.5">
                  <p className="font-display text-2xl font-semibold tracking-tight text-fg">
                    {hasAudio ? "Has sound" : "Silent"}
                  </p>
                  <p className="truncate text-sm text-muted">
                    {scan.name ?? "Unnamed mint"}
                    {scan.symbol ? (
                      <span className="text-faint"> · {scan.symbol}</span>
                    ) : null}
                  </p>
                  <p className="font-mono text-xs text-faint">{shortMint(scan.mint)}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={hasAudio ? "ok" : "default"}>
                  {hasAudio ? "audio detected" : "no audio"}
                </Badge>
                <Badge>
                  {scan.program === "token-2022"
                    ? "Token-2022"
                    : scan.program === "spl-token"
                      ? "SPL Token"
                      : "unknown program"}
                </Badge>
                {scan.uriKind === "data" ? <Badge variant="accent">data URI</Badge> : null}
              </div>
            </div>

            {scan.audio ? (
              <Player audio={scan.audio} name={scan.name} />
            ) : (
              <SilentTrack />
            )}

            <Separator />

            <dl className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
              <Stat label="Account" value={formatBytes(scan.accountSpace)} />
              <Stat
                label="Metadata"
                value={
                  scan.uriKind === "data"
                    ? "on mint"
                    : scan.uriKind === "http"
                      ? "off-chain JSON"
                      : "none"
                }
              />
              <Stat
                label="Audio"
                value={
                  scan.audio
                    ? scan.audio.storage === "on-chain"
                      ? "in the bytes"
                      : "linked"
                    : "missing"
                }
              />
              <Stat
                label="v1 budget"
                value={
                  scan.audio?.bytes != null && scan.audio.bytes <= 4096
                    ? "fits 4 KB"
                    : scan.audio
                      ? "over 4 KB"
                      : "—"
                }
              />
            </dl>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(scan.mint);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1200);
                  } catch {
                    /* ignore */
                  }
                }}
              >
                <Copy />
                {copied ? "Copied" : "Copy mint"}
              </Button>
              <Button variant="secondary" size="sm" asChild>
                <a
                  href={`https://solscan.io/token/${scan.mint}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink />
                  Solscan
                </a>
              </Button>
            </div>

            {scan.additionalMetadata.length > 0 ? (
              <div className="flex flex-col gap-3">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-faint">
                  Extra metadata
                </p>
                <ul className="flex flex-col gap-2">
                  {scan.additionalMetadata.map((field) => (
                    <li
                      key={field.key}
                      className="grid gap-1 rounded-md bg-surface-2 px-3 py-2 sm:grid-cols-[8rem_1fr] sm:items-baseline"
                    >
                      <span className="font-mono text-xs text-muted">{field.key}</span>
                      <span className="break-all font-mono text-xs text-fg">
                        {field.value}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {recents.length > 0 ? (
        <section className="flex flex-col gap-3">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-faint">
            Recent
          </p>
          <ul className="flex flex-col gap-1">
            {recents.map((item) => (
              <li key={item.mint}>
                <button
                  type="button"
                  onClick={() => void runScan(item.mint)}
                  className="flex h-11 w-full items-center justify-between rounded-md px-2 text-left text-sm text-muted transition-colors duration-(--motion-quick) hover:bg-surface hover:text-fg"
                >
                  <span className="truncate">
                    {item.name ?? shortMint(item.mint)}
                    <span className="ml-2 font-mono text-xs text-faint">
                      {" "}
                      {shortMint(item.mint)}
                    </span>
                  </span>
                  <span className="text-xs text-faint">
                    {item.hasAudio ? "sound" : "silent"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="text-xs leading-relaxed text-faint">
        Token-2022 tokenMetadata, metadata pointers, and Metaplex URIs. On-chain
        means a data URI living on the mint — the 4 KB v1 transaction budget is
        what made a real WAV possible.
      </footer>
    </div>
  );
}

function TokenMark({ src, hasAudio }: { src: string | null; hasAudio: boolean }) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="size-14 shrink-0 rounded-md border border-border bg-surface-2 object-cover"
      />
    );
  }
  return (
    <div
      className={cn(
        "flex size-14 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2",
        hasAudio ? "text-accent" : "text-faint",
      )}
    >
      <AudioLines className="size-5" strokeWidth={1.6} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs uppercase tracking-[0.14em] text-faint">{label}</dt>
      <dd className="text-sm text-fg">{value}</dd>
    </div>
  );
}
