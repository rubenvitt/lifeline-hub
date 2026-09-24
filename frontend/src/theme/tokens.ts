import { theme as antdTheme, type ConfigProviderProps, type ThemeConfig } from 'antd';
import type { MappingAlgorithm } from 'antd';

/** LFH-455: fachliche Sichtungskennzeichnung, bewusst unabhängig von A0-Statusrollen.
 * Die festen Farbfelder behalten auch nachts ihren Farbton (insbesondere schwarz).
 * Ihre Umrandung und die separate Beschriftung lesen die Textfarbe des aktiven Modus.
 * Nur TSX konsumiert diese Palette; sie hat keine zweite CSS-Quelle.
 * Farbbedeutungen: BBK, Triage/Sichtung (SK I–IV, EX); unverletzt hat keine eigene Farbe. */
export const sichtungsfarben = {
  rot: '#f5222d',
  gelb: '#fadb14',
  gruen: '#52c41a',
  blau: '#1677ff',
  schwarz: '#000000',
} as const;

/**
 * Gestaltungssprache „E · Lagekarte nachts" (LFH-352 · A0).
 *
 * Farben aus dem A-Entwurf (Nachtblau, blaue Bedienfarbe, der glühende
 * Akzentstrich der Anmeldeseite als Marke), Dichte aus B (kompakt), Formensprache
 * aus C (Radius 0, Umrissrahmen, Kartenraster, DV-102-Dreiecke, Archivo).
 * Begründung und Messwerte: `docs/superpowers/specs/2026-07-25-gestaltungssprache.md`.
 *
 * NEUENTWURF „INSTRUMENTENTAFEL" (21.09.2026): neutralere, tiefere Nachtpalette,
 * Nachtbetrieb als Vorgabe, neue Rollen für Rahmen, Paneele, deckende Statusflächen,
 * ETB-Typfarben und Warnstufen-Balken, dazu eine Schriftskala. Verbindliche Grundlage:
 * `docs/design/2026-09-21-neuentwurf/umsetzung.md`; Abweichungen stehen mit Messwert an
 * den Werten (`farbenDunkel`).
 *
 * DIESE DATEI IST DIE TS-SEITE DER WAHRHEIT. Die CSS-Seite steht in `rollen.css`
 * als statische Custom Properties — nötig, weil handgeschriebenes CSS die
 * antd-Tokens nicht lesen kann, solange `cssVar` aus ist (Weiche vertagt nach
 * A2/LFH-328). `rollen.guard.test.ts` hält beide Seiten deckungsgleich.
 *
 * ROT BEDIENT NICHTS. `bedien` ist blau, `marke` ist rot, `alarm` ist rot in
 * anderer Sättigung. Eine rote Bedienfläche bricht die Sprache (LFH-315).
 */

/** Farbrollen eines Modus. Namen sind Rollen, nicht Farben — `bedien` bleibt
 *  `bedien`, auch wenn der Wert eines Tages nicht mehr blau ist.
 *
 *  Die Rollen ab `kopf` kamen mit dem Neuentwurf „Instrumententafel" (21.09.2026,
 *  `docs/design/2026-09-21-neuentwurf/umsetzung.md`) dazu. Jede existiert in BEIDEN
 *  Modi — was nur nachts gebraucht würde, wäre keine Rolle, sondern eine Ausnahme. */
export interface Farbrollen {
  grund: string;
  flaeche: string;
  flaeche2: string;
  linie: string;
  /** Kräftigere Haarlinie: Paneelkanten, Umrandung sekundärer Knöpfe. Seit dem
   *  Neuentwurf DEKORATIV — der Rahmen eines Steuerelements ist {@link Farbrollen.steuerRahmen}. */
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
  /** Zweite Intensität derselben Rolle — die obere Hälfte einer Flächenskala
   *  (LFH-368 · B5h). KEIN neuer Farbton: `alarm` in stärkerer Füllung. */
  alarmFuellungStark: string;
  achtungFuellung: string;
  /** Zweite Intensität von `achtung` — Gegenstück zu {@link Farbrollen.alarmFuellungStark}. */
  achtungFuellungStark: string;
  normalFuellung: string;

  // ── Neuentwurf „Instrumententafel" (21.09.2026) ──────────────────────────────
  /** Kopfbänder IM INHALT: Tabellenkopf, Erfassungsleiste. Die Kommandoleiste und
   *  die Rail lesen dagegen {@link rahmenFarben} — sie bleiben in beiden Modi dunkel. */
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
   *  Füllfarbe als Text den Tagesboden 7 : 1 nicht trägt (LFH-618); nachts gleich `achtung`. */
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
 * Tagmodus — aus der Nachtpalette ABGELEITET (Entscheidung 1 des Auftraggebers),
 * neutral-kühle Grautöne statt des früheren Blaugrau. Die Status- und Bedienrollen
 * (`alarm`/`achtung`/`normal`/`bedien`/`marke`) und die Füllungen behalten ihre
 * gemessenen LFH-352-Werte; neu gestimmt sind die Flächen- und Textstufen.
 *
 * Kontrast (WCAG-Formel, gerechnet 21.09.2026; `grund` · `flaeche`):
 * text 15,46 · 18,47 — text2 11,00 · 13,13 — gedaempft 7,05 · 8,42 — schwach 5,33 · 6,37
 * (vorher text 15,18, gedaempft 6,33, schwach 4,88 auf dem alten Grund); steuerRahmen 3,30 · 3,95
 * (vorher `linieStark` 3,07 auf Weiß); Weiß auf bedien 6,59, auf bedienHover 5,62.
 * normalText auf normalFlaeche 7,87, bedienText auf bedienFlaeche 7,11.
 *
 * `achtung`/`alarm` tragen als TEXT den Tagesboden nicht (auf ihrer Fläche 6,02 bzw. 5,52,
 * auf Weiß 6,92 bzw. 6,78). Dafür stehen seit LFH-618 `achtungText`/`alarmText`:
 * achtungText 9,22 auf Weiß · 8,02 auf achtungFlaeche · 8,30 auf lueckeZeile · 7,72 auf grund;
 * alarmText 8,96 auf Weiß · 7,31 auf alarmFlaeche · 7,82 auf problemZeile · 7,71 auf
 * berichtigungZeile · 7,51 auf grund. Die Füllfarben bleiben für Kante, Punkt und Balken.
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
  bedien: '#1a5fa0',
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
  bedienHover: '#236aad',
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
 * Nachtbetrieb — die Werte aus den Inline-Styles des Neuentwurfs (Tabelle in
 * `umsetzung.md`). Seit dem 21.09.2026 die VORGABE (`ThemeModeProvider`).
 *
 * Kontrast (WCAG-Formel, gerechnet 21.09.2026; `grund` · `flaeche` · `flaeche2`):
 * text 16,65 · 15,70 · 15,02 — text2 12,30 · 11,60 · 11,10 — gedaempft 7,71 · 7,27 · 6,96
 * — bedien 6,19 · 5,84 · 5,58 — alarm 7,18 · 6,77 · 6,48 — achtung 12,45 · 11,75 · 11,24
 * — normal 8,79 · 8,29 · 7,94 — aufBedien auf bedien 6,19, auf alarm 7,18.
 * Statusflächen: normalText/normalFlaeche 10,44, achtung/achtungFlaeche 11,18,
 * alarm/alarmFlaeche 6,89, bedienText/bedienFlaeche 9,65.
 *
 * ZWEI BEWUSSTE ABWEICHUNGEN VOM ENTWURF, beide gemessen:
 *
 * - `schwach` steht auf `#7d858e` statt `#5f676f`. Der Entwurfswert liegt bei 3,47 : 1 auf
 *   `grund` und 3,13 : 1 auf `flaeche2` — für eine 10-px-Augenbraue zu wenig (WCAG 1.4.3),
 *   und die Rolle trägt über antds `colorTextTertiary`/`colorTextDescription` auch echten
 *   Text (`Typography type="secondary"`, Formularhilfen, `KraefteuebersichtPage`, der
 *   gesperrte Verwaltungs-Link im Kopf). `#7d858e`: 5,33 auf `grund`, 5,03 auf `flaeche`,
 *   4,81 auf `flaeche2`, 4,72 auf `flaeche3`, 5,17 auf `rahmenFarben.grund` — mindestens
 *   der bisherige Stand (alter Wert 4,92 auf der alten `flaeche`). Die Hierarchie zu
 *   `gedaempft` (7,71) bleibt sichtbar.
 * - `steuerRahmen` (`#626a73`) trägt antds `colorBorder`, NICHT `linieStark` (`#2e343a`).
 *   Der Entwurfswert erreicht als Rahmen 1,49 : 1 auf `flaeche` — ein Eingabefeld wäre
 *   dann nur über seinen Grund zu erkennen. `#626a73`: 3,43 auf `flaeche`, 3,28 auf
 *   `flaeche2`, 3,21 auf `flaeche3` (WCAG 1.4.11 ≥ 3 : 1; vorher 3,04). `linieStark` bleibt
 *   als dekorative Linie auf dem Entwurfswert.
 *
 * DAZU EINE BENANNTE VERSCHLECHTERUNG, die der Entwurf so will: `marke` ist nachts jetzt
 * `#a8071a` (vorher `#e04552`) — 2,57 : 1 auf `grund`, 2,42 auf `flaeche`. Als Logo-Quadrat,
 * Rail-Marke und Akzentstrich trägt das (Dekoration, kein Text). Als TEXTFARBE nicht:
 * `components/Markdown.css` färbt Links mit `--lfh-marke` — nachts damit unter 3 : 1 und
 * obendrein rot auf einem Bedienziel. Nachzug außerhalb der Theme-Dateien.
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
 * Der RAHMEN — Kommandoleiste (52 px) und Rail (60 px) — bleibt in BEIDEN Modi dunkel
 * („chrome stays dark", Neuentwurf). Deshalb eine modusunabhängige Palette statt
 * weiterer `Farbrollen`: stünde sie dort, müsste der Nachtblock sie wertgleich doppeln,
 * und genau diese stille Redundanz verbietet `rollen.guard.test.ts`.
 *
 * Die Werte ZEIGEN auf die Nachtpalette statt sie zu kopieren — eine Änderung dort zieht
 * hier mit. Präzedenz: `IconRail.tsx`/`AppLayout.tsx` lesen schon heute `farbenDunkel`
 * direkt, und `--lfh-kopf-vordergrund` steht aus demselben Grund nur unter `:root`.
 * Rot ist hier ausschließlich `marke` (2-px-Marke der aktiven Rail-Kategorie).
 */
export const rahmenFarben = {
  grund: farbenDunkel.kopf,
  /** Aktive Rail-Kategorie. */
  aktiv: farbenDunkel.flaeche3,
  /** Suchfeld in der Kommandoleiste. */
  feld: farbenDunkel.flaeche2,
  linie: farbenDunkel.linie,
  text: farbenDunkel.text,
  gedaempft: farbenDunkel.gedaempft,
  schwach: farbenDunkel.schwach,
  marke: farbenDunkel.marke,
} as const;

/**
 * ETB-Typfarben (Entscheidung 2 des Auftraggebers): Meldung blau, Anordnung orange,
 * Entscheidung violett, Lage cyan, Berichtigung rot, System neutral — als farbige
 * KANTE (2 px) plus TYPWORT in Typfarbe, nicht als Etikett.
 *
 * Zwei Werte je Typ, weil eine Kante und ein Wort verschiedene Böden haben: die Kante
 * ist Dekoration neben dem Typwort (zweiter Kanal), das Wort ist Text. Nachts trägt die
 * Kante den Entwurfswert; das Wort ist aufgehellt, wo der Entwurfston als Text zu schwach
 * wäre (auf `flaeche2`: Meldung 4,38 → 6,61, Anordnung 5,06 → 6,69, Entscheidung
 * 2,59 → 5,90, Berichtigung 3,23 → 6,48). Im Tagmodus sind die Wörter ≥ 7 : 1 auf `grund` —
 * dort steht die Zeitachse, nicht auf Weiß. Bis LFH-618 waren sie nur gegen Weiß gerechnet,
 * die Browsermessung (`e2e/hellmodus-kontrast.spec.ts`) fand Anordnung 6,30, Lage 5,98 und
 * Berichtigung 6,49 auf `grund`. Jetzt: Meldung 7,13 · Anordnung 7,41 · Entscheidung 7,81 ·
 * Lage 7,40 · Berichtigung (`alarmText`) 7,51, auf der Berichtigungszeile 7,71. Die Kanten
 * sind ≥ 3 : 1 auf `grund`. Nachts liegt die Entscheidungskante
 * bei 2,87 : 1 auf `grund` — Entwurfswert, das Typwort daneben trägt die Aussage.
 *
 * `system` ist neutral und zeigt auf die Textstufen — kein eigener Farbton.
 * Gleiche Hexwerte wie andere Paletten (Meldung = `sichtungsfarben.blau`, Berichtigung =
 * Warnstufe hoch) sind Zufall des Entwurfs, keine Kopplung.
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
 * Warnstufen-Balken der Gefahrenmatrix (Neuentwurf S3). Eine BALKENFARBE, keine Fläche —
 * die Flächen-Lesart bleibt {@link Farbrollen.alarmFuellung} & Co. (LFH-368). `keine` hat
 * keinen Balken. Der zweite Kanal ist Pflicht und liegt beim Konsumenten (Wort/Kürzel).
 *
 * Nachts die Entwurfswerte. `akut` (#a8071a, = `marke`) liegt dort bei 2,57 : 1 auf
 * `grund` und damit UNTER `hoch` (3,58) — das ist der Entwurf (Marke = akut), der Balken
 * ist Dekoration neben Wort/Kürzel, kein alleiniger Informationsträger. Im Tagmodus sind
 * `niedrig`/`mittel` abgedunkelt (3,20 bzw. 4,14 auf `grund`), damit der Balken auf
 * hellem Grund nicht verschwindet.
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

/** Abstandsraster einer Dichtestufe. Komponenten importieren diese Werte, statt
 *  Pixel zu erfinden (Sweep-Befund H26: heute 729 Inline-Styles gegen 2 Token). */
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

export interface Dichtestufe {
  /** `controlHeight` — trägt die Treffläche für alle Steuerelemente auf einmal. */
  zeilenhoehe: number;
  /**
   * `controlHeightSM` — die Höhe, die antd allen als „klein" markierten
   * Steuerelementen gibt. Steht hier, weil antd sie sonst mit dem Faktor 0,75
   * aus {@link Dichtestufe.zeilenhoehe} ableitet und dabei unter den Boden aus
   * A1 Gate 3 fällt (Herleitung bei {@link dichten}).
   */
  kleineZeilenhoehe: number;
  schriftgroesse: number;
  abstand: Abstandsraster;
}

/**
 * Die Staffel. Werte aus A1 Festlegung 4 — zitiert, nicht hier entschieden.
 *
 * A2 (LFH-328) baut damit nur den TRÄGER: `antdToken()` nimmt die Stufe als
 * Parameter, `rollen.css` spiegelt sie als `[data-dichte='…']`. Die aktive Stufe
 * bleibt fest `kompakt` — die Umschaltung (Kontext-Erkennung, Benutzerwahl) ist
 * B5. `componentSize` scheidet als Träger aus: dessen `large` endet bei 40 px,
 * die 48- und 72-px-Stufen sind damit nicht darstellbar.
 *
 * Die Grundschrift steigt nur EINMAL (13,5 → 15): der Handschuh ändert die Hand,
 * nicht das Auge.
 *
 * ── `kleineZeilenhoehe`: warum sie hier steht statt abgeleitet zu werden ──────
 * antd rechnet `controlHeightSM = controlHeight × 0,75` (`genControlHeight.js`).
 * Das ergäbe 22,5 / 36 / 54 — und damit in JEDER Stufe weniger als der Boden,
 * den A1 Gate 3 für die kurze Achse setzt: kompakt ≥ 24, komfortabel ≥ 48,
 * Handschuh ≥ 72 (Spec Zeile 196). Gate 3 kennt keine Ausnahme für Elemente,
 * die eine Bibliothek intern „klein" nennt — ein Daumen misst nicht nach, welche
 * Prop am Knopf steht.
 *
 * Folge: in `komfortabel` und `handschuh` fällt die kleine Höhe mit der vollen
 * zusammen. Das ist kein Versehen, sondern die Aussage — auf dem Tablet und im
 * Handschuh gibt es keine kleine Fläche. Nur `kompakt` behält eine echte zweite
 * Stufe (24 gegen 30), weil dort Maus und Tastatur bedienen; die 22,5 von heute
 * unterschritten auch diesen Boden.
 *
 * Das macht die verbliebenen punktuellen Klein-Angaben harmlos, nimmt ihnen aber
 * NICHT die Begründung: abgebaut werden sie über den Guard aus LFH-362, nicht
 * über den Schmerz. `controlHeightXS`/`LG` bleiben abgeleitet — sie hängen an
 * `zeilenhoehe`, nicht an diesem Wert, und tragen keine Trefflächen-Aussage.
 */
export const dichten: Record<Dichte, Dichtestufe> = {
  kompakt: {
    zeilenhoehe: 30,
    kleineZeilenhoehe: 24,
    schriftgroesse: 13.5,
    // md/lg stehen so in A1; xs/sm sind [abgeleitet] (× 1,6 / × 2,4 der
    // md-Stufe, auf ganze Pixel gerundet) und in A1 nicht tabelliert.
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

/** Das Abstandsraster der kompakten Stufe. Bleibt als A0-Export bestehen — die
 *  Konsumenten außerhalb des Themes kennen (noch) keine Dichte. */
export const abstand: Abstandsraster = dichten.kompakt.abstand;

/**
 * Wiederkehrende Flächen- und Breitenmaße, die heute als Inline-Pixel verstreut
 * sind (Spec §2.2: `maxWidth: 900` in `AdminPage`, `960` in `EinsaetzePage`,
 * `paddingTop: 80` an 32 Stellen, `minmax(260px…)`/`(220px…)` in den zwei
 * Kartenrastern). Norm für Neues und ohnehin Angefasstes — kein Bestands-Sweep.
 *
 * Bewusst KEIN antd-Token: antd kennt weder eine Seitenbreite noch die Höhe
 * einer Ladefläche.
 */
export const flaeche = {
  /**
   * Lesebreite einer reinen Formular-/Editorseite (`breite="schmal"` an `EinsatzSeite` und
   * `AdminPage`). Die frühere Listenbreite `seiteBreit` (960) ist mit dem Neuentwurf
   * entfallen: Listen, Übersichten und Zeitachsen füllen die ganze Inhaltsbreite.
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
 * Die Seitenrinne — der seitliche Rand, den eine Seite zum Fensterrand hält
 * (LFH-329 · B1). Zwei Stufen, nach Viewport: `breit` am Fükw-Schirm und an
 * jedem Tablet, `schmal` auf dem Handschirm.
 *
 * VIEWPORT-ACHSE, NICHT DICHTE-ACHSE — deshalb ein eigener Export und kein
 * weiterer Schlüssel in `flaeche` (das trägt die gemessenen §2.2-Baselines und
 * ist als solches gepinnt) und erst recht kein Eintrag in `dichten`.
 *
 * Wirksam wird sie nicht hier, sondern als Custom-Property in `rollen.css`:
 * eine Media-Regel an antds `md`-Schwelle schaltet die Stufe um, die vier
 * Konsumstellen lesen nur noch die Property. Das ist beim ersten Paint korrekt
 * und gilt unter beiden Layouts. Dass CSS- und TS-Seite dieselben Stufen
 * tragen, bewacht `rollen.guard.test.ts`.
 */
export const seitenrinne = {
  /** Ab antds `md`-Schwelle (768 px) — Fükw, ortsfeste Stelle, Führungs-Tablet. */
  breit: 24,
  /** Darunter — mobil, ~390 px einhändig. */
  schmal: 12,
} as const;

/**
 * Breite des Navigations-Drawers, der den Einsatz-Rahmen unter antds
 * `lg`-Schwelle ersetzt (LFH-329 · B1/H11).
 *
 * VIEWPORT-ACHSE WIE DIE SEITENRINNE, deshalb ein eigener Export und kein
 * sechster Schlüssel in `flaeche`: das trägt die gemessenen §2.2-Baselines und
 * ist als geschlossene Menge gepinnt.
 *
 * Warum dieses Maß trägt, obwohl der inline-Rahmen breiter ist: der Drawer
 * zeigt die Navigation NICHT als Rail plus Modul-Spalte. Beide nebeneinander
 * bräuchten mehr, als hier steht — auf dem Handschirm (~390 px) belegte das
 * über vier Fünftel der Fläche. Im Drawer steht deshalb ein flaches Akkordeon
 * in einer Spalte: Kategorie-Kopfzeile, darunter ihre Module.
 */
export const navDrawerBreite = 280;

/** Formrollen. Radius 0 ist eine Entscheidung, keine Unentschiedenheit:
 *  die Kachel wird vom Umrissrahmen getragen, nicht von einer weichen Ecke.
 *
 *  `zeilenhoehe`/`schriftgroesse` sind Dichte, nicht Form — sie zeigen deshalb
 *  auf `dichten.kompakt` und bleiben hier nur als A0-Export stehen. Wer eine
 *  Stufe braucht, liest `dichten`. */
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
export type Schriftfamilie = keyof typeof schrift;

export interface Schriftstufe {
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
 * Schriftskala des Neuentwurfs („Kontrastsprung statt Abstufung", `umsetzung.md`
 * § Form & Typografie; Einzelwerte aus den Inline-Styles von `neuentwurf.dc.html` und
 * `shell.dc.html`).
 *
 * Sie ergänzt die Dichte-Achse, sie ersetzt sie nicht: antds Grundschrift (`fontSize`)
 * bleibt `dichten[…].schriftgroesse` (13,5 / 15 / 15) — die Skala benennt die STUFEN
 * darüber und daneben, die handgebaute Bausteine setzen. Zahlen, Zeiten, Funkrufnamen,
 * Koordinaten und Nummern laufen immer in `zahl` (Mono, `tabular-nums`).
 *
 * CSS-Seite: `--lfh-typo-<stufe>-{groesse,gewicht,sperrung}` in `rollen.css`,
 * deckungsgleich gehalten von `rollen.guard.test.ts`. Die Familie steht dort nicht noch
 * einmal — sie ist `--lfh-schrift-<familie>`.
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
 * Nachts läuft zuerst antds `darkAlgorithm` — er leitet die abgeleiteten Töne (Hover-,
 * Aktiv-, Füll- und Randstufen) für dunklen Grund ab — und danach {@link seedTreu}. Der
 * Grund, gemessen am 21.09.2026: `darkAlgorithm` rechnet die SEED-Farben selbst um, und
 * die sind über `token` nicht zu überschreiben (antd löscht Seed-Schlüssel aus dem
 * Override, `theme/util/alias.js`). Aus `bedien` #4d94d6 wurde `colorPrimary` #4481b9,
 * aus `alarm` #ff6b6b #dc5e5e, aus `normal` #52c41a #49aa19 — die antd-Fläche trug damit
 * eine andere Farbe als `rollen.css` daneben, und der Primärknopf verfehlte den
 * Entwurfswert (#4d94d6, Text #08090b). {@link seedTreu} setzt die fünf Signalfarben auf
 * den Seed zurück; alles andere bleibt die Ableitung des Dunkel-Algorithmus.
 */
export function antdAlgorithmus(dunkel: boolean): MappingAlgorithm | MappingAlgorithm[] {
  return dunkel ? [antdTheme.darkAlgorithm, seedTreu] : antdTheme.defaultAlgorithm;
}

/** Zweite Stufe des Nacht-Algorithmus: die Signalfarben tragen genau ihren Rollenwert. */
export const seedTreu: MappingAlgorithm = (seed, abgeleitet) => ({
  ...(abgeleitet ?? antdTheme.darkAlgorithm(seed)),
  colorPrimary: seed.colorPrimary,
  colorInfo: seed.colorInfo,
  colorError: seed.colorError,
  colorWarning: seed.colorWarning,
  colorSuccess: seed.colorSuccess,
});

/**
 * Komponenten-Tokens, die aus den Rollen folgen.
 *
 * `aufBedien` gehört an den KNOPF, nicht an antds `colorTextLightSolid`: dieser globale
 * Token färbt auch Tooltip (auf `colorBgSpotlight`), Avatar, Badge, Bildvorschau-Maske,
 * die Layout-Kopfzeile und rund fünfzehn weitere Stellen (gezählt in
 * `antd/es/…/style`). #08090b dort wäre nachts dunkel auf dunkel. Am Knopf: #08090b auf
 * `bedien` 6,19 : 1, auf `alarm` 7,18 : 1; Weiß auf `bedien` hätte nur 3,22.
 */
export function antdKomponenten(farben: Farbrollen): NonNullable<ThemeConfig['components']> {
  return {
    Button: {
      primaryColor: farben.aufBedien,
      dangerColor: farben.aufBedien,
    },
  };
}

/**
 * Der Boden der kurzen Achse für JEDEN Knopf (LFH-381): nie schmaler als die kleine
 * Steuerhöhe der Stufe, also 24 / 48 / 72 — genau der Boden aus A1 Gate 3.
 *
 * Die Höhe eines Knopfs folgt der Staffel über `controlHeight`/`controlHeightSM`, seine
 * Breite aber der BESCHRIFTUNG plus Polsterung. Bei kleinen Knöpfen ist diese Polsterung
 * antds `paddingInlineSM`, und das ist in `antd/es/button/style/token.js` das Literal
 * `8 - lineWidth` = 7 — ohne jede Dichte. Ein „OK" in einer Bestätigungsblase blieb damit
 * rund 38 px breit, während es auf 72 px Höhe wuchs; der Daumen trifft die schmale Achse.
 *
 * WARUM EIN BODEN UND NICHT DIE POLSTERUNG: eine an die Staffel gebundene Polsterung
 * bindet die Breite nicht an die Höhe — ein Ein-Zeichen-Etikett („…", „+") fiele weiter
 * durch, und jedes breite Etikett wüchse grundlos mit, auch in Reihen mehrerer Knöpfe.
 * Ein `minWidth` wirkt nur dort, wo der Knopf zu schmal WÄRE, und lässt alle übrigen
 * unberührt. Er ist dieselbe Regel, die antd selbst für icon-only (`width`) und runde
 * Knöpfe (`minWidth`) anlegt, nur für alle Formen.
 *
 * WARUM EIN WERT FÜR ALLE GRÖSSEN: der Boden aus Gate 3 hängt an der Stufe, nicht an der
 * Knopfgröße. In `komfortabel` und `handschuh` fallen kleine und volle Höhe ohnehin
 * zusammen (Herleitung bei {@link dichten}); in `kompakt` ist ein voller Knopf 30 hoch,
 * sein Boden in der kurzen Achse bleibt 24.
 *
 * WARUM AM KONTEXT UND NICHT IN CSS: der Wert kommt aus derselben Stufe wie die Höhe,
 * ohne Spiegel in `rollen.css`, und erreicht auch die Knöpfe, die antd selbst baut
 * (Bestätigungsblase, Modal-Fuß, Filter-Dropdown), weil sie dieselbe `Button`-Komponente
 * rendern. Ein `style` am einzelnen Knopf schlägt den Kontext — das ist der Weg für eine
 * benannte Ausnahme (Aktionszeile der UHS-Platzkarte, LFH-379), keiner für Neues.
 */
export function antdKnopf(dichte: Dichte = 'kompakt'): NonNullable<ConfigProviderProps['button']> {
  return { style: { minWidth: dichten[dichte].kleineZeilenhoehe } };
}

/**
 * Leitet die antd-Tokens aus den Rollen ab — eine Richtung, keine zweite Liste.
 * Was antd nicht kennt (Marke, Kartenraster, Versal-Sperrung), lebt allein in
 * `rollen.css` und wird von handgeschriebenem CSS gelesen.
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

    colorBgLayout: farben.grund,
    colorBgContainer: farben.flaeche,
    colorBgElevated: farben.flaeche2,

    colorText: farben.text,
    colorTextSecondary: farben.gedaempft,
    colorTextTertiary: farben.schwach,
    // Platzhalter trägt bei mehreren Filtern die EINZIGE Beschriftung („Status", „Typ",
    // „Bearbeiter zuweisen"). antds Ableitung aus `colorTextQuaternary` lag bei 1,9 : 1 (Tag)
    // bzw. 2,3 : 1 (Nacht); `schwach` hält 6,37 auf Weiß und 5,03 auf `flaeche` (LFH-618).
    colorTextPlaceholder: farben.schwach,

    // Der Rahmen eines Steuerelements, nicht die dekorative Linie (Messwerte bei `farbenDunkel`).
    colorBorder: farben.steuerRahmen,
    colorBorderSecondary: farben.linie,

    borderRadius: form.radiusFlaeche,
    borderRadiusSM: form.radiusSteuer,
    borderRadiusLG: form.radiusFlaeche,

    fontFamily: schrift.text,
    fontFamilyCode: schrift.zahl,
    // Halbfett ist 600, seit Archivo 600 lokal ausgeliefert wird (Neuentwurf) — vorher
    // fiel antds `strong` auf den nächsten verfügbaren Schnitt.
    fontWeightStrong: 600,
    fontSize: stufe.schriftgroesse,

    // Dichte aus der gewählten Stufe. `controlHeight` trägt sie für alle
    // Steuerelemente auf einmal — das ist der Ersatz für die 236 verstreuten
    // punktuellen Klein-Angaben an Steuerelementen (Umbaupfad in B5). Das Konstrukt
    // steht hier bewusst NICHT wörtlich: es würde das Gate füllen, das es erklärt.
    controlHeight: stufe.zeilenhoehe,
    // Ohne diese Zeile leitet antd mit dem Faktor 0,75 ab und unterschreitet in
    // jeder Stufe den Boden aus A1 Gate 3 — Herleitung bei `dichten`. Sie ist
    // der Grund, warum antds Zwang zur Kleingröße (z. B. in den Aktionen einer
    // Bestätigungsblase) die Dichteachse nicht mehr aushebelt.
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

/**
 * Modusunabhängiger Basis-Token.
 * @deprecated Seit LFH-352 leitet `ThemeModeProvider` die Tokens je Modus über
 * {@link antdToken} ab. Bleibt als Re-Export erhalten, bis A2 (LFH-328) die
 * letzten Konsumenten umgezogen hat.
 */
export const baseToken: ThemeConfig['token'] = antdToken(farbenHell);
