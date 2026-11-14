import { Button, Flex, Typography, theme } from 'antd';
import { useState } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { zumKopf } from './listenFenster';

interface ZumKopfKnopfProps {
  /** Schlüssel der `useInfiniteQuery`, deren Fenster ersetzt wird. */
  schluessel: QueryKey;
  /** Holt die neueste Seite (Kopf), wie die Abfrage sie ohne Cursor holt. */
  ladeKopf: () => Promise<unknown[]>;
}

/**
 * Weg zurück zum Neuesten, sobald die neueste Seite aus dem Seitenfenster gefallen ist
 * (LLH-1687, `listenFenster.ts`). Die Seite zeigt ihn nur bei `kopfVerlassen(query.data)`, über
 * der Liste. Scheitert der Abruf, steht der Grund am Knopf, bis zum nächsten Versuch (kein Toast,
 * `frontend/AGENTS.md`, „Rückwege und Fehler“); das Fenster bleibt dann, wie es ist.
 */
export default function ZumKopfKnopf({ schluessel, ladeKopf }: ZumKopfKnopfProps) {
  const qc = useQueryClient();
  const { token } = theme.useToken();
  const [laeuft, setLaeuft] = useState(false);
  const [gescheitert, setGescheitert] = useState(false);
  return (
    <Flex vertical align="center" gap={token.marginXXS} style={{ marginBlock: token.marginSM }}>
      <Button
        loading={laeuft}
        onClick={async () => {
          setLaeuft(true);
          setGescheitert(false);
          try {
            setGescheitert(!(await zumKopf(qc, schluessel, ladeKopf)));
          } finally {
            setLaeuft(false);
          }
        }}
      >
        Zu den neuesten springen
      </Button>
      {gescheitert && (
        <Typography.Text type="danger" role="alert">
          Die neuesten Einträge ließen sich nicht laden. Bitte erneut versuchen.
        </Typography.Text>
      )}
    </Flex>
  );
}
