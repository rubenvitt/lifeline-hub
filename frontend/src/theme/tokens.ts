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

/** Abstandsraster. Komponenten importieren diese Werte, statt Pixel zu erfinden
 *  (Sweep-Befund H26: heute 729 Inline-Styles gegen 2 Token). Die Staffel ist die
 *  kompakte Stufe; ob Tablet und mobil eine komfortablere bekommen, klärt A1. */
export const abstand = {
  xs: 3,
  sm: 7,
  md: 11,
  lg: 18,
} as const;

/** Formrollen. Radius 0 ist eine Entscheidung, keine Unentschiedenheit:
 *  die Kachel wird vom Umrissrahmen getragen, nicht von einer weichen Ecke. */
export const form = {
  radiusFlaeche: 0,
  radiusSteuer: 0,
  radiusMarke: 0,
  zeilenhoehe: 30,
  schriftgroesse: 13.5,
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
export function antdToken(farben: Farbrollen): ThemeConfig['token'] {
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
    fontSize: form.schriftgroesse,

    // Dichte: die kompakte Stufe. `controlHeight` trägt sie für alle
    // Steuerelemente auf einmal — das ist der Ersatz für 241 verstreute
    // `size="small"`-Angaben (Umbaupfad in A2/B5).
    controlHeight: form.zeilenhoehe,
    padding: abstand.md,
    paddingSM: abstand.sm,
    paddingXS: abstand.xs,
    paddingLG: abstand.lg,
    margin: abstand.md,
    marginSM: abstand.sm,
    marginXS: abstand.xs,
    marginLG: abstand.lg,

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
