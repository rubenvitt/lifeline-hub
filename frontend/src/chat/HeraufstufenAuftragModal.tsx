import { Modal } from 'antd';
import type { ChatNachricht, NeuerAuftrag } from '../api/types';
import AuftragFormular, { type ZielOption } from '../auftraege/AuftragFormular';

interface Props {
  offen: boolean;
  nachricht: ChatNachricht | null;
  abschnitte: ZielOption[];
  einheiten: ZielOption[];
  senden: boolean;
  onAbbrechen: () => void;
  onAnlegen: (d: NeuerAuftrag) => void;
}

/** Heraufstufung Chat-Nachricht → Auftrag (LFH-101): wiederverwendetes Auftragsformular,
 *  mit dem Nachrichtentext vorbelegt. `destroyOnHidden` remountet das Formular bei jedem
 *  Öffnen, sodass `initialText` frisch greift. */
export default function HeraufstufenAuftragModal({
  offen, nachricht, abschnitte, einheiten, senden, onAbbrechen, onAnlegen,
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
        initialText={nachricht?.inhalt ?? ''}
        onAnlegen={onAnlegen}
      />
    </Modal>
  );
}
