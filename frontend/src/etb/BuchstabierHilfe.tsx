import { useState } from 'react';
import { Button, Popover, Segmented, Space, Tag, Typography } from 'antd';
import { SoundOutlined } from '@ant-design/icons';
import { buchstabiere, type Buchstabiertafel } from './buchstabieren';

/**
 * Additive Eingabehilfe (LFH-110): zeigt auf Klick die zeichenweise Buchstabierung eines
 * Textes (Funkrufname/Absender/Empfänger) in einem Popover — umschaltbar zwischen der
 * klassischen deutschen Tafel und NATO. Ändert nichts am Wert oder Speicherformat.
 */
export default function BuchstabierHilfe({ text }: { text: string }) {
  const [tafel, setTafel] = useState<Buchstabiertafel>('din5009');
  const zeichen = buchstabiere(text, tafel);

  const inhalt = (
    <div style={{ maxWidth: 300 }}>
      <Segmented
        size="small"
        value={tafel}
        onChange={(v) => setTafel(v as Buchstabiertafel)}
        options={[{ value: 'din5009', label: 'Deutsch' }, { value: 'nato', label: 'NATO' }]}
      />
      <div style={{ marginTop: 8 }}>
        {text.trim() === '' ? (
          <Typography.Text type="secondary">Text im Feld eingeben …</Typography.Text>
        ) : (
          <Space wrap size={[4, 4]}>
            {zeichen.map((z, i) =>
              z.wort ? (
                <Tag key={i} style={{ margin: 0 }}>
                  <Typography.Text strong>{z.zeichen}</Typography.Text> <span>{z.wort}</span>
                </Tag>
              ) : (
                <Typography.Text key={i} type="secondary">{z.zeichen === ' ' ? '␣' : z.zeichen}</Typography.Text>
              ),
            )}
          </Space>
        )}
      </div>
    </div>
  );

  return (
    <Popover content={inhalt} title="Buchstabieren" trigger="click">
      <Button size="small" type="text" aria-label="Buchstabierhilfe" icon={<SoundOutlined />} />
    </Popover>
  );
}
