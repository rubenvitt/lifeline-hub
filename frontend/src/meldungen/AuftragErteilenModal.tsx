import { Modal } from 'antd';
import type { Meldung, NeuerAuftrag } from '../api/types';
import AuftragFormular, { type ZielOption } from '../auftraege/AuftragFormular';

interface Props {
  offen: boolean;
  meldung: Meldung | null;
  abschnitte: ZielOption[];
  einheiten: ZielOption[];
  senden: boolean;
  onAbbrechen: () => void;
  onAnlegen: (d: NeuerAuftrag) => void;
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
  offen, meldung, abschnitte, einheiten, senden, onAbbrechen, onAnlegen,
}: Props) {
  return (
    <Modal
      open={offen}
      title="Aus Meldung Auftrag erteilen"
      footer={null}
      onCancel={onAbbrechen}
      destroyOnHidden
      width={520}
    >
      <AuftragFormular
        senden={senden}
        abschnitte={abschnitte}
        einheiten={einheiten}
        initialText={initialText(meldung)}
        onAnlegen={onAnlegen}
      />
    </Modal>
  );
}
