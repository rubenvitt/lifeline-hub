/**
 * „Hier Zeichen setzen“ aus dem Kontextmenü der Lagekarte (LFH-776, Spec `lagekarte-kontextmenue`,
 * `openspec/changes/archive/2026-10-03-lfh-776-lagekarte-kontextmenue/design.md` D7): die Zeichenwahl der Leiste in
 * einem Dialog; „Setzen“ (oder Enter im Picker) legt das Zeichen an der Stelle an, ohne zweiten
 * Tipp auf die Karte. Kein `<Form>` — wie in der Leiste gehört das Absenden dem Aufrufer.
 *
 * Fokus ins Suchfeld nur bei der Maus: am Touchschirm klappte sonst die Bildschirmtastatur über
 * das Raster.
 */
import { useState } from 'react';
import { Button, Modal, Space } from 'antd';
import type { FreiesZeichenUpdate } from '../../api/types';
import FreiesZeichenPicker from './FreiesZeichenPicker';

interface Props {
  offen: boolean;
  /** Woher das Kontextmenü kam. */
  quelle: 'maus' | 'touch';
  /** Das Anlegen läuft; „Setzen“ ist gesperrt. */
  laeuft: boolean;
  onSetzen: (spec: FreiesZeichenUpdate) => void;
  onAbbrechen: () => void;
}

export default function ZeichenHierDialog({ offen, quelle, laeuft, onSetzen, onAbbrechen }: Props) {
  // Derselbe Startentwurf wie in der Leiste; „Zuletzt verwendet“ bringt der Picker selbst mit.
  const [entwurf, setEntwurf] = useState<FreiesZeichenUpdate>({
    grundzeichen: 'taktische-formation',
  });
  const setzen = (spec: FreiesZeichenUpdate) => {
    if (laeuft) return;
    setEntwurf(spec);
    onSetzen(spec);
  };

  return (
    <Modal
      open={offen}
      title="Zeichen hier setzen"
      onCancel={onAbbrechen}
      destroyOnHidden
      // Während des Anlegens gibt es kein Zurück: Schließen hielte den POST nicht auf, das Zeichen
      // entstünde trotzdem („Abbrechen legt nichts an“ wäre gelogen).
      closable={!laeuft}
      mask={{ closable: !laeuft }}
      keyboard={!laeuft}
      footer={
        <Space>
          <Button onClick={onAbbrechen} disabled={laeuft}>
            Abbrechen
          </Button>
          <Button type="primary" loading={laeuft} onClick={() => setzen(entwurf)}>
            Setzen
          </Button>
        </Space>
      }
    >
      <FreiesZeichenPicker
        wert={entwurf}
        onChange={setEntwurf}
        onAbsenden={setzen}
        autoFokus={quelle === 'maus'}
      />
    </Modal>
  );
}
