import type {
  Auftrag,
  BezugTyp,
  LageberichtAnzeige,
  Meldung,
  Person,
  Schaden,
  Uhs,
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

/** Kurzinfo eines referenzierten Objekts für das Bezug-Popover (LFH-103). */
export interface BezugKurzinfo {
  titel: string;
  zeilen: string[];
}

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

/**
 * Kürzungsgrenze für Freitext in einer Zeile. EXPORTIERT für `command-palette/datensaetze.ts`
 * (LFH-391 · C1): dessen ETB-Label kürzt denselben Sorte Freitext wie `auftragLabel`. Kopiert
 * wären es zwei Zahlen, und die zweite zöge beim nächsten Anfassen nicht mit.
 */
export function kuerze(s: string, max = 60): string {
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

// Kurzinfo-Builder je Typ — speisen das Bezug-Popover aus den Listen-Objekten.
export function schadenInfo(s: Schaden): BezugKurzinfo {
  return {
    titel: schadenLabel(s),
    zeilen: [`Typ: ${s.typ}`, `Ausmaß: ${s.ausmass}`, `Ort: ${s.ort}`],
  };
}
export function uhsInfo(u: Uhs): BezugKurzinfo {
  return { titel: uhsLabel(u), zeilen: [`Typ: ${u.typ}`] };
}
export function personInfo(p: Person): BezugKurzinfo {
  const name = [p.vorname, p.name].filter(Boolean).join(' ');
  return { titel: personLabel(p), zeilen: name ? [`Name: ${name}`] : ['Name nicht erfasst'] };
}
export function lageberichtInfo(l: LageberichtAnzeige): BezugKurzinfo {
  return { titel: lageberichtLabel(l), zeilen: [`Ersteller: ${l.ersteller_name}`] };
}
export function meldungInfo(m: Meldung): BezugKurzinfo {
  return { titel: meldungLabel(m), zeilen: [`Absender: ${m.absender}`] };
}
export function auftragInfo(a: Auftrag): BezugKurzinfo {
  return { titel: `Auftrag #${a.id}`, zeilen: [a.auftrag_text] };
}

/** Löst (Typ, ID) gegen die geladenen Optionen zu einem Label auf. Fällt auf
 *  „{Typ} #{id}" zurück, wenn das Objekt nicht (mehr) in der Liste ist —
 *  z. B. storniert/gefiltert (kein DB-FK, vgl. LFH-103). */
export function bezugLabel(typ: BezugTyp, id: number, optionen: BezugOptionen): string {
  const treffer = optionen[typ]?.find((o) => o.value === id);
  return treffer ? treffer.label : `${BEZUG_TYP_LABEL[typ]} #${id}`;
}
