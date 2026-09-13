import { Modal, Typography } from 'antd';
import type { Meldung, NeuerAuftrag } from '../api/types';
import AuftragFormular, { type ZielOption } from '../auftraege/AuftragFormular';

interface Props {
  meldung: Meldung | null;
  abschnitte: ZielOption[];
  einheiten: ZielOption[];
  senden: boolean;
  onAbbrechen: () => void;
  onAnlegen: (d: NeuerAuftrag) => Promise<unknown>;
}

/** Vorbelegung des Auftragstexts aus der Meldung (Absender + Inhalt, LFH-113). */
function initialText(m: Meldung | null): string {
  if (!m) return '';
  return `${m.absender}: ${m.inhalt}`;
}

/** Meldung→Auftrag erteilen (LFH-113): wiederverwendetes Auftragsformular, mit dem
 *  Meldungsinhalt vorbelegt — gespiegelt von der Chat-Heraufstufung (HeraufstufenAuftragModal).
 *  `destroyOnHidden` remountet das Formular bei jedem Öffnen, sodass `initialText` frisch greift. */
export default function AuftragErteilenModal({
  meldung,
  abschnitte,
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
        initialText={initialText(meldung)}
        zitat={
          meldung && (
            // Read-only Wortlaut der Quellmeldung (LFH-343 · C8, Befund H49). Der
            // vorbelegte Auftragstext ist bearbeitbar und wird beim Formulieren
            // überschrieben — dann fehlte ohne dieses Zitat der Urtext, auf den sich
            // der Auftrag bezieht.
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
