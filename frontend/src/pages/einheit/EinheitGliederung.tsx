import { Button } from 'antd';
import { useCallback, useId, type ReactNode } from 'react';
import { useRollen } from '../../components/instrument';

/**
 * Die Paneele der Einheit-Ansicht, zu denen die Gliederung springt (LLH-1797), in der Folge der
 * Seite. Der Wortlaut ist der Titel des Paneels: ein Sprung heißt wie sein Ziel.
 */
export const EINHEIT_ABSCHNITTE = [
  { schluessel: 'besatzung', label: 'Fahrzeuge und Besatzung' },
  { schluessel: 'kopfdaten', label: 'Kopfdaten' },
  { schluessel: 'zeitachse', label: 'Zeitachse' },
  { schluessel: 'material', label: 'Material' },
  { schluessel: 'funk', label: 'Funk' },
  { schluessel: 'zeichen', label: 'Taktisches Zeichen' },
] as const;

export type EinheitAbschnitt = (typeof EINHEIT_ABSCHNITTE)[number]['schluessel'];

/**
 * Anker und Sprung der Gliederung. `anker` gibt die Kennung eines Ziels, `springe` rollt es an den
 * oberen Rand und setzt den Fokus darauf, damit Tastatur und Vorleser dort weitermachen.
 */
export function useEinheitGliederung() {
  const basis = useId();
  const anker = useCallback((s: EinheitAbschnitt) => `${basis}-${s}`, [basis]);
  const springe = useCallback(
    (s: EinheitAbschnitt) => {
      const ziel = document.getElementById(anker(s));
      if (!ziel) return;
      ziel.scrollIntoView({ block: 'start' });
      ziel.focus({ preventScroll: true });
    },
    [anker],
  );
  return { anker, springe };
}

/**
 * Sprungziel um ein Paneel: fokussierbar nur per Sprung (`tabIndex={-1}`), mit Abstand zum oberen
 * Rand, damit der Paneelkopf nach dem Sprung nicht an der Kante klebt.
 */
export function Sprungziel({ id, children }: { id: string; children: ReactNode }) {
  const { token } = useRollen();
  return (
    <div id={id} tabIndex={-1} style={{ scrollMarginTop: token.margin, outline: 'none' }}>
      {children}
    </div>
  );
}

/**
 * Sprungleiste unter dem Seitenkopf (LLH-1797): die Seite einer Einheit ist auf dem Handschirm
 * über 3000 px lang. Alle Paneele bleiben offen untereinander; Reiter hätten eine offene
 * Inline-Angabe ausgehängt. Auf schmalen Schirmen bleibt die Leiste eine Zeile, die in sich rollt.
 */
export default function EinheitGliederung({
  onSprung,
}: {
  onSprung: (s: EinheitAbschnitt) => void;
}) {
  const { token } = useRollen();
  return (
    <nav aria-label="Gliederung">
      <ul
        style={{
          display: 'flex',
          gap: token.marginXXS,
          margin: 0,
          padding: 0,
          listStyle: 'none',
          overflowX: 'auto',
          whiteSpace: 'nowrap',
        }}
      >
        {EINHEIT_ABSCHNITTE.map((a) => (
          <li key={a.schluessel}>
            <Button
              type="text"
              style={{ minHeight: token.controlHeight }}
              onClick={() => onSprung(a.schluessel)}
            >
              {a.label}
            </Button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
