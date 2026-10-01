import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Tier } from '../../api/types';
import { DEFAULT_KONVENTIONEN } from '../../anzeige/format';
import TiereDruckTabelle from './TiereDruckTabelle';

// LFH-727, design.md D6: die Papierform der Tierliste.
const basis: Tier = {
  id: 10,
  einsatz_id: 1,
  registrier_nr: 1,
  status: 'aktiv',
  spezies: 'hund',
  rasse_beschreibung: 'Schäferhund',
  rufname: 'Rex',
  geschlecht: 'maennlich',
  alter_geschaetzt: 3,
  farbe_beschreibung: null,
  kennzeichnung: null,
  groesse_gewicht: null,
  halter_person_id: null,
  halter_kontakt: null,
  antreff_ort: 'Weide',
  notiz: null,
  abschluss_grund: null,
  abschluss_ziel: null,
  erfasst_at: '2026-05-29 09:00:00',
  erfasst_von: 1,
  geaendert_at: '2026-05-29 09:00:00',
  geaendert_von: 1,
  storniert_at: null,
  halter_registrier_nr: null,
  halter_storniert_at: null,
};

function zellen(zeile: number): string[] {
  const zeilen = document.querySelectorAll('[data-lfh="tiere-druck-tabelle"] tbody tr');
  return Array.from(zeilen[zeile].querySelectorAll('td')).map((td) => td.textContent ?? '');
}

describe('TiereDruckTabelle', () => {
  it('ordnet aufsteigend nach Registriernummer und trägt die Spalten der Spec', () => {
    render(
      <TiereDruckTabelle
        tiere={[
          { ...basis, id: 3, registrier_nr: 3 },
          { ...basis, id: 1, registrier_nr: 1 },
        ]}
        konventionen={DEFAULT_KONVENTIONEN}
      />,
    );
    expect(
      Array.from(document.querySelectorAll('[data-lfh="tiere-druck-tabelle"] thead th')).map(
        (th) => th.textContent,
      ),
    ).toEqual(['Nr.', 'Status', 'Spezies', 'Rufname', 'Rasse', 'Halter', 'Antreffort', 'erfasst']);
    expect(zellen(0).slice(0, 7)).toEqual([
      'T-001',
      'aktiv',
      'Hund',
      'Rex',
      'Schäferhund',
      'unbekannt',
      'Weide',
    ]);
    expect(zellen(1)[0]).toBe('T-003');
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('nennt den Halter als Registriernummer, storniert oder als Kontakt', () => {
    render(
      <TiereDruckTabelle
        tiere={[
          { ...basis, id: 1, registrier_nr: 1, halter_registrier_nr: 12 },
          {
            ...basis,
            id: 2,
            registrier_nr: 2,
            halter_registrier_nr: 13,
            halter_storniert_at: '2026-05-29 10:00:00',
          },
          { ...basis, id: 3, registrier_nr: 3, halter_kontakt: 'Nachbar, 0170 123' },
        ]}
        konventionen={DEFAULT_KONVENTIONEN}
      />,
    );
    expect(zellen(0)[5]).toBe('R-012');
    expect(zellen(1)[5]).toBe('R-013 (storniert)');
    expect(zellen(2)[5]).toBe('Nachbar, 0170 123');
  });
});
