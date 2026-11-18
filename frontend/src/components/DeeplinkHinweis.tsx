import { Alert, theme } from 'antd';
import type { DeeplinkHinweisLage } from '../routing/useQueryParamSelektion';

interface DeeplinkHinweisProps {
  /** Die Lage aus `useQueryParamSelektion`. */
  lage: DeeplinkHinweisLage;
  /** Die Sache im Nominativ, wie sie vor der Kennung steht: „Meldung“, „Fahrzeug“, „Anruf“. */
  sache: string;
}

/**
 * Ein Parameter-Deeplink (`?meldung=`, `?fahrzeug=` …) zeigt auf ein Objekt, das es nicht (mehr)
 * gibt (LLH-1827, Change `a12ms7g9-seitenzustaende`, D5; Spec `seiten-zustaende`, „Deeplink auf
 * ein Objekt, das es nicht gibt“): eine schließbare Leiste über der Liste, „<Sache> #<id> gibt es
 * nicht (mehr)“, auf jeder Listenseite in derselben Form.
 *
 * Typ `info`, nicht `error`: gescheitert ist nichts in der Anwendung. Kein Toast, Toasts tragen nur
 * Alarme (`frontend/AGENTS.md`). Aus demselben Grund `role="status"` statt der Rolle `alert`, die
 * antd sonst setzt: ein Screenreader soll den Hinweis ansagen, nicht als Alarm unterbrechen.
 *
 * Die Seite ruft `lage.schliesse()` auch in ihrer Wahl-Handlung; ein neuer Deeplink setzt die Lage
 * im Hook neu. Der `key` hängt die Leiste je Kennung neu ein: ein geschlossener `Alert` merkt sich
 * sein Zu intern.
 */
export function DeeplinkHinweis({ lage, sache }: DeeplinkHinweisProps) {
  const { token } = theme.useToken();
  if (lage.unbekannt == null) return null;
  return (
    <Alert
      key={lage.unbekannt}
      type="info"
      showIcon
      role="status"
      data-lfh="deeplink-hinweis"
      closable={{ 'aria-label': 'Hinweis schließen' }}
      onClose={lage.schliesse}
      title={`${sache} #${lage.unbekannt} gibt es nicht (mehr)`}
      style={{ marginBottom: token.marginSM }}
    />
  );
}
