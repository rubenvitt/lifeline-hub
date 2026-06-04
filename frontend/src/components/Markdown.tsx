import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './Markdown.css';

type Variante = 'kompakt' | 'dokument';

interface Props {
  /** Markdown-Quelltext. */
  children: string;
  /**
   * `dokument` (Default): großzügige Typografie für die Lagebericht-Anzeige.
   * `kompakt`: gedämpfte Block-Margins für ETB-Tabellenzellen.
   */
  variante?: Variante;
}

/**
 * Rendert Markdown sicher als formatiertes HTML.
 *
 * Sicherheit: react-markdown lässt per Default **kein** rohes HTML durch
 * (kein `rehype-raw`) und entschärft gefährliche Link-Schemata (`javascript:`)
 * über seine eingebaute URL-Transformation. Damit ist die Anzeige XSS-sicher,
 * ohne dass wir selbst sanitisieren müssen.
 */
export default function Markdown({ children, variante = 'dokument' }: Props) {
  return (
    <div className={`markdown markdown--${variante}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
