/**
 * Der Zeichen-Picker als Dialog (LLH-1038, Spec `lagekarte-zeichenwahl`, „Enter platziert“):
 * „Weitere …“ im Werkzeugmenü an der Karte öffnet ihn. „Platzieren“ (oder Enter im Picker)
 * startet das Platzieren auf der Karte mit der gerade sichtbaren Spec; der Aufrufer schließt den
 * Dialog. Kein `<Form>` — das Absenden gehört dem Aufrufer.
 *
 * Der Entwurf lebt hier, nicht im Picker: der Dialog bleibt eingehängt, der nächste beginnt beim
 * zuletzt platzierten Zeichen (wie früher im Paneel der Leiste). Fokus ins Suchfeld nur, wenn
 * „Weitere …“ nicht per Finger kam — am Touchschirm klappte sonst die Bildschirmtastatur über das
 * Raster (Muster `ZeichenHierDialog`).
 */
import { useState } from 'react';
import { Button, Modal, Space } from 'antd';
import type { FreiesZeichenUpdate } from '../../api/types';
import FreiesZeichenPicker, { hatZeichen, type ZeichenEntwurf } from './FreiesZeichenPicker';
import { START_ZEICHEN_SPEC } from './zeichenWahl';

interface Props {
  offen: boolean;
  /** Woher „Weitere …“ kam. */
  quelle: 'maus' | 'touch';
  onPlatzieren: (spec: FreiesZeichenUpdate) => void;
  onAbbrechen: () => void;
}

export default function ZeichenWahlDialog({ offen, quelle, onPlatzieren, onAbbrechen }: Props) {
  const [entwurf, setEntwurf] = useState<ZeichenEntwurf>({ zeichen_spec: START_ZEICHEN_SPEC });
  /** Knopf und Enter: der Entwurf übernimmt die Spec, damit der nächste Dialog dort weitermacht. */
  const platziere = (spec: FreiesZeichenUpdate) => {
    setEntwurf(spec);
    onPlatzieren(spec);
  };

  return (
    <Modal
      open={offen}
      title="Taktisches Zeichen"
      onCancel={onAbbrechen}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={onAbbrechen}>Abbrechen</Button>
          {/* Ohne Zeichen („Kein Grundzeichen“ vor der Symbolwahl) gesperrt. */}
          <Button
            type="primary"
            disabled={!hatZeichen(entwurf)}
            onClick={() => {
              if (hatZeichen(entwurf)) platziere(entwurf);
            }}
          >
            Platzieren
          </Button>
        </Space>
      }
    >
      {/* Enter im Picker nimmt denselben Weg wie der Knopf — mit der mitgebrachten Spec, weil
          `entwurf` die per Enter gewählte Kachel in dieser Runde noch nicht trägt. */}
      <FreiesZeichenPicker
        wert={entwurf}
        onChange={setEntwurf}
        onAbsenden={platziere}
        autoFokus={quelle === 'maus'}
      />
    </Modal>
  );
}
