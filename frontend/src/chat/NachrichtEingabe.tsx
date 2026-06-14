import { PaperClipOutlined } from '@ant-design/icons';
import { Button, Input, Space, Upload } from 'antd';
import type { UploadFile } from 'antd';
import { useState } from 'react';

interface Props {
  /** Sendet Text und/oder Anhänge. Mindestens eines ist nicht leer. */
  onSenden: (text: string, dateien: File[]) => void;
  /** true, solange Upload/Sende-Mutation läuft. */
  senden: boolean;
}

export default function NachrichtEingabe({ onSenden, senden }: Props) {
  const [text, setText] = useState('');
  const [dateien, setDateien] = useState<UploadFile[]>([]);

  const absenden = () => {
    const getrimmt = text.trim();
    // Die rohen File-Objekte stecken in originFileObj (beforeUpload=false → kein Auto-Upload).
    const rohdateien = dateien
      .map((f) => f.originFileObj as File | undefined)
      .filter((f): f is File => f !== undefined);
    if (!getrimmt && rohdateien.length === 0) return;
    onSenden(getrimmt, rohdateien);
    setText('');
    setDateien([]);
  };

  return (
    <div style={{ marginTop: 12 }}>
      <Space.Compact style={{ width: '100%' }}>
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
      <Upload
        multiple
        beforeUpload={() => false}
        fileList={dateien}
        onChange={({ fileList }) => setDateien(fileList)}
        style={{ marginTop: 8 }}
      >
        <Button size="small" type="text" icon={<PaperClipOutlined />}>Anhang</Button>
      </Upload>
    </div>
  );
}
