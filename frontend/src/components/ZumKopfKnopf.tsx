import { Button, Flex, theme } from 'antd';
import { useState } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { zumKopf } from './listenFenster';

interface ZumKopfKnopfProps {
  /** Schlüssel der `useInfiniteQuery`, deren Fenster ersetzt wird. */
  schluessel: QueryKey;
  /** Holt die neueste Seite (Kopf), wie die Abfrage sie ohne Cursor holt. */
  ladeKopf: () => Promise<unknown[]>;
  /** Nach dem Ersetzen, etwa um ans Ende eines Funkprotokolls zu rollen. */
  nachKopf?: () => void;
}

/**
 * Weg zurück zum Neuesten, sobald die neueste Seite aus dem Seitenfenster gefallen ist
 * (LLH-1687, `listenFenster.ts`). Die Seite zeigt ihn nur bei `kopfVerlassen(query.data)`, auf
 * der Seite der Liste, an der das Neueste steht.
 */
export default function ZumKopfKnopf({ schluessel, ladeKopf, nachKopf }: ZumKopfKnopfProps) {
  const qc = useQueryClient();
  const { token } = theme.useToken();
  const [laeuft, setLaeuft] = useState(false);
  return (
    <Flex justify="center" style={{ marginBlock: token.marginSM }}>
      <Button
        loading={laeuft}
        onClick={async () => {
          setLaeuft(true);
          try {
            if (await zumKopf(qc, schluessel, ladeKopf)) nachKopf?.();
          } finally {
            setLaeuft(false);
          }
        }}
      >
        Zu den neuesten springen
      </Button>
    </Flex>
  );
}
