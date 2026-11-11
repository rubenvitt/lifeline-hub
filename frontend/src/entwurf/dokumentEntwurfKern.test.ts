import { describe, expect, it } from 'vitest';
import {
  abschnittEintraege,
  befuellteAbschnitte,
  befuellungsKette,
  EDITOR_ZEILEN,
  fuellstandText,
  gliederungEintraege,
  istLeer,
} from './dokumentEntwurfKern';
import { vorlage } from '../lageberichte/vorlagen';

const acht = vorlage('lagebeurteilung')!.abschnitte;

describe('befuellteAbschnitte', () => {
  it('zählt nur Text mit Inhalt', () => {
    expect(befuellteAbschnitte({ auftrag: '  ', anlass: 'x', titel: 'T' }, acht)).toEqual(
      new Set(['anlass']),
    );
    expect(befuellteAbschnitte(undefined, acht)).toEqual(new Set());
  });
});

/**
 * Die Kette ist der Träger des Render-Zähler-Gates: der Baustein beobachtet das Formular über sie
 * und rendert nur, wenn sie sich ändert.
 */
describe('befuellungsKette', () => {
  it('bleibt gleich, solange sich nur der TEXT ändert, nicht die Leere', () => {
    const a = befuellungsKette({ auftrag: 'L' }, acht);
    const b = befuellungsKette({ auftrag: 'Lage unveraendert, Abschnitt fortgeschrieben' }, acht);
    expect(b).toBe(a);
  });

  it('kippt, wenn ein Abschnitt von leer auf befüllt geht', () => {
    const leer = befuellungsKette({}, acht);
    const eins = befuellungsKette({ auftrag: 'L' }, acht);
    expect(eins).not.toBe(leer);
    expect(eins[0]).toBe('1');
    expect(leer).toBe('0'.repeat(acht.length));
  });

  it('zählt Leerraum nicht als Text — gleichlautend mit `befuellteAbschnitte`', () => {
    expect(befuellungsKette({ auftrag: '   \n ' }, acht)).toBe('0'.repeat(acht.length));
    const werte = { auftrag: 'A', anlass: '  ', beurteilung_schadenlage: 'C' };
    const kette = befuellungsKette(werte, acht);
    const ausKette = acht.filter((_, i) => !istLeer(kette, i)).map((a) => a.schluessel);
    expect(ausKette.sort()).toEqual([...befuellteAbschnitte(werte, acht)].sort());
  });
});

describe('fuellstandText', () => {
  it('nennt befüllte und alle Abschnitte wie die Übersicht', () => {
    expect(fuellstandText('10100000')).toBe('2/8 Abschnitte');
    expect(fuellstandText('000')).toBe('0/3 Abschnitte');
  });
});

describe('EDITOR_ZEILEN', () => {
  it('leer einzeilig, mit Obergrenze (danach rollt das Feld)', () => {
    expect(EDITOR_ZEILEN.minRows).toBe(1);
    expect(EDITOR_ZEILEN.maxRows).toBeGreaterThan(1);
  });
});

describe('Einträge eines Abschnitts (LLH-1601, eine Quelle für ⋮ und Kontextmenü)', () => {
  const voll = { leer: false, kopierbar: true, ansicht: 'bearbeiten' } as const;

  it('nennt Kopieren, Lesefassung und rot das Leeren, in dieser Folge', () => {
    expect(abschnittEintraege(voll)).toEqual([
      { key: 'kopieren', label: 'Text kopieren' },
      { key: 'lesefassung', label: 'In der Lesefassung zeigen' },
      { key: 'leeren', label: 'Abschnitt leeren', gefahr: true },
    ]);
  });

  it('sperrt „Text kopieren“ bei leerem Abschnitt und ohne Zwischenablage', () => {
    const ohne = abschnittEintraege({ ...voll, kopierbar: false });
    expect(ohne.filter((e) => e.gesperrt).map((e) => e.key)).toEqual(['kopieren']);
  });

  it('sperrt bei leerem Abschnitt Kopieren und Leeren, die Lesefassung bleibt', () => {
    // Leeren eines leeren Abschnitts meldete eine Änderung, die keine ist (Autosave ohne Inhalt).
    const leer = abschnittEintraege({ ...voll, leer: true });
    expect(leer.filter((e) => e.gesperrt).map((e) => e.key)).toEqual(['kopieren', 'leeren']);
  });

  it('lässt „In der Lesefassung zeigen“ weg, wenn die Lesefassung gewählt ist', () => {
    expect(abschnittEintraege({ ...voll, ansicht: 'lesen' }).map((e) => e.key)).toEqual([
      'kopieren',
      'leeren',
    ]);
  });

  it('stellt in der Gliederung „Zum Abschnitt springen“ voran', () => {
    const g = gliederungEintraege(voll);
    expect(g[0]).toEqual({ key: 'springen', label: 'Zum Abschnitt springen' });
    expect(g.slice(1)).toEqual(abschnittEintraege(voll));
  });
});
