import { Button, Flex, Modal, theme } from 'antd';
import { useEffect } from 'react';
import { useBlocker } from 'react-router';
import { SpeicherFehler } from '../components/SpeicherHinweis';

interface Props {
  ungespeichert: boolean;
  speichert: boolean;
  speichern: () => Promise<void>;
  /** Grund eines gescheiterten „Speichern und weiter" — `schutz.speicherFehler` (LFH-494). */
  speicherFehler?: unknown;
}

/**
 * LFH-462: Navigation und Autosave teilen denselben Verlustschutz-Merker.
 *
 * **DER GRUND STEHT IM DIALOG, NICHT DAHINTER (LFH-494).** Der Modal trägt
 * `mask={{ closable: false }}` — alles hinter ihm ist abgedunkelt und unbedienbar. Solange
 * der Speicherfehler über `message.error` lief, war das der einzige Kanal, der über einem
 * offenen Modal funktioniert; beim Umbau auf den Seiten-Alert wäre genau diese Stelle ohne
 * jede Rückmeldung geblieben: `loading` fällt, der Dialog steht unverändert da. Das ist die
 * H14-Diagnose, die LFH-494 schliesst, an einem Pfad wieder aufgemacht.
 *
 * Anders als der Freigabe-Flow der Seite kann diese Stelle nicht „beides" melden:
 * `autosaveJetzt()` liefert `void`, es gibt nichts zum Awaiten — der Zustand ist der
 * einzige Weg, und er muss deshalb hier hereingereicht werden.
 */
export default function EntwurfNavigationSchutz({
  ungespeichert, speichert, speichern, speicherFehler,
}: Props) {
  const { token } = theme.useToken();
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    ungespeichert && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    // Autosave kann die Rückfrage erledigen, während sie offen steht. Nur den noch
    // angehaltenen Wechsel nachholen: nach „Bleiben“ ist der Blocker bereits reset.
    if (blocker.state === 'blocked' && !ungespeichert) blocker.proceed();
  }, [blocker, ungespeichert]);

  const bleiben = () => {
    if (blocker.state === 'blocked') blocker.reset();
  };

  return (
    <Modal
      title="Ungespeicherte Änderungen"
      open={blocker.state === 'blocked' && ungespeichert}
      onCancel={bleiben}
      mask={{ closable: false }}
      footer={
        <Flex gap={token.margin} wrap justify="space-between">
          <Button danger onClick={() => {
            if (blocker.state === 'blocked') blocker.proceed();
          }}>
            Verwerfen
          </Button>
          <Flex gap={token.marginSM} wrap>
            <Button onClick={bleiben}>Bleiben</Button>
            <Button type="primary" loading={speichert} onClick={() => void speichern()}>
              Speichern und weiter
            </Button>
          </Flex>
        </Flex>
      }
    >
      <Flex vertical gap={token.marginSM}>
        <span>Noch nicht gespeicherte Änderungen gehen beim Verlassen verloren.</span>
        <SpeicherFehler fehler={speicherFehler} />
      </Flex>
    </Modal>
  );
}
