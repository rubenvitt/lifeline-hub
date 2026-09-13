import { Button, Flex, Modal, theme } from 'antd';
import { SpeicherFehler } from '../components/SpeicherHinweis';

/**
 * Die Rückfrage vor der endgültigen Freigabe eines Entwurfs (LFH-535, Nachzug N5 aus
 * LFH-348 · C13).
 *
 * ── Warum eine Komponente und kein `modal.confirm` (LFH-535) ───────────────────
 * Beide Zwillingsseiten fragten über `App.useApp().modal.confirm(...)` nach. Dessen
 * `content` wird beim AUFRUF eingefroren: ein `<SpeicherFehler fehler={mutation.error}>`
 * darin rendert nicht nach, der Grund müsste per `instanz.update({ content })` von Hand
 * nachgeschoben werden. Das wäre ein zweiter Anzeigemechanismus neben dem, den LFH-494
 * für `EntwurfNavigationSchutz` schon gebaut hat — dieselbe Bauform ist hier ein
 * kontrolliertes `<Modal>` mit eigenem State.
 *
 * Der zweite Grund ist die Gemeinsamkeit: die Bedienentscheidung gilt für BEIDE
 * Zwillingsseiten, und eine geteilte Komponente macht sie strukturell statt zur
 * Konvention — dieselbe Antwort, die LFH-348 · C13 mit dem geteilten Verlustschutz-Hook
 * gegeben hat. Zwei Copy-Paste-Dialoge sind genau die Divergenz, die dort geschlossen wurde.
 *
 * ── Warum der Grund IM Dialog steht (H14) ─────────────────────────────────────
 * Der Modal trägt `mask={{ closable: false }}` — alles dahinter ist abgedunkelt und
 * unbedienbar, ein Seiten-Alert also unsichtbar, solange der Dialog offen steht. Und ein
 * Toast allein ist nach rund drei Sekunden weg: der unveränderte Dialog ist dann von
 * „nichts passiert" nicht zu unterscheiden. Das ist die H14-Diagnose (LFH-345 · C10),
 * hier am Zustandsübergang statt am Speicherpfad.
 *
 * Der Erfolg bleibt beim Toast: er quittiert eine abgeschlossene Handlung, und der Dialog,
 * in dem er stünde, ist dann geschlossen. Dieselbe Trennung wie in `SpeicherHinweis`.
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
 * Welcher der beiden Gründe steht im Dialog — rein und exportiert, damit die
 * Fallunterscheidung ohne Render prüfbar ist (Muster `fehlerText`/`bedienzielStil`).
 *
 * Der Freigabe-Flow hat ZWEI Fehlerquellen hintereinander: erst den Speicher-Vorlauf
 * (`/freigeben` prüft den persistierten Stand, nicht den Editor-Inhalt), dann den
 * Zustandsübergang selbst. Sie brauchen verschiedene Überschriften — „Nicht gespeichert"
 * und „Freigabe fehlgeschlagen" sagen der Person Verschiedenes darüber, was ihr Entwurf
 * jetzt ist.
 *
 * VORRANG HAT DER SPEICHERFEHLER, und das ist die Reihenfolge, nicht Geschmack: scheitert
 * der Vorlauf, läuft die Freigabe gar nicht erst — ein dann noch stehender
 * `freigabeFehler` stammt aus einem FRÜHEREN Versuch. Umgekehrt kann der Speicherfehler
 * nicht veralten: er fällt bei jedem gelungenen Speichern (`quittungVorbereiten` räumt
 * ihn), und ohne gelungenes Speichern gibt es keinen Freigabe-Versuch.
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
      // Wie antds `Modal.confirm` (dort ist `maskClosable` von Haus aus aus): ein
      // Fehlklick neben den Dialog darf einen gerade gezeigten Grund nicht wegräumen.
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
