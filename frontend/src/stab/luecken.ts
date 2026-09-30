import { schlechtesterZustand, type AbrufZustand } from '../api/abrufZustand';
import type { Einheit, Einsatzabschnitt, Sprechgruppe } from '../api/types';

/**
 * Lücken als reine Filter über bereits geladene Listen (Stab-Spec LFH-46, Entscheidung 15:
 * keine zweite Verdichtung). Wo eine Zahl auf dem Funkplan (LFH-548) und später auf der
 * Stabzeile (ST6) steht, kommt sie aus DIESER Funktion.
 *
 * Eine Lücke ohne geladene Daten hat keine Zahl: `treffer` bleibt leer, und der Zustand sagt,
 * warum. Aufrufer zeigen dann „—" mit Grund, nie „0".
 */
export interface Quelle<T> {
  zustand: AbrufZustand;
  daten: readonly T[];
}

export interface Luecke<T> {
  zustand: AbrufZustand;
  treffer: T[];
}

function filtere<T>(q: Quelle<T>, trifft: (x: T) => boolean): Luecke<T> {
  if (q.zustand !== 'daten') return { zustand: q.zustand, treffer: [] };
  return { zustand: 'daten', treffer: q.daten.filter(trifft) };
}

export function abschnitteOhneSprechgruppe(
  abschnitte: Quelle<Einsatzabschnitt>,
): Luecke<Einsatzabschnitt> {
  return filtere(abschnitte, (a) => a.sprechgruppen.length === 0);
}

export function einheitenOhneSprechgruppe(einheiten: Quelle<Einheit>): Luecke<Einheit> {
  return filtere(einheiten, (e) => e.sprechgruppen.length === 0);
}

export function einheitenOhneErreichbarkeit(einheiten: Quelle<Einheit>): Luecke<Einheit> {
  return filtere(einheiten, (e) => !e.erreichbarkeit?.trim());
}

/**
 * Einsatzlokale Sprechgruppen, die weder ein Abschnitt noch eine Einheit trägt. Die Zuordnung
 * steht an Abschnitt und Einheit; fehlt eine der beiden Listen, wäre jede Zahl geraten.
 */
export function lokaleSprechgruppenOhneZuordnung(
  sprechgruppen: Quelle<Sprechgruppe>,
  abschnitte: Quelle<Einsatzabschnitt>,
  einheiten: Quelle<Einheit>,
): Luecke<Sprechgruppe> {
  const zustand = schlechtesterZustand(
    sprechgruppen.zustand,
    abschnitte.zustand,
    einheiten.zustand,
  );
  if (zustand !== 'daten') return { zustand, treffer: [] };
  const zugeordnet = new Set<number>();
  for (const a of abschnitte.daten) for (const s of a.sprechgruppen) zugeordnet.add(s.id);
  for (const e of einheiten.daten) for (const s of e.sprechgruppen) zugeordnet.add(s.id);
  return {
    zustand,
    treffer: sprechgruppen.daten.filter((s) => s.einsatz_lokal && !zugeordnet.has(s.id)),
  };
}
