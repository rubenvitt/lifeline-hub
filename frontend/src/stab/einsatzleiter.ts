import type { Einsatzleiter } from '../api/types';
import { taktischeDtg, type AnzeigeKonventionen } from '../anzeige/format';
import type { FuehrungsstelleQuelle } from './fuehrungsstelle';
import { md, ZUSTAND_GRUND } from './funkplan';

/**
 * Der Einsatzleiter nach FwDV 100, gerechnet an EINER Stelle (LFH-1199). Kopfleiste der
 * Einsatzdaten, Wurzel des Organigramms, Funkplan-Zeile der Führungsstelle, die Lagebericht-
 * Übernahmen und der Einsatzbericht lesen ihn aus der Führungsstelle und formen ihn hier, ebenso der
 * Kommunikationsplan und die Einsatzliste (LLH-1168, diese aus `EinsatzAnzeige`). Nie aus
 * der App-Rolle `einsatzleitung` oder der Stab-Besetzung ableiten: das wäre eine erfundene Leitung
 * (`frontend/AGENTS.md`, „Keine erfundenen Daten“).
 *
 * Herleitung: `openspec/changes/archive/2026-10-11-lfh-1199-einsatzleiter-angabe/design.md` (D5).
 */
export type EinsatzleiterDarstellung =
  | { art: 'erfasst'; name: string; seit: string; nichtMehrDisponiert: boolean }
  | { art: 'nicht-erfasst' }
  | { art: 'zustand'; grund: string };

/** „Anna Schulz“ bzw. „KBM Weber (extern)“; nach der Schwärzung benannt statt geraten. */
export function einsatzleiterName(e: Einsatzleiter): string {
  const name = e.name ?? 'Name geschwärzt';
  return e.art === 'extern' ? `${name} (extern)` : name;
}

export function einsatzleiterDarstellung(quelle: FuehrungsstelleQuelle): EinsatzleiterDarstellung {
  if (quelle.zustand !== 'daten') return { art: 'zustand', grund: ZUSTAND_GRUND[quelle.zustand] };
  return einsatzleiterAusAngabe(quelle.daten?.einsatzleiter);
}

/**
 * Die Angabe selbst, wo sie ohne die Quelle der Führungsstelle kommt: die Einsatzliste trägt sie an
 * `EinsatzAnzeige` (LLH-1168). Fehlt sie, ist kein Einsatzleiter erfasst.
 */
export function einsatzleiterAusAngabe(
  e: Einsatzleiter | null | undefined,
): EinsatzleiterDarstellung {
  if (!e) return { art: 'nicht-erfasst' };
  return {
    art: 'erfasst',
    name: einsatzleiterName(e),
    seit: e.seit,
    nichtMehrDisponiert: e.art === 'personal' && !e.personal_noch_disponiert,
  };
}

/** Name und Vermerk ohne Zeit, für enge Zellen (Kopfleiste, Funkplan). */
export function einsatzleiterKurz(d: EinsatzleiterDarstellung): string {
  if (d.art === 'nicht-erfasst') return 'nicht erfasst';
  if (d.art === 'zustand') return d.grund;
  return d.nichtMehrDisponiert ? `${d.name} · nicht mehr disponiert` : d.name;
}

/** Bildschirmtext: Name, Vermerk und „seit“ als kurze taktische DTG. */
export function einsatzleiterText(d: EinsatzleiterDarstellung, konv: AnzeigeKonventionen): string {
  const kurz = einsatzleiterKurz(d);
  return d.art === 'erfasst' ? `${kurz} · seit ${taktischeDtg(d.seit, konv)}` : kurz;
}

/**
 * Für Lagebericht und Bericht: Name als Text (nie Markup), „seit“ über `dtg`, den Formatierer des
 * Dokuments (volle taktische DTG in der Anzeigezone, wie sein Stand).
 */
export function einsatzleiterMarkdown(
  d: EinsatzleiterDarstellung,
  dtg: (utc: string) => string,
): string {
  if (d.art === 'nicht-erfasst') return 'nicht erfasst';
  if (d.art === 'zustand') return d.grund;
  const vermerk = d.nichtMehrDisponiert ? ' · nicht mehr disponiert' : '';
  return `${md(d.name)}${vermerk} (seit ${dtg(d.seit)})`;
}
