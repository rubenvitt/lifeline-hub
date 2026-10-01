import { theme as antdTheme, type ConfigProviderProps, type ThemeConfig } from 'antd';
import type { MappingAlgorithm } from 'antd';

/** Fachliche Sichtungskennzeichnung nach BBK (SK I–IV, EX), unabhängig von A0-Statusrollen
 * (LFH-455). Die Farbfelder behalten nachts ihren Farbton (insbesondere schwarz); Umrandung und
 * Beschriftung lesen die Textfarbe des aktiven Modus. Nur TSX konsumiert diese Palette;
 * unverletzt hat keine eigene Farbe. */
export const sichtungsfarben = {
  rot: '#f5222d',
  gelb: '#fadb14',
  gruen: '#52c41a',
  blau: '#1677ff',
  schwarz: '#000000',
} as const;

/**
 * Gestaltungssprache (LFH-352) in der Fassung des Neuentwurfs „Instrumententafel“.
 * Grundlage: `docs/superpowers/specs/2026-07-25-gestaltungssprache.md` und
 * `docs/design/2026-09-21-neuentwurf/umsetzung.md`; Abweichungen stehen mit Messwert an den
 * Werten (`farbenDunkel`).
 *
 * DIESE DATEI IST DIE TS-SEITE DER WAHRHEIT, die CSS-Seite steht als statische Custom
 * Properties in `rollen.css`; `rollen.guard.test.ts` hält beide deckungsgleich. antds
 * `--ant-*`-Variablen taugen nicht als Quelle: die meisten Rollen kennt antd nicht, und die
 * Namen gehören der Bibliothek.
 *
 * ROT BEDIENT NICHTS. `bedien` ist blau, `marke` ist rot, `alarm` ist rot in anderer Sättigung.
 */

/** Farbrollen eines Modus. Namen sind Rollen, nicht Farben. Jede Rolle existiert in BEIDEN
 *  Modi; was nur nachts gebraucht würde, wäre keine Rolle, sondern eine Ausnahme. */
export interface Farbrollen {
  grund: string;
  flaeche: string;
  flaeche2: string;
  linie: string;
  /** Kräftigere Haarlinie: Paneelkanten, Umrandung sekundärer Knöpfe. DEKORATIV; der Rahmen
   *  eines Steuerelements ist {@link Farbrollen.steuerRahmen}. */
  linieStark: string;
  rasterLinie: string;
  text: string;
  gedaempft: string;
  schwach: string;
  bedien: string;
  alarm: string;
  achtung: string;
  normal: string;
  marke: string;
  markeGlut: string;
  alarmFuellung: string;
  /** Zweite Intensität derselben Rolle, die obere Hälfte einer Flächenskala. KEIN neuer
   *  Farbton: `alarm` in stärkerer Füllung. */
  alarmFuellungStark: string;
  achtungFuellung: string;
  /** Zweite Intensität von `achtung` — Gegenstück zu {@link Farbrollen.alarmFuellungStark}. */
  achtungFuellungStark: string;
  normalFuellung: string;

  /** Kopfbänder IM INHALT: Tabellenkopf, Erfassungsleiste. Kommandoleiste und Rail lesen
   *  {@link rahmenFarben}, sie bleiben in beiden Modi dunkel. */
  kopf: string;
  /** Modulpanel, Seitenleisten, Kachel-Paneele — eine Stufe über `grund`. */
  paneel: string;
  /** Dritte Flächenstufe: aktive Zeile, leere Balkenspur, Zeilentrenner im Paneel. */
  flaeche3: string;
  /** Lauftext in Listen — zwischen `text` und `gedaempft`. */
  text2: string;
  /** Rahmen eines STEUERELEMENTS (antds `colorBorder`, Eingabefelder). Eigene Rolle,
   *  weil `linieStark` des Entwurfs WCAG 1.4.11 (≥ 3 : 1) nicht trägt — Messwerte am Wert. */
  steuerRahmen: string;
  /** Bedienfarbe unter dem Zeiger (antds `colorPrimaryHover`). */
  bedienHover: string;
  /** Text in Bedienfarbe AUF einer getönten Bedienfläche (`bedienFlaeche`, Sammelbanner). */
  bedienText: string;
  /** Vordergrund AUF einer satt gefüllten Bedien- oder Alarmfläche (Primär-/Gefahrknopf). */
  aufBedien: string;
  /** Text in Normalfarbe — nachts heller als die Füllfarbe `normal`, damit Zahl und Wort lesbar bleiben. */
  normalText: string;
  /** Text in Achtungsfarbe (Statuszahl, Hinweiswort). Am Tag dunkler als `achtung`, weil die
   *  Füllfarbe als Text den Tagesboden 7 : 1 nicht trägt; nachts gleich `achtung`. */
  achtungText: string;
  /** Text in Alarmfarbe — Gegenstück zu {@link Farbrollen.achtungText}. */
  alarmText: string;
  /** Deckende Statusflächen: „Ampel als Fläche, Zahl bleibt lesbar" (Statuszelle/-Chip). */
  normalFlaeche: string;
  achtungFlaeche: string;
  alarmFlaeche: string;
  bedienFlaeche: string;
  /** Sammelbanner („12 neue Meldungen"): Grund und Kante. */
  bannerGrund: string;
  bannerLinie: string;
  /** Zeilentönungen der Zeitachse: Berichtigung, Lücke, Problem. */
  berichtigungZeile: string;
  lueckeZeile: string;
  problemZeile: string;
}

/**
 * Tagmodus, aus der Nachtpalette ABGELEITET. Statusrollen und die Füllungen behalten ihre
 * LFH-352-Werte; neu gestimmt sind Flächen- und Textstufen und `bedien`/`bedienHover`.
 *
 * Kontrast (WCAG; `grund` · `flaeche`): text 15,46 · 18,47 — text2 11,00 · 13,13 —
 * gedaempft 7,05 · 8,42 — schwach 5,33 · 6,37; steuerRahmen 3,30 · 3,95; normalText/
 * normalFlaeche 7,87, bedienText/bedienFlaeche 7,11.
 *
 * Primärknopf (LFH-661, Spec `farbrollen-kontrast`): die Beschriftung auf satter Bedienfläche
 * hält den TAGESBODEN 7 : 1, in Ruhe und unter dem Zeiger — KEIN eigener Knopfboden. Die
 * Knopfschrift misst 13,5 px, der große Anmelde-Knopf 16 px; WCAGs Großtext-Boden 4,5 gilt fett
 * erst ab 18,66 px. Weiß auf bedien 8,55 (vorher `#1a5fa0`, 6,59), auf bedienHover 7,32 (vorher
 * `#236aad`, 5,62): gleicher Ton und gleiche Sättigung, nur dunkler; der Zeiger hellt um
 * denselben Schritt auf wie zuvor (1,17). bedien auf grund 7,16. Gerechnet in
 * `bedienKontrast.test.ts`, gemessen in `e2e/primaerknopf-kontrast.spec.ts`.
 *
 * `achtung`/`alarm` tragen als TEXT den Tagesboden nicht (auf ihrer Fläche 6,02 bzw. 5,52),
 * dafür stehen `achtungText`/`alarmText` (auf Weiß 9,22 bzw. 8,96, auf ihren Flächen und
 * Zeilentönungen ≥ 7,31, auf grund 7,72 bzw. 7,51). Die Füllfarben bleiben für Kante, Punkt
 * und Balken.
 *
 * Geerbter Text (LFH-652, `antdToken`): `bedienText` als Link auf grund 7,04 · flaeche 8,41 ·
 * kopf 7,36 · paneel 7,71; `gedaempft` als Beschreibung und Tabellenkopf auf kopf 7,37. Auf der
 * Hervorhebungsfläche `flaeche3` liegen beide bei 6,59 bzw. 6,60, unter dem Tagesboden (LFH-877).
 */
export const farbenHell: Farbrollen = {
  grund: '#e9ebee',
  flaeche: '#ffffff',
  flaeche2: '#f5f6f8',
  linie: '#d4d8dd',
  linieStark: '#b9bfc6',
  rasterLinie: 'rgba(26, 95, 160, 0.07)',
  text: '#111418',
  gedaempft: '#474e57',
  schwach: '#58606a',
  bedien: '#154e84',
  alarm: '#b02318',
  achtung: '#7a5200',
  normal: '#1c6640',
  marke: '#a8071a',
  markeGlut: '0 0 10px 0 rgba(168, 7, 26, 0.3)',
  alarmFuellung: 'rgba(176, 35, 24, 0.07)',
  alarmFuellungStark: 'rgba(176, 35, 24, 0.2)',
  achtungFuellung: 'rgba(122, 82, 0, 0.08)',
  achtungFuellungStark: 'rgba(122, 82, 0, 0.2)',
  normalFuellung: 'rgba(28, 102, 64, 0.07)',
  kopf: '#eef0f2',
  paneel: '#f4f5f7',
  flaeche3: '#e1e4e8',
  text2: '#2b3138',
  steuerRahmen: '#79818a',
  bedienHover: '#185895',
  bedienText: '#164f86',
  aufBedien: '#ffffff',
  normalText: '#155234',
  achtungText: '#604200',
  alarmText: '#8f1c12',
  normalFlaeche: '#e3f1e8',
  achtungFlaeche: '#f7efd5',
  alarmFlaeche: '#f9e3e3',
  bedienFlaeche: '#e4edf7',
  bannerGrund: '#e6eef8',
  bannerLinie: '#9dbbe0',
  berichtigungZeile: '#fbeaea',
  lueckeZeile: '#faf3da',
  problemZeile: '#f8eded',
};

/**
 * Nachtbetrieb, die Vorgabe (`ThemeModeProvider`); Werte aus den Inline-Styles des
 * Neuentwurfs.
 *
 * Kontrast (WCAG; `grund` · `flaeche` · `flaeche2`): text 16,65 · 15,70 · 15,02 — text2 12,30 ·
 * 11,60 · 11,10 — gedaempft 7,71 · 7,27 · 6,96 — bedien 6,19 · 5,84 · 5,58 — alarm 7,18 · 6,77 ·
 * 6,48 — achtung 12,45 · 11,75 · 11,24 — normal 8,79 · 8,29 · 7,94 — aufBedien auf bedien 6,19,
 * auf alarm 7,18. Statusflächen: normalText 10,44, achtung 11,18, alarm 6,89, bedienText 9,65.
 * Geerbter Text (LFH-652): `bedienText` als Link ≥ 9,34 auf allen Flächenstufen, `gedaempft` als
 * Tabellenkopf auf kopf 7,48.
 *
 * Zwei bewusste Abweichungen vom Entwurf:
 * - `schwach` `#7d858e` statt `#5f676f` (3,47 auf `grund`): die Rolle trägt über antds
 *   `colorTextTertiary`/`colorTextPlaceholder` echten Text und 10-px-Augenbrauen (WCAG 1.4.3);
 *   `colorTextDescription` liest seit LFH-652 `gedaempft`.
 *   `#7d858e` hält ≥ 4,72 auf allen Flächenstufen.
 * - `steuerRahmen` `#626a73` trägt antds `colorBorder`, nicht `linieStark` (`#2e343a`, 1,49 auf
 *   `flaeche`). `#626a73` hält ≥ 3,21 auf allen Flächenstufen (WCAG 1.4.11).
 *
 * `marke` `#a8071a` liegt bei 2,57 : 1 auf `grund`: trägt als Dekoration (Logo, Rail-Marke),
 * nicht als Textfarbe.
 */
export const farbenDunkel: Farbrollen = {
  grund: '#08090b',
  flaeche: '#0f1215',
  flaeche2: '#14171b',
  linie: '#22262b',
  linieStark: '#2e343a',
  rasterLinie: 'rgba(77, 148, 214, 0.055)',
  text: '#e8ebee',
  gedaempft: '#9aa2ab',
  schwach: '#7d858e',
  bedien: '#4d94d6',
  alarm: '#ff6b6b',
  achtung: '#e8cc3a',
  normal: '#52c41a',
  marke: '#a8071a',
  markeGlut: '0 0 12px 0 rgba(168, 7, 26, 0.55)',
  alarmFuellung: 'rgba(255, 107, 107, 0.1)',
  alarmFuellungStark: 'rgba(255, 107, 107, 0.24)',
  achtungFuellung: 'rgba(232, 204, 58, 0.1)',
  achtungFuellungStark: 'rgba(232, 204, 58, 0.24)',
  normalFuellung: 'rgba(82, 196, 26, 0.1)',
  kopf: '#0c0e11',
  paneel: '#0a0c0e',
  flaeche3: '#16191d',
  text2: '#c6ccd2',
  steuerRahmen: '#626a73',
  bedienHover: '#7db3e8',
  bedienText: '#8ec2f0',
  aufBedien: '#08090b',
  normalText: '#7ddc4a',
  achtungText: '#e8cc3a',
  alarmText: '#ff6b6b',
  normalFlaeche: '#0d1a0a',
  achtungFlaeche: '#1c1705',
  alarmFlaeche: '#1c0a0d',
  bedienFlaeche: '#0d1620',
  bannerGrund: '#0d1520',
  bannerLinie: '#1d3a5c',
  berichtigungZeile: '#160d0f',
  lueckeZeile: '#161305',
  problemZeile: '#130f0f',
};

/**
 * Der RAHMEN (Kommandoleiste 52 px, Rail 60 px) bleibt in BEIDEN Modi dunkel. Deshalb eine
 * modusunabhängige Palette statt weiterer `Farbrollen`: dort müsste der Nachtblock sie
 * wertgleich doppeln, und diese Redundanz verbietet `rollen.guard.test.ts`. Die Werte zeigen
 * auf die Nachtpalette statt sie zu kopieren. Rot ist hier `marke` (aktive Rail-Kategorie) und
 * `alarm` (Störungswort der SYNC-Zelle).
 *
 * Kontrast (LFH-434): der Rahmen wird auch bei Tageslicht gelesen, deshalb hält bedienbarer Text
 * die TAG-Schwelle ≥ 7 : 1 auf jedem Rahmengrund (`grund` · `feld` · `aktiv`): text 16,15 ·
 * 15,02 · 14,74 — gedaempft 8,04 · 7,47 · 7,33. Eine schwächere Textstufe gibt es im Rahmen nur
 * für Gesperrtes: `gesperrt` 5,17 auf `grund` (Boden 4,5; WCAG 1.4.3 nimmt inaktive Komponenten
 * aus), die Sperre trägt zusätzlich ein Zeichen ohne Farbe. Gerechnet in `rahmenKontrast.test.ts`.
 */
export const rahmenFarben = {
  grund: farbenDunkel.kopf,
  /** Aktive Rail-Kategorie. */
  aktiv: farbenDunkel.flaeche3,
  /** Suchfeld in der Kommandoleiste. */
  feld: farbenDunkel.flaeche2,
  linie: farbenDunkel.linie,
  text: farbenDunkel.text,
  /**
   * Zweite Textstufe: Uhr, Menüs, Suchfeld-Hinweis, inaktive Rail-Etiketten. Eigener Wert statt
   * `farbenDunkel.gedaempft` (`#9aa2ab`, 6,96 auf `feld`): der hielte im Suchfeld die
   * Tag-Schwelle nicht (LFH-434).
   */
  gedaempft: '#a0a8b1',
  /** NUR für gesperrte Einträge, nie für bedienbaren Text (LFH-434). */
  gesperrt: farbenDunkel.schwach,
  /**
   * Störungswort (GETRENNT/OFFLINE/PRÜFEN). Eigener Wert statt `farbenDunkel.alarm` (`#ff6b6b`,
   * 6,96 auf `grund`): hier 7,18 (LFH-434).
   */
  alarm: '#ff7070',
  marke: farbenDunkel.marke,
} as const;

/**
 * ETB-Typfarben: Meldung blau, Anordnung orange, Entscheidung violett, Lage cyan, Berichtigung
 * rot, System neutral, als farbige KANTE (2 px) plus TYPWORT, nicht als Etikett.
 *
 * Zwei Werte je Typ, weil Kante (Dekoration) und Wort (Text) verschiedene Böden haben. Nachts
 * trägt die Kante den Entwurfswert, das Wort ist aufgehellt (auf `flaeche2` ≥ 5,90). Am Tag sind
 * die Wörter ≥ 7 : 1 auf `grund` gerechnet, denn dort steht die Zeitachse, nicht auf Weiß; die
 * Kanten ≥ 3 : 1. Nachts liegt die Entscheidungskante bei 2,87 : 1, das Typwort trägt die
 * Aussage. `system` zeigt auf die Textstufen. Gleiche Hexwerte wie in anderen Paletten sind
 * keine Kopplung.
 */
export type EtbTypTon =
  'meldung' | 'anordnung' | 'entscheidung' | 'lage' | 'berichtigung' | 'system';

export interface EtbTypFarbe {
  /** Die 2-px-Typkante. */
  kante: string;
  /** Das Typwort (Mono, Versalien). */
  wort: string;
}

export const etbTypFarbenDunkel: Record<EtbTypTon, EtbTypFarbe> = {
  meldung: { kante: '#1677ff', wort: '#5c9dff' },
  anordnung: { kante: '#d46b08', wort: '#e8852a' },
  entscheidung: { kante: '#722ed1', wort: '#a57ff0' },
  lage: { kante: '#13c2c2', wort: '#13c2c2' },
  berichtigung: { kante: '#cf1322', wort: farbenDunkel.alarm },
  system: { kante: farbenDunkel.schwach, wort: farbenDunkel.gedaempft },
};

export const etbTypFarbenHell: Record<EtbTypTon, EtbTypFarbe> = {
  meldung: { kante: '#1677ff', wort: '#0a47a6' },
  anordnung: { kante: '#b35600', wort: '#7a3700' },
  entscheidung: { kante: '#722ed1', wort: '#5b1fae' },
  lage: { kante: '#0e8c90', wort: '#005357' },
  berichtigung: { kante: '#cf1322', wort: farbenHell.alarmText },
  system: { kante: farbenHell.schwach, wort: farbenHell.gedaempft },
};

/**
 * Warnstufen-Balken der Gefahrenmatrix: eine BALKENFARBE, keine Fläche (die bleibt
 * {@link Farbrollen.alarmFuellung} & Co.). `keine` hat keinen Balken; der zweite Kanal liegt
 * beim Konsumenten (Wort/Kürzel).
 *
 * Nachts die Entwurfswerte; `akut` (= `marke`) liegt mit 2,57 : 1 unter `hoch`, der Balken ist
 * Dekoration neben Wort/Kürzel. Am Tag sind `niedrig`/`mittel` abgedunkelt, damit der Balken
 * auf hellem Grund nicht verschwindet.
 */
export type WarnstufeBalken = 'niedrig' | 'mittel' | 'hoch' | 'akut';

export const warnstufeFarbenDunkel: Record<WarnstufeBalken, string> = {
  niedrig: '#d4b106',
  mittel: '#d46b08',
  hoch: '#cf1322',
  akut: '#a8071a',
};

export const warnstufeFarbenHell: Record<WarnstufeBalken, string> = {
  niedrig: '#9e7f00',
  mittel: '#b35600',
  hoch: '#cf1322',
  akut: '#a8071a',
};

/**
 * Ebenenfarbe der Fachebenen (LFH-593): eine IDENTITÄT („dieser Punkt gehört zur Ebene X“), keine
 * Statusrolle — Kartenpunkt, Panel-Quadrat und Inspector-Akzent. Der zweite Kanal ist der
 * Ebenenname im Panel und der Titel im Inspector.
 *
 * Tag: die Bestandstöne, unverändert (überwiegend Stufe 7 der antd-Presetpalette). Nacht: dieselben
 * Farbtöne auf Stufe 5 aufgehellt; die Tagtöne fielen auf dem dunklen Leistengrund zum Teil unter
 * 3 : 1 (KRITIS 1,79). Nachts hält jeder Ton ≥ 3,8 : 1 auf `paneel` bis `flaeche3`, und kein Paar
 * steht enger als das engste am Tag (ΔE 25,2) — gerechnet in `statusFarben.test.ts`.
 *
 * Bewusst nicht grün (`normal`, SK III): ein grüner Punkt läse sich als „in Ordnung“. Luftqualität
 * ist entsättigt, weil ihre Stationen die Rollenfarbe je Indexstufe tragen. Hochwasser, ODL und
 * Luftqualität färben auf der Karte ohnehin je Feature; ihr Ton ist dort nur Rückfall.
 * `FachebeneTon` spiegelt `FachebeneQuelle`, damit diese Datei keine API-Typen zieht (wie
 * {@link EtbTypTon}); die Abbildung steht exhaustiv in `statusFarben.ts`.
 */
export type FachebeneTon =
  | 'nina'
  | 'dwd'
  | 'pegelonline'
  | 'hochwasser'
  | 'luftqualitaet'
  | 'odl'
  | 'autobahn'
  | 'kritis'
  | 'energie';

export const fachebeneFarbenHell: Record<FachebeneTon, string> = {
  nina: '#cf1322',
  dwd: '#d48806',
  pegelonline: '#096dd9',
  // Nicht das Blau von `pegelonline`: beide stehen im Panel nebeneinander.
  hochwasser: '#08979c',
  luftqualitaet: '#5b6b82',
  odl: '#7cb305',
  autobahn: '#c41d7f',
  kritis: '#531dab',
  // Gelb liegt nah am DWD-Gold, ist aber unterscheidbar und war die letzte freie Tonlücke (LFH-81).
  energie: '#d4b106',
};

export const fachebeneFarbenDunkel: Record<FachebeneTon, string> = {
  nina: '#ff4d4f',
  dwd: '#ffa940',
  pegelonline: '#4096ff',
  hochwasser: '#36cfc9',
  luftqualitaet: '#8c9bb3',
  odl: '#a0d911',
  autobahn: '#f759ab',
  kritis: '#9254de',
  energie: '#fadb14',
};

/** Abstandsraster einer Dichtestufe. Komponenten importieren diese Werte, statt Pixel zu
 *  erfinden. */
export interface Abstandsraster {
  xs: number;
  sm: number;
  md: number;
  lg: number;
}

/** Bediendichte nach A1 Festlegung 4. `kompakt` ist der Fükw und die ortsfeste
 *  Stelle, `komfortabel` das Führungs-Tablet und mobil, `handschuh` der Betrieb
 *  mit Einsatzhandschuh (72 px ≙ 19,05 mm, MIL-STD-1472F Fig. 12). */
export type Dichte = 'kompakt' | 'komfortabel' | 'handschuh';

interface Dichtestufe {
  /** `controlHeight` — trägt die Treffläche für alle Steuerelemente auf einmal. */
  zeilenhoehe: number;
  /**
   * `controlHeightSM`: die Höhe, die antd allen „kleinen“ Steuerelementen gibt. Steht hier, weil
   * antd sie sonst mit Faktor 0,75 ableitet und unter den Boden aus A1 Gate 3 fällt (siehe
   * {@link dichten}).
   */
  kleineZeilenhoehe: number;
  schriftgroesse: number;
  abstand: Abstandsraster;
}

/**
 * Die Staffel, Werte aus A1 Festlegung 4. `antdToken()` nimmt die Stufe als Parameter,
 * `rollen.css` spiegelt sie als `[data-dichte='…']`. `componentSize` scheidet als Träger aus:
 * dessen `large` endet bei 40 px. Die Grundschrift steigt nur einmal (13,5 → 15): der Handschuh
 * ändert die Hand, nicht das Auge.
 *
 * `kleineZeilenhoehe` steht hier statt abgeleitet zu werden: antd rechnet
 * `controlHeightSM = controlHeight × 0,75` (22,5 / 36 / 54) und unterschritte damit in jeder
 * Stufe den Boden aus Gate 3 (24 / 48 / 72). In `komfortabel` und `handschuh` fällt die kleine
 * Höhe deshalb mit der vollen zusammen: dort gibt es keine kleine Fläche. `controlHeightXS`/`LG`
 * bleiben abgeleitet, sie tragen keine Trefflächen-Aussage.
 */
export const dichten: Record<Dichte, Dichtestufe> = {
  kompakt: {
    zeilenhoehe: 30,
    kleineZeilenhoehe: 24,
    schriftgroesse: 13.5,
    // md/lg stehen so in A1; xs/sm sind [abgeleitet] (× 1,6 / × 2,4 der md-Stufe, gerundet).
    abstand: { xs: 3, sm: 7, md: 11, lg: 18 },
  },
  komfortabel: {
    zeilenhoehe: 48,
    kleineZeilenhoehe: 48,
    schriftgroesse: 15,
    // xs/sm [abgeleitet] nach demselben Faktor wie kompakt.
    abstand: { xs: 5, sm: 11, md: 18, lg: 28 },
  },
  handschuh: {
    zeilenhoehe: 72,
    kleineZeilenhoehe: 72,
    schriftgroesse: 15,
    // xs/sm [abgeleitet] nach demselben Faktor wie kompakt.
    abstand: { xs: 7, sm: 16, md: 26, lg: 44 },
  },
};

/** Das Abstandsraster der kompakten Stufe, für Konsumenten ohne Dichte. */
export const abstand: Abstandsraster = dichten.kompakt.abstand;

/**
 * Wiederkehrende Flächen- und Breitenmaße statt verstreuter Inline-Pixel. Norm für Neues und
 * ohnehin Angefasstes. Bewusst kein antd-Token: antd kennt weder Seitenbreite noch die Höhe
 * einer Ladefläche.
 */
export const flaeche = {
  /**
   * Lesebreite einer reinen Formular-/Editorseite (`breite="schmal"` an `EinsatzSeite` und
   * `AdminPage`). Listen, Übersichten und Zeitachsen füllen die ganze Inhaltsbreite.
   */
  seiteSchmal: 900,
  /** Abstand über einem Lade-/Fehlerzustand, damit er nicht am Kopf klebt. */
  zustandOben: 80,
  /** Mindestbreite einer Kachel im Kartenraster. */
  kachelMin: 260,
  /** …und die engere Variante für Nebenraster. */
  kachelMinKlein: 220,
} as const;

/**
 * Die Seitenrinne: der seitliche Rand einer Seite zum Fensterrand, `breit` am Fükw und am
 * Tablet, `schmal` auf dem Handschirm. Viewport-Achse, deshalb ein eigener Export und kein
 * Schlüssel in `flaeche` oder `dichten`.
 *
 * Wirksam wird sie als Custom-Property in `rollen.css` (Media-Regel an antds `md`-Schwelle), so
 * ist sie beim ersten Paint korrekt. `rollen.guard.test.ts` hält CSS- und TS-Seite gleich.
 */
export const seitenrinne = {
  /** Ab antds `md`-Schwelle (768 px) — Fükw, ortsfeste Stelle, Führungs-Tablet. */
  breit: 24,
  /** Darunter — mobil, ~390 px einhändig. */
  schmal: 12,
} as const;

/**
 * Breite des Navigations-Drawers, der den Einsatz-Rahmen unter antds `lg`-Schwelle ersetzt.
 * Viewport-Achse wie die Seitenrinne. Das Maß trägt, weil der Drawer ein flaches Akkordeon in
 * einer Spalte zeigt statt Rail plus Modulspalte.
 */
export const navDrawerBreite = 280;

/** Formrollen. Radius 0 ist eine Entscheidung: die Kachel trägt der Umrissrahmen, nicht eine
 *  weiche Ecke. `zeilenhoehe`/`schriftgroesse` sind Dichte und zeigen auf `dichten.kompakt`;
 *  wer eine Stufe braucht, liest `dichten`. */
export const form = {
  radiusFlaeche: 0,
  radiusSteuer: 0,
  radiusMarke: 0,
  zeilenhoehe: dichten.kompakt.zeilenhoehe,
  schriftgroesse: dichten.kompakt.schriftgroesse,
  versalSperrung: '2.2px',
  uebergang: '120ms cubic-bezier(0.2, 0.8, 0.2, 1)',
} as const;

/** Schriftrollen. Alle drei Familien werden lokal ausgeliefert (SIL OFL 1.1,
 *  `src/assets/fonts/`) — kein CDN, der Fükw arbeitet ohne Netz. */
export const schrift = {
  text: "'LFH Archivo', system-ui, -apple-system, sans-serif",
  display: "'LFH Archivo Narrow', 'LFH Archivo', system-ui, sans-serif",
  zahl: "'LFH JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
} as const;

/** Die Schriftfamilie einer Stufe — ein Schlüssel in {@link schrift}, kein Familienname. */
type Schriftfamilie = keyof typeof schrift;

interface Schriftstufe {
  /** px */
  groesse: number;
  gewicht: 400 | 500 | 600 | 700;
  familie: Schriftfamilie;
  /** `letter-spacing` als CSS-Wert. Nur wo der Entwurf ihn setzt. */
  sperrung?: string;
  /** Versalien (`text-transform: uppercase`). */
  versal?: boolean;
}

/**
 * Schriftskala des Neuentwurfs („Kontrastsprung statt Abstufung“, `umsetzung.md`).
 *
 * Ergänzt die Dichte-Achse: antds Grundschrift bleibt `dichten[…].schriftgroesse`, die Skala
 * benennt die Stufen darüber und daneben, die handgebaute Bausteine setzen. Zahlen, Zeiten,
 * Funkrufnamen, Koordinaten und Nummern laufen immer in `zahl` (Mono, `tabular-nums`).
 *
 * CSS-Seite: `--lfh-typo-<stufe>-{groesse,gewicht,sperrung}` in `rollen.css`, deckungsgleich
 * gehalten von `rollen.guard.test.ts`; die Familie ist `--lfh-schrift-<familie>`.
 */
export const schriftskala = {
  /** Große Überschrift (Einstiegsflächen). */
  ueberschrift: { groesse: 30, gewicht: 600, familie: 'text', sperrung: '-0.02em' },
  /** Seitenkopf: Titel 14/600. */
  seitentitel: { groesse: 14, gewicht: 600, familie: 'text' },
  /** Lauftext-Grundmaß des Entwurfs. */
  text: { groesse: 14, gewicht: 400, familie: 'text' },
  /** Dichter Lauftext in Listen und Paneelen. */
  textKlein: { groesse: 12, gewicht: 400, familie: 'text' },
  /** Augenbraue: 10 px, 600, Versalien, Sperrung .14em, Farbe `schwach`. */
  augenbraue: { groesse: 10, gewicht: 600, familie: 'text', sperrung: '0.14em', versal: true },
  /** Etikett unter der Rail-Ikone: 9 px Versalien. */
  railEtikett: { groesse: 9, gewicht: 500, familie: 'text', sperrung: '0.06em', versal: true },
  /** Mono-Meta: Zeiten, Nummern, Zähler neben Text. */
  meta: { groesse: 11, gewicht: 400, familie: 'zahl' },
  /** Datenwert in Paneelzeilen und Kennzahlenbändern. */
  datenwertKlein: { groesse: 22, gewicht: 500, familie: 'zahl', sperrung: '-0.02em' },
  /** Datenwert einer Kennzahl-Kachel. */
  datenwert: { groesse: 32, gewicht: 500, familie: 'zahl', sperrung: '-0.02em' },
  /** Führende Kennzahl („Zahl führt"). */
  datenwertGross: { groesse: 40, gewicht: 500, familie: 'zahl', sperrung: '-0.02em' },
} as const satisfies Record<string, Schriftstufe>;

export type Schriftstufenname = keyof typeof schriftskala;

/**
 * Der antd-Algorithmus eines Modus.
 *
 * Nachts läuft zuerst antds `darkAlgorithm` (leitet Hover-, Aktiv-, Füll- und Randstufen ab),
 * danach {@link seedTreu}. `darkAlgorithm` rechnet auch die SEED-Farben um, und die lassen sich
 * über `token` nicht überschreiben (antd löscht Seed-Schlüssel aus dem Override,
 * `theme/util/alias.js`); ohne `seedTreu` trüge die antd-Fläche eine andere Farbe als
 * `rollen.css` daneben.
 */
export function antdAlgorithmus(dunkel: boolean): MappingAlgorithm | MappingAlgorithm[] {
  return dunkel ? [antdTheme.darkAlgorithm, seedTreu] : antdTheme.defaultAlgorithm;
}

/** Zweite Stufe des Nacht-Algorithmus: die Signalfarben tragen genau ihren Rollenwert. `colorLink`
 *  gehört dazu, weil er Text ist: die dunkle Palette verdunkelte ihn auf 4,55 : 1 (LFH-652). */
const seedTreu: MappingAlgorithm = (seed, abgeleitet) => ({
  ...(abgeleitet ?? antdTheme.darkAlgorithm(seed)),
  colorPrimary: seed.colorPrimary,
  colorLink: seed.colorLink,
  colorInfo: seed.colorInfo,
  colorError: seed.colorError,
  colorWarning: seed.colorWarning,
  colorSuccess: seed.colorSuccess,
});

/** antds fester Innenabstand der Schalterspur (`switch/style/index.js`: „Fixed value"). */
const SWITCH_SPURPOLSTER = 2;

/**
 * Die Maße des Kippschalters aus der Dichte-Staffel (LFH-380).
 *
 * antd leitet den `Switch` aus der Schrift ab, nicht aus `controlHeight`: die Spur ist
 * `fontSize × lineHeight` = `fontSize + 8` (`antd/es/switch/style/index.js`), also 21,5 / 23 /
 * 23 px. Boden ist `kleineZeilenhoehe` (24 / 48 / 72), die kurze Achse aus Gate 3.
 *
 * Gesetzt wird der GANZE abhängige Satz (Griff, Mindestbreite, Innenränder): antd rechnet ihn
 * aus der Schrift, und ein überschriebener Komponententoken zieht die übrigen nicht nach. Die
 * Formeln sind antds eigene mit der Spur als Eingang; ergibt 24 × 48 · 48 × 96 · 72 × 144. Die
 * `…SM`-Variante bleibt unberührt, `dichte.guard.test.ts` sperrt die Größen-Prop am `Switch`.
 *
 * Rein und exportiert, damit die Rechnung ohne Render prüfbar ist.
 */
export function switchMasse(stufe: Pick<Dichtestufe, 'kleineZeilenhoehe'>) {
  const trackHeight = stufe.kleineZeilenhoehe;
  const handleSize = trackHeight - 2 * SWITCH_SPURPOLSTER;
  return {
    trackHeight,
    trackPadding: SWITCH_SPURPOLSTER,
    handleSize,
    trackMinWidth: 2 * handleSize + 4 * SWITCH_SPURPOLSTER,
    innerMinMargin: handleSize / 2,
    innerMaxMargin: handleSize + 3 * SWITCH_SPURPOLSTER,
  };
}

/**
 * Senkrechtes Polster der Kopfzeile von `Collapse` und `Tabs` (LFH-724).
 *
 * antd rechnet beide aus der Schrift, nicht aus `controlHeight`: Höhe = `2 × paddingSM` +
 * Zeilenhöhe der Grundschrift (`fontSize + 8`, `getLineHeight`), also 35,5 / 45 / 55 px. In
 * `komfortabel` und `handschuh` lag damit jeder Akkordeon-Kopf (Lagebericht, Einsatzdaten,
 * Befehlsdetails) und jeder Tab (Aufträge/Befehle) unter dem Boden aus Gate 3. Das Polster wächst
 * genau so weit, dass die Zeile die Steuerhöhe erreicht, und nie unter `paddingSM`: `kompakt`
 * bleibt unverändert. Kartentabs (`editable-card`) folgen schon `controlHeightLG` und bleiben
 * unberührt. Rein und exportiert wie {@link switchMasse}.
 */
export function kopfzeilenMasse(
  stufe: Pick<Dichtestufe, 'zeilenhoehe' | 'schriftgroesse' | 'abstand'>,
) {
  const zeile = stufe.schriftgroesse + 8;
  return { polsterVertikal: Math.max(stufe.abstand.sm, (stufe.zeilenhoehe - zeile) / 2) };
}

/**
 * Komponenten-Tokens, die aus den Rollen und der Dichte-Stufe folgen.
 *
 * `aufBedien` gehört an den KNOPF, nicht an antds globales `colorTextLightSolid`: das färbt auch
 * Tooltip, Avatar, Badge, Layout-Kopf u. v. m., und `#08090b` wäre dort nachts dunkel auf
 * dunkel.
 *
 * Textrollen statt Füll- und Hover-Tönen, wo antd TEXT färbt (LFH-652, Spec
 * `textkontrast-rollen`): die Beschriftung des Standardknopfs unter dem Zeiger (`bedienHover`
 * hält am Tag auf `flaeche2` nur 6,77, auf `grund` 6,13) und die Feldmeldung samt Pflichtmarke
 * (LFH-667; `alarm` lag am Tag bei 5,67 : 1 auf `grund`). Das `Form`-Token färbt nur Feldmeldung,
 * Pflichtsternchen und Rückmeldesymbol; die Felder selbst ziehen ihren Fehlerrand aus dem eigenen
 * Komponententoken.
 * `colorError` global umzustellen träfe auch Gefahrknöpfe und Ränder, und dort ist die Füllfarbe
 * richtig. Die Kante des Standardknopfs bleibt `bedienHover` (Boden 3 : 1). Ein Linkknopf zeigt
 * den Zeiger als `bedienFlaeche`, denn sein Ton wechselt nicht mehr (`bedienText` darauf 7,11 Tag
 * · 9,65 Nacht).
 *
 * Die Dichte ist PFLICHT: eine Vorgabe ließe den Schalter bei einem vergessenen Argument still
 * auf der kompakten Stufe stehen.
 */
export function antdKomponenten(
  farben: Farbrollen,
  dichte: Dichte,
): NonNullable<ThemeConfig['components']> {
  return {
    Button: {
      primaryColor: farben.aufBedien,
      dangerColor: farben.aufBedien,
      defaultHoverColor: farben.bedienText,
      defaultActiveColor: farben.bedienText,
      linkHoverBg: farben.bedienFlaeche,
    },
    Form: {
      colorError: farben.alarmText,
      colorWarning: farben.achtungText,
    },
    Switch: switchMasse(dichten[dichte]),
    Collapse: {
      headerPadding: `${kopfzeilenMasse(dichten[dichte]).polsterVertikal}px ${dichten[dichte].abstand.md}px`,
    },
    Tabs: { horizontalItemPadding: `${kopfzeilenMasse(dichten[dichte]).polsterVertikal}px 0` },
  };
}

/**
 * Der Boden der kurzen Achse für JEDEN Knopf (LFH-381): `minWidth` = kleine Steuerhöhe der
 * Stufe, also 24 / 48 / 72 (A1 Gate 3).
 *
 * antds Polsterung kleiner Knöpfe ist das Literal 7 (`paddingInlineSM`), ohne Dichte: ein „OK“
 * blieb rund 38 px breit. Ein Boden statt mitwachsender Polsterung wirkt nur, wo der Knopf zu
 * schmal wäre, und lässt breite Etiketten unberührt.
 *
 * Am Kontext statt in CSS, damit er auch die Knöpfe erreicht, die antd selbst baut
 * (Bestätigungsblase, Modal-Fuß, Filter-Dropdown). Ein `style` am einzelnen Knopf schlägt den
 * Kontext; das ist der Weg für eine benannte Ausnahme, nicht für Neues.
 *
 * Grenze: als Inline-Stil überstimmt er antds Kreis-`minWidth` und erreicht `FloatButton`. Heute
 * gibt es keinen Aufrufer von beidem; wer einen einführt, prüft das.
 */
export function antdKnopf(dichte: Dichte = 'kompakt'): NonNullable<ConfigProviderProps['button']> {
  return { style: { minWidth: dichten[dichte].kleineZeilenhoehe } };
}

/**
 * Leitet die antd-Tokens aus den Rollen ab, eine Richtung, keine zweite Liste. Was antd nicht
 * kennt (Marke, Kartenraster, Versal-Sperrung), lebt allein in `rollen.css`.
 */
export function antdToken(farben: Farbrollen, dichte: Dichte = 'kompakt'): ThemeConfig['token'] {
  const stufe = dichten[dichte];
  return {
    colorPrimary: farben.bedien,
    colorPrimaryHover: farben.bedienHover,
    colorError: farben.alarm,
    colorWarning: farben.achtung,
    colorSuccess: farben.normal,
    colorInfo: farben.bedien,
    // Ein Link ist blauer TEXT und trägt die Textrolle, in Ruhe wie unter dem Zeiger (LFH-652):
    // aus `bedien` abgeleitet verdunkelte ihn die Nachtpalette auf 4,55, und antds Hover-Ableitung
    // hellt ihn am Tag auf rund 4,3 auf. Die Rückmeldung unter dem Zeiger ist die Unterstreichung,
    // kein hellerer Ton (`bedienHover` auf `grund` 6,13).
    colorLink: farben.bedienText,
    colorLinkHover: farben.bedienText,
    colorLinkActive: farben.bedienText,
    linkHoverDecoration: 'underline',

    colorBgLayout: farben.grund,
    colorBgContainer: farben.flaeche,
    colorBgElevated: farben.flaeche2,

    colorText: farben.text,
    colorTextSecondary: farben.gedaempft,
    // Beschreibung ist Text (`Typography` `secondary`, Seitenbeschreibung, „—“). antd leitete sie
    // aus der tertiären Stufe ab, `schwach` läge am Tag bei 5,33–6,37 (LFH-652). `schwach` bleibt
    // Augenbraue, Platzhalter und Ikonen (LFH-643).
    colorTextDescription: farben.gedaempft,
    colorTextTertiary: farben.schwach,
    // Der Platzhalter ist bei mehreren Filtern die EINZIGE Beschriftung. antds Ableitung aus
    // `colorTextQuaternary` lag unter 2,5 : 1; `schwach` hält ≥ 5 : 1.
    colorTextPlaceholder: farben.schwach,

    // Der Rahmen eines Steuerelements, nicht die dekorative Linie (Messwerte bei `farbenDunkel`).
    colorBorder: farben.steuerRahmen,
    colorBorderSecondary: farben.linie,

    borderRadius: form.radiusFlaeche,
    borderRadiusSM: form.radiusSteuer,
    borderRadiusLG: form.radiusFlaeche,

    fontFamily: schrift.text,
    fontFamilyCode: schrift.zahl,
    // Archivo 600 wird lokal ausgeliefert.
    fontWeightStrong: 600,
    fontSize: stufe.schriftgroesse,

    // `controlHeight` trägt die Dichte für alle Steuerelemente auf einmal.
    controlHeight: stufe.zeilenhoehe,
    // Ohne diese Zeile leitet antd mit Faktor 0,75 ab und unterschreitet den Boden aus A1 Gate 3
    // (siehe `dichten`); so hebelt auch antds erzwungene Kleingröße (z. B. in einer
    // Bestätigungsblase) die Dichteachse nicht aus.
    controlHeightSM: stufe.kleineZeilenhoehe,
    padding: stufe.abstand.md,
    paddingSM: stufe.abstand.sm,
    paddingXS: stufe.abstand.xs,
    paddingLG: stufe.abstand.lg,
    margin: stufe.abstand.md,
    marginSM: stufe.abstand.sm,
    marginXS: stufe.abstand.xs,
    marginLG: stufe.abstand.lg,

    motionDurationMid: '120ms',
    motionDurationSlow: '150ms',
  };
}
