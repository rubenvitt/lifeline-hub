import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useState } from 'react';
import type { Abloesung } from '../api/types';
import { abloesungZeit, VORWARNUNG_MINUTEN } from './einstufung';

/**
 * Die Uhr der Ablösungsseite (LFH-635) — tickt alle 30 s, damit Einstufung und „in x min"
 * mit der Zeit weiterlaufen, ohne dass ein neuer Abruf nötig wäre. Kein Blinken: nur der
 * Wert wechselt.
 */
export function useUhr(intervallMs = 30_000): Dayjs {
  const [jetzt, setJetzt] = useState(() => dayjs());
  useEffect(() => {
    const t = window.setInterval(() => setJetzt(dayjs()), intervallMs);
    return () => window.clearInterval(t);
  }, [intervallMs]);
  return jetzt;
}

/** Der nächste Zeitpunkt, an dem sich die Einstufung einer laufenden Schicht ändert. */
export function naechsterWechsel(liste: readonly Abloesung[], jetzt: Dayjs): Dayjs | null {
  let naechster: Dayjs | null = null;
  for (const a of liste) {
    if (a.status !== 'laufend') continue;
    const f = abloesungZeit(a.faellig_at);
    if (!f) continue;
    for (const grenze of [f.subtract(VORWARNUNG_MINUTEN, 'minute'), f]) {
      if (grenze.isAfter(jetzt) && (!naechster || grenze.isBefore(naechster))) {
        naechster = grenze;
      }
    }
  }
  return naechster;
}

/**
 * Uhr für den Modulzähler im Einsatzrahmen: stellt sich NUR auf den nächsten Wechsel der
 * Einstufung, statt alle 30 s den ganzen Rahmen neu zu zeichnen. Ohne laufende Schicht steht
 * sie still.
 */
export function useEinstufungsUhr(liste: readonly Abloesung[] | undefined): Dayjs {
  const [jetzt, setJetzt] = useState(() => dayjs());
  useEffect(() => {
    if (!liste) return;
    const wechsel = naechsterWechsel(liste, dayjs());
    if (!wechsel) return;
    // +50 ms: der Wechsel soll sicher HINTER der Grenze gerechnet werden (≤ ist überfällig).
    const t = window.setTimeout(
      () => setJetzt(dayjs()),
      Math.max(0, wechsel.valueOf() - Date.now()) + 50,
    );
    return () => window.clearTimeout(t);
  }, [liste, jetzt]);
  return jetzt;
}
