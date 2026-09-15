import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GRADE_META } from "@/lib/solana/grade";
import { gradeEdgeClass, gradeTextClass } from "@/components/grade-style";
import type { TokenScan } from "@/lib/solana/types";
import { cn } from "@/lib/utils";

export function GradeCard({
  scan,
}: {
  scan: TokenScan;
}) {
  if (!scan.grade) return null;
  const meta = GRADE_META[scan.grade];
  const flags = scan.flags;
  const showAuthority =
    scan.mint.length <= 44 && scan.program === "token-2022";
  const scribe = scan.anyscribe;

  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-md border border-border border-l-2 bg-surface-2 p-4 sm:p-5",
        gradeEdgeClass(scan.grade),
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-faint">
            Grade
          </p>
          <p
            className={cn(
              "font-display text-3xl font-semibold tracking-tight",
              gradeTextClass(scan.grade),
            )}
          >
            {scan.grade}
          </p>
          <p className="text-sm text-muted">{meta.label}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={meta.inscribed ? "ok" : "default"}>
            {meta.inscribed ? "inscribed" : "not inscribed"}
          </Badge>
          {flags.claimMismatch ? (
            <Badge variant="bad">claim mismatch</Badge>
          ) : null}
          {flags.txVersionCreate === 1 ? (
            <Badge variant="accent">v1 create</Badge>
          ) : flags.txVersionCreate === "legacy" || flags.txVersionCreate === 0 ? (
            <Badge>legacy tx</Badge>
          ) : null}
          {scribe ? <Badge variant="ok">AnyScribe</Badge> : null}
          {showAuthority ? (
            flags.mutable ? (
              <Badge variant="warn">mutable</Badge>
            ) : (
              <Badge>frozen metadata</Badge>
            )
          ) : null}
        </div>
      </div>
      <p className="text-sm leading-relaxed text-fg text-pretty">
        {scan.gradeExplanation}
      </p>
      {scribe ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.14em] text-faint">
            AnyScribe storage
          </p>
          <p className="break-all font-mono text-xs text-fg">{scribe.address}</p>
          <p className="text-xs text-muted">
            {scribe.mime || "file"} · {scribe.contentLength} bytes
            {scribe.gatewayUri ? " · HTTP URI is a gateway" : ""}
            {!scribe.published ? " · not published" : ""}
            {!scribe.mintBound ? " · mint not bound" : ""}
          </p>
          <div>
            <Button variant="secondary" size="sm" asChild>
              <a
                href={`https://solscan.io/account/${scribe.address}`}
                target="_blank"
                rel="noreferrer"
              >
                Solscan storage
              </a>
            </Button>
          </div>
        </div>
      ) : null}
      {flags.packedMint ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.14em] text-faint">
            Both mints
          </p>
          <p className="break-all font-mono text-xs text-fg">
            {scan.grade === "G3" ? "tradeable" : "this"} {scan.mint}
          </p>
          <p className="break-all font-mono text-xs text-fg">
            {scan.grade === "G3" ? "packed" : "linked"} {flags.packedMint}
          </p>
        </div>
      ) : null}
    </div>
  );
}
