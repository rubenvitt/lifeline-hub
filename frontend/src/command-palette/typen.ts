// frontend/src/command-palette/typen.ts
import type { IconType } from 'react-icons';
import type { BenutzerAnzeige, EinsatzAnzeige, ModulOverrides, Koordinatenformat } from '../api/types';
import type { ThemeModus } from '../theme/ThemeModeProvider';
import type { Dichte } from '../theme/tokens';

/**
 * Die Aktionen, die eine Maske oder Seite an die Palette meldet (LFH-391 · B3).
 *
 * NICHT jede hat einen Tastenweg: `tastaturAktionFuerEreignis` bindet weiterhin nur
 * `speichern`/`verwerfen`/`filter-zuruecksetzen` — das sind die Mutations- und
 * Abbruchwege, die man mitten im Tippen braucht. `neue-zeile` und `spalten` sind
 * ausschliesslich über die Palette erreichbar; ein viertes globales Kürzel wäre eine
 * neue Kollisionsfläche mit Browser- und antd-Bindungen.
 *
 * Wer die Union erweitert, trägt in `befehle.ts` BEIDES nach: den Eintrag im
 * exhaustiven `TASTATUR_AKTIONEN` (das erzwingt der Typcheck, TS2741) und die Position
 * in `TASTATUR_AKTION_REIHENFOLGE` (das erzwingt der Guard in `befehle.test.ts` — ein
 * Record hat keine vertragliche Ordnung, die Palette-Gruppe aber schon).
 */
export type TastaturAktionId =
  | 'speichern' | 'verwerfen' | 'filter-zuruecksetzen' | 'neue-zeile' | 'spalten';

export type TastaturAktionen = Partial<Record<TastaturAktionId, () => void>>;

/**
 * Die Gruppen der Palette — ABGELEITET aus `GRUPPEN_REIHENFOLGE` (LFH-391 · A2),
 * nicht daneben deklariert. Siehe den Vertrag am Array weiter unten.
 */
export type BefehlGruppe = (typeof GRUPPEN_REIHENFOLGE)[number];

export interface Befehl {
  id: string;
  gruppe: BefehlGruppe;
  label: string;
  schlagworte?: string[];
  icon?: IconType;
  kuerzel?: string;
  ausfuehren: () => void;
}

export interface BefehlKontext {
  einsatzId: number | null;
  benutzer: BenutzerAnzeige | null;
  einsaetze: EinsatzAnzeige[];
  overrides?: ModulOverrides;
  darfSchreibenImEinsatz: boolean;
  /** Zuletzt besuchte Modulschlüssel des aktuellen Einsatzes (LFH-337 · H12),
   *  jüngstes zuerst. Kommt aus `einsatz/zuletztModule.ts`. */
  zuletztModulKeys?: string[];
  /**
   * Aufzeichnung einer BEWUSSTEN Modulwahl (LFH-337 · Fix-Welle, Befund B4). Als Callback
   * injiziert, damit `baueBefehle` rein bleibt: die Funktion kennt weder `localStorage`
   * noch die `einsatzId`-Bindung, sie ruft nur, was ihr `useBefehle` gibt.
   */
  merkeModulBesuch?: (modulKey: string) => void;
  navigate: (pfad: string) => void;
  setThemeModus: (m: ThemeModus) => void;
  setDichte: (d: Dichte) => void;
  setKoordinaten: (f: Koordinatenformat) => void;
  logout: () => void;
  tastaturAktionen?: TastaturAktionen;
  userAgent?: string;
}

/**
 * Reihenfolge der Startansicht (LFH-337 · M11): das Nützlichste zuerst.
 *
 * `schnellaktionen` und `zuletzt` stehen jetzt VOR `module` — vorher lagen die vier
 * Schnellaktionen hinter 24 Modulen und waren bei leerer Suche faktisch unerreichbar.
 * `aktionen` (die kontextabhängigen Tastatur-Aktionen aus `TASTATUR_AKTIONEN`) bleibt
 * unangetastet an der Spitze: sie erscheint nur dort, wo eine Maske sie registriert hat,
 * und ist dann die Antwort auf „was kann ich hier gerade tun".
 *
 * ZWEI VERTRÄGE an dieser Liste (LFH-391 · A2):
 *
 * 1. **Die Reihenfolge IST die Union.** `BefehlGruppe` wird aus diesem `as const`-Tupel
 *    abgeleitet — eine Gruppe kann also nicht mehr existieren, ohne hier zu stehen.
 *    Vorher waren es zwei unabhängige Deklarationen, und `GRUPPEN_LABEL` (ein Record
 *    über die Union) brach den Typcheck bei einer fehlenden Gruppe, dieses Array NICHT:
 *    eine Gruppe in Union und Label, aber nicht in der Reihenfolge, renderte gar nicht —
 *    `CommandPalette.tsx` iteriert ausschliesslich über dieses Array. Kein Typfehler,
 *    kein roter Test, kein Fehlerbild. Die Mutationsprobe ist ein gestrichener Eintrag:
 *    dann bricht `tsc` — gemessen an 'zuletzt' TS2353 an `GRUPPEN_LABEL`, TS2322 am
 *    `gruppe:`-Literal in `befehle.ts` und TS2345/TS2367 in `befehle.test.ts`.
 * 2. **Kein Eintrag steht zweimal.** Das sieht der Typ NICHT — eine Dublette lässt die
 *    Union unverändert, rendert die Gruppe aber doppelt und macht `aria-activedescendant`
 *    über doppelte `cmd-<id>` mehrdeutig. Dafür `typen.test.ts`.
 */
export const GRUPPEN_REIHENFOLGE = [
  'aktionen', 'schnellaktionen', 'zuletzt', 'module', 'einsaetze', 'einstellungen', 'navigation',
] as const;

export const GRUPPEN_LABEL: Record<BefehlGruppe, string> = {
  aktionen: 'Aktionen',
  schnellaktionen: 'Schnellaktionen',
  zuletzt: 'Zuletzt',
  module: 'Module',
  einsaetze: 'Einsatz wechseln',
  einstellungen: 'Einstellungen',
  navigation: 'Navigation',
};

/**
 * Präfix-Modi der Sucheingabe (LFH-391 · A4). `alles` ist der Vorgabemodus ohne Präfix.
 *
 * `>` ist ein reiner TEILMENGEN-Filter: er zeigt `aktionen` + `schnellaktionen`, also genau
 * die zwei Gruppen, die seit LFH-337 · M11 ohnehin an der Spitze der Startansicht stehen.
 * Ohne das Zeichen wird damit nichts unerreichbar — das Präfix ist Abkürzung, kein Zugang.
 * Deshalb bewusst KEIN Wortalias („aktionen"), obwohl `>` auf deutscher Tastatur Shift+`<`
 * ist und die Palette laut CLAUDE.md auch der Berührungs-/Handschuhweg zu 42+ Befehlen
 * ist: ein zweiter Syntaxweg für eine Bequemlichkeit wäre eine zweite Wahrheit, und wer
 * „aktionen" tippt, will meistens danach SUCHEN. Für die Datensatz-Modi der Etappe C ist
 * die Lage anders (dort sind die Ziele ohne Präfix nicht erreichbar) — die Frage wird dort
 * neu gestellt.
 */
export type PaletteModus = 'alles' | 'aktionen';

export interface ModusBeschreibung {
  /** Zeichen am Anfang der Eingabe; `null` für den Vorgabemodus, der ohne Präfix gilt. */
  praefix: string | null;
  /** Gruppen, auf die eingeschränkt wird; `null` = keine Einschränkung. */
  gruppen: readonly BefehlGruppe[] | null;
  /** Wortlaut der Modusanzeige, solange der Modus aktiv ist. */
  hinweis: string | null;
  /** Wortlaut in der Legende bei leerem Feld, hinter der Präfix-Marke. */
  legende: string | null;
}

/**
 * EIN exhaustiver Record für alle drei Angaben eines Modus — Präfixzeichen, Gruppen und
 * Wortlaut gehören zusammen. Drei getrennte Tabellen wären drei Orte, an denen ein neuer
 * Modus vergessen werden kann; hier erzwingt der Typcheck (TS2741) alles auf einmal.
 *
 * ETAPPE C ERGÄNZT HIER '#' und '@' — und bricht dabei absichtlich den Typcheck, sobald
 * `PaletteModus` die zwei Varianten bekommt (gemessen an einer dritten Variante: TS2741
 * „Property 'etb' is missing … but required in type 'Record<PaletteModus,
 * ModusBeschreibung>'"). Das ist die eingebaute Erinnerung, dass ein Modus ohne
 * Präfixzeichen unerreichbar und einer ohne Wortlaut unsichtbar wäre.
 * `gruppen` ist für die Datensatz-Modi dann `[]` (keine statischen Befehle), nicht `null` —
 * `null` zeigte weiterhin alle Module.
 */
export const PALETTE_MODI: Record<PaletteModus, ModusBeschreibung> = {
  alles: { praefix: null, gruppen: null, hinweis: null, legende: null },
  aktionen: {
    praefix: '>',
    gruppen: ['aktionen', 'schnellaktionen'],
    hinweis: 'Nur Aktionen',
    legende: 'zeigt nur Aktionen',
  },
};
