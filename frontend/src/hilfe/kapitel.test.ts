import { describe, expect, it } from 'vitest';
import { KAPITEL, kapitelDerGruppe, leseKapitel, verlinke } from './kapitel';

const ROH = `---
titel: Gerät verloren
gruppen: [alle, administration]
reihenfolge: 30
quellen: [src/auth/session.rs, frontend/src/offline/]
---

Wer ein Gerät verliert, meldet es sofort.
`;

describe('leseKapitel', () => {
  it('liest Kopf und Text', () => {
    const k = leseKapitel('geraet-verloren', ROH);
    expect(k).toEqual({
      slug: 'geraet-verloren',
      titel: 'Gerät verloren',
      gruppen: ['alle', 'administration'],
      reihenfolge: 30,
      quellen: ['src/auth/session.rs', 'frontend/src/offline/'],
      text: 'Wer ein Gerät verliert, meldet es sofort.\n',
    });
  });

  it('nimmt Windows-Zeilenenden', () => {
    expect(leseKapitel('x', ROH.replace(/\n/g, '\r\n')).titel).toBe('Gerät verloren');
  });

  it.each([
    ['ohne Kopf', 'Nur Text'],
    ['ohne Titel', ROH.replace('titel: Gerät verloren\n', '')],
    ['unbekannte Gruppe', ROH.replace('administration', 'leitstelle')],
    ['ohne Gruppe', ROH.replace('[alle, administration]', '[]')],
    ['Reihenfolge keine Zahl', ROH.replace('reihenfolge: 30', 'reihenfolge: drei')],
    ['ohne Quellen', ROH.replace('quellen: [src/auth/session.rs, frontend/src/offline/]\n', '')],
    ['unbekannter Schlüssel', ROH.replace('reihenfolge: 30', 'reihenfolge: 30\nautor: x')],
  ])('wirft bei %s', (_fall, roh) => {
    expect(() => leseKapitel('x', roh)).toThrow();
  });
});

describe('verlinke', () => {
  it('macht aus Kapitel-Links Adressen der Hilfe', () => {
    const text = 'Siehe [Ohne Netz](ohne-netz.md) und [Abmelden](anmelden-abmelden.md).';
    expect(verlinke(text, (slug) => `/hilfe/${slug}`)).toBe(
      'Siehe [Ohne Netz](/hilfe/ohne-netz) und [Abmelden](/hilfe/anmelden-abmelden).',
    );
  });

  it('lässt fremde Links stehen', () => {
    const text = '[Betrieb](https://example.org/a.md) und [Bild](bild.png)';
    expect(verlinke(text, (slug) => `/hilfe/${slug}`)).toBe(text);
  });
});

describe('Kapitel aus docs/anwender/kapitel', () => {
  it('sind geladen und nach Reihenfolge geordnet', () => {
    expect(KAPITEL.length).toBeGreaterThan(0);
    const folge = KAPITEL.map((k) => k.reihenfolge);
    expect(folge).toEqual([...folge].sort((a, b) => a - b));
  });

  it('jede Gruppe zeigt nur ihre Kapitel, „alle“ jedes mit „alle“', () => {
    for (const k of kapitelDerGruppe('administration')) {
      expect(k.gruppen).toContain('administration');
    }
    expect(kapitelDerGruppe('alle').every((k) => k.gruppen.includes('alle'))).toBe(true);
  });
});
