import { Button, Flex, Modal, theme } from 'antd';
import { SpeicherFehler } from '../components/SpeicherHinweis';

/**
 * Die Rückfrage vor der endgültigen Freigabe eines Entwurfs, geteilt von Befehl und Lagebericht.
 *
 * Kein `modal.confirm`: dessen `content` wird beim AUFRUF eingefroren, ein
 * `<SpeicherFehler fehler={mutation.error}>` darin rendert nicht nach. Stattdessen ein
 * kontrolliertes `<Modal>` wie `EntwurfNavigationSchutz`.
 *
 * Der Grund steht IM Dialog: `mask={{ closable: false }}` dunkelt die Seite ab, ein Seiten-Alert
 * wäre unsichtbar, und ein Toast wäre nach drei Sekunden weg. Der Erfolg bleibt beim Toast —
 * der Dialog ist dann zu.
 */

interface Props {
  offen: boolean;
  /** „Befehl freigeben?" / „Lagebericht freigeben?" */
  titel: string;
  /** Was die Freigabe endgültig macht — ein ganzer Satz. */
  warnung: string;
  /** Grund eines gescheiterten Speicher-Vorlaufs — `schutz.speicherFehler`. */
  speicherFehler: unknown;
  /** Grund eines gescheiterten `POST …/freigeben` — `freigebenMutation.error`. */
  freigabeFehler: unknown;
  /** Speicher-Vorlauf ODER Freigabe ist unterwegs. */
  laeuft: boolean;
  onAbbrechen: () => void;
  onFreigeben: () => void;
}

/**
 * Welcher der beiden Gründe im Dialog steht — rein und exportiert.
 *
 * Der Flow hat ZWEI Fehlerquellen: erst den Speicher-Vorlauf (`/freigeben` prüft den
 * persistierten Stand), dann den Übergang selbst — mit verschiedenen Überschriften („Nicht
 * gespeichert" / „Freigabe fehlgeschlagen").
 *
 * VORRANG HAT DER SPEICHERFEHLER: scheitert der Vorlauf, läuft die Freigabe nicht, ein stehender
 * `freigabeFehler` stammt dann aus einem früheren Versuch. Der Speicherfehler selbst kann nicht
 * veralten, er fällt bei jedem gelungenen Speichern.
 */
export function freigabeGrund(
  speicherFehler: unknown,
  freigabeFehler: unknown,
): { fehler: unknown; titel: string } | null {
  if (speicherFehler != null) return { fehler: speicherFehler, titel: 'Nicht gespeichert' };
  if (freigabeFehler != null) return { fehler: freigabeFehler, titel: 'Freigabe fehlgeschlagen' };
  return null;
}

export default function FreigabeDialog({
  offen,
  titel,
  warnung,
  speicherFehler,
  freigabeFehler,
  laeuft,
  onAbbrechen,
  onFreigeben,
}: Props) {
  const { token } = theme.useToken();
  const grund = freigabeGrund(speicherFehler, freigabeFehler);

  return (
    <Modal
      title={titel}
      open={offen}
      onCancel={onAbbrechen}
      // Wie bei `Modal.confirm`: ein Fehlklick neben den Dialog darf einen gezeigten Grund nicht
      // wegräumen.
      mask={{ closable: false }}
      footer={
        <Flex gap={token.marginSM} wrap justify="end">
          <Button onClick={onAbbrechen}>Abbrechen</Button>
          <Button type="primary" loading={laeuft} onClick={onFreigeben}>
            Freigeben
          </Button>
        </Flex>
      }
    >
      <Flex vertical gap={token.marginSM}>
        <span>{warnung}</span>
        {grund !== null && <SpeicherFehler fehler={grund.fehler} titel={grund.titel} />}
      </Flex>
    </Modal>
  );
}
