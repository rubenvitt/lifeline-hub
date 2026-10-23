import type { AbrufZustand } from '../api/abrufZustand';
import type {
  Einheit,
  Einsatzabschnitt,
  ExterneStelle,
  ExterneStelleArt,
  KommunikationsStelle,
  NeueVerbindung,
  SkizzenVerbindung,
  Stab,
  StellenKanal,
  Stellenart,
  KommunikationsVerbindung,
  Verbindungsmittel,
} from '../api/types';
import { anzahl } from '../anzeige/anzahl';
import { VERBINDUNGSMITTEL_LABEL, verbindungsVerweis } from '../components/verbindungen';
import { einheitDetailPfad, einsatzabschnittePfad, einsatzdatenPfad } from '../routing/deeplinks';
import { besetzungDarstellung, zeileFuer } from './besetzung';
import { einsatzleiterDarstellung, einsatzleiterKurz } from './einsatzleiter';
import {
  FUEHRUNGSSTELLE_STELLE,
  fuehrungsstelleErfasst,
  type FuehrungsstelleQuelle,
} from './fuehrungsstelle';
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
 * - **Abgeleitet** sind Abschnitte und Einheiten mit Verbindungen (LLH-1134): alle ihre
 *   Verbindungen, dort gepflegt, die Zeile führt hin. Keine zweite Datenhaltung.
 * - **Die eigene Führungsstelle** (LFH-849, D7; LFH-1148) ist ebenso abgeleitet: erste Zeile der
 *   Gruppe „Einsatzleitung und Stab“, sobald sie erfasst ist (`fuehrungsstelleErfasst`, dieselbe
 *   Regel wie im Funkplan), gepflegt auf Einsatzdaten.
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

/**
 * Planart einer Stelle aus dem Katalog „Externe Stellen“ (LLH-1165; Abbildung festgelegt in
 * `openspec/changes/archive/2026-10-11-lfh-1194-externe-stellen-katalog/design.md`, D2). Der Plan
 * kennt keine Polizei und keine Hilfsorganisation: Polizei ist Behörde, Hilfsorganisation sonstige
 * Stelle. Eine Verbindungsperson ist ein Mensch und steht nie im Katalog.
 */
export const STELLENART_AUS_KATALOG: Record<
  ExterneStelleArt,
  Exclude<Stellenart, 'funktion' | 'verbindungsperson'>
> = {
  leitstelle: 'leitstelle',
  polizei: 'behoerde',
  behoerde: 'behoerde',
  hilfsorganisation: 'sonstige',
  sonstige: 'sonstige',
};

/** Die aktiven Katalogstellen, die als Planart `art` in den Plan kommen. */
export function katalogStellenFuer(
  art: Stellenart,
  katalog: readonly ExterneStelle[],
): ExterneStelle[] {
  return katalog.filter((s) => s.aktiv && STELLENART_AUS_KATALOG[s.art] === art);
}

/**
 * Vorschlag für die Lücke „Leitstelle“ (LLH-1165): die zuständige Leitstelle des Katalogs, solange
 * der Plan gar keine Leitstelle führt. Steht schon eine da, fehlt ihr nur die Verbindung, und die
 * gehört an diese Stelle, nicht an eine zweite.
 */
export function leitstellenVorschlag(
  stellen: readonly KommunikationsStelle[],
  katalog: readonly ExterneStelle[],
): ExterneStelle | undefined {
  if (stellen.some((s) => s.stellenart === 'leitstelle')) return undefined;
  return katalog.find((s) => s.aktiv && s.zustaendig && s.art === 'leitstelle');
}

/**
 * Die Rufnummer einer Katalogstelle als erste Verbindung der neuen Stelle, `undefined` ohne
 * Nummer. Der Katalog unterscheidet Festnetz und Mobil nicht; Festnetz ist die Dienstnummer einer
 * Stelle, das Mittel lässt sich danach ändern. Übernommen wird nur Text (Speicherform A): eine
 * spätere Änderung im Katalog ändert den Plan nicht.
 */
export function verbindungAusRufnummer(
  rufnummer: string | null | undefined,
): NeueVerbindung | undefined {
  const wert = rufnummer?.trim();
  return wert ? { mittel: 'festnetz', wert } : undefined;
}

// Labels, Optionen und Verweis teilen Stellen, Abschnitte, Einheiten und Führungsstelle
// (LLH-1134); der Re-Export hält die bestehenden Importe stabil.
export {
  VERBINDUNGSMITTEL_LABEL,
  VERBINDUNGSMITTEL_OPTIONEN,
  verbindungsVerweis,
} from '../components/verbindungen';

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
   * Warum der Nebentext nur „—“ zeigt (LLH-1180, design.md D8): die Besetzung kommt vom Stab, und
   * der ist für die Person nicht frei. Fehlt, wenn der Nebentext für sich spricht.
   */
  nebentextGrund?: string;
  /**
   * Kanäle einer externen Stelle als Nebentext (LFH-893), z. B. „TMO SL AS (geplant)“; gepflegt
   * in der Fernmeldeskizze. Führungsstelle, Funktionen, Abschnitte und Einheiten: leer (ihre
   * Sprechgruppen stehen im Funkplan).
   */
  kanaele: string[];
  verbindungen: VerbindungsAnzeige[];
}

export type KommunikationsZeile =
  | (ZeileBasis & { art: 'gepflegt'; stelle: KommunikationsStelle })
  | (ZeileBasis & { art: 'fuehrungsstelle'; ziel: string })
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
  /** Die eigene Führungsstelle (LFH-849), eine einzelne Angabe mit eigener Weiche. */
  fuehrungsstelle: FuehrungsstelleQuelle;
}

/** Die Verbindungen eines Datensatzes als Tabellenzeilen; `id` nur bei gepflegten Stellen. */
function anzeigen(
  schluessel: string,
  verbindungen: readonly KommunikationsVerbindung[],
  mitId: boolean,
): VerbindungsAnzeige[] {
  return verbindungen.map((v) => ({
    schluessel: `${schluessel}-v${v.id}`,
    ...(mitId ? { id: v.id } : {}),
    mittel: v.mittel,
    mittelLabel: VERBINDUNGSMITTEL_LABEL[v.mittel],
    wert: v.wert,
    hinweis: v.hinweis ?? null,
    verweis: verbindungsVerweis(v.mittel, v.wert),
  }));
}

/** Grund am „—“ der Besetzung, wenn der Stab nicht frei ist (LLH-1180, design.md D8). */
export const STAB_NICHT_FREI_GRUND = 'Stab nicht freigegeben';

/**
 * Nebentext einer Funktionszeile: die Besetzung der Sachgebiete S1–S6, sonst keiner. Ist der Stab
 * für die Person nicht frei, steht „—“ mit Grund: die Verbindung gehört der Stelle (Spec
 * `stab-kommunikationsplan`), nur ihre Besetzung fehlt.
 */
function besetzungsText(
  stelle: KommunikationsStelle,
  stab: KommunikationsplanQuellen['stab'],
): { nebentext: string | null; nebentextGrund?: string } {
  const f = stelle.funktion;
  if (f !== 's1' && f !== 's2' && f !== 's3' && f !== 's4' && f !== 's5' && f !== 's6') {
    return { nebentext: null };
  }
  if (stab.zustand === 'gesperrt') return { nebentext: '—', nebentextGrund: STAB_NICHT_FREI_GRUND };
  if (stab.zustand !== 'daten') return { nebentext: `Besetzung ${ZUSTAND_GRUND[stab.zustand]}` };
  return { nebentext: besetzungDarstellung(zeileFuer(stab.daten, f)).label };
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
    ...(istFunktion
      ? besetzungsText(stelle, stab)
      : { nebentext: STELLENART_LABEL[stelle.stellenart] }),
    kanaele: istFunktion ? [] : stelle.sprechgruppen.map(kanalText),
    stelle,
    verbindungen: anzeigen(schluessel, stelle.verbindungen, true),
  };
}

/**
 * Die Zeile der eigenen Führungsstelle (LFH-1148): erfasst mit Rufname und Einsatzleiter als
 * Nebentext (LLH-1168, nur über `einsatzleiter.ts`, nie aus Besetzung oder App-Rolle) und allen
 * ihren Verbindungen (LLH-1134); nicht erfasst keine Zeile. Fehlt die
 * Quelle, steht die Zeile mit Grund da, denn ihr Fehlen hieße sonst „nicht erfasst“. Lädt sie
 * noch, steht nichts.
 */
function fuehrungsstelleZeile(q: KommunikationsplanQuellen): KommunikationsZeile | null {
  const { zustand, daten } = q.fuehrungsstelle;
  if (zustand === 'laden') return null;
  if (zustand === 'daten' && !fuehrungsstelleErfasst(daten)) return null;
  const schluessel = 'fs';
  return {
    art: 'fuehrungsstelle',
    schluessel,
    kennung: FUEHRUNGSSTELLE_STELLE,
    nebentext:
      zustand === 'daten' ? fuehrungsstelleNebentext(q.fuehrungsstelle) : ZUSTAND_GRUND[zustand],
    kanaele: [],
    ziel: einsatzdatenPfad(q.einsatzId),
    verbindungen: zustand === 'daten' ? anzeigen(schluessel, daten?.verbindungen ?? [], false) : [],
  };
}

/** „Florian Kreis 10-1 · Einsatzleiter Anna Schulz“; ohne Rufname nur der Einsatzleiter. */
function fuehrungsstelleNebentext(quelle: FuehrungsstelleQuelle): string {
  const leiter = `Einsatzleiter ${einsatzleiterKurz(einsatzleiterDarstellung(quelle))}`;
  const rufname = quelle.daten?.rufname?.trim();
  return rufname ? `${rufname} · ${leiter}` : leiter;
}

function hatAngaben(x: { verbindungen?: readonly KommunikationsVerbindung[] | null }) {
  return (x.verbindungen?.length ?? 0) > 0;
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

  const fs = fuehrungsstelleZeile(q);
  return [
    gruppe('stab', q.stellen.zustand, [
      ...(fs ? [fs] : []),
      ...stellen.filter((s) => s.stellenart === 'funktion').map((s) => gepflegteZeile(s, q.stab)),
    ]),
    gruppe(
      'abschnitte',
      q.abschnitte.zustand,
      q.abschnitte.daten.filter(hatAngaben).map((a) => {
        const schluessel = `ab-${a.id}`;
        return {
          art: 'abschnitt',
          schluessel,
          kennung: a.name,
          nebentext: a.rufname ?? a.kurzbezeichnung ?? null,
          kanaele: [],
          ziel: einsatzabschnittePfad(q.einsatzId, { abschnitt: a.id }),
          verbindungen: anzeigen(schluessel, a.verbindungen, false),
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
          verbindungen: anzeigen(schluessel, e.verbindungen, false),
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
  // Ein Satz (Folge vor einem unumkehrbaren Schritt); eine unbekannte Zahl nennt ihren Grund.
  const skizze =
    u.skizzenVerbindungen == null
      ? ', samt etwaiger Verbindungen in der Fernmeldeskizze (nicht geladen)'
      : '';
  return `„${kennung}“ wird aus dem Kommunikationsplan entfernt${mit}${skizze}.`;
}
