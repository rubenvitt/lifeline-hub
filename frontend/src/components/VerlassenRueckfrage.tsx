import { Button, Flex, Modal, theme } from 'antd';
import { useEffect } from 'react';
import { useBlocker } from 'react-router';
import { SpeicherFehler } from './SpeicherHinweis';

interface Props {
  /** Merker der Seite: offene, nicht gespeicherte Änderungen. */
  ungespeichert: boolean;
  /**
   * Nur Entwürfe (`entwurf/EntwurfNavigationSchutz.tsx`): bietet „Speichern und weiter" an.
   * Formularseiten lassen es weg (LFH-979, design.md D3): Prüffehler und Rückfragen ihres
   * Speicherns stünden hinter der Maske dieses Dialogs.
   */
  speichern?: () => Promise<void>;
  speichert?: boolean;
  /** Grund eines gescheiterten „Speichern und weiter". */
  speicherFehler?: unknown;
}

/**
 * Rückfrage vor dem Verlassen einer Seite mit ungespeicherten Änderungen (LFH-979). Hält jeden
 * Wechsel auf einen ANDEREN Pfad an (Seitenmenü, Segmentleiste, Brotkrume); Suchparameter und
 * Hash bleiben frei. Braucht einen Data Router (`useBlocker`) — in Tests
 * `renderMitProviders(…, { datenRouter: true })`. Die Warnung beim Schließen des Tabs trägt der
 * Merker (`useFormularVerlassenSchutz`, `useEntwurfVerlustschutz`), nicht dieser Dialog. Ein
 * Wechsel IN der Seite (Segmentleiste ohne Pfad, Reiter) fragt über
 * `useWechselNachRueckfrage` (`components/offeneBearbeitung.tsx`, LLH-1415) mit demselben
 * `VerlassenDialog`.
 *
 * Der Grund eines gescheiterten Speicherns steht IM Dialog: der Modal trägt
 * `mask={{ closable: false }}`, ein Seiten-Alert dahinter wäre unsichtbar.
 */
export default function VerlassenRueckfrage({
  ungespeichert,
  speichern,
  speichert = false,
  speicherFehler,
}: Props) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      ungespeichert && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    // Ein Speichern kann die Rückfrage erledigen, während sie offen steht. Nur den noch
    // angehaltenen Wechsel nachholen: nach „Bleiben" ist der Blocker bereits reset.
    if (blocker.state === 'blocked' && !ungespeichert) blocker.proceed();
  }, [blocker, ungespeichert]);

  return (
    <VerlassenDialog
      offen={blocker.state === 'blocked' && ungespeichert}
      onBleiben={() => {
        if (blocker.state === 'blocked') blocker.reset();
      }}
      onVerwerfen={() => {
        if (blocker.state === 'blocked') blocker.proceed();
      }}
      speichern={speichern}
      speichert={speichert}
      speicherFehler={speicherFehler}
    />
  );
}

/**
 * Der Dialog der Rückfrage ohne Router: „Bleiben“/„Verwerfen“, Wortlaut für jeden Wechsel gleich,
 * ob Pfad (`VerlassenRueckfrage`) oder Segment in der Seite (`useWechselNachRueckfrage`).
 */
export function VerlassenDialog({
  offen,
  onBleiben,
  onVerwerfen,
  speichern,
  speichert = false,
  speicherFehler,
}: Omit<Props, 'ungespeichert'> & {
  offen: boolean;
  onBleiben: () => void;
  onVerwerfen: () => void;
}) {
  const { token } = theme.useToken();
  return (
    <Modal
      title="Ungespeicherte Änderungen"
      open={offen}
      onCancel={onBleiben}
      mask={{ closable: false }}
      footer={
        <Flex gap={token.margin} wrap justify="space-between">
          <Button danger onClick={onVerwerfen}>
            Verwerfen
          </Button>
          <Flex gap={token.marginSM} wrap>
            <Button type={speichern ? 'default' : 'primary'} onClick={onBleiben}>
              Bleiben
            </Button>
            {speichern && (
              <Button type="primary" loading={speichert} onClick={() => void speichern()}>
                Speichern und weiter
              </Button>
            )}
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
