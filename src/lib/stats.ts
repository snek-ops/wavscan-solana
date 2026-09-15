import { createServerFn } from "@tanstack/react-start";

export const getScanCount = createServerFn({ method: "GET" }).handler(
  async (): Promise<number> => {
    const { readScanCount } = await import("./stats.server");
    return readScanCount();
  },
);
