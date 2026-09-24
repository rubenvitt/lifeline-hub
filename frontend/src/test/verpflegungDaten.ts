import type { Sonderkost, VerpflegungAusgabe, VerpflegungZeitfenster } from '../api/types';

/** Testdaten des Fachmoduls Verpflegung (LFH-634) — nur für Tests. */

export const KEINE_SONDERKOST: Sonderkost = {
  vegetarisch: 0,
  vegan: 0,
  ohne_schwein: 0,
  diaet_allergenarm: 0,
  saeugling_kleinkind: 0,
};

export function ausgabe(over: Partial<VerpflegungAusgabe> & { id: number }): VerpflegungAusgabe {
  return {
    zeitfenster_id: 1,
    zeitpunkt_at: '2026-09-24 09:40:00',
    menge: 120,
    ort: 'Verpflegungsstelle Deich',
    sonderkost: KEINE_SONDERKOST,
    erfasst_at: '2026-09-24 09:41:00',
    ...over,
  };
}

/**
 * „Mittag“ 10:00–11:30 UTC (12:00–13:30 in Berlin), Bedarf 250 (180 Kräfte, 70 Betreute),
 * davon 3 vegan; ausgegeben 230 → Fehlmenge 20, vegan gedeckt. Die Deckungszahlen rechnet der
 * Server — die Testdaten tragen sie deshalb fertig, wie die Antwort.
 */
export function zeitfenster(
  over: Partial<VerpflegungZeitfenster> & { id?: number } = {},
): VerpflegungZeitfenster {
  return {
    id: 1,
    einsatz_id: 1,
    bezeichnung: 'Mittag',
    von_at: '2026-09-24 10:00:00',
    bis_at: '2026-09-24 11:30:00',
    bedarf: {
      kraefte: 180,
      betreute: 70,
      weitere: 0,
      gesamt: 250,
      sonderkost: { ...KEINE_SONDERKOST, vegan: 3 },
    },
    ausgegeben: { gesamt: 230, sonderkost: { ...KEINE_SONDERKOST, vegan: 3 } },
    fehlmenge: { gesamt: 20, sonderkost: KEINE_SONDERKOST },
    ausgaben: [ausgabe({ id: 11, menge: 230, sonderkost: { ...KEINE_SONDERKOST, vegan: 3 } })],
    angelegt_at: '2026-09-24 06:00:00',
    ...over,
  };
}
