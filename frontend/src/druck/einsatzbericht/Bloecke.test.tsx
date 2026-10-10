import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Bloecke, { KURZE_TABELLE } from './Bloecke';
import type { Block, Einsatzbericht, Inhalt } from './verdichtung';

/**
 * LFH-1098: Firefox setzt `break-after: avoid` nicht um, ein Titel bliebe dort allein am
 * Seitenende. Jeder Titel steht deshalb mit dem ersten Stück seines Inhalts in einer Hülle
 * `data-lfh="titelblock"`, die `druck/druck.css` nicht brechen lässt. Geprüft an der Form des
 * DOM; dass Firefox die Hülle einhält, zeigt nur das Blatt (`druck/AGENTS.md`).
 */

function bericht(...bloecke: Block[]): Einsatzbericht {
  return { vorlaeufig: false, stand: '091200OKT2026', bloecke };
}

const zeilen = (n: number, titel?: string): Inhalt => ({
  art: 'zeilen',
  ...(titel ? { titel } : {}),
  zeilen: Array.from({ length: n }, (_, i) => ({
    etikett: `Etikett ${i + 1}`,
    wert: `Wert ${i + 1}`,
  })),
});

const tabelle = (n: number): Inhalt => ({
  art: 'tabelle',
  kopf: ['Nr.', 'Inhalt'],
  zeilen: Array.from({ length: n }, (_, i) => [String(i + 1), `Zeile ${i + 1}`]),
});

/** Kurzform eines Titelblocks: seine Titel und was sonst darin steht. */
function form(block: Element): string {
  const teile: string[] = [];
  block.querySelectorAll('h3, h4, h5, dt, p, tr, [data-lfh="titelplatz"] ~ *').forEach((el) => {
    if (/^H\d$/.test(el.tagName)) teile.push(`${el.tagName.toLowerCase()}:${el.textContent}`);
    else if (el.tagName === 'DT') teile.push(`dt:${el.textContent}`);
    else if (el.tagName === 'TR') teile.push('tr');
    else teile.push(el.tagName.toLowerCase());
  });
  return teile.join(' ');
}

function titelbloecke(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-lfh^="titelblock"]')].map(form);
}

/** Titel, die in keinem Titelblock stehen. */
function freieTitel(container: HTMLElement): string[] {
  return [...container.querySelectorAll('h3, h4, h5')]
    .filter((h) => !h.closest('[data-lfh^="titelblock"]'))
    .map((h) => h.textContent ?? '');
}

describe('Bloecke: Titel im Titelblock (LFH-1098)', () => {
  it('Blocktitel, Abschnittstitel und Gruppentitel stehen mit der ersten Zeile einer Liste', () => {
    const { container } = render(
      <Bloecke
        bericht={bericht({
          schluessel: 'bilanz',
          titel: 'Bilanz',
          abschnitte: [{ titel: 'Personen', inhalt: [zeilen(3, 'Nach Sichtung'), zeilen(2)] }],
        })}
      />,
    );
    expect(titelbloecke(container)).toEqual([
      'h3:Bilanz h4:Personen h5:Nach Sichtung dt:Etikett 1',
    ]);
    expect(freieTitel(container)).toEqual([]);
    // Alle Zeilen bleiben in ihrer Reihenfolge da, auch die hinter dem Titelblock.
    expect([...container.querySelectorAll('dt')].map((d) => d.textContent)).toEqual([
      'Etikett 1',
      'Etikett 2',
      'Etikett 3',
      'Etikett 1',
      'Etikett 2',
    ]);
  });

  it('ohne Abschnittstitel steht der Blocktitel mit der ersten Zeile', () => {
    const { container } = render(
      <Bloecke
        bericht={bericht({
          schluessel: 'stammdaten',
          titel: 'Stammdaten',
          abschnitte: [{ inhalt: [zeilen(8)] }],
        })}
      />,
    );
    expect(titelbloecke(container)).toEqual(['h3:Stammdaten dt:Etikett 1']);
  });

  it('jeder Abschnitt des Lageberichts steht mit seinem ersten Absatz, der erste mit den Titeln davor', () => {
    const { container } = render(
      <Bloecke
        bericht={bericht({
          schluessel: 'lage',
          titel: 'Lage',
          abschnitte: [
            {
              titel: 'Letzter Lagebericht: LB 3',
              inhalt: [
                {
                  art: 'markdown',
                  abschnitte: [
                    { titel: 'Auftrag', text: 'Erster Absatz.\n\nZweiter Absatz.' },
                    { titel: 'Eigene Lage', text: 'Zwei Züge.' },
                  ],
                },
              ],
            },
          ],
        })}
      />,
    );
    expect(titelbloecke(container)).toEqual([
      'h3:Lage h4:Letzter Lagebericht: LB 3 h5:Auftrag p',
      'h5:Eigene Lage p',
    ]);
    expect(freieTitel(container)).toEqual([]);
  });

  it('ein Vermerk steht mit seinen Titeln', () => {
    const { container } = render(
      <Bloecke
        bericht={bericht({
          schluessel: 'fuehrung',
          titel: 'Führung',
          abschnitte: [
            { titel: 'Einsatzleitung', inhalt: [{ art: 'vermerk', text: 'keine Einträge' }] },
            { titel: 'Stab', inhalt: [zeilen(2)] },
          ],
        })}
      />,
    );
    expect(titelbloecke(container)).toEqual([
      'h3:Führung h4:Einsatzleitung p',
      'h4:Stab dt:Etikett 1',
    ]);
  });

  it(`eine kurze Tabelle (bis ${KURZE_TABELLE} Zeilen) wandert ganz mit ihrem Titel`, () => {
    const { container } = render(
      <Bloecke
        bericht={bericht({
          schluessel: 'fuehrung',
          titel: 'Führung',
          abschnitte: [{ titel: 'Lagebesprechungen', inhalt: [tabelle(KURZE_TABELLE)] }],
        })}
      />,
    );
    expect(titelbloecke(container)).toEqual([
      `h3:Führung h4:Lagebesprechungen ${Array(KURZE_TABELLE + 1)
        .fill('tr')
        .join(' ')}`,
    ]);
  });
});

/**
 * LFH-1124: Vor einer langen Tabelle steht ein Deckel mit den Titeln und einer Kopie der Tabelle,
 * von der nur Kopf und erste Zeile Höhe haben; die übrigen Zeilen sind Maßzeilen, damit beide
 * Tabellen dieselben Spalten bekommen. Die echte Tabelle folgt, ihre erste Zeile ist markiert.
 * Sichtbar und wirksam ist der Deckel nur im Firefox-Druck (`druck/druck.css`).
 */
describe('Bloecke: Deckel vor einer langen Tabelle (LFH-1124)', () => {
  const N = KURZE_TABELLE + 3;
  const lang = () =>
    render(
      <Bloecke
        bericht={bericht({
          schluessel: 'personal-kopf',
          titel: 'Anlage Personal je Kopf',
          abschnitte: [{ inhalt: [tabelle(N), zeilen(1)] }],
        })}
      />,
    );
  const texte = (zeilen: Iterable<Element>) => [...zeilen].map((z) => z.textContent);

  it('die Titel stehen im Deckel, vor der echten Tabelle', () => {
    const { container } = lang();
    const deckel = container.querySelector('[data-lfh="titelblock-deckel"]');
    expect(deckel).not.toBeNull();
    expect(freieTitel(container)).toEqual([]);
    expect(texte(deckel!.querySelectorAll('h3'))).toEqual(['Anlage Personal je Kopf']);
    const unter = container.querySelector('[data-lfh="unter-deckel"]');
    expect(unter).not.toBeNull();
    expect(deckel!.compareDocumentPosition(unter!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(deckel!.contains(unter)).toBe(false);
    // Außerhalb des Firefox-Drucks keine Box: sonst trennte Chromium den Titel von der Tabelle.
    expect((deckel as HTMLElement).style.display).toBe('contents');
    expect(container.querySelector<HTMLElement>('[data-lfh="deckel-tabelle"]')!.style.display).toBe(
      'none',
    );
  });

  it('die Deckeltabelle hat Kopf und erste Zeile, alle übrigen Zeilen als Maßzeilen', () => {
    const { container } = lang();
    const kopie = container.querySelector('[data-lfh="titelblock-deckel"] table')!;
    expect(kopie.getAttribute('data-lfh')).toBe('deckel-tabelle');
    expect(texte(kopie.querySelectorAll('th'))).toEqual(['Nr.', 'Inhalt']);
    const reihen = [...kopie.querySelectorAll('tbody tr')];
    expect(reihen).toHaveLength(N);
    expect(reihen[0].getAttribute('data-lfh')).toBeNull();
    expect(reihen.slice(1).every((r) => r.getAttribute('data-lfh') === 'masszeile')).toBe(true);
    // Die Maßzeile trägt ihren Text in einer Hülle, die im Firefox-Druck keine Höhe hat.
    expect(texte(reihen[1].querySelectorAll('td > span'))).toEqual(['2', 'Zeile 2']);
    // Der Deckel hat keinen Abstand unter der Tabelle: die echte Tabelle schließt direkt an.
    expect((kopie as HTMLElement).style.marginBlockEnd).toBe('0px');
  });

  it('die Kopie ist für Hilfstechnik verborgen, die echte Tabelle steht genau einmal', () => {
    const { container, getAllByRole } = lang();
    expect(
      container.querySelector('[data-lfh="deckel-tabelle"]')!.getAttribute('aria-hidden'),
    ).toBe('true');
    expect(getAllByRole('table')).toHaveLength(1);
  });

  it('die echte Tabelle hat alle Zeilen, die erste markiert, und trägt ihre Kopfhöhe', () => {
    const { container } = lang();
    const unter = container.querySelector<HTMLElement>('[data-lfh="unter-deckel"]')!;
    const reihen = [...unter.querySelectorAll('tbody tr')];
    expect(texte(reihen)).toEqual(Array.from({ length: N }, (_, i) => `${i + 1}Zeile ${i + 1}`));
    expect(reihen[0].getAttribute('data-lfh')).toBe('deckel-erste-zeile');
    expect(texte(reihen[0].querySelectorAll('td > span'))).toEqual(['1', 'Zeile 1']);
    expect(reihen.slice(1).every((r) => r.getAttribute('data-lfh') === null)).toBe(true);
    // Zeilenhöhe 14 × 1,5714 = 22, Polster 2 × 4, Rand 1 (antds Vorgabe-Tokens im Test).
    expect(unter.style.getPropertyValue('--druck-kopfhoehe')).toBe('31px');
  });

  it('beide Tabellen tragen die Zeilenhöhe des Kopfes, aus der die Kopfhöhe gerechnet ist', () => {
    const { container } = lang();
    const kopie = container.querySelector<HTMLElement>('[data-lfh="deckel-tabelle"]')!;
    const unter = container.querySelector<HTMLElement>('[data-lfh="unter-deckel"]')!;
    expect(kopie.style.getPropertyValue('--druck-kopfzeile')).toBe('22px');
    expect(unter.style.getPropertyValue('--druck-kopfzeile')).toBe('22px');
    // Am Bildschirm und in Chromium bleibt der Kopf, wie er war.
    expect(
      [...container.querySelectorAll<HTMLElement>('th')].map((th) => th.style.lineHeight),
    ).toEqual(['', '', '', '']);
  });

  it('die Kopie steht ohne eigene Hülle direkt hinter den Titeln', () => {
    const { container } = lang();
    const kopie = container.querySelector('[data-lfh="deckel-tabelle"]')!;
    expect(kopie.parentElement!.getAttribute('data-lfh')).toBe('titelblock-deckel');
  });

  it('eine lange Tabelle ohne Titel (nicht erstes Inhaltsstück) bekommt keinen Deckel', () => {
    const { container } = render(
      <Bloecke
        bericht={bericht({
          schluessel: 'etb',
          titel: 'ETB-Auszug',
          abschnitte: [{ titel: 'Entscheidungen', inhalt: [zeilen(2), tabelle(N)] }],
        })}
      />,
    );
    expect(container.querySelector('[data-lfh="titelblock-deckel"]')).toBeNull();
    expect(container.querySelectorAll('table')).toHaveLength(1);
    expect(container.querySelectorAll('[data-lfh="deckel-erste-zeile"]')).toHaveLength(0);
  });

  it(`eine kurze Tabelle (bis ${KURZE_TABELLE} Zeilen) bekommt keinen Deckel`, () => {
    const { container } = render(
      <Bloecke
        bericht={bericht({
          schluessel: 'fuehrung',
          titel: 'Führung',
          abschnitte: [{ titel: 'Lagebesprechungen', inhalt: [tabelle(KURZE_TABELLE)] }],
        })}
      />,
    );
    expect(container.querySelector('[data-lfh="titelblock-deckel"]')).toBeNull();
    expect(container.querySelectorAll('table')).toHaveLength(1);
  });
});
