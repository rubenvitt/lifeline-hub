import type {
  Sonderkost,
  Verpflegung,
  VerpflegungAusgabe,
  Verpflegungsstelle,
  VerpflegungZeitfenster,
} from '../api/types';

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
 * Server, die Testdaten tragen sie deshalb fertig.
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
    stelle_ids: [],
    je_stelle: [],
    ausgaben: [ausgabe({ id: 11, menge: 230, sonderkost: { ...KEINE_SONDERKOST, vegan: 3 } })],
    angelegt_at: '2026-09-24 06:00:00',
    ...over,
  };
}

/** Eine Verpflegungsstelle (LLH-1040), Vorgabe: Feldküche, aktiv. */
export function stelle(over: Partial<Verpflegungsstelle> & { id: number }): Verpflegungsstelle {
  return {
    bezeichnung: `Stelle ${over.id}`,
    art: 'feldkueche',
    status: 'aktiv',
    angelegt_at: '2026-09-24 06:00:00',
    ...over,
  };
}

export const FELDKUECHE = 21;
export const TURNHALLE = 22;
export const DEICH = 23;

/**
 * Beispiel des Tickets ohne Soll je Stelle (LLH-1040 D11): „Mittag“ mit Bedarf 200 an der
 * Feldküche und der Turnhalle, ausgegeben 100 und 80 → Ist je Stelle 100/80, Fehlmenge gesamt
 * 20. „Abend“ hat keine Zuordnung und keine Ausgabe an einer Stelle (`je_stelle` leer, Bestand).
 * Die Zuführung Deich ist geplant und keinem Zeitfenster zugeordnet. Das Ist je Stelle rechnet
 * der Server; die Testdaten tragen es fertig.
 */
export function verpflegungMitStellen(): Verpflegung {
  const nichts = { gesamt: 0, sonderkost: KEINE_SONDERKOST };
  return {
    stellen: [
      stelle({ id: FELDKUECHE, bezeichnung: 'Feldküche BR Sportplatz', art: 'feldkueche' }),
      stelle({ id: TURNHALLE, bezeichnung: 'Ausgabe Turnhalle Nord', art: 'ausgabestelle' }),
      stelle({ id: DEICH, bezeichnung: 'Zuführung Deich', art: 'zufuehrung', status: 'geplant' }),
    ],
    zeitfenster: [
      zeitfenster({
        id: 1,
        verpflegungsart: 'warm',
        bedarf: {
          kraefte: 200,
          betreute: 0,
          weitere: 0,
          gesamt: 200,
          sonderkost: KEINE_SONDERKOST,
        },
        ausgegeben: { gesamt: 180, sonderkost: KEINE_SONDERKOST },
        fehlmenge: { gesamt: 20, sonderkost: KEINE_SONDERKOST },
        stelle_ids: [FELDKUECHE, TURNHALLE],
        je_stelle: [
          { stelle_id: FELDKUECHE, ausgegeben: { gesamt: 100, sonderkost: KEINE_SONDERKOST } },
          { stelle_id: TURNHALLE, ausgegeben: { gesamt: 80, sonderkost: KEINE_SONDERKOST } },
        ],
        ausgaben: [
          ausgabe({ id: 11, menge: 100, ort: null, verpflegungsstelle_id: FELDKUECHE }),
          ausgabe({ id: 12, menge: 80, ort: null, verpflegungsstelle_id: TURNHALLE }),
        ],
      }),
      zeitfenster({
        id: 2,
        bezeichnung: 'Abend',
        von_at: '2026-09-24 16:00:00',
        bis_at: '2026-09-24 17:30:00',
        ausgegeben: nichts,
        fehlmenge: { gesamt: 250, sonderkost: { ...KEINE_SONDERKOST, vegan: 3 } },
        ausgaben: [],
      }),
    ],
  };
}
