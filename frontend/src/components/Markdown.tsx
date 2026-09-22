import type { ComponentPropsWithoutRef } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
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
/**
 * Überschriften im Inhalt rücken um drei Ebenen nach unten (22.09.2026, gemessen im ETB:
 * sechs `h1` auf einer Seite). Markdown steht IMMER unter einem Seitentitel (`h1`), meist in
 * einem Paneel (`h2`) und oft unter einem Abschnittskopf (`h3`, Lagebericht/Befehl) — ein
 * `# Lageüberblick` im Text ist dort eine Gliederung INNERHALB des Eintrags, nicht eine
 * zweite Seite. Also: `#` → `h4`, `##` → `h5`, alles darunter `h6`.
 *
 * Die OPTIK bleibt die der Quellebene: die Klasse `md-h<n>` trägt die ursprüngliche Stufe,
 * `Markdown.css` setzt die Größe daran statt am Tag.
 */
export const UEBERSCHRIFT_VERSATZ = 3;

type Ebene = 1 | 2 | 3 | 4 | 5 | 6;

function ueberschrift(quelle: Ebene) {
  const ziel = Math.min(6, quelle + UEBERSCHRIFT_VERSATZ) as Ebene;
  const Tag = `h${ziel}` as const;
  function Ueberschrift(props: ComponentPropsWithoutRef<'h1'> & { node?: unknown }) {
    // `node` (hast-Knoten von react-markdown) gehört nicht ans DOM.
    const { className, ...rest } = props;
    delete rest.node;
    return <Tag {...rest} className={[`md-h${quelle}`, className].filter(Boolean).join(' ')} />;
  }
  return Ueberschrift;
}

const KOMPONENTEN: Components = {
  h1: ueberschrift(1),
  h2: ueberschrift(2),
  h3: ueberschrift(3),
  h4: ueberschrift(4),
  h5: ueberschrift(5),
  h6: ueberschrift(6),
};

export default function Markdown({ children, variante = 'dokument' }: Props) {
  return (
    <div className={`markdown markdown--${variante}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={KOMPONENTEN}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
