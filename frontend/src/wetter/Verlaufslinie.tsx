/**
 * 24-h-Verlauf eines Pegels als schlanke Linie (LFH-633, design.md D5).
 *
 * Eigenes SVG statt Diagramm-Bibliothek: eine Reihe, ≤ 96 Punkte, keine Achsen außer der
 * Zeitspanne — das trägt kein Paket im Bundle.
 *
 * Festlegungen, jede im Test gepinnt:
 *  - **Festes 24-h-Fenster, das am jüngsten Punkt endet.** Eine kürzere Reihe (etwa die alten
 *    3 h vor dem ersten 24-h-Abruf) steht am rechten Rand statt über die ganze Breite gedehnt
 *    — sonst sähe ein Anstieg über drei Stunden aus wie einer über einen Tag.
 *  - **Mindestspanne {@link MIN_SPANNE_CM}.** Ein Pegel, der um 1 cm schwankt, darf nicht die
 *    volle Höhe füllen: das läse sich wie ein Hochwasser.
 *  - **Die Farbe trägt keine Bedeutung.** Die Linie steht in der Textfarbe; ob der Pegel
 *    steigt, sagt das Wort in der Zeile daneben. Beschriftet sind nur Tiefst- und Höchstwert
 *    (Beschriftung selektiv), die Zeitspanne und — falls gepflegt — die Prognose als
 *    gestrichelte Hilfslinie.
 *  - **Zugänglich als ein Bild mit Aussage** („Verlauf 24 h: 5,62 m bis 6,84 m, zuletzt
 *    steigend"); die sichtbaren Beschriftungen sind dafür `aria-hidden`, sonst läse ein
 *    Vorleser dieselben Zahlen zweimal. Der Zeiger zeigt den nächstgelegenen Messpunkt als
 *    Ablesung — sie ergänzt, sie ersetzt nichts: Tiefst-, Höchst- und aktueller Wert stehen
 *    auch ohne Zeiger da.
 */
import { useState, type PointerEvent } from 'react';
import { formatUhrzeit, DEFAULT_KONVENTIONEN, type AnzeigeKonventionen } from '../anzeige/format';
import { monoStil, useRollen } from '../components/instrument';
import { wasserstandMeter, type TrendRichtung } from '../pegel/pegelKennzahl';

/** Kleinste dargestellte Spanne in cm (Mindesthöhe der y-Achse). */
export const MIN_SPANNE_CM = 20;
/** Breite des Zeitfensters. */
export const FENSTER_MS = 24 * 60 * 60_000;
/** Luft über und unter der Spanne, als Anteil der Spanne. */
const LUFT = 0.08;

/** Ein Punkt der Reihe, wie ihn `GET …/pegel/verlauf` liefert. */
export interface VerlaufsPunkt {
  zeitpunkt: string;
  wasserstand_cm: number;
}

export interface VerlaufsGeometrie {
  /** SVG-Pfad (`M x y L x y …`). */
  d: string;
  punkte: { x: number; y: number; t: number; cm: number }[];
  letzter: { x: number; y: number };
  /** Tiefst- und Höchstwert der MESSREIHE (ohne Zusatzwert). */
  minCm: number;
  maxCm: number;
  /** y-Koordinate eines beliebigen Werts in derselben Skala (für die Hilfslinie). */
  yFuer: (cm: number) => number;
}

const runde = (v: number) => Math.round(v * 100) / 100;

/**
 * Geometrie der Linie in einem Feld `breite × hoehe`. `zusatzCm` (die Prognose) zieht die
 * Spanne mit, damit ihre Hilfslinie im Bild liegt. `null` ohne lesbaren Punkt. Rein.
 */
export function verlaufsPfad(
  eingabe: readonly VerlaufsPunkt[],
  breite: number,
  hoehe: number,
  zusatzCm?: number | null,
): VerlaufsGeometrie | null {
  const lesbar = eingabe
    .map((p) => ({ t: Date.parse(p.zeitpunkt), cm: p.wasserstand_cm }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.cm))
    .sort((a, b) => a.t - b.t);
  const juengster = lesbar[lesbar.length - 1];
  if (!juengster) return null;
  const t0 = juengster.t - FENSTER_MS;
  const imFenster = lesbar.filter((p) => p.t >= t0);

  const werte = imFenster.map((p) => p.cm);
  const minCm = Math.min(...werte);
  const maxCm = Math.max(...werte);
  const mitZusatz =
    zusatzCm != null && Number.isFinite(zusatzCm) ? [...werte, zusatzCm] : werte;
  let unten = Math.min(...mitZusatz);
  let oben = Math.max(...mitZusatz);
  const spanne = oben - unten;
  if (spanne < MIN_SPANNE_CM) {
    const mitte = (oben + unten) / 2;
    unten = mitte - MIN_SPANNE_CM / 2;
    oben = mitte + MIN_SPANNE_CM / 2;
  } else {
    unten -= spanne * LUFT;
    oben += spanne * LUFT;
  }
  const yFuer = (cm: number) => hoehe - ((cm - unten) / (oben - unten)) * hoehe;
  const punkte = imFenster.map((p) => ({
    x: ((p.t - t0) / FENSTER_MS) * breite,
    y: yFuer(p.cm),
    t: p.t,
    cm: p.cm,
  }));
  const d = punkte
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${runde(p.x)} ${runde(p.y)}`)
    .join(' ');
  const letzter = punkte[punkte.length - 1];
  return { d, punkte, letzter: { x: letzter.x, y: letzter.y }, minCm, maxCm, yFuer };
}

/** Die Aussage des Bilds in Worten (zugänglicher Name). Rein. */
export function verlaufsAussage(
  minCm: number,
  maxCm: number,
  richtung: TrendRichtung | null,
): string {
  const spanne = `Verlauf 24 h: ${wasserstandMeter(minCm)} m bis ${wasserstandMeter(maxCm)} m`;
  return richtung ? `${spanne}, zuletzt ${richtung}` : spanne;
}

const BREITE = 240;
const HOEHE = 48;
/** Innenrand oben/unten: Platz für die Endmarke (r 4) samt Ring (2). */
const RAND = 6;

export interface VerlaufslinieProps {
  punkte: readonly VerlaufsPunkt[];
  richtung: TrendRichtung | null;
  /** Erwarteter Höchststand in cm — nur übergeben, solange die Prognose offen ist. */
  prognoseCm?: number | null;
  konv?: AnzeigeKonventionen;
}

export default function Verlaufslinie({
  punkte,
  richtung,
  prognoseCm,
  konv = DEFAULT_KONVENTIONEN,
}: VerlaufslinieProps) {
  const { token, rollen } = useRollen();
  const [zeiger, setZeiger] = useState<number | null>(null);
  const g = verlaufsPfad(punkte, BREITE, HOEHE, prognoseCm);
  if (!g) return null;

  const beiZeiger = (e: PointerEvent<SVGSVGElement>) => {
    const rahmen = e.currentTarget.getBoundingClientRect();
    if (rahmen.width <= 0) return;
    const x = ((e.clientX - rahmen.left) / rahmen.width) * BREITE;
    let naechster = 0;
    g.punkte.forEach((p, i) => {
      if (Math.abs(p.x - x) < Math.abs(g.punkte[naechster].x - x)) naechster = i;
    });
    setZeiger(naechster);
  };
  const abgelesen = zeiger != null ? g.punkte[zeiger] : null;
  const zeit = (t: number) => formatUhrzeit(new Date(t).toISOString(), konv);
  const meta = { ...monoStil(11), color: rollen.gedaempft };
  const prognoseY = prognoseCm != null ? g.yFuer(prognoseCm) : null;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        columnGap: token.marginXS,
        rowGap: 2,
        maxWidth: BREITE + 64,
      }}
    >
      <svg
        role="img"
        aria-label={verlaufsAussage(g.minCm, g.maxCm, richtung)}
        viewBox={`0 0 ${BREITE} ${HOEHE + 2 * RAND}`}
        width="100%"
        style={{ display: 'block', height: 'auto', overflow: 'visible', touchAction: 'pan-y' }}
        onPointerMove={beiZeiger}
        onPointerLeave={() => setZeiger(null)}
      >
        <g transform={`translate(0 ${RAND})`} aria-hidden>
          <line x1={0} x2={BREITE} y1={HOEHE} y2={HOEHE} stroke={rollen.rasterLinie} strokeWidth={1} />
          {prognoseY != null && (
            <line
              data-lfh="verlauf-prognose"
              x1={0}
              x2={BREITE}
              y1={prognoseY}
              y2={prognoseY}
              stroke={rollen.gedaempft}
              strokeWidth={1}
              strokeDasharray="4 3"
            />
          )}
          <path
            data-lfh="verlauf-linie"
            data-farbe="text"
            d={g.d}
            fill="none"
            stroke={rollen.text}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {abgelesen && (
            <line
              x1={abgelesen.x}
              x2={abgelesen.x}
              y1={0}
              y2={HOEHE}
              stroke={rollen.gedaempft}
              strokeWidth={1}
            />
          )}
          <circle
            cx={(abgelesen ?? g.letzter).x}
            cy={(abgelesen ?? g.letzter).y}
            r={4}
            fill={rollen.text}
            stroke={rollen.paneel}
            strokeWidth={2}
          />
        </g>
      </svg>
      <div
        aria-hidden
        style={{
          ...meta,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          paddingBlock: RAND / 2,
        }}
      >
        <span>{wasserstandMeter(g.maxCm)} m</span>
        <span>{wasserstandMeter(g.minCm)} m</span>
      </div>
      <div
        aria-hidden
        style={{ ...meta, display: 'flex', justifyContent: 'space-between', gap: token.marginXS }}
      >
        <span>−24 h</span>
        {prognoseCm != null && <span>Prognose {wasserstandMeter(prognoseCm)} m</span>}
        <span>
          {abgelesen
            ? `${zeit(abgelesen.t)} · ${wasserstandMeter(abgelesen.cm)} m`
            : zeit(g.punkte[g.punkte.length - 1].t)}
        </span>
      </div>
    </div>
  );
}
