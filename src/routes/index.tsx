import { createFileRoute } from "@tanstack/react-router";
import { Checker } from "@/components/checker";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <main className="min-h-dvh bg-bg">
      <Checker />
    </main>
  );
}
