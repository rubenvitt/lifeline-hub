import { Button, Input, Tabs, Typography } from 'antd';
import type { GetRef } from 'antd';
import { EyeOutlined } from '@ant-design/icons';
import { forwardRef, useState, type KeyboardEvent } from 'react';
import Markdown from './Markdown';
import './MarkdownEditor.css';

/** Ref-Typ des inneren antd Input.TextArea (hat `resizableTextArea.textArea`). */
export type TextAreaRef = GetRef<typeof Input.TextArea>;

type Layout = 'split' | 'tabs' | 'toggle';
type Variante = 'kompakt' | 'dokument';

interface Props {
  /** Markdown-Quelltext (controlled — von antd Form.Item gesetzt). */
  value?: string;
  /** Liefert den neuen Markdown-Text als reinen String. */
  onChange?: (value: string) => void;
  /**
   * `split` (Default): Eingabe und Live-Vorschau nebeneinander (Lagebericht).
   * `tabs`: kompakter Schreiben/Vorschau-Umschalter (ETB-Schnellerfassung).
   * `toggle`: schlankes Feld + dezenter Vorschau-Button (Command-Bar-Flow).
   */
  layout?: Layout;
  /** Darstellung der Vorschau — soll der späteren Anzeige entsprechen. */
  variante?: Variante;
  placeholder?: string;
  autoSize?: boolean | { minRows?: number; maxRows?: number };
  rows?: number;
  /** Von antd Form.Item gesetzt (für Label-Verknüpfung). */
  id?: string;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
}

/**
 * Eingabefeld, das den getippten Markdown direkt als Vorschau spiegelt.
 *
 * Bewusst KEIN WYSIWYG: gespeichert wird exakt der getippte Markdown-String
 * (kein verlustbehafteter Roundtrip), und als controlled `value`/`onChange`-
 * Komponente bleibt sie mit extern gesetztem `value` (z.B. Baustein-Einsetzen)
 * voll kompatibel. Die Vorschau nutzt die XSS-sichere `Markdown`-Komponente.
 */
const MarkdownEditor = forwardRef<TextAreaRef, Props>(function MarkdownEditor(
  { value = '', onChange, layout = 'split', variante = 'dokument', placeholder, autoSize, rows, id, onKeyDown },
  ref,
) {
  const [aktiv, setAktiv] = useState<'schreiben' | 'vorschau'>('schreiben');
  const [vorschauOffen, setVorschauOffen] = useState(false);

  const textfeld = (
    <Input.TextArea
      ref={ref}
      id={id}
      value={value}
      placeholder={placeholder}
      autoSize={autoSize}
      rows={rows}
      onChange={(e) => onChange?.(e.target.value)}
      onKeyDown={onKeyDown}
    />
  );

  const vorschau = value.trim() ? (
    <Markdown variante={variante}>{value}</Markdown>
  ) : (
    <Typography.Text type="secondary">Noch nichts zu zeigen.</Typography.Text>
  );

  if (layout === 'toggle') {
    return (
      <div className="markdown-editor markdown-editor--toggle">
        {textfeld}
        <div style={{ marginTop: 4 }}>
          <Button
            type="text"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => setVorschauOffen((v) => !v)}
          >
            Vorschau
          </Button>
        </div>
        {vorschauOffen && <div className="markdown-editor__vorschau">{vorschau}</div>}
      </div>
    );
  }

  if (layout === 'tabs') {
    return (
      <div className="markdown-editor markdown-editor--tabs">
        <Tabs
          size="small"
          activeKey={aktiv}
          onChange={(k) => setAktiv(k as 'schreiben' | 'vorschau')}
          items={[
            { key: 'schreiben', label: 'Schreiben', children: textfeld },
            {
              key: 'vorschau',
              label: 'Vorschau',
              children: (
                <div className="markdown-editor__vorschau">
                  {aktiv === 'vorschau' ? vorschau : null}
                </div>
              ),
            },
          ]}
        />
      </div>
    );
  }

  return (
    <div className="markdown-editor markdown-editor--split">
      <div className="markdown-editor__eingabe">{textfeld}</div>
      <div className="markdown-editor__vorschau">
        <div className="markdown-editor__label">Vorschau</div>
        {vorschau}
      </div>
    </div>
  );
});

export default MarkdownEditor;
