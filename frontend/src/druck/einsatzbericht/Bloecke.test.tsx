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

  it('eine lange Tabelle steht ohne Titelblock: ganz mitgenommen ließe sie eine Seite fast leer', () => {
    const { container } = render(
      <Bloecke
        bericht={bericht({
          schluessel: 'personal-kopf',
          titel: 'Anlage Personal je Kopf',
          abschnitte: [{ inhalt: [tabelle(KURZE_TABELLE + 1)] }],
        })}
      />,
    );
    expect(titelbloecke(container)).toEqual([]);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(KURZE_TABELLE + 1);
  });
});
