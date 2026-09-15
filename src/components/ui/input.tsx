import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-12 w-full rounded-md border border-border bg-surface px-4 text-sm text-fg shadow-none transition-[border-color,box-shadow] duration-(--motion-quick) ease-(--ease-out) placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-50 font-mono",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
