import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { TokenScan } from "./types";

const Input = z.object({
  mint: z.string().min(1).max(240),
});

export const checkToken = createServerFn({ method: "POST" })
  .validator((data) => Input.parse(data))
  .handler(async ({ data }): Promise<TokenScan> => {
    const { inspectMint } = await import("./inspect.server");
    return inspectMint(data.mint);
  });
