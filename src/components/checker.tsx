import { Copy, ExternalLink, LoaderCircle, ScanSearch, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { GamePlayer } from "@/components/game-player";
import { GradeCard } from "@/components/grade-card";
import { GradeLegend } from "@/components/grade-legend";
import { gradeTextClass } from "@/components/grade-style";
import { LinkedOnchain } from "@/components/linked-onchain";
import { MediaGallery } from "@/components/media-gallery";
import { Player, SilentTrack } from "@/components/player";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { extractMint, isMintAddress, shortMint } from "@/lib/mint";
import { checkToken } from "@/lib/solana/check-token";
import { isGrade } from "@/lib/solana/grade";
import {
  EMPTY_SCAN,
  KIND_META,
  PAGE_BUDGET,
  type AccountKind,
  type TokenScan,
} from "@/lib/solana/types";
import { getScanCount } from "@/lib/stats";
import { formatBytes } from "@/lib/wav";
import { cn } from "@/lib/utils";

const RECENTS_KEY = "metadata-scanner:recents";

type Recent = {
  mint: string;
  name: string | null;
  hasAudio: boolean;
  hasGif: boolean;
  hasGame: boolean;
  grade: string | null;
  kind: AccountKind | null;
};

function isTxScan(scan: TokenScan): boolean {
  return scan.mint.length > 44;
}

function isMintKind(kind: AccountKind): boolean {
  return kind === "token" || kind === "nft";
}

function showsMediaScan(scan: TokenScan): boolean {
  return isMintKind(scan.accountKind) || Boolean(scan.game);
}

function kindBadgeVariant(
  kind: AccountKind,
): "default" | "ok" | "warn" | "bad" | "accent" {
  if (kind === "token") return "accent";
  if (kind === "nft") return "ok";
  if (kind === "program" || kind === "token-account") return "warn";
  if (kind === "none") return "default";
  return "default";
}

function headline(scan: TokenScan): string {
  if (!isTxScan(scan)) {
    if (scan.accountKind === "none") return "Nothing on-chain";
    if (scan.accountKind === "wallet") return "This is a wallet";
    if (scan.accountKind === "program") return "This is a program";
    if (scan.accountKind === "token-account") return "This is a token account";
    if (scan.accountKind === "other" && !scan.game) return "On-chain, not a token";
  }
  if (scan.grade === "G5") return "Fully on-chain file";
  if (scan.grade === "G4") {
    return scan.inscribed ? "Truly on-chain file" : (scan.gradeLabel ?? "On-mint file");
  }
  if (scan.grade === "G3") return "Inscription is on another mint";
  if (scan.grade === "G2") return "Ledger blob, not in the mint";
  if (scan.grade === "G1" && scan.game) return "Off-chain file, ledger cart";
  if (scan.grade === "G1") return "On-chain metadata, off-chain file";
  if (scan.grade === "G0") return "Off-chain file";
  const gif = scan.media?.kind === "gif";
  const img = Boolean(scan.media);
  const sound = Boolean(scan.audio);
  const game = Boolean(scan.game);
  if (game) return "Has a game";
  if (sound && gif) return "Has sound and a GIF";
  if (sound) return "Has sound";
  if (gif) return "Has a GIF";
  if (img) return "Has an image";
  return scan.accountKind === "token" ? "This is a token" : "Silent";
}

function mintFacts(scan: TokenScan): string | null {
  if (!isMintKind(scan.accountKind)) return null;
  const parts: string[] = [];
  if (scan.decimals != null) parts.push(`${scan.decimals} decimals`);
  if (scan.supply != null && scan.supply.length <= 10) {
    parts.push(`supply ${scan.supply}`);
  }
  return parts.length ? parts.join(" · ") : null;
}

function recentLabel(item: Recent): string {
  if (item.kind && item.kind !== "token" && item.kind !== "nft") {
    return KIND_META[item.kind].label.toLowerCase();
  }
  if (item.grade) return item.grade.toLowerCase();
  if (item.hasGame) return "game";
  if (item.hasAudio && item.hasGif) return "sound + gif";
  if (item.hasAudio) return "sound";
  if (item.hasGif) return "gif";
  if (item.kind === "nft") return "nft";
  if (item.kind === "token") return "token";
  return "silent";
}

function solscanHref(scan: TokenScan): string {
  if (scan.mint.length > 44) return `https://solscan.io/tx/${scan.mint}`;
  if (scan.accountKind === "token" || scan.accountKind === "nft") {
    return `https://solscan.io/token/${scan.mint}`;
  }
  return `https://solscan.io/account/${scan.mint}`;
}

export function Checker() {
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");
  const [scan, setScan] = useState<TokenScan | null>(null);
  const [copied, setCopied] = useState(false);
  const [recents, setRecents] = useState<Recent[]>([]);
  const [scans, setScans] = useState<number | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const scanGen = useRef(0);
  const resultRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setRecents(readRecents());
    void getScanCount()
      .then(setScans)
      .catch(() => setScans(null));
  }, []);

  async function runScan(raw: string) {
    const mint = extractMint(raw);
    setValue(mint);
    if (!mint) {
      setHint("Paste a Solana contract address first.");
      return;
    }
    setHint(null);
    const gen = ++scanGen.current;
    setStatus("loading");
    window.setTimeout(() => {
      resultRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 0);
    try {
      const result = await Promise.race([
        checkToken({ data: { mint } }),
        new Promise<never>((_, reject) => {
          window.setTimeout(
            () => reject(new Error("Scan took too long. The RPC may be overloaded. Try again.")),
            18_000,
          );
        }),
      ]);
      if (gen !== scanGen.current) return;
      setScan(result);
      setStatus("done");
      if (typeof result.totalScans === "number") setScans(result.totalScans);
      if (!result.error) {
        const entry: Recent = {
          mint: result.mint,
          name: result.name,
          hasAudio: Boolean(result.audio),
          hasGif: result.media?.kind === "gif",
          hasGame: Boolean(result.game),
          grade: result.grade,
          kind: result.accountKind,
        };
        setRecents((prev) => {
          const next = [entry, ...prev.filter((r) => r.mint !== entry.mint)];
          writeRecents(next);
          return next;
        });
      }
    } catch (err) {
      if (gen !== scanGen.current) return;
      setScan({
        ...EMPTY_SCAN,
        mint,
        error: err instanceof Error ? err.message : "Scan failed.",
        totalScans: scans,
      });
      setStatus("done");
    }
  }

  const hasAudio = Boolean(scan?.audio);
  const galleryItems = scan?.gallery?.length
    ? scan.gallery
    : scan?.media
      ? [scan.media]
      : [];
  const hasGif = galleryItems.some((hit) => hit.kind === "gif");
  const hasGame = Boolean(scan?.game);
  const failed = Boolean(scan?.error);
  const packedMedia = Boolean(scan?.media?.field.startsWith("packed."));
  const facts = scan ? mintFacts(scan) : null;

  return (
    <div className="relative mx-auto flex w-full max-w-3xl flex-col gap-10 px-5 pb-24 pt-10 sm:px-8 sm:pt-16">
      <header className="flex flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 text-accent">
            <ScanSearch className="size-5" strokeWidth={1.75} />
            <span className="font-display text-sm font-semibold tracking-[0.12em] text-fg">
              METADATA SCANNER
            </span>
          </div>
          <p className="font-mono text-xs tabular-nums text-faint">
            {scans != null ? `${scans.toLocaleString("en-US")} scans` : "—"}
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <h1 className="font-display text-4xl font-semibold leading-tight tracking-tight text-fg text-balance sm:text-5xl">
            Media packed token scanner. Is it truly onchain?
          </h1>
          <p className="max-w-xl text-pretty text-base leading-relaxed text-muted">
            Paste a contract address. First we tell you if it is a token, an
            NFT, a wallet, or nothing on-chain. Then we tell you if the image,
            audio, or game is stored on the token, or only linked off-chain.
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
          Contract address
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            id="mint"
            name="mint"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="Paste a Solana contract address"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onPaste={(event) => {
              const text = event.clipboardData.getData("text");
              const extracted = extractMint(text);
              if (!extracted) return;
              event.preventDefault();
              setValue(extracted);
              setHint(null);
            }}
            className="sm:flex-1"
          />
          <Button type="submit" className="sm:w-40">
            {status === "loading" ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <Search />
            )}
            {status === "loading" ? "Scanning" : "Scan"}
          </Button>
        </div>
        {status === "loading" ? (
          <div className="flex flex-col gap-1.5 pt-1">
            <p className="text-xs leading-relaxed text-faint">
              Detects token, NFT, wallet, or nothing on-chain.
            </p>
            <p className="flex items-center gap-2 text-xs text-muted">
              <LoaderCircle className="size-3.5 animate-spin" />
              Reading {shortMint(value)}…
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 pt-1">
            <p className="text-xs leading-relaxed text-faint">
              Detects token, NFT, wallet, or nothing on-chain.
            </p>
            {hint ? <p className="text-xs text-warn">{hint}</p> : null}
            {scan?.error ? <p className="text-xs text-bad">{scan.error}</p> : null}
          </div>
        )}
      </form>

      <section
        id="scan-result"
        ref={resultRef}
        className={cn(
          "rounded-2xl border border-border bg-surface p-5 sm:p-6",
          "transition-opacity duration-(--motion-slow) ease-(--ease-out)",
          status === "loading" && scan ? "opacity-70" : "opacity-100",
        )}
      >
        {status === "idle" && !scan ? (
          <p className="text-sm leading-relaxed text-muted">
            Waiting for a contract address. We will say what the account is
            before we grade any media.
          </p>
        ) : status === "loading" && !scan ? (
          <div className="flex items-center gap-3 text-sm text-muted">
            <LoaderCircle className="size-4 animate-spin" />
            Reading the account…
          </div>
        ) : scan && failed ? (
          <div className="flex flex-col gap-2">
            <p className="font-display text-2xl font-semibold text-fg">Scan failed</p>
            <p className="text-sm text-muted">{scan.error}</p>
          </div>
        ) : scan && !showsMediaScan(scan) ? (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-4">
                <TokenMark src={null} active={false} />
                <div className="flex min-w-0 flex-col gap-1.5">
                  <p className="font-display text-2xl font-semibold tracking-tight text-fg">
                    {headline(scan)}
                  </p>
                  <p className="text-sm text-muted">{KIND_META[scan.accountKind].short}</p>
                  <p className="font-mono text-xs text-faint">{shortMint(scan.mint)}</p>
                </div>
              </div>
              <Badge variant={kindBadgeVariant(scan.accountKind)}>
                {KIND_META[scan.accountKind].label}
              </Badge>
            </div>
            {scan.accountKind === "token-account" && scan.tokenAccountMint ? (
              <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted">
                  Mint{" "}
                  <span className="font-mono text-fg">
                    {shortMint(scan.tokenAccountMint)}
                  </span>
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => void runScan(scan.tokenAccountMint!)}
                >
                  Scan the mint
                </Button>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <CopyAddress scan={scan} copied={copied} setCopied={setCopied} />
              <SolscanLink scan={scan} />
            </div>
          </div>
        ) : scan ? (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-4">
                <TokenMark
                  src={scan.image}
                  active={hasAudio || hasGame || Boolean(scan.media)}
                />
                <div className="flex min-w-0 flex-col gap-1.5">
                  <p className="font-display text-2xl font-semibold tracking-tight text-fg">
                    {headline(scan)}
                  </p>
                  <p className="truncate text-sm text-muted">
                    {scan.name ?? KIND_META[scan.accountKind].label}
                    {scan.symbol ? (
                      <span className="text-faint"> · {scan.symbol}</span>
                    ) : null}
                  </p>
                  {facts ? (
                    <p className="text-xs text-faint">{facts}</p>
                  ) : null}
                  <p className="font-mono text-xs text-faint">{shortMint(scan.mint)}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!isTxScan(scan) ? (
                  <Badge variant={kindBadgeVariant(scan.accountKind)}>
                    {KIND_META[scan.accountKind].label}
                  </Badge>
                ) : null}
                {scan.grade ? (
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full border border-border px-2.5 py-0.5 font-mono text-xs font-medium tracking-wide",
                      gradeTextClass(scan.grade),
                    )}
                  >
                    {scan.grade}
                  </span>
                ) : null}
                <Badge variant={hasGame ? "ok" : "default"}>
                  {hasGame ? "ledger cart" : "no cart"}
                </Badge>
                <Badge variant={hasAudio ? "ok" : "default"}>
                  {hasAudio ? "audio" : "no audio"}
                </Badge>
                <Badge variant={hasGif ? "ok" : scan.media ? "accent" : "default"}>
                  {hasGif ? "gif" : scan.media ? "image" : "no image"}
                </Badge>
                <Badge>
                  {scan.program === "token-2022"
                    ? "Token-2022"
                    : scan.program === "spl-token"
                      ? "SPL Token"
                      : scan.game
                        ? "v1 tx"
                        : "unknown program"}
                </Badge>
                {scan.uriKind === "data" ? <Badge variant="accent">data URI</Badge> : null}
              </div>
            </div>

            <GradeCard scan={scan} />

            <LinkedOnchain
              links={scan.links}
              onScan={(mint) => void runScan(mint)}
            />

            {scan.game ? <GamePlayer game={scan.game} /> : null}

            {galleryItems.length > 0 ? (
              <div className="flex flex-col gap-4 rounded-md border border-border bg-surface-2 p-4">
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-faint">
                    Token image
                  </p>
                  <p className="text-sm leading-relaxed text-muted">
                    {packedMedia
                      ? "On-chain file packed on a linked mint."
                      : galleryItems.some((hit) => hit.storage === "on-chain")
                        ? "On-chain file packed in this mint."
                        : "Off-chain file this mint’s URI points at. Not inscribed."}
                  </p>
                </div>
                <MediaGallery items={galleryItems} name={scan.name} />
              </div>
            ) : null}

            {scan.audio ? (
              <Player audio={scan.audio} name={scan.name} />
            ) : galleryItems.length || scan.game ? null : (
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
                      : scan.game
                        ? "v1 memo"
                        : "none"
                }
              />
              <Stat
                label="Payload"
                value={
                  scan.game
                    ? `${formatBytes(scan.game.cartBytes)} / ${formatBytes(PAGE_BUDGET)}`
                    : scan.audio
                      ? scan.audio.storage === "on-chain"
                        ? "in the bytes"
                        : "linked"
                      : "missing"
                }
              />
              <Stat
                label="Image"
                value={
                  packedMedia
                    ? "on linked mint"
                    : scan.media
                      ? scan.media.kind === "gif"
                        ? scan.media.storage === "on-chain"
                          ? "on-chain gif"
                          : "linked gif"
                        : scan.media.storage === "on-chain"
                          ? "on-chain"
                          : "linked"
                      : "missing"
                }
              />
            </dl>

            <div className="flex flex-wrap gap-2">
              <CopyAddress scan={scan} copied={copied} setCopied={setCopied} />
              <SolscanLink scan={scan} />
              {scan.game ? (
                <Button variant="secondary" size="sm" asChild>
                  <a
                    href={`https://solscan.io/tx/${scan.game.signature}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink />
                    Solscan tx
                  </a>
                </Button>
              ) : null}
              {scan.flags.packedMint ? (
                <Button variant="secondary" size="sm" asChild>
                  <a
                    href={`https://solscan.io/token/${scan.flags.packedMint}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink />
                    Companion
                  </a>
                </Button>
              ) : null}
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
                      className="grid gap-2 rounded-md bg-surface-2 px-3 py-2 sm:grid-cols-[8rem_1fr_auto] sm:items-center"
                    >
                      <span className="font-mono text-xs text-muted">{field.key}</span>
                      <span className="break-all font-mono text-xs text-fg">
                        {field.value}
                      </span>
                      {isMintAddress(field.value) && field.value !== scan.mint ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => void runScan(field.value)}
                        >
                          Scan
                        </Button>
                      ) : null}
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
                  <span className="text-xs">
                    {item.kind && !isMintKind(item.kind) ? (
                      <span className="text-faint">{recentLabel(item)}</span>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        {item.kind ? (
                          <span className="text-faint">
                            {KIND_META[item.kind].label}
                          </span>
                        ) : null}
                        {isGrade(item.grade) ? (
                          <span className={cn("font-mono", gradeTextClass(item.grade))}>
                            {item.grade}
                          </span>
                        ) : (
                          <span className="text-faint">{recentLabel(item)}</span>
                        )}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <GradeLegend />

      <footer className="text-xs leading-relaxed text-faint">
        Inscribed means G4 or G5 only — the file is in this mint’s account data
        or a bound AnyScribe storage account, not a URL. Grades apply to token
        and NFT mints. v1 is a transaction format. The gateway is a reader only.
      </footer>
    </div>
  );
}

function CopyAddress({
  scan,
  copied,
  setCopied,
}: {
  scan: TokenScan;
  copied: boolean;
  setCopied: (value: boolean) => void;
}) {
  return (
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
      {copied ? "Copied" : scan.mint.length > 44 ? "Copy signature" : "Copy address"}
    </Button>
  );
}

function SolscanLink({ scan }: { scan: TokenScan }) {
  return (
    <Button variant="secondary" size="sm" asChild>
      <a href={solscanHref(scan)} target="_blank" rel="noreferrer">
        <ExternalLink />
        Solscan
      </a>
    </Button>
  );
}

function TokenMark({ src, active }: { src: string | null; active: boolean }) {
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
        active ? "text-accent" : "text-faint",
      )}
    >
      <ScanSearch className="size-5" strokeWidth={1.6} />
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

function readRecents(): Recent[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .filter((item) => typeof item.mint === "string")
      .slice(0, 8)
      .map((item) => ({
        mint: item.mint as string,
        name: typeof item.name === "string" ? item.name : null,
        hasAudio: Boolean(item.hasAudio),
        hasGif: Boolean(item.hasGif),
        hasGame: Boolean(item.hasGame),
        grade: typeof item.grade === "string" ? item.grade : null,
        kind: isAccountKind(item.kind) ? item.kind : null,
      }));
  } catch {
    return [];
  }
}

function isAccountKind(value: unknown): value is AccountKind {
  return (
    value === "none" ||
    value === "token" ||
    value === "nft" ||
    value === "wallet" ||
    value === "token-account" ||
    value === "program" ||
    value === "other"
  );
}

function writeRecents(items: Recent[]) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(items.slice(0, 8)));
  } catch {
    /* ignore quota */
  }
}
