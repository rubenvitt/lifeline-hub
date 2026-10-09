import { Alert } from 'antd';
import { fehlerText } from '../../components/SpeicherHinweis';
import type { KartenGrund } from './useKartenFehler';

/**
 * Hinweis über der Karte für abgelehnte Kartenhandlungen (LFH-1077, Gründe aus
 * `useKartenFehler`). Im Fluss über der Fläche wie „Lagebild unvollständig“: oben auf der Karte
 * liegen die Überlagerungen. Je Grund ein Banner, damit jede Ablehnung ihren Titel behält; jedes
 * lässt sich schließen, sonst stapelten sich Gründe ohne nächsten Versuch über der Karte.
 */
export function KartenFehlerHinweis({
  gruende,
  onSchliessen,
}: {
  gruende: readonly KartenGrund[];
  /** Verwirft einen Grund (`useKartenFehler().verwirf`). */
  onSchliessen: (schluessel: string) => void;
}) {
  if (gruende.length === 0) return null;
  return (
    <div data-testid="karten-speicherfehler">
      {gruende.map((g) => (
        <Alert
          key={g.schluessel}
          type="error"
          showIcon
          banner
          data-fehler="true"
          closable={{
            'aria-label': 'Hinweis schließen',
            onClose: () => onSchliessen(g.schluessel),
          }}
          title={g.titel}
          description={fehlerText(g.fehler, g.fallback)}
        />
      ))}
    </div>
  );
}
