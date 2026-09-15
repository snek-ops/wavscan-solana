# wavscan

Paste a Solana mint. wavscan reads Token-2022 `tokenMetadata` (and Metaplex if that is all the mint has) and tells you whether the **file** is on the mint, in a linked program account, only pointed at, or not there.

Live rule: **v1 is a transaction format. Inscribed means media bytes in live account state.**

## Grades

| Grade | Label | Meaning |
| --- | --- | --- |
| **G5** | fully on-chain file | Bytes live in a program-owned storage account (AnyScribe today) or chunked inscription writes. Not a 4 KB v1 pack. The HTTP metadata/content URL is a **gateway onto those slices**, not the store. |
| **G4** | on-mint file | `data:` URI (or nested `data:` media) lives in this mint's TokenMetadata TLV. Rent pays for it. Typical size: a couple of KB. |
| **G3** | inscription on linked mint | This CA's URI is HTTP/IPFS. A companion mint holds the packed `data:` file. Not assigned until companion hunt ships. |
| **G2** | ledger-packed artifact | Bytes sit in a memo / instruction of a confirmed tx, not in the mint. Reserved until memo scan ships. |
| **G1** | on-chain metadata, off-chain file | Name/symbol/URI on-chain. File is HTTP, IPFS, or Arweave. Honest default for pump coins. |
| **G0** | off-chain file | No usable pointer and no packed bytes. |

A `data:application/json` wrapper that only contains `https` image links is **G1**, not G4.

`claimMismatch` is set when the name / extras say "inscribed" / "on-chain image" / "in the coin" and the grade is G0–G2.

G5 is **not** G1 just because the coin page URI is `https://anyscribe.fun/inscriptions/…`. That URI is a reader. The scanner validates the storage account over RPC.

## Transaction v1 reads

Every transaction fetch uses `maxSupportedTransactionVersion: 1`.

- Wire prefix `0x81` = v1 (4,096-byte envelope). That is a tx format, not a file standard.
- Signatures are parsed from the **tail** of the envelope (`numRequiredSignatures * 64`).
- Compute limits and priority fee come from `transactionConfig` / the v1 config mask, **not** from ComputeBudget instructions.

`readTransaction(signature)` in `inspect.server.ts` is the only tx entry point future companion / memo hunts should use.

## AnyScribe (G5)

Program: `Fn7ASHWWA8dBEPQgXhcQTgRxeWVgadHZ11pTBar4VdLx`.

The scanner does **not** grade the HTTP gateway. It:

1. Pulls a storage address from the URI (`/inscriptions/<pubkey>`) or from extra metadata keys.
2. `getAccountInfo` with `dataSlice` for the 512-byte header, then the content body.
3. Checks `ANYSCRIB` magic, published state, program owner, mint binding, `contentLength` / written, pool / quote-mint bindings.
4. Recomputes `anyscribe-sha256-chain-v1` over the content slices when the body is small enough.

Only a passing proof is G5. A mint whose URI is the gateway but whose account fails those checks stays G1.

## What it scans today

- Token-2022 mint extensions: `tokenMetadata`, `metadataPointer`
- Metaplex metadata PDA for classic SPL / Token-2022 without an on-mint URI
- `data:` audio and images on the mint URI or `additionalMetadata`
- Off-chain JSON `image` / `animation_url` / audio keys
- GIF magic bytes (`GIF87a` / `GIF89a`) so a `.png` name cannot fake a GIF
- AnyScribe program-owned storage via RPC slices
- v1 transaction decode helpers (prefix, tail signatures, `transactionConfig`)

It does **not** yet walk launch transactions for companion mints or `ONEPAGE` memos. Those stay G1 until that hunt lands. The hunt, when it ships, must go through `readTransaction`.

## Run

```bash
npm install
npm run dev
```

App defaults to `http://127.0.0.1:8080`.

```bash
npm test
npm run typecheck
```

Set a custom RPC by editing the list in `src/lib/solana/inspect.server.ts` if public endpoints rate-limit you.

## Layout

```
src/lib/solana/inspect.server.ts   RPC + metadata unpack + v1 tx reads
src/lib/solana/grade.ts            G0–G5 classifier
src/lib/solana/v1-tx.ts            0x81 wire parse, transactionConfig
src/lib/solana/anyscribe.ts        ANYSCRIB header + sha256-chain-v1
src/lib/solana/anyscribe.server.ts RPC dataSlice verification
src/lib/solana/detect-audio.ts
src/lib/solana/detect-image.ts
src/components/checker.tsx         UI
```

## Examples

| Token | Expected now |
| --- | --- |
| bruh (`Bepk57…`) | G4 — `data:application/json` with SVG + WAV inside |
| AnyScribe mint whose storage account verifies | G5 — program account, not the HTTP gateway |
| ordinary pump IPFS Token-2022 | G1 |
| USDC | G1 / silent |

Companion-mint (HUHCAT vs DVD4q) and memo-cart (onepage.surf) cases need the P1 hunt before they leave G1.
