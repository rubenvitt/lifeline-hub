/**
 * Reiner Kern des Vorschlagsfelds „aus Stammdaten oder frei“ (LLH-1144, Spec `stammdaten-feld`,
 * Herleitung `/mnt/project-files/llh-1022/LLH-1144/design.md`). Der Baustein
 * `components/StammdatenFeld.tsx` zeigt nur, was hier entschieden wird: welche Vorschläge in
 * welcher Gruppe und Folge stehen und woher ein Wert kommt („Im Einsatz“, „Stammdaten“, „frei“).
 *
 * Quellen sind Adapter (`stammdaten/vorschlagsquellen.ts`); das Feld kennt keine einzelne Quelle,
 * nur die drei Gruppen. Eine neue Quelle kommt ohne Änderung hier dazu.
 */

/** Die drei Gruppen in ihrer festen Folge. */
export type VorschlagGruppe = 'einsatz' | 'stammdaten' | 'zuletzt';

/** Titel je Gruppe; die Folge der Schlüssel ist die Folge der Gruppen. */
export const GRUPPEN_TITEL: Record<VorschlagGruppe, string> = {
  einsatz: 'Im Einsatz',
  stammdaten: 'Stammdaten',
  zuletzt: 'Zuletzt verwendet',
};

// Aus den Schlüsseln abgeleitet, nicht als Feld-Literal: `api/queryKeyScan.ts` liest ein Literal,
// das mit 'einsatz' beginnt, als Query-Key.
export const GRUPPEN_FOLGE = Object.keys(GRUPPEN_TITEL) as readonly VorschlagGruppe[];

/** Gruppen, die eine Herkunft sind; „Zuletzt verwendet“ ist nur ein Gedächtnis. */
const QUELLEN_GRUPPEN = GRUPPEN_FOLGE.filter(
  (g): g is Exclude<VorschlagGruppe, 'zuletzt'> => g !== 'zuletzt',
);

/** Verweis auf den Datensatz hinter einem gewählten Vorschlag. */
export interface StammdatenRef {
  quelle: string;
  id: number;
}

/**
 * Wertform des Feldes (design.md D1): der Text und, wenn er aus einer Quelle gewählt ist, die
 * Referenz. Im Modus `nurText` ist der Formularwert der reine Text.
 */
export interface StammdatenWert {
  text: string;
  ref?: StammdatenRef;
}

export interface Vorschlag {
  /** Was die Liste zeigt („S2 – Lage (Müller)“). */
  label: string;
  /** Was ins Feld kommt („S2“). */
  wert: string;
  ref?: StammdatenRef;
  /** Demo-Stammdaten (`ist_demo`, LFH-733): stehen hinten mit Demo-Marke. */
  demo?: boolean;
}

/** „In Stammdaten übernehmen“ für einen frei getippten Wert (design.md D4). */
export interface StammdatenUebernahme {
  /** Der Katalog, in dem angelegt wird („Externe Stellen“), für Rückmeldung und Namen. */
  ziel: string;
  /** Legt an und liefert den neuen Datensatz; lehnt bei Ablehnung ab. */
  anlegen: (text: string) => Promise<{ id: number }>;
  /** Warum es gesperrt ist (fehlendes Recht), sonst `null`. */
  gesperrt: string | null;
  /** Längste Bezeichnung, die der Katalog annimmt. */
  maxLaenge?: number;
}

export interface Vorschlagsquelle {
  /** Name des Adapters, zugleich `ref.quelle` seiner Einträge. */
  id: string;
  gruppe: VorschlagGruppe;
  eintraege: readonly Vorschlag[];
  uebernahme?: StammdatenUebernahme;
}

export interface VorschlagsGruppe {
  gruppe: VorschlagGruppe;
  titel: string;
  eintraege: Vorschlag[];
}

export interface Vorschlagsliste {
  gruppen: VorschlagsGruppe[];
  /** Demo-Einträge aller Gruppen, hinter allen echten (`stammdaten/demoAuswahl.tsx`). */
  demo: Vorschlag[];
}

function schluessel(text: string): string {
  return text.trim().toLocaleLowerCase('de');
}

/** Teilwort auf Wert oder Beschriftung, ohne Groß-/Kleinschreibung (wie `teilwortSuche`). */
function passt(v: Vorschlag, eingabe: string): boolean {
  if (!eingabe) return true;
  return schluessel(v.wert).includes(eingabe) || schluessel(v.label).includes(eingabe);
}

/**
 * Die Vorschläge zur Eingabe: je Gruppe in der festen Folge, darin die Folge der Quellen und
 * ihrer Einträge. Ein Wert steht nur einmal, in der ersten Gruppe, die ihn kennt. Leere Gruppen
 * fallen weg, Demo-Einträge sammeln sich dahinter.
 */
export function baueVorschlagsliste(
  quellen: readonly Vorschlagsquelle[],
  eingabe: string,
): Vorschlagsliste {
  const filter = schluessel(eingabe);
  const gesehen = new Set<string>();
  const gruppen: VorschlagsGruppe[] = [];
  const demo: Vorschlag[] = [];
  for (const gruppe of GRUPPEN_FOLGE) {
    const eintraege: Vorschlag[] = [];
    for (const quelle of quellen) {
      if (quelle.gruppe !== gruppe) continue;
      for (const v of quelle.eintraege) {
        const k = schluessel(v.wert);
        if (!k || gesehen.has(k)) continue;
        gesehen.add(k);
        if (!passt(v, filter)) continue;
        (v.demo ? demo : eintraege).push(v);
      }
    }
    if (eintraege.length > 0) gruppen.push({ gruppe, titel: GRUPPEN_TITEL[gruppe], eintraege });
  }
  return { gruppen, demo };
}

/** Woher ein Wert kommt; „Zuletzt verwendet“ ist keine Quelle, nur ein Gedächtnis. */
export type Herkunft = 'einsatz' | 'stammdaten' | 'frei';

/** Die Marke als Wort (zweiter Kanal, WCAG 1.4.1). */
export const HERKUNFT_WORT: Record<Herkunft, string> = {
  einsatz: 'Im Einsatz',
  stammdaten: 'Stammdaten',
  frei: 'frei',
};

/** Erster Vorschlag aus Einsatz oder Stammdaten mit genau diesem Text. */
export function exakterTreffer(
  text: string,
  quellen: readonly Vorschlagsquelle[],
): (Vorschlag & { gruppe: Exclude<VorschlagGruppe, 'zuletzt'> }) | undefined {
  const k = schluessel(text);
  if (!k) return undefined;
  for (const gruppe of QUELLEN_GRUPPEN) {
    for (const quelle of quellen) {
      if (quelle.gruppe !== gruppe) continue;
      const v = quelle.eintraege.find((e) => schluessel(e.wert) === k);
      if (v) return { ...v, gruppe };
    }
  }
  return undefined;
}

/**
 * Herkunft des Werts für die Marke: mit Referenz die Gruppe ihrer Quelle, sonst die Gruppe eines
 * exakten Treffers (Modus `nurText`, design.md D1), sonst „frei“. Leer: keine Marke.
 */
export function herkunftDesWerts(
  wert: StammdatenWert,
  quellen: readonly Vorschlagsquelle[],
): Herkunft | null {
  if (!wert.text.trim()) return null;
  if (wert.ref) {
    const quelle = quellen.find((q) => q.id === wert.ref?.quelle);
    if (quelle && quelle.gruppe !== 'zuletzt') return quelle.gruppe;
  }
  return exakterTreffer(wert.text, quellen)?.gruppe ?? 'frei';
}
