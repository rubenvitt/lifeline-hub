import { describe, expect, it } from 'vitest';
import type { EtbBaustein } from '../api/types';
import { erkenneSlashTrigger, filterSlashEintraege, METADATEN_FELDER, type MetaFeld } from './schnellerfassungModell';

describe('METADATEN_FELDER', () => {
  it('enthält genau die fünf Metadatenfelder in Anzeigereihenfolge', () => {
    expect(METADATEN_FELDER.map((f) => f.feld)).toEqual<MetaFeld[]>([
      'ereigniszeit', 'von', 'an', 'meldeweg', 'veranlassung',
    ]);
  });

  it('jedes Feld hat Label, Trigger-Keywords und Editor-Typ', () => {
    for (const def of METADATEN_FELDER) {
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.trigger.length).toBeGreaterThan(0);
      expect(['zeit', 'text', 'meldeweg']).toContain(def.editor);
    }
  });
});

describe('erkenneSlashTrigger', () => {
  it('aktiv, wenn / am Textanfang steht', () => {
    expect(erkenneSlashTrigger('/vo', 3)).toEqual({ aktiv: true, filter: 'vo', start: 0 });
  });

  it('aktiv, wenn / nach Whitespace steht', () => {
    const text = 'Pumpe läuft /zei';
    expect(erkenneSlashTrigger(text, text.length)).toEqual({ aktiv: true, filter: 'zei', start: 12 });
  });

  it('inaktiv bei / mitten im Wort (z.B. 2/9)', () => {
    expect(erkenneSlashTrigger('2/9', 3)).toEqual({ aktiv: false, filter: '', start: -1 });
  });

  it('inaktiv, wenn zwischen / und Cursor ein Leerzeichen liegt', () => {
    expect(erkenneSlashTrigger('/von bar', 8)).toEqual({ aktiv: false, filter: '', start: -1 });
  });

  it('inaktiv ohne / links vom Cursor', () => {
    expect(erkenneSlashTrigger('Lage stabil', 11)).toEqual({ aktiv: false, filter: '', start: -1 });
  });

  it('leerer Filter direkt nach /', () => {
    expect(erkenneSlashTrigger('Lage /', 6)).toEqual({ aktiv: true, filter: '', start: 5 });
  });
});

function baustein(id: number, label: string): EtbBaustein {
  return { id, label, typ: 'meldung', inhalt: '', meldeweg: null, veranlassung: null, sortier: id };
}

describe('filterSlashEintraege', () => {
  const bausteine = [baustein(1, 'Lagemeldung'), baustein(2, 'Bereitstellung')];

  it('ohne Filter: alle Felder + alle Bausteine', () => {
    const r = filterSlashEintraege('', bausteine, []);
    expect(r.felder.map((e) => e.key)).toEqual(['ereigniszeit', 'von', 'an', 'meldeweg', 'veranlassung']);
    expect(r.bausteine.map((e) => e.label)).toEqual(['Lagemeldung', 'Bereitstellung']);
  });

  it('filtert Felder per Trigger-Stichwort (case-insensitive)', () => {
    const r = filterSlashEintraege('ZEI', bausteine, []);
    expect(r.felder.map((e) => e.key)).toEqual(['ereigniszeit']);
    expect(r.bausteine).toEqual([]);
  });

  it('filtert Bausteine per Label-Teilstring', () => {
    const r = filterSlashEintraege('lage', bausteine, []);
    expect(r.bausteine.map((e) => e.label)).toEqual(['Lagemeldung']);
  });

  it('markiert bereits gesetzte Felder', () => {
    const r = filterSlashEintraege('von', bausteine, ['von']);
    expect(r.felder[0]).toMatchObject({ key: 'von', gesetzt: true });
  });
});
