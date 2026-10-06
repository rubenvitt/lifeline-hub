import { App, Input, Modal } from 'antd';
import { ETB_INHALT_MAX } from '../api/eingabegrenzen';
import { istZuLang, zeichenGrenze } from '../components/zeichenGrenze';
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
  // Kein antd-Formular: die Grenze des ETB-Inhalts sperrt den Knopf, der Zähler nennt die
  // Überlänge; der Text bleibt stehen (LFH-937, `components/zeichenGrenze.tsx`).
  const zuLang = istZuLang(text, ETB_INHALT_MAX);
  return (
    <Modal
      title="Vollzug melden"
      open={offen}
      okText="Vollzug melden"
      okButtonProps={{ disabled: zuLang }}
      onCancel={() => {
        setText('');
        onAbbrechen();
      }}
      onOk={() => {
        if (zuLang) return;
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
        count={zeichenGrenze(ETB_INHALT_MAX)}
      />
    </Modal>
  );
}
