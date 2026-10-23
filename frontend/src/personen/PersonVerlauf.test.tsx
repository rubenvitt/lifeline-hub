import { render, screen } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import { describe, expect, it } from 'vitest';
import PersonVerlauf from './PersonVerlauf';
import type { PersonDetail } from '../api/types';

// EIN chronologischer Verlauf für Drawer und Detailseite; Zeitstempel taktisch, nie roher
// Wire-String.

const basis = {
  id: 10,
  einsatz_id: 1,
  registrier_nr: 1,
  status: 'erfasst',
  name: 'Mustermann',
  vorname: 'Max',
  geschlecht: 'maennlich',
  geburtsdatum: null,
  alter_geschaetzt: 40,
  herkunft_adresse: null,
  antreff_ort: null,
  melder_kontakt: null,
  notiz: null,
  erfasst_at: '2026-05-27 09:00:00',
  erfasst_von: 1,
  geaendert_at: '2026-05-27 09:00:00',
  geaendert_von: 1,
  storniert_at: null,
  versorgung: 'offen',
  aktuelle_sichtung: null,
  aktuelle_sichtung_at: null,
  aktueller_verbleib: null,
  aktuelle_uhs_id: null,
  aktueller_platz_id: null,
  sichtungen: [],
  notizen: [],
  verbleib: [],
  abgleiche: [],
  transporte: [],
  massnahmen: [],
  verletzungen: [],
} as PersonDetail;

const person: PersonDetail = {
  ...basis,
  aktuelle_sichtung: 'sk2',
  sichtungen: [
    {
      id: 1,
      einsatz_id: 1,
      person_id: 10,
      kategorie: 'sk2',
      gesichtet_at: '2026-05-27 09:10:00',
      gesichtet_von: 1,
      notiz: 'Beinbruch',
    },
  ],
  notizen: [
    {
      id: 2,
      einsatz_id: 1,
      person_id: 10,
      text: 'Schmerzmittel gegeben',
      erfasst_at: '2026-05-27 09:20:00',
      erfasst_von: 1,
    },
  ],
  verbleib: [
    {
      id: 3,
      einsatz_id: 1,
      person_id: 10,
      art: 'transport',
      ziel: 'Klinikum Nord',
      transportmittel: 'RTW 1',
      zeitpunkt_at: '2026-05-27 09:30:00',
      erfasst_von: 1,
    },
  ],
};

function renderVerlauf(p: PersonDetail) {
  return render(
    <ConfigProvider>
      <PersonVerlauf person={p} />
    </ConfigProvider>,
  );
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

  it('nennt die am Gerät bestätigende Person (LFH-1046)', () => {
    const { container } = renderVerlauf({
      ...person,
      sichtungen: [{ ...person.sichtungen[0], bestaetigt_name: 'Dr. A. Muster' }],
      verbleib: [{ ...person.verbleib[0], bestaetigt_name: 'Dr. B. Beispiel' }],
    });
    const zeilen = [...container.querySelectorAll('li')].map((li) => li.textContent ?? '');
    expect(zeilen[0]).toContain('bestätigt: Dr. B. Beispiel');
    expect(zeilen[2]).toContain('bestätigt: Dr. A. Muster');
    expect(renderVerlauf(person).container.textContent).not.toContain('bestätigt');
  });

  it('rendert den Zeitstempel taktisch (DTG), nicht als Wire-String', () => {
    const { container } = renderVerlauf(person);
    const text = container.textContent ?? '';
    // Taktische DTG „270930mai26" — Tag+Uhrzeit, dt. Monatskürzel, Jahr.
    expect(text).toMatch(/\d{6}mai26/);
    expect(text).not.toContain('2026-05-27');
  });

  it('stellt den Zeitstempel VOR den Eintrag', () => {
    const { container } = renderVerlauf(person);
    const erste = container.querySelector('li')?.textContent ?? '';
    expect(erste).toMatch(/^\d{6}mai26/);
  });

  it('zeigt bei leerem Verlauf „noch kein Verlauf"', () => {
    renderVerlauf(basis);
    expect(screen.getByText('noch kein Verlauf')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });
});

describe('PersonVerlauf — PAT-Kern (Change y18v58dt-pat-kern)', () => {
  const kern: PersonDetail = {
    ...basis,
    transporte: [
      {
        id: 7,
        einsatz_id: 1,
        person_id: 10,
        prioritaet: null,
        art: null,
        fachrichtung: null,
        zeitpunkt_at: '2026-05-27 09:50:00',
        erfasst_at: '2026-05-27 09:50:00',
        erfasst_von: 1,
      },
      {
        id: 6,
        einsatz_id: 1,
        person_id: 10,
        prioritaet: 'dringlich',
        art: 'liegend',
        fachrichtung: 'unfallchirurgie',
        zeitpunkt_at: '2026-05-27 09:40:00',
        erfasst_at: '2026-05-27 09:40:00',
        erfasst_von: 1,
        bestaetigt_name: 'Dr. A. Muster',
      },
    ],
    massnahmen: [
      {
        id: 3,
        einsatz_id: 1,
        person_id: 10,
        art: 'infusion',
        zeitpunkt_at: '2026-05-27 09:35:00',
        erfasst_at: '2026-05-27 09:35:00',
        erfasst_von: 1,
        aufgehoben_at: '2026-05-27 09:36:00',
      },
      {
        id: 2,
        einsatz_id: 1,
        person_id: 10,
        art: 'blutstillung',
        // Um 09:05 gesetzt, um 09:30 erfasst: nachgetragen.
        zeitpunkt_at: '2026-05-27 09:05:00',
        erfasst_at: '2026-05-27 09:30:00',
        erfasst_von: 1,
      },
    ],
    verletzungen: [
      {
        id: 4,
        einsatz_id: 1,
        person_id: 10,
        ansicht: 'vorn',
        region: 'unterarm_l',
        art: 'fraktur_verdacht',
        schwere: 'schwer',
        zeitpunkt_at: '2026-05-27 09:15:00',
        erfasst_at: '2026-05-27 09:15:00',
        erfasst_von: 1,
      },
      {
        id: 5,
        einsatz_id: 1,
        person_id: 10,
        ansicht: 'hinten',
        region: 'ruecken',
        art: 'schmerz',
        zeitpunkt_at: '2026-05-27 09:16:00',
        erfasst_at: '2026-05-27 09:16:00',
        erfasst_von: 1,
        aufgehoben_at: '2026-05-27 09:20:00',
      },
    ],
  };

  function zeilen(p: PersonDetail): string[] {
    const { container } = renderVerlauf(p);
    return [...container.querySelectorAll('li')].map((li) => li.textContent ?? '');
  }

  it('führt Transport, Maßnahme und Verletzung in der einen Spur, neueste zuerst', () => {
    const z = zeilen(kern);
    expect(z).toHaveLength(6);
    expect(z[0]).toMatch(/Transport aufgehoben/);
    expect(z[1]).toMatch(
      /Transport dringlich · liegend · Unfallchirurgie · bestätigt: Dr\. A\. Muster/,
    );
    expect(z[2]).toMatch(/Maßnahme Infusion/);
    expect(z[3]).toMatch(/Verletzung 2 Rücken, hinten · Schmerz/);
    expect(z[4]).toMatch(/Verletzung 1 Unterarm links, vorn · Fraktur-Verdacht · schwer/);
    expect(z[5]).toMatch(/Maßnahme Blutstillung/);
  });

  it('kennzeichnet aufgehobene Maßnahmen und Verletzungen', () => {
    const z = zeilen(kern);
    expect(z[2]).toMatch(/aufgehoben \d{6}mai26/);
    expect(z[3]).toMatch(/aufgehoben \d{6}mai26/);
    expect(z[4]).not.toMatch(/aufgehoben/);
    expect(z[5]).not.toMatch(/aufgehoben/);
  });

  it('kennzeichnet einen nachgetragenen Eintrag, einen sofort erfassten nicht', () => {
    const z = zeilen(kern);
    expect(z[5]).toMatch(/nachgetragen/);
    expect(z.filter((t) => t.includes('nachgetragen'))).toHaveLength(1);
  });

  it('kennzeichnet auch eine nachgereichte Sichtung über ihren Eingang', () => {
    const z = zeilen({
      ...basis,
      sichtungen: [
        {
          id: 1,
          einsatz_id: 1,
          person_id: 10,
          kategorie: 'sk1',
          gesichtet_at: '2026-05-27 09:10:00',
          eingegangen_at: '2026-05-27 09:30:00',
          gesichtet_von: 1,
        },
        {
          id: 2,
          einsatz_id: 1,
          person_id: 10,
          kategorie: 'sk2',
          gesichtet_at: '2026-05-27 09:20:00',
          eingegangen_at: '2026-05-27 09:20:01',
          gesichtet_von: 1,
        },
      ],
    });
    expect(z[0]).not.toMatch(/nachgetragen/);
    expect(z[1]).toMatch(/SK I.*nachgetragen/);
  });
});
