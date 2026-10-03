import type { AbrufZustand } from '../api/abrufZustand';
import type {
  Einheit,
  Einsatzabschnitt,
  KommunikationsStelle,
  Stab,
  Stellenart,
  Verbindungsmittel,
} from '../api/types';
import { kommunikationsmittelLabel } from '../components/kommunikationsmittel';
import { einheitDetailPfad, einsatzabschnittePfad } from '../routing/deeplinks';
import { besetzungDarstellung, zeileFuer } from './besetzung';
import { ZUSTAND_GRUND } from './funkplan';
import type { Quelle } from './luecken';

/**
 * Kommunikationsplan des S6 (LFH-848): wer im Einsatz über welche Verbindung außerhalb des Funks
 * erreichbar ist. Reiner Kern ohne React. Herleitung:
 * `openspec/changes/lfh-848-kommunikationsplan/design.md` (D4, D5).
 *
 * - **Gepflegt** sind nur Stellen ohne eigenes Heim: Führungsfunktionen und externe Stellen
 *   (Server, `api/kommunikationsplan.ts`).
 * - **Abgeleitet** sind Abschnitte und Einheiten mit Kommunikationsmittel oder Erreichbarkeit;
 *   ihre Angaben werden dort gepflegt, die Zeile führt hin. Keine zweite Datenhaltung.
 * - **Die Verbindung gehört der Stelle.** Die Besetzung aus dem Stab ist nur Nebentext;
 *   Kontaktangaben des Einsatzpersonals kommen hier nie vor.
 * - Eine fehlende Quelle ist kein leerer Bestand: die Gruppe trägt ihren Zustand.
 */

export type KommunikationsGruppeArt = 'stab' | 'abschnitte' | 'einheiten' | 'extern';

export const GRUPPEN_TITEL: Record<KommunikationsGruppeArt, string> = {
  stab: 'Einsatzleitung und Stab',
  abschnitte: 'Abschnitte',
  einheiten: 'Einheiten',
  extern: 'Externe Stellen',
};

export const STELLENART_LABEL: Record<Stellenart, string> = {
  funktion: 'Führungsfunktion',
  leitstelle: 'Leitstelle',
  behoerde: 'Behörde',
  verbindungsperson: 'Verbindungsperson',
  sonstige: 'Sonstige Stelle',
};

/** Reihenfolge der externen Arten in Auswahllisten, wie die Sortierung des Servers. */
export const EXTERNE_STELLENARTEN: readonly Exclude<Stellenart, 'funktion'>[] = [
  'leitstelle',
  'behoerde',
  'verbindungsperson',
  'sonstige',
];

/** Festnetz und Mobil teilen die Labels mit Abschnitt und Einheit (`kommunikationsmittel.ts`). */
export const VERBINDUNGSMITTEL_LABEL: Record<Verbindungsmittel, string> = {
  festnetz: 'Festnetz',
  mobil: 'Mobil',
  fax: 'Fax',
  email: 'E-Mail',
  messenger: 'Messenger',
  melder: 'Melder',
  sonstiges: 'Sonstiges',
};

export const VERBINDUNGSMITTEL_OPTIONEN = (
  Object.entries(VERBINDUNGSMITTEL_LABEL) as [Verbindungsmittel, string][]
).map(([value, label]) => ({ value, label }));

/** Eine Verbindung, wie die Tabelle sie zeigt. `verweis` ist ein `tel:`/`mailto:`-Ziel. */
export interface VerbindungsAnzeige {
  schluessel: string;
  /** Nur bei gepflegten Verbindungen: die id zum Bearbeiten. */
  id?: number;
  mittel: Verbindungsmittel | null;
  mittelLabel: string | null;
  wert: string;
  hinweis: string | null;
  verweis: string | null;
}

interface ZeileBasis {
  schluessel: string;
  /** Menschenlesbare Kennung, nie eine Datenbank-id. */
  kennung: string;
  /** Nebentext unter der Kennung (Besetzung, Art der Stelle), `null` = keiner. */
  nebentext: string | null;
  verbindungen: VerbindungsAnzeige[];
}

export type KommunikationsZeile =
  | (ZeileBasis & { art: 'gepflegt'; stelle: KommunikationsStelle })
  | (ZeileBasis & { art: 'abschnitt'; ziel: string })
  | (ZeileBasis & { art: 'einheit'; ziel: string });

export interface KommunikationsGruppe {
  art: KommunikationsGruppeArt;
  titel: string;
  /** Zustand der Quelle; nur bei `daten` sind `zeilen` eine Aussage über den Bestand. */
  zustand: AbrufZustand;
  zeilen: KommunikationsZeile[];
}

export interface KommunikationsplanQuellen {
  einsatzId: number;
  stellen: Quelle<KommunikationsStelle>;
  abschnitte: Quelle<Einsatzabschnitt>;
  einheiten: Quelle<Einheit>;
  /** Besetzung des Stabs; nur für den Nebentext der Sachgebiete. */
  stab: { zustand: AbrufZustand; daten: Stab | undefined };
}

/**
 * `tel:` nur für Festnetz und Mobil, auf Ziffern und ein führendes `+` reduziert; `mailto:` nur
 * mit `@`. Bleibt nichts Wählbares übrig, ist der Wert Text (design.md D5).
 */
export function verbindungsVerweis(mittel: Verbindungsmittel | null, wert: string): string | null {
  const w = wert.trim();
  if (mittel === 'festnetz' || mittel === 'mobil') {
    const plus = w.startsWith('+') ? '+' : '';
    const ziffern = w.replace(/\D/g, '');
    return ziffern.length >= 3 ? `tel:${plus}${ziffern}` : null;
  }
  if (mittel === 'email') return w.includes('@') && !/\s/.test(w) ? `mailto:${w}` : null;
  return null;
}

/** Schlüssel der Abschnitts-/Einheitsangabe → Verbindungsmittel, soweit es eins gibt. */
function mittelAusKommunikationsmittel(
  schluessel: string | null | undefined,
): Verbindungsmittel | null {
  return schluessel === 'festnetz' || schluessel === 'mobil' ? schluessel : null;
}

/** Die eine Verbindung einer abgeleiteten Zeile aus Kommunikationsmittel und Erreichbarkeit. */
function abgeleiteteVerbindung(
  schluessel: string,
  kommunikationsmittel: string | null | undefined,
  erreichbarkeit: string | null | undefined,
): VerbindungsAnzeige[] {
  const label = kommunikationsmittelLabel(kommunikationsmittel);
  const wert = erreichbarkeit?.trim() ?? '';
  if (!label && !wert) return [];
  const mittel = mittelAusKommunikationsmittel(kommunikationsmittel);
  return [
    {
      schluessel: `${schluessel}-v`,
      mittel,
      mittelLabel: label,
      wert,
      hinweis: null,
      verweis: wert ? verbindungsVerweis(mittel, wert) : null,
    },
  ];
}

/** Nebentext einer Funktionszeile: die Besetzung der Sachgebiete S1–S6, sonst keiner. */
function besetzungsText(
  stelle: KommunikationsStelle,
  stab: KommunikationsplanQuellen['stab'],
): string | null {
  const f = stelle.funktion;
  if (f !== 's1' && f !== 's2' && f !== 's3' && f !== 's4' && f !== 's5' && f !== 's6') return null;
  if (stab.zustand !== 'daten') return `Besetzung ${ZUSTAND_GRUND[stab.zustand]}`;
  return besetzungDarstellung(zeileFuer(stab.daten, f)).label;
}

function gepflegteZeile(
  stelle: KommunikationsStelle,
  stab: KommunikationsplanQuellen['stab'],
): KommunikationsZeile {
  const schluessel = `st-${stelle.id}`;
  const istFunktion = stelle.stellenart === 'funktion';
  const kennung = istFunktion
    ? [stelle.funktion_label, stelle.bezeichnung].filter(Boolean).join(' · ')
    : (stelle.bezeichnung ?? STELLENART_LABEL[stelle.stellenart]);
  return {
    art: 'gepflegt',
    schluessel,
    kennung,
    nebentext: istFunktion ? besetzungsText(stelle, stab) : STELLENART_LABEL[stelle.stellenart],
    stelle,
    verbindungen: stelle.verbindungen.map((v) => ({
      schluessel: `${schluessel}-v${v.id}`,
      id: v.id,
      mittel: v.mittel,
      mittelLabel: VERBINDUNGSMITTEL_LABEL[v.mittel],
      wert: v.wert,
      hinweis: v.hinweis ?? null,
      verweis: verbindungsVerweis(v.mittel, v.wert),
    })),
  };
}

function hatAngaben(x: { kommunikationsmittel?: string | null; erreichbarkeit?: string | null }) {
  return Boolean(x.kommunikationsmittel?.trim() || x.erreichbarkeit?.trim());
}

/** Die vier Gruppen in fester Folge (Spec „Stellen in festen Gruppen“). */
export function baueKommunikationsplan(q: KommunikationsplanQuellen): KommunikationsGruppe[] {
  const stellen = q.stellen.zustand === 'daten' ? q.stellen.daten : [];
  const gruppe = (
    art: KommunikationsGruppeArt,
    zustand: AbrufZustand,
    zeilen: KommunikationsZeile[],
  ): KommunikationsGruppe => ({
    art,
    titel: GRUPPEN_TITEL[art],
    zustand,
    zeilen: zustand === 'daten' ? zeilen : [],
  });

  return [
    gruppe(
      'stab',
      q.stellen.zustand,
      stellen.filter((s) => s.stellenart === 'funktion').map((s) => gepflegteZeile(s, q.stab)),
    ),
    gruppe(
      'abschnitte',
      q.abschnitte.zustand,
      q.abschnitte.daten.filter(hatAngaben).map((a) => {
        const schluessel = `ab-${a.id}`;
        return {
          art: 'abschnitt',
          schluessel,
          kennung: a.name,
          nebentext: a.kurzbezeichnung ?? null,
          ziel: einsatzabschnittePfad(q.einsatzId, { abschnitt: a.id }),
          verbindungen: abgeleiteteVerbindung(schluessel, a.kommunikationsmittel, a.erreichbarkeit),
        };
      }),
    ),
    gruppe(
      'einheiten',
      q.einheiten.zustand,
      q.einheiten.daten.filter(hatAngaben).map((e) => {
        const schluessel = `eh-${e.id}`;
        return {
          art: 'einheit',
          schluessel,
          kennung: e.name,
          nebentext: e.funkrufname ?? null,
          ziel: einheitDetailPfad(q.einsatzId, e.id),
          verbindungen: abgeleiteteVerbindung(schluessel, e.kommunikationsmittel, e.erreichbarkeit),
        };
      }),
    ),
    gruppe(
      'extern',
      q.stellen.zustand,
      stellen.filter((s) => s.stellenart !== 'funktion').map((s) => gepflegteZeile(s, q.stab)),
    ),
  ];
}
