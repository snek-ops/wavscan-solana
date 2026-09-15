import { PublicKey } from "@solana/web3.js";
import {
  ANYSCRIBE_COMMITMENT_ALG,
  ANYSCRIBE_HEADER_BYTES,
  ANYSCRIBE_PROGRAM,
  chainCommitment,
  looksLikeAnyScribeGateway,
  parseAnyScribeHeader,
  storageHintFromUri,
  type AnyScribeProof,
} from "./anyscribe";

const RPCS = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
];

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  let last: Error | null = null;
  for (const url of RPCS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) {
        last = new Error(`RPC ${res.status}`);
        continue;
      }
      const body = (await res.json()) as { result?: T; error?: { message?: string } };
      if (body.error) {
        last = new Error(body.error.message ?? "RPC error");
        continue;
      }
      return body.result as T;
    } catch (err) {
      last = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw last ?? new Error("RPC failed");
}

type Acc = {
  owner: string;
  space: number;
  data: [string, string];
};

async function readSlice(address: string, offset: number, length: number): Promise<Acc | null> {
  const result = await rpc<{ value: Acc | null }>("getAccountInfo", [
    address,
    { encoding: "base64", dataSlice: { offset, length } },
  ]);
  return result?.value ?? null;
}

function decodeB64(data: [string, string] | undefined): Uint8Array {
  if (!data?.[0]) return new Uint8Array();
  return Uint8Array.from(Buffer.from(data[0], "base64"));
}

function hintsFromScan(uri: string | null, extras: Array<{ key: string; value: string }>): string[] {
  const out: string[] = [];
  const fromUri = storageHintFromUri(uri);
  if (fromUri) out.push(fromUri);
  for (const field of extras) {
    const hint = storageHintFromUri(field.value);
    if (hint) out.push(hint);
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(field.value) && /inscrib|storage|scribe/i.test(field.key)) {
      out.push(field.value);
    }
  }
  return [...new Set(out)];
}

export async function verifyAnyScribeStorage(
  address: string,
  expectedMint: string,
): Promise<AnyScribeProof | null> {
  try {
    new PublicKey(address);
  } catch {
    return null;
  }

  const headerAcc = await readSlice(address, 0, ANYSCRIBE_HEADER_BYTES);
  if (!headerAcc) return null;
  const headerBytes = decodeB64(headerAcc.data);
  if (headerBytes.length < 8) return null;

  let header;
  try {
    header = parseAnyScribeHeader(headerBytes);
  } catch {
    return null;
  }

  const ownerOk = headerAcc.owner === ANYSCRIBE_PROGRAM;
  const published = header.stateName === "published";
  const mintBound = header.mint === expectedMint;
  const lengthOk = header.contentLength > 0 && header.written >= header.contentLength;
  const poolBound = Boolean(header.pool);
  const configBound = Boolean(header.quoteMint);

  let commitmentChecked = false;
  let commitmentOk: boolean | null = null;
  const maxHash = 256_000;
  if (lengthOk && header.contentLength <= maxHash) {
    try {
      const bodyAcc = await readSlice(address, ANYSCRIBE_HEADER_BYTES, header.contentLength);
      if (bodyAcc) {
        const body = decodeB64(bodyAcc.data);
        if (body.length === header.contentLength) {
          const digest = await chainCommitment(body);
          const got = Array.from(digest)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
          commitmentChecked = true;
          commitmentOk = got === header.commitment;
        }
      }
    } catch {
      commitmentChecked = false;
      commitmentOk = null;
    }
  }

  return {
    address,
    owner: headerAcc.owner,
    space: headerAcc.space,
    header,
    published,
    mintBound,
    ownerOk,
    magicOk: true,
    lengthOk,
    poolBound,
    configBound,
    commitmentAlgorithm: ANYSCRIBE_COMMITMENT_ALG,
    commitmentChecked,
    commitmentOk,
    gatewayUri: false,
  };
}

export async function findAnyScribeForMint(input: {
  mint: string;
  uri: string | null;
  extras: Array<{ key: string; value: string }>;
}): Promise<AnyScribeProof | null> {
  const hints = hintsFromScan(input.uri, input.extras);
  for (const address of hints) {
    if (address === input.mint) continue;
    const proof = await verifyAnyScribeStorage(address, input.mint);
    if (proof) {
      proof.gatewayUri = looksLikeAnyScribeGateway(input.uri);
      return proof;
    }
  }
  return null;
}
