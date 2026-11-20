import { Modal, Typography, theme } from 'antd';
import { useEffect, useRef } from 'react';
import type { ErfassungsFormularSteuerung, Speicherung } from '../components/Erfassung';
import type { ChatNachricht, NeuerAuftrag } from '../api/types';
import AuftragFormular, { type ZielOption } from '../auftraege/AuftragFormular';

interface Props {
  offen: boolean;
  nachricht: ChatNachricht | null;
  abschnitte: ZielOption[];
  einheiten: ZielOption[];
  /** Für die Katalogauswahl der Funktionen (LFH-549). */
  einsatzId?: number;
  senden: boolean;
  onAbbrechen: () => void;
  onAnlegen: (d: NeuerAuftrag) => Promise<unknown>;
  /**
   * Die Heraufstufen-Mutation (LFH-1077): ihr Grund steht im Formular, bis zum nächsten Absenden;
   * Öffnen und Schließen räumen ihn. Solange sie läuft, ist jeder Ausweg gesperrt.
   */
  speicherung?: Speicherung;
}

/**
 * Heraufstufung Chat-Nachricht → Auftrag: das Auftragsformular, mit dem Nachrichtentext
 * vorbelegt. `destroyOnHidden` remountet es je Öffnen, damit `initialText` frisch greift.
 */
export default function HeraufstufenAuftragModal({
  offen,
  nachricht,
  abschnitte,
  einsatzId,
  einheiten,
  senden,
  onAbbrechen,
  onAnlegen,
  speicherung,
}: Props) {
  const { token } = theme.useToken();
  const sperrt = speicherung?.isPending === true;
  // Ein schließender Dialog bleibt bis zum Ende seiner Animation eingehängt; ein schnelles
  // Wiederöffnen hängt das Formular nicht neu ein. Deshalb räumt jeder Wechsel von `offen`.
  const speicherungRef = useRef(speicherung);
  speicherungRef.current = speicherung;
  useEffect(() => {
    const s = speicherungRef.current;
    if (s && !s.isPending && s.error != null) s.reset();
  }, [offen]);
  const steuerung = useRef<ErfassungsFormularSteuerung>(null);
  return (
    <Modal
      open={offen}
      title="Zu Auftrag heraufstufen"
      footer={null}
      // Kreuz über die Pforte der Erfassungshülle: bei Änderung erst die Rückfrage (LLH-1755).
      onCancel={() => steuerung.current?.abbrechen()}
      closable={sperrt ? { disabled: true } : true}
      // Die Maske schließt nie; Escape läuft über die Tastatur-Ebene des Formulars.
      mask={{ closable: false }}
      keyboard={false}
      destroyOnHidden
      width={520}
    >
      <AuftragFormular
        steuerungRef={steuerung}
        onAbbrechen={onAbbrechen}
        rueckfrageTitel="Zu Auftrag heraufstufen"
        card={false}
        senden={senden}
        abschnitte={abschnitte}
        einheiten={einheiten}
        einsatzId={einsatzId}
        initialText={nachricht?.inhalt ?? ''}
        zitat={
          nachricht && (
            // Read-only Wortlaut der Quellnachricht: der vorbelegte Auftragstext wird beim Formulieren
            // überschrieben.
            <Typography.Paragraph type="secondary" style={{ marginBottom: token.margin }}>
              <Typography.Text strong>{nachricht.autor_name}:</Typography.Text> {nachricht.inhalt}
            </Typography.Paragraph>
          )
        }
        onAnlegen={onAnlegen}
        speicherung={speicherung}
        speicherFehlerTitel="Auftrag nicht erteilt"
        speicherFehlerFallback="Heraufstufen fehlgeschlagen"
      />
    </Modal>
  );
}
