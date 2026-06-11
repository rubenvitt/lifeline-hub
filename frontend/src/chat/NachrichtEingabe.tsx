import { Button, Input, Space } from 'antd';
import { useState } from 'react';

interface Props {
  onSenden: (text: string) => void;
  /** true, solange die Sende-Mutation läuft. */
  senden: boolean;
}

export default function NachrichtEingabe({ onSenden, senden }: Props) {
  const [text, setText] = useState('');

  const absenden = () => {
    const getrimmt = text.trim();
    if (!getrimmt) return;
    onSenden(getrimmt);
    setText('');
  };

  return (
    <Space.Compact style={{ width: '100%', marginTop: 12 }}>
      <Input.TextArea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Nachricht…"
        autoSize={{ minRows: 1, maxRows: 4 }}
        onPressEnter={(e) => {
          if (!e.shiftKey) {
            e.preventDefault();
            absenden();
          }
        }}
      />
      <Button type="primary" loading={senden} onClick={absenden}>Senden</Button>
    </Space.Compact>
  );
}
