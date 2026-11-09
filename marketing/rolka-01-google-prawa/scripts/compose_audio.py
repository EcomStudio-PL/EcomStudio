#!/usr/bin/env python3
"""
GrovBase Rolka #1 — ORIGINAL soundtrack + SFX, synthesised from scratch (no samples, no third-party audio).

Outputs (48 kHz):
  public/audio/music_raw.wav     — the composition before ducking (stereo)
  public/audio/music_ducked.wav  — side-chain ducked under the voice (what the Remotion project plays)
  public/audio/sfx/*.wav         — UI / motion one-shots (mono)

Style: 128 BPM electro / breakbeat in F minor, energetic from the first frame, arranged on the voice cues
(stop on "I uwaga", breakdown on "Jak to sprawdzić?", lift on the AI tools, CTA drive, break on "A ty?").

Run:  python3 scripts/compose_audio.py   (needs numpy, scipy, soundfile, ffmpeg on PATH)
"""
import os
import subprocess
import sys

import numpy as np
import soundfile as sf
from scipy.signal import butter, fftconvolve, lfilter

SR = 48000
DUR = 55.0
N = int(DUR * SR)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "audio")
rng = np.random.default_rng(7)

# ---------------------------------------------------------------- cue sheet (s) — mirrors src/data/timeline.ts
CUE = dict(
    uwazaj=1.67, iUwaga=12.36, nawet=13.18, editEnd=19.62, wejdz=21.36, licEnd=32.18, aJesli=32.50,
    toolsEnd=40.17, pamietajTylko=40.49, narzedziEnd=46.22, zapisz=46.67, bleduEnd=49.40, aTy=49.72,
    sprawdzales=50.46, end=54.44,
)
BPM = 128.0
BEAT = 60.0 / BPM
STEP = BEAT / 4


# ---------------------------------------------------------------- helpers
def tvec(d):
    return np.arange(int(d * SR)) / SR


def lp(x, f, order=2):
    b, a = butter(order, min(f, SR * 0.45) / (SR / 2), "low")
    return lfilter(b, a, x)


def hp(x, f, order=2):
    b, a = butter(order, f / (SR / 2), "high")
    return lfilter(b, a, x)


def bp(x, f1, f2, order=2):
    b, a = butter(order, [f1 / (SR / 2), min(f2, SR * 0.45) / (SR / 2)], "band")
    return lfilter(b, a, x)


def saw(freq, t, detune=0.0):
    f = freq * (2 ** (detune / 1200))
    ph = (f * t + rng.random()) % 1.0
    return 2 * ph - 1


def env_adsr(n, a=0.005, d=0.1, s=0.7, r=0.05):
    e = np.ones(n) * s
    na, nd, nr = int(a * SR), int(d * SR), int(r * SR)
    na = max(1, min(na, n))
    e[:na] = np.linspace(0, 1, na)
    if na + nd < n:
        e[na : na + nd] = np.linspace(1, s, nd)
    if nr > 0 and nr < n:
        e[-nr:] *= np.linspace(1, 0, nr)
    return e


def place(buf, sig, t, gain=1.0, pan=0.0):
    i = int(round(t * SR))
    if i >= buf.shape[1] or i + len(sig) <= 0:
        return
    s0 = max(0, -i)
    i = max(0, i)
    sig = sig[s0:]
    n = min(len(sig), buf.shape[1] - i)
    lg = np.cos((pan + 1) * np.pi / 4) * gain
    rg = np.sin((pan + 1) * np.pi / 4) * gain
    buf[0, i : i + n] += sig[:n] * lg
    buf[1, i : i + n] += sig[:n] * rg


def note(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def reverb_ir(d=1.6, decay=2.8, bright=6000):
    t = tvec(d)
    ir_l = rng.standard_normal(len(t)) * np.exp(-t * decay)
    ir_r = rng.standard_normal(len(t)) * np.exp(-t * decay)
    ir_l, ir_r = lp(ir_l, bright), lp(ir_r, bright)
    ir_l[: int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))
    ir_r[: int(0.017 * SR)] *= np.linspace(0, 1, int(0.017 * SR))
    return ir_l / np.sqrt(np.sum(ir_l**2)), ir_r / np.sqrt(np.sum(ir_r**2))


IR = reverb_ir()


def add_reverb(stereo, wet=0.2):
    mono = stereo.mean(axis=0)
    l = fftconvolve(mono, IR[0])[: stereo.shape[1]]
    r = fftconvolve(mono, IR[1])[: stereo.shape[1]]
    return stereo + wet * np.vstack([l, r])


# ---------------------------------------------------------------- instruments
def kick(v=1.0):
    t = tvec(0.42)
    f = 46 + 120 * np.exp(-t / 0.032)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t / 0.2)
    click = hp(rng.standard_normal(len(t)), 2500) * np.exp(-t / 0.003) * 0.35
    return np.tanh(1.6 * (body + click)) * v


def snare(v=1.0):
    t = tvec(0.32)
    tone = np.sin(2 * np.pi * 186 * t) * np.exp(-t / 0.05) * 0.55
    nz = bp(rng.standard_normal(len(t)), 1200, 7500) * np.exp(-t / 0.11)
    clap = np.zeros(len(t))
    for k, off in enumerate([0.0, 0.011, 0.023]):
        i = int(off * SR)
        seg = bp(rng.standard_normal(len(t) - i), 900, 4000) * np.exp(-(np.arange(len(t) - i) / SR) / (0.008 if k < 2 else 0.07))
        clap[i:] += seg * 0.6
    return np.tanh(1.3 * (tone + nz * 0.7 + clap)) * v


def hat(v=1.0, open_=False):
    d = 0.32 if open_ else 0.07
    t = tvec(d)
    x = hp(rng.standard_normal(len(t)), 7500, 3) * np.exp(-t / (0.11 if open_ else 0.018))
    return x * v * 0.9


def bass(freq, d, bright=900.0, v=1.0):
    t = tvec(d)
    x = 0.65 * saw(freq, t) + 0.45 * np.sin(2 * np.pi * freq * t) + 0.5 * np.sin(np.pi * freq * t)
    x = lp(x, bright, 2)
    return np.tanh(1.4 * x) * env_adsr(len(t), 0.004, 0.09, 0.75, 0.03) * v


def pad(freqs, d, bright=1800.0, v=1.0):
    t = tvec(d)
    l = np.zeros(len(t))
    r = np.zeros(len(t))
    for f in freqs:
        l += saw(f, t, -9) + saw(f, t, 4)
        r += saw(f, t, 9) + saw(f, t, -4)
    e = env_adsr(len(t), 0.25, 0.4, 0.8, min(0.5, d * 0.4))
    return lp(l, bright) * e * v / len(freqs), lp(r, bright) * e * v / len(freqs)


def pluck(freq, v=1.0, bright=3200.0):
    t = tvec(0.3)
    x = saw(freq, t) * 0.7 + np.sin(2 * np.pi * freq * 2 * t) * 0.2
    x = lp(x, bright) * np.exp(-t / 0.075)
    return x * v


def riser(d, f0=180, f1=1600):
    t = tvec(d)
    f = f0 * (f1 / f0) ** (t / d)
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.25
    nz = hp(rng.standard_normal(len(t)), 1500) * 0.5
    e = (t / d) ** 2.2
    return (tone + nz) * e


def impact(v=1.0):
    t = tvec(1.4)
    f = 32 + 40 * np.exp(-t / 0.12)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.55)
    nz = lp(rng.standard_normal(len(t)), 900) * np.exp(-t / 0.18) * 0.5
    return np.tanh(1.2 * (sub + nz)) * v


# ---------------------------------------------------------------- harmony: F minor  i – VI – III – VII
PROG = [
    (41, [65, 68, 72]),  # Fm   (F2 root / F4 Ab4 C5)
    (37, [65, 68, 73]),  # Db   (Db2 / F4 Ab4 Db5)
    (44, [63, 68, 72]),  # Ab   (Ab2 / Eb4 Ab4 C5)
    (39, [63, 67, 70]),  # Eb   (Eb2 / Eb4 G4 Bb4)
]
BAR = BEAT * 4

# sections: (start, end, kind, bar_offset)
SECTIONS = [
    (0.00, CUE["iUwaga"] - 0.06, "A", 0),
    (CUE["nawet"], CUE["editEnd"], "B", 0),
    (CUE["editEnd"], CUE["wejdz"], "BREAK", 2),
    (CUE["wejdz"], CUE["licEnd"] + 0.2, "A", 0),
    (CUE["aJesli"] - 0.1, CUE["toolsEnd"] + 0.25, "C", 0),
    (CUE["toolsEnd"] + 0.25, CUE["narzedziEnd"] + 0.3, "A2", 2),
    (CUE["narzedziEnd"] + 0.3, CUE["bleduEnd"] + 0.05, "D", 0),
    (CUE["bleduEnd"] + 0.05, CUE["sprawdzales"] - 0.05, "BREAK2", 0),
    (CUE["sprawdzales"] - 0.05, CUE["end"] + 0.06, "E", 0),
]

drums = np.zeros((2, N))
bassb = np.zeros((2, N))
padb = np.zeros((2, N))
arpb = np.zeros((2, N))
fxb = np.zeros((2, N))
kick_times = []

BREAK_KICKS = {0: 1.0, 7: 0.75, 10: 0.9}
BREAK_SNARES = {4: 1.0, 12: 1.0, 15: 0.25, 9: 0.18}
FOUR_KICKS = {0: 1.0, 4: 0.95, 8: 1.0, 12: 0.95}
FOUR_SNARES = {4: 1.0, 12: 1.0}

for (s0, s1, kind, boff) in SECTIONS:
    nsteps = int((s1 - s0) / STEP) + 1
    for k in range(nsteps):
        t = s0 + k * STEP
        if t >= s1 - 0.005:
            break
        st = k % 16
        bar = (k // 16 + boff) % 4
        root, chord = PROG[bar]
        swing = 0.012 if st % 2 == 1 else 0.0
        tt = t + swing
        if kind in ("A", "A2", "E"):
            kicks, snares = BREAK_KICKS, BREAK_SNARES
        elif kind in ("B", "C", "D"):
            kicks, snares = FOUR_KICKS, FOUR_SNARES
        else:
            kicks, snares = {}, {}
        lvl = {"A": 1.0, "A2": 0.85, "B": 1.0, "C": 0.95, "D": 1.05, "E": 0.8}.get(kind, 0.0)
        if st in kicks:
            place(drums, kick(kicks[st] * lvl), t, 0.95)
            kick_times.append(t)
        if st in snares:
            place(drums, snare(snares[st] * lvl), tt, 0.5, 0.05)
        if kind in ("A", "A2", "B", "C", "D", "E"):
            if st % 2 == 1:
                place(drums, hat(0.55 * lvl), tt, 0.35, 0.25)
            elif kind in ("B", "C", "D"):
                place(drums, hat(0.22 * lvl), tt, 0.3, -0.25)
            if kind in ("C", "D") and st in (2, 6, 10, 14):
                place(drums, hat(0.4 * lvl, open_=True), tt, 0.22, 0.35)
        # bass: 8th-note drive with octave jumps
        if kind not in ("BREAK2",) and st % 2 == 0:
            oct_ = 12 if st in (6, 14) else 0
            bright = {"BREAK": 380, "A": 850, "A2": 760, "B": 1000, "C": 1250, "D": 1300, "E": 800}[kind]
            bv = 0.55 if kind == "BREAK" else 1.0
            place(bassb, bass(note(root + oct_), STEP * 1.8, bright, bv), t, 0.42)
        # pad: once per bar
        if st == 0:
            bright = {"BREAK": 1100, "BREAK2": 1400, "C": 3000, "D": 2600}.get(kind, 1700)
            pl, pr = pad([note(m) for m in chord], min(BAR, s1 - t) + 0.3, bright)
            i = int(t * SR)
            n = min(len(pl), N - i)
            pv = {"BREAK": 0.5, "BREAK2": 0.5, "C": 0.42, "D": 0.36}.get(kind, 0.26)
            padb[0, i : i + n] += pl[:n] * pv
            padb[1, i : i + n] += pr[:n] * pv
        # arp: 16ths over chord tones (+ octave), sections C/D bright, A subtle
        if kind in ("A", "C", "D", "E", "BREAK") and not (kind == "A" and t < 4.6):
            seq = [chord[0], chord[1], chord[2], chord[1] + 12, chord[2], chord[0] + 12, chord[1], chord[2] + 12]
            m = seq[st % 8] + (12 if kind == "C" and st >= 8 else 0)
            av = {"A": 0.32, "C": 0.55, "D": 0.45, "E": 0.32, "BREAK": 0.3}[kind]
            ab = {"A": 2400, "C": 4200, "D": 3800, "E": 2600, "BREAK": 1600}[kind]
            place(arpb, pluck(note(m), av, ab), t, 0.5, 0.45 if st % 2 else -0.45)

# transitions / fx — tied to voice cues
place(fxb, impact(0.9), 0.0, 0.5)
place(fxb, riser(1.2, 200, 1400), CUE["nawet"] - 1.2 + 0.02, 0.18)  # under the freeze? kept very low
place(fxb, impact(1.0), CUE["nawet"], 0.55)
place(fxb, riser(1.6, 150, 1800), CUE["wejdz"] - 1.6, 0.3)
place(fxb, impact(0.9), CUE["wejdz"], 0.5)
place(fxb, impact(0.8), CUE["aJesli"], 0.45)
place(fxb, riser(1.0, 220, 1600), CUE["narzedziEnd"] - 0.7, 0.25)
place(fxb, impact(1.0), CUE["zapisz"], 0.55)
place(fxb, riser(0.9, 300, 1500), CUE["sprawdzales"] - 0.9, 0.18)
# ending: final stab chord + kick at the last syllable
endt = CUE["end"] + 0.04
place(drums, kick(1.0), endt, 0.9)
place(fxb, impact(0.7), endt, 0.4)
pl, pr = pad([note(m) for m in [65, 68, 72, 77]], 1.2, 2600)
i = int(endt * SR)
n = min(len(pl), N - i)
padb[0, i : i + n] += pl[:n] * 0.5 * np.exp(-(np.arange(n) / SR) / 0.35)
padb[1, i : i + n] += pr[:n] * 0.5 * np.exp(-(np.arange(n) / SR) / 0.35)

# side-chain pump from the kick on bass/pad/arp
pump = np.ones(N)
for kt in kick_times:
    i = int(kt * SR)
    d = int(0.32 * SR)
    seg = 1 - 0.55 * np.exp(-(np.arange(d) / SR) / 0.07)
    n = min(d, N - i)
    pump[i : i + n] = np.minimum(pump[i : i + n], seg[:n])

# arp ping-pong delay (3/16)
dl = int(STEP * 3 * SR)
echo = np.zeros_like(arpb)
echo[0, dl:] = arpb[1, :-dl] * 0.38
echo[1, dl:] = arpb[0, :-dl] * 0.38
arpb = arpb + echo

music = drums * 0.9 + bassb * pump * 1.0 + add_reverb(padb * pump, 0.35) * 0.9 + add_reverb(arpb * pump, 0.25) * 0.8 + fxb
music = add_reverb(music, 0.06)

# hard stop for "I uwaga" (tape-stop feel) and music fully silent until "Nawet"
stop0, stop1 = CUE["iUwaga"] - 0.06, CUE["nawet"]
i0, i1 = int(stop0 * SR), int(stop1 * SR)
tail = int(0.22 * SR)
seg = music[:, i0 : i0 + tail].copy()
# tape stop: resample the tail with decreasing speed
idx = np.cumsum(np.linspace(1.0, 0.0, tail))
idx = np.clip(idx.astype(int), 0, tail - 1)
music[:, i0 : i0 + tail] = seg[:, idx] * np.linspace(1, 0, tail)
music[:, i0 + tail : i1] *= 0.0
# fade-out end
fo = int(0.5 * SR)
music[:, N - fo :] *= np.linspace(1, 0, fo)

# gentle bus glue + normalise
music = np.tanh(music * 0.9) / 0.9
music /= np.max(np.abs(music)) + 1e-9

# ---------------------------------------------------------------- loudness: music sits far under the voice
voice_path = os.path.join(OUT, "voice_1.2x.mp3")
raw = subprocess.run(["ffmpeg", "-v", "error", "-i", voice_path, "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"], capture_output=True, check=True).stdout
voice = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
voice = np.pad(voice, (0, max(0, N - len(voice))))[:N]


def rms_db(x):
    return 20 * np.log10(np.sqrt(np.mean(x**2)) + 1e-12)


# voice RMS (speech parts only) vs music RMS → music target = voice − 11.5 dB before ducking
speech_mask = np.abs(voice) > 0
v_rms = rms_db(voice[np.convolve(np.abs(voice), np.ones(2400) / 2400, "same") > 0.01])
m_rms = rms_db(music.mean(axis=0))
music *= 10 ** ((v_rms - 11.5 - m_rms) / 20)

# side-chain ducking keyed by the voice envelope (attack 15 ms, release 320 ms), depth up to −8 dB
env = np.abs(voice)
win = int(0.03 * SR)
env = np.sqrt(np.convolve(env**2, np.ones(win) / win, "same"))
thr = 10 ** (-42 / 20)
key = np.clip((20 * np.log10(env + 1e-9) + 42) / 18, 0, 1)
att = np.exp(-1 / (0.015 * SR))
rel = np.exp(-1 / (0.32 * SR))
sm = np.zeros(N)
acc = 0.0
for i in range(0, N, 48):  # 1 ms control rate
    k = key[i]
    c = att if k > acc else rel
    acc = c ** 48 * acc + (1 - c ** 48) * k
    sm[i : i + 48] = acc
duck = 10 ** (-8.0 * sm / 20)
ducked = music * duck

os.makedirs(os.path.join(OUT, "sfx"), exist_ok=True)
sf.write(os.path.join(OUT, "music_raw.wav"), music.T.astype(np.float32), SR, subtype="PCM_24")
sf.write(os.path.join(OUT, "music_ducked.wav"), ducked.T.astype(np.float32), SR, subtype="PCM_24")


# ---------------------------------------------------------------- SFX
def norm(x, peak_db=-3.0):
    return x / (np.max(np.abs(x)) + 1e-9) * 10 ** (peak_db / 20)


def fade(x, ms=4):
    n = int(ms * SR / 1000)
    x[:n] *= np.linspace(0, 1, n)
    x[-n:] *= np.linspace(1, 0, n)
    return x


def sfx_click():
    t = tvec(0.06)
    return hp(rng.standard_normal(len(t)), 2500) * np.exp(-t / 0.004) * 0.7 + np.sin(2 * np.pi * 3100 * t) * np.exp(-t / 0.012) * 0.5


def sfx_grab():
    t = tvec(0.14)
    f = 380 + 700 * (t / 0.14)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.05) + sfx_click_pad(len(t)) * 0.4


def sfx_click_pad(n):
    c = sfx_click()
    out = np.zeros(n)
    out[: min(n, len(c))] = c[: min(n, len(c))]
    return out


def sfx_whoosh(d=0.5):
    t = tvec(d)
    nz = rng.standard_normal(len(t))
    out = np.zeros(len(t))
    chunks = 24
    for c in range(chunks):
        a, b = int(c * len(t) / chunks), int((c + 1) * len(t) / chunks)
        x = c / chunks
        fc = 350 + 2600 * np.sin(np.pi * x) ** 1.5
        out[a:b] = bp(nz, fc * 0.6, fc * 1.6)[a:b]
    e = np.sin(np.pi * t / d) ** 2
    return out * e


def sfx_drop():
    t = tvec(0.3)
    f = 60 + 90 * np.exp(-t / 0.03)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.09) + sfx_click_pad(len(t)) * 0.3


def sfx_alarm():
    t = tvec(0.9)
    sub = np.sin(2 * np.pi * np.cumsum(38 + 60 * np.exp(-t / 0.08)) / SR) * np.exp(-t / 0.35)
    stab = np.zeros(len(t))
    for f in (554.37, 739.99, 1108.7):
        sq = np.sign(np.sin(2 * np.pi * f * t))
        stab += lp(sq, 3500) * 0.22
    stab *= np.exp(-t / 0.18) * (0.75 + 0.25 * np.sign(np.sin(2 * np.pi * 18 * t)))
    crush = np.round(rng.standard_normal(len(t)) * 3) / 3
    crush = bp(crush, 800, 6000) * np.exp(-t / 0.06) * 0.6
    return np.tanh(1.5 * (sub * 0.9 + stab + crush))


def sfx_impulse():
    t = tvec(0.7)
    tr = hp(rng.standard_normal(len(t)), 1800) * np.exp(-t / 0.01)
    ring = np.sin(2 * np.pi * 1760 * t) * np.exp(-t / 0.22) * 0.35 + np.sin(2 * np.pi * 2637 * t) * np.exp(-t / 0.15) * 0.2
    sub = np.sin(2 * np.pi * np.cumsum(45 + 50 * np.exp(-t / 0.05)) / SR) * np.exp(-t / 0.2) * 0.8
    return tr * 0.8 + ring + sub


def sfx_stamp():
    t = tvec(0.28)
    th = np.sin(2 * np.pi * np.cumsum(70 + 80 * np.exp(-t / 0.02)) / SR) * np.exp(-t / 0.07)
    nz = lp(rng.standard_normal(len(t)), 1600) * np.exp(-t / 0.035) * 0.8
    paper = hp(rng.standard_normal(len(t)), 4000) * np.exp(-t / 0.02) * 0.2
    return np.tanh(1.4 * (th + nz + paper))


def sfx_snip():
    t = tvec(0.22)
    out = np.zeros(len(t))
    for off in (0.0, 0.09):
        i = int(off * SR)
        tt = (np.arange(len(t) - i) / SR)
        out[i:] += (bp(rng.standard_normal(len(tt)), 3000, 9000) * np.exp(-tt / 0.006) + np.sin(2 * np.pi * 4200 * tt) * np.exp(-tt / 0.02) * 0.4)
    return out


def sfx_erase():
    t = tvec(0.5)
    nz = rng.standard_normal(len(t))
    out = np.zeros(len(t))
    for c in range(16):
        a, b = int(c * len(t) / 16), int((c + 1) * len(t) / 16)
        fc = 1500 + 6000 * (c / 16)
        out[a:b] = bp(nz, fc * 0.7, fc * 1.3)[a:b]
    return out * np.sin(np.pi * t / 0.5) ** 1.5


def sfx_sparkle():
    t = tvec(0.9)
    out = np.zeros(len(t))
    for k in range(9):
        st = rng.random() * 0.5
        f = rng.choice([1760, 2093, 2637, 3136, 3520, 4186])
        i = int(st * SR)
        tt = (np.arange(len(t) - i) / SR)
        out[i:] += np.sin(2 * np.pi * f * tt) * np.exp(-tt / 0.09) * (0.5 + rng.random() * 0.5)
    sw = hp(rng.standard_normal(len(t)), 6000) * np.sin(np.pi * t / 0.9) ** 2 * 0.15
    return out + sw


def sfx_flip():
    w = sfx_whoosh(0.32)
    t = tvec(0.32)
    flick = hp(rng.standard_normal(len(t)), 3000) * np.exp(-((t - 0.16) ** 2) / 0.0004) * 0.6
    return w + flick


def sfx_select():
    t = tvec(0.28)
    a = np.sin(2 * np.pi * 880 * t) * np.exp(-t / 0.05)
    b = np.zeros(len(t))
    i = int(0.06 * SR)
    tt = (np.arange(len(t) - i) / SR)
    b[i:] = np.sin(2 * np.pi * 1318.5 * tt) * np.exp(-tt / 0.09)
    return a * 0.6 + b * 0.7 + sfx_click_pad(len(t)) * 0.3


def sfx_tick():
    t = tvec(0.1)
    return np.sin(2 * np.pi * 1600 * t) * np.exp(-t / 0.018) + sfx_click_pad(len(t)) * 0.3


def bell(f, d=0.7, n=None):
    t = np.arange(n) / SR if n is not None else tvec(d)
    return (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * f * 2.01 * t) * np.exp(-t / 0.08)) * np.exp(-t / 0.22)


def sfx_chime():
    t = tvec(0.8)
    out = np.zeros(len(t))
    for off, f in ((0.0, 1046.5), (0.07, 1568.0)):
        i = int(off * SR)
        b = bell(f, n=len(t) - i)
        out[i : i + len(b)] += b
    return out


def sfx_reject():
    t = tvec(0.22)
    sq = lp(np.sign(np.sin(2 * np.pi * 146.8 * t)), 900)
    return sq * np.exp(-t / 0.08) * 0.8


def sfx_pop():
    t = tvec(0.12)
    f = 280 + 520 * (t / 0.12) ** 0.5
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.035)


def sfx_bookmark():
    t = tvec(1.0)
    out = np.zeros(len(t))
    p = sfx_pop()
    out[: len(p)] += p * 0.9
    for off, f in ((0.05, 1046.5), (0.11, 1318.5), (0.17, 1568.0), (0.23, 2093.0)):
        i = int(off * SR)
        b = bell(f, n=len(t) - i) * 0.55
        out[i : i + len(b)] += b
    return out


def sfx_shine():
    t = tvec(1.2)
    sw = hp(rng.standard_normal(len(t)), 3000) * (t / 1.2) ** 2 * np.exp(-np.maximum(0, t - 0.8) / 0.12) * 0.4
    ch = np.zeros(len(t))
    for f in (1396.9, 1760.0, 2093.0, 2793.8):
        ch += np.sin(2 * np.pi * f * t) * (t / 1.2) ** 1.5 * 0.18
    ch *= np.exp(-np.maximum(0, t - 0.85) / 0.15)
    return sw + ch


def sfx_hit():
    k = kick(1.0)
    s = snare(0.7)
    n = max(len(k), len(s))
    out = np.zeros(n)
    out[: len(k)] += k
    out[: len(s)] += s * 0.6
    return out


def sfx_typing():
    t = tvec(0.5)
    out = np.zeros(len(t))
    for k in range(7):
        i = int((k * 0.065 + rng.random() * 0.01) * SR)
        c = sfx_click() * (0.6 + 0.4 * rng.random())
        n = min(len(c), len(t) - i)
        out[i : i + n] += lp(c, 5000)[:n]
    return out


SFXS = dict(
    click=sfx_click, grab=sfx_grab, whoosh=lambda: sfx_whoosh(0.5), whoosh_long=lambda: sfx_whoosh(0.75), drop=sfx_drop,
    alarm=sfx_alarm, impulse=sfx_impulse, stamp=sfx_stamp, snip=sfx_snip, erase=sfx_erase, sparkle=sfx_sparkle,
    flip=sfx_flip, select=sfx_select, tick=sfx_tick, chime=sfx_chime, reject=sfx_reject, pop=sfx_pop,
    bookmark=sfx_bookmark, shine=sfx_shine, hit=sfx_hit, typing=sfx_typing,
)
for name, fn in SFXS.items():
    x = fade(norm(np.asarray(fn(), dtype=np.float64)))
    sf.write(os.path.join(OUT, "sfx", f"{name}.wav"), x.astype(np.float32), SR, subtype="PCM_24")

print("music RMS (dBFS):", round(rms_db(ducked.mean(axis=0)), 1), "voice speech RMS:", round(v_rms, 1))
print("wrote", len(SFXS), "sfx")
sys.exit(0)
