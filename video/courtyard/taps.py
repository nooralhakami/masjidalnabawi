"""Optional soft UI taps for the courtyard film, as a separate track (the film itself has no music).
One quiet glass tap on every landing of the gold dot (the end times of MOVES in src.html), a soft two-note
chime on arrival at 227 and when the dot settles as the QR's centre mark. 60 s, 48 kHz stereo.
Usage: python3 taps.py <out.wav>"""
import sys, wave
import numpy as np
SR, T = 48000, 60.0
N = int(T * SR)
def tone(f, dur, decay, harm=((1, 1.0), (1.9, 0.3))):
    n = int(dur * SR); t = np.arange(n) / SR
    env = np.minimum(1, t / 0.003) * np.exp(-t * decay)
    return sum(a * np.sin(2 * np.pi * f * k * t) for k, a in harm) * env
def chime():
    a = tone(1174.7, 1.4, 3.2, ((1, 1.0), (2, 0.15)))
    b = np.pad(tone(1480.0, 1.2, 3.4, ((1, 1.0), (2, 0.15))), (int(0.1 * SR), len(a)))[: len(a)]
    return a + 0.7 * b
TAPS = [5.4, 6.0, 6.6, 7.2, 7.8, 8.4, 9.0, 11.4, 12.0, 12.6, 13.2, 13.9, 15.2, 16.0, 16.8, 18.0, 18.8,
        26.6, 27.6, 31.4, 32.4, 33.8, 35.0, 39.3, 45.0, 46.0, 50.4, 52.4, 52.9, 53.4]
CHIMES = [24.6, 55.9]
buf = np.zeros((N, 2))
def place(sig, at, g, pan=0.0):
    i = int(at * SR); e = min(N, i + len(sig))
    buf[i:e, 0] += sig[: e - i] * g * (1 - pan); buf[i:e, 1] += sig[: e - i] * g * (1 + pan)
for k, t in enumerate(TAPS):
    place(tone(1500 if k % 2 else 1350, 0.12, 50), t, 0.16, pan=0.15 if k % 2 else -0.15)
for t in CHIMES:
    place(chime(), t, 0.14)
buf *= 10 ** (-6 / 20) / np.abs(buf).max()
with wave.open(sys.argv[1], 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((buf * 32767).astype('<i2').tobytes())
print('taps', sys.argv[1], T, 's')
