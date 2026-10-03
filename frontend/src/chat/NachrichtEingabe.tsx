import { IconBueroklammer } from '../icons';
import { Button, Input, Space, Upload } from 'antd';
import type { UploadFile } from 'antd';
import { useRef, useState } from 'react';

interface Props {
  /**
   * Sendet Text und/oder Anhänge. Mindestens eines ist nicht leer. Lehnt bei Ablehnung ab
   * (`mutateAsync`): dann bleiben Text und Anhänge stehen (LFH-795).
   */
  onSenden: (text: string, dateien: File[]) => Promise<unknown>;
  /** true, solange Upload/Sende-Mutation läuft. */
  senden: boolean;
}

export default function NachrichtEingabe({ onSenden, senden }: Props) {
  const [text, setText] = useState('');
  const [dateien, setDateien] = useState<UploadFile[]>([]);
  // Riegel gegen ein zweites Enter, solange gesendet wird: der Text steht bis zum Erfolg noch im
  // Feld, und `loading` am Knopf sperrt nur Klicks.
  const sendetRef = useRef(false);

  const absenden = async () => {
    if (sendetRef.current) return;
    const getrimmt = text.trim();
    // Die rohen File-Objekte stecken in originFileObj (beforeUpload=false → kein Auto-Upload).
    const rohdateien = dateien
      .map((f) => f.originFileObj as File | undefined)
      .filter((f): f is File => f !== undefined);
    if (!getrimmt && rohdateien.length === 0) return;
    sendetRef.current = true;
    try {
      await onSenden(getrimmt, rohdateien);
    } catch {
      // Abgelehnt: nichts leeren. Den Fehler meldet die Mutation des Aufrufers.
      return;
    } finally {
      sendetRef.current = false;
    }
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
              void absenden();
            }
          }}
        />
        <Button type="primary" loading={senden} onClick={() => void absenden()}>
          Senden
        </Button>
      </Space.Compact>
      <Upload
        multiple
        beforeUpload={() => false}
        fileList={dateien}
        onChange={({ fileList }) => setDateien(fileList)}
        style={{ marginTop: 8 }}
      >
        <Button type="text" icon={<IconBueroklammer />}>
          Anhang
        </Button>
      </Upload>
    </div>
  );
}
