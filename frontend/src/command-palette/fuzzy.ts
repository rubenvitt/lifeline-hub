// frontend/src/command-palette/fuzzy.ts
import Fuse from 'fuse.js';
import { GRUPPEN_REIHENFOLGE, PALETTE_MODI, type Befehl, type PaletteModus } from './typen';

/** Ein Fuse-Treffer samt Bewertung. Kleiner ist besser (0 = perfekt). */
export interface Treffer {
  befehl: Befehl;
  score: number;
}

/**
 * Die Modi mit Präfixzeichen — die EINZIGE Quelle für Parser und Legende.
 *
 * `Object.keys` mit Verengung statt einer danebenstehenden Liste: der Record ist über
 * `PaletteModus` exhaustiv, ein Modus kann hier also nicht fehlen. Eine eigene
 * Reihenfolge-Konstante hätte genau die Lücke, die `GRUPPEN_REIHENFOLGE` einmal hatte —
 * ein Eintrag fehlt, nichts bricht, der Modus ist still unerreichbar.
 */
export function modiMitPraefix(): { modus: PaletteModus; praefix: string; legende: string | null }[] {
  const mit: { modus: PaletteModus; praefix: string; legende: string | null }[] = [];
  for (const modus of Object.keys(PALETTE_MODI) as PaletteModus[]) {
    const { praefix, legende } = PALETTE_MODI[modus];
    if (praefix !== null) mit.push({ modus, praefix, legende });
  }
  return mit;
}

/**
 * Zerlegt die Eingabe in Modus und Restsuche (LFH-391 · A4).
 *
 * GENAU EINE Aufrufstelle: `CommandPalette.tsx`. Ein zweiter Parser wäre eine zweite
 * Wahrheit darüber, was „der Suchbegriff" ist — Etappe C bekommt das Paar gemeldet,
 * statt es noch einmal zu zerlegen.
 *
 * Zweimal getrimmt, aus zwei Gründen: aussen, damit ein führendes Leerzeichen das Präfix
 * nicht verdeckt; hinter dem Präfixzeichen, damit '> lage' und '>lage' dasselbe bedeuten.
 * Nur das ERSTE Zeichen ist Syntax — ein '>' weiter hinten bleibt Suchtext, sonst
 * zerschnitte es die Eingabe an einer Stelle, die niemand als Syntax gemeint hat.
 */
export function parsePraefix(suche: string): { modus: PaletteModus; rest: string } {
  const s = suche.trim();
  const treffer = modiMitPraefix().find((m) => s.startsWith(m.praefix));
  if (!treffer) return { modus: 'alles', rest: s };
  return { modus: treffer.modus, rest: s.slice(treffer.praefix.length).trimStart() };
}

/**
 * Der Modus ist ein reiner GRUPPENFILTER — er ordnet nichts um und bewertet nichts.
 *
 * Er läuft VOR `filtereBefehle`, nicht danach: Fuse würde sonst über Befehle bewerten, die
 * der Modus ohnehin verwirft, und der Rang der übrigen hinge an Treffern, die niemand sieht.
 */
export function filtereNachModus(befehle: Befehl[], modus: PaletteModus): Befehl[] {
  const gruppen = PALETTE_MODI[modus].gruppen;
  if (!gruppen) return befehle;
  return befehle.filter((b) => gruppen.includes(b.gruppe));
}

/**
 * Bei AKTIVER Suche entfällt die Gruppe `zuletzt` (LFH-391 · A3, Review-Befund).
 *
 * Sie ist ein reines ORDNUNGSMITTEL für die leere Ansicht: `baueBefehle` filtert die
 * Zuletzt-Schleife und die Modul-Schleife über DIESELBE Funktion `istModulFreigegeben`,
 * jeder `zuletzt:`-Eintrag hat also zwingend einen `modul:`-Zwilling mit gleichem Label,
 * gleicher Ikone und gleichem Ziel. Im Gruppenzweig trennen die Überschriften „Zuletzt"
 * und „Module" die beiden — genau darauf beruht die im Bestand bewusst hingenommene
 * Dopplung (LFH-337 · H12).
 *
 * Flach gerendert fällt diese Trennung weg, und es blieben zwei bis auf die DOM-`id`
 * ununterscheidbare Zeilen: wer zuletzt die Lagekarte offen hatte und „lage" tippt, sah
 * „Lagekarte, Lagekarte, Lagemeldungen" — für Vorlesende zweimal derselbe Name ohne
 * Hinweis, warum. Die Rangfolge leistet bei aktiver Suche ohnehin, wofür die Gruppe da
 * war; sie hier wegzulassen nimmt der Liste nichts und ist deshalb der Dedup-Sonderregel
 * vorzuziehen.
 */
export function ohneOrdnungsdubletten(befehle: Befehl[]): Befehl[] {
  return befehle.filter((b) => b.gruppe !== 'zuletzt');
}

/**
 * Substring- + Fuzzy-Filter über Label und Schlagworte; leere Suche → unverändert.
 *
 * `includeScore` ist in fuse.js per Vorgabe AUS — ohne die Option liefert `search` das Feld
 * gar nicht erst (`undefined`, nicht bloss ein ignorierter Wert). Der Score ist die zweite
 * Achse von {@link ordneTreffer}; ohne ihn ordnete allein die Gruppe, und gemessen stand
 * damit Rauschen vor dem genauen Treffer (siehe Kopfkommentar dort).
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
 * Der Präfixbonus, den Fuse nicht liefert (LFH-391 · A3).
 *
 * Mit `threshold: 0.4` und `ignoreLocation` bewertet Fuse einen Präfix nicht besonders —
 * das Akzeptanzkriterium „exakter Präfixtreffer vor unscharfem Treffer" ist mit Fuse allein
 * nicht erfüllbar. Die Stufen: 0 = das Label IST die Suche, 1 = das Label beginnt damit,
 * 2 = ein Wort des Labels oder ein Schlagwort beginnt damit, 3 = nur Fuse hat es gefunden.
 *
 * Verglichen wird KLEINGESCHRIEBEN. Im Suchfeld wird klein getippt, die Labels tragen
 * Grossbuchstaben — zeichengenau griffe im Normalbetrieb keine der drei Stufen, und der
 * ganze Bonus liefe leer, ohne dass ein Bestandstest es sähe (die sind ordnungsagnostisch).
 *
 * BLINDFLECK, bewusst: keine Diakritika-Faltung. 'einsaetze' gegen 'Einsätze' bleibt
 * Stufe 3 und trägt weiterhin allein Fuse.
 */
export function praefixStufe(b: Befehl, suche: string): 0 | 1 | 2 | 3 {
  const s = suche.trim().toLocaleLowerCase();
  if (!s) return 3;
  const label = b.label.toLocaleLowerCase();
  if (label === s) return 0;
  if (label.startsWith(s)) return 1;
  if (label.split(WORTGRENZE).some((w) => w.startsWith(s))) return 2;
  if (b.schlagworte?.some((w) => w.toLocaleLowerCase().startsWith(s))) return 2;
  return 3;
}

/**
 * Die Rangfolge bei AKTIVER Suche (LFH-391 · A3) — flach, gruppenübergreifend.
 *
 * Gemessen an fuse.js 7.5.0 mit dem Bestandskorpus und der Suche 'etb': Fuse bewertet
 * `modul:etb` mit 8.60e-9 und die Schnellaktion „Neue Person erfassen" mit 5.77e-1 (reines
 * Rauschen). Weil `CommandPalette` bis dahin ausschliesslich über `GRUPPEN_REIHENFOLGE`
 * iterierte und `schnellaktionen` vor `module` steht, stand das Rauschen VOR dem genauen
 * Treffer. Die Gruppenachse zerstörte die Score-Ordnung gruppenübergreifend.
 *
 * Der Schlüssel ist TOTAL: [Präfixstufe, Score, Gruppenrang, Eingabeindex]. Der Gruppenrang
 * ist TIEBREAK, nicht Primärachse — bei gleichwertigen Treffern bleibt die kuratierte
 * Startordnung aus LFH-337 · M11 erhalten, statt von der Bewertung eingeebnet zu werden.
 * Der Eingabeindex darunter macht die Ordnung unabhängig von der Stabilität von `sort`.
 *
 * Bei LEERER Suche ruft die Produktion diese Funktion NICHT — dort rendert der Gruppenzweig
 * (die Zusicherung dafür hängt am Rendertest in `CommandPalette.test.tsx`, nicht hier: ein
 * `ordneTreffer(t, '')` wäre ein toter Pfad).
 */
export function ordneTreffer(treffer: Treffer[], suche: string): Befehl[] {
  return treffer
    .map((t, index) => ({ t, index, stufe: praefixStufe(t.befehl, suche) }))
    .sort(
      (a, b) =>
        a.stufe - b.stufe ||
        a.t.score - b.t.score ||
        GRUPPEN_REIHENFOLGE.indexOf(a.t.befehl.gruppe) - GRUPPEN_REIHENFOLGE.indexOf(b.t.befehl.gruppe) ||
        a.index - b.index,
    )
    .map((x) => x.t.befehl);
}
