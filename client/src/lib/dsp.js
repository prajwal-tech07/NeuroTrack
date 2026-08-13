/**
 * Small DSP toolkit used by the browser-side feature extractors.
 * Everything here is dependency-free and runs on plain Float32Array/Array data.
 */

export const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

export function std(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((acc, v) => acc + (v - m) ** 2, 0) / (arr.length - 1));
}

/** Coefficient of variation — std/mean, the standard "how irregular is this" measure. */
export function cv(arr) {
  const m = mean(arr);
  return Math.abs(m) < 1e-9 ? 0 : std(arr) / Math.abs(m);
}

export function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export const rms = (arr) => Math.sqrt(mean(Array.from(arr, (v) => v * v)));

/** Removes DC offset and slow drift with a simple moving-average high-pass. */
export function detrend(arr, window = 15) {
  const out = new Array(arr.length);
  const half = Math.floor(window / 2);
  for (let i = 0; i < arr.length; i++) {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(arr.length - 1, i + half); j++) {
      sum += arr[j];
      n++;
    }
    out[i] = arr[i] - sum / n;
  }
  return out;
}

/** Centred moving average — used to smooth landmark traces before peak picking. */
export function smooth(arr, window = 5) {
  if (window < 2) return [...arr];
  const out = new Array(arr.length);
  const half = Math.floor(window / 2);
  for (let i = 0; i < arr.length; i++) {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(arr.length - 1, i + half); j++) {
      sum += arr[j];
      n++;
    }
    out[i] = sum / n;
  }
  return out;
}

/**
 * Iterative radix-2 Cooley-Tukey FFT, in place on {re, im}.
 * Input length must be a power of two.
 */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

export const nextPow2 = (n) => 2 ** Math.ceil(Math.log2(Math.max(2, n)));

/**
 * Power spectrum of a real signal, Hann-windowed and zero-padded to a power of 2.
 * @returns {{freqs: number[], power: number[]}} bins up to Nyquist
 */
export function powerSpectrum(signal, sampleRate) {
  const n = nextPow2(signal.length);
  const re = new Float64Array(n);
  const im = new Float64Array(n);

  for (let i = 0; i < signal.length; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (signal.length - 1 || 1));
    re[i] = signal[i] * w;
  }

  fft(re, im);

  const half = n >> 1;
  const freqs = new Array(half);
  const power = new Array(half);
  for (let k = 0; k < half; k++) {
    freqs[k] = (k * sampleRate) / n;
    power[k] = (re[k] * re[k] + im[k] * im[k]) / n;
  }
  return { freqs, power };
}

/**
 * Dominant frequency and the share of total power inside a band.
 * @returns {{peakHz: number, peakPower: number, bandRatio: number, totalPower: number}}
 */
export function spectralPeak(signal, sampleRate, { minHz = 0.5, maxHz = 15, bandLo = 3.5, bandHi = 6.5 } = {}) {
  if (signal.length < 8) return { peakHz: 0, peakPower: 0, bandRatio: 0, totalPower: 0 };

  const { freqs, power } = powerSpectrum(detrend(signal, 21), sampleRate);

  let peakHz = 0;
  let peakPower = 0;
  let bandPower = 0;
  let totalPower = 0;

  for (let k = 1; k < freqs.length; k++) {
    const f = freqs[k];
    if (f < minHz || f > maxHz) continue;
    totalPower += power[k];
    if (f >= bandLo && f <= bandHi) bandPower += power[k];
    if (power[k] > peakPower) {
      peakPower = power[k];
      peakHz = f;
    }
  }

  return {
    peakHz,
    peakPower,
    bandRatio: totalPower > 0 ? bandPower / totalPower : 0,
    totalPower,
  };
}

/**
 * Autocorrelation pitch detection for one frame.
 * @returns {{f0: number, clarity: number}} f0 in Hz, clarity 0..1 (0 = unvoiced)
 */
export function detectPitch(frame, sampleRate, { minHz = 60, maxHz = 500, threshold = 0.3 } = {}) {
  const n = frame.length;
  const energy = rms(frame);
  if (energy < 0.008) return { f0: 0, clarity: 0 };

  const minLag = Math.floor(sampleRate / maxHz);
  const maxLag = Math.min(n - 1, Math.floor(sampleRate / minHz));
  if (maxLag <= minLag) return { f0: 0, clarity: 0 };

  // Normalised square-difference function (the YIN/McLeod family), which is far
  // more robust than raw autocorrelation for voice.
  let bestLag = -1;
  let bestValue = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let num = 0;
    let denA = 0;
    let denB = 0;
    for (let i = 0; i + lag < n; i++) {
      num += frame[i] * frame[i + lag];
      denA += frame[i] * frame[i];
      denB += frame[i + lag] * frame[i + lag];
    }
    const den = Math.sqrt(denA * denB);
    const value = den > 0 ? num / den : 0;
    if (value > bestValue) {
      bestValue = value;
      bestLag = lag;
    }
  }

  if (bestLag < 0 || bestValue < threshold) return { f0: 0, clarity: bestValue };
  return { f0: sampleRate / bestLag, clarity: bestValue };
}

/**
 * Peak picking with a minimum separation and prominence, used for step and
 * finger-tap detection.
 * @returns {number[]} indices of detected peaks
 */
export function findPeaks(signal, { minDistance = 3, minProminence = 0 } = {}) {
  const peaks = [];
  for (let i = 1; i < signal.length - 1; i++) {
    if (signal[i] > signal[i - 1] && signal[i] >= signal[i + 1]) {
      if (signal[i] < minProminence) continue;
      if (peaks.length && i - peaks[peaks.length - 1] < minDistance) {
        // Keep whichever of the two is taller.
        if (signal[i] > signal[peaks[peaks.length - 1]]) peaks[peaks.length - 1] = i;
        continue;
      }
      peaks.push(i);
    }
  }
  return peaks;
}

/** Converts a frequency ratio to semitones — the natural unit for pitch spread. */
export const toSemitones = (ratio) => 12 * Math.log2(Math.max(1e-6, ratio));

/** Standard deviation of an F0 track expressed in semitones. */
export function pitchSpreadSemitones(f0Track) {
  const voiced = f0Track.filter((f) => f > 0);
  if (voiced.length < 4) return 0;
  const m = median(voiced);
  if (m <= 0) return 0;
  return std(voiced.map((f) => toSemitones(f / m)));
}

export const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Euclidean distance between two {x, y} landmark points. */
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** 3D variant, when depth is meaningful. */
export const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
