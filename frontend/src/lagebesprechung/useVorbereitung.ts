import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type { AbrufZustand } from '../api/abrufZustand';
import type { LagebesprechungStand } from '../api/types';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import {
  auftragsStand,
  meldungsStand,
  nachforderungsStand,
} from '../pages/lage-dashboard/fuehrungsZahlen';
import { baueLagebild, kennzahlReihe } from '../pages/lage-dashboard/lagebild';
import { kraefteZustand, useLagebild } from '../pages/lage-dashboard/useLagebild';
import { quellenLaden, vorbereitungsZeilen, type VorbereitungsZeile } from './vorbereitung';

dayjs.extend(utc);

/** Takt der Uhr: die Notiz „n seit über 4 h" an „Vermisste" zieht nach, ohne jede Sekunde zu
 *  rendern. */
const TAKT_MS = 30_000;

/** Die Reihe ohne aktive Lagekennzahlen: Kern plus Füllplätze, nie Pegel oder Evakuiert. */
const KERN_REIHE = kennzahlReihe([]);

/** Epoche → Wire-String (UTC ohne Zone), wie die Formatierer ihn erwarten. */
function alsWire(ms: number): string {
  return dayjs.utc(ms).format('YYYY-MM-DD HH:mm:ss');
}

interface VorbereitungsEingang {
  einsatzId: number;
  besprechung: LagebesprechungStand | undefined;
  besprechungZustand: AbrufZustand;
  besprechungStand: number;
}

export interface Vorbereitung {
  zeilen: VorbereitungsZeile[];
  /** Ältester Stand der Quellen als Wire-String, `null` ohne Stand. */
  standWire: string | null;
  /** Derselbe Stand als Epoche, für „Stand vor n s“; nicht endlich ohne Stand. */
  standMs: number;
  /** Eine Quelle lädt noch. */
  laedt: boolean;
}

/**
 * Der Lagestand zur nächsten Lagebesprechung (LFH-550; seit LLH-1747 als Hook für Paneel und
 * Großbild, Spec `grossbild-ansicht`, „Dieselben Zahlen wie die Seite“).
 *
 * Die Zahlen kommen aus DERSELBEN Zusammenstellung wie das Lage-Dashboard (`useLagebild` +
 * `baueLagebild`) und aus dem Modulzähler; hier wird nichts selbst gerechnet
 * (`lagebesprechung/vorbereitung.ts`). Zwei Aufrufer teilen sich über TanStack Query dieselben
 * Abfragen, es entsteht kein zweiter Abruf.
 */
export function useVorbereitung({
  einsatzId,
  besprechung,
  besprechungZustand,
  besprechungStand,
}: VorbereitungsEingang): Vorbereitung {
  const { konventionen: konv } = useAnzeigeKonventionen();
  const [jetzt, setJetzt] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setJetzt(Date.now()), TAKT_MS);
    return () => window.clearInterval(t);
  }, []);

  const { q, zustand, basis, stand: standVon } = useLagebild(einsatzId, { mitPegel: false });
  // Die Lageplätze (Pegel, Evakuiert) zeigt die Vorbereitung nicht: sie baut mit der Reihe ohne
  // Lagekennzahlen, die Kern-Kennzahlen sind dieselben wie im Dashboard.
  const lagebild = useMemo(
    () =>
      basis
        ? baueLagebild({ ...basis, evakuierung: { zustand: 'laden' } }, jetzt, konv, KERN_REIHE)
        : null,
    [basis, jetzt, konv],
  );

  const zeilen = vorbereitungsZeilen(
    {
      lagebild,
      zustand: {
        personen: zustand.personen,
        kraefte: kraefteZustand(zustand),
        gefahren: zustand.gefahren,
        lageberichte: zustand.lageberichte,
        besprechung: besprechungZustand,
      },
      auftraege: auftragsStand(q.zaehler),
      meldungen: meldungsStand(q.zaehler),
      nachforderungen: nachforderungsStand(q.zaehler),
      besprechung,
    },
    konv,
  );

  const stand = Math.min(
    ...[
      // Eine gesperrte Quelle zählt nicht in den Stand (LFH-669, `useLagebild`).
      gemeinsamerDatenstand(
        standVon('einsatz'),
        standVon('personen'),
        standVon('personal'),
        standVon('fahrzeuge'),
        standVon('material'),
        standVon('einheiten'),
        standVon('abschnitte'),
        standVon('gefahren'),
        standVon('lageberichte'),
        standVon('zaehler'),
      ),
      besprechungStand,
    ].filter((s) => s > 0),
  );
  const standWire = Number.isFinite(stand) ? alsWire(stand) : null;
  const laedt = quellenLaden(zeilen);
  return { zeilen, standWire, standMs: stand, laedt };
}
