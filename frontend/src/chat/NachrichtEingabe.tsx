import { IconBueroklammer } from '../icons';
import { Button, Input, Space, Upload } from 'antd';
import { ETB_INHALT_MAX } from '../api/eingabegrenzen';
import { istZuLang, zeichenGrenze, Zeichenzaehler } from '../components/zeichenGrenze';
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

  // Kein antd-Formular: über der Grenze sperrt das Senden, der Zähler nennt die Überlänge, der Text
  // bleibt stehen (LFH-937, `components/zeichenGrenze.tsx`).
  const zuLang = istZuLang(text, ETB_INHALT_MAX);

  const absenden = async () => {
    if (sendetRef.current || zuLang) return;
    const getrimmt = text.trim();
    // Die rohen File-Objekte stecken in originFileObj (beforeUpload=false → kein Auto-Upload).
    const rohdateien = dateien
      .map((f) => f.originFileObj as File | undefined)
      .filter((f): f is File => f !== undefined);
    if (!getrimmt && rohdateien.length === 0) return;
    // Feld und Liste bleiben während des Sendens bedienbar (offline pausiert die Mutation, bis das
    // Netz zurück ist). Nach dem Erfolg wird deshalb nur geleert, was gesendet wurde.
    const gesendeterText = text;
    const gesendeteDateien = new Set(dateien.map((f) => f.uid));
    sendetRef.current = true;
    try {
      await onSenden(getrimmt, rohdateien);
    } catch {
      // Abgelehnt: nichts leeren. Den Fehler meldet die Mutation des Aufrufers.
      return;
    } finally {
      sendetRef.current = false;
    }
    setText((jetzt) => (jetzt === gesendeterText ? '' : jetzt));
    setDateien((jetzt) => jetzt.filter((f) => !gesendeteDateien.has(f.uid)));
  };

  return (
    <div style={{ marginTop: 12 }}>
      <Space.Compact style={{ width: '100%' }}>
        <Input.TextArea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Nachricht…"
          // Grenze des Servers (LFH-937): eine Nachricht kann zum ETB-Eintrag heraufgestuft werden.
          // Ohne eingebauten Zähler: der legte das Feld in einen Rahmen, und das Textfeld verlöre
          // die 72-px-Trefffläche im Handschuh-Betrieb; der Zähler steht unter der Zeile.
          count={zeichenGrenze(ETB_INHALT_MAX, { zaehler: false })}
          autoSize={{ minRows: 1, maxRows: 4 }}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault();
              void absenden();
            }
          }}
        />
        <Button type="primary" loading={senden} disabled={zuLang} onClick={() => void absenden()}>
          Senden
        </Button>
      </Space.Compact>
      <Zeichenzaehler wert={text} max={ETB_INHALT_MAX} />
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
