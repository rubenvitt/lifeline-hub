/**
 * Die Elemente der taktischen Fernmeldeskizze als SVG (LFH-893 D12): Kasten der Führungsstelle
 * und der Abschnitte, Einheit als Zeichen ohne Kasten, externe Stelle, Komponente, Schiene,
 * Stichleitung, Verbindung, Bereich und Schriftfeld. Reine Darstellung auf den Plätzen des
 * Layouts (`fernmeldeskizzeLayout.ts`); Bedienung, Fokus und Ziehen trägt
 * `SkizzenFlaeche.tsx`.
 *
 * Farbe: Striche und Schrift in `currentColor`, Lücken und Meldungen zusätzlich als Wort mit
 * Marke (Dreieck mit „!“, Teil des Bildes, kein Icon des Iconsatzes), Hervorhebung über die
 * Strichstärke, „neu“ als Wort mit Rahmen (WCAG 1.4.1, Druck in Graustufen).
 */
import type { CSSProperties, ReactNode } from 'react';
import { useRollen } from '../../components/instrument';
import EinsatzZeichen from '../../zeichen/EinsatzZeichen';
import type { NetzBereich, NetzSchiene, NetzStelle, NetzVerbindung } from '../fernmeldeskizze';
import {
  KASTEN_POLSTER,
  KASTEN_SCHRIFT,
  KASTEN_ZEILE,
  NAME_SCHRIFT,
  NAME_ZEILE,
  RUFNAME_ZEILE,
  TZ_HOEHE,
  schienenLinieY,
  type Platz,
} from '../fernmeldeskizzeLayout';
import { STELLENART_LABEL } from '../kommunikationsplan';
import {
  BereichsRahmen,
  GEPLANT_SCHRIFT,
  KomponentenZeichen,
  Leitung,
  STRICH,
  STRICHMUSTER_GEPLANT,
  STRICH_HERVORGEHOBEN,
  Sammelschiene,
  umbrich,
} from '../skizzenZeichen';
import type { Punkt } from './ansicht';
import { zeichenMitte } from './geometrie';
import type { SchriftfeldBlock } from './schriftfeld';

const SCHRIFT_TEXT: CSSProperties = { fontFamily: 'var(--lfh-schrift-text)' };
const SCHRIFT_MONO: CSSProperties = {
  fontFamily: 'var(--lfh-schrift-zahl)',
  fontVariantNumeric: 'tabular-nums',
};
const ZEICHEN_ABSTAND = 4;
const MARKE = 10;

/** Kantenlänge des taktischen Zeichens in px (ganzzahlig, die Bibliothek verlangt es). */
const TZ_PX = TZ_HOEHE;

/** Darstellungszustand eines Elements. */
export interface Zustand {
  hervorgehoben: boolean;
  /** Tritt zurück (Filter oder Hervorhebung eines anderen Elements). */
  zurueck: boolean;
}

/**
 * Deckkraft eines zurückgenommenen Elements: es tritt zurück, sein Text hält aber in beiden Modi
 * den Boden 4,5 : 1 (Prüfliste Kriterium 5, gerechnet in `zurueckKontrast.test.ts`; 0,55 fällt im
 * hellen Modus darunter). Die Hervorhebung trägt die Strichstärke, nicht die Deckkraft.
 */
export const ZURUECK_DECKKRAFT = 0.6;

/** Warnmarke: Dreieck mit „!“ — Zeichen der Skizze, steht immer neben einem Wort. */
export function LueckenMarke({ x, y }: { x: number; y: number }) {
  const h = MARKE;
  return (
    <g aria-hidden="true" data-teil="lueckenmarke">
      <polygon
        points={`${x},${y + h / 2} ${x + h / 2},${y - h / 2} ${x + h},${y + h / 2}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
        strokeLinejoin="round"
      />
      <text
        x={x + h / 2}
        y={y + h / 2 - 1.5}
        fontSize={7}
        fontWeight={700}
        textAnchor="middle"
        fill="currentColor"
        style={SCHRIFT_TEXT}
      >
        !
      </text>
    </g>
  );
}

/** Zeile mit Marke und Wort, z. B. „keine Sprechgruppe“ (Lücke) oder eine Meldung. */
function MarkenZeile({
  x,
  y,
  text,
  anker = 'start',
}: {
  x: number;
  y: number;
  text: string;
  anker?: 'start' | 'middle';
}) {
  const { rollen } = useRollen();
  // Bei mittiger Ausrichtung steht die Marke links vor dem Wort.
  const breite = text.length * NAME_SCHRIFT * 0.55;
  const mx = anker === 'middle' ? x - breite / 2 - MARKE - 2 : x;
  const tx = anker === 'middle' ? x + (MARKE + 2) / 2 : x + MARKE + 3;
  return (
    <g data-teil="luecke" style={{ color: rollen.achtungText }}>
      <LueckenMarke x={mx} y={y} />
      <text
        x={tx}
        y={y}
        fontSize={NAME_SCHRIFT - 1}
        textAnchor={anker}
        dominantBaseline="central"
        fill="currentColor"
        style={SCHRIFT_TEXT}
      >
        {text}
      </text>
    </g>
  );
}

/** Mehrzeiliger, mittiger Text; bricht um, kürzt nie. */
function Zeilen({
  x,
  y,
  text,
  schrift,
  zeile,
  breite,
  fett,
}: {
  x: number;
  y: number;
  text: string;
  schrift: number;
  zeile: number;
  breite: number;
  fett?: boolean;
}) {
  return (
    <text
      x={x}
      y={y}
      fontSize={schrift}
      fontWeight={fett ? 600 : 400}
      textAnchor="middle"
      fill="currentColor"
      style={SCHRIFT_TEXT}
    >
      {umbrich(text, schrift, breite).map((z, i) => (
        <tspan key={i} x={x} dy={i === 0 ? schrift : zeile}>
          {z}
        </tspan>
      ))}
    </text>
  );
}

function zeilenHoehe(text: string, schrift: number, zeile: number, breite: number): number {
  return umbrich(text, schrift, breite).length * zeile;
}

/** Das taktische Zeichen auf einem Platz (verschachteltes SVG der Bibliothek). */
function Taktisch({ stelle, x, y }: { stelle: NetzStelle; x: number; y: number }) {
  if (stelle.art === 'komponente') return null;
  const tz =
    stelle.art === 'extern'
      ? // Externe Stellen tragen das Grundzeichen der Befehlsstelle, ohne Fachaufgabe.
        { grundzeichen: 'befehlsstelle' as const }
      : stelle.tz;
  return (
    <g transform={`translate(${x - TZ_PX / 2} ${y})`} aria-hidden="true" data-teil="tz">
      <EinsatzZeichen tz={tz} size={TZ_PX} />
    </g>
  );
}

/** Text der Rufnamen-Zeile; nie geraten. */
export function rufnamenZeile(s: NetzStelle): string | null {
  if (s.art === 'komponente') return null;
  if (s.art === 'extern') return STELLENART_LABEL[s.stellenart];
  if (s.art === 'fuehrungsstelle' && !s.erfasst) return null;
  return s.rufname ?? 'kein Rufname';
}

/** Die Bezeichnung, wie sie am Element steht (Führungsstelle ohne Gegenstelle mit Grund). */
export function anzeigeName(s: NetzStelle): string {
  return s.art === 'fuehrungsstelle' && s.hinweis
    ? `${s.bezeichnung}: ${s.hinweis}`
    : s.bezeichnung;
}

export function StelleBild({
  stelle,
  platz,
  zustand,
  meldung,
}: {
  stelle: NetzStelle;
  platz: Platz;
  zustand: Zustand;
  meldung?: string | null;
}) {
  const strich = zustand.hervorgehoben ? STRICH_HERVORGEHOBEN : STRICH;
  const cx = platz.x + platz.breite / 2;
  const luecke = stelle.luecken.map((l) => l.text).join(' · ');

  if (stelle.art === 'komponente') {
    const mitte = zeichenMitte(stelle, platz);
    return (
      <g data-teil="stelle">
        <KomponentenZeichen
          art={stelle.komponentenart}
          x={mitte.x}
          y={mitte.y}
          bezeichnung={stelle.bezeichnung}
        />
        {meldung ? (
          <MarkenZeile x={cx} y={platz.y + platz.hoehe + 8} text={meldung} anker="middle" />
        ) : null}
      </g>
    );
  }

  const kasten = stelle.art === 'fuehrungsstelle' || stelle.art === 'abschnitt';
  const name = anzeigeName(stelle);
  const ruf = rufnamenZeile(stelle);
  const innen = kasten ? platz.breite - 2 * KASTEN_POLSTER : platz.breite;
  const tzY = kasten ? platz.y + KASTEN_POLSTER : platz.y;
  const nameY = tzY + TZ_HOEHE + ZEICHEN_ABSTAND;
  const schrift = kasten ? KASTEN_SCHRIFT : NAME_SCHRIFT;
  const zeile = kasten ? KASTEN_ZEILE : NAME_ZEILE;
  const rufY = nameY + zeilenHoehe(name, schrift, zeile, innen);
  // Ein langer Rufname bricht um wie die Bezeichnung (Messung 1.1); der Platz wächst in
  // `stellenMasse` um dieselben Zeilen mit.
  const rufZeilen = ruf ? umbrich(ruf, NAME_SCHRIFT, innen) : [];
  const lueckeY = rufY + Math.max(1, rufZeilen.length) * RUFNAME_ZEILE;
  return (
    <g data-teil="stelle">
      {kasten ? (
        <rect
          x={platz.x}
          y={platz.y}
          width={platz.breite}
          height={platz.hoehe}
          fill="none"
          style={{ fill: 'var(--lfh-skizze-grund, var(--lfh-flaeche))' }}
          stroke="currentColor"
          strokeWidth={strich}
          data-teil="kasten"
        />
      ) : zustand.hervorgehoben ? (
        // Ohne Kasten trägt ein Unterstrich unter dem Namen die Hervorhebung (Form, nicht Farbe).
        <line
          data-teil="unterstrich"
          x1={platz.x + 8}
          x2={platz.x + platz.breite - 8}
          y1={rufY - 1}
          y2={rufY - 1}
          stroke="currentColor"
          strokeWidth={STRICH_HERVORGEHOBEN}
        />
      ) : null}
      <Taktisch stelle={stelle} x={cx} y={tzY} />
      <Zeilen
        x={cx}
        y={nameY}
        text={name}
        schrift={schrift}
        zeile={zeile}
        breite={innen}
        fett={kasten}
      />
      {ruf ? (
        <text
          x={cx}
          y={rufY + RUFNAME_ZEILE / 2}
          fontSize={NAME_SCHRIFT}
          textAnchor="middle"
          dominantBaseline="central"
          // Auch „kein Rufname“ in Textfarbe: zurückgenommen (Deckkraft 0,6) hielte `gedaempft`
          // nur 3,35 : 1 (Prüfliste Kriterium 5). Das Wort und die Textschrift statt der
          // Festbreitenschrift eines Rufnamens tragen die Unterscheidung.
          fill="currentColor"
          style={stelle.art === 'extern' || !stelle.rufname ? SCHRIFT_TEXT : SCHRIFT_MONO}
        >
          {rufZeilen.length === 1
            ? ruf
            : rufZeilen.map((z, i) => (
                <tspan key={i} x={cx} dy={i === 0 ? 0 : RUFNAME_ZEILE}>
                  {z}
                </tspan>
              ))}
        </text>
      ) : null}
      {luecke ? <MarkenZeile x={cx} y={lueckeY + 8} text={luecke} anker="middle" /> : null}
      {meldung ? (
        <MarkenZeile x={cx} y={platz.y + platz.hoehe + 10} text={meldung} anker="middle" />
      ) : null}
    </g>
  );
}

export function SchieneBild({
  schiene,
  platz,
  zustand,
  meldung,
}: {
  schiene: NetzSchiene;
  platz: Platz;
  zustand: Zustand;
  meldung?: string | null;
}) {
  const y = schienenLinieY(platz);
  const luecke = schiene.luecken.map((l) => l.text).join(' · ');
  return (
    <g data-teil="schiene-bild">
      <Sammelschiene
        x={platz.x}
        y={y}
        breite={platz.breite}
        betriebsart={schiene.betriebsart}
        bezeichnung={schiene.bezeichnung}
        hinweis={schiene.hinweis}
        zeichenX={platz.zeichenX ?? undefined}
        hervorgehoben={zustand.hervorgehoben}
      />
      {luecke ? <MarkenZeile x={platz.x} y={y + 30} text={luecke} /> : null}
      {meldung ? <MarkenZeile x={platz.x} y={y - 20} text={meldung} /> : null}
    </g>
  );
}

/** Stichleitung als rechtwinkliger Linienzug; geplant gestrichelt mit dem Wort (D7). */
export function StichBild({
  punkte,
  geplant,
  zustand,
}: {
  punkte: Punkt[];
  geplant: boolean;
  zustand: Zustand;
}) {
  const strich = zustand.hervorgehoben ? STRICH_HERVORGEHOBEN : STRICH;
  const a = punkte[punkte.length - 2] ?? punkte[0];
  const b = punkte[punkte.length - 1];
  return (
    <g data-teil="stich">
      <polyline
        points={punkte.map((p) => `${p.x},${p.y}`).join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth={strich}
        strokeDasharray={geplant ? STRICHMUSTER_GEPLANT : undefined}
        data-teil="stich-linie"
      />
      {geplant ? (
        <text
          data-teil="geplant"
          x={(a.x + b.x) / 2 + 4}
          y={(a.y + b.y) / 2}
          fontSize={GEPLANT_SCHRIFT}
          dominantBaseline="central"
          fill="currentColor"
          style={SCHRIFT_TEXT}
        >
          geplant
        </text>
      ) : null}
    </g>
  );
}

export function VerbindungBild({
  verbindung,
  von,
  nach,
  zustand,
  bezug,
}: {
  verbindung: NetzVerbindung;
  von: Punkt;
  nach: Punkt;
  zustand: Zustand;
  bezug: string;
}) {
  return (
    <Leitung
      von={von}
      nach={nach}
      medium={verbindung.medium}
      status={verbindung.status}
      art={verbindung.art}
      bezug={bezug}
      hervorgehoben={zustand.hervorgehoben}
    />
  );
}

export function BereichBild({ bereich, zustand }: { bereich: NetzBereich; zustand: Zustand }) {
  return (
    <BereichsRahmen
      x={bereich.x}
      y={bereich.y}
      breite={bereich.breite}
      hoehe={bereich.hoehe}
      bezeichnung={bereich.bezeichnung}
      hervorgehoben={zustand.hervorgehoben}
    />
  );
}

/** Schriftfeld unten rechts im Bild (D13). */
export function SchriftfeldBild({
  x,
  y,
  block,
  hervorgehoben,
}: {
  x: number;
  y: number;
  block: SchriftfeldBlock;
  hervorgehoben: boolean;
}) {
  return (
    <g data-teil="schriftfeld" transform={`translate(${x} ${y})`}>
      <rect
        width={block.breite}
        height={block.hoehe}
        fill="none"
        style={{ fill: 'var(--lfh-skizze-grund, var(--lfh-flaeche))' }}
        stroke="currentColor"
        strokeWidth={hervorgehoben ? STRICH_HERVORGEHOBEN : STRICH}
      />
      {block.linien.map((ly) => (
        <line
          key={ly}
          x1={0}
          x2={block.breite}
          y1={ly}
          y2={ly}
          stroke="currentColor"
          strokeWidth={1}
        />
      ))}
      {block.zeilen.map((z, i) => (
        <text
          key={i}
          x={z.x}
          y={z.y}
          fontSize={z.schrift}
          fontWeight={z.fett ? 600 : 400}
          fill="currentColor"
          style={SCHRIFT_TEXT}
        >
          {z.text}
        </text>
      ))}
    </g>
  );
}

/** „neu“ als Wort mit Rahmen über der rechten oberen Ecke (Spec „Neue Einheit unter dem Zeiger“). */
export function NeuMarke({ platz }: { platz: Platz }) {
  const breite = 28;
  const x = platz.x + platz.breite - breite;
  const y = platz.y - 14;
  return (
    <g data-teil="neu" aria-hidden="true">
      <rect
        x={x}
        y={y}
        width={breite}
        height={12}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
      />
      <text
        x={x + breite / 2}
        y={y + 6}
        fontSize={9}
        textAnchor="middle"
        dominantBaseline="central"
        fill="currentColor"
        style={SCHRIFT_TEXT}
      >
        neu
      </text>
    </g>
  );
}

/** Rahmen um das gewählte bzw. fokussierte Element. Fokus in `bedien` (Fokusring), Wahl als Form. */
export function Rahmen({
  r,
  art,
  skala,
}: {
  r: { x: number; y: number; breite: number; hoehe: number };
  art: 'wahl' | 'fokus';
  skala: number;
}): ReactNode {
  const { rollen } = useRollen();
  // Pixelmaße unabhängig vom Zoom: 2 px Strich, Abstand 4 bzw. 7 px.
  const abstand = (art === 'wahl' ? 4 : 7) / skala;
  return (
    <rect
      data-teil={art === 'wahl' ? 'wahlrahmen' : 'fokusrahmen'}
      x={r.x - abstand}
      y={r.y - abstand}
      width={r.breite + 2 * abstand}
      height={r.hoehe + 2 * abstand}
      fill="none"
      stroke={art === 'fokus' ? rollen.bedien : 'currentColor'}
      strokeWidth={2 / skala}
      strokeDasharray={art === 'wahl' ? `${6 / skala} ${3 / skala}` : undefined}
      pointerEvents="none"
    />
  );
}
