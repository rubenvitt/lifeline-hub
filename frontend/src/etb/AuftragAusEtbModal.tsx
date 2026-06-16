import { Modal } from 'antd';
import type { EtbEintragAnzeige, NeuerAuftrag } from '../api/types';
import AuftragFormular, { type ZielOption } from '../auftraege/AuftragFormular';

interface Props {
  eintrag: EtbEintragAnzeige | null;
  abschnitte: ZielOption[];
  einheiten: ZielOption[];
  senden: boolean;
  onAbbrechen: () => void;
  onAnlegen: (d: NeuerAuftrag) => void;
}

/** Vorbelegung des Auftragstexts aus dem ETB-Eintrag (Inhalt, LFH-112). */
function initialText(e: EtbEintragAnzeige | null): string {
  return e?.inhalt ?? '';
}

/** ETB→Auftrag erteilen (LFH-112): wiederverwendetes Auftragsformular, mit dem Eintragstext
 *  vorbelegt — gespiegelt von AuftragErteilenModal (Meldung→Auftrag). `destroyOnHidden`
 *  remountet das Formular bei jedem Öffnen, sodass `initialText` frisch greift. */
export default function AuftragAusEtbModal({
  eintrag, abschnitte, einheiten, senden, onAbbrechen, onAnlegen,
}: Props) {
  return (
    <Modal
      open={eintrag !== null}
      title="Aus ETB-Eintrag Auftrag erteilen"
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
        initialText={initialText(eintrag)}
        onAnlegen={onAnlegen}
      />
    </Modal>
  );
}
