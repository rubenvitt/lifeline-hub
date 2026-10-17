import type {
  EmpfaengerAbschnitt,
  EmpfaengerEinheit,
  Sonderkost,
  Verpflegung,
  VerpflegungEmpfaenger,
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
    verpflegt_anderswo: [],
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
    geraet_gekoppelt: false,
    ...over,
  };
}

/** Eine Einheit als Empfänger (LLH-1055), Vorgabe: ohne Gliederung, Abschnitt und Stärke. */
export function empfaengerEinheit(
  over: Partial<EmpfaengerEinheit> & { id: number },
): EmpfaengerEinheit {
  const keine = { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 };
  return { name: `Einheit ${over.id}`, ist: keine, ist_kumuliert: keine, ...over };
}

export const ZUG = 31;
export const GRUPPE_1 = 32;
export const GRUPPE_2 = 33;
export const WASSERRETTUNG = 34;
export const ABSCHNITT_DEICH = 41;

export const ABSCHNITT_DEICH_EMPFAENGER: EmpfaengerAbschnitt = {
  id: ABSCHNITT_DEICH,
  name: 'Deich',
};

/**
 * Empfängerliste nach dem Server (LLH-1055 D3), in der Folge des Kräftebaums: ein Zug (1/0/1)
 * mit zwei Gruppen (je 0/1/8, kumuliert 1/2/17) im Abschnitt Deich, eingetroffen; dazu die
 * Wasserrettung ohne Abschnitt, Stärke und Eintreffen. Ein Abschnitt („Deich“). Das Kumulierte
 * rechnet der Server; die Testdaten tragen es fertig.
 */
export function empfaenger(): VerpflegungEmpfaenger {
  const gruppe = { fuehrer: 0, unterfuehrer: 1, mannschaft: 8 };
  const imDeich = { abschnitt_id: ABSCHNITT_DEICH, abschnitt_name: 'Deich' };
  return {
    einheiten: [
      empfaengerEinheit({
        id: ZUG,
        name: '1. Zug',
        funkrufname: 'Florian 1',
        ...imDeich,
        ist: { fuehrer: 1, unterfuehrer: 0, mannschaft: 1 },
        ist_kumuliert: { fuehrer: 1, unterfuehrer: 2, mannschaft: 17 },
        eintreffen_at: '2026-09-24 07:15:00',
      }),
      empfaengerEinheit({
        id: GRUPPE_1,
        name: '1. Gruppe',
        funkrufname: 'Florian 1-1',
        ueber_einheit_id: ZUG,
        ...imDeich,
        ist: gruppe,
        ist_kumuliert: gruppe,
        eintreffen_at: '2026-09-24 07:15:00',
      }),
      empfaengerEinheit({
        id: GRUPPE_2,
        name: '2. Gruppe',
        funkrufname: 'Florian 1-2',
        ueber_einheit_id: ZUG,
        ...imDeich,
        ist: gruppe,
        ist_kumuliert: gruppe,
        eintreffen_at: '2026-09-24 07:40:00',
      }),
      empfaengerEinheit({ id: WASSERRETTUNG, name: 'Wasserrettung' }),
    ],
    abschnitte: [ABSCHNITT_DEICH_EMPFAENGER],
  };
}

/** Keine Empfänger: Einsatz ohne Einheiten und Abschnitte. */
export const KEINE_EMPFAENGER: VerpflegungEmpfaenger = { einheiten: [], abschnitte: [] };

export const FELDKUECHE = 21;
export const TURNHALLE = 22;
export const DEICH = 23;

/**
 * Beispiel des Tickets ohne Soll je Stelle (LLH-1040 D11): „Mittag“ mit Bedarf 200 an der
 * Feldküche und der Turnhalle, ausgegeben 100 und 80 → Ist je Stelle 100/80, Fehlmenge gesamt
 * 20. „Abend“ hat keine Zuordnung und keine Ausgabe an einer Stelle (`je_stelle` leer, Bestand).
 * Die Zuführung Deich ist geplant und keinem Zeitfenster zugeordnet. Das Ist je Stelle rechnet
 * der Server; die Testdaten tragen es fertig, in seiner Reihenfolge: `stellen`, `stelle_ids` und
 * `je_stelle` nach Bezeichnung (die Turnhalle vor der Feldküche).
 */
export function verpflegungMitStellen(): Verpflegung {
  const nichts = { gesamt: 0, sonderkost: KEINE_SONDERKOST };
  return {
    empfaenger: empfaenger(),
    stellen: [
      stelle({ id: TURNHALLE, bezeichnung: 'Ausgabe Turnhalle Nord', art: 'ausgabestelle' }),
      stelle({ id: FELDKUECHE, bezeichnung: 'Feldküche BR Sportplatz', art: 'feldkueche' }),
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
        stelle_ids: [TURNHALLE, FELDKUECHE],
        je_stelle: [
          { stelle_id: TURNHALLE, ausgegeben: { gesamt: 80, sonderkost: KEINE_SONDERKOST } },
          { stelle_id: FELDKUECHE, ausgegeben: { gesamt: 100, sonderkost: KEINE_SONDERKOST } },
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
