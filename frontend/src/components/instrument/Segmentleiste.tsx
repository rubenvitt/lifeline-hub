import { useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { useRollen } from './rollenwerte';
import '../../theme/sprache.css';

/**
 * Segmentleiste — Umschalter im Instrumentenstil (Neuentwurf S4 ETB-Filter, S5
 * Basiskarte, S7 Ansicht). Ersatz für antds `Segmented`, dessen Pillenform, Schatten und
 * Gleitanimation die Formensprache (Radius 0, Fugenraster) an genau der Stelle brechen,
 * an der sie sitzt.
 *
 * FUGENRASTER: die Segmente stehen mit `gap: 1px` auf `linieStark`; aktiv `flaeche2` +
 * `text`, inaktiv `flaeche` + `gedaempft`, optional ein 6-px-Farbpunkt (quadratisch —
 * Radius 0 gilt auch für den Punkt). Die Farben und die Zustände Hover/Fokus liegen als
 * Klassen in `theme/sprache.css` (`.lfh-segmente`, `.lfh-segment`), weil `:hover` und
 * `:focus-visible` inline nicht erreichbar sind; die GEOMETRIE steht inline aus den Tokens.
 *
 * ZUGÄNGLICH als `radiogroup` (Vorgabe — eine Wahl unter mehreren, etwa ein Filter) oder
 * als `tablist` (wenn das Segment eine Fläche darunter umschaltet). Tastatur nach APG:
 * ←/→ (und ↑/↓) wandern und wählen, Pos1/Ende springen; nur das gewählte Segment liegt in
 * der Tab-Reihenfolge (roving tabindex).
 *
 * BEDIENZIEL: jedes Segment ist ein `<button>` ohne antd-Höhe, trägt also die ZWEI Angaben
 * aus LFH-365 — `minHeight: token.controlHeight` plus Polsterung aus der Staffel
 * ({@link segmentStil}). Der Entwurf zeichnet 26–30 px; das ist Skizze, die Staffel
 * 30 / 48 / 72 gilt (umsetzung.md § Form & Typografie).
 */

export interface SegmentOption<W extends string | number> {
  wert: W;
  /** Sichtbarer Wortlaut — Pflicht, auch neben einem Farbpunkt. */
  label: string;
  /** Aufgelöste Farbe für den 6-px-Punkt (z. B. `etbTypFarbe(typ, token).kante`). */
  punkt?: string;
  /** Nur `tablist`: Id der Fläche, die dieses Segment zeigt. */
  steuert?: string;
}

/** Geometrie eines Segments — rein und exportiert (Muster `bedienzielStil`). */
export function segmentStil(token: {
  controlHeight: number;
  paddingSM: number;
  marginXS: number;
}): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: token.marginXS,
    minHeight: token.controlHeight,
    paddingInline: token.paddingSM,
    paddingBlock: 0,
  };
}

/** Der Index nach einer Pfeil-/Pos1-/Ende-Taste, oder `null`, wenn die Taste nicht wandert. */
export function naechsterIndex(taste: string, aktuell: number, anzahl: number): number | null {
  if (anzahl === 0) return null;
  switch (taste) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (aktuell + 1) % anzahl;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (aktuell - 1 + anzahl) % anzahl;
    case 'Home':
      return 0;
    case 'End':
      return anzahl - 1;
    default:
      return null;
  }
}

interface SegmentleisteProps<W extends string | number> {
  optionen: readonly SegmentOption<W>[];
  wert: W;
  onWechsel: (wert: W) => void;
  /** Zugänglicher Name der Gruppe — Pflicht („Einträge nach Typ filtern"). */
  beschriftung: string;
  rolle?: 'radiogroup' | 'tablist';
  style?: CSSProperties;
}

export default function Segmentleiste<W extends string | number>({
  optionen,
  wert,
  onWechsel,
  beschriftung,
  rolle = 'radiogroup',
  style,
}: SegmentleisteProps<W>) {
  const { token } = useRollen();
  const knoepfe = useRef<(HTMLButtonElement | null)[]>([]);
  const aktivIndex = Math.max(
    0,
    optionen.findIndex((o) => o.wert === wert),
  );
  const alsTab = rolle === 'tablist';

  const taste = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const ziel = naechsterIndex(e.key, index, optionen.length);
    if (ziel == null) return;
    e.preventDefault();
    onWechsel(optionen[ziel].wert);
    knoepfe.current[ziel]?.focus();
  };

  return (
    <div
      role={rolle}
      aria-label={beschriftung}
      className="lfh-segmente"
      data-lfh="segmentleiste"
      style={style}
    >
      {optionen.map((o, i) => {
        const aktiv = i === aktivIndex;
        return (
          <button
            key={String(o.wert)}
            ref={(el) => {
              knoepfe.current[i] = el;
            }}
            type="button"
            role={alsTab ? 'tab' : 'radio'}
            aria-checked={alsTab ? undefined : aktiv}
            aria-selected={alsTab ? aktiv : undefined}
            aria-controls={alsTab ? o.steuert : undefined}
            tabIndex={aktiv ? 0 : -1}
            className={aktiv ? 'lfh-segment lfh-segment--aktiv' : 'lfh-segment'}
            onClick={() => onWechsel(o.wert)}
            onKeyDown={(e) => taste(e, i)}
            style={segmentStil(token)}
          >
            {o.punkt != null && (
              <span
                aria-hidden="true"
                data-lfh="segment-punkt"
                style={{ width: 6, height: 6, flex: '0 0 6px', background: o.punkt }}
              />
            )}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
