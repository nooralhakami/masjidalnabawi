"""Music + UI sounds for the 9:16 teaser, synthesized here (nothing to license).
Calm, warm bed at the film's tempo (36 beats = 1178 frames at 60 fps, ~110 BPM): sustained chords, a soft
kalimba-like note on every beat, a low pulse every two beats. A subtle sound on every contact of the dot.
The loop is rendered twice and the second pass kept, so reverb tails wrap and the file loops seamlessly.
Usage: python3 audio.py <out.wav>"""
import sys, wave
import numpy as np

SR = 48000
T = 1178 / 60
B = T / 36
N = int(round(T * SR))
rng = np.random.default_rng(11)

def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)

def tone(f, dur, decay, harm=((1, 1.0), (2, 0.25), (3, 0.08)), attack=0.004):
    n = int(dur * SR); t = np.arange(n) / SR
    env = np.minimum(1, t / attack) * np.exp(-t * decay)
    return sum(a * np.sin(2 * np.pi * f * k * t) for k, a in harm) * env

def place(buf, sig, at, gain, pan=0.0):
    i = int(at * SR) % (2 * N)
    l, r = gain * (1 - pan) / 1.0, gain * (1 + pan) / 1.0
    end = min(len(buf), i + len(sig))
    buf[i:end, 0] += sig[: end - i] * l
    buf[i:end, 1] += sig[: end - i] * r

L = 2 * N
music = np.zeros((L, 2))
t = np.arange(L) / SR
# chords every 12 beats: Dmaj9, Bm9, Gmaj7 (and around again)
CH = [[50, 54, 57, 61, 64], [47, 50, 54, 57, 61], [43, 47, 50, 54, 57]]
seg = 12 * B
for loop in range(2):
    for i, notes in enumerate(CH):
        a = loop * T + i * seg
        env = np.clip((t - a + 0.6) / 1.2, 0, 1) * np.clip((a + seg + 0.6 - t) / 1.2, 0, 1)
        env = np.sin(env * np.pi / 2) ** 2
        for k, m in enumerate(notes):
            for ch, det in ((0, 0.999), (1, 1.001)):
                music[:, ch] += 0.055 * env * np.sin(2 * np.pi * hz(m) * det * t + k) * (1 if k < 3 else 0.6)
# kalimba-like note on every beat, arpeggiating the chord (an octave up), soft
for beat in range(72):
    chord = CH[(beat % 36) // 12]
    m = chord[[0, 2, 4, 2][beat % 4]] + 12
    place(music, tone(hz(m), 1.4, 5.5, ((1, 1.0), (3, 0.12), (4.2, 0.05))), beat * B, 0.11 if beat % 4 else 0.15, pan=(-0.25 if beat % 2 else 0.25))
    if beat % 2 == 0:  # low pulse
        place(music, tone(hz(chord[0] - 12), 0.5, 9, ((1, 1.0), (2, 0.2))), beat * B, 0.16)
    # light shaker on the off-beat
    sh = rng.standard_normal(int(0.06 * SR)) * np.exp(-np.arange(int(0.06 * SR)) / SR * 60)
    place(music, np.convolve(sh, np.ones(6) / 6, 'same') * 0.5, beat * B + B / 2, 0.035)

# small room reverb on the music
ir_n = int(1.6 * SR)
ir = rng.standard_normal((ir_n, 2)) * np.exp(-np.arange(ir_n) / (0.35 * SR))[:, None]
ir /= np.abs(ir).sum(axis=0) / 6
wet = np.stack([np.fft.irfft(np.fft.rfft(music[:, c], 2 * L) * np.fft.rfft(ir[:, c], 2 * L))[:L] for c in range(2)], 1)
music = music + 0.35 * wet

# UI sounds on every contact (beats), both passes
sfx = np.zeros((L, 2))
def tap(f=1500, g=0.22):   # soft glass tap
    return tone(f, 0.12, 55, ((1, 1.0), (1.9, 0.35)))
def thock(g=0.3):          # finger on the field
    return tone(220, 0.2, 30, ((1, 1.0), (2.7, 0.2)))
def click():
    return tone(2600, 0.04, 140, ((1, 1.0),))
def chime():
    a = tone(hz(74), 1.6, 2.6); b2 = np.pad(tone(hz(78), 1.4, 2.8), (int(0.09 * SR), len(a)))[: len(a)]; return a + 0.7 * b2
EVENTS = [
    (1, thock(), 0.30), (2, tap(1300), 0.10),
    (4, click(), 0.16), (5, click(), 0.16), (6, click(), 0.16),
    (7, tap(1500), 0.18), (8, tap(900), 0.08), (9, tap(1500), 0.16), (10, thock(), 0.22),
    (11, tap(1200), 0.12), (16, tap(1700), 0.18),
    (17, click(), 0.22), (18, tap(1100), 0.14), (20.3, tap(1600), 0.14),
    (20.75, tap(800), 0.07), (21, tap(1500), 0.16), (22.75, tap(800), 0.07), (23, tap(1500), 0.16),
    (24.75, tap(800), 0.07), (25, tap(1500), 0.16), (26, click(), 0.08), (27, click(), 0.08),
    (28, chime(), 0.20), (28, thock(), 0.22), (28.25, thock(), 0.12),
    (30, tap(1400), 0.16), (31.6, tap(1600), 0.12), (35.5, tap(1500), 0.16),
]
for loop in range(2):
    for b, sig, g in EVENTS:
        place(sfx, sig, loop * T + b * B, g)

mix = music + sfx
out = mix[N:2 * N]  # second pass: tails from the first pass wrap into the start
out *= 10 ** (-3 / 20) / np.abs(out).max()
with wave.open(sys.argv[1], 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((out * 32767).astype('<i2').tobytes())
print('audio', sys.argv[1], round(N / SR, 4), 's')
