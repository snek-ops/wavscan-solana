import { Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { MediaPreview } from "@/components/media-preview";
import { Player } from "@/components/player";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LINK_ROLE_META, type LinkedMint, type LinkedRole } from "@/lib/solana/types";

function roleVariant(
  role: LinkedRole,
): "default" | "ok" | "warn" | "accent" {
  if (role === "sidecar-nft" || role === "packed-mint") return "ok";
  if (role === "token") return "accent";
  return "default";
}

function CopyMint({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(address);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        } catch {
          /* ignore */
        }
      }}
    >
      <Copy />
      {copied ? "Copied" : "Copy address"}
    </Button>
  );
}

export function LinkedOnchain({ links }: { links: LinkedMint[] }) {
  if (links.length === 0) return null;

  const hasSidecar = links.some(
    (link) => link.role === "sidecar-nft" || link.role === "packed-mint" || link.role === "nft",
  );

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border bg-surface-2 p-4">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-faint">
          {hasSidecar ? "Sidecar" : "Linked on-chain"}
        </p>
        <p className="text-sm leading-relaxed text-muted">
          {hasSidecar
            ? "Files inscribed on a linked NFT, shown here so you do not have to scan again. The grade above is this token. Copy the NFT address to verify on Solscan."
            : "A mint this account points at. Copy the address to look it up — scanning it from here would start a new trail."}
        </p>
      </div>
      <ul className="flex flex-col gap-4">
        {links.map((link) => {
          const meta = LINK_ROLE_META[link.role];
          return (
            <li
              key={link.address}
              className="flex flex-col gap-3 rounded-md border border-border bg-surface px-3 py-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={roleVariant(link.role)}>{meta.label}</Badge>
                {link.hasOnMintFile ? (
                  <Badge variant="ok">on-chain file</Badge>
                ) : null}
                {link.audio ? <Badge variant="ok">audio</Badge> : null}
                {link.media ? (
                  <Badge variant={link.media.kind === "gif" ? "ok" : "accent"}>
                    {link.media.kind === "gif" ? "gif" : "image"}
                  </Badge>
                ) : null}
              </div>
              <p className="text-sm text-fg">{link.name ?? meta.label}</p>
              <p className="text-xs leading-relaxed text-muted">{link.hint}</p>
              {link.media ? (
                <MediaPreview media={link.media} name={link.name} />
              ) : link.image ? (
                <div className="overflow-hidden rounded-md bg-surface-2">
                  <img
                    src={link.image}
                    alt={link.name ? `${link.name} sidecar` : "Sidecar media"}
                    className="mx-auto max-h-48 w-full object-contain"
                  />
                </div>
              ) : null}
              {link.audio ? <Player audio={link.audio} name={link.name} /> : null}
              <p className="break-all font-mono text-xs text-faint">{link.address}</p>
              <div className="flex flex-wrap items-center gap-2">
                <CopyMint address={link.address} />
                <Button variant="secondary" size="sm" asChild>
                  <a
                    href={`https://solscan.io/token/${link.address}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink />
                    Solscan
                  </a>
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
