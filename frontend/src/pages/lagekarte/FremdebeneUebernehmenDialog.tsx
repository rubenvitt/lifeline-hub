/**
 * „Übernehmen als …“ (LLH-2129): wählt die Zonenart, in die eine Fläche oder Linie aus einer
 * Fremdebene übernommen wird. Arten und Vorgabe aus `zonenArtenFuer` (Quelle `ZONE_TYPEN`).
 * Gestalt wie `ZeichenWahlDialog`: kein `<Form>`, ein Tipp neben den Dialog verwirft nichts.
 */
import { useState } from 'react';
import { Button, Modal, Radio, Space, Typography } from 'antd';
import { MASKE_HAELT_FOKUS } from '../../components/maskeHaeltFokus';
import Knopfreihe from '../../components/instrument/Knopfreihe';
import type { ZoneTyp } from '../../api/types';
import { zonenArtenFuer } from './fremdebeneUebernahme';

interface Props {
  offen: boolean;
  art: 'flaeche' | 'linie';
  /** Zahl der Teile; bei mehr als einem entsteht je Teil ein Objekt. */
  anzahl: number;
  laeuft: boolean;
  onBestaetigen: (typ: ZoneTyp) => void;
  onAbbrechen: () => void;
}

export default function FremdebeneUebernehmenDialog({
  offen,
  art,
  anzahl,
  laeuft,
  onBestaetigen,
  onAbbrechen,
}: Props) {
  const arten = zonenArtenFuer(art);
  const [typ, setTyp] = useState<ZoneTyp>(arten[0].typ);
  return (
    <Modal
      open={offen}
      title={art === 'flaeche' ? 'Fläche übernehmen als …' : 'Linie übernehmen als …'}
      onCancel={onAbbrechen}
      mask={{ closable: false }}
      wrapProps={MASKE_HAELT_FOKUS}
      destroyOnHidden
      footer={
        <Knopfreihe fuss>
          <Button onClick={onAbbrechen}>Abbrechen</Button>
          <Button type="primary" loading={laeuft} onClick={() => onBestaetigen(typ)}>
            Übernehmen
          </Button>
        </Knopfreihe>
      }
    >
      <Space orientation="vertical">
        <Radio.Group value={typ} onChange={(e) => setTyp(e.target.value as ZoneTyp)}>
          <Space orientation="vertical">
            {arten.map((a) => (
              <Radio key={a.typ} value={a.typ}>
                {a.label}
              </Radio>
            ))}
          </Space>
        </Radio.Group>
        <Typography.Text type="secondary">
          {anzahl > 1
            ? `Das Objekt hat ${anzahl} Teile; jedes wird eine eigene Zeichnung.`
            : 'Die Zeichnung gehört danach zum Einsatz und bleibt, wenn die Fremdebene entfernt wird.'}
        </Typography.Text>
      </Space>
    </Modal>
  );
}
