import type { AbrufZustand } from '../api/abrufZustand';
import type {
  Einheit,
  Einsatzabschnitt,
  KommunikationsStelle,
  SkizzenVerbindung,
  Stab,
  StellenKanal,
  Stellenart,
  Verbindungsmittel,
} from '../api/types';
import { kommunikationsmittelLabel } from '../components/kommunikationsmittel';
import { einheitDetailPfad, einsatzabschnittePfad } from '../routing/deeplinks';
import { besetzungDarstellung, zeileFuer } from './besetzung';
import { ZUSTAND_GRUND } from './funkplan';
import type { Quelle } from './luecken';
import { bedingungszeichenText } from './skizzenZeichen';

/**
 * Kommunikationsplan des S6 (LFH-848): wer im Einsatz über welche Verbindung außerhalb des Funks
 * erreichbar ist. Reiner Kern ohne React. Herleitung:
 * `openspec/changes/archive/2026-10-04-lfh-848-kommunikationsplan/design.md` (D4, D5).
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
  /**
   * Kanäle einer externen Stelle als Nebentext (LFH-893), z. B. „TMO SL AS (geplant)“; gepflegt
   * in der Fernmeldeskizze. Funktionen, Abschnitte und Einheiten: leer (ihre Sprechgruppen stehen
   * im Funkplan).
   */
  kanaele: string[];
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

/** Ein Kanal als Text: Bedingungszeichen wie in der Skizze, „geplant“ als Wort (D7). */
function kanalText(k: StellenKanal): string {
  const zeichen = bedingungszeichenText(k.sprechgruppe.betriebsart, k.sprechgruppe.bezeichnung);
  return k.status === 'geplant' ? `${zeichen} (geplant)` : zeichen;
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
    kanaele: istFunktion ? [] : stelle.sprechgruppen.map(kanalText),
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
          kanaele: [],
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
          kanaele: [],
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

// ── Entfernen einer Stelle (LFH-893, Spec-Delta `stab-kommunikationsplan`) ─────────────────────

/**
 * Was mit einer Stelle verloren geht: ihre Verbindungen, ihre Kanäle und ihre Verbindungen in der
 * Fernmeldeskizze (der Server räumt alle drei mit). `skizzenVerbindungen` ist `null`, solange die
 * Skizze nicht geladen ist — dann ist die Zahl unbekannt, nicht null.
 */
export interface EntfernUmfang {
  verbindungen: number;
  sprechgruppen: number;
  skizzenVerbindungen: number | null;
}

export function entfernUmfang(
  stelle: KommunikationsStelle,
  skizzenVerbindungen: Quelle<SkizzenVerbindung>,
): EntfernUmfang {
  const trifft = (b: SkizzenVerbindung['von']) => b.art === 'stelle' && b.id === stelle.id;
  return {
    verbindungen: stelle.verbindungen.length,
    sprechgruppen: stelle.sprechgruppen.length,
    skizzenVerbindungen:
      skizzenVerbindungen.zustand === 'daten'
        ? skizzenVerbindungen.daten.filter((v) => trifft(v.von) || trifft(v.nach)).length
        : null,
  };
}

/** Eine Rückfrage, sobald etwas mitgeht — oder unbekannt ist, ob etwas mitgeht. */
export function brauchtRueckfrage(u: EntfernUmfang): boolean {
  return (
    u.verbindungen > 0 ||
    u.sprechgruppen > 0 ||
    u.skizzenVerbindungen == null ||
    u.skizzenVerbindungen > 0
  );
}

function anzahl(n: number, einzahl: string, mehrzahl: string): string {
  return `${n} ${n === 1 ? einzahl : mehrzahl}`;
}

/** Der Text der Rückfrage: nennt jede Zahl größer null, eine unbekannte mit Grund. */
export function entfernText(kennung: string, u: EntfernUmfang): string {
  const teile = [
    u.verbindungen > 0 ? anzahl(u.verbindungen, 'Verbindung', 'Verbindungen') : null,
    u.sprechgruppen > 0 ? anzahl(u.sprechgruppen, 'Sprechgruppe', 'Sprechgruppen') : null,
    u.skizzenVerbindungen
      ? anzahl(u.skizzenVerbindungen, 'Skizzen-Verbindung', 'Skizzen-Verbindungen')
      : null,
  ].filter((t): t is string => t != null);
  const mit =
    teile.length === 0
      ? ''
      : `, mit ${teile.length === 1 ? teile[0] : `${teile.slice(0, -1).join(', ')} und ${teile[teile.length - 1]}`}`;
  const satz = `„${kennung}“ wird aus dem Kommunikationsplan entfernt${mit}.`;
  return u.skizzenVerbindungen == null
    ? `${satz} Ob sie in der Fernmeldeskizze verbunden ist, ist nicht bekannt (Fernmeldeskizze ` +
        'nicht geladen); ihre Verbindungen dort gehen mit.'
    : satz;
}
