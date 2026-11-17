#!/usr/bin/env python3
"""The app's built-in notification sounds, synthesised from sine tones.

    python3 -I tool/notification_sounds.py

Writes, for each sound (chime, pop, fanfare, tick, whoosh, bell):
  android/app/src/main/res/raw/<key>.wav          Android channel sounds (16-bit PCM, 22.05 kHz mono)
  assets/notification_sounds/<key>.caf            iOS, copied into Library/Sounds on start (IMA4, via afconvert)
  ../hr-admin-web/public/notification-sounds/<key>.wav   the dashboard's play button

Plain Python (no numpy). Each sound is under a second except the fanfare
(under two). The server's list of built-ins (BUILT_IN_SOUNDS in
backend/src/services/notification-look.service.ts) must name the same keys.
A company's own recording replaces one through the dashboard's upload.
"""
import math
import os
import random
import struct
import subprocess
import sys
import wave

RATE = 22050
HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
RAW = os.path.join(APP, 'android', 'app', 'src', 'main', 'res', 'raw')
CAF = os.path.join(APP, 'assets', 'notification_sounds')
WEB = os.path.join(os.path.dirname(APP), 'hr-admin-web', 'public', 'notification-sounds')


def silence(seconds):
    return [0.0] * int(RATE * seconds)


def mix(into, sound, at):
    start = int(RATE * at)
    need = start + len(sound)
    if len(into) < need:
        into.extend([0.0] * (need - len(into)))
    for i, v in enumerate(sound):
        into[start + i] += v
    return into


def tone(freq, seconds, decay, partials=((1.0, 1.0),), attack=0.004):
    """A struck tone: partials (ratio, level), each fading exponentially (decay in seconds)."""
    out = []
    n = int(RATE * seconds)
    for i in range(n):
        t = i / RATE
        env = (min(1.0, t / attack) if attack else 1.0) * math.exp(-t / decay)
        v = 0.0
        for ratio, level in partials:
            # Higher partials fade faster, as on a real bell or chime bar.
            v += level * math.exp(-t * ratio / (decay * 6)) * math.sin(2 * math.pi * freq * ratio * t)
        out.append(env * v)
    return out


def chime():
    bar = ((1.0, 1.0), (2.0, 0.28), (3.0, 0.08))
    out = silence(0.0)
    mix(out, tone(1046.5, 0.75, 0.22, bar), 0.0)   # C6
    mix(out, tone(1568.0, 0.70, 0.24, bar), 0.13)  # G6
    return out


def pop():
    out = []
    n = int(RATE * 0.22)
    phase = 0.0
    for i in range(n):
        t = i / RATE
        freq = 380 + 760 * (1 - math.exp(-t / 0.018))  # a quick upward bloop
        phase += 2 * math.pi * freq / RATE
        env = min(1.0, t / 0.003) * math.exp(-t / 0.045)
        out.append(env * (math.sin(phase) + 0.15 * math.sin(2 * phase)))
    return out


def fanfare():
    brass = ((1.0, 1.0), (2.0, 0.45), (3.0, 0.25), (4.0, 0.12))
    out = silence(0.0)
    notes = [(523.25, 0.0), (659.25, 0.12), (783.99, 0.24)]  # C5 E5 G5
    for freq, at in notes:
        mix(out, tone(freq, 0.30, 0.16, brass, attack=0.012), at)
    # The last note held, C6 with G5 under it.
    mix(out, tone(1046.5, 1.15, 0.45, brass, attack=0.015), 0.38)
    mix(out, tone(783.99, 1.15, 0.45, brass, attack=0.015), 0.38)
    return out


def tick():
    rnd = random.Random(7)
    out = silence(0.0)
    for freq, at, level in ((2100.0, 0.0, 1.0), (1600.0, 0.16, 0.8)):
        n = int(RATE * 0.06)
        click = []
        for i in range(n):
            t = i / RATE
            env = math.exp(-t / 0.009)
            click.append(level * env * (0.8 * math.sin(2 * math.pi * freq * t) + 0.25 * (rnd.random() * 2 - 1)))
        mix(out, click, at)
    mix(out, silence(0.1), 0.24)
    return out


def whoosh():
    rnd = random.Random(11)
    seconds = 0.65
    n = int(RATE * seconds)
    out = []
    low = 0.0
    band = 0.0
    for i in range(n):
        t = i / RATE
        x = t / seconds
        # Rises then falls, its brightness sweeping up with it.
        env = math.sin(math.pi * x) ** 2
        cutoff = 300 + 2600 * x
        a = 1 - math.exp(-2 * math.pi * cutoff / RATE)
        noise = rnd.random() * 2 - 1
        low += a * (noise - low)
        band += 0.35 * (low - band)
        out.append(env * (low - band) * 2.2)
    return out


def bell():
    # A small hand bell: inharmonic partials.
    partials = ((1.0, 1.0), (2.76, 0.42), (5.40, 0.18), (8.93, 0.08))
    return tone(880.0, 0.95, 0.30, partials, attack=0.002)


SOUNDS = {'chime': chime, 'pop': pop, 'fanfare': fanfare, 'tick': tick, 'whoosh': whoosh, 'bell': bell}
LIMIT = {'fanfare': 1.95}


def finish(samples, key):
    """Peak at -3 dBFS, a 4 ms fade in and a 30 ms fade out, trimmed to its limit."""
    limit = int(RATE * LIMIT.get(key, 0.98))
    samples = samples[:limit]
    peak = max(abs(v) for v in samples) or 1.0
    gain = 10 ** (-3 / 20) / peak
    fade_in = int(RATE * 0.004)
    fade_out = int(RATE * 0.03)
    out = []
    for i, v in enumerate(samples):
        g = gain
        if i < fade_in:
            g *= i / fade_in
        left = len(samples) - i
        if left < fade_out:
            g *= left / fade_out
        out.append(max(-1.0, min(1.0, v * g)))
    return out


def write_wav(path, samples):
    with wave.open(path, 'wb') as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(RATE)
        f.writeframes(b''.join(struct.pack('<h', int(v * 32767)) for v in samples))


def main():
    for folder in (RAW, CAF, WEB):
        os.makedirs(folder, exist_ok=True)
    for key, make in SOUNDS.items():
        samples = finish(make(), key)
        wav_path = os.path.join(RAW, f'{key}.wav')
        write_wav(wav_path, samples)
        write_wav(os.path.join(WEB, f'{key}.wav'), samples)
        caf_path = os.path.join(CAF, f'{key}.caf')
        subprocess.run(['afconvert', '-f', 'caff', '-d', 'ima4', wav_path, caf_path], check=True)
        print(f'{key}: {len(samples) / RATE:.2f} s, wav {os.path.getsize(wav_path)} B, caf {os.path.getsize(caf_path)} B')


if __name__ == '__main__':
    sys.exit(main())
