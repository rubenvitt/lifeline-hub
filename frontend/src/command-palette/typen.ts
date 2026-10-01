import type { Ikone } from '../ikonen';
import type {
  BenutzerAnzeige,
  EinsatzAnzeige,
  ModulOverrides,
  Koordinatenformat,
} from '../api/types';
import type { ThemeModus } from '../theme/ThemeModeProvider';
import type { Dichte } from '../theme/tokens';
import type { Helligkeit } from '../theme/helligkeit';
// Nur-Typ-Import, deshalb kein Laufzeit-Zyklus, obwohl `datensaetze.ts` von hier zurück
// importiert. Die Quellenmenge einer Abfrage ist dort zuhause, wo die Listen beschrieben sind.
import type { DatensatzQuellen } from './datensaetze';

/**
 * Die Aktionen, die eine Maske oder Seite an die Palette meldet.
 *
 * Nur `speichern`/`verwerfen`/`filter-zuruecksetzen` haben einen Tastenweg
 * (`tastaturAktionFuerEreignis`); `neue-zeile`, `spalten` und `status-setzen` sind nur über die
 * Palette erreichbar, ein weiteres globales Kürzel wäre eine neue Kollisionsfläche mit Browser und
 * antd. `status-setzen` wirkt auf die Fokuszeile (LFH-507) und meldet sich deshalb mit
 * `nurMitFokus` an (`useTastaturEbene`).
 *
 * Wer die Union erweitert, trägt in `befehle.ts` BEIDES nach: den Eintrag im exhaustiven
 * `TASTATUR_AKTIONEN` (Typcheck) und die Position in `TASTATUR_AKTION_REIHENFOLGE` (Guard in
 * `befehle.test.ts`).
 */
export type TastaturAktionId =
  'speichern' | 'verwerfen' | 'filter-zuruecksetzen' | 'neue-zeile' | 'spalten' | 'status-setzen';

export type TastaturAktionen = Partial<Record<TastaturAktionId, () => void>>;

/** Die Gruppen der Palette, ABGELEITET aus `GRUPPEN_REIHENFOLGE` (Vertrag dort). */
export type BefehlGruppe = (typeof GRUPPEN_REIHENFOLGE)[number];

export interface Befehl {
  id: string;
  gruppe: BefehlGruppe;
  label: string;
  schlagworte?: string[];
  icon?: Ikone;
  /**
   * Kontext rechts neben dem Label: wo der Treffer wohnt (Kategorie eines Moduls, Modul eines
   * Datensatzes).
   *
   * DARSTELLUNG, KEIN NAME: die Zeile nennt ihn als Beschreibung (`aria-describedby`), nicht im
   * zugänglichen Namen, an dem Tests und Gedächtnis hängen. Wer über den Kontext SUCHEN können
   * soll, trägt ihn zusätzlich in `schlagworte`.
   */
  kontext?: string;
  kuerzel?: string;
  /**
   * Dieser eine Befehl geht NICHT ins Gedächtnis, obwohl seine Gruppe merkbar ist.
   *
   * Die zweite Achse neben {@link GRUPPE_MERKBAR} kann ausschließlich ABZIEHEN, deshalb `true`
   * statt `boolean`: sonst lüde sie zum Hinzufügen ein, und eine neue Gruppe bräche nicht mehr den
   * exhaustiven Record.
   *
   * Heute trägt es genau `nav:abmelden`. Wer eine zweite Zeile setzt, begründet sie ebenso: das
   * Gedächtnis steht ZUOBERST und ist vorausgewählt, `Strg/⌘+K` + Enter löst es aus.
   */
  nichtMerkbar?: true;
  /**
   * Das Navigationsziel der Zeile: die MARKE, an der die Palette entscheidet, ob Strg/⌘+↵ greift.
   * Fehlt es, bleibt die Taste wirkungslos und fällt NICHT auf ↵ zurück.
   *
   * Angabe, nicht Weg: navigiert wird in `ausfuehren`, wo die Nebenwirkungen (Modulbesuch,
   * Gedächtnis) hängen. Wer `ziel` setzt, reicht `oeffnung` bis zu `navigate` durch; das prüft der
   * Guard in `befehle.test.ts` für jede Zeile.
   */
  ziel?: string;
  /** Lese-Vorschau in der Palette (Taste →). Siehe {@link VorschauZiel}. */
  vorschau?: VorschauZiel;
  /**
   * `oeffnung` erreicht nur Zeilen mit {@link Befehl.ziel}; Befehle ohne Ziel ignorieren das
   * Argument.
   */
  ausfuehren: (oeffnung?: Oeffnung) => void;
}

/**
 * Wie eine Zeile mit Ziel geöffnet wird: im aktuellen Tab (↵) oder in einem neuen Browser-Tab
 * (Strg/⌘+↵). Ein Argument an `ausfuehren` statt eines zweiten Callbacks, sonst stünde jede
 * Nebenwirkung doppelt.
 */
export type Oeffnung = 'hier' | 'neuerTab';

/**
 * Was die Vorschau zeigt. Eine DISKRIMINIERTE Union als Datum: `Vorschau.tsx` bildet `art`
 * exhaustiv ab, eine neue Sorte bricht dort den Typcheck.
 *
 * Das Ziel trägt nur Kennungen, nie den Datensatz: das Bauteil liest ihn aus dem Fach der
 * Trefferliste (`datensatzAbfrage.ts`) und bleibt live. Der ETB trägt zusätzlich `lfdNr`, weil
 * kein Fach einen Eintrag über seine `id` adressiert; gelesen wird über den Nummerncursor, danach
 * wird die `id` geprüft.
 */
export type VorschauZiel =
  | { art: VorschauArt; einsatzId: number; id: number }
  | { art: 'etb'; einsatzId: number; id: number; lfdNr: number };

/** Die Sorten, deren Ziel allein aus `einsatzId` und `id` besteht. */
export type VorschauArt =
  | 'person'
  | 'schaden'
  | 'uhs'
  | 'meldung'
  | 'auftrag'
  | 'fahrzeug'
  | 'personal'
  | 'einheit'
  | 'lagebericht'
  | 'gefahrengebiet'
  | 'abschnitt';

/**
 * Ziel und Weg einer Navigationszeile aus EINER Hand, für alle Bauorte (`befehle.ts`,
 * `datensaetze.ts`, `koordinatenSprung.ts`): `ziel` (Marke für Strg/⌘+↵) und der Pfad in
 * `navigate` können nicht auseinanderlaufen, und die Öffnungsart geht immer durch.
 *
 * 'hier' wird nicht mitgeschickt (Ein-Argument-Form von `navigate`). `vorher` trägt die
 * Nebenwirkung, die für beide Öffnungsarten gilt (Modulbesuch).
 */
export function sprungZu(
  ziel: string,
  navigate: (pfad: string, oeffnung?: Oeffnung) => void,
  vorher?: () => void,
): Pick<Befehl, 'ziel' | 'ausfuehren'> {
  return {
    ziel,
    ausfuehren: (oeffnung) => {
      vorher?.();
      if (oeffnung === 'neuerTab') navigate(ziel, oeffnung);
      else navigate(ziel);
    },
  };
}

export interface BefehlKontext {
  einsatzId: number | null;
  benutzer: BenutzerAnzeige | null;
  einsaetze: EinsatzAnzeige[];
  overrides?: ModulOverrides;
  darfSchreibenImEinsatz: boolean;
  /** Zuletzt besuchte Modulschlüssel des aktuellen Einsatzes, jüngstes zuerst
   *  (`einsatz/zuletztModule.ts`). */
  zuletztModulKeys?: string[];
  /**
   * Das Modul, auf dessen Seite die Palette geöffnet wurde (aus der Route über `modulAusPfad`).
   * Konsument ist nur die Zuletzt-Gruppe: die Seite, auf der man steht, ist keine Abkürzung. Die
   * Modul-Gruppe behält den Eintrag, sie zeigt den Modulbestand. Optional wie
   * `zuletztModulKeys`; in `DatensatzKontext` ist der gleichnamige Schlüssel Pflicht.
   */
  aktuellerModulKey?: string | null;
  /**
   * Aufzeichnung einer BEWUSSTEN Modulwahl. Als Callback injiziert, damit `baueBefehle` rein
   * bleibt (kein `localStorage`, keine `einsatzId`-Bindung).
   */
  merkeModulBesuch?: (modulKey: string) => void;
  /**
   * Zuletzt AUSGEFÜHRTE Befehls-IDs, jüngstes zuerst.
   *
   * IDs, keine Beschriftungen oder Ziele: aufgelöst wird gegen die Liste derselben Runde. Ein
   * gelöschter Datensatz oder ein entzogenes Recht löst damit nicht auf, und die Beschriftung ist
   * immer frisch. Die Herkunft (`useZuletztBefehle`) kennt `baueBefehle` nicht.
   */
  zuletztBefehlIds?: string[];
  /**
   * Aufzeichnung einer ausgeführten Bedienung, als Callback injiziert wie `merkeModulBesuch`.
   * WELCHE Befehle melden, entscheidet {@link GRUPPE_MERKBAR}, nicht der Aufrufer.
   */
  merkeBefehl?: (id: string) => void;
  /** `oeffnung` fehlt = im aktuellen Tab. */
  navigate: (pfad: string, oeffnung?: Oeffnung) => void;
  setThemeModus: (m: ThemeModus) => void;
  setDichte: (d: Dichte) => void;
  /** Setzt die gewählte Helligkeit (LFH-397); die Warnsperre gilt im Provider. */
  setHelligkeit: (h: Helligkeit) => void;
  setKoordinaten: (f: Koordinatenformat) => void;
  logout: () => void;
  tastaturAktionen?: TastaturAktionen;
  userAgent?: string;
}

/**
 * Reihenfolge der Startansicht: das Nützlichste zuerst (Gedächtnis, Aktionen, Schnellaktionen,
 * Zuletzt vor den Modulen).
 *
 * ZWEI VERTRÄGE:
 *
 * 1. **Die Reihenfolge IST die Union.** `BefehlGruppe` wird aus diesem `as const`-Tupel
 *    abgeleitet; eine Gruppe kann nicht existieren, ohne hier zu stehen. `CommandPalette.tsx`
 *    iteriert ausschließlich über dieses Array, eine fehlende Gruppe renderte sonst still gar
 *    nicht.
 * 2. **Kein Eintrag steht zweimal.** Das sieht der Typ nicht; eine Dublette renderte die Gruppe
 *    doppelt und machte `aria-activedescendant` mehrdeutig. Dafür `typen.test.ts`.
 */
export const GRUPPEN_REIHENFOLGE = [
  'ausgefuehrt',
  'aktionen',
  'koordinate',
  'datensaetze',
  'schnellaktionen',
  'zuletzt',
  'module',
  'einsaetze',
  'einstellungen',
  'navigation',
  'ortssuche',
] as const;

export const GRUPPEN_LABEL: Record<BefehlGruppe, string> = {
  /**
   * Das Gedächtnis zuletzt ausgeführter Befehle steht ZUOBERST, über `aktionen`: die
   * Kontextaktionen einer Maske sind stets vollständig sichtbar (höchstens fünf), das Gedächtnis
   * ist der einzige kurze Weg zu einem häufigen Befehl aus 42+. `ZULETZT_BEFEHLE_MAX` begrenzt,
   * wie weit `aktionen` nach unten rückt.
   */
  ausgefuehrt: 'Zuletzt ausgeführt',
  aktionen: 'Aktionen',
  /**
   * Der Koordinatensprung (`koordinatenSprung.ts`): höchstens EINE Zeile, nur solange die Eingabe
   * die Form einer Koordinate hat; nie in der leeren Startansicht.
   */
  koordinate: 'Koordinate',
  /**
   * Gefundene Datensätze aus den Modullisten, EINE Gruppe für alle Entitäten (die Herkunft steht
   * im Kontext). Der Slot ist Formalie: Treffer entstehen erst ab zwei Zeichen, also nie in der
   * Startansicht; die Rangfolge macht `ordneTreffer`. Nötig ist der Eintrag, weil `BefehlGruppe`
   * aus diesem Tupel abgeleitet wird.
   */
  datensaetze: 'Datensätze',
  schnellaktionen: 'Schnellaktionen',
  zuletzt: 'Zuletzt',
  module: 'Module',
  einsaetze: 'Einsatz wechseln',
  einstellungen: 'Einstellungen',
  navigation: 'Navigation',
  /**
   * Die Adresszeile (`adressSprung.ts`, LFH-638): höchstens EINE Zeile, nur bei aktiver Suche und
   * immer am Ende (Gruppe zuletzt, Score hinter jedem Treffer) — nie vorausgewählt.
   */
  ortssuche: 'Adresse',
};

/**
 * Darf ein ausgeführter Befehl dieser Gruppe ins Gedächtnis?
 *
 * Exhaustiver Record wie {@link PALETTE_MODI}: eine neue Gruppe bricht den Typcheck. Eine
 * Denylist täte das nicht, und ein falsch Gemerkter stünde dauerhaft ganz oben.
 *
 * `false` und warum:
 *  - `module`/`zuletzt`: Dublettenriegel an der Schreibseite; dasselbe Modul steht schon zweimal
 *    in der Liste, das Modul-Gedächtnis trägt diese Einträge.
 *  - `datensaetze`: ein Datensatz-Befehl entsteht nur während einer Suche, im Startzustand wäre
 *    das Gedächtnis blind.
 *  - `aktionen`: die ID benennt einen SLOT (`tastatur:speichern` bedeutet je Maske etwas
 *    anderes); gegen eine fremde Maske aufgelöst schriebe „Speichern“ etwas anderes.
 *  - `koordinate`/`ortssuche`: eine getippte Stelle ist kein wiederkehrender Befehl.
 *  - `ausgefuehrt`: die Kopie trägt die Meldung des ORIGINALS schon in `ausfuehren`.
 *
 * `navigation` ist `true` (wiederholte Sprünge), ausgenommen Abmelden über
 * {@link Befehl.nichtMerkbar}: die oberste Zeile ist vorausgewählt, `Strg/⌘+K` + Enter meldete
 * sonst ab. Die Achse am Befehl zieht nur ab.
 */
export const GRUPPE_MERKBAR: Record<BefehlGruppe, boolean> = {
  ausgefuehrt: false,
  aktionen: false,
  // Eine getippte Stelle ist kein wiederkehrender Befehl.
  koordinate: false,
  datensaetze: false,
  schnellaktionen: true,
  zuletzt: false,
  module: false,
  einsaetze: true,
  einstellungen: true,
  navigation: true,
  // Ein getippter Suchtext ist kein wiederkehrender Befehl.
  ortssuche: false,
};

/**
 * Ist die Gruppe eine reine ORDNUNGSKOPIE, die bei aktiver Suche entfällt? Ausdrücklich NICHT
 * die Negation von {@link GRUPPE_MERKBAR} (`module` ist nicht merkbar und bleibt stehen). Gemeint
 * ist: jeder Eintrag hat anderswo in derselben Liste einen Zwilling mit gleichem Label, Ikone und
 * Ziel. Begründung an `ohneOrdnungsdubletten` in `fuzzy.ts`.
 */
export const GRUPPE_NUR_ORDNUNG: Record<BefehlGruppe, boolean> = {
  ausgefuehrt: true,
  aktionen: false,
  koordinate: false,
  datensaetze: false,
  schnellaktionen: false,
  zuletzt: true,
  module: false,
  einsaetze: false,
  einstellungen: false,
  navigation: false,
  ortssuche: false,
};

/**
 * Präfix-Modi der Sucheingabe; `alles` ist der Vorgabemodus ohne Präfix.
 *
 * Die Präfixe (`>`, `#`, `@`) kürzen nur, ohne sie wird nichts unerreichbar (der Vorgabemodus
 * durchsucht alle Quellen). Bewusst KEIN Wortalias: ein getipptes „etb“ ist ein Suchbegriff, es
 * zugleich als Moduswechsel zu lesen machte die Eingabe mehrdeutig.
 */
export type PaletteModus = 'alles' | 'aktionen' | 'etb' | 'kraefte';

/**
 * Ein Abfrageweg des Datensatz-Finders, abgeleitet aus {@link DatensatzQuellen}, damit ein neues
 * Feld dort hier nicht vergessen werden kann.
 */
export type DatensatzQuelle = keyof DatensatzQuellen;

interface ModusBeschreibung {
  /** Zeichen am Anfang der Eingabe; `null` für den Vorgabemodus, der ohne Präfix gilt. */
  praefix: string | null;
  /** Gruppen, auf die eingeschränkt wird; `null` = keine Einschränkung. */
  gruppen: readonly BefehlGruppe[] | null;
  /**
   * Datenquellen, die dieser Modus durchsucht; `null` = keine Einschränkung, `[]` = gar keine.
   * Gelesen von beiden Hälften des Finders: `useDatensaetze` (`enabled`) und
   * `baueDatensatzTreffer` (Quellenfilter).
   */
  quellen: readonly DatensatzQuelle[] | null;
  /** Wortlaut der Modusanzeige, solange der Modus aktiv ist. */
  hinweis: string | null;
  /** Wortlaut in der Legende bei leerem Feld, hinter der Präfix-Marke. */
  legende: string | null;
}

/**
 * EIN exhaustiver Record für ALLE Angaben eines Modus (Präfix, Gruppen, Quellen, Wortlaut):
 * getrennte Tabellen wären getrennte Orte, an denen ein neuer Modus vergessen werden kann.
 *
 * `gruppen` ist für die Datensatz-Modi `[]`, nicht `null` (das zeigte alle Module). Die
 * Datensatz-Treffer laufen nicht durch diesen Filter, sie kommen als eigene Prop in die Palette.
 */
export const PALETTE_MODI: Record<PaletteModus, ModusBeschreibung> = {
  alles: { praefix: null, gruppen: null, quellen: null, hinweis: null, legende: null },
  aktionen: {
    praefix: '>',
    gruppen: ['aktionen', 'schnellaktionen'],
    quellen: [],
    hinweis: 'Nur Aktionen',
    legende: 'zeigt nur Aktionen',
  },
  /**
   * '#' steht im ETB ohnehin vor der laufenden Nummer: wer '#42' tippt, meint den Eintrag 42.
   */
  etb: {
    praefix: '#',
    gruppen: [],
    quellen: ['etbNummer', 'etbText', 'etbAnzahl'],
    hinweis: 'Nur Einsatztagebuch',
    legende: 'sucht im Einsatztagebuch',
  },
  /**
   * '@' beantwortet „WER?“: Kräfte (Fahrzeug, Personal, Einheit) und betroffene Personen. Alle vier
   * tragen einen NAMEN als Suchmerkmal, die übrigen Quellen einen Sachverhalt. Die Personen sind
   * bewusst drin: im MANV ist ihre Liste die längste.
   */
  kraefte: {
    praefix: '@',
    gruppen: [],
    quellen: ['personen', 'fahrzeuge', 'personal', 'einheiten'],
    hinweis: 'Nur Personen und Kräfte',
    legende: 'sucht Personen und Kräfte',
  },
};

/**
 * Mindestlänge des Restes, bevor der Datensatz-Finder etwas holt. Nach unten begrenzt durch die
 * kürzeste gedruckte Kennung (zweistellig), nach oben durch die Selektivität (ein Zeichen trifft
 * in einer MANV-Personenliste alles).
 *
 * HIER statt in `useDatensaetze.ts`, weil die Palette die Zahl selbst braucht: bei einem Zeichen
 * ist die Liste leer, und ein stummes „Keine Treffer“ wäre von „kaputt“ nicht zu unterscheiden.
 */
export const DATENSATZ_MINDESTZEICHEN = 2;

/** Durchsucht dieser Modus überhaupt Datensätze? `null` heisst „alle Quellen". */
export function modusZeigtDatensaetze(modus: PaletteModus): boolean {
  const quellen = PALETTE_MODI[modus].quellen;
  return quellen === null || quellen.length > 0;
}

/**
 * Quelle → Modulschlüssel der LESEACHSE (`istModulFreigegeben`).
 *
 * 'Kräfte' zerfällt in `fahrzeuge`, `personal` und `einheiten` (drei Registry-Einträge mit eigener
 * Schranke); die drei ETB-Zweige (Nummer, Volltext, Zählung) teilen einen Schlüssel.
 *
 * HIER, weil auch der reine Kern sie braucht und `useDatensaetze.ts` (react-query, API-Clients)
 * nicht importieren darf. Zwei Kopien liefen still auseinander.
 */
export const QUELLE_MODUL = {
  personen: 'personen',
  schaeden: 'schaeden',
  uhs: 'unfallhilfsstellen',
  meldungen: 'meldungen',
  auftraege: 'auftraege',
  fahrzeuge: 'fahrzeuge',
  personal: 'personal',
  einheiten: 'einheiten',
  etbNummer: 'etb',
  etbText: 'etb',
  etbAnzahl: 'etb',
  // `gefahrenzonen` ist der Registry-Schlüssel des Moduls „Gefahren“.
  lageberichte: 'lageberichte',
  gefahrengebiete: 'gefahrenzonen',
  abschnitte: 'einsatzabschnitte',
} as const satisfies Record<DatensatzQuelle, string>;
