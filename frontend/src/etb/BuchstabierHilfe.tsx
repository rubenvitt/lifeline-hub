import { useState } from 'react';
import { Button, Popover, Segmented, Space, Tag, Tooltip, Typography } from 'antd';
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
      {/*
        Der Tooltip ist die fehlende Erklärung des icon-only-Auslösers (LFH-365 · B5e):
        vorher trug er allein ein `aria-label`, war also für Maus und Touch stumm.

        Wortlaut gleich dem `aria-label`, damit sichtbarer Hinweis und zugänglicher Name
        übereinstimmen (WCAG 2.5.3). Die beiden Hüllen beißen sich nicht — der Tooltip
        hängt am Zeigereintritt, das Popover am Klick.

        Kein `size`-Prop am Knopf: die Trefffläche kommt aus `controlHeight`. Sie hing
        bis LFH-365 doppelt fest — an diesem Knopf UND am `Space.Compact` in
        `MetaChip.tsx`, das sie über den Kontext auch ohne eigene Prop erzwang.
      */}
      <Tooltip title="Buchstabierhilfe">
        <Button type="text" aria-label="Buchstabierhilfe" icon={<SoundOutlined />} />
      </Tooltip>
    </Popover>
  );
}
