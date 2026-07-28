import type { ThemeConfig } from 'antd';

/**
 * Gestaltungssprache „E · Lagekarte nachts" (LFH-352 · A0).
 *
 * Farben aus dem A-Entwurf (Nachtblau, blaue Bedienfarbe, der glühende
 * Akzentstrich der Anmeldeseite als Marke), Dichte aus B (kompakt), Formensprache
 * aus C (Radius 0, Umrissrahmen, Kartenraster, DV-102-Dreiecke, Archivo).
 * Begründung und Messwerte: `docs/superpowers/specs/2026-07-25-gestaltungssprache.md`.
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
 *  `bedien`, auch wenn der Wert eines Tages nicht mehr blau ist. */
export interface Farbrollen {
  grund: string;
  flaeche: string;
  flaeche2: string;
  linie: string;
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
  achtungFuellung: string;
  normalFuellung: string;
}

export const farbenHell: Farbrollen = {
  grund: '#e7ebf0',
  flaeche: '#ffffff',
  flaeche2: '#f2f5f8',
  linie: '#d3dae2',
  linieStark: '#8c949e',
  rasterLinie: 'rgba(26, 95, 160, 0.07)',
  text: '#10161e',
  gedaempft: '#4a5563',
  schwach: '#5a6675',
  bedien: '#1a5fa0',
  alarm: '#b02318',
  achtung: '#7a5200',
  normal: '#1c6640',
  marke: '#a8071a',
  markeGlut: '0 0 10px 0 rgba(168, 7, 26, 0.3)',
  alarmFuellung: 'rgba(176, 35, 24, 0.07)',
  achtungFuellung: 'rgba(122, 82, 0, 0.08)',
  normalFuellung: 'rgba(28, 102, 64, 0.07)',
};

export const farbenDunkel: Farbrollen = {
  grund: '#0b0e13',
  flaeche: '#161c25',
  flaeche2: '#1d242f',
  linie: '#262f3b',
  linieStark: '#606874',
  rasterLinie: 'rgba(111, 180, 236, 0.055)',
  text: '#dee5ec',
  gedaempft: '#9aa7b6',
  schwach: '#7d8b9b',
  bedien: '#6fb4ec',
  alarm: '#ff7a7f',
  achtung: '#f5b942',
  normal: '#5cc48d',
  marke: '#e04552',
  markeGlut: '0 0 12px 0 rgba(224, 69, 82, 0.55)',
  alarmFuellung: 'rgba(255, 122, 127, 0.1)',
  achtungFuellung: 'rgba(245, 185, 66, 0.1)',
  normalFuellung: 'rgba(92, 196, 141, 0.1)',
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
 */
export const dichten: Record<Dichte, Dichtestufe> = {
  kompakt: {
    zeilenhoehe: 30,
    schriftgroesse: 13.5,
    // md/lg stehen so in A1; xs/sm sind [abgeleitet] (× 1,6 / × 2,4 der
    // md-Stufe, auf ganze Pixel gerundet) und in A1 nicht tabelliert.
    abstand: { xs: 3, sm: 7, md: 11, lg: 18 },
  },
  komfortabel: {
    zeilenhoehe: 48,
    schriftgroesse: 15,
    // xs/sm [abgeleitet] nach demselben Faktor wie kompakt.
    abstand: { xs: 5, sm: 11, md: 18, lg: 28 },
  },
  handschuh: {
    zeilenhoehe: 72,
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
  /** Lesebreite einer Formularseite (heute `AdminPage`-Default). */
  seiteSchmal: 900,
  /** Lesebreite einer Listenseite (heute `EinsaetzePage`). */
  seiteBreit: 960,
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

/**
 * Leitet die antd-Tokens aus den Rollen ab — eine Richtung, keine zweite Liste.
 * Was antd nicht kennt (Marke, Kartenraster, Versal-Sperrung), lebt allein in
 * `rollen.css` und wird von handgeschriebenem CSS gelesen.
 */
export function antdToken(farben: Farbrollen, dichte: Dichte = 'kompakt'): ThemeConfig['token'] {
  const stufe = dichten[dichte];
  return {
    colorPrimary: farben.bedien,
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

    colorBorder: farben.linieStark,
    colorBorderSecondary: farben.linie,

    borderRadius: form.radiusFlaeche,
    borderRadiusSM: form.radiusSteuer,
    borderRadiusLG: form.radiusFlaeche,

    fontFamily: schrift.text,
    fontFamilyCode: schrift.zahl,
    fontSize: stufe.schriftgroesse,

    // Dichte aus der gewählten Stufe. `controlHeight` trägt sie für alle
    // Steuerelemente auf einmal — das ist der Ersatz für die 236 verstreuten
    // punktuellen Klein-Angaben an Steuerelementen (Umbaupfad in B5). Das Konstrukt
    // steht hier bewusst NICHT wörtlich: es würde das Gate füllen, das es erklärt.
    controlHeight: stufe.zeilenhoehe,
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
