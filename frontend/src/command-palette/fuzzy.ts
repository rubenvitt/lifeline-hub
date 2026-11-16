import {
  GRUPPEN_REIHENFOLGE,
  GRUPPE_NUR_ORDNUNG,
  PALETTE_MODI,
  type Befehl,
  type PaletteModus,
} from './typen';

/** Ein Treffer samt Bewertung. Kleiner ist besser (0 = perfekt). */
export interface Treffer {
  befehl: Befehl;
  score: number;
  /**
   * Vorgegebene Präfixstufe für Treffer, die NICHT durch {@link filtereBefehle} gelaufen sind;
   * fehlt sie, rechnet {@link ordneTreffer} sie aus dem Label. Der Erzeuger weiß, WORAUF er
   * getroffen hat: aus „Personen · R-042 · Müller“ läse {@link praefixStufe} bei '42' Stufe 3, und
   * ein „Einsatz 42“ auf Stufe 2 verdrängte den exakten Nummerntreffer.
   */
  stufe?: 0 | 1 | 2 | 3;
}

/** Score eines Befehls, dessen Suchwörter alle im Label treffen. */
export const IM_LABEL = 0;
/** Score eines Befehls, der für mindestens ein Suchwort Schlagworte braucht. */
export const UEBER_SCHLAGWORT = 0.5;

/**
 * Der Score eines Treffers, den {@link filtereBefehle} NIE bewertet hat (Datensätze). 1 ist STRIKT
 * schlechter als jeder Befehls-Score („unbewertet verliert gegen bewertet“); mit `score: 0`
 * verdrängten Datensätze auf gleicher Stufe jeden Befehl. Die STUFE bleibt die erste Achse: ein
 * Nummerntreffer auf Stufe 0 gewinnt weiter.
 */
export const UNBEWERTET = 1;

/**
 * Ein Suchwort trifft ab dieser Länge auch mitten im Wort (Spec `sprungpalette`, „Ein Treffer
 * braucht Wortanfang oder Teilwort“). Kürzer nur am Wortanfang: „ea“ soll „Einsatzabschnitt“ über
 * sein Schlagwort finden, nicht jedes Wort mit „ea“ darin.
 */
export const TEILWORT_MIN = 3;

/**
 * Die EINE Vergleichsform für Suche und Texte: klein, Umlaute und ß als Umschrift („Kräfte“ =
 * „kraefte“), übrige Diakritika weg. Umschrift VOR der Zerlegung, sonst würde „ä“ zu „a“.
 */
export function normalisiere(text: string): string {
  return text
    .toLocaleLowerCase('de')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '');
}

/**
 * Die Modi mit Präfixzeichen, die EINZIGE Quelle für Parser und Legende. `Object.keys` über den
 * exhaustiven Record statt einer eigenen Liste, in der ein Modus still fehlen könnte.
 */
export function modiMitPraefix(): {
  modus: PaletteModus;
  praefix: string;
  kurz: string | null;
}[] {
  const mit: {
    modus: PaletteModus;
    praefix: string;
    kurz: string | null;
  }[] = [];
  for (const modus of Object.keys(PALETTE_MODI) as PaletteModus[]) {
    const { praefix, kurz } = PALETTE_MODI[modus];
    if (praefix !== null) mit.push({ modus, praefix, kurz });
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
 * Der Modus ist ein reiner GRUPPENFILTER. Er läuft VOR `filtereBefehle`, sonst bewertete der
 * Filter Befehle, die der Modus verwirft.
 */
export function filtereNachModus(befehle: Befehl[], modus: PaletteModus): Befehl[] {
  const gruppen = PALETTE_MODI[modus].gruppen;
  if (!gruppen) return befehle;
  return befehle.filter((b) => gruppen.includes(b.gruppe));
}

/**
 * Bei AKTIVER Suche entfallen die ORDNUNGSKOPIEN (`zuletzt`, `ausgefuehrt`).
 *
 * Jeder `zuletzt:`-Eintrag hat zwingend einen `modul:`-Zwilling mit gleichem Label, Icon und
 * Ziel, ein `ausgefuehrt:`-Eintrag ist eine Kopie seines Originals. Im Gruppenzweig trennen die
 * Überschriften die Zwillinge; flach blieben zwei ununterscheidbare Zeilen („Lagekarte,
 * Lagekarte“), für Vorlesende zweimal derselbe Name.
 *
 * EINE Funktion für beide Gruppen, gesteuert über {@link GRUPPE_NUR_ORDNUNG}.
 */
export function ohneOrdnungsdubletten(befehle: Befehl[]): Befehl[] {
  return befehle.filter((b) => !GRUPPE_NUR_ORDNUNG[b.gruppe]);
}

/** Wortgrenze — alles, was weder Buchstabe noch Ziffer ist, trennt. */
const WORTGRENZE = /[^\p{L}\p{N}]+/u;

/** Die Wörter eines bereits normalisierten Textes, ohne leere Stücke. */
function woerter(normalisiert: string): string[] {
  return normalisiert.split(WORTGRENZE).filter(Boolean);
}

/** Die Suchwörter einer Eingabe, normalisiert. */
function suchwoerter(suche: string): string[] {
  return woerter(normalisiere(suche.trim()));
}

/** Trifft `wort` einen Wortanfang in einem der (normalisierten) Texte? */
function trifftWortanfang(wort: string, texte: readonly string[]): boolean {
  return texte.some((t) => woerter(t).some((w) => w.startsWith(wort)));
}

/** Trifft `wort` einen der (normalisierten) Texte, am Wortanfang oder ab {@link TEILWORT_MIN} als Teilwort? */
function trifft(wort: string, texte: readonly string[]): boolean {
  if (trifftWortanfang(wort, texte)) return true;
  return wort.length >= TEILWORT_MIN && texte.some((t) => t.includes(wort));
}

/**
 * Der Filter über Label und Schlagworte (Spec `sprungpalette`, „Ein Treffer braucht Wortanfang
 * oder Teilwort“): Ein Befehl trifft, wenn JEDES Suchwort im Label oder einem Schlagwort einen
 * Wortanfang trifft oder ab {@link TEILWORT_MIN} Zeichen als Teilwort darin steht. Eine bloße
 * Buchstabenfolge trifft nicht mehr (früher Fuse.js: „rtw“ fand „Lagekarte“). Leere Suche →
 * unverändert. Score: {@link IM_LABEL}, wenn alle Wörter im Label treffen, sonst
 * {@link UEBER_SCHLAGWORT}; er ist die zweite Achse von {@link ordneTreffer}.
 */
export function filtereBefehle(befehle: Befehl[], suche: string): Treffer[] {
  const wortListe = suchwoerter(suche);
  // Leere Suche: die Palette rendert dann den GRUPPEN-Zweig, der Score wird nie gelesen.
  if (wortListe.length === 0) return befehle.map((befehl) => ({ befehl, score: 0 }));
  const treffer: Treffer[] = [];
  for (const befehl of befehle) {
    const label = [normalisiere(befehl.label)];
    const schlagworte = (befehl.schlagworte ?? []).map(normalisiere);
    let nurLabel = true;
    let alle = true;
    for (const wort of wortListe) {
      if (trifft(wort, label)) continue;
      nurLabel = false;
      if (!trifft(wort, schlagworte)) {
        alle = false;
        break;
      }
    }
    if (alle) treffer.push({ befehl, score: nurLabel ? IM_LABEL : UEBER_SCHLAGWORT });
  }
  return treffer;
}

/**
 * Dieselbe Trefferregel wie {@link filtereBefehle} über einen NACKTEN Text: jedes Suchwort trifft
 * einen Wortanfang oder ab {@link TEILWORT_MIN} Zeichen ein Teilwort. Für die Merkmale der
 * Datensätze (design.md D3), damit „tw“ nicht jeden RTW findet.
 */
export function trifftText(text: string, suche: string): boolean {
  const wortListe = suchwoerter(suche);
  const texte = [normalisiere(text)];
  return wortListe.length > 0 && wortListe.every((w) => trifft(w, texte));
}

/**
 * Die erste Ordnungsachse. Stufen: 0 = das Label IST die Suche, 1 = das Label beginnt damit,
 * 2 = jedes Suchwort trifft einen Wortanfang in Label oder Schlagworten, 3 = mindestens ein Wort
 * nur als Teilwort. Verglichen wird in {@link normalisiere}-Form.
 */
export function praefixStufe(b: Befehl, suche: string): 0 | 1 | 2 | 3 {
  const ausLabel = textStufe(b.label, suche);
  if (ausLabel < 3) return ausLabel;
  const wortListe = suchwoerter(suche);
  if (wortListe.length === 0) return 3;
  const texte = [b.label, ...(b.schlagworte ?? [])].map(normalisiere);
  return wortListe.every((w) => trifftWortanfang(w, texte)) ? 2 : 3;
}

/**
 * Dieselbe Stufenrechnung über einen NACKTEN Text, für `datensaetze.ts` (Basislabel ohne
 * Modulherkunft); zwei Kopien wären zwei Definitionen von „beginnt damit“. Schlagworte gehören
 * nicht hierher, sie erreichen nur Stufe 2 (siehe {@link praefixStufe}).
 */
export function textStufe(text: string, suche: string): 0 | 1 | 2 | 3 {
  const s = normalisiere(suche.trim());
  // Ein leerer Begriff darf keine Stufe 1 erzeugen — `''.startsWith` ist immer wahr.
  if (!s) return 3;
  const t = normalisiere(text);
  if (t === s) return 0;
  if (t.startsWith(s)) return 1;
  const wortListe = woerter(s);
  if (wortListe.length > 0 && wortListe.every((w) => trifftWortanfang(w, [t]))) return 2;
  return 3;
}

/**
 * Die Rangfolge bei AKTIVER Suche, flach und gruppenübergreifend: nach Gruppen iteriert stand
 * ein Schlagworttreffer einer Schnellaktion vor dem genauen Modultreffer.
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
