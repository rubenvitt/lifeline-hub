import { Modal, Typography } from 'antd';
import { ZWECK_BILDSCHIRM } from './passListe';

/**
 * Rückfrage vor dem Abruf der PASS-Liste als CSV (LLH-1198, Entwurf `2026-11-24-sco62ku3-pass-liste`):
 * nennt die Zweckbindung, erst „Exportieren“ ruft den Server (und schreibt damit den
 * `pass_export`-Eintrag). Der Dialog schließt mit der Wahl; ein Fehler des Abrufs steht wie beim
 * CSV-Export an der Seite (`useCsvExport`), nicht hier.
 */
export default function PassExportDialog({
  offen,
  onExportieren,
  onAbbrechen,
}: {
  offen: boolean;
  onExportieren: () => void;
  onAbbrechen: () => void;
}) {
  return (
    <Modal
      open={offen}
      title="PASS-Liste exportieren"
      okText="Exportieren"
      cancelText="Abbrechen"
      onOk={onExportieren}
      onCancel={onAbbrechen}
      destroyOnHidden
    >
      <Typography.Paragraph style={{ marginBlockEnd: 0 }}>{ZWECK_BILDSCHIRM}</Typography.Paragraph>
    </Modal>
  );
}
