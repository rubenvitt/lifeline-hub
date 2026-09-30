import { IkoneAuge } from '../ikonen';
import { Button, Input, Tabs, Typography } from 'antd';
import type { GetRef } from 'antd';
import { forwardRef, useState, type KeyboardEvent } from 'react';
import Markdown, { type UnterEbene } from './Markdown';
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
  /**
   * Ebene der nächsten Überschrift über dem Feld — an die Vorschau durchgereicht, damit ein
   * `#` im Entwurf dieselbe Stufe bekommt wie an seinem Einbauort (LFH-621).
   */
  unterEbene: UnterEbene;
  placeholder?: string;
  autoSize?: boolean | { minRows?: number; maxRows?: number };
  rows?: number;
  /** Von antd Form.Item gesetzt (für Label-Verknüpfung). */
  id?: string;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  /**
   * Sperrt die Eingabe, ohne den Fokus zu nehmen (`readOnly`, nicht `disabled`): die
   * ETB-Schnellerfassung hält so den Wortlaut fest, während ein Versand läuft (LFH-117).
   */
  readOnly?: boolean;
  /**
   * Nur `toggle`: rendert bei geschlossener Vorschau zusätzlich eine gerenderte Fassung, die nur
   * der Druck zeigt (`.markdown-editor__druck`). Sonst trüge auf Papier eine `<textarea>` mit
   * abgeschnittenem Rohtext (LFH-71). Opt-in, weil sie einen Markdown-Render je Anschlag kostet.
   */
  druckfassung?: boolean;
  /**
   * Nur `toggle`: der Aufrufer führt den Vorschau-Umschalter selbst (LFH-373); der eigene Knopf
   * unter dem Feld entfällt, die Vorschau folgt {@link vorschauOffen}. Für die ETB-Erfassung, wo
   * eine eigene Knopfzeile im Handschuh-Betrieb eine volle Steuerhöhe der angepinnten Leiste
   * kostete.
   */
  umschalterAussen?: boolean;
  /** Nur mit {@link umschalterAussen}: ob die Vorschau offen ist. */
  vorschauOffen?: boolean;
}

/**
 * Eingabefeld, das den getippten Markdown direkt als Vorschau spiegelt.
 *
 * Bewusst KEIN WYSIWYG: gespeichert wird exakt der getippte Markdown-String, und als
 * controlled `value`/`onChange`-Komponente bleibt sie mit extern gesetztem `value` (z. B.
 * Baustein-Einsetzen) kompatibel. Die Vorschau nutzt die XSS-sichere `Markdown`-Komponente.
 */
const MarkdownEditor = forwardRef<TextAreaRef, Props>(function MarkdownEditor(
  {
    value = '',
    onChange,
    layout = 'split',
    variante = 'dokument',
    unterEbene,
    placeholder,
    autoSize,
    rows,
    id,
    onKeyDown,
    readOnly,
    druckfassung = false,
    umschalterAussen = false,
    vorschauOffen: vorschauOffenAussen = false,
  },
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
      readOnly={readOnly}
    />
  );

  const vorschau = value.trim() ? (
    <Markdown variante={variante} unterEbene={unterEbene}>
      {value}
    </Markdown>
  ) : (
    <Typography.Text type="secondary">Noch nichts zu zeigen.</Typography.Text>
  );

  if (layout === 'toggle') {
    const offen = umschalterAussen ? vorschauOffenAussen : vorschauOffen;
    return (
      <div className="markdown-editor markdown-editor--toggle">
        {textfeld}
        {!umschalterAussen && (
          <div style={{ marginTop: 4 }}>
            <Button type="text" icon={<IkoneAuge />} onClick={() => setVorschauOffen((v) => !v)}>
              Vorschau
            </Button>
          </div>
        )}
        {offen && <div className="markdown-editor__vorschau">{vorschau}</div>}
        {/* Genau EINE gerenderte Fassung im Baum: ist die Vorschau offen, trägt sie den Text.
            Leer wie im Lesezweig (`LageberichtText`): „—", kein „Noch nichts zu zeigen". */}
        {druckfassung && !offen && (
          // Nur Papier: `aria-hidden` sagt dem Zugänglichkeitsbaum dasselbe wie das
          // `display: none` am Bildschirm, auch ohne geladenes CSS (Muster Druckkopf).
          <div className="markdown-editor__druck" aria-hidden>
            {value.trim() ? (
              <Markdown variante={variante} unterEbene={unterEbene}>
                {value}
              </Markdown>
            ) : (
              <Typography.Paragraph>—</Typography.Paragraph>
            )}
          </div>
        )}
      </div>
    );
  }

  if (layout === 'tabs') {
    return (
      <div className="markdown-editor markdown-editor--tabs">
        <Tabs
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
