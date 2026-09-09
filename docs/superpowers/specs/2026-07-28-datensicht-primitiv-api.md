# LFH-330 · B2 — `Datensicht`: die festgelegte Signatur

## 1. Die Entscheidung

**Nachzug LFH-464 (08.09.2026):** `DatensichtProps` ergänzt `tabelleAb?: AbBreitePunkt`.
Die Auto-Form nutzt diesen Punkt mit unverändertem Default `md`; feste Formen behalten
Vorrang. Ausschließlich das ETB setzt nach Browsermessung `xl` (1200 px). Die folgenden
`md`-Beispiele beschreiben weiterhin den Default. Messung und Begründung:
[LFH-463/464-Prüfliste](2026-09-08-lfh-463-464-pruefliste.md).

Grundlage ist **Entwurf 2 („Kartenplan über Spaltenregister")**: EIN Spaltenregister je Modul mit `key` als Pflichtfeld und einem daneben stehenden, über `const K` typgeprüften Kartenplan, dessen Slots Spaltenschlüssel tragen und deren Inhalt aus dem `render` derselben Spalte kommt (`zelle()`); der Tabellenzweig delegiert an `KatalogTabelle`, der Kartenzweig an `Liste`/`ListenEintrag`, genau ein Zweig steht im Baum.

**Nicht** Entwurf 3 (15 Punkte gegen 14) — nicht weil sein Namensraumfehler unreparierbar wäre, sondern weil **die einzige Reparatur seine eigene These tötet**: die Projektion adressiert über `keyof T`, die Spalten dieses Repos über `key`, und die Räume fallen gemessen auseinander (`key:'typ'`/`dataIndex:'fahrzeugtyp'`, `key:'traeger'`/`dataIndex:'traegerorganisation'`, `FahrzeugePage.tsx:268/270`), während render-only-Spalten ohne jedes `dataIndex` die Mehrheit sind — **7 von 9** in `PersonalPage`, **5 von 7** in `personenSpalten`, **5 von 7** in `TierePage`, **4 von 6** in `MaterialPage`, **5 von 8** in `FahrzeugePage`. Der Join ginge nur über `bezugsSchluessel` (liest ausschließlich `dataIndex`, `KatalogTabelle.tsx:40-45`) und liefert für all diese Spalten `undefined`; die belastbare Reparatur — `{etikett, wert}` für **jede** Kartenrolle zu verlangen — entfernt `FeldSchluessel` und damit genau die Tippfehlersicherheit, die Entwurf 3 als Kern führt. Entwurf 2 braucht keine Reparatur.

Aufgepfropft: die **Formachse** `form: 'auto' | 'tabelle' | 'karte'` (Entwurf 3), der **Aktions-Deskriptor** statt `ReactNode`-Slot (Entwurf 3, Linse Erweiterbarkeit), die **kontrollierte Sortierform** und die Regel „Zustand, den ein anderes Seitenmerkmal liest, liegt außen" (Entwurf 1), `abBreite` **ersetzt** antds `responsive` in EINEM Zähler (Entwurf 2), Suche/Filter im Baummodus **verboten** wegen der stromaufwärts kumulierten Aggregate (Entwurf 2, gegen `filtereKraefte`, `kraeftebild.ts:368-389` verifiziert). Neu, weil alle drei Entwürfe es übersehen haben und die Kritik es B2 als nicht delegierbar zuweist: die **Zeilenschleuse** für Prüflisten-Kriterium 12.

---

## 2. Die vollständige öffentliche API

```ts
// frontend/src/components/Datensicht.tsx
import type { Key, ReactNode } from 'react';
import type { TableColumnType } from 'antd';
import type { AbBreitePunkt } from './useViewport';
import type { StatusDarstellung } from '../theme/statusFarben';

// ── Formachse ────────────────────────────────────────────────────────────────────────
/**
 * `'auto'`  Tabelle ab `md`, Karte darunter — die begründungspflichtige Ausnahme (E7).
 * `'tabelle'` immer Tabelle. Für Vergleichsflächen (Meldebild), die Kriterium 14
 *            ausdrücklich nicht in Karten auflösen dürfen.
 * `'karte'` immer Karte. Für Module, die heute schon kartenbasiert gelesen werden
 *            (Befehle, Lageberichte) — dort ist die Tabelle der Befund, nicht der Zielzustand.
 */
export type Darstellungsform = 'auto' | 'tabelle' | 'karte';

// ── Spaltenregister ──────────────────────────────────────────────────────────────────
/**
 * Was dem Primitiv gehört und der Aufrufer nicht setzen darf. Muster `KatalogTabelle.tsx:31`.
 *
 * `sorter`/`sortOrder`/`filters`/`filteredValue`/`onFilter` und die vier `filter*`-Haken
 * gehören `Datensicht`: antd hält deren Zustand INTERN, der Kartenzweig könnte ihn nicht
 * lesen und zeigte still eine andere Reihenfolge und Menge. Gemessen tut das heute niemand
 * (`sorter` = 0, `filters:` = 0, `defaultSortOrder` = 0 in `frontend/src`), die Amputation
 * kostet also keinen Bestand.
 * `fixed` gehört `KatalogTabelle`. `responsive` und `hidden` sind gestrichen und durch
 * `abBreite` bzw. den Spaltenschalter ersetzt — beide würden sonst Spalten verbergen, die
 * der Zähler nicht kennt, und ein Zähler, der lügen kann, verfehlt Kriterium 14.
 */
type AntdErbe<T> = Omit<
  TableColumnType<T>,
  | 'key'
  | 'sorter' | 'sortOrder' | 'defaultSortOrder' | 'sortDirections'
  | 'filters' | 'filteredValue' | 'defaultFilteredValue' | 'onFilter'
  | 'filterDropdown' | 'filterIcon' | 'filterMultiple' | 'filterSearch'
  | 'fixed' | 'responsive' | 'hidden'
>;

/** EINE Spaltendefinition je Modul. Beide Zweige schöpfen ausschließlich hieraus. */
export type DatensichtSpalte<T, K extends string = string> = AntdErbe<T> & {
  /** Pflicht (antd hat sie optional): der Kartenplan referenziert genau diesen Schlüssel. */
  key: K;
  /** Klartext für Karte, Spaltenschalter und Sortierauswahl. Pflicht, sobald `title` kein String ist. */
  etikett?: string;
  /** Macht die Spalte sortierbar — EINE Vergleichsgrundlage für BEIDE Zweige. `null`/`undefined` ans Ende. */
  sortWert?: (zeile: T) => string | number | null | undefined;
  /** Beitrag zur Freitextsuche. Fehlt er, trägt die Spalte nicht zur Suche bei. */
  suchText?: (zeile: T) => string | null | undefined;
  /** Spaltenfilter: Werteliste UND Prädikat, nie nur eins davon. */
  filter?: {
    werte: readonly { readonly text: string; readonly value: string }[];
    trifft: (zeile: T, wert: string) => boolean;
  };
  /** Erst ab dieser Breite in der TABELLE sichtbar (Ersatz für antds `responsive`). */
  abBreite?: AbBreitePunkt;
  /** Nicht abwählbar (Aktionsspalte). Spalte 0 ist es immer, unabhängig vom Flag. */
  immerSichtbar?: boolean;
};

/**
 * Bewahrt die Schlüssel-Literale, ohne die T-Angabe zu verlieren. Curried, weil TypeScript
 * keine teilweise Typargument-Inferenz kennt.
 *
 * FALLE: eine Liste, die als `readonly DatensichtSpalte<Person>[]` ANNOTIERT wird, weitet
 * `K` auf `string` und der Kartenplan nimmt danach jeden Tippfehler an. Der Typ kann das
 * nicht schließen; geschlossen wird es zweifach — `pruefeKartenplan` im DEV-Effekt und die
 * Guard-Marke `spaltenFuer` je Konsumentendatei (§8).
 */
export function spaltenFuer<T extends object>(): <const K extends string>(
  spalten: readonly DatensichtSpalte<T, K>[],
) => readonly DatensichtSpalte<T, K>[];

// ── Kartenplan ───────────────────────────────────────────────────────────────────────
/**
 * GENAU EINE Primäraktion — als Deskriptor, nicht als `ReactNode`-Slot. Damit besitzt das
 * Primitiv Form, Höhe (`controlHeight`) und Trefffläche; `size="small"` und `danger` sind
 * von außen nicht einschmuggelbar (E8; „Rot bedient nichts").
 *
 * `bestaetigung` ist nicht Zierde: die drei Bestands-„Entfernen" (`FahrzeugePage.tsx:317`,
 * `PersonalPage.tsx:246`, `MaterialPage.tsx:176`) hängen an einem `Popconfirm`. Ohne dieses
 * Feld feuerte die Aktion im Kartenzweig ohne Rückfrage — Prüflisten-Kriterium 4.
 */
export interface PrimaerAktion<T> {
  etikett: string;
  onKlick: (zeile: T) => void;
  /** Rückfragetitel. Gesetzt ⇒ `Popconfirm`, ohne `danger`. */
  bestaetigung?: string;
  /** Zeilenweise Ausblendung (Schreibrecht, Zustand). Fehlt = immer sichtbar. */
  sichtbar?: (zeile: T) => boolean;
}

/**
 * Titelzeile der Karte UND erste Spalte der Tabelle.
 *
 * `ziel` macht die Titelzelle in BEIDEN Zweigen zu einem echten `<Link>` — das ist das
 * Tastaturziel der Zeile. `ListenEintrag` ist ein nacktes `<div onClick>` (gemessen:
 * `components/Liste.tsx:141-161`, kein `role`, kein `tabIndex`, kein `onKeyDown`); ein
 * Zeilenklick darauf wäre unter `md` maus-/tippgebunden und für Gate 3 unsichtbar.
 *
 * REGEL: trägt `ziel` einen Wert, darf das `render` der Titelspalte selbst KEIN `<a>`
 * erzeugen — sonst verschachtelte Links. Wer heute im Spalten-`render` verlinkt
 * (`BewegungenTab` Person, `PersonalPage` Fahrzeug/Einheit), hebt den Link hierher.
 */
export interface TitelBezug<T, K extends string> {
  spalte: K;
  ziel?: (zeile: T) => string;
}

/** Kontext, den der Kartenzweig jedem Eintrag mitgibt (nur `art: 'eigen'`). */
export interface KartenKontext<T> {
  zeile: T;
  index: number;
  /** 0 = Wurzel. Einrückung wächst bis {@link TIEFE_DECKEL} und dann nicht weiter. */
  tiefe: number;
  aufklappen?: { offen: boolean; umschalten: () => void; anzahlKinder: number };
}

export type Kartenplan<T, K extends string> =
  | {
      art: 'plan';
      titel: TitelBezug<T, K>;
      /**
       * Statusetikett. Vertragstyp, KEIN Farbstring — `label` ist Pflichtfeld und damit
       * der erzwungene zweite Kanal (`theme/statusFarben.ts:73-78`). `null` = kein Etikett.
       *
       * Ausdrücklich NICHT das `render` der Statusspalte: dort steht im Schreibmodus ein
       * `<Select style={{ minWidth: 150 }}>` (`FahrzeugePage.tsx:274`, `PersonalPage.tsx:213`),
       * das eine 390-px-Karte breit drückt.
       */
      status?: (zeile: T) => StatusDarstellung | null;
      /** HÖCHSTENS DREI Sekundärfelder — der Tupeltyp erzwingt die Obergrenze. */
      sekundaer?: readonly [K?, K?, K?];
      aktion?: PrimaerAktion<T>;
    }
  | {
      art: 'eigen';
      /** Nur mit Eintrag in `datensicht.guard.test.ts` (`KARTEN_EIGENBAU`). */
      render: (ktx: KartenKontext<T>) => ReactNode;
    };

// ── Sortierung, Gruppierung, Baum, Zufluss ───────────────────────────────────────────
/** `null` = Reihenfolge wie geliefert (Serverordnung unangetastet). */
export type Sortierung<K extends string> = { spalte: K; richtung: 'auf' | 'ab' } | null;

/**
 * Gruppenachse. Beide Zweige verwenden dieselben Schlüssel und Zähler, aber NICHT
 * dieselbe Form — siehe §5/§9:
 *  · Kartenzweig: echte Gruppenköpfe („verfügbar · 7") über verschachtelten `Liste`n.
 *  · Tabellenzweig: die Gruppenachse wird zur FÜHRENDEN Sortierachse (Gruppen liegen
 *    zusammenhängend), die Zähler stehen als Streifen in der Werkzeugzeile. KEINE
 *    synthetischen Gruppenzeilen — `fixed:'left'` × zeilenübergreifendes `colSpan` ist in
 *    diesem Repo ungeprüft, und `KatalogTabelle` fixiert Spalte 0 unbedingt.
 */
export interface Gruppierung<T> {
  schluessel: (zeile: T) => string;
  etikett: (wert: string) => string;
  /** Feste Gruppenfolge; unbekannte Werte hängen in Antreffreihenfolge hinten an. */
  reihenfolge?: readonly string[];
}

/**
 * Feldname, unter dem `T` Kinder DESSELBEN Typs trägt — sonst `never`. Für `MeldebildZeile`
 * (`children?: MeldebildZeile[]`, `kraefte/kraeftebild.ts:42`) ergibt das `'children'`, für
 * `EinsatzFahrzeug` `never`. `-?` allein genügt nicht: `T[K]` trägt bei optionalen Feldern
 * weiter `| undefined`, deshalb `NonNullable`.
 */
export type KinderFeld<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends readonly T[] ? K & string : never;
}[keyof T];

/** Rekursive Sicht. EIN Prop, damit Feldname und Aufklappzustand nicht getrennt setzbar sind. */
export interface BaumSicht<T> {
  kinder: KinderFeld<T>;
  /** KONTROLLIERT — der Druckpfad der Kräfteübersicht setzt hier alle Schlüssel. */
  aufgeklappt: readonly Key[];
  onAufgeklappt: (schluessel: Key[]) => void;
}

/**
 * Verhalten bei nachfließenden Daten (Prüflisten-Kriterium 12, WCAG 3.2.5, CLS ≤ 0,1).
 *
 * `'sammelbanner'` (Default): solange der Fokus INNERHALB der Sicht liegt, bleiben
 *   Zeilenmenge und Zeilenreihenfolge eingefroren; Zellinhalte aktualisieren weiter
 *   (ein Statuswechsel muss sofort sichtbar sein, nur die Zeile darf nicht wandern).
 *   Neue Zeilen erscheinen als Banner in der Werkzeugzeile („7 neue Einträge — anzeigen").
 * `'sofort'`: kein Einfrieren. Nur für Flächen ohne fokussierbare Zeileninhalte.
 *
 * Die Werkzeugzeile wird IMMER gerendert, auch leer: eine Zeile, die beim Eintreffen
 * erscheint, verschiebt Inhalt und arbeitet gegen ihr eigenes Ziel (Lehre aus der
 * Sticky-Reserve in B1).
 */
export type Zufluss = 'sammelbanner' | 'sofort';

// ── Props ────────────────────────────────────────────────────────────────────────────
export interface DatensichtProps<T extends object, K extends string> {
  /**
   * Zugängliche Bezeichnung. Wird `aria-label` an einem `<section>` (nicht an einem `<div>`
   * — ein nacktes `div` mit `aria-label` hat keine Rolle, `getByRole('region')` greift dort
   * nicht), Präfix der DEV-Diagnosen und Beschriftung des Spaltenschalters.
   */
  bezeichnung: string;
  spalten: readonly DatensichtSpalte<T, K>[];
  daten: readonly T[];
  zeilenSchluessel: (keyof T & string) | ((zeile: T) => Key);
  karte: Kartenplan<T, K>;
  /** Default `'auto'`. */
  form?: Darstellungsform;
  ladend?: boolean;
  /** Tabelle: `locale.emptyText`; Karte: `Liste emptyText`. KEIN neuer `<Empty>`-Knoten (E1). */
  leerText?: ReactNode;

  // Zustand — Voreinstellung ODER kontrolliert, nie beides
  standardSortierung?: Sortierung<K>;
  sortierung?: Sortierung<K>;
  onSortierung?: (s: Sortierung<K>) => void;
  /** Freitextsuche über alle Spalten mit `suchText`. Im Baummodus verboten. */
  suche?: { platzhalter: string };
  gruppen?: Gruppierung<T>;
  /** Baumsicht. Schließt `suche`, Spaltenfilter, `gruppen` und `aufklappzeile` aus. */
  baum?: BaumSicht<T>;
  /** Default `'sammelbanner'`. */
  zufluss?: Zufluss;

  // Spaltensichtbarkeit — Voreinstellung ODER kontrolliert
  spaltenAusVoreinstellung?: readonly K[];
  spaltenAus?: readonly K[];
  onSpaltenAus?: (schluessel: K[]) => void;

  /** EINE Klasse für BEIDE Zweige: `rowClassName` bzw. `ListenEintrag className`. */
  zeilenKlasse?: (zeile: T) => string | undefined;
  /**
   * Zeilenklick als KOMFORT, nur im Tabellenzweig (`onRow`). Das Tastatur- und
   * Berührungsziel ist in beiden Zweigen `karte.titel.ziel` — nicht die ganze Fläche.
   * Ein klickbarer Karten-Container gehört B7 (LFH-335), zusammen mit `Liste.tsx`.
   */
  onZeileKlick?: (zeile: T) => void;
  /** Zusatzknöpfe links in der Werkzeugzeile (z. B. „Drucken"). */
  werkzeuge?: ReactNode;
  /**
   * Antd-Aufklappzeile (FahrzeugePage-Besatzungsblock). Allowlist statt durchgereichtem
   * `expandable`: ein per Subtraktion definierter Durchlass wächst mit jedem fremden Prop
   * mit und verrottet still, wenn ein ausgeschlossener Name verschwindet.
   * Nur im Tabellenzweig; schließt `baum` aus.
   */
  aufklappzeile?: (zeile: T) => ReactNode;
}

export default function Datensicht<T extends object, const K extends string>(
  props: DatensichtProps<T, K>,
): ReactNode;

// ── Konstanten ───────────────────────────────────────────────────────────────────────
/** Höchstzahl der Sekundärfelder. Am Tupeltyp erzwungen, hier nur benannt. */
export const MAX_SEKUNDAER = 3;
/** Ab dieser Tiefe wächst die Karteneinrückung nicht weiter (390 px). */
export const TIEFE_DECKEL = 3;

// ── Reine Funktionen: hier wohnt die Drift, deshalb exportiert ────────────────────────
/**
 * Der Zellinhalt, den BEIDE Zweige benutzen.
 *
 * antds `render` darf ein `RenderedCell` liefern; die Form ist
 * `{ props?: CellType<T>; children?: ReactNode }` (`@rc-component/table@1.10.4/lib/interface.d.ts:63-66`).
 * React-Elemente tragen ebenfalls `props`, deshalb ZUERST `isValidElement` prüfen und erst
 * danach auf `children` auspacken. `colSpan`/`rowSpan` sind in der Karte bedeutungslos.
 */
export function zelle<T>(spalte: DatensichtSpalte<T>, zeile: T, index: number): ReactNode;

/** `etikett ?? title` (nur wenn `title` ein String ist), sonst `undefined` + DEV-Warnung. */
export function etikettVon<T>(spalte: DatensichtSpalte<T>): string | undefined;

/**
 * Die EINE Quelle der gerenderten Zeilen und der benannte Seam für B3 (LFH-331): dort
 * wechselt nur die Herkunft von `daten`, die Signatur bleibt.
 * Flach: filtern, suchen, gruppen-sortieren, sortieren. Baum: `daten` unverändert.
 */
export function effektiveDaten<T extends object, K extends string>(args: {
  daten: readonly T[];
  spalten: readonly DatensichtSpalte<T, K>[];
  sortierung: Sortierung<K>;
  suchbegriff: string;
  filterWerte: Readonly<Record<string, readonly string[]>>;
  gruppen?: Gruppierung<T>;
  baum: boolean;
}): readonly T[];

/** Gruppen in Reihenfolge, je mit Zähler. Speist Kartenköpfe UND Zählerstreifen. */
export function gruppiere<T>(
  daten: readonly T[],
  gruppen: Gruppierung<T>,
): readonly { wert: string; etikett: string; zeilen: readonly T[] }[];

/** Sichtbare Spalten + Zähler — EINE Wahrheit aus Handauswahl UND `abBreite`. */
export function sichtbareSpalten<T, K extends string>(args: {
  spalten: readonly DatensichtSpalte<T, K>[];
  verborgen: ReadonlySet<K>;
  abBreite: (punkt: AbBreitePunkt) => boolean;
}): { spalten: readonly DatensichtSpalte<T, K>[]; anzahlVerborgen: number };

/**
 * Mängelliste des Kartenplans gegen das Spaltenregister; leeres Array = in Ordnung.
 * Meldet: Slot-Schlüssel ohne Spalte (fängt das `const`-Widening, das der Typ nicht
 * fängt), doppelte Spaltenschlüssel, `sekundaer`-Spalte ohne Etikett, `sortWert` an einer
 * Spaltengruppe, `suche`/`filter` bei gesetztem `baum`, `baum` zusammen mit
 * `aufklappzeile`/`gruppen`. `Datensicht` ruft sie im DEV-Effekt und gibt sie an
 * `console.warn` mit Präfix `[Datensicht: <bezeichnung>]`; der Test ruft sie DIREKT —
 * kein console-Spion, keine Abgrenzung gegen antd-Fremdwarnungen.
 */
export function pruefeKartenplan<T extends object, K extends string>(
  props: Pick<DatensichtProps<T, K>, 'spalten' | 'karte' | 'suche' | 'baum' | 'gruppen' | 'aufklappzeile'>,
  bezeichnung: string,
): string[];

/** Der Schalter für Seiten, die ihn EINMAL über mehreren Sichten zeigen. */
export function SpaltenSchalter<T, K extends string>(props: {
  bezeichnung: string;
  spalten: readonly DatensichtSpalte<T, K>[];
  aus: readonly K[];
  onAus: (schluessel: K[]) => void;
}): ReactNode;
```

---

## 3. Verhältnis zu `KatalogTabelle`

`Datensicht` **nutzt `KatalogTabelle` intern** für den Tabellenzweig und rendert selbst **kein** `<Table>`. Damit bleibt es bei genau einer Scroll-/Sticky-/Fixier-Wahrheit im Repo.

**`components/KatalogTabelle.tsx` braucht keine Codeänderung.** Weil `key` am Spaltentyp Pflicht ist, kommt die Spaltenidentität aus `key`; `bezugsSchluessel` wird nie gebraucht und muss nicht exportiert werden. Der Streit darüber, ob `bezugsSchluessel<T>(spalte: unknown)` überhaupt kompiliert (tut es nicht — der Rumpf verengt über `'children' in spalte`/`'dataIndex' in spalte`), ist damit gegenstandslos. Einzige Änderung an der Datei: eine Querverweis-Zeile im Kopfkommentar bei „Kein Spaltenschalter" auf `Datensicht`.

**`components/katalogTabelle.guard.test.ts` bleibt byte-identisch.** Geprüft: er scannt genau die 13 handgepflegten Pfade (`:39-53`, `toHaveLength(13)` `:101`) plus `KatalogTabelle.tsx` selbst (`:114-119`, `scroll={{` = 1, `sticky` > 0, `fixed: 'left'` = 1). `Datensicht.tsx` steht nicht in `QUELLEN`, setzt kein Scroll-Prop und ist der 14. Nutzer — keine der drei Zählungen bewegt sich, keine der 13 Katalogseiten wird angefasst, keine wird zu Karten.

Was daraus für die neuen Konsumenten folgt: sie sind an `KatalogTabelle`s unbedingte Fixierung von Spalte 0 gekoppelt, ohne im 13er-Inventar zu stehen. Diese Kopplung macht der neue Guard sichtbar (§8), nicht der alte.

Zwei Stellen, an denen `Datensicht` die Spaltenliste **vor** der Übergabe verändert — beide gehören ihm: `abBreite`-Auflösung samt Streichen der Spalte, und Injektion von `sorter: true` + kontrolliertem `sortOrder` (nur der Pfeil; sortiert wird im Primitiv).

---

## 4. Wo der Zustand liegt

Ein Hook, `useDatensicht`, **in `Datensicht.tsx`** (keine eigene Datei — er hat genau einen Aufrufer, und eine zweite Datei erzeugt nur eine zweite Stelle, an der die Voreinstellungs-/kontrolliert-Weiche driften kann).

| Zustand | Ort | Kontrollierbar von außen | Persistiert |
|---|---|---|---|
| **Sortierung** | `useDatensicht`, gesät aus `standardSortierung` | ja (`sortierung`/`onSortierung`) | nein |
| **Suchbegriff** | `useDatensicht` | nein | nein |
| **Spaltenfilter** | `useDatensicht` | nein | nein |
| **Spaltensichtbarkeit** | `useDatensicht`, gesät aus `spaltenAusVoreinstellung` | ja (`spaltenAus`/`onSpaltenAus` + `SpaltenSchalter`) | nein |
| **Aufklappzustand (Baum)** | **beim Aufrufer**, `BaumSicht` ist ausschließlich kontrolliert | Pflicht | nein |
| **Zeilenreihenfolge-Schleuse** | `useDatensicht` | nein | nein |

**Nichts persistiert.** Kein `localStorage`, kein `sichtId`, kein Query-Param. Begründung: ein Freitextschlüssel als Speicherort ist genau das Muster, das dieses Repo bei Query-Keys verboten und per AST-Scanner erzwungen hat — ein umbenannter Schlüssel bricht nichts, er trifft still ein anderes Fach; zwei Module mit demselben Wert teilen den Zustand ungewollt. Persistenz braucht eine Registry und einen e2e-`addInitScript`-Pfad, und die Prüfliste verlangt sie nicht. → §9.

**Warum die Sortierung eine kontrollierte Form hat und der Baum nur eine:** Sortierung wird von zwei Nachbartasks gelesen (B6-Sammelbanner, B7-Palette) und ist Kandidat für ein späteres `?sort=`; der Aufklappzustand wird schon heute von einem anderen Seitenmerkmal gesetzt — `KraefteuebersichtPage.tsx:203-206` (`handleDrucken` → `setExpandedKeys(alleKeys(bild.baum))`, Druck erst im Folgeeffekt). Ein Primitiv mit internem, verstecktem Aufklappzustand hätte diesen Pfad lautlos stillgelegt: kein Fehler, kein roter Test, nur ein Ausdruck mit kollabierten Zeilen. Verallgemeinerte Regel: **Zustand, den ein anderes Seitenmerkmal liest, liegt außen.**

**Die Zeilenschleuse (Kriterium 12), konkret:** `useDatensicht` hält die letzte gerenderte Schlüsselfolge. Ein `focusin`/`focusout`-Zuhörer am `<section>` sagt, ob die Sicht in Benutzung ist — das ist reine DOM-Containment-Frage, kein Layout, also in jsdom prüfbar. Ist sie in Benutzung, wird gegen diese Folge gerendert (Zellinhalte kommen frisch aus `daten`, die Position nicht), zugelaufene Schlüssel sammeln sich und erscheinen als Banner in der stets vorhandenen Werkzeugzeile; ein Klick übernimmt. Entfallene Schlüssel fallen sofort weg — eine nicht mehr vorhandene Zeile kann man nicht rendern.

---

## 5. Der Meldebild-Baum

Er läuft mit **`form="tabelle"`** — in jeder Breite Tabelle, kein Kartenzweig. Begründung: Festlegung 2 der Bedien-Leitlinie führt `pages/KraefteuebersichtPage.tsx` als kanonisches „wird verglichen: ja", und Kriterium 14 verlangt dort ausdrücklich „keine Auflösung in Karten, wo verglichen wird". Die E7-Trennlinie („Karte für Module, in denen ein Datensatz als EINHEIT erfasst wird") schließt einen Vergleichsbaum aus. Zwei der drei Entwürfe hatten hier einen Kartenzweig; das ist ein Regelbruch ohne Not.

Damit trägt den Baum **nur der Tabellenzweig**, und zwar unverändert wie heute: `baum.kinder` → `expandable.childrenColumnName`, `baum.aufgeklappt` → `expandedRowKeys`, `baum.onAufgeklappt` → `onExpandedRowsChange`. Gemessen liegen alle drei heute schon innerhalb `expandable={{ … }}` (`KraefteuebersichtPage.tsx:336-340`), der Objekt-Merge ist also ein Umzug, kein Umbau. Unbegrenzte Tiefe kommt von antd. `alleKeys`/`handleDrucken` laufen Zeile für Zeile gleich weiter, weil `aufgeklappt` kontrolliert ist.

Der Kartenzweig-Code für Bäume existiert trotzdem in `Datensicht` — `form="auto"` mit gesetztem `baum` ist zulässig und rendert unter `md` eine Rekursion mit Aufklappknopf (Zähler im Etikett: „3 Einheiten"), Einrückung `token.padding × min(tiefe, TIEFE_DECKEL)`. Am Tag 1 nutzt ihn niemand; er ist der Weg, auf dem eine spätere, nicht vergleichende Baumfläche Karten bekommt, ohne eine zweite Rekursion zu bauen.

**`fixed: 'left'` × Aufklapp-Icon bleibt ungeprüft und wird nicht umgangen.** Keiner der 14 Bestandskonsumenten von `KatalogTabelle` ist ein Baum, und jsdom rechnet kein Layout. Es gibt **kein** `ohneFixierung`-Prop: das Meldebild bekommt die fixierte Identifierspalte, weil Kriterium 14 sie verlangt, und der Nachweis kommt aus einem Playwright-Lauf (§8). Ein `fixed: false` wäre ein wissentlicher Rückschritt gegen Gate 2 (b) auf genau der Seite, die die Leitlinie als Referenz führt.

**Die harte Grenze:** `suche`, Spaltenfilter und `gruppen` sind im Baummodus verboten, nicht nur unbenutzt — `effektiveDaten({ …, baum: true })` gibt `daten` unverändert zurück. Gemessen: `personalVerteilung`/`fahrzeugVerteilung` werden stromaufwärts über die Vollmenge kumuliert, während `filtereKraefte` (`kraeftebild.ts:368-389`) die Rohlisten filtert und den Baum neu baut. Fiele im Primitiv eine Zeile weg, behielten die Elternzeilen Aggregate über nicht mehr sichtbare Kinder — die Zahlen lügen still, und kein Test sieht es. Also filtert das Modul, `Datensicht` rendert. Ebenso keine `standardSortierung`: eine Neusortierung zerlegte die fachliche Folge Abschnitt → Einheit → Mittel.

---

## 6. Je Zielmodul ein Aufrufbeispiel

### FahrzeugePage (`pages/FahrzeugePage.tsx` — 8 Spalten, erster Adressat des Spaltenschalters)

```tsx
const fahrzeugSpalten = spaltenFuer<EinsatzFahrzeug>()([
  { key: 'funkrufname', title: 'Funkrufname', immerSichtbar: true,
    sortWert: (ef) => ef.funkrufname, suchText: (ef) => ef.funkrufname,
    render: (_t, ef) => <Space>{ef.funkrufname}{ef.ist_adhoc && <Tag color="blue">ad-hoc</Tag>}</Space> },
  { key: 'typ', title: 'Typ', dataIndex: 'fahrzeugtyp',
    suchText: (ef) => ef.fahrzeugtyp, render: (t) => t ?? '—' },
  { key: 'kennzeichen', title: 'Kennzeichen', dataIndex: 'kennzeichen', abBreite: 'lg',
    render: (t) => t ?? '—' },
  { key: 'traeger', title: 'Träger', dataIndex: 'traegerorganisation',
    filter: { werte: traegerWerte, trifft: (ef, w) => ef.traegerorganisation === w },
    render: (t) => t ?? '—' },
  { key: 'status', title: 'Status',
    filter: { werte: KATEGORIE_WERTE, trifft: (ef, w) => (ef.status_kategorie ?? 'ohne') === w },
    // unverändert dreiwegig: kein Status / mandantengepflegte DB-Farbe / Vertragsachse
    render: (_t, ef) => (darfSchreiben
      ? <Select style={{ width: '100%', minWidth: 0 }} value={ef.status_id ?? undefined}
          placeholder="Status wählen" options={stati.map((s) => ({ value: s.id, label: s.label }))}
          onChange={(id) => statusMutation.mutate({ efId: ef.id, statusId: id })} />
      : <StatusBadge ef={ef} />) },
  { key: 'besatzung', title: 'Besatzung',
    render: (_t, ef) => <BesatzungsStaerkeBadge
      ist={istBesatzungsStaerke(personal.filter((p) => p.fahrzeug_id === ef.id))}
      soll={ef.soll_besatzung ?? null} /> },
  { key: 'bemerkung', title: 'Bemerkung', abBreite: 'xl',
    render: (_t, ef) => <BemerkungZelle ef={ef} /> },
  ...(darfSchreiben
    ? [{ key: 'aktionen' as const, title: 'Aktionen', immerSichtbar: true,
         render: (_t: unknown, ef: EinsatzFahrzeug) => (
           <Popconfirm title="Aus Einsatz entfernen?" onConfirm={() => entfernenMutation.mutate(ef.id)}>
             <Button>Entfernen</Button>{/* kein `danger`: Rot bedient nichts */}
           </Popconfirm>) }]
    : []),
]);

<Datensicht
  bezeichnung="Fahrzeuge im Einsatz"
  spalten={fahrzeugSpalten}
  daten={efs}
  zeilenSchluessel="id"
  ladend={efQuery.isLoading}
  leerText="Noch keine Fahrzeuge disponiert"
  suche={{ platzhalter: 'Funkrufname, Typ, Träger' }}
  standardSortierung={{ spalte: 'funkrufname', richtung: 'auf' }}
  gruppen={{ schluessel: (ef) => ef.status_kategorie ?? 'ohne',
             etikett: (w) => (w === 'ohne' ? 'ohne Status' : statusKategorie[w as StatusKategorie].label),
             reihenfolge: ['verfuegbar', 'gebunden', 'nicht_verfuegbar', 'ohne'] }}
  zeilenKlasse={(ef) => (ef.id === highlightId ? 'zeile-hervorgehoben' : undefined)}
  aufklappzeile={(ef) => (
    <BesatzungsBlock ef={ef} personal={personal} darfSchreiben={darfSchreiben}
      onZuordnen={(epId) => besatzungZuMutation.mutate({ efId: ef.id, epId })}
      onFreigeben={(epId) => besatzungFreiMutation.mutate({ efId: ef.id, epId })} />
  )}
  karte={{
    art: 'plan',
    titel: { spalte: 'funkrufname', ziel: (ef) => fahrzeugePfad(einsatzId, { fahrzeug: ef.id }) },
    status: (ef) => (ef.status_kategorie
      ? { ...statusKategorie[ef.status_kategorie], label: ef.status_label ?? statusKategorie[ef.status_kategorie].label }
      : null),
    sekundaer: ['typ', 'traeger', 'besatzung'],
    aktion: darfSchreiben
      ? { etikett: 'Entfernen', bestaetigung: 'Aus Einsatz entfernen?',
          onKlick: (ef) => entfernenMutation.mutate(ef.id) }
      : undefined,
  }}
/>
```

Der Karten-Statusslot nimmt die **Vertragsachse mit dem Mandantenlabel** — dasselbe Muster, das `KraefteuebersichtPage.tsx:123` schon fährt (`{ ...meta, label: z.statusLabel ?? meta.label }`). Der Text ist damit in beiden Zweigen identisch; die Farbe weicht ab, wenn der Mandant `status_farbe` gepflegt hat, weil das ungeprüfter Freitext außerhalb des A2-Vertrags ist (`theme/statusFarben.ts`, dort mit eigenem Folgeticket vermerkt). → §9.

### PersonalPage (`pages/PersonalPage.tsx` — 9 Spalten, breiteste Fläche des Repos)

```tsx
const personalSpalten = spaltenFuer<EinsatzPersonal>()([
  { key: 'name', title: 'Name', immerSichtbar: true,
    sortWert: (ep) => ep.name, suchText: (ep) => ep.name,
    // Der Deeplink der Fahrzeugspalte wandert NICHT hierher — er bleibt seine eigene
    // Spalte. Nur die TITELspalte trägt `titel.ziel`, sonst verschachtelte Links.
    render: (_t, ep) => <Space>{ep.name}{ep.ist_adhoc && <Tag color="blue">ad-hoc</Tag>}</Space> },
  { key: 'funktion', title: 'Funktion', dataIndex: 'funktion',
    suchText: (ep) => ep.funktion, render: (t) => t ?? '—' },
  { key: 'traeger', title: 'Träger', dataIndex: 'traegerorganisation',
    filter: { werte: traegerWerte, trifft: (ep, w) => ep.traegerorganisation === w },
    render: (t) => t ?? '—' },
  { key: 'fahrzeug', title: 'Fahrzeug', render: (_t, ep) => <FahrzeugZelle ep={ep} /> },
  { key: 'einheit', title: 'Einheit', render: (_t, ep) => <EinheitZelle ep={ep} /> },
  { key: 'position', title: 'Position', abBreite: 'xl', render: (_t, ep) => <PositionZelle ep={ep} /> },
  { key: 'status', title: 'Status',
    filter: { werte: KATEGORIE_WERTE, trifft: (ep, w) => (ep.status_kategorie ?? 'ohne') === w },
    render: (_t, ep) => (darfSchreiben ? <StatusSelect ep={ep} /> : <StatusBadge ep={ep} />) },
  { key: 'bemerkung', title: 'Bemerkung', abBreite: 'xl', render: (_t, ep) => <BemerkungZelle ep={ep} /> },
  ...(darfSchreiben
    ? [{ key: 'aktionen' as const, title: 'Aktionen', immerSichtbar: true,
         render: (_t: unknown, ep: EinsatzPersonal) => <EntfernenAktion ep={ep} /> }]
    : []),
]);

<Datensicht
  bezeichnung="Personal im Einsatz"
  spalten={personalSpalten}
  daten={eps}
  zeilenSchluessel="id"
  ladend={epQuery.isLoading}
  leerText="Noch kein Personal disponiert"
  suche={{ platzhalter: 'Name, Funktion, Träger' }}
  standardSortierung={{ spalte: 'name', richtung: 'auf' }}
  spaltenAusVoreinstellung={['bemerkung']}
  zeilenKlasse={(ep) => (ep.id === highlightId ? 'zeile-hervorgehoben' : undefined)}
  karte={{
    art: 'plan',
    titel: { spalte: 'name', ziel: (ep) => personalPfad(einsatzId, { personal: ep.id }) },
    status: (ep) => (ep.status_kategorie
      ? { ...statusKategorie[ep.status_kategorie], label: ep.status_label ?? statusKategorie[ep.status_kategorie].label }
      : null),
    sekundaer: ['funktion', 'einheit', 'fahrzeug'],
    aktion: darfSchreiben
      ? { etikett: 'Entfernen', bestaetigung: 'Aus Einsatz entfernen?',
          onKlick: (ep) => entfernenMutation.mutate(ep.id) }
      : undefined,
  }}
/>
```

Der Schalter meldet „Spalten · 1 ausgeblendet" als **Text** im Namen, nicht als `Badge`: ein `count`-Badge rendert ohne `color` auf `token.colorError` (`antd/es/badge/style/index.js:289`) — Rot für einen Spaltenzähler bricht „Rot bedient nichts" und Kriterium 7.

### PersonenPage (`pages/PersonenPage.tsx` + `personen/personenSpalten.tsx`)

Der Patienten-Reiter wird **eine** `Datensicht` mit `gruppen` statt fünf Tabellen — damit gibt es eine stehende Kopfzeile, eine fixierte Kennungsspalte und einen Spaltenschalter statt fünf.

```tsx
// personen/personenSpalten.tsx
export const personenSpalten = spaltenFuer<Person>()([
  { key: 'reg', title: 'Reg.-Nr.', width: 100, immerSichtbar: true,
    sortWert: (p) => p.registrier_nr, suchText: (p) => registrierAnzeige(p.registrier_nr),
    render: (_t, p) => <Typography.Text strong>{registrierAnzeige(p.registrier_nr)}</Typography.Text> },
  { key: 'status', title: 'Status', width: 130,
    render: (_t, p) => <Tag color={STATUS_META[p.status].color}>{STATUS_META[p.status].label}</Tag> },
  { key: 'sk', title: 'SK', width: 90, render: (_t, p) => <SkTag p={p} /> },
  { key: 'name', title: 'Name', suchText: (p) => nameOderUnbekannt(p),
    render: (_t, p) => nameOderUnbekannt(p) },
  { key: 'geschlecht', title: 'Geschlecht', dataIndex: 'geschlecht', abBreite: 'lg',
    render: (g) => g ?? '—' },
  { key: 'alter', title: 'Alter', abBreite: 'lg', render: (_t, p) => alterAnzeige(p) },
  { key: 'seit', title: 'seit', sortWert: (p) => p.aktuelle_sichtung_at ?? p.erfasst_at,
    render: (_t, p) => <ZeitAnzeige wert={p.aktuelle_sichtung_at ?? p.erfasst_at} /> },
  { key: 'antreff_ort', title: 'Antreffort', dataIndex: 'antreff_ort', abBreite: 'xl',
    render: (t) => t ?? '—' },
]);

// KORREKTUR (bei der Umsetzung gemessen, LFH-330): der Rückgabetyp ist der PLAN-ZWEIG,
// nicht der Verbundtyp. Ein `Kartenplan<…>` lässt sich nicht spreizen — `{ ...personenKarte(id),
// aktion: … }` ergibt TS2322, weil der Spread die `art`-Unterscheidung verliert und TypeScript
// `aktion` gegen den `art: 'eigen'`-Zweig prüft, der sie nicht kennt. Betrifft jede Helferfunktion,
// deren Ergebnis später um einen Slot ergänzt wird.
type KartenPlanZweig<T, K extends string> = Extract<Kartenplan<T, K>, { art: 'plan' }>;

export const personenKarte = (einsatzId: number): KartenPlanZweig<Person, PersonenSpaltenKey> => ({
  art: 'plan',
  titel: { spalte: 'reg', ziel: (p) => personDetailPfad(einsatzId, p.id) },
  sekundaer: ['name', 'sk', 'seit'],
});
```

`STATUS_META`/`SK_META` bleiben antd-Farbnamen und damit außerhalb des A2-Vertrags — sie in `karte.status` zu zwingen hieße, eine gepinnte Entscheidung umzudrehen (Bestands-Sweep, den A2 verbietet). Deshalb **kein `status`-Slot**; SK und Status stehen als Sekundärfeld bzw. Spalte. In `personenSpalten.tsx` ist das die einzige Stelle, an der Kriterium 7 offen bleibt (`red` = „verstorben" in einer Spalte, `red` = „SK I" in der anderen). → §9.

```tsx
// pages/PersonenPage.tsx — Patienten-Reiter (ersetzt PATIENT_SK.map + 5 <Table>)
{sicht === 'patienten' ? (
  <Datensicht
    bezeichnung="Patienten nach Sichtungskategorie"
    spalten={personenSpalten}
    daten={alle.filter(istPatient)}
    zeilenSchluessel="id"
    ladend={personenQuery.isLoading}
    leerText="Keine Patienten in diesem Einsatz."
    standardSortierung={{ spalte: 'seit', richtung: 'auf' }}
    gruppen={{ schluessel: (p) => p.aktuelle_sichtung ?? 'ohne',
               etikett: (sk) => (sk === 'ohne' ? 'ohne SK' : SK_META[sk as Sk].label),
               reihenfolge: [...PATIENT_SK, 'ohne'] }}
    onZeileKlick={(p) => navigate(personDetailPfad(einsatzId, p.id))}
    karte={personenKarte(einsatzId)}
  />
) : (
  <Datensicht
    bezeichnung="Personen"
    spalten={[...personenSpalten, ...aktionsSpalten]}   // aktionsSpalten aus abgleichSpalte()
    daten={personen}
    zeilenSchluessel="id"
    ladend={personenQuery.isLoading}
    leerText="Keine Personen in dieser Sicht"
    suche={{ platzhalter: 'R-Nr. oder Name' }}
    standardSortierung={{ spalte: 'reg', richtung: 'auf' }}
    onZeileKlick={(p) => navigate(personDetailPfad(einsatzId, p.id))}
    karte={{ ...personenKarte(einsatzId),
      aktion: darfSchreiben && sicht === 'vermisst'
        ? { etikett: 'Abgleich vorschlagen …', onKlick: (p) => setAbgleichFuer(p) }
        : undefined }}
  />
)}
```

`abgleichSpalte` trägt heute `<Select size="small" style={{ width: 200 }}>` (`personenSpalten.tsx:53`) — ein ~24-px-hohes Steuerelement mit fester Breite. Als Kartenaktion wäre das dreifach regelwidrig (E8, Kriterium 1, Gate 1 bei 390 px). Der Deskriptor **ersetzt** es, er wickelt es nicht ein: die Karte trägt einen Knopf, der ein Modal öffnet; die Tabellenspalte bleibt wie sie ist, weil `abBreite`/`immerSichtbar` sie ohnehin nur im Tabellenzweig zeigen. Das `size="small"` dort ist Bestand — sein Abbau ist LFH-333/B5, nicht B2.

### BewegungenTab (`pages/uhs/BewegungenTab.tsx` — 5 Spalten, chronologisches Protokoll)

```tsx
const bewegungsSpalten = spaltenFuer<UhsBelegung>()([
  { key: 'zeitpunkt_at', title: 'Zeit', dataIndex: 'zeitpunkt_at', immerSichtbar: true,
    sortWert: (b) => b.zeitpunkt_at,
    render: (v: string) => <ZeitAnzeige wert={v} format="dtgVoll" /> },
  { key: 'person_id', title: 'Person', dataIndex: 'person_id',
    suchText: (b) => personSuchText(b, personenById),
    // Der <Link> ist HIER entfallen und liegt jetzt in `titel.ziel` — sonst wäre er im
    // Kartenzweig in einen zweiten Link gewickelt. Die zwei gepinnten LFH-25-Tests
    // greifen weiter `getByRole('link', …)`, in beiden Zweigen.
    render: (personId: number) => personEtikettOderId(personId, personenById) },
  { key: 'art', title: 'Art', dataIndex: 'art',
    filter: { werte: ART_WERTE, trifft: (b, w) => b.art === w },
    render: (art: BelegungsArt) => <StatusTag darstellung={belegungsArt[art]} /> },
  { key: 'platz_id', title: 'Platz', dataIndex: 'platz_id',
    render: (platzId: number | null) => plaetzeById.get(platzId ?? -1)?.bezeichnung ?? 'Inbox' },
  { key: 'notiz', title: 'Notiz', dataIndex: 'notiz', render: (v: string | null) => v ?? '—' },
]);

<Datensicht
  bezeichnung="Bewegungen"
  spalten={bewegungsSpalten}
  daten={uhs.belegungen}
  zeilenSchluessel="id"
  ladend={personenQuery.isLoading}
  leerText="Keine Bewegungen erfasst"
  suche={{ platzhalter: 'Person oder R-Nr.' }}
  standardSortierung={{ spalte: 'zeitpunkt_at', richtung: 'ab' }}
  karte={{
    art: 'plan',
    // Kartentitel ist die PERSON (die Karte wird gelesen: wer hat sich bewegt),
    // Tabellenspalte 0 bleibt die Zeit (die Tabelle wird chronologisch verglichen).
    // Rollen sind orthogonal zur Spaltenreihenfolge.
    titel: { spalte: 'person_id',
             ziel: (b) => personDetailPfad(uhs.einsatz_id, b.person_id) },
    status: (b) => belegungsArt[b.art],
    sekundaer: ['zeitpunkt_at', 'platz_id', 'notiz'],
  }}
/>
```

`standardSortierung: 'ab'` spiegelt die Backend-Ordnung (`ORDER BY zeitpunkt_at DESC`); ein Test „erste Zeile ist die neueste" kann deshalb nicht fehlschlagen — beweiskräftig ist nur ein Klick auf `auf` oder eine absichtlich unsortierte Fixture. Der Spaltenschalter erscheint hier nicht (5 Spalten, unter der Schwelle; die Werkzeugzeile trägt nur Suche und Filter).

Die im Task genannte Zeitleiste wird **nicht** über `art: 'eigen'` gebaut: `Liste` rendert `<ul>/<li>` mit `colorSplit`-Trennlinien, also bereits die Struktur von `personen/PersonVerlauf.tsx` — der Plan-Modus liefert sie. `art: 'eigen'` bleibt am Tag 1 **unbenutzt**, und `KARTEN_EIGENBAU` im Guard ist eine leere Liste mit `toHaveLength(0)`. Das ist der Unterschied zu Entwurf 2, dessen Ausnahme am ersten Tag belegt war und über Band C auf ~5 gewachsen wäre.

### KraefteuebersichtPage / Meldebild (`pages/KraefteuebersichtPage.tsx` — 4 Spalten, Baum)

```tsx
// `spalten` bleibt Modulkonstante (nutzt kein `token`) — nur `key`s und `spaltenFuer` neu.
const meldebildSpalten = spaltenFuer<MeldebildZeile>()([
  { key: 'bez', title: 'Bezeichnung', dataIndex: 'bezeichnung', immerSichtbar: true,
    render: (_t, z) => <span style={{ fontWeight: z.art === 'abschnitt' ? 600 : 400 }}>{z.bezeichnung}</span> },
  { key: 'detail', title: 'Typ / Rolle', dataIndex: 'detail', abBreite: 'md' },
  { key: 'staerke', title: 'Stärke', width: 130,
    render: (_t, z) => (z.art === 'mittel' && z.mittelArt !== 'person' ? null : staerkeText(z.staerke)) },
  { key: 'status', title: 'Status', width: 220, render: (_t, z) => <MeldebildStatus z={z} /> },
]);

<Datensicht
  bezeichnung="Meldebild"
  form="tabelle"                        // Vergleichsfläche — Kriterium 14, keine Karten
  spalten={meldebildSpalten}
  daten={bild.baum}                     // schon durch `filtereKraefte` vorgefiltert
  zeilenSchluessel="key"
  leerText="Keine Kräfte im Einsatz disponiert"
  baum={{ kinder: 'children', aufgeklappt: expandedKeys, onAufgeklappt: setExpandedKeys }}
  werkzeuge={<Button onClick={handleDrucken}>Drucken</Button>}
  zufluss="sofort"                      // Filterleiste liegt außen; das Modul baut den Baum neu
  // KEIN `suche`, KEIN Spaltenfilter, KEIN `gruppen`, KEINE `standardSortierung`:
  // die Aggregate der Elternzeilen sind über die Vollmenge gerechnet und würden lügen.
  karte={{ art: 'plan', titel: { spalte: 'bez' }, sekundaer: ['detail', 'staerke', 'status'] }}
/>
```

`karte` bleibt Pflicht-Prop, auch bei `form="tabelle"`. Das ist bewusst: ein optionales `karte` machte die Weiche zu einer Laufzeitfrage („welche Form hat diese Sicht überhaupt?"), und `form` ist umkehrbar — wer später auf `'auto'` stellt, hat den Plan schon.

Die Filter-Card (`:294`, `className="kraefte-no-print"`) bleibt **außerhalb** von `Datensicht` und filtert weiter über `filtereKraefte` die Rohlisten.

---

## 7. Dateikopf-Kommentar für `Datensicht.tsx`

```tsx
/**
 * Datensicht-Primitiv der Einsatzmodule (LFH-330 · B2).
 *
 * EINE Spaltendefinition je Modul, zwei Darstellungsformen. Die Formwahl liegt an
 * `form`, nicht am Zufall: `'tabelle'` immer Tabelle, `'karte'` immer Karte,
 * `'auto'` Tabelle ab `md` und Karte darunter. Der Tabellenzweig rendert nicht selbst,
 * sondern durch `KatalogTabelle` — es bleibt bei EINER Scroll-/Sticky-/Fixier-Wahrheit
 * im Repo, und diese Datei setzt kein Scroll-Prop.
 *
 * ── DIE KARTEN-AUSNAHME, und sie ist begründungspflichtig ───────────────────────
 *
 * `form: 'auto'` löst unterhalb `md` eine Tabelle in Karten auf. Das WIDERSPRICHT der
 * Regel aus CLAUDE.md und A1/Festlegung 2: „Auf schmalem Schirm wird eine Tabelle
 * angepasst, nicht in Karten aufgelöst — Karten-Fallback ist die Ausnahme mit
 * Begründung im Task."
 *
 * Träger der Ausnahme ist der Kontext **mobil** aus A1: ~390 px, einhändig, komfortabel,
 * keine Vergleichsansichten. Dort ist ein Datensatz, der als EINHEIT erfasst und gelesen
 * wird — ein Fahrzeug, eine Person, eine Bewegung — keine Vergleichsaufgabe, und
 * Festlegung 2 sagt für diesen Fall „Liste/Karte, wenn gelesen wird".
 *
 * DIE TRENNLINIE, damit die Ausnahme nicht wandert:
 *   · `KatalogTabelle` + Scroll bleibt für die Stammdaten-VERGLEICHSTABELLEN. Keine der
 *     dreizehn wird zu Karten, keine ihrer Aufrufstellen wird angefasst.
 *   · `form: 'tabelle'` gilt für Vergleichsflächen, die auch schmal verglichen werden —
 *     das Meldebild der Kräfteübersicht, das A1/Festlegung 2 namentlich als „wird
 *     verglichen: ja" führt. Prüflisten-Kriterium 14 verbietet dort die Auflösung in
 *     Karten ausdrücklich; das ist kein Ermessen.
 *   · `form: 'auto'` gilt für Einsatzmodule, in denen ein Datensatz eine Einheit ist.
 *   · `form: 'karte'` gilt für Module, die heute schon kartenbasiert gelesen werden
 *     (Befehle, Lageberichte). Dort ist die Tabelle der Befund, nicht der Zielzustand.
 *
 * Was die Karte NICHT kann, ist an der Aufrufstelle sichtbar statt still: `aufklappzeile`
 * läuft nur im Tabellenzweig, und eine Spalte ohne Platz im Kartenplan erscheint dort
 * nicht. Der Funktionsverlust unter `md` ist damit lesbar, nicht überraschend.
 *
 * ── FÜNF ZUSICHERUNGEN, sie gehören dem Primitiv ────────────────────────────────
 *
 * 1. **Genau EIN Zweig im Baum.** Kein `display:none`-Umschalten. Ein zweiter,
 *    verborgener Zweig machte jedes „unter md keine Tabelle"-Gate bedeutungslos und
 *    montierte die In-Zeile-Steuerelemente doppelt — die Lehre aus dem Navigations-Drawer
 *    (B1), der seinen Inhalt deshalb erst beim Öffnen rendert.
 * 2. **EINE Reihenfolge, EINE Menge für beide Zweige.** Antds `sorter`/`filters`/
 *    `onFilter` sind am Spaltentyp abgeschnitten, weil `Table` deren Zustand INTERN hält:
 *    der Kartenzweig könnte ihn nicht lesen und zeigte still eine andere Reihenfolge.
 *    Sortiert und gefiltert wird hier, die Tabelle bekommt nur `sorter: true` und
 *    kontrolliertes `sortOrder` für den Pfeil.
 * 3. **EINE Sichtbarkeitswahrheit.** `abBreite` ersetzt antds `responsive`, `hidden` ist
 *    gestrichen, und beide Ausblendungsgründe fließen in DENSELBEN Zähler. Ein Zähler,
 *    der „0 ausgeblendet" meldet, während antd zwei Spalten verbirgt, verfehlt genau das
 *    Kriterium (14), für das er existiert.
 * 4. **Das Tastaturziel der Zeile ist die Titelzelle, nicht die Fläche.** Bei gesetztem
 *    `titel.ziel` rendert sie in BEIDEN Zweigen einen echten `<Link>` mit Höhe aus
 *    `controlHeight`. Grund: `ListenEintrag` (`components/Liste.tsx`) legt `onClick` auf
 *    ein nacktes `<div>` — ohne `role`, ohne `tabIndex`, ohne `onKeyDown`. Ein Zeilenklick
 *    darauf wäre maus-/tippgebunden und für die Trefflächenmessung unsichtbar. Eine
 *    klickbare Karte als Ganzes gehört B7 (LFH-335) samt `Liste.tsx`.
 * 5. **Zeilen springen nicht unter dem Cursor.** Solange der Fokus in der Sicht liegt,
 *    sind Zeilenmenge und -reihenfolge eingefroren; Zellinhalte laufen weiter. Zufluss
 *    erscheint als Banner in der Werkzeugzeile (WCAG 3.2.5 / G76, CLS ≤ 0,1). Die
 *    Werkzeugzeile wird IMMER gerendert, auch leer — eine Zeile, die beim Eintreffen
 *    erscheint, verschiebt Inhalt und arbeitet gegen ihr eigenes Ziel.
 *
 * ── VIER FALLEN ────────────────────────────────────────────────────────────────
 *
 * · **Die Werkzeugzeile liegt AUSSERHALB von `.ant-table`.** `katalogtabelle-schmal.spec.ts`
 *   misst `scrollWidth` am `.ant-table`-Wurzelknoten gegen 390 px; eine Leiste darin
 *   zählte in dieses Maß hinein und machte die Messung stumpf.
 * · **`const K` ist verlierbar.** Wer die Spaltenliste als
 *   `readonly DatensichtSpalte<Person>[]` ANNOTIERT statt sie durch `spaltenFuer<T>()`
 *   zu führen, weitet `K` auf `string`; der Kartenplan nimmt danach jeden Tippfehler
 *   ohne Meldung an. Deshalb prüft `pruefeKartenplan` die Slot-Schlüssel im DEV-Effekt
 *   gegen die echten Spaltenschlüssel, und der Guard verlangt die Marke `spaltenFuer`
 *   je Konsumentendatei.
 * · **Der Statusslot ist NICHT das `render` der Statusspalte.** Dort steht im
 *   Schreibmodus ein `<Select style={{ minWidth: 150 }}>`, das eine 390-px-Karte breit
 *   drückt. Der Slot nimmt eine `StatusDarstellung` — `label` ist dort Pflichtfeld und
 *   damit der zweite Kanal (WCAG 1.4.1).
 * · **Filter, Suche und Gruppen sind im Baummodus VERBOTEN, nicht bloß unbenutzt.**
 *   Die Aggregate der Elternzeilen des Meldebilds sind stromaufwärts über die VOLLMENGE
 *   kumuliert (`kraefte/kraeftebild.ts`, `addKategorie`). Fiele hier eine Zeile weg,
 *   behielten die Eltern Zahlen über nicht mehr sichtbare Kinder — sie lügen still, und
 *   kein Test sieht es. Vorgefiltert wird stromaufwärts (`filtereKraefte`).
 */
```

---

## 8. Der Guard

**Datei:** `frontend/src/components/datensicht.guard.test.ts`. Bauform aus `katalogTabelle.guard.test.ts`, Kommentar-Stripper aus `theme/gate5.guard.test.ts` **kopiert, nicht importiert** (ein Import aus einer anderen `*.test.ts` registriert deren `describe`-Blöcke doppelt).

**Marken und Zusicherungen:**

*In `Datensicht.tsx` selbst:*
| Marke | Erwartung | Warum |
|---|---|---|
| `<KatalogTabelle` | **≥ 1** | **Die positive Marke ist die tragende.** Ohne sie besteht ein `Datensicht.tsx`, das ein rohes `<Table>` ohne `scroll` rendert, jede negative Prüfung — und nimmt allen Konsumenten still Scroll, stehende Kopfzeile und fixierte Kennungsspalte. |
| `<Table` | **0** | keine zweite Tabellenwahrheit |
| `scroll={{` | **0** | die Tabellenwahrheit bleibt bei `KatalogTabelle` |
| `<Card` | **0** | die Kartenform ist `Liste`, nicht `Card` (doppelter Rahmen + 20 `size="small"` aus den `*Karte.tsx`) |
| `size="small"` | **0** | E8 |
| `matchMedia` / `\buseBreakpoint\b` | **0** | Zugang bleibt `useViewport`; Selbstbeweis, `useViewport.guard.test.ts` prüft es ohnehin |
| `KARTEN-AUSNAHME`, `TRENNLINIE` | **≥ 1** (Anwesenheit) | E7 verlangt die schriftliche Begründung. Eine Anwesenheitsprüfung kann ihr eigenes Gate nicht auslösen — im Gegensatz zu einer Verbotszählung. |

*Je Konsumentendatei (handgepflegtes Inventar mit `toHaveLength(n)`):*
| Marke | Erwartung |
|---|---|
| `<Datensicht` | ≥ 1 |
| `<Table` | 0 |
| `spaltenFuer` | ≥ 1 (schließt das `const K`-Widening) |
| `scroll={{`, `sorter:`, `filters:`, `responsive:` | 0 |

*Zwei getrennte Inventare, weil eine Marke allein nicht trägt:* eine Datei mit `form="karte"` bleibt bei `<Table` = 0 grün, **auch wenn sie eine Tabelle rendert** — das `<Table` liegt in `KatalogTabelle.tsx`. Deshalb hat die `form="karte"`-Liste (`auftraege/BefehlListe.tsx`, `pages/LageberichtePage.tsx`) die zusätzliche Zusicherung, das Literal `form="karte"` zu enthalten, und die `form="tabelle"`-Liste (`pages/KraefteuebersichtPage.tsx`) das Literal `form="tabelle"`.

*`KARTEN_EIGENBAU`:* Inventar der `art: 'eigen'`-Nutzer, am Tag 1 **leer** mit `toHaveLength(0)`. Jedes `art: 'eigen'` außerhalb ist rot.

**Wie er verhindert, dass er seine eigene Prosa zählt** — dreifach, weil zweifach im Vorläuferpaket zweimal gerissen ist:
1. **Kommentar-Stripper mit Blockzustand über Zeilengrenzen** vor jeder Zählung, plus ein Selbstbeweistest, der belegt, dass `// <Table und scroll={{ x }} im Kommentar` genau **0** Treffer liefert.
2. **Die verbotenen Marken stehen in den gescannten Dateien nirgends als Prosa.** Der Dateikopf von `Datensicht.tsx` oben umschreibt sie durchgehend („kein Scroll-Prop", „die Kartenform ist `Liste`, nicht `Card`") statt sie zu zitieren. Wer den Kopf ergänzt, darf keine Marke ausschreiben.
3. **Der Guard scannt sich selbst nicht.** Testdateien sind aus allen Inventaren ausgenommen, wie in `useViewport.guard.test.ts`.

**Was der Guard nicht sieht — als Liste im Kopfkommentar, Teil des Vertrags:** die Anwesenheit einer Spalte hinter einem Slot-Schlüssel (das kann nur `pruefeKartenplan` zur Laufzeit und `tsc` bei intaktem `const K`), einen 17. Konsumenten, der gar nichts von `Datensicht` weiß, und jede Aussage über Layout.

**Was nicht in Vitest gehört** (`css: false`, jsdom rechnet kein Layout):
- `frontend/e2e/gate1-ueberlauf.spec.ts` um drei Routen erweitern (Kräfteübersicht, Personal, Befehle-Tab), je mit **seiteneigenem** Anker und dem etablierten Maß `documentElement.scrollWidth - clientWidth` mit 1-px-Toleranz — nicht die viermal begründet verworfene `body.scrollWidth <= innerWidth`-Formel.
- Neu `frontend/e2e/datensicht-schmal.spec.ts` bei 390 × 844 (`test.use`, kein Device-Descriptor): kein `.ant-table` auf der Personalseite, Gegenprobe bei 1366; Trefffläche von **Titel-Link, Aktionsknopf und Spaltenschalter** ≥ 48 px über das kopierte `haeltTreffflaeche` mit 0,5-px-Subpixeltoleranz; `toHaveCount(1)` vor jeder Zusicherung.
- **Der eine Nachweis, der nur im Browser geht:** `fixed: 'left'` × Aufklapp-Icon im Meldebild-Baum, und der Druckpfad der Kräfteübersicht durch den `overflow`-Container von `KatalogTabelle` (`kraefteuebersichtPrint.css` arbeitet über `visibility` und neutralisiert weder Scrollcontainer noch Sticky-Holder). **Beide sind Lieferbedingung, nicht Nachlauf** — bis sie grün sind, ist `form="tabelle"` auf dem Meldebild nicht belegt.
- **Z13** als eigener Tabulatordurchlauf hinter stehender Kopfzeile und fixierter Spalte. Neubau ohne Vorbild: `press`/`keyboard` trifft in `frontend/e2e/` nur `command-palette.spec.ts`.

**Zwei Bestands-Stolpersteine, vorher zu räumen:** `KraefteuebersichtPage.test.tsx` und `BefehlListe.test.tsx` rendern ohne `ConfigProvider` (rohes `render` statt `renderMitProviders`) — ein Zweigtest ist dort nicht erreichbar. `PersonalPage.test.tsx:125` greift `.ant-select-clear` als **ersten** Treffer in Dokumentordnung; jedes `allowClear`-Feld in der neuen Werkzeugzeile schiebt sich davor.

---

## 9. Was diese Entscheidung NICHT löst

### Nicht erfüllbare Anforderungen des Tasks — ausdrücklich

1. **Akzeptanzkriterium „`grep -rnE "sorter|filters:|Input.Search"` ≥ 1 Treffer je Datei" über 17 Dateien ist mit dieser API unerfüllbar** und muss umformuliert werden. Sortierung, Filter und Suche liegen im Primitiv; `sorter`/`filters` sind am Spaltentyp amputiert, das Suchfeld steht einmal in `Datensicht.tsx`. Ersatzkriterium: `suche={{` bzw. `filter: {` bzw. `sortWert:` je Datei ≥ 1.
2. **Akzeptanzkriterium `grep -c "<Table" BefehlListe.tsx = 0` ist ein Gate, das nicht fallen kann** — nach dem Umbau liegt das `<Table` in `KatalogTabelle.tsx`. Ersetzt durch die `form="karte"`-Anwesenheitsprüfung (§8).
3. **`EinsatzMaterialAnzeige` hat kein `status_kategorie`** (verifiziert, 15 Felder) — MaterialPage gruppiert nach `status`/`kategorie`, nicht nach verfügbar/gebunden/nicht verfügbar. **`TierAnzeige` hat kein `aktuelle_sichtung_at`** (25 Felder) — „seit" kommt aus `erfasst_at`, keine Dringlichkeitssortierung. **`MitgliedAnzeige` hat 5 Felder** — `MitgliederAbschnitt` bekommt nur den Überlaufschutz, keine `Datensicht`. (= E3, hier bestätigt.)
4. **Der Sortier- und Filterzustand ist nicht deeplinkbar.** Kein `?sort=`, kein `?filter=`. Das Deeplink-Muster des Repos reserviert Query-Params für Selektion. → eigenes Ticket.
5. **Der Spaltenzustand überlebt keine Navigation** (§4, mit Begründung). → eigenes Ticket, gemeinsam mit einer Sicht-Registry nach dem Muster von `api/queryKeys.ts`.
6. **In-Zeile-Bedienung fehlt im Kartenzweig.** Die zwei `Select` von PersonalPage (Position, Status), FahrzeugePages Status-`Select`, MaterialPages `MengeZelle` und die inline editierbaren Bemerkungen haben in einer Karte keine Entsprechung; unter `md` sind diese Module **lesend plus eine Primäraktion**. Für Personal und Fahrzeuge gibt es keine Detailroute, auf die man das verlagern könnte (`personalPfad`/`fahrzeugePfad` sind Query-Param-Selektionen auf dieselbe Listenseite) — der Verlust ist real. → **B5 (LFH-333)** holt den Statuswechsel ohnehin aus der 24-px-Zelle in einen Quick-View (`H19`); dann ist es ein Auslöser, der in den Aktionsslot passt.
7. **Die Kartenfarbe des Fahrzeug-/Personalstatus weicht von der Tabelle ab**, wenn der Mandant `status_farbe` gepflegt hat: das ist ungeprüfter Freitext außerhalb des A2-Vertrags, die Karte fällt auf die Vertragsachse zurück. Der **Text** ist in beiden Zweigen identisch (Mandantenlabel). → das in `theme/statusFarben.ts` bereits vermerkte Folgeticket „`status_farbe` gegen die Rollen validieren".
8. **`gruppen` im Tabellenzweig liefert keine Gruppen-Kopfzeilen**, sondern eine führende Sortierachse plus Zählerstreifen in der Werkzeugzeile (§5). Synthetische Gruppenzeilen mit `colSpan` in einer Tabelle, die Spalte 0 unbedingt fixiert, wären dieselbe Familie ungeprüfter antd-Interaktion, die für das Meldebild gerade vermieden wird. → eigenes Ticket, wenn ein Browsernachweis vorliegt.
9. **Das Doku-Paket der Task** (Listenform-Regel in `docs/superpowers/specs/2026-06-22-drawer-nutzung-reduzieren-design.md`) ist von keinem Arbeitspaket besetzt; die CLAUDE.md-Hälfte steht seit A1 schon drin. → gehört in LFH-330, nicht in eine Folge.
10. **Fünf der 16 `<Table`-Dateien** (BereitstellungsraeumePage, UnfallhilfsstellenPage, SchaedenPage, PersonenDetailPage-Audit, LageberichtePage) sind Teil von E4, aber keine `Datensicht`-Konsumenten — sie bekommen nur den Tausch auf `KatalogTabelle`. Ihr Guard-Ort ist das 13er-Inventar von `katalogTabelle.guard.test.ts`, das damit auf 18 wächst und **einen benannten Eigentümer braucht** (drei Pakete wollen dieselbe Liste anfassen).
11. **Eine Zeile, die verschwindet, während sie den Fokus hält, nimmt den Fokus mit.** Die Zeilenschleuse hält neue Zeilen zurück, aber eine gelöschte kann sie nicht rendern. → Z13-nah, **B7 (LFH-335)**.

### Prüfliste Einsatztauglichkeit — 15 Zeilen, je ein Verdikt (Gate 7)

| # | Kriterium | Verdikt |
|---|---|---|
| 1 | Treffläche ≥ 24/48 px | **erfüllt** — Titel-Link, Aktionsknopf, Spaltenschalter, Sortierauslöser über `controlHeight`; Nachweis `datensicht-schmal.spec.ts` mit `haeltTreffflaeche` |
| 2 | Handschuh ≥ 72 px | **offen → B5 (LFH-333)** — kein `size`-Prop, Höhen hängen am Dichte-Token; die Staffel selbst kommt dort |
| 3 | Rückmeldung ≤ 100 ms / ≤ 2 s | **offen → B3 (LFH-331)** — Lade-/Fehlerweiche; `ladend` ist heute ein zweiter Weg neben `query.isPending` |
| 4 | Kritische Aktion, zweite Handlung | **erfüllt** — `PrimaerAktion.bestaetigung`; die drei „Entfernen" behalten ihr `Popconfirm`, ohne `danger` |
| 5 | Kontrast in beiden Modi | **erfüllt** — Sortierindikator, Filtermarker, Gruppenkopf, Banner nur über `rollenFarbe`/antd-Token; Nachweis nach dem Muster `nav-schmal.spec.ts` |
| 6 | Kein Status allein über Farbe | **erfüllt im Primitiv** (`StatusDarstellung.label` ist Pflichtfeld) · **offen für `personen/personMeta.ts`, `TierePage`, `MaterialPage` → B5/Folgeticket** (antd-Farbnamen, A2 verbietet den Sweep) |
| 7 | Eine Farbe = eine Bedeutung | **teilweise erfüllt** — Vertragsachse ja; **offen**: in `personenSpalten` bedeutet `red` in der Statusspalte „verstorben" und in der SK-Spalte „SK I" → **Folgeticket** „modul-lokale Farbmaps in den A2-Vertrag" |
| 8 | Helligkeits-/Kontrastregler | **nicht anwendbar → Folge-Task** (wie beide B1-Prüflisten) |
| 9 | Kritische Anzeigen im Blickfeld | **nicht anwendbar** für Listen; das Sammelbanner steht am Kopf der Fläche, nicht am Layoutrand |
| 10 | Alarmbudget | **nicht anwendbar** — `Datensicht` löst keine Alarme aus |
| 11 | Warnverhalten | **nicht anwendbar** — kein Blinken, kein Ton |
| 12 | Kein Sprung unter dem Cursor | **erfüllt** — Zeilenschleuse + Sammelbanner + stets gerenderte Werkzeugzeile; Banner-Gestaltung und „Stand hh:mm" → **B6 (LFH-334)** |
| 13 | Fokus nie verdeckt | **offen → B2, mit Nachweis in diesem Paket** — Tabulatordurchlauf hinter `sticky`-Kopf und `fixed:'left'`-Spalte, Neubau in `datensicht-schmal.spec.ts`. Die Drawer-Hälfte derselben Zeile bleibt **B7 (LFH-335)** |
| 14 | Tabellenseite vollständig | **erfüllt im Tabellenzweig** (fixierte Kopfzeile + fixierte menschenlesbare Kennung aus `KatalogTabelle`, Spaltenschalter mit Zähler aus `Datensicht`, keine Auflösung von Vergleichsflächen in Karten — deshalb `form="tabelle"` am Meldebild) · **nicht anwendbar im Kartenzweig** (keine Spalten) · **unverändert nicht anwendbar** für die 13 Katalogtabellen (max. 7 Spalten, kein Adressat) |
| 15 | Erfassungsmaske vollständig | **nicht anwendbar** — `Datensicht` zeigt, es erfasst nicht |
