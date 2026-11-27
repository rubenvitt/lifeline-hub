#!/usr/bin/env python3
"""Erzeugt den Pagerton der Helfer-App (LLH-2157): drei steigende Töne, fünfmal mit Pause.

Selbst erzeugt, keinem bestehenden Pager nachgebildet. Ausgabe als WAV (16 Bit, mono, 22 050 Hz):
    python3 scripts/helfer/pagerton.py <ziel.wav>
Daraus entstehen `android/helfer/src/main/res/raw/pagerton.wav` (unverändert) und
`ios/Helfer/App/Pagerton.caf` (`ffmpeg -i pagerton.wav -c:a pcm_s16le Pagerton.caf`), siehe
`scripts/helfer/pagerton.sh`. iOS spielt Mitteilungstöne bis 30 s; der Ton ist gut 6 s lang.
"""
import math
import struct
import sys
import wave

RATE = 22050
TOENE_HZ = (880.0, 1174.66, 1567.98)
TON_S = 0.16
LUECKE_S = 0.04
PAUSE_S = 0.45
RUNDEN = 5
LAUTSTAERKE = 0.85
RAMPE_S = 0.006


def ton(hz: float) -> list[float]:
    n = int(RATE * TON_S)
    rampe = int(RATE * RAMPE_S)
    werte = []
    for i in range(n):
        t = i / RATE
        # Grundton mit etwas Oberton: klingt durchdringender als ein reiner Sinus.
        w = math.sin(2 * math.pi * hz * t) + 0.35 * math.sin(2 * math.pi * 2 * hz * t)
        huelle = min(1.0, i / rampe, (n - 1 - i) / rampe)
        werte.append(w / 1.35 * huelle)
    return werte


def stille(s: float) -> list[float]:
    return [0.0] * int(RATE * s)


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("Aufruf: pagerton.py <ziel.wav>")
    proben: list[float] = []
    for _ in range(RUNDEN):
        for hz in TOENE_HZ:
            proben += ton(hz) + stille(LUECKE_S)
        proben += stille(PAUSE_S)
    with wave.open(sys.argv[1], "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(p * LAUTSTAERKE * 32767)) for p in proben))


if __name__ == "__main__":
    main()
