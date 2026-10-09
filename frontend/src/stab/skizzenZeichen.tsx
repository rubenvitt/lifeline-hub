/**
 * Zeichen-Bausteine der taktischen Fernmeldeskizze (LFH-893, D12/D13/D7 in
 * `openspec/changes/archive/2026-10-05-lfh-893-taktische-fernmeldeskizze/design.md`; Vorlage BBK „Taktische Zeichen
 * im Bevölkerungsschutz“, Anhang J).
 *
 * Reine SVG-Inhalte: jeder Baustein ist eine `<g>`, die in ein `<svg>` mit Benutzerkoordinaten
 * gesetzt wird; die Lage kommt über Props. Kein DOM-Messen: Die Breite des Bedingungszeichens
 * misst das Paket an den Metriken seiner Schrift (Arimo 500), sonstige Texte schätzt
 * `schaetzeTextbreite` (Monoschrift, feste Zeichenbreite) — Layout und Bild rechnen so dieselbe
 * Zahl.
 *
 * Farbe (`frontend/AGENTS.md`, Farbe und Zeichen): Striche und Schrift stehen in `currentColor`,
 * Flächen auf dem Skizzengrund (`GRUND`). Jede Unterscheidung trägt Form, Strichmuster oder Wort
 * (WCAG 1.4.1, Druck in Graustufen, D13): Funk = Zickzack, leitergebunden = glatt, geplant =
 * gestrichelt **und** das Wort „geplant“, Bereich = Strich-Punkt, Hervorhebung = Strichstärke.
 *
 * Alle Zeichen kommen aus `@einsatzzeichen/core`, umgefärbt auf `currentColor`: Verbindungsarten
 * (J.1) und Komponenten (J.3) aus dem Katalog (`pictogram`), Bedingungszeichen, Sammelschiene,
 * Leitung, Bereich und die Verbindungsarten Melder, sonstige und Satellit aus der
 * Kommunikationsskizze (`sketch.*`, LFH-1033). Die Skizze zeichnet in Millimetern des Pakets mal
 * `SKIZZE_EINHEITEN_JE_MM`.
 */
import {
  SKETCH_BUS_BAR_MARGIN_MM,
  SKETCH_CONDITION_SIGN_HEIGHT_MM,
  busBar,
  busBarMinLength,
  commsArea,
  commsLink,
  conditionSign,
  conditionSignWidth,
  pictogram,
  sketchPictogram,
  type SketchPictogramId,
} from '@einsatzzeichen/core';
import type {
  DepictionVariant,
  PictogramId,
  Point,
  Primitive,
  Style,
} from '@einsatzzeichen/schema';
import type { CSSProperties, ReactElement } from 'react';
import type {
  Komponentenart,
  Verbindungsart,
  Verbindungsmedium,
  Verbindungsstatus,
} from '../api/fernmeldeskizzeVertrag';
import type { Sprechgruppe } from '../api/types';
import { mitBetriebsart } from '../components/kommunikationsmittel';

export type { Komponentenart, Verbindungsart, Verbindungsmedium, Verbindungsstatus };
export type Betriebsart = Sprechgruppe['betriebsart'];

// ── Maße (Benutzereinheiten der Skizze, Raster 8 nach D4) ──────────────────────────────────

/** Benutzereinheiten der Skizze je Millimeter des Pakets: Strich 0,5 mm = 1,5. */
export const SKIZZE_EINHEITEN_JE_MM = 3;
/** Breite eines Zeichens der Monoschrift in em (JetBrains Mono: 600/1000). */
export const ZEICHENBREITE_EM = 0.6;
/** Höhe des Langsechsecks; die Spitzen sind je eine halbe Höhe breit. */
export const BEDINGUNGSZEICHEN_HOEHE = SKETCH_CONDITION_SIGN_HEIGHT_MM * SKIZZE_EINHEITEN_JE_MM;
/** Schriftgrad der Zeile unter dem Bedingungszeichen (Netz, Sicherheit, Hinweis). */
export const HINWEIS_SCHRIFT = 10;
/** Abstand zwischen Unterkante des Bedingungszeichens und Oberkante der Zeile darunter. */
export const HINWEIS_ABSTAND = 4;
/** Überstand der Sammelschiene links und rechts des Bedingungszeichens. */
export const SCHIENE_RAND = SKETCH_BUS_BAR_MARGIN_MM * SKIZZE_EINHEITEN_JE_MM;
/** Linienstärke in Ruhe und hervorgehoben (Hervorhebung über Strich, nicht über Farbe). */
export const STRICH = 1.5;
export const STRICH_HERVORGEHOBEN = 3;
/** Kleinste Strichstärke in den Katalogzeichen, in Benutzereinheiten. */
export const STRICH_ZEICHEN_MIN = 1.25;
/** Kantenlänge der Zeichen für Verbindungsart und Komponente. */
export const ZEICHEN_GROESSE = 32;
/** Abstand der Bezeichnung unter einem Komponentenzeichen. */
export const BESCHRIFTUNG_ABSTAND = 4;
/** Schriftgrad der Bezeichnung unter einem Komponentenzeichen. */
export const BESCHRIFTUNG_SCHRIFT = 10;

/**
 * Fläche hinter Zeichen und Text. Die Skizzenfläche setzt `--lfh-skizze-grund`, wenn ihr Grund
 * nicht `--lfh-flaeche` ist; im Druck gilt die Papierfarbe der Druckwurzel.
 */
export const GRUND = 'var(--lfh-skizze-grund, var(--lfh-flaeche))';
const SCHRIFT_TEXT: CSSProperties = { fontFamily: 'var(--lfh-schrift-text)' };
/**
 * Schrift der Paketzeichen: Arimo, an deren Metriken das Paket Breiten misst (`theme/schriften.ts`
 * bindet den Schnitt 500 aus `@einsatzzeichen/core/fonts` ein).
 */
const SCHRIFT_ZEICHEN: CSSProperties = { fontFamily: "'Arimo', var(--lfh-schrift-text)" };

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

/**
 * Inhalt des Bedingungszeichens: Betriebsart und Bezeichnung, z. B. „TMO BN_BOS“; trägt die
 * Bezeichnung die Betriebsart schon, steht sie einmal (`mitBetriebsart`, wie Funkplan-Bericht).
 */
export function bedingungszeichenText(betriebsart: Betriebsart, bezeichnung: string): string {
  return mitBetriebsart(betriebsart, bezeichnung).trim();
}

/** Millimeter des Pakets in Benutzereinheiten der Skizze. */
function inEinheiten(mm: number): number {
  // Gerundet, damit eine Lage auf dem Raster nach dem Hin und Her über Millimeter wieder genau
  // auf dem Raster liegt (Stichleitungen enden auf der Linie der Schiene).
  return Math.round(mm * SKIZZE_EINHEITEN_JE_MM * 1e6) / 1e6;
}

/** Benutzereinheiten der Skizze in Millimetern des Pakets. */
function inMm(einheiten: number): number {
  return einheiten / SKIZZE_EINHEITEN_JE_MM;
}

function punktInMm({ x, y }: Punkt): Point {
  return [inMm(x), inMm(y)];
}

/** Breite des Langsechsecks samt Spitzen; wächst mit dem Text, nie gekürzt. */
export function bedingungszeichenBreite(betriebsart: Betriebsart, bezeichnung: string): number {
  return inEinheiten(conditionSignWidth(bedingungszeichenText(betriebsart, bezeichnung)));
}

/** Kleinste Länge einer Sammelschiene: ihr Bedingungszeichen und beidseitig `SCHIENE_RAND`. */
export function sammelschienenMindestbreite(betriebsart: Betriebsart, bezeichnung: string): number {
  return inEinheiten(busBarMinLength(bedingungszeichenText(betriebsart, bezeichnung)));
}

/** Was unter dem Bedingungszeichen stehen kann (BBK-Anhang J.5, LFH-1030). */
export interface Bedingungsangaben {
  netz?: string | null;
  sicherheit?: string | null;
  hinweis?: string | null;
}

/** Leer und Leerraum zählen als nicht gesetzt. */
function gesetzt(wert: string | null | undefined): string | null {
  return wert?.trim() ? wert.trim() : null;
}

/**
 * Zeile unter dem Bedingungszeichen: Netz, Sicherheit und Hinweis in dieser Reihenfolge, leere
 * weggelassen, z. B. „Gateway · E2E · Gesundheit“; ohne Angabe `null` (keine Zeile).
 */
export function bedingungszeichenZusatz({
  netz,
  sicherheit,
  hinweis,
}: Bedingungsangaben): string | null {
  const teile = [netz, sicherheit, hinweis].map(gesetzt).filter((t) => t != null);
  return teile.length > 0 ? teile.join(' · ') : null;
}

/** Bedingung eines Kanals in einer Tabelle: Betriebsart, Netz, Sicherheit, z. B. „TMO · Gateway · E2E“. */
export function kanalBedingung(
  betriebsart: Betriebsart,
  netz?: string | null,
  sicherheit?: string | null,
): string {
  return [betriebsart, gesetzt(netz), gesetzt(sicherheit)].filter((t) => t != null).join(' · ');
}

function bedingungszeichenName(
  betriebsart: Betriebsart,
  bezeichnung: string,
  { netz, sicherheit, hinweis }: Bedingungsangaben,
): string {
  const teile = [
    bedingungszeichenText(betriebsart, bezeichnung),
    ...(
      [
        ['Netz', netz],
        ['Sicherheit', sicherheit],
        ['Hinweis', hinweis],
      ] as const
    )
      .map(([name, wert]) => [name, gesetzt(wert)] as const)
      .filter(([, wert]) => wert != null)
      .map(([name, wert]) => `${name}: ${wert}`),
  ];
  return teile.join(', ');
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

/**
 * Woher ein Zeichen kommt: aus dem Katalog von @einsatzzeichen (J.1–J.4) oder aus dessen
 * Kommunikationsskizze (`sketch.*`, Zeichen ohne Referenzdatei, LFH-1033).
 */
export type Zeichenquelle =
  | { quelle: 'einsatzzeichen'; id: PictogramId; variante: DepictionVariant }
  | { quelle: 'skizze'; id: SketchPictogramId; variante: DepictionVariant };

/**
 * J.1 kennt je Übertragung eine drahtlose (`primary`, mit Zickzack) und eine leitergebundene
 * Fassung (`alternative`). Richtfunk gibt es nur drahtlos, Satellit nur als Schale.
 */
const VERBINDUNGSART_ZEICHEN: Record<
  Verbindungsart,
  | { quelle: 'einsatzzeichen'; id: PictogramId; paar: boolean }
  | {
      quelle: 'skizze';
      id: SketchPictogramId;
      paar: boolean;
    }
> = {
  telefon: { quelle: 'einsatzzeichen', id: 'comms.voice', paar: true },
  fax: { quelle: 'einsatzzeichen', id: 'comms.fax-transmission', paar: true },
  daten: { quelle: 'einsatzzeichen', id: 'comms.data-transmission', paar: true },
  bild: { quelle: 'einsatzzeichen', id: 'comms.image-transmission', paar: true },
  livestream: { quelle: 'einsatzzeichen', id: 'comms.livestream-transmission', paar: true },
  richtfunk: { quelle: 'einsatzzeichen', id: 'comms.directional-radio', paar: false },
  melder: { quelle: 'skizze', id: 'sketch.messenger', paar: true },
  sonstige: { quelle: 'skizze', id: 'sketch.other', paar: true },
  satellit: { quelle: 'skizze', id: 'sketch.satellite', paar: false },
};

export function verbindungsartPiktogramm(
  art: Verbindungsart,
  medium: Verbindungsmedium,
): Zeichenquelle {
  const { paar, ...quelle } = VERBINDUNGSART_ZEICHEN[art];
  return { ...quelle, variante: paar && medium === 'leitung' ? 'alternative' : 'primary' };
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

/** Die Primitive eines 32 × 32-mm-Zeichens aus dem Paket. */
export function zeichenPrimitive(quelle: Zeichenquelle): readonly Primitive[] {
  return quelle.quelle === 'einsatzzeichen'
    ? pictogram(quelle.id, quelle.variante).primitives
    : (sketchPictogram(quelle.id, quelle.variante).primitives as readonly Primitive[]);
}

/**
 * Ein Teil eines Skizzenbausteins aus dem Paket (Millimeter) in Benutzereinheiten der Skizze.
 * Die Bausteine liefern nur Linien, Polyzüge und Textläufe.
 */
function inSkizze(p: Primitive): Primitive {
  const style = p.style?.strokeWidth
    ? { ...p.style, strokeWidth: inEinheiten(p.style.strokeWidth) }
    : p.style;
  switch (p.type) {
    case 'line':
      return {
        ...p,
        style,
        x1: inEinheiten(p.x1),
        y1: inEinheiten(p.y1),
        x2: inEinheiten(p.x2),
        y2: inEinheiten(p.y2),
      };
    case 'polyline':
      return {
        ...p,
        style,
        points: p.points.map(([x, y]) => [inEinheiten(x), inEinheiten(y)] as const),
      };
    case 'text':
      return {
        ...p,
        style,
        x: inEinheiten(p.x),
        y: inEinheiten(p.y),
        sizeMm: inEinheiten(p.sizeMm),
        boxMm: {
          xMm: inEinheiten(p.boxMm.xMm),
          yMm: inEinheiten(p.boxMm.yMm),
          widthMm: inEinheiten(p.boxMm.widthMm),
          heightMm: inEinheiten(p.boxMm.heightMm),
        },
      };
    default:
      throw new Error(`Skizzenbaustein mit unerwartetem Teil ${p.type}`);
  }
}

// ── Darstellung der Katalog-Primitive in currentColor ──────────────────────────────────────

function farbe(token: Style['fill'] | Style['stroke']): { attr: string; stil?: string } {
  if (token === undefined || token === 'none') return { attr: 'none' };
  if (token === 'weiss') return { attr: 'none', stil: GRUND };
  return { attr: 'currentColor' };
}

/**
 * Ein Primitiv des Pakets als SVG. `strich` ersetzt die Strichstärke jedes gezeichneten Strichs
 * (Hervorhebung an Skizzenbausteinen); ohne gilt die des Pakets, mindestens `minStrich`.
 */
function Primitiv({
  p,
  minStrich = 0,
  strich,
  teil,
}: {
  p: Primitive;
  minStrich?: number;
  strich?: number;
  teil?: string;
}): ReactElement {
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
        : (strich ?? Math.max(p.style?.strokeWidth ?? 0.5, minStrich)),
    fillRule: p.style?.fillRule,
    strokeLinejoin: p.style?.strokeLinejoin,
    transform: transform || undefined,
    style: Object.keys(stil).length ? stil : undefined,
    'data-teil': teil,
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
          style={{ ...SCHRIFT_ZEICHEN, ...gemeinsam.style }}
          data-teil={teil}
        >
          {p.content}
        </text>
      );
    case 'group':
      return (
        <g transform={gemeinsam.transform}>
          {p.children.map((kind, i) => (
            <Primitiv key={i} p={kind} minStrich={minStrich} strich={strich} />
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

/** Teile eines Skizzenbausteins in Benutzereinheiten, Striche in `strich`. */
function Teile({
  teile,
  strich,
  teil,
}: {
  teile: readonly Primitive[];
  strich?: number;
  teil?: string;
}) {
  return (
    <>
      {teile.map((p, i) => (
        <Primitiv key={i} p={inSkizze(p)} strich={strich} teil={teil} />
      ))}
    </>
  );
}

function Langsechseck({
  x,
  y,
  betriebsart,
  bezeichnung,
  angaben,
  strich,
}: {
  x: number;
  y: number;
  betriebsart: Betriebsart;
  bezeichnung: string;
  angaben: Bedingungsangaben;
  strich: number;
}) {
  const zeichen = conditionSign({
    text: bedingungszeichenText(betriebsart, bezeichnung),
    center: punktInMm({ x, y }),
  });
  const zusatz = bedingungszeichenZusatz(angaben);
  return (
    <>
      <Teile teile={zeichen.outline} strich={strich} />
      <Teile teile={zeichen.label} />
      {zusatz ? (
        <text
          x={x}
          y={y + BEDINGUNGSZEICHEN_HOEHE / 2 + HINWEIS_ABSTAND}
          fontSize={HINWEIS_SCHRIFT}
          textAnchor="middle"
          dominantBaseline="hanging"
          fill="currentColor"
          style={SCHRIFT_TEXT}
        >
          {zusatz}
        </text>
      ) : null}
    </>
  );
}

export interface BedingungszeichenProps extends Bedingungsangaben {
  /** Mitte des Zeichens. */
  x: number;
  y: number;
  betriebsart: Betriebsart;
  bezeichnung: string;
  className?: string;
}

/**
 * Bedingungszeichen (J.5): Langsechseck mit Betriebsart und Bezeichnung, darunter Netz,
 * Sicherheit und Hinweis (`bedingungszeichenZusatz`); die Zeile darunter verbreitert es nie.
 */
export function Bedingungszeichen({
  x,
  y,
  betriebsart,
  bezeichnung,
  netz,
  sicherheit,
  hinweis,
  className,
}: BedingungszeichenProps) {
  const angaben = { netz, sicherheit, hinweis };
  const name = `Bedingungszeichen ${bedingungszeichenName(betriebsart, bezeichnung, angaben)}`;
  return (
    <g role="img" aria-label={name} className={className}>
      <title>{name}</title>
      <Langsechseck
        x={x}
        y={y}
        betriebsart={betriebsart}
        bezeichnung={bezeichnung}
        angaben={angaben}
        strich={STRICH}
      />
    </g>
  );
}

export interface SammelschieneProps extends Bedingungsangaben {
  /** Linker Anfang und Höhe der Schiene. */
  x: number;
  y: number;
  /** Gewünschte Länge; nie kürzer als `sammelschienenMindestbreite`. */
  breite: number;
  betriebsart: Betriebsart;
  bezeichnung: string;
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
  netz,
  sicherheit,
  hinweis,
  zeichenX,
  hervorgehoben = false,
  className,
}: SammelschieneProps) {
  const angaben = { netz, sicherheit, hinweis };
  const schiene = busBar({
    start: punktInMm({ x, y }),
    length: inMm(breite),
    text: bedingungszeichenText(betriebsart, bezeichnung),
    signCenterX: zeichenX === undefined ? undefined : inMm(zeichenX),
  });
  const strich = hervorgehoben ? STRICH_HERVORGEHOBEN : STRICH;
  const name = `Sammelschiene ${bedingungszeichenName(betriebsart, bezeichnung, angaben)}`;
  const [schienenLinie] = schiene.rail;
  if (schienenLinie?.type !== 'line') throw new Error('Die Schiene des Pakets ist eine Linie.');
  const zusatz = bedingungszeichenZusatz(angaben);
  return (
    <g role="img" aria-label={name} className={className}>
      <title>{name}</title>
      <line
        data-teil="schiene"
        x1={inEinheiten(schienenLinie.x1)}
        y1={inEinheiten(schienenLinie.y1)}
        x2={inEinheiten(schienenLinie.x2)}
        y2={inEinheiten(schienenLinie.y2)}
        stroke="currentColor"
        strokeWidth={strich}
        strokeLinecap="square"
      />
      <Teile teile={schiene.sign.outline} strich={strich} />
      <Teile teile={schiene.sign.label} />
      {zusatz ? (
        <text
          x={inEinheiten(schiene.sign.center[0])}
          y={y + BEDINGUNGSZEICHEN_HOEHE / 2 + HINWEIS_ABSTAND}
          fontSize={HINWEIS_SCHRIFT}
          textAnchor="middle"
          dominantBaseline="hanging"
          fill="currentColor"
          style={SCHRIFT_TEXT}
        >
          {zusatz}
        </text>
      ) : null}
    </g>
  );
}

/**
 * Stützpunkte in Millimetern ohne aufeinanderfolgende Doppel; `null`, wenn kein Abschnitt mit
 * Länge bleibt. Verglichen wird nach der Umrechnung, weil zwei Punkte, die in Einheiten eben
 * noch verschieden sind, in Millimetern zusammenfallen können (das Paket lehnt sie dann ab).
 */
function verlauf(punkte: readonly Punkt[]): Point[] | null {
  const mm = punkte.map(punktInMm);
  const ohneDoppel = mm.filter(([x, y], i) => i === 0 || x !== mm[i - 1][0] || y !== mm[i - 1][1]);
  return ohneDoppel.length >= 2 ? ohneDoppel : null;
}

/**
 * Linie, Marke und Wort einer Leitung auf einem Linienzug (`commsLink`): glatt oder mit
 * Zickzack-Marke, durchgezogen oder gestrichelt mit dem Wort „geplant“. Sitzt ein Zeichen der
 * Verbindungsart in der Mitte, trägt es die Marke, und das Wort hält dessen halbe Größe Abstand.
 */
export function Leitungsbild({
  punkte,
  medium,
  status,
  art,
  strich,
  linienTeil = 'linie',
}: {
  punkte: readonly Punkt[];
  medium: Verbindungsmedium;
  status: Verbindungsstatus;
  art?: Verbindungsart | null;
  strich: number;
  /** `data-teil` der Linie. */
  linienTeil?: string;
}) {
  const pfad = verlauf(punkte);
  if (!pfad) return null;
  const leitung = commsLink({
    path: pfad,
    medium: medium === 'funk' ? 'radio' : 'wire',
    status: status === 'geplant' ? 'planned' : 'existing',
    mark: !art,
    clearanceMm: art ? inMm(ZEICHEN_GROESSE / 2) : undefined,
  });
  const { point, angleDeg } = leitung.anchor;
  return (
    <>
      <g data-teil={linienTeil}>
        <Teile teile={leitung.line} strich={strich} />
      </g>
      {art ? (
        <g data-teil="art">
          <Piktogramm
            primitive={zeichenPrimitive(verbindungsartPiktogramm(art, medium))}
            x={inEinheiten(point[0])}
            y={inEinheiten(point[1])}
            groesse={ZEICHEN_GROESSE}
            winkel={angleDeg}
          />
        </g>
      ) : leitung.mark.length > 0 ? (
        // Der Grund unterbricht die Linie, damit die Marke auch in Graustufen allein steht.
        <g data-teil="funk" aria-hidden="true">
          <Teile teile={leitung.mark} strich={strich} />
        </g>
      ) : null}
      <Teile teile={leitung.word} teil="geplant" />
    </>
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
  const name = leitungsBeschreibung({ art, medium, status, bezug });
  return (
    <g role="img" aria-label={name} className={className}>
      <title>{name}</title>
      <Leitungsbild
        punkte={[von, nach]}
        medium={medium}
        status={status}
        art={art}
        strich={hervorgehoben ? STRICH_HERVORGEHOBEN : STRICH}
      />
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
        primitive={zeichenPrimitive(verbindungsartPiktogramm(art, medium))}
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
        primitive={zeichenPrimitive(komponentenPiktogramm(art))}
        x={x}
        y={y}
        groesse={groesse}
      />
      {bezeichnung ? (
        <text
          x={x}
          y={y + groesse / 2 + BESCHRIFTUNG_ABSTAND}
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
  const bereich =
    breite > 0 && hoehe > 0
      ? commsArea({
          x: inMm(x),
          y: inMm(y),
          width: inMm(breite),
          height: inMm(hoehe),
          label: bezeichnung,
        })
      : null;
  return (
    <g role="img" aria-label={name} className={className}>
      <title>{name}</title>
      {bereich ? (
        <>
          <g data-teil="grenze">
            <Teile
              teile={bereich.boundary}
              strich={hervorgehoben ? STRICH_HERVORGEHOBEN : STRICH}
            />
          </g>
          <Teile teile={bereich.label} />
        </>
      ) : null}
    </g>
  );
}
