import { GRADE_TONE, type Grade } from "@/lib/solana/grade";

const TEXT: Record<typeof GRADE_TONE[Grade], string> = {
  faint: "text-faint",
  muted: "text-muted",
  warn: "text-warn",
  accent: "text-accent",
  ok: "text-ok",
  fg: "text-fg",
};

const EDGE: Record<typeof GRADE_TONE[Grade], string> = {
  faint: "border-l-faint",
  muted: "border-l-muted",
  warn: "border-l-warn",
  accent: "border-l-accent",
  ok: "border-l-ok",
  fg: "border-l-fg",
};

export function gradeTextClass(grade: Grade): string {
  return TEXT[GRADE_TONE[grade]];
}

export function gradeEdgeClass(grade: Grade): string {
  return EDGE[GRADE_TONE[grade]];
}
