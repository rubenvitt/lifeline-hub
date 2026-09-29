import { Button, Flex, Modal, theme } from 'antd';
import { useEffect } from 'react';
import { useBlocker } from 'react-router';
import { SpeicherFehler } from '../components/SpeicherHinweis';

interface Props {
  ungespeichert: boolean;
  speichert: boolean;
  speichern: () => Promise<void>;
  /** Grund eines gescheiterten „Speichern und weiter" — `schutz.speicherFehler`. */
  speicherFehler?: unknown;
}

/**
 * Navigation und Autosave teilen denselben Verlustschutz-Merker.
 *
 * Der Grund eines gescheiterten Speicherns steht IM Dialog: der Modal trägt
 * `mask={{ closable: false }}`, ein Seiten-Alert dahinter wäre unsichtbar und der Dialog stünde
 * nach fallendem `loading` unverändert da. `autosaveJetzt()` liefert `void`, deshalb wird der
 * Zustand hereingereicht.
 */
export default function EntwurfNavigationSchutz({
  ungespeichert,
  speichert,
  speichern,
  speicherFehler,
}: Props) {
  const { token } = theme.useToken();
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      ungespeichert && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    // Autosave kann die Rückfrage erledigen, während sie offen steht. Nur den noch angehaltenen
    // Wechsel nachholen: nach „Bleiben“ ist der Blocker bereits reset.
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
          <Button
            danger
            onClick={() => {
              if (blocker.state === 'blocked') blocker.proceed();
            }}
          >
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
