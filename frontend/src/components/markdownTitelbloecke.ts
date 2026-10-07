/**
 * Titelblöcke im gerenderten Markdown (LFH-1008).
 *
 * Firefox setzt `break-after: avoid` nicht um: ein Abschnittstitel kann dort allein am
 * Seitenende stehen, sein Text erst auf der nächsten Seite. `break-inside: avoid` hält er ein.
 * Deshalb fasst dieses rehype-Plugin jede Überschrift (bzw. eine Folge von Überschriften) mit
 * dem ersten Block danach in eine gemeinsame Hülle `data-lfh="titelblock"`; `druck/druck.css`
 * hält die Hülle zusammen. Am Bildschirm ist sie eine Box ohne Rand und Polster, die Abstände
 * der Kinder kollabieren durch sie hindurch wie vorher.
 *
 * Mit `kopf` steht vor dem Text ein Platzhalter `data-lfh="titelplatz"`; er gilt als Titel und
 * landet so im selben Block wie der erste Absatz. `Markdown` setzt dort den Abschnittstitel des
 * Einbauorts ein (Prop `titel`), der sonst AUSSERHALB des Markdowns stünde und sich nicht mit dem
 * ersten Absatz zusammenfassen ließe.
 */

/** Der Ausschnitt aus hast, den das Plugin anfasst (react-markdown bringt die Typen nicht mit). */
interface Knoten {
  type: string;
}

interface Element extends Knoten {
  type: 'element';
  tagName: string;
  properties: Record<string, unknown>;
  children: Knoten[];
}

interface Eltern extends Knoten {
  children: Knoten[];
}

export const TITELBLOCK = 'titelblock';
export const TITELPLATZ = 'titelplatz';

const UEBERSCHRIFT = /^h[1-6]$/;

function istElement(k: Knoten): k is Element {
  return k.type === 'element';
}

function istTitel(k: Knoten): boolean {
  return istElement(k) && (UEBERSCHRIFT.test(k.tagName) || k.properties?.dataLfh === TITELPLATZ);
}

function hat(k: Knoten): k is Eltern {
  return Array.isArray((k as Eltern).children);
}

function element(dataLfh: string, children: Knoten[]): Element {
  return { type: 'element', tagName: 'div', properties: { dataLfh }, children };
}

/**
 * Fasst in `eltern` (und rekursiv darunter) jede Titelfolge mit dem ersten Element danach
 * zusammen. Leerraum zwischen den Blöcken wandert mit. Steht nach einem Titel kein Element
 * mehr, bleibt er, wie er ist — es gibt nichts, woran er hängen könnte.
 */
export function fasseTitelZusammen(eltern: Eltern): void {
  const kinder = eltern.children;
  for (const k of kinder) if (istElement(k) && !istTitel(k)) fasseTitelZusammen(k);

  const neu: Knoten[] = [];
  let i = 0;
  while (i < kinder.length) {
    if (!istTitel(kinder[i])) {
      neu.push(kinder[i]);
      i++;
      continue;
    }
    let block = -1;
    for (let j = i + 1; j < kinder.length; j++) {
      const n = kinder[j];
      if (!istElement(n) || istTitel(n)) continue;
      block = j;
      break;
    }
    if (block === -1) {
      neu.push(...kinder.slice(i));
      break;
    }
    neu.push(element(TITELBLOCK, kinder.slice(i, block + 1)));
    i = block + 1;
  }
  eltern.children = neu;
}

interface Optionen {
  /** Platzhalter für den Abschnittstitel des Einbauorts vor den Text stellen. */
  kopf?: boolean;
}

/** rehype-Plugin für `react-markdown` (`rehypePlugins`). */
export default function titelbloecke({ kopf = false }: Optionen = {}) {
  return (baum: Knoten) => {
    if (!hat(baum)) return;
    if (kopf) baum.children.unshift(element(TITELPLATZ, []));
    fasseTitelZusammen(baum);
  };
}
