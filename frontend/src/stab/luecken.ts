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

// ── Verbindungen (LFH-625 D3) ──────────────────────────────────────────────────────────────────

/**
 * Das Urteil über die Verbindung einer Stelle zu ihrer übergeordneten Stelle — die eine Regel für
 * die Kante der Fernmeldeskizze (`stab/fernmeldeskizze.ts`) und die Lücke im Funkplan.
 *
 * - `gemeinsam`: die Sprechgruppen, die beiden zugeordnet sind, nach Betriebsart (Bezeichnungen).
 * - `keine`: beide Seiten haben Sprechgruppen, aber keine gemeinsame.
 * - `ohne-urteil`: einer Seite fehlt jede Sprechgruppe (die Lücke steht schon am Knoten, doppelt
 *   gezählt hieße eine Ursache zweimal melden), oder es gibt keine übergeordnete Stelle.
 *
 * Verglichen wird die Sprechgruppe selbst (`id`): ein einsatzlokaler und ein Stammdaten-Eintrag
 * können dieselbe Bezeichnung tragen.
 */
export type Kante =
  { art: 'gemeinsam'; tmo: string[]; dmo: string[] } | { art: 'keine' } | { art: 'ohne-urteil' };

export function verbindungsurteil(
  oben: readonly Sprechgruppe[],
  unten: readonly Sprechgruppe[],
): Kante {
  if (oben.length === 0 || unten.length === 0) return { art: 'ohne-urteil' };
  const obenIds = new Set(oben.map((s) => s.id));
  const gemeinsam = unten.filter((s) => obenIds.has(s.id));
  if (gemeinsam.length === 0) return { art: 'keine' };
  return {
    art: 'gemeinsam',
    tmo: gemeinsam.filter((s) => s.betriebsart === 'TMO').map((s) => s.bezeichnung),
    dmo: gemeinsam.filter((s) => s.betriebsart === 'DMO').map((s) => s.bezeichnung),
  };
}

export interface Stelle {
  art: 'abschnitt' | 'einheit';
  id: number;
  name: string;
}

export interface Verbindung {
  unten: Stelle;
  oben: Stelle;
}

/**
 * Verbindungen ohne gemeinsame Sprechgruppe. Die Paare folgen der Platzierung des Funkplans und
 * des Organigramms (Spec `stab-fernmeldeskizze`, „Knotenaufbau“): Unterabschnitt → Abschnitt,
 * oberste Einheit → Abschnitt, Untereinheit → Einheit — jeweils nur, wenn die übergeordnete Stelle
 * bekannt ist. Waisen haben kein Paar. Treffer erst der Abschnitte, dann der Einheiten, je in der
 * Reihenfolge ihrer Liste. Fehlt eine der beiden Listen, wäre jede Zahl unvollständig: dann der
 * Zustand statt einer Zahl.
 */
export function verbindungenOhneGemeinsameSprechgruppe(
  abschnitte: Quelle<Einsatzabschnitt>,
  einheiten: Quelle<Einheit>,
): Luecke<Verbindung> {
  const zustand = schlechtesterZustand(abschnitte.zustand, einheiten.zustand);
  if (zustand !== 'daten') return { zustand, treffer: [] };

  const abschnittJeId = new Map(abschnitte.daten.map((a) => [a.id, a]));
  const einheitJeId = new Map(einheiten.daten.map((e) => [e.id, e]));
  const stelleAbschnitt = (a: Einsatzabschnitt): Stelle => ({
    art: 'abschnitt',
    id: a.id,
    name: a.name,
  });
  const stelleEinheit = (e: Einheit): Stelle => ({ art: 'einheit', id: e.id, name: e.name });

  const treffer: Verbindung[] = [];
  for (const a of abschnitte.daten) {
    const oben = a.ueber_abschnitt_id != null ? abschnittJeId.get(a.ueber_abschnitt_id) : undefined;
    if (oben && verbindungsurteil(oben.sprechgruppen, a.sprechgruppen).art === 'keine') {
      treffer.push({ unten: stelleAbschnitt(a), oben: stelleAbschnitt(oben) });
    }
  }
  // Die übergeordnete Stelle einer Einheit: ihre Einheit, sonst (oberste Einheit) ihr Abschnitt.
  const obenVon = (
    e: Einheit,
  ): { stelle: Stelle; sprechgruppen: readonly Sprechgruppe[] } | null => {
    const einheit = e.ueber_einheit_id != null ? einheitJeId.get(e.ueber_einheit_id) : undefined;
    if (einheit) return { stelle: stelleEinheit(einheit), sprechgruppen: einheit.sprechgruppen };
    const a = e.abschnitt_id != null ? abschnittJeId.get(e.abschnitt_id) : undefined;
    return a ? { stelle: stelleAbschnitt(a), sprechgruppen: a.sprechgruppen } : null;
  };
  for (const e of einheiten.daten) {
    const oben = obenVon(e);
    if (oben && verbindungsurteil(oben.sprechgruppen, e.sprechgruppen).art === 'keine') {
      treffer.push({ unten: stelleEinheit(e), oben: oben.stelle });
    }
  }
  return { zustand, treffer };
}
