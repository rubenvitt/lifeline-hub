import {
  createContext,
  memo,
  useContext,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react';
import ReactMarkdown, { type Components, type Options } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import titelbloecke, { TITELPLATZ } from './markdownTitelbloecke';
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
  /**
   * Abschnittstitel des Einbauorts. Er steht im selben Titelblock wie der erste Block des Textes
   * (`markdownTitelbloecke.ts`), damit er im Druck nicht allein am Seitenende bleibt (LFH-1008).
   */
  titel?: ReactNode;
}

/** Ebene einer Überschrift, die über einem Markdown-Text stehen kann (h1 … h5). */
export type UnterEbene = 1 | 2 | 3 | 4 | 5;

type Ebene = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Überschriften im Inhalt stehen UNTER der Gliederung der Seite, nie neben ihr: ein
 * `# Lageüberblick` im Text gliedert INNERHALB des Eintrags.
 *
 * Wie tief das ist, weiß nur der EINBAUORT (LFH-621), wie bei `Paneel ueberschrift` und
 * `Augenbraue als`. `unterEbene` nennt die Ebene der nächsten Überschrift über dem Text, `#` wird
 * die Stufe darunter, `##` die nächste usw. Kein fester Versatz, sonst fielen `###` und tiefer
 * auch dort auf `h6` zusammen, wo nur der Seitentitel darübersteht. `h6` ist der Boden; ARIA-
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

/** Der Titel des Einbauorts für den Platzhalter — über Kontext, damit die Tabellen stabil bleiben. */
const TitelKontext = createContext<ReactNode>(null);

/** Markdown selbst erzeugt keine `div` (kein rohes HTML); hier kommen nur die Titelhüllen an. */
function Block(props: ComponentPropsWithoutRef<'div'> & { node?: unknown }) {
  const titel = useContext(TitelKontext);
  const rest = { ...props };
  delete rest.node;
  if ((rest as Record<string, unknown>)['data-lfh'] === TITELPLATZ) {
    return <div {...rest}>{titel}</div>;
  }
  return <div {...rest} />;
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
      div: Block,
    } satisfies Components,
  ]),
) as Record<UnterEbene, Components>;

/** Eine Plugin-Liste für alle Aufrufe: ein neues Array je Render stieße den Parse jedes Mal an. */
const REMARK_PLUGINS = [remarkGfm];
type PluggableList = NonNullable<Options['rehypePlugins']>;
const REHYPE_PLUGINS: PluggableList = [titelbloecke];
const REHYPE_PLUGINS_MIT_KOPF: PluggableList = [[titelbloecke, { kopf: true }]];

/**
 * Rendert Markdown sicher als formatiertes HTML.
 *
 * Sicherheit: react-markdown lässt per Default **kein** rohes HTML durch
 * (kein `rehype-raw`) und entschärft gefährliche Link-Schemata (`javascript:`)
 * über seine eingebaute URL-Transformation. Damit ist die Anzeige XSS-sicher,
 * ohne dass wir selbst sanitisieren müssen.
 */
function Markdown({ children, variante = 'dokument', unterEbene, titel }: Props) {
  const mitKopf = titel !== undefined && titel !== null;
  return (
    <div className={`markdown markdown--${variante}`}>
      <TitelKontext.Provider value={titel}>
        <ReactMarkdown
          remarkPlugins={REMARK_PLUGINS}
          rehypePlugins={mitKopf ? REHYPE_PLUGINS_MIT_KOPF : REHYPE_PLUGINS}
          components={KOMPONENTEN[unterEbene]}
        >
          {children}
        </ReactMarkdown>
      </TitelKontext.Provider>
    </div>
  );
}

/**
 * Gemerkt (LFH-947): alle Eigenschaften sind Werte, ein Rerender des Aufrufers mit demselben
 * Text parst nicht neu. Die Zeitachse rendert hunderte davon. Ausnahme ist `titel`, ein
 * Element; das reichen nur die Lesefassungen der Vorlagendokumente und der Einsatzbericht herein,
 * nicht die Zeitachse.
 */
export default memo(Markdown);
