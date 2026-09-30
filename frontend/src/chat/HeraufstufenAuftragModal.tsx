import { Modal, Typography } from 'antd';
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
}: Props) {
  return (
    <Modal
      open={offen}
      title="Zu Auftrag heraufstufen"
      footer={null}
      onCancel={onAbbrechen}
      destroyOnHidden
      width={520}
    >
      <AuftragFormular
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
            <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
              <Typography.Text strong>{nachricht.autor_name}:</Typography.Text> {nachricht.inhalt}
            </Typography.Paragraph>
          )
        }
        onAnlegen={onAnlegen}
      />
    </Modal>
  );
}
