export type WavInfo = {
  channels: number;
  sampleRate: number;
  bits: number;
  duration: number;
  samples: Float32Array;
};

function readU32(buf: Uint8Array, offset: number): number {
  return (
    buf[offset]! |
    (buf[offset + 1]! << 8) |
    (buf[offset + 2]! << 16) |
    (buf[offset + 3]! << 24)
  ) >>> 0;
}

function readU16(buf: Uint8Array, offset: number): number {
  return buf[offset]! | (buf[offset + 1]! << 8);
}

export function parseWav(buf: ArrayBuffer): WavInfo | null {
  const bytes = new Uint8Array(buf);
  if (bytes.length < 44) return null;
  const riff = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  const wave = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
  if (riff !== "RIFF" || wave !== "WAVE") return null;

  const channels = readU16(bytes, 22) || 1;
  const sampleRate = readU32(bytes, 24) || 8000;
  const bits = readU16(bytes, 34) || 8;

  let dataOffset = 12;
  let dataSize = 0;
  while (dataOffset + 8 <= bytes.length) {
    const id = String.fromCharCode(
      bytes[dataOffset]!,
      bytes[dataOffset + 1]!,
      bytes[dataOffset + 2]!,
      bytes[dataOffset + 3]!,
    );
    const size = readU32(bytes, dataOffset + 4);
    if (id === "data") {
      dataOffset += 8;
      dataSize = size;
      break;
    }
    dataOffset += 8 + size + (size % 2);
  }
  if (dataSize <= 0) return null;

  const end = Math.min(bytes.length, dataOffset + dataSize);
  const pcm = bytes.subarray(dataOffset, end);
  const depth = bits === 16 ? 2 : 1;
  const count = Math.floor(pcm.length / depth / channels);
  const samples = new Float32Array(count);

  if (bits === 16) {
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    for (let i = 0; i < count; i += 1) {
      samples[i] = view.getInt16(i * 2 * channels, true) / 32768;
    }
  } else {
    for (let i = 0; i < count; i += 1) {
      samples[i] = (pcm[i * channels]! - 128) / 128;
    }
  }

  const duration = count / sampleRate;
  return { channels, sampleRate, bits, duration, samples };
}

export async function loadWavFromSrc(src: string): Promise<WavInfo | null> {
  try {
    const res = await fetch(src);
    const buf = await res.arrayBuffer();
    return parseWav(buf);
  } catch {
    return null;
  }
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 10) return `${seconds.toFixed(2)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatBytes(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
