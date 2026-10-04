import type {
  Verbindungsart,
  Verbindungsmedium,
  Verbindungsstatus,
} from '../../api/fernmeldeskizzeVertrag';
import type { Fernmeldenetz } from '../fernmeldeskizze';

/**
 * Erkunden der Fernmeldeskizze (LFH-893, Spec „Erkunden durch Hervorheben und Filtern“): rein,
 * über Elementschlüssel. Die Fläche hebt hervor, was {@link hervorhebung} liefert, und nimmt
 * zurück, was ein Filter ({@link sichtbarImFilter}) nicht zeigt — beides über Strichstärke und
 * Deckkraft, nie über Farbe allein (D12).
 *
 * Elemente sind die Stellen und Schienen des Netzes (`fs`, `ab-…`, `eh-…`, `ks-…`, `ko-…`,
 * `sg-…`), Verbindungen `vb-…`, Bereiche `be-…`, das Schriftfeld (`schriftfeld`) und je
 * Teilnehmer einer Schiene eine Stichleitung ({@link stichSchluessel}).
 */

export type Ebenenfilter = 'alle' | 'sprechfunk' | 'leitergebunden' | 'daten' | 'luecken';
export type Ebene = Exclude<Ebenenfilter, 'alle' | 'luecken'>;

export const EBENENFILTER: readonly { wert: Ebenenfilter; label: string }[] = [
  { wert: 'alle', label: 'Alle' },
  { wert: 'sprechfunk', label: 'Sprechfunk' },
  { wert: 'leitergebunden', label: 'Leitergebunden' },
  { wert: 'daten', label: 'Daten' },
  { wert: 'luecken', label: 'Nur Lücken' },
];

/** Das Schriftfeld als Element (wählbar, im Paneel bearbeitbar). */
export const SCHRIFTFELD = 'schriftfeld';

/** Arten, die Daten übertragen (Ebene „Daten“), gleich welches Medium. */
const DATEN_ARTEN: ReadonlySet<Verbindungsart> = new Set(['daten', 'fax', 'bild', 'livestream']);

const TRENNER = '~';

/** Schlüssel der Stichleitung einer Stelle an einer Schiene, z. B. `sg-2~eh-10`. */
export function stichSchluessel(schiene: string, stelle: string): string {
  return `${schiene}${TRENNER}${stelle}`;
}

export function teileStichSchluessel(key: string): { schiene: string; stelle: string } | null {
  const i = key.indexOf(TRENNER);
  if (i < 0) return null;
  return { schiene: key.slice(0, i), stelle: key.slice(i + 1) };
}

export interface Stichleitung {
  key: string;
  schiene: string;
  stelle: string;
  status: Verbindungsstatus;
}

/** Alle Stichleitungen, je Schiene in der Folge ihrer Teilnehmer. */
export function stichleitungen(netz: Fernmeldenetz): Stichleitung[] {
  return netz.schienen.flatMap((s) =>
    s.teilnehmer.map((t) => ({
      key: stichSchluessel(s.key, t.element),
      schiene: s.key,
      stelle: t.element,
      status: t.status,
    })),
  );
}

/** Die Ebenen einer Verbindung: Daten nach Art, sonst Sprechfunk; leitergebunden nach Medium. */
export function verbindungsEbenen(v: { art: Verbindungsart; medium: Verbindungsmedium }): Ebene[] {
  const ebenen: Ebene[] = [];
  const daten = DATEN_ARTEN.has(v.art);
  if (v.medium === 'leitung') ebenen.push('leitergebunden');
  else if (!daten) ebenen.push('sprechfunk');
  if (daten) ebenen.push('daten');
  return ebenen;
}

/**
 * Was bei einem Filter voll steht; `null` = alles („Alle“). Bereiche und Schriftfeld stehen
 * immer voll: sie sind Rahmen, keine Ebene.
 */
export function sichtbarImFilter(netz: Fernmeldenetz, filter: Ebenenfilter): Set<string> | null {
  if (filter === 'alle') return null;
  const voll = new Set<string>([SCHRIFTFELD, ...netz.bereiche.map((b) => b.key)]);
  const stiche = stichleitungen(netz);

  if (filter === 'luecken') {
    const nimmSchiene = (schiene: string) => {
      voll.add(schiene);
      for (const s of stiche.filter((x) => x.schiene === schiene)) {
        voll.add(s.key);
        voll.add(s.stelle);
      }
    };
    for (const st of netz.stellen) {
      if (st.luecken.length === 0) continue;
      voll.add(st.key);
      for (const l of st.luecken) if (l.gegenstelle) voll.add(l.gegenstelle);
      for (const s of stiche.filter((x) => x.stelle === st.key)) {
        voll.add(s.key);
        voll.add(s.schiene);
      }
    }
    for (const s of netz.schienen) if (s.luecken.length > 0) nimmSchiene(s.key);
    return voll;
  }

  if (filter === 'sprechfunk') {
    for (const s of stiche) {
      voll.add(s.key);
      voll.add(s.schiene);
      voll.add(s.stelle);
    }
    for (const s of netz.schienen) voll.add(s.key);
  }
  for (const v of netz.verbindungen) {
    if (!verbindungsEbenen(v).includes(filter)) continue;
    voll.add(v.key);
    voll.add(v.von);
    voll.add(v.nach);
  }
  return voll;
}

/**
 * Was ein gewähltes, fokussiertes oder berührtes Element hervorhebt (Spec „Wer hört mit?“):
 * eine Schiene ihre Teilnehmer, eine Stelle ihre Schienen und Gegenstellen (an denselben
 * Schienen und über Verbindungen), eine Verbindung ihre Enden. `null` = nichts hervorgehoben.
 */
export function hervorhebung(netz: Fernmeldenetz, key: string | null): Set<string> | null {
  if (key == null) return null;
  const stiche = stichleitungen(netz);
  const h = new Set<string>([key]);

  const schiene = netz.schienen.find((s) => s.key === key);
  if (schiene) {
    for (const s of stiche.filter((x) => x.schiene === key)) {
      h.add(s.key);
      h.add(s.stelle);
    }
    return h;
  }
  if (netz.stellen.some((s) => s.key === key)) {
    for (const eigen of stiche.filter((x) => x.stelle === key)) {
      h.add(eigen.key);
      h.add(eigen.schiene);
      for (const gegen of stiche.filter((x) => x.schiene === eigen.schiene)) {
        h.add(gegen.key);
        h.add(gegen.stelle);
      }
    }
    for (const v of netz.verbindungen) {
      if (v.von !== key && v.nach !== key) continue;
      h.add(v.key);
      h.add(v.von);
      h.add(v.nach);
    }
    return h;
  }
  const verbindung = netz.verbindungen.find((v) => v.key === key);
  if (verbindung) {
    h.add(verbindung.von);
    h.add(verbindung.nach);
    return h;
  }
  const stich = teileStichSchluessel(key);
  if (stich && stiche.some((s) => s.key === key)) {
    h.add(stich.schiene);
    h.add(stich.stelle);
    return h;
  }
  if (key === SCHRIFTFELD || netz.bereiche.some((b) => b.key === key)) return h;
  return null;
}
