import { describe, expect, it } from 'vitest';
import { baueFernmeldenetz } from '../fernmeldeskizze';
import {
  hervorhebung,
  sichtbarImFilter,
  stichSchluessel,
  stichleitungen,
  teileStichSchluessel,
  verbindungsEbenen,
} from './ebenen';
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

const BN_BOS = sg(1, 'TMO', 'BN_BOS');
const F314 = sg(2, 'DMO', '314_F*');
const SL_AS = sg(3, 'TMO', 'SL AS');

/** EA 1 und EA 2 an BN_BOS, EA 1 zusätzlich an F314, 1. Zug ohne Sprechgruppe unter EA 2. */
function netz() {
  return baueFernmeldenetz(
    quellen({
      fuehrungsstelle: fs({ sprechgruppen: [BN_BOS] }),
      abschnitte: daten([
        abschnitt(1, { name: 'EA 1', sprechgruppen: [BN_BOS, F314] }),
        abschnitt(2, { name: 'EA 2', sprechgruppen: [BN_BOS] }),
      ]),
      einheiten: daten([einheit(10, { name: '1. Zug', abschnitt_id: 2 })]),
      stellen: daten([
        stelle(5, 'leitstelle', { bezeichnung: 'ILS', kanaele: [[SL_AS, 'geplant']] }),
      ]),
      skizze: {
        verbindungen: [
          verbindung(1, { art: 'fuehrungsstelle', id: null }, { art: 'stelle', id: 5 }),
          verbindung(
            2,
            { art: 'abschnitt', id: 2 },
            { art: 'einheit', id: 10 },
            { art: 'melder', medium: 'funk' },
          ),
        ],
      },
    }),
  );
}

describe('Stichleitungen als Elemente', () => {
  it('Schlüssel hin und zurück', () => {
    expect(stichSchluessel('sg-2', 'eh-10')).toBe('sg-2~eh-10');
    expect(teileStichSchluessel('sg-2~eh-10')).toEqual({ schiene: 'sg-2', stelle: 'eh-10' });
    expect(teileStichSchluessel('eh-10')).toBeNull();
  });

  it('je Teilnehmer einer Schiene eine Stichleitung mit Status', () => {
    const n = netz();
    expect(stichleitungen(n).map((s) => [s.key, s.status])).toEqual([
      ['sg-1~fs', 'bestehend'],
      ['sg-1~ab-1', 'bestehend'],
      ['sg-1~ab-2', 'bestehend'],
      ['sg-3~ks-5', 'geplant'],
      ['sg-2~ab-1', 'bestehend'],
    ]);
  });
});

describe('Ebenen einer Verbindung', () => {
  it('Daten sind Daten, auch leitergebunden; Sprechfunk ist Funk ohne Daten', () => {
    expect(verbindungsEbenen({ art: 'daten', medium: 'leitung' })).toEqual([
      'leitergebunden',
      'daten',
    ]);
    expect(verbindungsEbenen({ art: 'telefon', medium: 'funk' })).toEqual(['sprechfunk']);
    expect(verbindungsEbenen({ art: 'livestream', medium: 'funk' })).toEqual(['daten']);
    expect(verbindungsEbenen({ art: 'fax', medium: 'leitung' })).toEqual([
      'leitergebunden',
      'daten',
    ]);
  });
});

describe('Erkunden: Hervorheben (Spec „Wer hört mit?“)', () => {
  it('eine Schiene hebt sich, ihre Stichleitungen und alle Stellen daran hervor', () => {
    const h = hervorhebung(netz(), 'sg-1')!;
    expect([...h].sort()).toEqual(
      ['sg-1', 'sg-1~fs', 'sg-1~ab-1', 'sg-1~ab-2', 'fs', 'ab-1', 'ab-2'].sort(),
    );
  });

  it('eine Stelle hebt ihre Schienen und Gegenstellen hervor, auch über Verbindungen', () => {
    const h = hervorhebung(netz(), 'ab-2')!;
    for (const k of ['ab-2', 'sg-1', 'sg-1~ab-2', 'fs', 'ab-1', 'sg-1~ab-1', 'vb-2', 'eh-10']) {
      expect(h.has(k), k).toBe(true);
    }
    // F314 hängt nur an EA 1: keine Schiene von EA 2.
    expect(h.has('sg-2')).toBe(false);
    expect(h.has('ks-5')).toBe(false);
  });

  it('eine Verbindung hebt beide Enden hervor; nichts gewählt = keine Hervorhebung', () => {
    expect([...hervorhebung(netz(), 'vb-1')!].sort()).toEqual(['fs', 'ks-5', 'vb-1']);
    expect(hervorhebung(netz(), null)).toBeNull();
    expect(hervorhebung(netz(), 'gibt-es-nicht')).toBeNull();
  });
});

describe('Erkunden: Ebenenfilter', () => {
  it('„alle“ nimmt nichts zurück', () => {
    expect(sichtbarImFilter(netz(), 'alle')).toBeNull();
  });

  it('Nur Lücken: Elemente mit Lücke und ihre Schienen, sonst nichts', () => {
    const s = sichtbarImFilter(netz(), 'luecken')!;
    // 1. Zug: keine Sprechgruppe; F314 und SL AS: nur ein Teilnehmer.
    expect(s.has('eh-10')).toBe(true);
    expect(s.has('sg-2')).toBe(true);
    expect(s.has('sg-3')).toBe(true);
    expect(s.has('sg-2~ab-1')).toBe(true);
    // Leitstelle hat einen Kanal und eine Verbindung: keine Lücke, aber Teilnehmer von SL AS.
    expect(s.has('ks-5')).toBe(true);
    // Ohne Lücke und ohne lückenhafte Schiene: zurückgenommen.
    expect(s.has('ab-2')).toBe(false);
    expect(s.has('sg-1')).toBe(false);
    expect(s.has('vb-1')).toBe(false);
  });

  it('Sprechfunk: Schienen, ihre Stellen und Funkverbindungen ohne Daten', () => {
    const s = sichtbarImFilter(netz(), 'sprechfunk')!;
    for (const k of ['sg-1', 'sg-2', 'sg-3', 'sg-1~fs', 'fs', 'ab-1', 'ks-5', 'vb-2', 'eh-10']) {
      expect(s.has(k), k).toBe(true);
    }
    expect(s.has('vb-1')).toBe(false);
  });

  it('Leitergebunden und Daten: nur die passenden Verbindungen und ihre Enden', () => {
    const l = sichtbarImFilter(netz(), 'leitergebunden')!;
    expect([...l].sort()).toEqual(['fs', 'ks-5', 'schriftfeld', 'vb-1']);
    const d = sichtbarImFilter(netz(), 'daten')!;
    expect(d.has('vb-1')).toBe(true);
    expect(d.has('vb-2')).toBe(false);
    expect(d.has('sg-1')).toBe(false);
  });
});
