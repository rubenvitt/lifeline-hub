import { Modal, Typography } from 'antd';
import type { Meldung, NeuerAuftrag } from '../api/types';
import AuftragFormular, { type ZielOption } from '../auftraege/AuftragFormular';

interface Props {
  meldung: Meldung | null;
  abschnitte: ZielOption[];
  einheiten: ZielOption[];
  /** Für die Katalogauswahl der Funktionen (LFH-549). */
  einsatzId?: number;
  senden: boolean;
  onAbbrechen: () => void;
  onAnlegen: (d: NeuerAuftrag) => Promise<unknown>;
}

/** Vorbelegung des Auftragstexts aus der Meldung (Absender + Inhalt, LFH-113). */
function initialText(m: Meldung | null): string {
  if (!m) return '';
  return `${m.absender}: ${m.inhalt}`;
}

/**
 * Meldung → Auftrag erteilen: das Auftragsformular, mit dem Meldungsinhalt vorbelegt (wie
 * `HeraufstufenAuftragModal`). `destroyOnHidden` remountet es je Öffnen, damit `initialText`
 * frisch greift.
 */
export default function AuftragErteilenModal({
  meldung,
  abschnitte,
  einsatzId,
  einheiten,
  senden,
  onAbbrechen,
  onAnlegen,
}: Props) {
  return (
    <Modal
      open={meldung !== null}
      title="Aus Meldung Auftrag erteilen"
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
        initialText={initialText(meldung)}
        zitat={
          meldung && (
            // Read-only Wortlaut der Quellmeldung: der vorbelegte Auftragstext wird beim Formulieren
            // überschrieben, dann fehlte sonst der Urtext.
            <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
              <Typography.Text strong>{meldung.absender}:</Typography.Text> {meldung.inhalt}
            </Typography.Paragraph>
          )
        }
        onAnlegen={onAnlegen}
      />
    </Modal>
  );
}
