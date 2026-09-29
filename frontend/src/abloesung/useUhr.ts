import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import type { Abloesung } from '../api/types';
import { abloesungZeit, VORWARNUNG_MINUTEN } from './einstufung';

/**
 * Die Uhr der Ablösungsseite — tickt alle 30 s, damit Einstufung und „in x min" ohne neuen
 * Abruf weiterlaufen. Kein Blinken: nur der Wert wechselt.
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
 * Einstufung, statt alle 30 s den Rahmen neu zu zeichnen; ohne laufende Schicht steht sie.
 *
 * Die Zeit wird bei JEDER neuen Liste frisch gelesen, nicht nur am Wecker: sonst bliebe `jetzt`
 * beim Einhängen stehen, und eine rückdatiert begonnene Schicht zählte dauerhaft als planmäßig.
 */
export function useEinstufungsUhr(liste: readonly Abloesung[] | undefined): Dayjs {
  const [takt, setTakt] = useState(0);
  // Neu gelesen bei neuer Liste ODER abgelaufenem Wecker — den einzigen Momenten, in denen sich
  // die Einstufung ändern kann. `liste` und `takt` werden im Rumpf nicht gelesen, sie SIND der
  // Anlass, die Uhr neu zu lesen.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const jetzt = useMemo(() => dayjs(), [liste, takt]);
  useEffect(() => {
    if (!liste) return;
    const wechsel = naechsterWechsel(liste, jetzt);
    if (!wechsel) return;
    // +50 ms: der Wechsel soll sicher HINTER der Grenze gerechnet werden (≤ ist überfällig).
    const t = window.setTimeout(
      () => setTakt((n) => n + 1),
      Math.max(0, wechsel.valueOf() - jetzt.valueOf()) + 50,
    );
    return () => window.clearTimeout(t);
  }, [liste, jetzt]);
  return jetzt;
}
