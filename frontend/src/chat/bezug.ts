import type {
  Auftrag, BezugTyp, LageberichtAnzeige, Meldung, Person, Schaden, Uhs,
} from '../api/types';
import { schadenRegistrierAnzeige } from '../api/einsatzSchaden';
import { registrierAnzeige } from '../api/einsatzPerson';

/** Eine wählbare/auflösbare Bezug-Option: Objekt-ID + menschenlesbares Label. */
export interface BezugOption {
  value: number;
  label: string;
}

/** Optionen je Bezugstyp — gemeinsame Datenquelle für Picker (BezugDialog) und
 *  Anzeige-Auflösung (NachrichtenStrom). */
export type BezugOptionen = Record<BezugTyp, BezugOption[]>;

/** Deutsche Anzeigenamen der Bezugstypen. */
export const BEZUG_TYP_LABEL: Record<BezugTyp, string> = {
  schaden: 'Schaden',
  uhs: 'UHS',
  person: 'Person',
  lagebericht: 'Lagebericht',
  meldung: 'Meldung',
  auftrag: 'Auftrag',
};

/** Reihenfolge + Labels für das Typ-Select. */
export const BEZUG_TYP_OPTIONEN: { value: BezugTyp; label: string }[] = (
  Object.keys(BEZUG_TYP_LABEL) as BezugTyp[]
).map((value) => ({ value, label: BEZUG_TYP_LABEL[value] }));

function kuerze(s: string, max = 60): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function schadenLabel(s: Schaden): string {
  return `${schadenRegistrierAnzeige(s.registrier_nr)} · ${s.typ} · ${s.ort}`;
}

export function uhsLabel(u: Uhs): string {
  return `${u.bezeichnung} (${u.typ})`;
}

export function personLabel(p: Person): string {
  const name = [p.vorname, p.name].filter(Boolean).join(' ');
  const nr = registrierAnzeige(p.registrier_nr);
  return name ? `${nr} · ${name}` : nr;
}

export function lageberichtLabel(l: LageberichtAnzeige): string {
  return l.titel;
}

export function meldungLabel(m: Meldung): string {
  return `#${m.lfd_nr} · ${m.absender}`;
}

export function auftragLabel(a: Auftrag): string {
  return kuerze(a.auftrag_text);
}

/** Löst (Typ, ID) gegen die geladenen Optionen zu einem Label auf. Fällt auf
 *  „{Typ} #{id}" zurück, wenn das Objekt nicht (mehr) in der Liste ist —
 *  z. B. storniert/gefiltert (kein DB-FK, vgl. LFH-103). */
export function bezugLabel(typ: BezugTyp, id: number, optionen: BezugOptionen): string {
  const treffer = optionen[typ]?.find((o) => o.value === id);
  return treffer ? treffer.label : `${BEZUG_TYP_LABEL[typ]} #${id}`;
}
