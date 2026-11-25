import type { MouseEvent } from 'react';
import { Button, Modal, Typography } from 'antd';
import { DRUCKANSICHT } from '../components/druck/useDruckNebenwege';
import { Knopfreihe } from '../components/instrument';
import { ZWECK_BILDSCHIRM } from './passListe';

/**
 * Der eine Einstieg in die PASS-Liste (LLH-1198, Entwurf `2026-11-24-sco62ku3-pass-liste`;
 * Entscheidung 25.11.2026: ein Kopf-Eintrag statt zwei, der Seitenkopf war voll). Nennt die
 * Zweckbindung vor beiden Wegen: „Druckansicht“ öffnet die Druckseite (ein Link, Strg/⌘+Klick
 * öffnet einen Tab), „Als CSV exportieren“ ruft den Server (und schreibt damit den
 * `pass_export`-Eintrag). Der Dialog schließt mit der Wahl; ein Fehler des Abrufs steht wie beim
 * CSV-Export an der Seite (`useCsvExport`), nicht hier.
 */
export default function PassListeDialog({
  offen,
  druckZiel,
  onDruckansicht,
  onExportieren,
  onAbbrechen,
}: {
  offen: boolean;
  /** Adresse der Druckansicht (`passListeDruckPfad`). */
  druckZiel: string;
  /** Navigiert im selben Tab; der Link bleibt für Strg/⌘+Klick. */
  onDruckansicht: () => void;
  onExportieren: () => void;
  onAbbrechen: () => void;
}) {
  const druck = (e: MouseEvent) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    onDruckansicht();
  };
  return (
    <Modal
      open={offen}
      title="PASS-Liste"
      onCancel={onAbbrechen}
      destroyOnHidden
      footer={
        <Knopfreihe fuss>
          <Button onClick={onAbbrechen}>Abbrechen</Button>
          <Button href={druckZiel} onClick={druck}>
            {DRUCKANSICHT}
          </Button>
          <Button type="primary" onClick={onExportieren}>
            Als CSV exportieren
          </Button>
        </Knopfreihe>
      }
    >
      <Typography.Paragraph style={{ marginBlockEnd: 0 }}>{ZWECK_BILDSCHIRM}</Typography.Paragraph>
    </Modal>
  );
}
