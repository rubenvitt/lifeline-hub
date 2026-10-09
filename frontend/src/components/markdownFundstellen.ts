/**
 * Fundstellen der Volltextsuche im gerenderten Markdown (LFH-1056).
 *
 * Markiert wird im hast-Baum, nicht im Quelltext: ein `<mark>` im Markdown zerbräche Fettung,
 * Listen und Links, und rohes HTML lässt `Markdown` nicht durch. Jeder Textknoten wird für sich
 * durchsucht (`volltextFundstellen.ts`); ein Wort über eine Formatgrenze hinweg („**Dei**ch")
 * trifft auch der Server nicht, denn `unicode61` trennt an den Sternen.
 */
import { FUNDSTELLE_KLASSE, type Suchphrase, zerlegeNachFundstellen } from './volltextFundstellen';

/** Der Ausschnitt aus hast, den das Plugin anfasst (react-markdown bringt die Typen nicht mit). */
interface Knoten {
  type: string;
}

interface Text extends Knoten {
  type: 'text';
  value: string;
}

interface Eltern extends Knoten {
  children: Knoten[];
}

function istText(k: Knoten): k is Text {
  return k.type === 'text';
}

function hat(k: Knoten): k is Eltern {
  return Array.isArray((k as Eltern).children);
}

/** Ersetzt in `eltern` (rekursiv) jeden Textknoten mit Fundstelle durch Text und `<mark>`. */
export function markiereFundstellen(eltern: Eltern, phrasen: readonly Suchphrase[]): void {
  const neu: Knoten[] = [];
  for (const k of eltern.children) {
    if (hat(k)) markiereFundstellen(k, phrasen);
    if (!istText(k)) {
      neu.push(k);
      continue;
    }
    for (const s of zerlegeNachFundstellen(k.value, phrasen)) {
      const text: Text = { type: 'text', value: s.text };
      neu.push(
        s.fund
          ? ({
              type: 'element',
              tagName: 'mark',
              properties: { className: [FUNDSTELLE_KLASSE] },
              children: [text],
            } as Knoten)
          : text,
      );
    }
  }
  eltern.children = neu;
}

interface Optionen {
  phrasen: readonly Suchphrase[];
}

/** rehype-Plugin für `react-markdown` (`rehypePlugins`). */
export default function fundstellenMarkieren({ phrasen }: Optionen) {
  return (baum: Knoten) => {
    if (hat(baum) && phrasen.length > 0) markiereFundstellen(baum, phrasen);
  };
}
