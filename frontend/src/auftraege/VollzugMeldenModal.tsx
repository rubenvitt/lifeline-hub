import { App, Input, Modal } from 'antd';
import { ETB_INHALT_MAX } from '../api/eingabegrenzen';
import { useState } from 'react';

export default function VollzugMeldenModal({
  offen,
  onAbbrechen,
  onBestaetigen,
}: {
  offen: boolean;
  onAbbrechen: () => void;
  onBestaetigen: (vollzugsmeldung: string) => void;
}) {
  const { message } = App.useApp();
  const [text, setText] = useState('');
  return (
    <Modal
      title="Vollzug melden"
      open={offen}
      okText="Vollzug melden"
      onCancel={() => {
        setText('');
        onAbbrechen();
      }}
      onOk={() => {
        if (!text.trim()) {
          message.error('Rückmeldung erforderlich');
          return;
        }
        onBestaetigen(text.trim());
        setText('');
      }}
    >
      <Input.TextArea
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Rückmeldung zur Erledigung"
        // Die Vollzugsmeldung wird ETB-Eintrag: Grenze des ETB-Inhalts (LFH-937).
        maxLength={ETB_INHALT_MAX}
      />
    </Modal>
  );
}
