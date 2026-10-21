import { IconAuge } from '../icons';
import { Button, Input, Typography } from 'antd';
import type { GetRef } from 'antd';
import {
  forwardRef,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import Markdown, { type UnterEbene } from './Markdown';
import { zeichenGrenze } from './zeichenGrenze';
import './MarkdownEditor.css';

/** Ref-Typ des inneren antd Input.TextArea (hat `resizableTextArea.textArea`). */
export type TextAreaRef = GetRef<typeof Input.TextArea>;

type Variante = 'kompakt' | 'dokument';

interface Props {
  /** Markdown-Quelltext (controlled — von antd Form.Item gesetzt). */
  value?: string;
  /** Liefert den neuen Markdown-Text als reinen String. */
  onChange?: (value: string) => void;
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
  /**
   * Beschreibung des Feldes (Hilfetext im Abschnittskopf des Entwurfs, oder von antd Form.Item bei
   * `extra`/Prüffehler gesetzt) — ans Textfeld durchgereicht, sonst ginge sie hier verloren.
   */
  'aria-describedby'?: string;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Beschriftung der Eingabetaste auf der Bildschirmtastatur (LFH-955: ETB „enter“). */
  enterKeyHint?: TextareaHTMLAttributes<HTMLTextAreaElement>['enterKeyHint'];
  /**
   * Sperrt die Eingabe, ohne den Fokus zu nehmen (`readOnly`, nicht `disabled`): die
   * ETB-Schnellerfassung hält so den Wortlaut fest, während ein Versand läuft (LFH-117).
   */
  readOnly?: boolean;
  /**
   * Rendert bei geschlossener Vorschau zusätzlich eine gerenderte Fassung, die nur
   * der Druck zeigt (`.markdown-editor__druck`, sichtbar gemacht von `entwurf/dokumentEntwurf.css`).
   * Sonst trüge auf Papier eine `<textarea>` mit abgeschnittenem Rohtext (LFH-71). Opt-in, weil sie
   * einen Markdown-Render je Anschlag kostet.
   */
  druckfassung?: boolean;
  /**
   * Abschnittstitel auf Papier (LFH-1008). Steht im selben Titelblock wie der erste Block der
   * gerenderten Fassung, damit er im Druck nicht allein am Seitenende bleibt; der Kopf des
   * Einbauorts (Abschnittskopf des Entwurfs) liegt außerhalb und weicht im Druck dafür
   * (`entwurf/dokumentEntwurf.css`). Am Bildschirm unsichtbar.
   */
  druckTitel?: string;
  /**
   * Der Aufrufer führt den Vorschau-Umschalter selbst (LFH-373); der eigene Knopf
   * unter dem Feld entfällt, die Vorschau folgt {@link vorschauOffen}. Für die ETB-Erfassung, wo
   * eine eigene Knopfzeile im Handschuh-Betrieb eine volle Steuerhöhe der angepinnten Leiste
   * kostete.
   */
  umschalterAussen?: boolean;
  /** Nur mit {@link umschalterAussen}: ob die Vorschau offen ist. */
  vorschauOffen?: boolean;
  /**
   * Grenze des Servers in Zeichen (LFH-937, `api/eingabegrenzen.ts`): das Textfeld nimmt darüber
   * nichts an und zeigt ab 80 % „n / max“ (`components/zeichenGrenze.tsx`). Ein von außen gesetzter
   * längerer Wert (Baustein) bleibt stehen; den hält der Aufrufer vor dem Senden zurück.
   */
  maxLength?: number;
  /**
   * Nur mit {@link maxLength}: der Aufrufer zeigt den Zähler selbst (ETB-Hinweiszeile), das Feld
   * zählt nicht unter sich — die angepinnte Erfassungsleiste hat ein Höhenbudget.
   */
  zaehlerAussen?: boolean;
}

/**
 * Eingabefeld mit zuschaltbarer Markdown-Vorschau: schlankes Feld und dezenter Vorschau-Knopf
 * darunter (oder ein Umschalter des Aufrufers, {@link Props.umschalterAussen}). So schreiben die
 * Entwurfsseite (`entwurf/DokumentEntwurf.tsx`) und die ETB-Schnellerfassung.
 *
 * Bewusst KEIN WYSIWYG: gespeichert wird exakt der getippte Markdown-String, und als
 * controlled `value`/`onChange`-Komponente bleibt sie mit extern gesetztem `value` (z. B.
 * Baustein-Einsetzen) kompatibel. Die Vorschau nutzt die XSS-sichere `Markdown`-Komponente.
 */
const MarkdownEditor = forwardRef<TextAreaRef, Props>(function MarkdownEditor(
  {
    value = '',
    onChange,
    variante = 'dokument',
    unterEbene,
    placeholder,
    autoSize,
    rows,
    id,
    'aria-describedby': beschreibung,
    onKeyDown,
    enterKeyHint,
    readOnly,
    druckfassung = false,
    druckTitel,
    umschalterAussen = false,
    vorschauOffen: vorschauOffenAussen = false,
    maxLength,
    zaehlerAussen = false,
  },
  ref,
) {
  const [vorschauOffen, setVorschauOffen] = useState(false);

  const textfeld = (
    <Input.TextArea
      ref={ref}
      id={id}
      aria-describedby={beschreibung}
      value={value}
      placeholder={placeholder}
      autoSize={autoSize}
      rows={rows}
      onChange={(e) => onChange?.(e.target.value)}
      onKeyDown={onKeyDown}
      enterKeyHint={enterKeyHint}
      readOnly={readOnly}
      count={maxLength != null ? zeichenGrenze(maxLength, { zaehler: !zaehlerAussen }) : undefined}
    />
  );

  // Nur Papier, `aria-hidden` wie die Druckfassung: am Bildschirm nennt der Kopf des Einbauorts
  // den Abschnitt. Gemerkt, sonst parste `Markdown` (`memo`) bei jedem Render neu.
  const titel = useMemo(
    () =>
      druckTitel ? (
        <div className="markdown-editor__titel" aria-hidden>
          {druckTitel}
        </div>
      ) : undefined,
    [druckTitel],
  );

  /** Gerenderte Fassung; ohne Text der Ersatz, mit dem Titel in einem Titelblock. */
  const gerendert = (ersatz: ReactNode) =>
    value.trim() ? (
      <Markdown variante={variante} unterEbene={unterEbene} titel={titel}>
        {value}
      </Markdown>
    ) : titel ? (
      <div data-lfh="titelblock">
        {titel}
        {ersatz}
      </div>
    ) : (
      ersatz
    );

  const vorschau = gerendert(
    <Typography.Text type="secondary">Noch nichts zu zeigen.</Typography.Text>,
  );

  const offen = umschalterAussen ? vorschauOffenAussen : vorschauOffen;
  return (
    <div className="markdown-editor">
      {textfeld}
      {!umschalterAussen && (
        <div style={{ marginTop: 4 }}>
          <Button type="text" icon={<IconAuge />} onClick={() => setVorschauOffen((v) => !v)}>
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
          {gerendert(<Typography.Paragraph>—</Typography.Paragraph>)}
        </div>
      )}
    </div>
  );
});

export default MarkdownEditor;
