const RPCS = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
  "https://solana.drpc.org",
];

async function rpcOnce<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    if (res.status === 429) throw new Error("rate limited");
    throw new Error(`RPC ${res.status}`);
  }
  const body = (await res.json()) as {
    result?: T;
    error?: { message?: string; code?: number };
  };
  if (body.error) {
    const code = body.error.code;
    const message = body.error.message ?? "RPC error";
    if (code === 429 || /rate.?limit|too many requests/i.test(message)) {
      throw new Error("rate limited");
    }
    throw new Error(message);
  }
  return body.result as T;
}

export function rpcErrorMessage(err: unknown): string {
  const parts =
    err instanceof AggregateError
      ? err.errors.map((e) => (e instanceof Error ? e.message : String(e)))
      : [err instanceof Error ? err.message : String(err)];
  const raw = parts.join(" ");
  if (/rate limit/i.test(raw)) {
    return "Solana RPC is rate-limiting. Try again in a moment.";
  }
  if (/timeout|abort|timed out/i.test(raw)) {
    return "Solana RPC timed out. Try again.";
  }
  if (/42915|maxSupportedTransactionVersion|unsupported transaction version/i.test(raw)) {
    return "RPC rejected a v1 transaction. Try again.";
  }
  return "Could not reach Solana RPC. Try again in a moment.";
}

/** Race public RPCs. First JSON-RPC success wins; all failing becomes a user-facing error. */
export async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  try {
    return await Promise.any(RPCS.map((url) => rpcOnce<T>(url, method, params)));
  } catch (err) {
    throw new Error(rpcErrorMessage(err));
  }
}
