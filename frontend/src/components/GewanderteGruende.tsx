import { Alert, Flex } from 'antd';
import type { Key } from 'react';
import { fehlerText } from './SpeicherHinweis';
import type { ZeilenGrund } from './useZeilenFehler';

export interface GewanderterGrund {
  schluessel: Key;
  /** Name der Zeile (`„Lagemeldung“`, `Meldung #3`); fehlt er, steht der Grund allein. */
  kennung?: string;
  grund: ZeilenGrund;
}

interface GewanderteGruendeProps {
  gruende: readonly GewanderterGrund[];
  /** Verwirft die gezeigten Gründe im Speicher (`useZeilenFehler().verwirf`). */
  onSchliessen: () => void;
}

/**
 * Gründe abgelehnter Zeilenaktionen, deren Zeile in der gezeigten Ansicht nicht steht (LFH-1077,
 * `frontend/AGENTS.md`, „Rückwege und Fehler“), als EIN Hinweis für den Seitenslot. Alle Gründe,
 * nicht nur der erste. Schließbar: ist die Zeile in eine Ansicht ohne Aktionen gewandert, räumte
 * sonst kein Absenden mehr ihren Grund.
 *
 * Der `key` aus den Schlüsseln hängt den Alert bei einer neuen Menge neu ein: ein geschlossener
 * merkt sich sein Zu intern und bliebe sonst für den nächsten Grund unsichtbar.
 */
export function GewanderteGruende({ gruende, onSchliessen }: GewanderteGruendeProps) {
  if (gruende.length === 0) return null;
  const [einziger] = gruende;
  const text = (g: GewanderterGrund) => fehlerText(g.grund.fehler, g.grund.fallback);
  return (
    <Alert
      key={gruende.map((g) => String(g.schluessel)).join(',')}
      type="error"
      showIcon
      closable={{ 'aria-label': 'Hinweis schließen' }}
      onClose={onSchliessen}
      title={
        gruende.length === 1 && einziger.kennung != null
          ? `${einziger.kennung} nicht geändert`
          : 'Nicht geändert'
      }
      description={
        gruende.length === 1 ? (
          text(einziger)
        ) : (
          <Flex vertical>
            {gruende.map((g) => (
              <span key={String(g.schluessel)}>
                {g.kennung != null ? `${g.kennung} · ${text(g)}` : text(g)}
              </span>
            ))}
          </Flex>
        )
      }
    />
  );
}
