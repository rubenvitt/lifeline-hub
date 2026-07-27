import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import ErinnerungKarte from './ErinnerungKarte';
import type { Erinnerung } from '../api/types';

function erinnerung(over: Partial<Erinnerung>): Erinnerung {
  return {
    id: 1, einsatz_id: 7, titel: 'Nachfassen', beschreibung: null,
    faellig_at: '2026-06-11 10:00:00', intervall_minuten: null, empfaenger_funktion: null,
    bezug_typ: null, bezug_id: null, quelle: 'manuell', status: 'offen',
    erledigt_at: null, erstellt_von_id: 1, erstellt_at: '2026-06-11 09:00:00',
    ist_faellig: false,
    quittiert_at: null, quittiert_von_id: null,
    vollzug_status: 'offen', vollzogen_at: null, vollzogen_von_id: null,
    ...over,
  };
}

function renderKarte(ui: React.ReactElement, einsatzId = 7) {
  return render(
    <MemoryRouter initialEntries={[`/einsaetze/${einsatzId}/erinnerungen`]}>
      <Routes><Route path="/einsaetze/:id/erinnerungen" element={ui} /></Routes>
    </MemoryRouter>,
  );
}

describe('ErinnerungKarte — Bezug-Deeplink (F36/LFH-257)', () => {
  it('verlinkt einen Auftrags-Bezug mit ?auftrag=<id>-Selektion', () => {
    renderKarte(<ErinnerungKarte erinnerung={erinnerung({ bezug_typ: 'auftrag', bezug_id: 42 })} />);
    const link = screen.getByRole('link', { name: /Auftrag #42/ });
    expect(link).toHaveAttribute('href', '/einsaetze/7/auftraege?auftrag=42');
  });

  it('verlinkt einen Meldungs-Bezug mit ?meldung=<id>-Selektion', () => {
    renderKarte(<ErinnerungKarte erinnerung={erinnerung({ bezug_typ: 'meldung', bezug_id: 5 })} />);
    const link = screen.getByRole('link', { name: /Meldung #5/ });
    expect(link).toHaveAttribute('href', '/einsaetze/7/meldungen?meldung=5');
  });

  it('verlinkt einen ETB-Bezug mit ?eintrag=<id>-Selektion', () => {
    renderKarte(<ErinnerungKarte erinnerung={erinnerung({ bezug_typ: 'etb', bezug_id: 9 })} />);
    const link = screen.getByRole('link', { name: /ETB-Eintrag #9/ });
    expect(link).toHaveAttribute('href', '/einsaetze/7/etb?eintrag=9');
  });

  it('rendert unbekannte Bezugstypen als Tag ohne Link', () => {
    renderKarte(<ErinnerungKarte erinnerung={erinnerung({ bezug_typ: 'person', bezug_id: 3 })} />);
    expect(screen.getByText(/person #3/i)).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('rendert ohne Bezug keinen Deeplink', () => {
    renderKarte(<ErinnerungKarte erinnerung={erinnerung({})} />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
