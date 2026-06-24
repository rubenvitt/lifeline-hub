// src/etb/BausteinPlatzhalterModal.tsx
import { Button, Form, Input, Modal, Space } from 'antd';
import { useEffect, useState } from 'react';
import type { EtbBaustein, EinsatzAnzeige } from '../api/types';
import { ermittlePlatzhalter, setzeBausteinEin, type BausteinFelder } from './bausteinEinsetzen';

interface Props {
  /** Gesetzt = dieser Baustein wird eingesetzt; null = nichts offen. */
  baustein: EtbBaustein | null;
  einsatz: EinsatzAnzeige;
  /** Liefert die fertig substituierten Felder. */
  onEinsetzen: (felder: BausteinFelder) => void;
  /** Modal ohne Einsetzen geschlossen. */
  onAbbrechenAll: () => void;
}

export default function BausteinPlatzhalterModal({ baustein, einsatz, onEinsetzen, onAbbrechenAll }: Props) {
  const [werte, setWerte] = useState<Record<string, string>>({});
  const offenePlatzhalter = baustein ? ermittlePlatzhalter(baustein, einsatz) : [];

  // Bausteine ohne manuelle Platzhalter sofort einsetzen (kein Dialog nötig).
  useEffect(() => {
    if (baustein && offenePlatzhalter.length === 0) {
      onEinsetzen(setzeBausteinEin(baustein, einsatz, {}));
      setWerte({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baustein]);

  function anwenden() {
    if (!baustein) return;
    onEinsetzen(setzeBausteinEin(baustein, einsatz, werte));
    setWerte({});
  }

  const dialogOffen = baustein !== null && offenePlatzhalter.length > 0;

  return (
    <Modal open={dialogOffen} title="Baustein einsetzen" footer={null} onCancel={onAbbrechenAll} destroyOnHidden>
      <Space orientation="vertical" style={{ width: '100%' }}>
        {offenePlatzhalter.map((name) => (
          <Form.Item key={name} label={name} style={{ marginBottom: 8 }}>
            <Input
              aria-label={name}
              value={werte[name] ?? ''}
              onChange={(e) => setWerte((w) => ({ ...w, [name]: e.target.value }))}
            />
          </Form.Item>
        ))}
        <Button type="primary" onClick={anwenden}>Einsetzen</Button>
      </Space>
    </Modal>
  );
}
