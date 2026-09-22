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
  /**
   * Ebene der nächsten Überschrift über dem Text (Seitentitel = 1, Paneel = 2, …). Pflicht,
   * weil nur der Einbauort sie kennt — siehe {@link zielEbene}.
   */
  unterEbene: UnterEbene;
}

/** Ebene einer Überschrift, die über einem Markdown-Text stehen kann (h1 … h5). */
export type UnterEbene = 1 | 2 | 3 | 4 | 5;

type Ebene = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Überschriften im Inhalt stehen UNTER der Gliederung der Seite, nie neben ihr (gemessen im
 * ETB am 22.09.2026: sechs `h1` auf einer Seite). Ein `# Lageüberblick` im Text ist eine
 * Gliederung INNERHALB des Eintrags, nicht eine zweite Seite.
 *
 * Wie tief das ist, weiß nur der EINBAUORT (LFH-621) — dieselbe Regel wie `Paneel
 * ueberschrift` und `Augenbraue als`: die Ebene folgt der Gliederung der Seite. `unterEbene`
 * nennt die Ebene der nächsten Überschrift über dem Text, `#` wird die Stufe darunter,
 * `##` die nächste usw. Vorher rückte ein fester Versatz von drei alles pauschal nach
 * unten; damit fielen `###` und tiefer auch dort auf `h6` zusammen, wo über dem Text nur der
 * Seitentitel oder ein Tageskopf steht, und ein Vorleser konnte drei Quellstufen nicht mehr
 * unterscheiden. `h6` bleibt der Boden — erst jenseits davon fällt etwas zusammen, und ARIA-
 * Stufen über 6 werten Vorleser uneinheitlich aus.
 *
 * Die OPTIK bleibt die der Quellebene: die Klasse `md-h<n>` trägt die ursprüngliche Stufe,
 * `Markdown.css` setzt die Größe daran statt am Tag.
 */
function zielEbene(quelle: Ebene, unterEbene: UnterEbene): Ebene {
  return Math.min(6, quelle + unterEbene) as Ebene;
}

function ueberschrift(quelle: Ebene, unterEbene: UnterEbene) {
  const Tag = `h${zielEbene(quelle, unterEbene)}` as const;
  function Ueberschrift(props: ComponentPropsWithoutRef<'h1'> & { node?: unknown }) {
    // `node` (hast-Knoten von react-markdown) gehört nicht ans DOM.
    const { className, ...rest } = props;
    delete rest.node;
    return <Tag {...rest} className={[`md-h${quelle}`, className].filter(Boolean).join(' ')} />;
  }
  return Ueberschrift;
}

/** Je Einbauebene EINE stabile Komponententabelle — eine neue Tabelle je Render ließe
 *  react-markdown jede Überschrift neu einhängen. */
const KOMPONENTEN = Object.fromEntries(
  ([1, 2, 3, 4, 5] as const).map((unter) => [
    unter,
    {
      h1: ueberschrift(1, unter),
      h2: ueberschrift(2, unter),
      h3: ueberschrift(3, unter),
      h4: ueberschrift(4, unter),
      h5: ueberschrift(5, unter),
      h6: ueberschrift(6, unter),
    } satisfies Components,
  ]),
) as Record<UnterEbene, Components>;

/**
 * Rendert Markdown sicher als formatiertes HTML.
 *
 * Sicherheit: react-markdown lässt per Default **kein** rohes HTML durch
 * (kein `rehype-raw`) und entschärft gefährliche Link-Schemata (`javascript:`)
 * über seine eingebaute URL-Transformation. Damit ist die Anzeige XSS-sicher,
 * ohne dass wir selbst sanitisieren müssen.
 */
export default function Markdown({ children, variante = 'dokument', unterEbene }: Props) {
  return (
    <div className={`markdown markdown--${variante}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={KOMPONENTEN[unterEbene]}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
