import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Schaden } from '../../api/types';
import { DEFAULT_KONVENTIONEN } from '../../anzeige/format';
import SchaedenDruckTabelle from './SchaedenDruckTabelle';

// LFH-727, design.md D6: die Papierform der Schadensliste.
function schaden(nr: number, over: Partial<Schaden> = {}): Schaden {
  return {
    id: nr * 10,
    einsatz_id: 1,
    registrier_nr: nr,
    status: 'offen',
    typ: 'sachschaden',
    ausmass: 'mittel',
    ort: 'Hauptstr. 17',
    beschreibung: '',
    lat: null,
    lon: null,
    geschaedigt_person_id: null,
    geschaedigt_personal_id: null,
    geschaedigt_organisation_id: null,
    geschaedigt_kontakt: null,
    uebergeben_an: null,
    uebergeben_at: null,
    abschluss_grund: null,
    abschluss_at: null,
    erfasst_at: '2026-05-29 10:00:00',
    erfasst_von: 1,
    geaendert_at: '2026-05-29 10:00:00',
    geaendert_von: 1,
    storniert_at: null,
    storniert_von: null,
    geschaedigt_registrier_nr: null,
    geschaedigt_storniert_at: null,
    geschaedigt_personal_name: null,
    geschaedigt_organisation_name: null,
    ...over,
  } as Schaden;
}

function zellen(zeile: number): string[] {
  const zeilen = document.querySelectorAll('[data-lfh="schaeden-druck-tabelle"] tbody tr');
  return Array.from(zeilen[zeile].querySelectorAll('td')).map((td) => td.textContent ?? '');
}

describe('SchaedenDruckTabelle', () => {
  it('ordnet aufsteigend nach Registriernummer und trägt die Spalten der Spec', () => {
    render(
      <SchaedenDruckTabelle
        schaeden={[schaden(3), schaden(1), schaden(2)]}
        konventionen={DEFAULT_KONVENTIONEN}
      />,
    );
    expect(
      Array.from(document.querySelectorAll('[data-lfh="schaeden-druck-tabelle"] thead th')).map(
        (th) => th.textContent,
      ),
    ).toEqual(['Nr.', 'Typ', 'Ausmaß', 'Ort', 'Status', 'Geschädigt', 'erfasst']);
    expect([zellen(0)[0], zellen(1)[0], zellen(2)[0]]).toEqual(['S-001', 'S-002', 'S-003']);
    expect(zellen(0).slice(1, 6)).toEqual(['Sachschaden', 'mittel', 'Hauptstr. 17', 'offen', '—']);
  });

  it('nennt „übergeben an“ und den Geschädigten als Text ohne Link', () => {
    render(
      <SchaedenDruckTabelle
        schaeden={[
          schaden(1, { status: 'uebergeben', uebergeben_an: 'Stadtwerke' }),
          schaden(2, { geschaedigt_person_id: 42, geschaedigt_registrier_nr: 7 }),
          schaden(3, { geschaedigt_personal_id: 9, geschaedigt_personal_name: 'Schulz' }),
          schaden(4, {
            geschaedigt_registrier_nr: 8,
            geschaedigt_storniert_at: '2026-05-29 11:00:00',
          }),
          schaden(5, { geschaedigt_organisation_id: 1, geschaedigt_organisation_name: 'DRK' }),
          schaden(6, { geschaedigt_kontakt: 'Hausverwaltung' }),
        ]}
        konventionen={DEFAULT_KONVENTIONEN}
      />,
    );
    expect(zellen(0)[4]).toBe('übergeben an Stadtwerke');
    expect(zellen(1)[5]).toBe('R-007');
    expect(zellen(2)[5]).toBe('Schulz');
    expect(zellen(3)[5]).toBe('R-008 (storniert)');
    expect(zellen(4)[5]).toBe('DRK');
    expect(zellen(5)[5]).toBe('Hausverwaltung');
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});
