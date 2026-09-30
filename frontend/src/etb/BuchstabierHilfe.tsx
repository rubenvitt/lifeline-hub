import { IkoneLautsprecher } from '../ikonen';
import { useState } from 'react';
import { Button, Popover, Segmented, Space, Tag, Tooltip, Typography } from 'antd';
import { buchstabiere, type Buchstabiertafel } from './buchstabieren';

/**
 * Additive Eingabehilfe (LFH-110): zeigt auf Klick die zeichenweise Buchstabierung eines
 * Textes (Funkrufname/Absender/Empfänger) in einem Popover — umschaltbar zwischen der
 * klassischen deutschen Tafel und NATO. Ändert nichts am Wert oder Speicherformat.
 */
export default function BuchstabierHilfe({ text }: { text: string }) {
  const [tafel, setTafel] = useState<Buchstabiertafel>('din5009');
  /**
   * Der Popover-Zustand liegt hier, damit der Tooltip von ihm weiß.
   *
   * Beide Hüllen hängen am selben Knopf und teilen Anker wie Ausrichtung; der Tooltip liegt per
   * z-index über dem Popover und verdeckte dessen erste Tafelzeile. Auf Touch ist das der
   * Normalfall — rc-trigger ergänzt einem Hover-Auslöser `touch`, ein Tipp öffnet beides.
   */
  const [tafelOffen, setTafelOffen] = useState(false);
  const zeichen = buchstabiere(text, tafel);

  const inhalt = (
    <div style={{ maxWidth: 300 }}>
      <Segmented
        value={tafel}
        onChange={(v) => setTafel(v as Buchstabiertafel)}
        options={[
          { value: 'din5009', label: 'Deutsch' },
          { value: 'nato', label: 'NATO' },
        ]}
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
                <Typography.Text key={i} type="secondary">
                  {z.zeichen === ' ' ? '␣' : z.zeichen}
                </Typography.Text>
              ),
            )}
          </Space>
        )}
      </div>
    </div>
  );

  return (
    <Popover
      content={inhalt}
      title="Buchstabieren"
      trigger="click"
      open={tafelOffen}
      onOpenChange={setTafelOffen}
    >
      {/* Der Tooltip erklärt den icon-only-Auslöser für Maus und Touch (LFH-365). Wortlaut gleich dem
         `aria-label` (WCAG 2.5.3).

         Der leere Titel bei offener Tafel ist der Riegel gegen den Stapel: antd rendert ohne Titel
         kein Overlay. Ein `open={false}` täte es nicht — es machte den Tooltip dauerhaft kontrolliert
         und nähme ihm sein eigenes Zeigerverhalten.

         Kein `size`-Prop am Knopf: die Trefffläche kommt aus `controlHeight`. */}
      <Tooltip title={tafelOffen ? '' : 'Buchstabierhilfe'}>
        <Button type="text" aria-label="Buchstabierhilfe" icon={<IkoneLautsprecher />} />
      </Tooltip>
    </Popover>
  );
}
