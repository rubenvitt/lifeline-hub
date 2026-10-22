import { Children, type CSSProperties, type ReactNode } from 'react';
import { useViewport } from '../useViewport';
import { useRollen } from './rollenwerte';

/**
 * DashboardFlaeche und PaneelReihe — das Gerüst einer Dashboard-Fläche (Regel
 * „Dashboard-Baukasten“, `frontend/AGENTS.md`, Gestaltungssprache; Vorbild Lagebild, LLH-1140).
 *
 * Die FLÄCHE stapelt ihre Reihen im Fugenraster: 1 px `linie` zwischen den Reihen und als Rahmen.
 * Ihre Kinder tragen keinen eigenen Rand (`Kennzahlenband` mit `border: 'none'`,
 * `DashboardPaneel` im Raster). Reihenfolge: Kennzahlenband · Paneelreihe · Fußband.
 *
 * Die REIHE setzt bis zu drei Paneele nebeneinander, `1fr 1fr 1.1fr` (das letzte, meist der
 * Strom, etwas breiter), zwei als `1fr 1.1fr`; unter `lg` gestapelt. Gezählt werden nur
 * gerenderte Kinder, ein bedingt fehlendes Paneel hinterlässt keine leere Spur.
 *
 * `kennung` setzt `data-lfh` (Greifer der e2e-Messungen, etwa `lagebild-paneele`).
 */

/** Spaltenteilung der Paneelreihe — rein, damit sie ohne Layout prüfbar ist. */
export function paneelReiheSpalten(breit: boolean, anzahl: number): string {
  if (!breit || anzahl <= 1) return 'minmax(0, 1fr)';
  if (anzahl === 2) return 'minmax(0, 1fr) minmax(0, 1.1fr)';
  return 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.1fr)';
}

export function DashboardFlaeche({
  kennung,
  children,
  style,
}: {
  kennung?: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const { rollen } = useRollen();
  return (
    <div
      data-lfh={kennung}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        background: rollen.linie,
        border: `1px solid ${rollen.linie}`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function PaneelReihe({ kennung, children }: { kennung?: string; children: ReactNode }) {
  const { abBreite } = useViewport();
  const anzahl = Children.toArray(children).length;
  return (
    <div
      data-lfh={kennung}
      style={{
        display: 'grid',
        gridTemplateColumns: paneelReiheSpalten(abBreite('lg'), anzahl),
        gap: 1,
      }}
    >
      {children}
    </div>
  );
}
