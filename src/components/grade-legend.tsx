import { useState } from "react";
import { GRADE_META, GRADES } from "@/lib/solana/grade";
import { gradeTextClass } from "@/components/grade-style";
import { cn } from "@/lib/utils";

type GuideTab = "grades" | "verify";

export function GradeLegend() {
  const [tab, setTab] = useState<GuideTab>("grades");

  return (
    <section className="flex flex-col gap-5">
      <div
        role="tablist"
        aria-label="Grade guide"
        className="flex gap-1 border-b border-border"
      >
        <TabButton
          id="grades"
          active={tab === "grades"}
          onClick={() => setTab("grades")}
        >
          Grades
        </TabButton>
        <TabButton
          id="verify"
          active={tab === "verify"}
          onClick={() => setTab("verify")}
        >
          Don’t trust, verify
        </TabButton>
      </div>

      {tab === "grades" ? <GradesPanel /> : <VerifyPanel />}
    </section>
  );
}

function TabButton({
  id,
  active,
  onClick,
  children,
}: {
  id: string;
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={`guide-tab-${id}`}
      aria-selected={active}
      aria-controls={`guide-panel-${id}`}
      onClick={onClick}
      className={cn(
        "-mb-px border-b px-3 py-2 text-xs font-medium uppercase tracking-[0.16em] transition-colors duration-(--motion-quick)",
        active
          ? "border-fg text-fg"
          : "border-transparent text-faint hover:text-muted",
      )}
    >
      {children}
    </button>
  );
}

function GradesPanel() {
  return (
    <div
      id="guide-panel-grades"
      role="tabpanel"
      aria-labelledby="guide-tab-grades"
      className="flex flex-col gap-5"
    >
      <ul className="flex flex-col gap-3">
        {GRADES.map((g) => (
          <li
            key={g}
            className="grid gap-1 sm:grid-cols-[3.5rem_1fr] sm:items-baseline"
          >
            <span
              className={cn(
                "font-mono text-sm font-medium tabular-nums",
                gradeTextClass(g),
              )}
            >
              {g}
            </span>
            <span className="text-sm leading-relaxed text-muted">
              <span className="text-fg">{GRADE_META[g].label}.</span>{" "}
              {GRADE_META[g].short}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs leading-relaxed text-faint">
        Color runs dim to bright: gray is a link, sand is a transaction blob,
        sage is a linked mint, green is the file in this mint. v1 is a
        transaction format, not a file.
      </p>
    </div>
  );
}

function VerifyPanel() {
  return (
    <div
      id="guide-panel-verify"
      role="tabpanel"
      aria-labelledby="guide-tab-verify"
      className="flex flex-col gap-4"
    >
      <p className="text-sm leading-relaxed text-fg">
        Don’t trust this page. Open the same address on Solscan and check the
        bytes yourself.
      </p>
      <ol className="flex flex-col gap-3 text-sm leading-relaxed text-muted">
        <li>
          <span className="text-fg">1. Search the address.</span> Paste it into{" "}
          <a
            href="https://solscan.io"
            target="_blank"
            rel="noreferrer"
            className="text-accent underline-offset-2 hover:underline"
          >
            solscan.io
          </a>
          . Confirm it is a token, an NFT, a wallet, or nothing — same as the
          scanner.
        </li>
        <li>
          <span className="text-fg">2. Open Metadata.</span> On a token page,
          read the URI. <span className="text-fg">https / ipfs / ar</span> means
          the file is off-chain (G0/G1).{" "}
          <span className="text-fg">data:</span> means the bytes sit on this
          mint (G4).
        </li>
        <li>
          <span className="text-fg">3. Ignore the gateway.</span> A URI like
          anyscribe.fun/inscriptions/… is a reader, not the store. Solscan the
          storage account the scanner names. Owner should be{" "}
          <span className="font-mono text-fg">Fn7ASHW…</span>. First 8 bytes of
          data decode as ANYSCRIB. State published. Mint field equals the token
          you scanned. That is G5.
        </li>
        <li>
          <span className="text-fg">4. Two mints (G3).</span> Solscan both
          addresses. The tradeable CA still has an HTTP/IPFS URI. The packed
          mint holds the data: file.
        </li>
        <li>
          <span className="text-fg">5. Memo carts (G2).</span> Open the
          transaction, not the token. Look for a Memo instruction (ONEPAGE or a
          fat payload). That is ledger history. Wallets will not show it as the
          image.
        </li>
        <li>
          <span className="text-fg">6. v1 is a wire format.</span> Solscan may
          label the create tx “v1”. That is a 4 KB envelope: prefix 0x81,
          signatures at the tail, limits in transactionConfig. It does not mean
          the file is inscribed.
        </li>
      </ol>
    </div>
  );
}
