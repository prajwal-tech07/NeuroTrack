import fs from 'node:fs';
/** Minimal PCM16 / float32 WAV reader returning an AudioBuffer-like object. */
export function readWav(path, { fromSec = 0, toSec = Infinity } = {}) {
  const b = fs.readFileSync(path);
  let off = 12, fmt = null, data = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4); const size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { format: b.readUInt16LE(off + 8), ch: b.readUInt16LE(off + 10), sr: b.readUInt32LE(off + 12), bits: b.readUInt16LE(off + 22) };
    if (id === 'data') { data = b.subarray(off + 8, off + 8 + size); break; }
    off += 8 + size + (size % 2);
  }
  const bytes = fmt.bits / 8, frames = Math.floor(data.length / (bytes * fmt.ch));
  const s0 = Math.min(frames, Math.floor(fromSec * fmt.sr)), s1 = Math.min(frames, Math.floor(toSec * fmt.sr));
  const out = new Float32Array(s1 - s0);
  for (let i = s0; i < s1; i++) {
    let v = 0;
    for (let c = 0; c < fmt.ch; c++) {
      const p = (i * fmt.ch + c) * bytes;
      v += fmt.format === 3 ? data.readFloatLE(p) : fmt.bits === 16 ? data.readInt16LE(p) / 32768 : fmt.bits === 24 ? data.readIntLE(p, 3) / 8388608 : data.readInt32LE(p) / 2147483648;
    }
    out[i - s0] = v / fmt.ch;
  }
  return { sampleRate: fmt.sr, duration: out.length / fmt.sr, getChannelData: () => out, samples: out };
}
