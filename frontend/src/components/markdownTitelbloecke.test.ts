import { describe, expect, it } from 'vitest';
import titelbloecke, { TITELBLOCK, TITELPLATZ, fasseTitelZusammen } from './markdownTitelbloecke';

/**
 * LFH-1008: Firefox hält `break-after: avoid` nicht ein, `break-inside: avoid` schon. Das Plugin
 * fasst deshalb jeden Titel mit dem ersten Block danach in eine Hülle. Geprüft am hast-Baum,
 * ohne React — die Form des Baums ist die Aussage.
 */
type K = { type: string; tagName?: string; properties?: Record<string, unknown>; children?: K[] };

const el = (tagName: string, ...children: K[]): K => ({
  type: 'element',
  tagName,
  properties: {},
  children,
});
const text = (value: string): K => ({ type: 'text', value }) as K;
const nl = () => text('\n');

/** Kurzform des Baums: `[h2 p]` für einen Titelblock, sonst der Tag. */
function form(k: K): string {
  if (k.type !== 'element') return '';
  if (k.properties?.dataLfh === TITELBLOCK) {
    return `[${k.children!.map(form).filter(Boolean).join(' ')}]`;
  }
  if (k.properties?.dataLfh === TITELPLATZ) return 'kopf';
  const innen = (k.children ?? []).map(form).filter(Boolean).join(' ');
  return innen ? `${k.tagName}(${innen})` : k.tagName!;
}

function nach(...kinder: K[]): string {
  const wurzel = { type: 'root', children: kinder };
  fasseTitelZusammen(wurzel as never);
  return wurzel.children.map(form).filter(Boolean).join(' ');
}

describe('markdownTitelbloecke', () => {
  it('fasst eine Überschrift mit dem ersten Block danach zusammen, nicht mit dem Rest', () => {
    expect(nach(el('h2', text('Lage')), nl(), el('p'), nl(), el('p'))).toBe('[h2 p] p');
  });

  it('nimmt eine Folge von Überschriften samt erstem Block in EINEN Block', () => {
    expect(nach(el('h2'), nl(), el('h3'), nl(), el('ul'), nl(), el('p'))).toBe('[h2 h3 ul] p');
  });

  it('lässt den Leerraum zwischen Titel und Block in der Hülle', () => {
    const wurzel = { type: 'root', children: [el('h2'), nl(), el('p')] };
    fasseTitelZusammen(wurzel as never);
    expect(wurzel.children).toHaveLength(1);
    expect(wurzel.children[0].children).toHaveLength(3);
  });

  it('lässt einen Titel ohne Block danach stehen, wie er ist', () => {
    expect(nach(el('p'), nl(), el('h2'), nl())).toBe('p h2');
  });

  it('greift auch in Zitaten und Listenpunkten', () => {
    expect(nach(el('blockquote', el('h3'), nl(), el('p')))).toBe('blockquote([h3 p])');
  });

  it('ändert Text ohne Überschrift nicht', () => {
    expect(nach(el('p'), nl(), el('ul', el('li')), nl(), el('pre'))).toBe('p ul(li) pre');
  });

  it('stellt mit `kopf` den Platz des Abschnittstitels in den ersten Block', () => {
    const wurzel = { type: 'root', children: [el('p'), nl(), el('p')] };
    titelbloecke({ kopf: true })(wurzel as never);
    expect(wurzel.children.map(form).filter(Boolean).join(' ')).toBe('[kopf p] p');
  });

  it('mit `kopf` vor einer Überschrift: Platz, Überschrift und erster Block in einem Block', () => {
    const wurzel = { type: 'root', children: [el('h2'), nl(), el('p'), nl(), el('p')] };
    titelbloecke({ kopf: true })(wurzel as never);
    expect(wurzel.children.map(form).filter(Boolean).join(' ')).toBe('[kopf h2 p] p');
  });

  it('ohne `kopf` kein Platz', () => {
    const wurzel = { type: 'root', children: [el('p')] };
    titelbloecke()(wurzel as never);
    expect(wurzel.children.map(form).join(' ')).toBe('p');
  });
});
