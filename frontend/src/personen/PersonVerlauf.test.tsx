import { render, screen } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import { describe, expect, it } from 'vitest';
import PersonVerlauf from './PersonVerlauf';
import type { PersonDetail } from '../api/types';

// Vertrag der Komponente (LFH-328/Task 12): EIN chronologischer Verlauf für Drawer
// und Detailseite. Zeitstempel taktisch (ZeitAnzeige/DTG), nie roher Wire-String.

const basis = {
  id: 10, einsatz_id: 1, registrier_nr: 1, status: 'erfasst',
  name: 'Mustermann', vorname: 'Max', geschlecht: 'maennlich', geburtsdatum: null,
  alter_geschaetzt: 40, herkunft_adresse: null, antreff_ort: null, melder_kontakt: null,
  notiz: null, erfasst_at: '2026-05-27 09:00:00', erfasst_von: 1,
  geaendert_at: '2026-05-27 09:00:00', geaendert_von: 1, storniert_at: null,
  aktuelle_sichtung: null, aktuelle_sichtung_at: null, aktueller_verbleib: null,
  aktuelle_uhs_id: null, aktueller_platz_id: null,
  sichtungen: [], notizen: [], verbleib: [], abgleiche: [],
} as PersonDetail;

const person: PersonDetail = {
  ...basis,
  aktuelle_sichtung: 'sk2',
  sichtungen: [
    {
      id: 1, einsatz_id: 1, person_id: 10, kategorie: 'sk2',
      gesichtet_at: '2026-05-27 09:10:00', gesichtet_von: 1, notiz: 'Beinbruch',
    },
  ],
  notizen: [
    {
      id: 2, einsatz_id: 1, person_id: 10, text: 'Schmerzmittel gegeben',
      erfasst_at: '2026-05-27 09:20:00', erfasst_von: 1,
    },
  ],
  verbleib: [
    {
      id: 3, einsatz_id: 1, person_id: 10, art: 'transport',
      ziel: 'Klinikum Nord', transportmittel: 'RTW 1',
      zeitpunkt_at: '2026-05-27 09:30:00', erfasst_von: 1,
    },
  ],
};

function renderVerlauf(p: PersonDetail) {
  return render(<ConfigProvider><PersonVerlauf person={p} /></ConfigProvider>);
}

describe('PersonVerlauf', () => {
  it('zeigt Sichtung, Notiz und Verbleib neueste zuerst', () => {
    const { container } = renderVerlauf(person);
    const zeilen = [...container.querySelectorAll('li')].map((li) => li.textContent ?? '');
    expect(zeilen).toHaveLength(3);
    // 09:30 Verbleib → 09:20 Notiz → 09:10 Sichtung
    expect(zeilen[0]).toContain('Transport → Klinikum Nord (RTW 1)');
    expect(zeilen[1]).toContain('Schmerzmittel gegeben');
    expect(zeilen[2]).toContain('SK II');
    expect(zeilen[2]).toContain('Beinbruch');
  });

  it('rendert den Zeitstempel taktisch (DTG), nicht als Wire-String', () => {
    const { container } = renderVerlauf(person);
    const text = container.textContent ?? '';
    // Taktische DTG „270930MAI2026" — Tag+Uhrzeit, dt. Monatskürzel, Jahr.
    expect(text).toMatch(/\d{6}MAI2026/);
    expect(text).not.toContain('2026-05-27');
  });

  it('stellt den Zeitstempel VOR den Eintrag', () => {
    const { container } = renderVerlauf(person);
    const erste = container.querySelector('li')?.textContent ?? '';
    expect(erste).toMatch(/^\d{6}MAI2026/);
  });

  it('zeigt bei leerem Verlauf „noch kein Verlauf"', () => {
    renderVerlauf(basis);
    expect(screen.getByText('noch kein Verlauf')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });
});
