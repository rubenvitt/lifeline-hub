import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Person } from '../api/types';
import { DEFAULT_KONVENTIONEN } from '../anzeige/format';
import PersonenDruckTabelle from './PersonenDruckTabelle';

// LFH-727, design.md D6: die Papierform der Betroffenenliste.
const basis: Person = {
  id: 10,
  einsatz_id: 1,
  registrier_nr: 1,
  status: 'betroffen',
  name: 'Mustermann',
  vorname: 'Max',
  geschlecht: 'maennlich',
  geburtsdatum: null,
  alter_geschaetzt: 40,
  herkunft_adresse: null,
  antreff_ort: 'Brücke',
  melder_kontakt: null,
  notiz: null,
  erfasst_at: '2026-05-27 09:00:00',
  erfasst_von: 1,
  geaendert_at: '2026-05-27 09:00:00',
  geaendert_von: 1,
  storniert_at: null,
};

function zeilen(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-lfh="personen-druck-tabelle"] tbody tr'),
  );
}

function rendere(personen: Person[], uhs: Record<number, string> = {}) {
  render(
    <PersonenDruckTabelle
      personen={personen}
      uhsName={(id) => uhs[id]}
      konventionen={DEFAULT_KONVENTIONEN}
    />,
  );
}

describe('PersonenDruckTabelle', () => {
  it('ordnet aufsteigend nach Registriernummer', () => {
    rendere([
      { ...basis, id: 3, registrier_nr: 3 },
      { ...basis, id: 1, registrier_nr: 1 },
      { ...basis, id: 2, registrier_nr: 2 },
    ]);
    expect(zeilen().map((z) => z.querySelector('td')!.textContent)).toEqual([
      'R-001',
      'R-002',
      'R-003',
    ]);
  });

  it('trägt die Spalten der Spec, Sichtung als Wort ohne Farbe', () => {
    rendere([{ ...basis, aktuelle_sichtung: 'sk1' }]);
    expect(
      Array.from(document.querySelectorAll('[data-lfh="personen-druck-tabelle"] thead th')).map(
        (th) => th.textContent,
      ),
    ).toEqual([
      'Nr.',
      'Name',
      'Geschl./Alter',
      'Sichtung',
      'Status',
      'Fundort',
      'Verbleib',
      'erfasst',
    ]);
    const zeile = within(zeilen()[0]);
    expect(zeile.getByText('Mustermann, Max')).toBeInTheDocument();
    expect(zeile.getByText('m ~40')).toBeInTheDocument();
    expect(zeile.getByText('SK I')).toBeInTheDocument();
    expect(zeile.getByText('betroffen')).toBeInTheDocument();
    expect(zeile.getByText('Brücke')).toBeInTheDocument();
    // Kein Farbfeld: die Zelle trägt nur das Wort.
    const sichtung = zeilen()[0].querySelectorAll('td')[3];
    expect(sichtung.textContent).toBe('SK I');
    expect(sichtung.childElementCount).toBe(0);
  });

  it('nennt fehlende Angaben in Worten', () => {
    rendere([{ ...basis, name: null, vorname: null, antreff_ort: null }]);
    const zeile = within(zeilen()[0]);
    expect(zeile.getByText('unbekannt')).toBeInTheDocument();
    expect(zeile.getByText('ohne Sichtung')).toBeInTheDocument();
  });

  it('zeigt den Verbleib mit UHS-Namen und ohne', () => {
    rendere(
      [
        { ...basis, id: 1, registrier_nr: 1, aktuelle_uhs_id: 5 },
        { ...basis, id: 2, registrier_nr: 2, aktuelle_uhs_id: 6 },
      ],
      { 5: 'BHP 50' },
    );
    expect(within(zeilen()[0]).getByText('UHS BHP 50')).toBeInTheDocument();
    // Name nicht verfügbar: „UHS“ ohne Namen, keine Kennung.
    expect(zeilen()[1].querySelectorAll('td')[6].textContent).toBe('UHS');
  });

  it('enthält keinen Link', () => {
    rendere([basis]);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});
