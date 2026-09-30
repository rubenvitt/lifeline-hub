/**
 * Rahmen jeder Ikone des Satzes (LFH-595, Spec `ikonensatz`).
 *
 * Die App zeichnet genau EINEN Ikonensatz: Icons8 „iOS 27 Outlined“, für aktive Zustände der
 * Zwilling „iOS 27 Filled“. Die Quellen liegen in `scripts/ikonen/`, die Komponenten erzeugt
 * `scripts/ikonen/erzeuge-ikonen.mjs` nach `erzeugt.generated.tsx`. Importiert wird nur über
 * `ikonen/index.ts`; `ikonen.guard.test.ts` hält `@ant-design/icons` und `react-icons` fern.
 *
 * ── Warum der Rahmen sich wie eine antd-Ikone verhält ──────────────────────────
 * Aufrufer tauschen nur den Import. Die Ikone misst ohne `size` `1em` und wächst so mit der
 * Schrift, also mit der Dichte-Staffel 30/48/72. Die Hülle trägt die Klasse `anticon`: antd
 * richtet Ikonen in Knöpfen, Menüs, Tags und Eingaben über genau diese Klasse aus (Abstand zum
 * Text, Größe im Suffix). Ihre Grundausrichtung steht zusätzlich inline, weil antd die globale
 * `.anticon`-Regel erst mit seiner ersten eigenen Ikone einspeist.
 *
 * ── Warum immer `aria-hidden` ──────────────────────────────────────────────────
 * Eine Ikone trägt nie allein Bedeutung: den Namen trägt das Wort daneben oder der Knopf, der
 * nur eine Ikone zeigt (`aria-label`). Deshalb gibt es keine Prop für einen Titel.
 */
import type { CSSProperties, JSX } from 'react';
import './ikonen.css';

export interface IkonenProps {
  /** Feste Kantenlänge (px oder CSS-Länge). Ohne Angabe `1em`: die Ikone wächst mit der Schrift. */
  size?: number | string;
  /** Dreht die Ikone (Ladeanzeige). Unter `prefers-reduced-motion: reduce` steht sie still. */
  drehen?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** Eine Ikone des Satzes. Ersetzt `IconType` aus `react-icons`. */
export type Ikone = ((props: IkonenProps) => JSX.Element) & { displayName?: string };

/** Umriss für inaktiv, Füllung für aktiv (Spec: „Aktiver Zustand über die gefüllte Ikone“). */
export interface IkonenPaar {
  umriss: Ikone;
  gefuellt: Ikone;
}

/** Ein Pfad der Quelle. Icons8 zeichnet Konturen als Füllflächen, nicht als Strich. */
export interface Pfad {
  d: string;
  fillRule?: 'evenodd' | 'nonzero';
}

/** Grundausrichtung einer antd-Ikone (`resetIcon` in `antd/es/style`). */
export const ikonenHuelleStil: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  color: 'inherit',
  fontStyle: 'normal',
  lineHeight: 0,
  textAlign: 'center',
  textTransform: 'none',
  verticalAlign: '-0.125em',
};

/** Baut die Komponente zu einem Registereintrag. Nur `erzeugt.generated.tsx` ruft das auf. */
export function ikone(name: string, viewBox: string, pfade: readonly Pfad[]): Ikone {
  function IkoneKomponente({ size, drehen, className, style }: IkonenProps) {
    const kante = size ?? '1em';
    const klassen = ['anticon', 'lfh-ikone', drehen ? 'lfh-ikone-dreht' : null, className]
      .filter(Boolean)
      .join(' ');
    return (
      <span
        aria-hidden="true"
        data-ikone={name}
        className={klassen}
        style={{ ...ikonenHuelleStil, ...style }}
      >
        <svg viewBox={viewBox} width={kante} height={kante} fill="currentColor" focusable="false">
          {pfade.map((p, i) => (
            <path key={i} d={p.d} fillRule={p.fillRule} />
          ))}
        </svg>
      </span>
    );
  }
  IkoneKomponente.displayName = `Ikone(${name})`;
  return IkoneKomponente;
}
