# wavscan

Paste a Solana mint. wavscan reads Token-2022 `tokenMetadata` (and Metaplex if that is all the mint has) and tells you whether the **file** is on the mint, only pointed at, or not there.

Live rule: **v1 is a transaction format. Inscribed means media bytes in live account state.**

## Grades

| Grade | Label | Meaning |
| --- | --- | --- |
| **G4** | on-mint file | `data:` URI (or nested `data:` media) lives in this mint's TokenMetadata TLV. Rent pays for it. Typical size: a couple of KB. |
| **G5** | fully on-chain file | Inscription program / chunked writes larger than a single 4 KB v1 pack. Reserved; not classified yet. |
| **G3** | inscription on linked mint | This CA's URI is HTTP/IPFS. A companion mint holds the packed `data:` file. Not assigned until companion hunt ships. |
| **G2** | ledger-packed artifact | Bytes sit in a memo / instruction of a confirmed tx, not in the mint. Reserved until memo scan ships. |
| **G1** | on-chain metadata, off-chain file | Name/symbol/URI on-chain. File is HTTP, IPFS, or Arweave. Honest default for pump coins. |
| **G0** | off-chain file | No usable pointer and no packed bytes. |

A `data:application/json` wrapper that only contains `https` image links is **G1**, not G4.

`claimMismatch` is set when the name / extras say "inscribed" / "on-chain image" / "in the coin" and the grade is G0–G2.

## What it scans today

- Token-2022 mint extensions: `tokenMetadata`, `metadataPointer`
- Metaplex metadata PDA for classic SPL / Token-2022 without an on-mint URI
- `data:` audio and images on the mint URI or `additionalMetadata`
- Off-chain JSON `image` / `animation_url` / audio keys
- GIF magic bytes (`GIF87a` / `GIF89a`) so a `.png` name cannot fake a GIF

It does **not** yet walk launch transactions for companion mints or `ONEPAGE` memos. Those stay G1 until that hunt lands.

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
src/lib/solana/inspect.server.ts   RPC + metadata unpack
src/lib/solana/grade.ts            G0–G5 classifier (no RPC)
src/lib/solana/detect-audio.ts
src/lib/solana/detect-image.ts
src/components/checker.tsx         UI
```

## Examples

| Token | Expected now |
| --- | --- |
| bruh (`Bepk57…`) | G4 — `data:application/json` with SVG + WAV inside |
| ordinary pump IPFS Token-2022 | G1 |
| USDC | G1 / silent |

Companion-mint (HUHCAT vs DVD4q) and memo-cart (onepage.surf) cases need the P1 hunt before they leave G1.
