import { describe, expect, it, vi } from 'vitest';
import { fuehreKartenWahlAus, kartenKontextEintraege, type KartenAktion } from './kartenKontext';

const AKTIONEN: KartenAktion[] = [
  { key: 'bestaetigen', label: 'Bestätigen', onWahl: vi.fn() },
  { key: 'aufheben', label: 'Aufheben', gefahr: true, onWahl: vi.fn() },
  {
    key: 'material',
    label: 'Als Material übernehmen',
    gesperrt: true,
    sperrgrund: 'kein Zugriff',
    onWahl: vi.fn(),
  },
];

describe('kartenKontextEintraege (LLH-1598, D3)', () => {
  it('liefert die Einträge in Lieferreihenfolge, gesperrte mit Grund im Etikett', () => {
    expect(kartenKontextEintraege(AKTIONEN)).toEqual([
      { key: 'bestaetigen', label: 'Bestätigen' },
      { key: 'aufheben', label: 'Aufheben', gefahr: true },
      { key: 'material', label: 'Als Material übernehmen (kein Zugriff)', gesperrt: true },
    ]);
  });

  it('ein Grund ohne Sperre ändert das Etikett nicht', () => {
    expect(
      kartenKontextEintraege([{ key: 'a', label: 'A', sperrgrund: 'x', onWahl: () => {} }]),
    ).toEqual([{ key: 'a', label: 'A' }]);
  });
});

describe('fuehreKartenWahlAus (LLH-1598, D3)', () => {
  const modal = () => ({ confirm: vi.fn() });

  it('ohne Rückfrage ruft die Wahl die Aktion sofort', () => {
    const onWahl = vi.fn();
    const m = modal();
    fuehreKartenWahlAus([{ key: 'a', label: 'A', onWahl }], 'a', m);
    expect(onWahl).toHaveBeenCalledTimes(1);
    expect(m.confirm).not.toHaveBeenCalled();
  });

  it('mit Rückfrage öffnet ein Dialog mit Titel, Knopf und Gefahrfarbe; erst OK löst aus', () => {
    const onWahl = vi.fn();
    const m = modal();
    fuehreKartenWahlAus(
      [
        {
          key: 'ab',
          label: 'Abnehmen',
          onWahl,
          rueckfrage: { titel: 'Auftrag abnehmen?', knopf: 'Auftrag abnehmen', gefahr: true },
        },
      ],
      'ab',
      m,
    );
    expect(onWahl).not.toHaveBeenCalled();
    expect(m.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Auftrag abnehmen?',
        okText: 'Auftrag abnehmen',
        okButtonProps: { danger: true },
      }),
    );
    m.confirm.mock.calls[0][0].onOk();
    expect(onWahl).toHaveBeenCalledTimes(1);
  });

  it('eine gesperrte oder unbekannte Aktion löst nichts aus', () => {
    const onWahl = vi.fn();
    const m = modal();
    fuehreKartenWahlAus([{ key: 'a', label: 'A', gesperrt: true, onWahl }], 'a', m);
    fuehreKartenWahlAus([{ key: 'a', label: 'A', onWahl }], 'weg', m);
    expect(onWahl).not.toHaveBeenCalled();
    expect(m.confirm).not.toHaveBeenCalled();
  });
});
