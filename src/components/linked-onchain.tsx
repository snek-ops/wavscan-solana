import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { shortMint } from "@/lib/mint";
import { LINK_ROLE_META, type LinkedMint, type LinkedRole } from "@/lib/solana/types";

function roleVariant(
  role: LinkedRole,
): "default" | "ok" | "warn" | "accent" {
  if (role === "sidecar-nft" || role === "packed-mint") return "ok";
  if (role === "token") return "accent";
  return "default";
}

export function LinkedOnchain({
  links,
  onScan,
}: {
  links: LinkedMint[];
  onScan: (mint: string) => void;
}) {
  if (links.length === 0) return null;

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border bg-surface-2 p-4">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-faint">
          Linked on-chain
        </p>
        <p className="text-sm leading-relaxed text-muted">
          Extra mints tied to this address — sidecar NFTs, packed companions, or
          the tradeable token.
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {links.map((link) => {
          const meta = LINK_ROLE_META[link.role];
          return (
            <li
              key={link.address}
              className="flex flex-col gap-3 rounded-md border border-border bg-surface px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={roleVariant(link.role)}>{meta.label}</Badge>
                  {link.hasOnMintFile ? (
                    <Badge variant="ok">on-chain file</Badge>
                  ) : null}
                </div>
                <p className="text-sm text-fg">{link.name ?? meta.label}</p>
                <p className="text-xs leading-relaxed text-muted">{link.hint}</p>
                <p className="font-mono text-xs text-faint">
                  {shortMint(link.address)}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => onScan(link.address)}
              >
                {meta.scan}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
