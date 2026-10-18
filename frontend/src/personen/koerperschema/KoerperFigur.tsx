import { useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { VerletzungAnsicht } from '../../api/types';
import { useRollen } from '../../components/instrument';
import { koerperschemaFarben, schrift } from '../../theme/tokens';
import {
  RAHMEN,
  ZONEN,
  inEinheiten,
  umrissPfad,
  zoneVon,
  type Figur,
  type Punkt,
  type Zone,
} from './geometrie';
import { VERLETZUNG_ART_WORT } from '../personMeta';
import { regionName, type NummerierteVerletzung } from './koerperschemaKern';

/**
 * Eine Ansicht des Körperschemas als Zeichnung (LLH-1120, design.md D13): Silhouette, darüber die
 * Trefferzonen (nur beim Markieren), darüber die Sternchen. Eine Zeichnung, kein Icon (Spec
 * `iconsatz`): Striche und Schrift aus Rollen, im Druck `currentColor` ohne Fläche.
 *
 * STERNCHEN: sechsstrahlig in der Textfarbe, die Nummer daneben in Mono — Teil der Zeichnung, nicht
 * des Iconsatzes. Die Nummer trägt die Unterscheidung (Form und Zahl, nie Farbe), damit das Blatt
 * schwarz-weiß lesbar bleibt.
 *
 * TREFFERZONEN: je Region ein `<g role="button">` aus durchsichtigen Rechtecken
 * (`fill-opacity: 0`, nimmt aber Zeiger an). Roving-Tabindex in der festen Folge aus `ZONEN`,
 * Pfeiltasten wandern, Pos1/Ende springen, Enter und Leertaste wählen. Fokus und Wahl zeichnen
 * den Umriss der Zone in `bedien`.
 */

export type FigurModus = 'lesen' | 'markieren' | 'druck' | 'mini';

export interface KoerperFigurProps {
  ansicht: VerletzungAnsicht;
  figur: Figur;
  /** Pixel je Einheit des Entwurfsrasters. */
  massstab: number;
  modus: FigurModus;
  /** Die gültigen Verletzungen dieser Ansicht mit ihrer festen Nummer. */
  sterne: readonly NummerierteVerletzung[];
  /** Die gewählte Region dieser Ansicht (Wahl der Art offen). */
  gewaehlt?: KoerperZiel | null;
  /** Der gewählte Stern (Aufheben angeboten). */
  gewaehlterStern?: number | null;
  /** Gesperrt: Zonen und Sterne bedienen nichts (ohne Netz, Speichern läuft). */
  gesperrt?: boolean;
  onRegion?: (ziel: KoerperZiel) => void;
  onStern?: (verletzungId: number) => void;
}

/** Was ein Tipp auf die Figur trifft: Region und, falls gemessen, die Tippstelle in Einheiten. */
export interface KoerperZiel {
  ansicht: VerletzungAnsicht;
  zone: Zone;
  tipp: Punkt | null;
}

/** Größe von Sternchen und Nummer in Pixeln, unabhängig vom Maßstab. */
const STERN_PX: Record<FigurModus, number> = { lesen: 9, markieren: 10, druck: 9, mini: 5 };
const NUMMER_PX: Record<FigurModus, number> = { lesen: 13, markieren: 14, druck: 12, mini: 9 };

/** Sechs Strahlen eines Sternchens um (0, 0), Radius `r`. */
function sternPfad(r: number): string {
  return [0, 60, 120]
    .map((grad) => {
      const w = (grad * Math.PI) / 180;
      const dx = Math.sin(w) * r;
      const dy = Math.cos(w) * r;
      return `M${-dx} ${-dy}L${dx} ${dy}`;
    })
    .join('');
}

/** Tippstelle in Einheiten, sofern gemessen (Maus, Touch); per Tastatur `null`. */
function tippstelle(e: MouseEvent<SVGGElement>): Punkt | null {
  if (e.detail === 0) return null;
  const svg = e.currentTarget.ownerSVGElement;
  const r = svg?.getBoundingClientRect();
  if (!r || r.width === 0 || r.height === 0) return null;
  return [
    ((e.clientX - r.left) / r.width) * RAHMEN.breite,
    ((e.clientY - r.top) / r.height) * RAHMEN.hoehe,
  ];
}

export default function KoerperFigur({
  ansicht,
  figur,
  massstab,
  modus,
  sterne,
  gewaehlt = null,
  gewaehlterStern = null,
  gesperrt = false,
  onRegion,
  onStern,
}: KoerperFigurProps) {
  const { rollen } = useRollen();
  const farben = koerperschemaFarben(rollen);
  const zonen = ZONEN[ansicht];
  const knoepfe = useRef<(SVGGElement | null)[]>([]);
  const [fokusIndex, setFokusIndex] = useState(0);
  const [fokussiert, setFokussiert] = useState<number | null>(null);
  const bedienbar = modus === 'markieren' && !gesperrt;
  const druck = modus === 'druck';
  const einheit = 1 / massstab;

  function taste(e: KeyboardEvent<SVGGElement>, index: number) {
    const letzter = zonen.length - 1;
    const ziel =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? index === letzter
          ? 0
          : index + 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? index === 0
            ? letzter
            : index - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? letzter
              : null;
    if (ziel != null) {
      e.preventDefault();
      setFokusIndex(ziel);
      knoepfe.current[ziel]?.focus();
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onRegion?.({ ansicht, zone: zonen[index], tipp: null });
    }
  }

  const name = `Figur ${ansicht}`;
  return (
    <svg
      viewBox={`0 0 ${RAHMEN.breite} ${RAHMEN.hoehe}`}
      width={RAHMEN.breite * massstab}
      height={RAHMEN.hoehe * massstab}
      role={bedienbar ? 'group' : 'img'}
      aria-label={name}
      data-lfh="koerperfigur"
      data-ansicht={ansicht}
      data-figur={figur}
      style={{
        display: 'block',
        flex: '0 0 auto',
        maxWidth: '100%',
        height: 'auto',
        overflow: 'visible',
      }}
    >
      <path
        d={umrissPfad(figur)}
        fill={druck ? 'none' : farben.silhouette}
        stroke={druck ? 'currentColor' : farben.kontur}
        strokeWidth={1.5 * einheit}
        strokeLinejoin="miter"
      />

      {bedienbar &&
        zonen.map((zone, index) => {
          const aktiv = gewaehlt?.zone.region === zone.region || fokussiert === index;
          return (
            <g
              key={zone.region}
              ref={(el) => {
                knoepfe.current[index] = el;
              }}
              role="button"
              aria-label={regionName(ansicht, zone.region)}
              aria-pressed={gewaehlt?.zone.region === zone.region}
              tabIndex={index === fokusIndex ? 0 : -1}
              data-lfh="koerperzone"
              data-region={zone.region}
              style={{ cursor: 'pointer', outline: 'none' }}
              onFocus={() => {
                setFokusIndex(index);
                setFokussiert(index);
              }}
              onBlur={() => setFokussiert((f) => (f === index ? null : f))}
              onClick={(e) => onRegion?.({ ansicht, zone, tipp: tippstelle(e) })}
              onKeyDown={(e) => taste(e, index)}
            >
              {zone.flaechen.map((r) => (
                <rect
                  key={`${r.x}:${r.y}`}
                  x={r.x}
                  y={r.y}
                  width={r.b}
                  height={r.h}
                  fill="currentColor"
                  fillOpacity={0}
                  pointerEvents="all"
                  stroke={aktiv ? farben.bedien : 'none'}
                  strokeWidth={2 * einheit}
                />
              ))}
            </g>
          );
        })}

      {sterne.map(({ nummer, verletzung: v }) => {
        const [x, y] =
          v.x != null && v.y != null
            ? inEinheiten(v.x, v.y)
            : (zoneVon(v.ansicht, v.region)?.mitte ?? [RAHMEN.breite / 2, RAHMEN.hoehe / 2]);
        const r = STERN_PX[modus] * einheit;
        const nummerGroesse = NUMMER_PX[modus] * einheit;
        const sternBedienbar = bedienbar && onStern != null;
        const gewaehltHier = gewaehlterStern === v.id;
        return (
          <g
            key={v.id}
            data-lfh="stern"
            data-nummer={nummer}
            transform={`translate(${x} ${y})`}
            color={druck ? undefined : farben.stern}
            {...(sternBedienbar
              ? {
                  role: 'button',
                  tabIndex: 0,
                  'aria-label': `Verletzung ${nummer}, ${regionName(v.ansicht, v.region)} · ${VERLETZUNG_ART_WORT[v.art]}`,
                  'aria-pressed': gewaehltHier,
                  style: { cursor: 'pointer', outline: 'none' },
                  onClick: () => onStern?.(v.id),
                  onKeyDown: (e: KeyboardEvent<SVGGElement>) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onStern?.(v.id);
                    }
                  },
                }
              : { 'aria-hidden': true })}
          >
            {sternBedienbar && (
              // Trefferfläche des Sternchens: so groß wie eine Zone, damit es im Handschuh trifft.
              <rect
                x={-r * 2}
                y={-r * 2}
                width={r * 4}
                height={r * 4}
                fill="currentColor"
                fillOpacity={0}
                pointerEvents="all"
                stroke={gewaehltHier ? farben.bedien : 'none'}
                strokeWidth={2 * einheit}
              />
            )}
            <path
              d={sternPfad(r)}
              stroke="currentColor"
              strokeWidth={2.5 * einheit}
              strokeLinecap="square"
            />
            <text
              x={r + 2 * einheit}
              y={-r * 0.6}
              fontSize={nummerGroesse}
              fontFamily={schrift.zahl}
              fontWeight={700}
              fill="currentColor"
              stroke={druck ? 'none' : farben.silhouette}
              strokeWidth={3 * einheit}
              paintOrder="stroke"
            >
              {nummer}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
