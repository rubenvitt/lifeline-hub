import { Input, Tabs, Typography } from 'antd';
import { useState } from 'react';
import Markdown from './Markdown';
import './MarkdownEditor.css';

type Layout = 'split' | 'tabs';
type Variante = 'kompakt' | 'dokument';

interface Props {
  /** Markdown-Quelltext (controlled — von antd Form.Item gesetzt). */
  value?: string;
  /** Liefert den neuen Markdown-Text als reinen String. */
  onChange?: (value: string) => void;
  /**
   * `split` (Default): Eingabe und Live-Vorschau nebeneinander (Lagebericht).
   * `tabs`: kompakter Schreiben/Vorschau-Umschalter (ETB-Schnellerfassung).
   */
  layout?: Layout;
  /** Darstellung der Vorschau — soll der späteren Anzeige entsprechen. */
  variante?: Variante;
  placeholder?: string;
  autoSize?: boolean | { minRows?: number; maxRows?: number };
  rows?: number;
  /** Von antd Form.Item gesetzt (für Label-Verknüpfung). */
  id?: string;
}

/** Dezenter Hinweis, solange noch nichts getippt wurde. */
function LeereVorschau() {
  return <Typography.Text type="secondary">Noch nichts zu zeigen.</Typography.Text>;
}

/**
 * Eingabefeld, das den getippten Markdown direkt als Vorschau spiegelt.
 *
 * Bewusst KEIN WYSIWYG: gespeichert wird exakt der getippte Markdown-String
 * (kein verlustbehafteter Roundtrip), und als controlled `value`/`onChange`-
 * Komponente bleibt sie mit antd Form (z.B. BausteinPicker via setFieldsValue)
 * voll kompatibel. Die Vorschau nutzt die XSS-sichere `Markdown`-Komponente.
 */
export default function MarkdownEditor({
  value = '',
  onChange,
  layout = 'split',
  variante = 'dokument',
  placeholder,
  autoSize,
  rows,
  id,
}: Props) {
  const [aktiv, setAktiv] = useState<'schreiben' | 'vorschau'>('schreiben');

  const textfeld = (
    <Input.TextArea
      id={id}
      value={value}
      placeholder={placeholder}
      autoSize={autoSize}
      rows={rows}
      onChange={(e) => onChange?.(e.target.value)}
    />
  );

  const vorschau = value.trim() ? (
    <Markdown variante={variante}>{value}</Markdown>
  ) : (
    <LeereVorschau />
  );

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
}
