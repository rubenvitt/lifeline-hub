import Fuse from 'fuse.js';
import {
  GRUPPEN_REIHENFOLGE,
  GRUPPE_NUR_ORDNUNG,
  PALETTE_MODI,
  type Befehl,
  type PaletteModus,
} from './typen';

/** Ein Fuse-Treffer samt Bewertung. Kleiner ist besser (0 = perfekt). */
export interface Treffer {
  befehl: Befehl;
  score: number;
  /**
   * Vorgegebene Präfixstufe für Treffer, die NICHT durch Fuse gelaufen sind; fehlt sie, rechnet
   * {@link ordneTreffer} sie aus dem Label. Der Erzeuger weiß, WORAUF er getroffen hat: aus
   * „Personen · R-042 · Müller“ läse {@link praefixStufe} bei '42' Stufe 3, und ein „Einsatz 42“
   * auf Stufe 2 verdrängte den exakten Nummerntreffer.
   */
  stufe?: 0 | 1 | 2 | 3;
}

/**
 * Der Score eines Treffers, den Fuse NIE bewertet hat. 1 ist STRIKT schlechter als jeder
 * Fuse-Score („unbewertet verliert gegen bewertet“): fuse.js deckelt den Bitap-Score auf
 * `threshold` (0,4) und potenziert ihn mit einem strikt positiven Exponenten, `0,4^x` bleibt
 * unter 1. Mit `score: 0` verdrängten Datensätze auf gleicher Stufe jeden Befehl.
 *
 * Kein kleinerer Wert tut es: bei langem Label geht der Exponent gegen 0 und der Score gegen 1
 * (`fuzzy.test.ts`, „kommt bei langem Label nahe an 1 heran“).
 *
 * Die STUFE bleibt die erste Achse: ein Nummerntreffer auf Stufe 0 gewinnt weiter.
 */
export const UNBEWERTET = 1;

/**
 * Die Modi mit Präfixzeichen, die EINZIGE Quelle für Parser und Legende. `Object.keys` über den
 * exhaustiven Record statt einer eigenen Liste, in der ein Modus still fehlen könnte.
 */
export function modiMitPraefix(): {
  modus: PaletteModus;
  praefix: string;
  legende: string | null;
}[] {
  const mit: { modus: PaletteModus; praefix: string; legende: string | null }[] = [];
  for (const modus of Object.keys(PALETTE_MODI) as PaletteModus[]) {
    const { praefix, legende } = PALETTE_MODI[modus];
    if (praefix !== null) mit.push({ modus, praefix, legende });
  }
  return mit;
}

/**
 * Zerlegt die Eingabe in Modus und Restsuche. GENAU EINE Aufrufstelle: `CommandPalette.tsx`.
 *
 * Zweimal getrimmt: außen, damit ein führendes Leerzeichen das Präfix nicht verdeckt; hinter
 * dem Präfix, damit '> lage' und '>lage' dasselbe bedeuten. Nur das ERSTE Zeichen ist Syntax.
 */
export function parsePraefix(suche: string): { modus: PaletteModus; rest: string } {
  const s = suche.trim();
  const treffer = modiMitPraefix().find((m) => s.startsWith(m.praefix));
  if (!treffer) return { modus: 'alles', rest: s };
  return { modus: treffer.modus, rest: s.slice(treffer.praefix.length).trimStart() };
}

/**
 * Der Modus ist ein reiner GRUPPENFILTER. Er läuft VOR `filtereBefehle`, sonst bewertete Fuse
 * Befehle, die der Modus verwirft.
 */
export function filtereNachModus(befehle: Befehl[], modus: PaletteModus): Befehl[] {
  const gruppen = PALETTE_MODI[modus].gruppen;
  if (!gruppen) return befehle;
  return befehle.filter((b) => gruppen.includes(b.gruppe));
}

/**
 * Bei AKTIVER Suche entfallen die ORDNUNGSKOPIEN (`zuletzt`, `ausgefuehrt`).
 *
 * Jeder `zuletzt:`-Eintrag hat zwingend einen `modul:`-Zwilling mit gleichem Label, Ikone und
 * Ziel, ein `ausgefuehrt:`-Eintrag ist eine Kopie seines Originals. Im Gruppenzweig trennen die
 * Überschriften die Zwillinge; flach blieben zwei ununterscheidbare Zeilen („Lagekarte,
 * Lagekarte“), für Vorlesende zweimal derselbe Name.
 *
 * EINE Funktion für beide Gruppen, gesteuert über {@link GRUPPE_NUR_ORDNUNG}.
 */
export function ohneOrdnungsdubletten(befehle: Befehl[]): Befehl[] {
  return befehle.filter((b) => !GRUPPE_NUR_ORDNUNG[b.gruppe]);
}

/**
 * Substring- + Fuzzy-Filter über Label und Schlagworte; leere Suche → unverändert.
 * `includeScore` ist in fuse.js per Vorgabe AUS; der Score ist die zweite Achse von
 * {@link ordneTreffer}.
 */
export function filtereBefehle(befehle: Befehl[], suche: string): Treffer[] {
  const s = suche.trim();
  // Leere Suche: die Palette rendert dann den GRUPPEN-Zweig, der Score wird nie gelesen.
  if (!s) return befehle.map((befehl) => ({ befehl, score: 0 }));
  const fuse = new Fuse(befehle, {
    keys: ['label', 'schlagworte'],
    threshold: 0.4,
    ignoreLocation: true,
    minMatchCharLength: 1,
    includeScore: true,
  });
  return fuse.search(s).map((r) => ({ befehl: r.item, score: r.score ?? 0 }));
}

/** Wortgrenze für Stufe 2 — alles, was weder Buchstabe noch Ziffer ist, trennt. */
const WORTGRENZE = /[^\p{L}\p{N}]+/u;

/**
 * Der Präfixbonus, den Fuse nicht liefert (mit `threshold: 0.4` und `ignoreLocation` bewertet
 * Fuse einen Präfix nicht besonders). Stufen: 0 = das Label IST die Suche, 1 = das Label beginnt
 * damit, 2 = ein Wort des Labels oder ein Schlagwort beginnt damit, 3 = nur Fuse.
 *
 * Verglichen wird KLEINGESCHRIEBEN, sonst griffe im Normalbetrieb keine Stufe. Blindfleck,
 * bewusst: keine Diakritika-Faltung ('einsaetze' gegen 'Einsätze' bleibt Stufe 3).
 */
export function praefixStufe(b: Befehl, suche: string): 0 | 1 | 2 | 3 {
  const s = suche.trim().toLocaleLowerCase();
  if (!s) return 3;
  const ausLabel = textStufe(b.label, s);
  if (ausLabel < 3) return ausLabel;
  if (b.schlagworte?.some((w) => w.toLocaleLowerCase().startsWith(s))) return 2;
  return 3;
}

/**
 * Dieselbe Stufenrechnung über einen NACKTEN Text, für `datensaetze.ts` (Basislabel ohne
 * Modulherkunft); zwei Kopien wären zwei Definitionen von „beginnt damit“. Schlagworte gehören
 * nicht hierher, sie erreichen nur Stufe 2 (siehe {@link praefixStufe}).
 */
export function textStufe(text: string, suche: string): 0 | 1 | 2 | 3 {
  const s = suche.trim().toLocaleLowerCase();
  // Ein leerer Begriff darf keine Stufe 1 erzeugen — `''.startsWith` ist immer wahr.
  if (!s) return 3;
  const t = text.toLocaleLowerCase();
  if (t === s) return 0;
  if (t.startsWith(s)) return 1;
  if (t.split(WORTGRENZE).some((w) => w.startsWith(s))) return 2;
  return 3;
}

/**
 * Die Rangfolge bei AKTIVER Suche, flach und gruppenübergreifend: nach Gruppen iteriert stand
 * Fuse-Rauschen einer Schnellaktion vor dem genauen Modultreffer.
 *
 * Der Schlüssel ist TOTAL: [Präfixstufe, Score, Gruppenrang, Eingabeindex]. Der Gruppenrang ist
 * Tiebreak und hält bei Gleichwertigen die kuratierte Startordnung; der Eingabeindex macht die
 * Ordnung unabhängig von der Stabilität von `sort`. Ein `Treffer.stufe` gewinnt gegen die
 * Rechnung aus dem Label.
 *
 * Bei LEERER Suche ruft die Produktion diese Funktion nicht (dort rendert der Gruppenzweig).
 */
export function ordneTreffer(treffer: Treffer[], suche: string): Befehl[] {
  return treffer
    .map((t, index) => ({ t, index, stufe: t.stufe ?? praefixStufe(t.befehl, suche) }))
    .sort(
      (a, b) =>
        a.stufe - b.stufe ||
        a.t.score - b.t.score ||
        GRUPPEN_REIHENFOLGE.indexOf(a.t.befehl.gruppe) -
          GRUPPEN_REIHENFOLGE.indexOf(b.t.befehl.gruppe) ||
        a.index - b.index,
    )
    .map((x) => x.t.befehl);
}
