import { App, Button, theme } from 'antd';
import type { ReactNode } from 'react';
import { IconKopieren } from '../icons';

/**
 * Text mit einer Kopieraktion daneben (LFH-763).
 *
 * Statt antds `Typography copyable`: dessen Kopier-Icon maß in jeder Dichtestufe 15 × 13 px und
 * folgte der Staffel nicht (Prüfliste LFH-38, Kriterien 1 und 2). Hier ist die Aktion ein echter
 * antd-`Button` (nur Icon, `type="text"`) ohne `size`: er erbt `controlHeight` 30/48/72 vom
 * `ConfigProvider` und braucht deshalb keinen eigenen Boden (`frontend/AGENTS.md`, Dichte-Staffel).
 *
 * Der zugängliche Name nennt, WAS kopiert wird (`<bezeichnung> kopieren`). Ohne Zwischenablage
 * (kein Secure Context) fehlt der Knopf: ein Knopf, der nichts tut, ist schlimmer als keiner. Der
 * Text bleibt dann zum Markieren stehen.
 */
export default function KopierbarerText({
  text,
  bezeichnung,
  children,
}: {
  /** Was in die Zwischenablage geht. */
  text: string;
  /** Was kopiert wird, für Namen und Rückmeldung, z. B. „TOTP-Geheimnis“. */
  bezeichnung: string;
  /** Sichtbarer Inhalt; ohne Angabe steht `text` selbst da. */
  children?: ReactNode;
}) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const kopierenMoeglich = typeof navigator.clipboard?.writeText === 'function';

  function kopieren() {
    // Beide Ausgänge melden sich: `writeText` kann vorhanden sein und trotzdem ablehnen
    // (NotAllowedError, fehlende Berechtigung).
    navigator.clipboard.writeText(text).then(
      () => message.success(`${bezeichnung} kopiert`),
      () => message.error('Kopieren fehlgeschlagen — der Text lässt sich markieren und kopieren'),
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: token.marginXS }}>
      <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{children ?? text}</div>
      {kopierenMoeglich ? (
        <Button
          type="text"
          icon={<IconKopieren />}
          aria-label={`${bezeichnung} kopieren`}
          title={`${bezeichnung} kopieren`}
          onClick={kopieren}
          style={{ flex: 'none' }}
        />
      ) : null}
    </div>
  );
}
