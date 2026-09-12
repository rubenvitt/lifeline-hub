import { beforeEach, describe, expect, it } from 'vitest';
import { letzteAuswahlSpeicher, waehleDefaultEintrag } from './direkteinstiegKern';

type E = { id: number; status: 'aktiv' | 'geplant' };
const aktiv = (e: E) => e.status === 'aktiv';

describe('waehleDefaultEintrag', () => {
  it('liefert null bei leerer Liste', () => {
    expect(waehleDefaultEintrag<E>([], null, aktiv)).toBeNull();
  });
  it('bevorzugt die gemerkte Auswahl, auch vor einer aktiven', () => {
    expect(
      waehleDefaultEintrag<E>(
        [
          { id: 1, status: 'aktiv' },
          { id: 2, status: 'geplant' },
        ],
        2,
        aktiv,
      ),
    ).toBe(2);
  });
  it('ignoriert eine gemerkte Auswahl, die nicht mehr in der Liste ist', () => {
    expect(
      waehleDefaultEintrag<E>(
        [
          { id: 3, status: 'aktiv' },
          { id: 1, status: 'aktiv' },
        ],
        99,
        aktiv,
      ),
    ).toBe(1);
  });
  it('wählt sonst den ältesten aktiven (kleinste id)', () => {
    expect(
      waehleDefaultEintrag<E>(
        [
          { id: 5, status: 'aktiv' },
          { id: 2, status: 'aktiv' },
          { id: 8, status: 'geplant' },
        ],
        null,
        aktiv,
      ),
    ).toBe(2);
  });
  it('wählt den zuletzt angelegten (größte id), wenn keiner aktiv ist', () => {
    expect(
      waehleDefaultEintrag<E>(
        [
          { id: 2, status: 'geplant' },
          { id: 7, status: 'geplant' },
        ],
        null,
        aktiv,
      ),
    ).toBe(7);
  });
});

describe('letzteAuswahlSpeicher', () => {
  beforeEach(() => localStorage.clear());
  it('trennt Präfixe und Einsätze', () => {
    const uhs = letzteAuswahlSpeicher('uhs');
    const br = letzteAuswahlSpeicher('br');
    uhs.merke(1, 42);
    br.merke(1, 7);
    expect(uhs.lies(1)).toBe(42);
    expect(br.lies(1)).toBe(7);
    expect(uhs.lies(2)).toBeNull();
  });
  it('schreibt den Bestandsschlüssel der UHS byte-gleich — gespeicherte Auswahlen überleben', () => {
    letzteAuswahlSpeicher('uhs').merke(3, 5);
    expect(localStorage.getItem('uhs:letzteAuswahl:3')).toBe('5');
  });
});
