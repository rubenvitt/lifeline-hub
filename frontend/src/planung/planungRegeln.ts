import type { FormRule } from 'antd';
import { PLANUNG_ZEITRAUM_MAX_TAGE } from '../api/eingabegrenzen';
import type { Zeitraum } from '../anzeige/ZeitpunktEingabe';
import { dauerMinuten, dauerRegel } from '../abloesung/dauer';

/**
 * Prüfungen der Vorplanung wie der Server (LLH-1585, `planung::repo::pruefe_zeitraum`,
 * `abloesung::schichtplan::{MAX_DIENST_BEREICH, MIN_RUHE_BEREICH}`).
 */

/** Höchstdauer im Dienst ohne eigenen Wert (Server: 720 min). */
export const MAX_DIENST_VORGABE = 720;
/** Mindestruhe ohne eigenen Wert (Server: 480 min). */
export const MIN_RUHE_VORGABE = 480;

const TAG_MS = 24 * 60 * 60_000;

/** Beginn und Ende, Ende nach Beginn, höchstens 14 Tage. */
export const zeitraumRegel: FormRule = {
  validator: (_, z: Zeitraum | null | undefined) => {
    if (!z || !z[0] || !z[1]) return Promise.reject(new Error('Beginn und Ende angeben'));
    const dauer = z[1].valueOf() - z[0].valueOf();
    if (dauer <= 0) return Promise.reject(new Error('Das Ende muss nach dem Beginn liegen'));
    if (dauer > PLANUNG_ZEITRAUM_MAX_TAGE * TAG_MS)
      return Promise.reject(new Error(`Höchstens ${PLANUNG_ZEITRAUM_MAX_TAGE} Tage`));
    return Promise.resolve();
  },
};

export const maxDienstRegel = dauerRegel({ pflicht: false, min: 60, max: 1_440 });
export const minRuheRegel = dauerRegel({ pflicht: false, min: 0, max: 1_440 });
/** Schichtlänge eines Postens wie die Länge eines Blocks (10 min bis 24 h, Raster 5 min). */
export const schichtlaengeRegeln: FormRule[] = [
  dauerRegel({ pflicht: false, min: 10, max: 1_440 }),
  {
    validator: (_, wert: string | undefined) => {
      const m = dauerMinuten(wert);
      return m != null && m % 5 !== 0
        ? Promise.reject(new Error('Auf volle 5 Minuten'))
        : Promise.resolve();
    },
  },
];
