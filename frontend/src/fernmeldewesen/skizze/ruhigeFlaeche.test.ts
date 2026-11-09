import { describe, expect, it } from 'vitest';
import type { SkizzenLage } from '../../api/types';
import { abschnitt, einheit, quellen, daten } from '../../test/fernmeldenetz';
import { baueFernmeldenetz, type Fernmeldenetz, type NetzBereich } from '../fernmeldeskizze';
import { layoutFernmeldenetz } from '../fernmeldeskizzeLayout';
import { gehaltenesNetz, gibFrei, halteAn } from './ruhigeFlaeche';

/** Ruhige Fläche, Teil Netz (LFH-1037 D1): Fremdes wartet beim Halten, Eigenes gilt. */

const lage = (element: string, x: number, y: number, version = 1): SkizzenLage => ({
  element,
  x,
  y,
  breite: null,
  version,
});

const bereich = (p: Partial<NetzBereich> = {}): NetzBereich => ({
  key: 'be-4',
  id: 4,
  bezeichnung: 'Rückwärtiger Bereich',
  x: 64,
  y: 64,
  breite: 160,
  hoehe: 96,
  version: 3,
  ...p,
});

function netz(p: { lage?: SkizzenLage[]; einheiten?: number[]; bereiche?: NetzBereich[] } = {}) {
  const n = baueFernmeldenetz(
    quellen({
      abschnitte: daten([abschnitt(1)]),
      einheiten: daten((p.einheiten ?? [10]).map((id) => einheit(id, { abschnitt_id: 1 }))),
      skizze: { lage: p.lage ?? [] },
    }),
  );
  return { ...n, bereiche: p.bereiche ?? [] } satisfies Fernmeldenetz;
}

describe('gehaltenesNetz', () => {
  it('ohne Halten, und solange niemand etwas bewegt hat, ist es dasselbe Netz', () => {
    const n = netz({ lage: [lage('ab-1', 400, 40)], bereiche: [bereich()] });
    expect(gehaltenesNetz(n, null)).toBe(n);
    // Die eigene Lage der Handlungen hängt an `netz.lage`; frei geben darf sie nicht verwerfen.
    expect(gehaltenesNetz(n, halteAn(n))).toBe(n);
    expect(gehaltenesNetz(n, gibFrei(halteAn(n), 'ab-1'))).toBe(n);
  });

  it('eine fremd verschobene, verworfene oder erstmals gespeicherte Lage wartet', () => {
    const halt = halteAn(netz({ lage: [lage('ab-1', 400, 40)] }));
    const n = gehaltenesNetz(
      // „Zug“ erstmals verschoben, die Lage des Abschnitts verworfen („Neu anordnen“ dort).
      netz({ lage: [lage('eh-10', 1600, 800)] }),
      halt,
    );
    expect(n.lage.get('ab-1')).toMatchObject({ x: 400, y: 40, version: 1 });
    expect(n.lage.has('eh-10')).toBe(false);
  });

  it('ein neues Element steht an seinem Stand und ist im Layout „neu“', () => {
    const vorher = netz();
    const halt = halteAn(vorher);
    const n = gehaltenesNetz(netz({ einheiten: [10, 11], lage: [lage('eh-11', 1600, 800)] }), halt);
    expect(n.lage.get('eh-11')).toMatchObject({ x: 1600, y: 800 });
    const gehalten = layoutFernmeldenetz(vorher).plaetze;
    expect(layoutFernmeldenetz(n, { gehalten }).plaetze.get('eh-11')).toMatchObject({
      x: 1600,
      y: 800,
      neu: true,
    });
  });

  it('ein frei gegebenes Element (eigene Handlung) folgt dem Stand', () => {
    const halt = gibFrei(halteAn(netz()), 'eh-10');
    const n = gehaltenesNetz(netz({ lage: [lage('eh-10', 1600, 800, 2)] }), halt);
    expect(n.lage.get('eh-10')).toMatchObject({ x: 1600, y: 800, version: 2 });
  });

  it('ein Bereich hält Geometrie und Version, der Name fließt', () => {
    const halt = halteAn(netz({ bereiche: [bereich()] }));
    const fremd = bereich({ x: 640, y: 480, breite: 320, version: 5, bezeichnung: 'Lager' });
    const [b] = gehaltenesNetz(netz({ bereiche: [fremd] }), halt).bereiche;
    expect(b).toEqual({ ...bereich(), bezeichnung: 'Lager' });
    const [frei] = gehaltenesNetz(netz({ bereiche: [fremd] }), gibFrei(halt, 'be-4')).bereiche;
    expect(frei).toEqual(fremd);
  });

  it('gibFrei ändert nichts, was schon frei ist', () => {
    const halt = gibFrei(halteAn(netz()), 'eh-10');
    expect(gibFrei(halt, 'eh-10')).toBe(halt);
  });
});
