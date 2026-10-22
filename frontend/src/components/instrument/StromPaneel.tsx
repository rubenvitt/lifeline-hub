import { useRef, type ReactNode } from 'react';
import DashboardPaneel, { type DashboardPaneelBasis } from './DashboardPaneel';
import Sammelbanner from './Sammelbanner';
import { useRollen } from './rollenwerte';

/**
 * StromPaneel — jüngste Einträge eines Zeitstroms, Neues per Sammelbanner statt Einschieben
 * (Regel „Dashboard-Baukasten“, `frontend/AGENTS.md`; Vorbild „Jüngste ETB-Einträge“ im Lagebild,
 * LLH-1140). Abnehmer: ETB-Einträge im Lagebild, Entscheidungen im Überblick.
 *
 * Die Kinder sind die `<li>` der Liste, meist `Zeitachseneintrag als="li"` (Mono, Typfarbe).
 * Der Aufrufer hält die Wassermarke: `neu` zählt, was über ihr liegt, `onAnzeigen` zieht sie
 * nach. Live-Updates springen nicht unter dem Cursor (Layout und Live, CLS ≤ 0,1).
 *
 * DER BANNER LIEGT ÜBER DEM LISTENKOPF (LFH-900, Muster `InfotelefonPage`): im Fluss machte er das
 * Paneel höher, die Paneelreihe wuchs mit, und das Band darunter rutschte. `absolute` statt
 * `sticky`: das Paneel ist kein Scrollbereich. Er verdeckt den Kopf der jüngsten gezeigten Zeile,
 * bis „anzeigen“ sie mit dem Neuen freigibt. Die Mindesthöhe ist die des Banners (Knopf
 * `controlHeight` + Innenabstand + Rand): steht nur eine Zeile da, ragte er sonst über das Paneel.
 *
 * Nach „anzeigen“ geht der Fokus auf die Liste (der Knopf verschwindet mit dem Banner; WCAG 2.4.3).
 */
export default function StromPaneel({
  neu,
  bannerText,
  onAnzeigen,
  listeName,
  children,
  ...basis
}: DashboardPaneelBasis & {
  /** Einträge über der Wassermarke; 0 = kein Banner. */
  neu: number;
  bannerText: string;
  onAnzeigen: () => void;
  /** Zugänglicher Name der Liste („Jüngste Einträge“). */
  listeName: string;
  children: ReactNode;
}) {
  const { token } = useRollen();
  const listeRef = useRef<HTMLOListElement>(null);
  return (
    <DashboardPaneel {...basis}>
      <div
        style={{
          position: 'relative',
          minHeight: token.controlHeight + 2 * token.paddingXS + 2,
        }}
      >
        {neu > 0 && (
          <Sammelbanner
            aktion={{
              label: 'anzeigen',
              onKlick: () => {
                listeRef.current?.focus({ preventScroll: true });
                onAnzeigen();
              },
            }}
            style={{ position: 'absolute', insetInline: 0, top: 0, zIndex: 1 }}
          >
            {bannerText}
          </Sammelbanner>
        )}
        <ol
          ref={listeRef}
          tabIndex={-1}
          aria-label={listeName}
          style={{ listStyle: 'none', margin: 0, padding: 0 }}
        >
          {children}
        </ol>
      </div>
    </DashboardPaneel>
  );
}
