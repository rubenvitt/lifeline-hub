// frontend/src/command-palette/typen.ts
import type { IconType } from 'react-icons';
import type {
  BenutzerAnzeige,
  EinsatzAnzeige,
  ModulOverrides,
  Koordinatenformat,
} from '../api/types';
import type { ThemeModus } from '../theme/ThemeModeProvider';
import type { Dichte } from '../theme/tokens';
// NUR-TYP-IMPORT, und nur deshalb unbedenklich: `datensaetze.ts` importiert von hier
// zurück (`Befehl`). Ein `import type` wird beim Übersetzen restlos entfernt — es entsteht
// kein Modulzyklus zur Laufzeit. Die Ableitung geht bewusst in DIESE Richtung: die
// Quellenmenge einer Abfrage ist dort zuhause, wo die Listen beschrieben sind.
import type { DatensatzQuellen } from './datensaetze';

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
  'speichern' | 'verwerfen' | 'filter-zuruecksetzen' | 'neue-zeile' | 'spalten';

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
  /**
   * Dieser eine Befehl geht NICHT ins Gedächtnis, obwohl seine Gruppe merkbar ist
   * (Review-Befund zu LFH-391 · Etappe D).
   *
   * DIE ZWEITE ACHSE NEBEN {@link GRUPPE_MERKBAR}, und sie kann ausschliesslich ABZIEHEN:
   * der Typ ist `true` und nicht `boolean`. Ein `nichtMerkbar: false` läse sich als
   * „ausdrücklich merkbar" und lüde dazu ein, die Achse auch zum Hinzufügen zu benutzen —
   * damit wäre die Eigenschaft weg, für die der exhaustive Record existiert: eine NEUE
   * Gruppe muss den Typcheck brechen (TS2741), statt still mitzulaufen. So bleibt „merkbar"
   * die Konjunktion aus Gruppenurteil und Einzel-Opt-out; ohne Gruppenurteil hilft das
   * Weglassen des Flags nichts.
   *
   * Heute trägt es genau `nav:abmelden` (Begründung dort). Wer eine zweite Zeile setzt,
   * begründet sie ebenso: das Gedächtnis steht ZUOBERST und ist vorausgewählt, `Strg/⌘+K`
   * gefolgt von Enter löst also aus, was hier drinsteht.
   */
  nichtMerkbar?: true;
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
   * Das Modul, auf dessen Seite die Palette geöffnet wurde — aus der AKTUELLEN ROUTE über
   * `modulAusPfad` (`einsatz/modulRegistry.ts`), Arbeitspunkt 3 des Tickets (LFH-391 · C4).
   *
   * Konsument ist die Zuletzt-Gruppe: die Seite, auf der man steht, ist keine Abkürzung.
   * Damit gilt hier dieselbe Regel wie im Navigationsrahmen (`loeseZuletztModule`), der sie
   * seit LFH-337 · H12 fährt — die Palette führte als einzige Fläche einen Sprung auf die
   * eigene Seite, und zwar auf dem knappsten der drei Plätze.
   *
   * OPTIONAL wie sein Geschwister `zuletztModulKeys`, und aus demselben Grund: ohne
   * gemerkte Module hat er gar keine Bedeutung. (In `DatensatzKontext` ist der gleichnamige
   * Schlüssel dagegen PFLICHT — dort ordnet er die ganze Trefferliste.)
   *
   * KEIN Konsument in den übrigen sechs Gruppen, und das ist Absicht: die Modul-Gruppe
   * behält den Eintrag der aktuellen Seite, weil sie den MODULBESTAND zeigt und nicht eine
   * Abkürzung — dieselbe Trennung wie zwischen „Zuletzt" und Modul-Panel im Rahmen.
   */
  aktuellerModulKey?: string | null;
  /**
   * Aufzeichnung einer BEWUSSTEN Modulwahl (LFH-337 · Fix-Welle, Befund B4). Als Callback
   * injiziert, damit `baueBefehle` rein bleibt: die Funktion kennt weder `localStorage`
   * noch die `einsatzId`-Bindung, sie ruft nur, was ihr `useBefehle` gibt.
   */
  merkeModulBesuch?: (modulKey: string) => void;
  /**
   * Zuletzt AUSGEFÜHRTE Befehls-IDs, jüngstes zuerst (LFH-391 · Etappe D).
   *
   * IDs, keine Beschriftungen und keine Ziele. Aufgelöst wird gegen die Liste, die in
   * derselben Runde gebaut wird — womit drei Dinge auf einmal gelten: ein Verweis auf einen
   * gelöschten Datensatz löst nicht auf, ein entzogenes Modul oder Recht löst nicht auf (der
   * Rechtefilter ist gratis, ohne eine zweite Wahrheit über Berechtigungen), und die
   * Beschriftung ist immer frisch.
   *
   * OPTIONAL wie `zuletztModulKeys`, und aus demselben Grund: ohne gemerkte Befehle hat der
   * Schlüssel keine Bedeutung. Die Herkunft (Server-Slot am Benutzer, `useZuletztBefehle`)
   * kennt `baueBefehle` nicht — sie bekommt eine Liste.
   */
  zuletztBefehlIds?: string[];
  /**
   * Aufzeichnung einer ausgeführten Bedienung. Als Callback injiziert, damit `baueBefehle`
   * rein bleibt — dieselbe Bauform wie `merkeModulBesuch`: die Funktion kennt weder Netz
   * noch Speicher, sie ruft nur, was ihr `useBefehle` gibt.
   *
   * WELCHE Befehle melden, entscheidet {@link GRUPPE_MERKBAR}, nicht der Aufrufer.
   */
  merkeBefehl?: (id: string) => void;
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
 * `aktionen` (die kontextabhängigen Tastatur-Aktionen aus `TASTATUR_AKTIONEN`) stand bis
 * Etappe D an der Spitze; davor liegt jetzt allein das Befehls-Gedächtnis `ausgefuehrt`
 * (Begründung an seinem Eintrag in `GRUPPEN_LABEL`).
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
  'ausgefuehrt',
  'aktionen',
  'datensaetze',
  'schnellaktionen',
  'zuletzt',
  'module',
  'einsaetze',
  'einstellungen',
  'navigation',
] as const;

export const GRUPPEN_LABEL: Record<BefehlGruppe, string> = {
  /**
   * Das Gedächtnis zuletzt ausgeführter Befehle (LFH-391 · Etappe D). Es steht ZUOBERST und
   * damit über `aktionen` — eine bewusste Umkehrung der M11-Begründung, die `aktionen` „an
   * der Spitze" festhielt: die Kontextaktionen einer Maske sind stets vollständig sichtbar
   * (höchstens fünf, und sie erscheinen nur dort, wo eine Maske sie registriert hat), das
   * Gedächtnis dagegen ist der einzige Platz, an dem ein häufig benutzter Befehl aus 42+
   * einen kurzen Weg bekommt. Der Deckel `ZULETZT_BEFEHLE_MAX` (`zuletztBefehle.ts`)
   * begrenzt, wie weit `aktionen` dadurch nach unten rückt.
   */
  ausgefuehrt: 'Zuletzt ausgeführt',
  aktionen: 'Aktionen',
  /**
   * Gefundene Datensätze aus den Modullisten (LFH-391 · C1). EINE Gruppe für alle neun
   * Entitäten, die Modulherkunft steht im Label — neun Gruppen wären neun Überschriften
   * für im Schnitt ein bis zwei Zeilen, und bei AKTIVER Suche rendert die Palette seit A3
   * ohnehin flach.
   *
   * Der Slot ist FORMALIE, keine Ordnungsaussage: Datensatz-Treffer entstehen erst ab zwei
   * getippten Zeichen, also nie in der leeren Startansicht — dem einzigen Zustand, in dem
   * die Gruppenreihenfolge noch rendert. Die sichtbare Rangfolge macht `ordneTreffer`; der
   * Gruppenrang ist dort nur Tiebreak. Notwendig ist der Eintrag trotzdem, weil
   * `BefehlGruppe` aus diesem Tupel abgeleitet wird.
   */
  datensaetze: 'Datensätze',
  schnellaktionen: 'Schnellaktionen',
  zuletzt: 'Zuletzt',
  module: 'Module',
  einsaetze: 'Einsatz wechseln',
  einstellungen: 'Einstellungen',
  navigation: 'Navigation',
};

/**
 * Darf ein ausgeführter Befehl dieser Gruppe ins Gedächtnis (LFH-391 · Etappe D)?
 *
 * EIN exhaustiver Record über {@link BefehlGruppe}, Bauform wie {@link PALETTE_MODI}: eine
 * neue Gruppe bricht den Typcheck (TS2741), statt still mitzulaufen. Eine Denylist tut das
 * nicht — dort ist „nicht erwähnt" dasselbe wie „erlaubt", und die teure Richtung des
 * Fehlers ist genau die: ein Befehl, der ins Gedächtnis gerät, obwohl er nicht hineingehört,
 * steht dauerhaft und an oberster Stelle da.
 *
 * VIER Gruppen stehen aus VIER verschiedenen Gründen auf `false`:
 *
 *  - `module` und `zuletzt`: das IST der Dublettenriegel, und er sitzt an der SCHREIBseite
 *    statt als eigene Filterschleife. Dasselbe Modul steht bereits zweimal in der Liste
 *    (LFH-337 · H12, getrennt allein durch das id-Präfix) — ein drittes Vorkommen wäre eine
 *    dritte Kopie derselben Zeile, mit demselben Label und demselben Ziel. Das
 *    Modul-Gedächtnis trägt diese Einträge schon.
 *  - `datensaetze`: ein gemerkter Verweis auf einen konkreten Datensatz ist morgen eine tote
 *    Zeile. Er löste zwar sauber nicht auf (die Auflösung geht gegen die aktuelle Liste), aber
 *    ein Datensatz-Befehl entsteht überhaupt nur, solange dieselbe Suche läuft — im leeren
 *    Startzustand gibt es keine `datensaetze`, das Gedächtnis wäre also dauerhaft blind.
 *  - `aktionen`: die ID benennt einen SLOT, keinen Befehl. `tastatur:speichern` bedeutet auf
 *    der ETB-Seite etwas anderes als auf der Personen-Seite; gegen eine fremde Maske aufgelöst
 *    stünde „Speichern" da und schriebe etwas anderes. Dazu ist die Gruppe ohnehin die erste
 *    sichtbare der Startansicht — ein Gedächtniseintrag verdoppelte eine Zeile, die eine
 *    Zeile tiefer schon steht.
 *  - `ausgefuehrt` selbst: die Kopie merkt sich nicht sich selbst. Ihre `ausfuehren` trägt
 *    die Meldung des ORIGINALS bereits in sich (siehe `befehle.ts`) — ein Griff ins
 *    Gedächtnis rückt den Befehl also sehr wohl nach vorn, nur unter seiner echten ID.
 *
 * `navigation` steht auf `true`, weil „Stammdaten"/„Administration"/„Alle Einsätze" genau die
 * wiederholten Sprünge sind, für die das Gedächtnis gebaut ist. Der frühere Zusatz „also darf
 * auch Abmelden hinein" ist im Review widerlegt worden und ist zurückgenommen: die oberste
 * Zeile der Startansicht ist VORAUSGEWÄHLT, `Strg/⌘+K` + Enter meldete damit dauerhaft ab
 * statt den erwarteten Kontextbefehl auszulösen. Der Vergleich mit „Speichern"/„Neue Person
 * erfassen" trug nicht: die stehen in `aktionen`/`schnellaktionen`, sind umkehrbar und
 * kosten keine Sitzung.
 *
 * Der Ausschluss ist deshalb eine ZWEITE ACHSE am einzelnen Befehl ({@link Befehl.nichtMerkbar})
 * statt einer feineren Gruppierung — eine Gruppe „navigation ohne Abmelden" hiesse, die
 * Bedeutung der Gruppe an einer Gedächtnisfrage auszurichten, und die Exhaustivität dieses
 * Records bliebe trotzdem die einzige Stelle, die eine neue Gruppe erzwingt. Die Achse zieht
 * nur ab, sie fügt nie hinzu; siehe die Begründung an ihrem Feld.
 */
export const GRUPPE_MERKBAR: Record<BefehlGruppe, boolean> = {
  ausgefuehrt: false,
  aktionen: false,
  datensaetze: false,
  schnellaktionen: true,
  zuletzt: false,
  module: false,
  einsaetze: true,
  einstellungen: true,
  navigation: true,
};

/**
 * Ist die Gruppe eine reine ORDNUNGSKOPIE, die bei aktiver Suche entfällt?
 *
 * Zweiter exhaustiver Record aus demselben Grund wie der erste — und ausdrücklich NICHT die
 * Negation von {@link GRUPPE_MERKBAR}: `module` ist nicht merkbar und bleibt bei aktiver
 * Suche trotzdem stehen. Gemeint ist hier allein „jeder Eintrag dieser Gruppe hat anderswo
 * in derselben Liste einen Zwilling mit gleichem Label, gleicher Ikone und gleichem Ziel".
 * Das trifft genau die beiden Gedächtnisgruppen; die Begründung steht an
 * `ohneOrdnungsdubletten` in `fuzzy.ts`.
 */
export const GRUPPE_NUR_ORDNUNG: Record<BefehlGruppe, boolean> = {
  ausgefuehrt: true,
  aktionen: false,
  datensaetze: false,
  schnellaktionen: false,
  zuletzt: true,
  module: false,
  einsaetze: false,
  einstellungen: false,
  navigation: false,
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
 *
 * ETAPPE C HAT SIE GESTELLT UND GLEICH BEANTWORTET (LFH-391 · C3): auch '#' und '@'
 * bekommen KEINEN Wortalias. Der Grund ist derselbe wie bei '>' und trägt hier sogar
 * weiter — ein getipptes „etb" ist ein SUCHBEGRIFF, es steht als Modullabel in der Liste;
 * es zugleich als Moduswechsel zu lesen machte die Eingabe mehrdeutig. Und unerreichbar
 * wird ohne Präfix nichts: der Vorgabemodus durchsucht alle zehn Quellen, die Präfixe
 * kürzen nur.
 */
export type PaletteModus = 'alles' | 'aktionen' | 'etb' | 'kraefte';

/**
 * Ein Abfrageweg des Datensatz-Finders — abgeleitet aus {@link DatensatzQuellen}, damit ein
 * neues Feld dort hier nicht vergessen werden kann.
 */
export type DatensatzQuelle = keyof DatensatzQuellen;

export interface ModusBeschreibung {
  /** Zeichen am Anfang der Eingabe; `null` für den Vorgabemodus, der ohne Präfix gilt. */
  praefix: string | null;
  /** Gruppen, auf die eingeschränkt wird; `null` = keine Einschränkung. */
  gruppen: readonly BefehlGruppe[] | null;
  /**
   * Datenquellen, die dieser Modus durchsucht; `null` = keine Einschränkung, `[]` = gar
   * keine. Gelesen von BEIDEN Hälften des Finders: `useDatensaetze` hängt sein `enabled`
   * daran, `baueDatensatzTreffer` seinen Quellenfilter.
   */
  quellen: readonly DatensatzQuelle[] | null;
  /** Wortlaut der Modusanzeige, solange der Modus aktiv ist. */
  hinweis: string | null;
  /** Wortlaut in der Legende bei leerem Feld, hinter der Präfix-Marke. */
  legende: string | null;
}

/**
 * EIN exhaustiver Record für ALLE Angaben eines Modus — Präfixzeichen, Befehlsgruppen,
 * Datenquellen und Wortlaut gehören zusammen. Getrennte Tabellen wären getrennte Orte, an
 * denen ein neuer Modus vergessen werden kann; hier erzwingt der Typcheck (TS2741) alles
 * auf einmal. Genau deshalb ist `quellen` in C3 ein FELD geworden und kein zweiter Record
 * daneben: der Plan hatte die Zuordnung Modus → Entität in `useDatensaetze.ts` liegen, wo
 * sie ein vierter Ort gewesen wäre — die Vorgabemenge zu erben ist dort still, nicht rot.
 *
 * `gruppen` ist für die Datensatz-Modi `[]` (kein statischer Befehl), nicht `null` — `null`
 * zeigte weiterhin alle Module. Die Datensatz-Treffer selbst laufen NICHT durch diesen
 * Filter: sie kommen als eigene Prop in die Palette (siehe `CommandPalette.tsx`).
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
   * '#' ist das Zeichen, das im ETB ohnehin vor der laufenden Nummer steht (`etbLabel`,
   * `meldungLabel`) — wer '#42' tippt, meint den Eintrag 42 und nicht die Person 42.
   */
  etb: {
    praefix: '#',
    gruppen: [],
    quellen: ['etbNummer', 'etbText'],
    hinweis: 'Nur Einsatztagebuch',
    legende: 'sucht im Einsatztagebuch',
  },
  /**
   * '@' beantwortet die Frage „WER?" — und die hat im Einsatz zwei Seiten: die handelnden
   * Kräfte (Fahrzeug, Personal, Einheit) und die betroffenen Personen. Alle vier tragen
   * einen NAMEN als tragendes Suchmerkmal; die übrigen sechs Quellen tragen einen
   * Sachverhalt (Schaden, Meldung, Auftrag, ETB-Eintrag, Unfallhilfsstelle).
   *
   * Die Personen sind bewusst DRIN, obwohl sie keine Kraft sind: der Funkrufname trägt nur
   * das Fahrzeug, Personal und Einheit tragen `name`, die Person ihren über `personLabel` —
   * „hat einen Namen" ist die einzige Beschreibung dieser Menge, die ohne Ausnahme
   * auskommt. Und die Personenliste ist im MANV die längste von allen; ein Präfix, das
   * gerade sie ausspart, spart dort nichts.
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
 * Mindestlänge des Restes, bevor der Datensatz-Finder überhaupt etwas holt.
 *
 * Nach unten begrenzt es der Zahlenzweig: die kürzeste gedruckte Kennung im System ist
 * zweistellig, mit N = 3 wäre „42 findet die Person 42" unerfüllbar. Nach oben begrenzt es
 * die Selektivität: ein einzelnes Zeichen ist keine Anfrage, es trifft in einer
 * MANV-Personenliste alles und kostet zehn Abrufe für null Aussage.
 *
 * HIER und nicht in `useDatensaetze.ts`, weil die Palette die Zahl selbst braucht: bei
 * einem einzelnen Zeichen im Datensatz-Modus ist die Liste per Konstruktion leer, und ein
 * stummes „Keine Treffer" wäre dort von „kaputt" nicht zu unterscheiden.
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
 * NEUN MODULE, ZEHN QUELLEN: 'Kräfte' zerfällt in `fahrzeuge`, `personal` und `einheiten`,
 * die in der `modulRegistry` drei getrennte Einträge mit eigener Sichtbarkeits- und
 * Rollenschranke sind — ein Sammelbegriff wäre eine vierte, erfundene Achse. Die beiden
 * ETB-Zweige teilen sich denselben Schlüssel: ein Modul, zwei Abfragewege.
 *
 * HIER und nicht neben den Abrufen (C2 hatte sie dort), weil der REINE Kern sie ebenfalls
 * braucht: er darf `useDatensaetze.ts` nicht importieren, das zöge react-query und die
 * neun API-Clients in eine Datei, die ohne Netz prüfbar sein soll. Zwei Kopien wären zwei
 * Zuordnungen, die auseinanderlaufen, ohne dass ein Test es sieht — der Kern filterte dann
 * nach einem anderen Modul als der Abruf.
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
} as const satisfies Record<DatensatzQuelle, string>;
