import { describe, expect, it } from 'vitest';
import { baueFernmeldenetz, bezugSchluessel } from '../fernmeldeskizze';
import {
  abschnitt,
  daten,
  einheit,
  fs,
  quellen,
  sg,
  stelle,
  verbindung,
} from '../../test/fernmeldenetz';
import {
  bezugAus,
  fokusfolge,
  griffGrund,
  lageGrund,
  naechsterFokus,
  schienenId,
  tastenBefehl,
  verbindenZiele,
} from './bedienung';

const BN_BOS = sg(1, 'TMO', 'BN_BOS');
const F314 = sg(2, 'DMO', '314_F*');

function netz(rechte = {}) {
  return baueFernmeldenetz({
    ...quellen({
      fuehrungsstelle: fs({ sprechgruppen: [BN_BOS] }),
      sprechgruppen: daten([BN_BOS, F314]),
      abschnitte: daten([abschnitt(1, { name: 'EA 1', sprechgruppen: [BN_BOS] })]),
      einheiten: daten([
        einheit(10, { name: '1. Zug', abschnitt_id: 1, funkrufname: 'Florian 1/1' }),
      ]),
      stellen: daten([
        stelle(5, 'leitstelle', { bezeichnung: 'ILS', kanaele: [[F314, 'geplant']] }),
      ]),
      skizze: {
        komponenten: [{ id: 3, art: 'repeater', bezeichnung: null, sprechgruppen: [F314] }],
        verbindungen: [
          verbindung(8, { art: 'fuehrungsstelle', id: null }, { art: 'stelle', id: 5 }),
        ],
        bereiche: [
          {
            id: 4,
            bezeichnung: 'Rückwärtiger Bereich',
            x: 0,
            y: 0,
            breite: 10,
            hoehe: 10,
            version: 1,
          },
        ],
      },
    }),
    rechte,
  });
}

describe('Fokusfolge (D6)', () => {
  it('Führungsorganisation, je Stelle ihre Stichleitungen, dann Schienen, extern, Komponenten, Verbindungen, Bereiche, Schriftfeld', () => {
    expect(fokusfolge(netz())).toEqual([
      'fs',
      'sg-1~fs',
      'ab-1',
      'sg-1~ab-1',
      'eh-10',
      'sg-1',
      'sg-2',
      'ks-5',
      'sg-2~ks-5',
      'ko-3',
      'sg-2~ko-3',
      'vb-8',
      'be-4',
      'schriftfeld',
    ]);
  });

  it('Tab wandert, an den Enden verlässt der Fokus die Fläche', () => {
    const folge = ['a', 'b', 'c'];
    expect(naechsterFokus(folge, 'a', 1)).toBe('b');
    expect(naechsterFokus(folge, 'c', 1)).toBeNull();
    expect(naechsterFokus(folge, 'a', -1)).toBeNull();
    expect(naechsterFokus(folge, null, 1)).toBe('a');
    expect(naechsterFokus(folge, 'weg', 1)).toBe('a');
  });
});

describe('Tastatur (D6)', () => {
  const t = (
    key: string,
    mod: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>> = {},
  ) =>
    tastenBefehl({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mod });

  it('Pfeile verschieben um ein Rasterfeld, mit Umschalt um fünf, mit Alt die Größe', () => {
    expect(t('ArrowRight')).toEqual({ art: 'verschiebe', dx: 1, dy: 0 });
    expect(t('ArrowUp', { shiftKey: true })).toEqual({ art: 'verschiebe', dx: 0, dy: -5 });
    expect(t('ArrowLeft', { altKey: true })).toEqual({ art: 'groesse', dx: -1, dy: 0 });
  });

  it('Enter öffnet, V verbindet, Entf löst, Escape wählt ab', () => {
    expect(t('Enter')).toEqual({ art: 'oeffne' });
    expect(t('v')).toEqual({ art: 'verbinden' });
    expect(t('V', { shiftKey: true })).toEqual({ art: 'verbinden' });
    expect(t('v', { ctrlKey: true })).toBeNull();
    expect(t('Delete')).toEqual({ art: 'entferne' });
    expect(t('Backspace')).toEqual({ art: 'entferne' });
    expect(t('Escape')).toEqual({ art: 'abwaehlen' });
  });

  it('Strg+Z, Strg+Y und Strg+Umschalt+Z (auch ⌘)', () => {
    expect(t('z', { ctrlKey: true })).toEqual({ art: 'rueckgaengig' });
    expect(t('z', { metaKey: true })).toEqual({ art: 'rueckgaengig' });
    expect(t('y', { ctrlKey: true })).toEqual({ art: 'wiederholen' });
    expect(t('Z', { ctrlKey: true, shiftKey: true })).toEqual({ art: 'wiederholen' });
  });

  it('Tab und Umschalt+Tab wandern, Kontextmenü-Taste und Umschalt+F10 öffnen das Menü, Zoomtasten', () => {
    expect(t('Tab')).toEqual({ art: 'wandere', richtung: 1 });
    expect(t('Tab', { shiftKey: true })).toEqual({ art: 'wandere', richtung: -1 });
    expect(t('ContextMenu')).toEqual({ art: 'menue' });
    expect(t('F10', { shiftKey: true })).toEqual({ art: 'menue' });
    expect(t('+')).toEqual({ art: 'zoom', richtung: 1 });
    expect(t('-')).toEqual({ art: 'zoom', richtung: -1 });
    expect(t('0')).toEqual({ art: 'einpassen' });
    expect(t('x')).toBeNull();
  });
});

describe('Rechte am Element (D8, Spec „Bearbeiten nur mit Recht am Datensatz“)', () => {
  it('Nur Leserecht: ohne Aktionen nichts, mit Grund', () => {
    const n = netz({ stab: true, einheiten: true });
    expect(griffGrund(n, 'eh-10', { aktionen: false, mobil: false })).toBe(
      'Kein Schreibrecht im Einsatz',
    );
    expect(lageGrund(n, { aktionen: false, mobil: false })).toBe('Kein Schreibrecht im Einsatz');
  });

  it('Recht auf Stab, nicht auf Einheiten: 1. Zug ohne Griff, Grund „Einheiten: kein Schreibrecht“', () => {
    const n = netz({ stab: true });
    expect(griffGrund(n, 'eh-10', { aktionen: true, mobil: false })).toBe(
      'Einheiten: kein Schreibrecht',
    );
    expect(griffGrund(n, 'ks-5', { aktionen: true, mobil: false })).toBeNull();
    expect(lageGrund(n, { aktionen: true, mobil: false })).toBeNull();
    expect(griffGrund(n, 'ab-1', { aktionen: true, mobil: false })).toBe(
      'Abschnitte: kein Schreibrecht',
    );
    expect(griffGrund(n, 'fs', { aktionen: true, mobil: false })).toBe(
      'Einsatzverwaltung: kein Schreibrecht',
    );
  });

  it('Mobil: mit Schreibrecht nur lesen', () => {
    const n = netz({ stab: true, einheiten: true });
    expect(griffGrund(n, 'eh-10', { aktionen: true, mobil: true })).toBe(
      'Am schmalen Bildschirm nur lesen',
    );
    expect(lageGrund(n, { aktionen: true, mobil: true })).toBe('Am schmalen Bildschirm nur lesen');
  });

  it('ohne Stab-Recht keine Lage', () => {
    expect(lageGrund(netz({ einheiten: true }), { aktionen: true, mobil: false })).toBe(
      'Stab: kein Schreibrecht',
    );
  });
});

describe('„Verbinden mit …“ (Spec „Verbinden ohne Ziehen“)', () => {
  it('Schienen ohne die schon zugeordneten, dann Stellen ohne sich selbst; Suche über Zeichen und Namen', () => {
    const n = netz({ stab: true, einheiten: true, einsatzabschnitte: true, verwaltung: true });
    const ziele = verbindenZiele(n, 'ab-1', '');
    expect(ziele.map((z) => z.key)).toEqual(['sg-2', 'fs', 'eh-10', 'ks-5', 'ko-3']);
    expect(verbindenZiele(n, 'eh-10', '314').map((z) => z.key)).toEqual(['sg-2']);
    expect(verbindenZiele(n, 'eh-10', 'ils').map((z) => z.key)).toEqual(['ks-5']);
    expect(verbindenZiele(n, 'ab-1', 'florian').map((z) => z.key)).toEqual(['eh-10']);
  });

  it('auch Katalog-Sprechgruppen ohne Schiene sind Ziele', () => {
    const n = baueFernmeldenetz({
      ...quellen({
        sprechgruppen: daten([BN_BOS, F314]),
        abschnitte: daten([abschnitt(1, { name: 'EA 1' })]),
      }),
      rechte: { einsatzabschnitte: true, stab: true },
    });
    expect(verbindenZiele(n, 'ab-1', '').map((z) => [z.key, z.art])).toEqual([
      ['sg-1', 'schiene'],
      ['sg-2', 'schiene'],
      ['fs', 'stelle'],
    ]);
  });

  it('ohne Recht am Datensatz keine Schienen, ohne Stab keine Stellen', () => {
    const n = netz({ stab: true });
    expect(verbindenZiele(n, 'eh-10', '').every((z) => z.art === 'stelle')).toBe(true);
    const ohneStab = netz({ einheiten: true });
    expect(verbindenZiele(ohneStab, 'eh-10', '').every((z) => z.art === 'schiene')).toBe(true);
  });
});

describe('Bezüge', () => {
  it('Schlüssel → Bezug und zurück', () => {
    for (const key of ['fs', 'ab-1', 'eh-10', 'ks-5', 'ko-3']) {
      const b = bezugAus(key)!;
      expect(bezugSchluessel(b)).toBe(key);
    }
    expect(bezugAus('sg-1')).toBeNull();
    expect(schienenId('sg-12')).toBe(12);
    expect(schienenId('eh-12')).toBeNull();
  });
});
