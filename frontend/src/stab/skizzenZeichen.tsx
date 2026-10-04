/**
 * Zeichen-Bausteine der taktischen Fernmeldeskizze (LFH-893, D12/D13/D7 in
 * `openspec/changes/lfh-893-taktische-fernmeldeskizze/design.md`; Vorlage BBK „Taktische Zeichen
 * im Bevölkerungsschutz“, Anhang J).
 *
 * Reine SVG-Inhalte: jeder Baustein ist eine `<g>`, die in ein `<svg>` mit Benutzerkoordinaten
 * gesetzt wird; die Lage kommt über Props. Kein DOM-Messen — Textbreiten schätzt
 * `schaetzeTextbreite` (Monoschrift, feste Zeichenbreite), damit Layout und Bild dieselbe Zahl
 * rechnen.
 *
 * Farbe (`frontend/AGENTS.md`, Farbe und Zeichen): Striche und Schrift stehen in `currentColor`,
 * Flächen auf dem Skizzengrund (`GRUND`). Jede Unterscheidung trägt Form, Strichmuster oder Wort
 * (WCAG 1.4.1, Druck in Graustufen, D13): Funk = Zickzack, leitergebunden = glatt, geplant =
 * gestrichelt **und** das Wort „geplant“, Bereich = Strich-Punkt, Hervorhebung = Strichstärke.
 *
 * Zeichen der Verbindungsarten (J.1) und Komponenten (J.3) kommen aus dem Katalog von
 * `@einsatzzeichen/core` (`pictogram`), umgefärbt auf `currentColor`. Was der Katalog nicht hat,
 * steht in `SELBST_GEZEICHNET` (Folgeticket an `@einsatzzeichen`).
 */
import { pictogram } from '@einsatzzeichen/core';
import type { DepictionVariant, PictogramId, Primitive, Style } from '@einsatzzeichen/schema';
import type { CSSProperties, ReactElement } from 'react';
import type {
  Komponentenart,
  Verbindungsart,
  Verbindungsmedium,
  Verbindungsstatus,
} from '../api/fernmeldeskizzeVertrag';
import type { Sprechgruppe } from '../api/types';

export type { Komponentenart, Verbindungsart, Verbindungsmedium, Verbindungsstatus };
export type Betriebsart = Sprechgruppe['betriebsart'];

// ── Maße (Benutzereinheiten der Skizze, Raster 8 nach D4) ──────────────────────────────────

/** Breite eines Zeichens der Monoschrift in em (JetBrains Mono: 600/1000). */
export const ZEICHENBREITE_EM = 0.6;
/** Schriftgrad im Bedingungszeichen. */
export const BEDINGUNGSZEICHEN_SCHRIFT = 12;
/** Höhe des Langsechsecks; die Spitzen sind je eine halbe Höhe breit. */
export const BEDINGUNGSZEICHEN_HOEHE = 24;
/** Luft zwischen Text und Spitzenansatz, je Seite. */
export const BEDINGUNGSZEICHEN_INNENABSTAND = 4;
/** Schriftgrad des Hinweises unter dem Bedingungszeichen. */
export const HINWEIS_SCHRIFT = 10;
/** Abstand zwischen Unterkante des Bedingungszeichens und Oberkante des Hinweises. */
export const HINWEIS_ABSTAND = 4;
/** Überstand der Sammelschiene links und rechts des Bedingungszeichens. */
export const SCHIENE_RAND = 16;
/** Linienstärke in Ruhe und hervorgehoben (Hervorhebung über Strich, nicht über Farbe). */
export const STRICH = 1.5;
export const STRICH_HERVORGEHOBEN = 3;
/** Kleinste Strichstärke in den Katalogzeichen, in Benutzereinheiten. */
export const STRICH_ZEICHEN_MIN = 1.25;
/** Kantenlänge der Zeichen für Verbindungsart und Komponente. */
export const ZEICHEN_GROESSE = 32;
/** Zickzack-Marke einer Funkverbindung: Länge entlang der Linie und Ausschlag. */
export const ZICKZACK_LAENGE = 24;
export const ZICKZACK_HOEHE = 8;
/** Schriftgrad und Abstand des Wortes „geplant“ an einer Leitung. */
export const GEPLANT_SCHRIFT = 10;
export const GEPLANT_ABSTAND = 4;
/** Schriftgrad der Bezeichnung unter einem Komponentenzeichen und am Bereich. */
export const BESCHRIFTUNG_SCHRIFT = 10;
/** Strichmuster „geplant“ (gestrichelt). */
export const STRICHMUSTER_GEPLANT = '8 5';
/** Strichmuster der Bereichsgrenze (Strich-Punkt): Strich, Lücke, Punkt, Lücke. */
export const STRICHMUSTER_BEREICH = '14 4 2 4';

/**
 * Fläche hinter Zeichen und Text. Die Skizzenfläche setzt `--lfh-skizze-grund`, wenn ihr Grund
 * nicht `--lfh-flaeche` ist; im Druck gilt die Papierfarbe der Druckwurzel.
 */
export const GRUND = 'var(--lfh-skizze-grund, var(--lfh-flaeche))';
const SCHRIFT_MONO: CSSProperties = { fontFamily: 'var(--lfh-schrift-zahl)' };
const SCHRIFT_TEXT: CSSProperties = { fontFamily: 'var(--lfh-schrift-text)' };

// ── Wortlaute ──────────────────────────────────────────────────────────────────────────────

const VERBINDUNGSART_WORT: Record<Verbindungsart, string> = {
  telefon: 'Telefon',
  fax: 'Fax',
  daten: 'Daten',
  melder: 'Melder',
  bild: 'Bild',
  livestream: 'Livestream',
  richtfunk: 'Richtfunk',
  satellit: 'Satellit',
  sonstige: 'Sonstige',
};
export const VERBINDUNGSARTEN = Object.keys(VERBINDUNGSART_WORT) as Verbindungsart[];

const KOMPONENTENART_WORT: Record<Komponentenart, string> = {
  repeater: 'Repeater',
  gateway: 'Gateway',
  basisstation: 'Basisstation',
  mobile_basisstation: 'Mobile Basisstation',
  antenne: 'Antenne',
  vermittlung: 'Vermittlung',
};
export const KOMPONENTENARTEN = Object.keys(KOMPONENTENART_WORT) as Komponentenart[];

const MEDIUM_WORT: Record<Verbindungsmedium, string> = {
  funk: 'Funk',
  leitung: 'leitergebunden',
};

export function verbindungsartWort(art: Verbindungsart): string {
  return VERBINDUNGSART_WORT[art];
}
export function komponentenartWort(art: Komponentenart): string {
  return KOMPONENTENART_WORT[art];
}

// ── Reine Rechnungen ───────────────────────────────────────────────────────────────────────

/** Geschätzte Breite eines Textes in Monoschrift: Zeichenzahl × Schriftgrad × Zeichenbreite. */
export function schaetzeTextbreite(text: string, schriftgrad: number): number {
  return [...text].length * schriftgrad * ZEICHENBREITE_EM;
}

/** Bricht an Wortgrenzen um; ein Wort, das allein zu lang ist, zeichenweise. Kürzt nie. */
export function umbrich(text: string, schrift: number, breite: number): string[] {
  const passt = (t: string) => schaetzeTextbreite(t, schrift) <= breite;
  const zeilen: string[] = [];
  let zeile = '';
  for (const wort of text.split(/\s+/).filter(Boolean)) {
    const kandidat = zeile ? `${zeile} ${wort}` : wort;
    if (passt(kandidat)) {
      zeile = kandidat;
      continue;
    }
    if (zeile) zeilen.push(zeile);
    let rest = wort;
    while (!passt(rest)) {
      let n = [...rest].length - 1;
      while (n > 1 && !passt([...rest].slice(0, n).join(''))) n -= 1;
      zeilen.push([...rest].slice(0, n).join(''));
      rest = [...rest].slice(n).join('');
    }
    zeile = rest;
  }
  zeilen.push(zeile);
  return zeilen;
}

/** Inhalt des Bedingungszeichens: Betriebsart und Bezeichnung, z. B. „TMO BN_BOS“. */
export function bedingungszeichenText(betriebsart: Betriebsart, bezeichnung: string): string {
  return `${betriebsart} ${bezeichnung}`.trim();
}

/** Breite des Langsechsecks samt Spitzen; wächst mit dem Text, nie gekürzt. */
export function bedingungszeichenBreite(betriebsart: Betriebsart, bezeichnung: string): number {
  const text = schaetzeTextbreite(
    bedingungszeichenText(betriebsart, bezeichnung),
    BEDINGUNGSZEICHEN_SCHRIFT,
  );
  return text + 2 * BEDINGUNGSZEICHEN_INNENABSTAND + BEDINGUNGSZEICHEN_HOEHE;
}

/** Kleinste Länge einer Sammelschiene: ihr Bedingungszeichen und beidseitig `SCHIENE_RAND`. */
export function sammelschienenMindestbreite(betriebsart: Betriebsart, bezeichnung: string): number {
  return bedingungszeichenBreite(betriebsart, bezeichnung) + 2 * SCHIENE_RAND;
}

function bedingungszeichenName(
  betriebsart: Betriebsart,
  bezeichnung: string,
  hinweis?: string | null,
): string {
  const text = bedingungszeichenText(betriebsart, bezeichnung);
  return hinweis ? `${text}, Hinweis: ${hinweis}` : text;
}

/** Zugänglicher Name einer Leitung, z. B. „Daten, leitergebunden, geplant“. */
export function leitungsBeschreibung({
  art,
  medium,
  status,
  bezug,
}: {
  art?: Verbindungsart | null;
  medium: Verbindungsmedium;
  status: Verbindungsstatus;
  bezug?: string;
}): string {
  const teile = art
    ? [VERBINDUNGSART_WORT[art], MEDIUM_WORT[medium], status]
    : [grossAnfang(MEDIUM_WORT[medium]), status];
  const satz = teile.join(', ');
  return bezug ? `${bezug}: ${satz}` : satz;
}

function grossAnfang(wort: string): string {
  return wort.charAt(0).toUpperCase() + wort.slice(1);
}

// ── Zeichenquellen ─────────────────────────────────────────────────────────────────────────

/** Woher ein Zeichen kommt: aus dem Katalog von @einsatzzeichen oder selbst gezeichnet. */
export type Zeichenquelle =
  | { quelle: 'einsatzzeichen'; id: PictogramId; variante: DepictionVariant }
  | { quelle: 'eigen'; zeichen: string };

/**
 * J.1 kennt je Übertragung eine drahtlose (`primary`, mit Zickzack) und eine leitergebundene
 * Fassung (`alternative`). Richtfunk gibt es nur drahtlos.
 */
const VERBINDUNGSART_KATALOG: Partial<Record<Verbindungsart, { id: PictogramId; paar: boolean }>> =
  {
    telefon: { id: 'comms.voice', paar: true },
    fax: { id: 'comms.fax-transmission', paar: true },
    daten: { id: 'comms.data-transmission', paar: true },
    bild: { id: 'comms.image-transmission', paar: true },
    livestream: { id: 'comms.livestream-transmission', paar: true },
    richtfunk: { id: 'comms.directional-radio', paar: false },
  };

export function verbindungsartPiktogramm(
  art: Verbindungsart,
  medium: Verbindungsmedium,
): Zeichenquelle {
  const katalog = VERBINDUNGSART_KATALOG[art];
  if (!katalog) return { quelle: 'eigen', zeichen: `verbindungsart.${art}` };
  return {
    quelle: 'einsatzzeichen',
    id: katalog.id,
    variante: katalog.paar && medium === 'leitung' ? 'alternative' : 'primary',
  };
}

const KOMPONENTEN_KATALOG: Record<Komponentenart, PictogramId> = {
  repeater: 'comms.repeater',
  gateway: 'comms.gateway',
  basisstation: 'comms.base-station',
  mobile_basisstation: 'comms.mobile-base-station',
  antenne: 'comms.antenna',
  vermittlung: 'comms.telephone-exchange',
};

export function komponentenPiktogramm(art: Komponentenart): Zeichenquelle {
  return { quelle: 'einsatzzeichen', id: KOMPONENTEN_KATALOG[art], variante: 'primary' };
}

/**
 * Was @einsatzzeichen (3.0.0) und taktische-zeichen-react nicht haben und hier gezeichnet wird —
 * Vorlage für das Folgeticket an `@einsatzzeichen`.
 */
export const SELBST_GEZEICHNET: readonly { zeichen: string; vorlage: string; grund: string }[] = [
  {
    zeichen: 'bedingungszeichen',
    vorlage: 'J.5 Musterskizze',
    grund: 'Langsechseck mit Betriebsart und Bezeichnung auf der Linie, wächst mit dem Text',
  },
  {
    zeichen: 'sammelschiene',
    vorlage: 'J.5 Musterskizze',
    grund: 'waagerechte Schiene mit eingesetztem Bedingungszeichen und Stichleitungen',
  },
  {
    zeichen: 'leitung.funk',
    vorlage: 'J.1 / J.3.12 Funk',
    grund: 'Zickzack-Marke auf einer beliebig langen, gedrehten Linie (Katalog: festes 32-mm-Feld)',
  },
  {
    zeichen: 'leitung.geplant',
    vorlage: 'J.5 Musterskizze',
    grund: 'Status „geplant“: gestrichelte Linie mit dem Wort',
  },
  {
    zeichen: 'bereich',
    vorlage: 'J.5 Musterskizze',
    grund: 'Rückwärtiger Bereich: Rechteck mit Strich-Punkt-Grenze',
  },
  {
    zeichen: 'verbindungsart.melder',
    vorlage: 'J.1 (Formsprache)',
    grund: 'keine Verbindungsart „Melder“ in J.1; Balken mit Kürzel, Zickzack bei Funk',
  },
  {
    zeichen: 'verbindungsart.satellit',
    vorlage: 'J.1.12/J.1.13',
    grund:
      'Katalog kennt nur Satellit Sprache bzw. Daten; der Vertrag nur „satellit“ (Schale allein)',
  },
  {
    zeichen: 'verbindungsart.sonstige',
    vorlage: 'J.1 (Formsprache)',
    grund: 'keine Verbindungsart „sonstige“ in J.1; Balken mit Kürzel, Zickzack bei Funk',
  },
];

// ── Selbst gezeichnete Zeichen im Katalogformat (32 × 32 mm, Strich 0,5 mm) ────────────────

const STRICH_REFERENZ: Style = { fill: 'none', stroke: 'schwarz', strokeWidth: 0.5 };

function drahtlosZickzack(obenMm: number): Primitive {
  const unten = obenMm + 4;
  return {
    type: 'polyline',
    points: [
      [4, obenMm],
      [8, unten],
      [12, obenMm],
      [16, unten],
      [20, obenMm],
      [24, unten],
      [28, obenMm],
    ],
    style: STRICH_REFERENZ,
  };
}

/** Balken mit Kürzel darüber; drahtlos mit Zickzack darunter (Formsprache J.1.8–J.1.11). */
function kuerzelUebertragung(kuerzel: string, medium: Verbindungsmedium): Primitive[] {
  const balkenY = medium === 'funk' ? 16 : 19;
  return [
    {
      type: 'text',
      content: kuerzel,
      x: 16,
      y: balkenY - 2.5,
      sizeMm: 7.1,
      anchor: 'middle',
      baseline: 'alphabetic',
      boxMm: { xMm: 2, yMm: balkenY - 8, widthMm: 28, heightMm: 5 },
      fontWeight: 500,
    },
    { type: 'line', x1: 3, y1: balkenY, x2: 29, y2: balkenY, style: STRICH_REFERENZ },
    ...(medium === 'funk' ? [drahtlosZickzack(balkenY + 3)] : []),
  ];
}

/** Satellitenschale ohne Angabe, was übertragen wird (Geometrie wie J.1.12/J.1.13). */
const SATELLITENSCHALE: Primitive[] = [
  { type: 'path', d: 'M 1 3 C 1 17.35 12.65 29 27 29', style: STRICH_REFERENZ },
  { type: 'line', x1: 27, y1: 3, x2: 8.8, y2: 21.2, style: STRICH_REFERENZ },
];

function eigeneVerbindungsart(art: Verbindungsart, medium: Verbindungsmedium): Primitive[] {
  if (art === 'satellit') return SATELLITENSCHALE;
  if (art === 'melder') return kuerzelUebertragung('Melder', medium);
  return kuerzelUebertragung('sonst.', medium);
}

function primitiveFuer(quelle: Zeichenquelle, eigen: () => Primitive[]): readonly Primitive[] {
  return quelle.quelle === 'einsatzzeichen'
    ? pictogram(quelle.id, quelle.variante).primitives
    : eigen();
}

// ── Darstellung der Katalog-Primitive in currentColor ──────────────────────────────────────

function farbe(token: Style['fill'] | Style['stroke']): { attr: string; stil?: string } {
  if (token === undefined || token === 'none') return { attr: 'none' };
  if (token === 'weiss') return { attr: 'none', stil: GRUND };
  return { attr: 'currentColor' };
}

function Primitiv({ p, minStrich }: { p: Primitive; minStrich: number }): ReactElement {
  const stroke = farbe(p.style?.stroke);
  const fill = farbe(p.type === 'text' ? (p.style?.fill ?? 'schwarz') : p.style?.fill);
  const stil: CSSProperties = {};
  if (fill.stil) stil.fill = fill.stil;
  if (stroke.stil) stil.stroke = stroke.stil;
  const transform = [
    p.transform?.translate &&
      `translate(${p.transform.translate.dxMm} ${p.transform.translate.dyMm})`,
    p.transform?.rotate &&
      `rotate(${p.transform.rotate.angle} ${p.transform.rotate.cx} ${p.transform.rotate.cy})`,
  ]
    .filter(Boolean)
    .join(' ');
  const gemeinsam = {
    fill: fill.attr,
    stroke: stroke.attr,
    strokeWidth:
      stroke.attr === 'none' && !stroke.stil
        ? undefined
        : Math.max(p.style?.strokeWidth ?? 0.5, minStrich),
    fillRule: p.style?.fillRule,
    strokeLinejoin: p.style?.strokeLinejoin,
    transform: transform || undefined,
    style: Object.keys(stil).length ? stil : undefined,
  };
  switch (p.type) {
    case 'rect':
      return <rect x={p.x} y={p.y} width={p.width} height={p.height} rx={p.rx} {...gemeinsam} />;
    case 'circle':
      return <circle cx={p.cx} cy={p.cy} r={p.r} {...gemeinsam} />;
    case 'line':
      return <line x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} {...gemeinsam} />;
    case 'polyline': {
      const punkte = p.points.map(([x, y]) => `${x},${y}`).join(' ');
      return p.closed ? (
        <polygon points={punkte} {...gemeinsam} />
      ) : (
        <polyline points={punkte} {...gemeinsam} />
      );
    }
    case 'path':
      return <path d={p.d} {...gemeinsam} />;
    case 'text':
      return (
        <text
          x={p.x}
          y={p.y}
          fontSize={p.sizeMm}
          fontWeight={p.fontWeight}
          fontStyle={p.fontStyle}
          textAnchor={p.anchor}
          dominantBaseline={p.baseline === 'alphabetic' ? undefined : p.baseline}
          fill={fill.attr}
          transform={gemeinsam.transform}
          style={{ ...SCHRIFT_TEXT, ...gemeinsam.style }}
        >
          {p.content}
        </text>
      );
    case 'group':
      return (
        <g transform={gemeinsam.transform}>
          {p.children.map((kind, i) => (
            <Primitiv key={i} p={kind} minStrich={minStrich} />
          ))}
        </g>
      );
  }
}

/** Ein 32 × 32-mm-Katalogzeichen, mittig auf (x | y), `groesse` breit, um `winkel` gedreht. */
function Piktogramm({
  primitive,
  x,
  y,
  groesse,
  winkel = 0,
}: {
  primitive: readonly Primitive[];
  x: number;
  y: number;
  groesse: number;
  winkel?: number;
}) {
  const skala = groesse / 32;
  return (
    <g
      transform={`translate(${x} ${y}) rotate(${winkel}) scale(${skala}) translate(-16 -16)`}
      aria-hidden="true"
    >
      {primitive.map((p, i) => (
        <Primitiv key={i} p={p} minStrich={STRICH_ZEICHEN_MIN / skala} />
      ))}
    </g>
  );
}

// ── Bausteine ──────────────────────────────────────────────────────────────────────────────

export interface Punkt {
  x: number;
  y: number;
}

function Langsechseck({
  x,
  y,
  betriebsart,
  bezeichnung,
  hinweis,
  strich,
}: {
  x: number;
  y: number;
  betriebsart: Betriebsart;
  bezeichnung: string;
  hinweis?: string | null;
  strich: number;
}) {
  const breite = bedingungszeichenBreite(betriebsart, bezeichnung);
  const h = BEDINGUNGSZEICHEN_HOEHE / 2;
  const links = x - breite / 2;
  const rechts = x + breite / 2;
  const punkte = [
    [links, y],
    [links + h, y - h],
    [rechts - h, y - h],
    [rechts, y],
    [rechts - h, y + h],
    [links + h, y + h],
  ]
    .map(([px, py]) => `${px},${py}`)
    .join(' ');
  return (
    <>
      <polygon
        points={punkte}
        fill="none"
        style={{ fill: GRUND }}
        stroke="currentColor"
        strokeWidth={strich}
        strokeLinejoin="round"
      />
      <text
        x={x}
        y={y}
        fontSize={BEDINGUNGSZEICHEN_SCHRIFT}
        textAnchor="middle"
        dominantBaseline="central"
        fill="currentColor"
        style={SCHRIFT_MONO}
      >
        {bedingungszeichenText(betriebsart, bezeichnung)}
      </text>
      {hinweis ? (
        <text
          x={x}
          y={y + h + HINWEIS_ABSTAND}
          fontSize={HINWEIS_SCHRIFT}
          textAnchor="middle"
          dominantBaseline="hanging"
          fill="currentColor"
          style={SCHRIFT_TEXT}
        >
          {hinweis}
        </text>
      ) : null}
    </>
  );
}

export interface BedingungszeichenProps {
  /** Mitte des Zeichens. */
  x: number;
  y: number;
  betriebsart: Betriebsart;
  bezeichnung: string;
  /** Hinweis der Sprechgruppe, steht unter dem Zeichen. */
  hinweis?: string | null;
  className?: string;
}

/** Bedingungszeichen (J.5): Langsechseck mit Betriebsart und Bezeichnung, Hinweis darunter. */
export function Bedingungszeichen({
  x,
  y,
  betriebsart,
  bezeichnung,
  hinweis,
  className,
}: BedingungszeichenProps) {
  const name = `Bedingungszeichen ${bedingungszeichenName(betriebsart, bezeichnung, hinweis)}`;
  return (
    <g role="img" aria-label={name} className={className}>
      <title>{name}</title>
      <Langsechseck
        x={x}
        y={y}
        betriebsart={betriebsart}
        bezeichnung={bezeichnung}
        hinweis={hinweis}
        strich={STRICH}
      />
    </g>
  );
}

export interface SammelschieneProps {
  /** Linker Anfang und Höhe der Schiene. */
  x: number;
  y: number;
  /** Gewünschte Länge; nie kürzer als `sammelschienenMindestbreite`. */
  breite: number;
  betriebsart: Betriebsart;
  bezeichnung: string;
  hinweis?: string | null;
  /** Mitte des Bedingungszeichens auf der Schiene; Vorgabe: Mitte der Schiene. */
  zeichenX?: number;
  hervorgehoben?: boolean;
  className?: string;
}

/** Sammelschiene einer Sprechgruppe: waagerechte Linie mit eingesetztem Bedingungszeichen. */
export function Sammelschiene({
  x,
  y,
  breite,
  betriebsart,
  bezeichnung,
  hinweis,
  zeichenX,
  hervorgehoben = false,
  className,
}: SammelschieneProps) {
  const laenge = Math.max(breite, sammelschienenMindestbreite(betriebsart, bezeichnung));
  const halb = bedingungszeichenBreite(betriebsart, bezeichnung) / 2;
  const mitte = Math.min(
    Math.max(zeichenX ?? x + laenge / 2, x + SCHIENE_RAND + halb),
    x + laenge - SCHIENE_RAND - halb,
  );
  const strich = hervorgehoben ? STRICH_HERVORGEHOBEN : STRICH;
  const name = `Sammelschiene ${bedingungszeichenName(betriebsart, bezeichnung, hinweis)}`;
  return (
    <g role="img" aria-label={name} className={className}>
      <title>{name}</title>
      <line
        data-teil="schiene"
        x1={x}
        y1={y}
        x2={x + laenge}
        y2={y}
        stroke="currentColor"
        strokeWidth={strich}
        strokeLinecap="square"
      />
      <Langsechseck
        x={mitte}
        y={y}
        betriebsart={betriebsart}
        bezeichnung={bezeichnung}
        hinweis={hinweis}
        strich={strich}
      />
    </g>
  );
}

export interface LeitungProps {
  von: Punkt;
  nach: Punkt;
  medium: Verbindungsmedium;
  status: Verbindungsstatus;
  /** Zeichen der Verbindungsart in der Mitte; ohne Art trägt Funk die Zickzack-Marke. */
  art?: Verbindungsart | null;
  /** Vorsatz des zugänglichen Namens, z. B. „Polizei an TMO SL AS“. */
  bezug?: string;
  hervorgehoben?: boolean;
  className?: string;
}

/** Linienwinkel in Grad, auf (−90°, 90°] gelegt, damit Zeichen nie kopfstehen. */
function lesbarerWinkel(dx: number, dy: number): number {
  let w = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (w > 90) w -= 180;
  if (w <= -90) w += 180;
  return w;
}

/**
 * Leitung zwischen zwei Punkten: glatt (leitergebunden) oder mit Zickzack-Marke (Funk),
 * durchgezogen (bestehend) oder gestrichelt mit dem Wort „geplant“ (D7).
 */
export function Leitung({
  von,
  nach,
  medium,
  status,
  art,
  bezug,
  hervorgehoben = false,
  className,
}: LeitungProps) {
  const dx = nach.x - von.x;
  const dy = nach.y - von.y;
  const laenge = Math.hypot(dx, dy);
  const mx = (von.x + nach.x) / 2;
  const my = (von.y + nach.y) / 2;
  const winkel = laenge > 0 ? lesbarerWinkel(dx, dy) : 0;
  // Normale nach unten bzw. rechts: dort steht das Wort „geplant“.
  let nx = laenge > 0 ? -dy / laenge : 0;
  let ny = laenge > 0 ? dx / laenge : 1;
  if (ny < 0 || (ny === 0 && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  const strich = hervorgehoben ? STRICH_HERVORGEHOBEN : STRICH;
  const geplant = status === 'geplant';
  const name = leitungsBeschreibung({ art, medium, status, bezug });

  const markeHalb = art ? ZEICHEN_GROESSE / 2 : medium === 'funk' ? ZICKZACK_HOEHE / 2 : 0;
  const wortAbstand = markeHalb + GEPLANT_ABSTAND + strich;
  const seitlich = Math.abs(nx) > 0.5;

  let marke: ReactElement | null = null;
  if (art) {
    marke = (
      <g data-teil="art">
        <Piktogramm
          primitive={primitiveFuer(verbindungsartPiktogramm(art, medium), () =>
            eigeneVerbindungsart(art, medium),
          )}
          x={mx}
          y={my}
          groesse={ZEICHEN_GROESSE}
          winkel={winkel}
        />
      </g>
    );
  } else if (medium === 'funk') {
    const l = ZICKZACK_LAENGE / 2;
    const a = ZICKZACK_HOEHE / 2;
    // Sechs Schenkel: Enden auf der Linie, dazwischen abwechselnd oben und unten.
    const zacken = Array.from({ length: 7 }, (_, i) => {
      const zy = i === 0 || i === 6 ? 0 : i % 2 === 1 ? -a : a;
      return `${-l + (i * ZICKZACK_LAENGE) / 6},${zy}`;
    });
    marke = (
      <g data-teil="funk" transform={`translate(${mx} ${my}) rotate(${winkel})`} aria-hidden="true">
        {/* Der Grund unterbricht die Linie, damit die Marke auch in Graustufen allein steht. */}
        <rect
          x={-l - 2}
          y={-a - 2}
          width={ZICKZACK_LAENGE + 4}
          height={ZICKZACK_HOEHE + 4}
          fill="none"
          style={{ fill: GRUND }}
        />
        <polyline
          points={zacken.join(' ')}
          fill="none"
          stroke="currentColor"
          strokeWidth={strich}
          strokeLinejoin="miter"
        />
      </g>
    );
  }

  return (
    <g role="img" aria-label={name} className={className}>
      <title>{name}</title>
      <line
        data-teil="linie"
        x1={von.x}
        y1={von.y}
        x2={nach.x}
        y2={nach.y}
        stroke="currentColor"
        strokeWidth={strich}
        strokeDasharray={geplant ? STRICHMUSTER_GEPLANT : undefined}
      />
      {marke}
      {geplant ? (
        <text
          data-teil="geplant"
          x={mx + nx * wortAbstand}
          y={my + ny * wortAbstand}
          fontSize={GEPLANT_SCHRIFT}
          textAnchor={seitlich ? 'start' : 'middle'}
          dominantBaseline={seitlich ? 'central' : 'hanging'}
          fill="currentColor"
          style={SCHRIFT_TEXT}
        >
          geplant
        </text>
      ) : null}
    </g>
  );
}

export interface VerbindungsartZeichenProps {
  art: Verbindungsart;
  medium: Verbindungsmedium;
  /** Mitte des Zeichens. */
  x: number;
  y: number;
  groesse?: number;
  /** Drehung in Grad, etwa entlang einer Linie. */
  winkel?: number;
  className?: string;
}

/** Zeichen einer Verbindungsart nach J.1, drahtlos mit Zickzack, leitergebunden ohne. */
export function VerbindungsartZeichen({
  art,
  medium,
  x,
  y,
  groesse = ZEICHEN_GROESSE,
  winkel = 0,
  className,
}: VerbindungsartZeichenProps) {
  const name = `${VERBINDUNGSART_WORT[art]}, ${MEDIUM_WORT[medium]}`;
  return (
    <g role="img" aria-label={name} className={className}>
      <title>{name}</title>
      <Piktogramm
        primitive={primitiveFuer(verbindungsartPiktogramm(art, medium), () =>
          eigeneVerbindungsart(art, medium),
        )}
        x={x}
        y={y}
        groesse={groesse}
        winkel={winkel}
      />
    </g>
  );
}

export interface KomponentenZeichenProps {
  art: Komponentenart;
  /** Mitte des Zeichens. */
  x: number;
  y: number;
  bezeichnung?: string | null;
  groesse?: number;
  className?: string;
}

/** Zeichen einer Komponente nach J.3, die Bezeichnung darunter. */
export function KomponentenZeichen({
  art,
  x,
  y,
  bezeichnung,
  groesse = ZEICHEN_GROESSE,
  className,
}: KomponentenZeichenProps) {
  const name = bezeichnung
    ? `${KOMPONENTENART_WORT[art]}: ${bezeichnung}`
    : KOMPONENTENART_WORT[art];
  return (
    <g role="img" aria-label={name} className={className}>
      <title>{name}</title>
      <Piktogramm
        primitive={primitiveFuer(komponentenPiktogramm(art), () => [])}
        x={x}
        y={y}
        groesse={groesse}
      />
      {bezeichnung ? (
        <text
          x={x}
          y={y + groesse / 2 + GEPLANT_ABSTAND}
          fontSize={BESCHRIFTUNG_SCHRIFT}
          textAnchor="middle"
          dominantBaseline="hanging"
          fill="currentColor"
          style={SCHRIFT_TEXT}
        >
          {bezeichnung}
        </text>
      ) : null}
    </g>
  );
}

export interface BereichsRahmenProps {
  /** Linke obere Ecke. */
  x: number;
  y: number;
  breite: number;
  hoehe: number;
  bezeichnung: string;
  hervorgehoben?: boolean;
  className?: string;
}

/** Bereich (J.5, „Rückwärtiger Bereich“): Rechteck mit Strich-Punkt-Grenze, Bezeichnung innen oben. */
export function BereichsRahmen({
  x,
  y,
  breite,
  hoehe,
  bezeichnung,
  hervorgehoben = false,
  className,
}: BereichsRahmenProps) {
  const name = `Bereich: ${bezeichnung}`;
  const strich = hervorgehoben ? STRICH_HERVORGEHOBEN : STRICH;
  return (
    <g role="img" aria-label={name} className={className}>
      <title>{name}</title>
      <rect
        x={x}
        y={y}
        width={breite}
        height={hoehe}
        fill="none"
        stroke="currentColor"
        strokeWidth={strich}
        strokeDasharray={STRICHMUSTER_BEREICH}
      />
      <text
        x={x + 8}
        y={y + 8}
        fontSize={BESCHRIFTUNG_SCHRIFT}
        dominantBaseline="hanging"
        fill="currentColor"
        style={SCHRIFT_TEXT}
      >
        {bezeichnung}
      </text>
    </g>
  );
}
