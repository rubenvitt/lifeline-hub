// frontend/src/command-palette/fuzzy.ts
import Fuse from 'fuse.js';
import { GRUPPEN_REIHENFOLGE, GRUPPE_NUR_ORDNUNG, PALETTE_MODI, type Befehl, type PaletteModus } from './typen';

/** Ein Fuse-Treffer samt Bewertung. Kleiner ist besser (0 = perfekt). */
export interface Treffer {
  befehl: Befehl;
  score: number;
  /**
   * Vorgegebene Präfixstufe für Treffer, die NICHT durch Fuse gelaufen sind
   * (LFH-391 · C1). Fehlt sie, rechnet {@link ordneTreffer} sie aus dem Label.
   *
   * Sie ist der Grund, warum das zentrale Akzeptanzkriterium des Tickets hält: ein
   * Datensatz-Label trägt seine Modulherkunft vorn („Personen · R-042 · Müller"), und
   * {@link praefixStufe} läse daraus bei der Suche '42' Stufe 3 — dieselbe Stufe wie
   * Fuse-Rauschen, während ein Einsatz namens „Einsatz 42" auf Stufe 2 stünde und den
   * exakten Nummerntreffer verdrängte. Der Erzeuger des Treffers weiss, WORAUF er
   * getroffen hat; das Label weiss es nicht.
   */
  stufe?: 0 | 1 | 2 | 3;
}

/**
 * Der Score eines Treffers, den Fuse NIE bewertet hat (LFH-391 · C1, Review-Befund).
 *
 * Datensatz-Treffer trugen bisher `score: 0` — den bestmöglichen Wert für etwas, das gar
 * nicht bewertet worden ist. Auf gleicher Stufe verdrängten sie damit jeden Befehl: wer auf
 * einer Einsatzseite 'einheit' tippte, um zum MODUL Einheiten zu springen, fand den
 * Modulbefehl hinter fünf Einheiten-Datensätzen, und Enter öffnete einen Datensatz.
 *
 * 1 ist STRIKT schlechter als jeder Fuse-Score und damit die ehrliche Setzung „unbewertet
 * verliert gegen bewertet". Der Wert ist hergeleitet, nicht geraten: fuse.js deckelt den
 * Bitap-Score eines angenommenen Treffers auf `threshold` (hier 0,4) und potenziert ihn in
 * `computeScore` mit `weight * norm` — einem STRIKT positiven Exponenten. `0,4^x` bleibt für
 * jedes x > 0 unter 1, ein Gleichstand ist also ausgeschlossen und die Gruppenachse darunter
 * kommt gar nicht erst zum Zug.
 *
 * KEIN kleinerer Wert tut es: `norm` ist `1/sqrt(Tokenzahl)`, bei langem Feld geht der
 * Exponent gegen 0 und der Score damit gegen 1 — gemessen 0,973 bei einem 400-Wort-Label
 * (`fuzzy.test.ts`, „kommt bei langem Label nahe an 1 heran"). Ein Deckel bei 0,9 hätte den
 * Datensatz dort wieder vor den Befehl gestellt.
 *
 * Die STUFE bleibt davon unberührt und ist die erste Achse: ein Nummerntreffer steht auf
 * Stufe 0 und gewinnt weiterhin gegen jeden Fuzzy-Treffer, so schlecht sein Score auch ist.
 */
export const UNBEWERTET = 1;

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
 * Bei AKTIVER Suche entfallen die ORDNUNGSKOPIEN — `zuletzt` (LFH-391 · A3, Review-Befund)
 * und seit Etappe D auch `ausgefuehrt`.
 *
 * Sie sind reine ORDNUNGSMITTEL für die leere Ansicht: `baueBefehle` filtert die
 * Zuletzt-Schleife und die Modul-Schleife über DIESELBE Funktion `istModulFreigegeben`,
 * jeder `zuletzt:`-Eintrag hat also zwingend einen `modul:`-Zwilling mit gleichem Label,
 * gleicher Ikone und gleichem Ziel; ein `ausgefuehrt:`-Eintrag ist per Konstruktion eine
 * Kopie seines Originals — er entsteht nur, wenn dieses Original in derselben Runde gebaut
 * wurde. Im Gruppenzweig trennen die Überschriften „Zuletzt", „Zuletzt ausgeführt" und
 * „Module" die Zwillinge — genau darauf beruht die im Bestand bewusst hingenommene
 * Dopplung (LFH-337 · H12).
 *
 * Flach gerendert fällt diese Trennung weg, und es blieben zwei bis auf die DOM-`id`
 * ununterscheidbare Zeilen: wer zuletzt die Lagekarte offen hatte und „lage" tippt, sah
 * „Lagekarte, Lagekarte, Lagemeldungen" — für Vorlesende zweimal derselbe Name ohne
 * Hinweis, warum. Die Rangfolge leistet bei aktiver Suche ohnehin, wofür die Gruppen da
 * waren; sie hier wegzulassen nimmt der Liste nichts und ist deshalb der Dedup-Sonderregel
 * vorzuziehen.
 *
 * EINE Funktion für beide Gruppen, gesteuert über {@link GRUPPE_NUR_ORDNUNG}: eine zweite
 * Filterfunktion daneben wäre eine zweite Stelle, an der eine dritte Kopien-Gruppe vergessen
 * werden kann — und das Vergessen ist hier still (die Liste rendert, nur doppelt).
 */
export function ohneOrdnungsdubletten(befehle: Befehl[]): Befehl[] {
  return befehle.filter((b) => !GRUPPE_NUR_ORDNUNG[b.gruppe]);
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
  const ausLabel = textStufe(b.label, s);
  if (ausLabel < 3) return ausLabel;
  if (b.schlagworte?.some((w) => w.toLocaleLowerCase().startsWith(s))) return 2;
  return 3;
}

/**
 * Dieselbe Stufenrechnung über einen NACKTEN Text (LFH-391 · C1).
 *
 * Herausgezogen, weil ein zweiter Aufrufer sie über etwas anderes als ein Befehlslabel
 * braucht: `datensaetze.ts` stuft einen Texttreffer über das BASISlabel ohne die
 * Modulherkunft davor. Zwei Kopien dieser vier Zeilen wären zwei Definitionen von
 * „beginnt damit" — genau die Sorte Drift, die niemandem auffällt, weil beide Seiten
 * plausibel aussehen.
 *
 * Ein Schlagwort erreicht hier bewusst nur Stufe 2 (siehe {@link praefixStufe}) und ist
 * deshalb NICHT Teil dieser Funktion: es ist Suchhilfe, nicht das, was man liest.
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
 *
 * Ein `Treffer.stufe` GEWINNT gegen die Rechnung aus dem Label (LFH-391 · C1) — siehe die
 * Begründung am Feld.
 */
export function ordneTreffer(treffer: Treffer[], suche: string): Befehl[] {
  return treffer
    .map((t, index) => ({ t, index, stufe: t.stufe ?? praefixStufe(t.befehl, suche) }))
    .sort(
      (a, b) =>
        a.stufe - b.stufe ||
        a.t.score - b.t.score ||
        GRUPPEN_REIHENFOLGE.indexOf(a.t.befehl.gruppe) - GRUPPEN_REIHENFOLGE.indexOf(b.t.befehl.gruppe) ||
        a.index - b.index,
    )
    .map((x) => x.t.befehl);
}
