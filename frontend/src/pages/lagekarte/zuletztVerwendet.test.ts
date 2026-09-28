import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { FreiesZeichenUpdate } from '../../api/types';
import {
  ZULETZT_MAX,
  abonniereZuletztVerwendet,
  leseZuletztVerwendet,
  merkeZuletztVerwendet,
} from './zuletztVerwendet';

// Das globale afterEach in `test/setup.ts` räumt localStorage; hier zusätzlich VOR jedem
// Test, damit die Reihenfolge der Dateien im Lauf keine Rolle spielt.
beforeEach(() => localStorage.clear());

describe('zuletztVerwendet — Reihenfolge und Deckel', () => {
  it('liefert leer, solange nichts gemerkt wurde', () => {
    expect(leseZuletztVerwendet()).toEqual([]);
  });

  it('stellt das jüngste nach vorn', () => {
    merkeZuletztVerwendet({ grundzeichen: 'person' });
    merkeZuletztVerwendet({ grundzeichen: 'befehlsstelle' });
    merkeZuletztVerwendet({ grundzeichen: 'kraftfahrzeug-landgebunden' });
    expect(leseZuletztVerwendet().map((z) => z.grundzeichen)).toEqual([
      'kraftfahrzeug-landgebunden',
      'befehlsstelle',
      'person',
    ]);
  });

  it('legt ein erneut benutztes Zeichen nicht doppelt ab, sondern hebt es nach vorn', () => {
    merkeZuletztVerwendet({ grundzeichen: 'person' });
    merkeZuletztVerwendet({ grundzeichen: 'befehlsstelle' });
    merkeZuletztVerwendet({ grundzeichen: 'person' });
    const liste = leseZuletztVerwendet();
    expect(liste).toHaveLength(2);
    expect(liste.map((z) => z.grundzeichen)).toEqual(['person', 'befehlsstelle']);
  });

  it('unterscheidet Zeichen, die sich nur in einem Overlay unterscheiden', () => {
    merkeZuletztVerwendet({ grundzeichen: 'person', fachaufgabe: 'brandbekaempfung' });
    merkeZuletztVerwendet({ grundzeichen: 'person', fachaufgabe: 'rettungswesen' });
    expect(leseZuletztVerwendet()).toHaveLength(2);
  });

  it(`hält höchstens ${ZULETZT_MAX} und wirft das älteste weg`, () => {
    const sieben = [
      'person',
      'befehlsstelle',
      'kraftfahrzeug-landgebunden',
      'taktische-formation',
      'anlass',
      'stelle',
      'gebaeude',
    ] as const;
    for (const gz of sieben) merkeZuletztVerwendet({ grundzeichen: gz } as FreiesZeichenUpdate);
    const liste = leseZuletztVerwendet();
    // SECHS als Literal, nicht `ZULETZT_MAX`: aus der geprüften Konstante gelesen prüfte die
    // Zeile sich selbst — mit einem Deckel von 4 oder 5 bliebe sie grün, und beide anderen
    // Aussagen dieses Tests hielten ebenfalls. Sechs ist das Akzeptanzkriterium, also steht
    // sie hier ausgeschrieben.
    expect(liste).toHaveLength(6);
    expect(ZULETZT_MAX).toBe(6);
    expect(liste[0].grundzeichen).toBe('gebaeude');
    // Das älteste ist raus — die Gegenaussage zum Deckel: nicht bloß „höchstens 6", sondern
    // „das Neue verdrängt das Alte" statt selbst abgewiesen zu werden.
    expect(liste.map((z) => z.grundzeichen)).not.toContain('person');
  });
});

describe('zuletztVerwendet — was gemerkt wird', () => {
  it('merkt das ZEICHEN, nicht die einzelne Platzierung (kein Name, keine Ansicht)', () => {
    merkeZuletztVerwendet({ grundzeichen: 'person', label: 'EA Nord', ansicht_id: 7 });
    const [eintrag] = leseZuletztVerwendet();
    expect(eintrag.label).toBeUndefined();
    expect(eintrag.ansicht_id).toBeUndefined();
  });

  it('zählt zwei gleich gezeichnete Platzierungen mit verschiedenem Namen als EIN Eintrag', () => {
    merkeZuletztVerwendet({ grundzeichen: 'person', label: 'EA Nord' });
    merkeZuletztVerwendet({ grundzeichen: 'person', label: 'EA Süd' });
    expect(leseZuletztVerwendet()).toHaveLength(1);
  });

  it('ignoriert Fremdfelder eines breiteren Objekts (die Aufrufstelle hält lat/lon)', () => {
    // Der Auftraggeber ruft die Funktion an der PLATZIER-Stelle — dort liegt ein
    // `NeuesFreiesZeichen` mit lat/lon. Ein durchgereichtes Koordinatenpaar machte jede
    // Platzierung zu einem eigenen Schlüssel, und „ohne Dubletten" stürbe lautlos.
    const mitOrt = {
      grundzeichen: 'person',
      lat: 50.1,
      lon: 8.6,
    } as unknown as FreiesZeichenUpdate;
    const nochmal = {
      grundzeichen: 'person',
      lat: 51.9,
      lon: 9.2,
    } as unknown as FreiesZeichenUpdate;
    merkeZuletztVerwendet(mitOrt);
    merkeZuletztVerwendet(nochmal);
    const liste = leseZuletztVerwendet();
    expect(liste).toHaveLength(1);
    expect(liste[0]).not.toHaveProperty('lat');
  });

  it('behält die Farbe — sie gehört zum Zeichen', () => {
    merkeZuletztVerwendet({ grundzeichen: 'person', farbe: '#ff0000' });
    expect(leseZuletztVerwendet()[0].farbe).toBe('#ff0000');
  });
});

describe('zuletztVerwendet — Speicher kann fehlen oder Unsinn tragen', () => {
  afterEach(() => vi.restoreAllMocks());

  it('liefert leer statt zu werfen, wenn der Speicher nicht verfügbar ist', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blockierte Site-Daten');
    });
    expect(leseZuletztVerwendet()).toEqual([]);
  });

  it('wirft beim Merken nicht, wenn der Speicher nicht schreibbar ist', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota');
    });
    expect(() => merkeZuletztVerwendet({ grundzeichen: 'person' })).not.toThrow();
  });

  it('verwirft kaputten Speicherinhalt ganz', () => {
    localStorage.setItem('lfh:lagekarte:zeichen-zuletzt', '{kein json');
    expect(leseZuletztVerwendet()).toEqual([]);
  });

  it('verwirft Einträge ohne Grundzeichen einzeln, behält die brauchbaren', () => {
    localStorage.setItem(
      'lfh:lagekarte:zeichen-zuletzt',
      JSON.stringify([{ farbe: '#000' }, { grundzeichen: 'person' }, 42]),
    );
    expect(leseZuletztVerwendet().map((z) => z.grundzeichen)).toEqual(['person']);
  });
});

describe('zuletztVerwendet — Benachrichtigung', () => {
  it('meldet dem Abonnenten jedes Merken und hört nach dem Abbestellen auf', () => {
    const hoerer = vi.fn();
    const abbestellen = abonniereZuletztVerwendet(hoerer);
    merkeZuletztVerwendet({ grundzeichen: 'person' });
    expect(hoerer).toHaveBeenCalledTimes(1);
    // Gegenaussage: ohne Abbestellen liefe der Hörer weiter — genau das darf nach dem
    // Abhängen der Leiste nicht mehr passieren (setState auf einer toten Komponente).
    abbestellen();
    merkeZuletztVerwendet({ grundzeichen: 'befehlsstelle' });
    expect(hoerer).toHaveBeenCalledTimes(1);
  });
});
