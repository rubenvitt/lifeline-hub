import { describe, expect, it, vi } from 'vitest';
import { kontextEintraege, kontextMenueItems, kopiereKoordinate } from './kontextmenue';

/**
 * Einträge des Kontextmenüs der Lagekarte (LFH-776, D4): Reihenfolge fest, „Hier Zeichen setzen“
 * nur mit Schreibrecht — fehlt, statt gesperrt zu stehen (Rechte-Riegel an der Ableitung).
 */
describe('kontextEintraege', () => {
  it('mit Schreibrecht: kopieren, messen, zeichen in dieser Reihenfolge', () => {
    expect(kontextEintraege({ darfSchreiben: true }).map((e) => [e.key, e.label])).toEqual([
      ['kopieren', 'Koordinate kopieren'],
      ['messen', 'Messen ab hier'],
      ['zeichen', 'Hier Zeichen setzen'],
    ]);
  });

  it('ohne Schreibrecht fehlt „Hier Zeichen setzen“, auch nicht gesperrt', () => {
    const eintraege = kontextEintraege({ darfSchreiben: false });
    expect(eintraege.map((e) => e.key)).toEqual(['kopieren', 'messen']);
    expect(eintraege.some((e) => e.gesperrt)).toBe(false);
  });

  it('alle Einträge sind umkehrbar: keiner rot', () => {
    expect(kontextEintraege({ darfSchreiben: true }).some((e) => e.gefahr)).toBe(false);
  });
});

describe('kontextMenueItems', () => {
  it('baut die antd-Items über die Bündelregel, ohne Trenner', () => {
    const items = kontextMenueItems(kontextEintraege({ darfSchreiben: true }));
    expect(items).toEqual([
      { key: 'kopieren', label: 'Koordinate kopieren' },
      { key: 'messen', label: 'Messen ab hier' },
      { key: 'zeichen', label: 'Hier Zeichen setzen' },
    ]);
  });
});

describe('kopiereKoordinate', () => {
  const meldung = () => ({ success: vi.fn(), error: vi.fn() });

  it('legt den Text in die Zwischenablage und quittiert', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    const m = meldung();
    await kopiereKoordinate('32U 512345 5934567', { writeText }, m);
    expect(writeText).toHaveBeenCalledExactlyOnceWith('32U 512345 5934567');
    expect(m.success).toHaveBeenCalledWith('Koordinate kopiert');
    expect(m.error).not.toHaveBeenCalled();
  });

  it('lehnt der Browser ab, nennt die Fehlermeldung die Koordinate', async () => {
    const m = meldung();
    await kopiereKoordinate(
      '32U 512345 5934567',
      { writeText: () => Promise.reject(new Error('NotAllowedError')) },
      m,
    );
    expect(m.error).toHaveBeenCalledWith('Kopieren nicht möglich: 32U 512345 5934567');
    expect(m.success).not.toHaveBeenCalled();
  });

  it('ohne Zwischenablage (kein Secure Context) ebenso', async () => {
    const m = meldung();
    await kopiereKoordinate('32U 512345 5934567', undefined, m);
    expect(m.error).toHaveBeenCalledWith('Kopieren nicht möglich: 32U 512345 5934567');
  });
});
