"""Soft tonal bed for the v2 film: slow, warm sustained chords (no melody, no percussion), synthesized here so
there is nothing to license. Usage: python3 make-pad.py <out.wav> [seconds]"""
import sys, wave
import numpy as np

SR = 48000
DUR = float(sys.argv[2]) if len(sys.argv) > 2 else 92.0
N = int(SR * DUR)
t = np.arange(N) / SR
rng = np.random.default_rng(7)

def hz(m):  # MIDI note -> Hz
    return 440.0 * 2 ** ((m - 69) / 12)

# D major colour: Dmaj9 · Bm9 · Gmaj7 · Asus2 — two passes, ~11.5 s each.
CHORDS = [[50, 54, 57, 61, 64], [47, 50, 54, 57, 61], [43, 47, 50, 54, 57], [45, 52, 57, 59, 64]] * 2
SEG = DUR / len(CHORDS)
XF = 3.0  # crossfade seconds

out = np.zeros((N, 2))
for i, notes in enumerate(CHORDS):
    a, b = i * SEG - XF / 2, (i + 1) * SEG + XF / 2
    env = np.clip((t - a) / XF, 0, 1) * np.clip((b - t) / XF, 0, 1)
    env = np.sin(env * np.pi / 2) ** 2
    if not env.any():
        continue
    for k, m in enumerate(notes):
        f = hz(m)
        for ch, det in ((0, 0.9985), (1, 1.0015)):
            ph = rng.uniform(0, 2 * np.pi)
            v = np.sin(2 * np.pi * f * det * t + ph) + 0.18 * np.sin(2 * np.pi * 2 * f * det * t + ph)
            trem = 1 + 0.08 * np.sin(2 * np.pi * (0.07 + 0.02 * k) * t + k)
            out[:, ch] += v * env * trem * (0.9 if k < 3 else 0.55)

# Gentle low-pass (one pole, ~1.6 kHz) for warmth.
alpha = 1 - np.exp(-2 * np.pi * 1600 / SR)
for ch in range(2):
    y = np.empty(N); acc = 0.0; x = out[:, ch]
    for n in range(N):
        acc += alpha * (x[n] - acc); y[n] = acc
    out[:, ch] = y

# Small hall: convolve with a decaying noise tail (2.4 s).
L = int(2.4 * SR)
ir = rng.standard_normal((L, 2)) * np.exp(-np.arange(L) / (0.55 * SR))[:, None]
ir /= np.abs(ir).sum(axis=0)
wet = np.stack([np.convolve(out[:, c], ir[:, c])[:N] for c in range(2)], axis=1)
mix = 0.65 * out + 0.9 * wet / (np.abs(wet).max() / np.abs(out).max())

fade = np.clip(t / 3.0, 0, 1) * np.clip((DUR - t) / 4.0, 0, 1)
mix *= fade[:, None]
mix *= 10 ** (-14 / 20) / np.abs(mix).max()  # peak -14 dBFS; final level set in the mix
pcm = (mix * 32767).astype('<i2')
with wave.open(sys.argv[1], 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('pad', sys.argv[1], DUR)
