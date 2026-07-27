import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import ErinnerungListe from './ErinnerungListe';
import type { Erinnerung } from '../api/types';

function erinnerung(over: Partial<Erinnerung>): Erinnerung {
  return {
    id: 1, einsatz_id: 1, titel: 'Lagemeldung', beschreibung: null,
    faellig_at: '2026-06-11 10:00:00', intervall_minuten: 30, empfaenger_funktion: null,
    bezug_typ: null, bezug_id: null, quelle: 'manuell', status: 'offen',
    erledigt_at: null, erstellt_von_id: 1, erstellt_at: '2026-06-11 09:00:00',
    ist_faellig: false,
    quittiert_at: null, quittiert_von_id: null,
    vollzug_status: 'offen', vollzogen_at: null, vollzogen_von_id: null,
    ...over,
  };
}

function renderListe(ui: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={['/einsaetze/1/erinnerungen']}>
      <Routes><Route path="/einsaetze/:id/erinnerungen" element={ui} /></Routes>
    </MemoryRouter>,
  );
}

describe('ErinnerungListe', () => {
  it('zeigt Titel und markiert fällige Erinnerungen', () => {
    renderListe(<ErinnerungListe erinnerungen={[erinnerung({ ist_faellig: true })]} darfSchreiben onErledigen={() => {}} onQuittieren={() => {}} />);
    expect(screen.getByText('Lagemeldung')).toBeInTheDocument();
    expect(screen.getByText(/^fällig$/i)).toBeInTheDocument();
  });

  it('löst onErledigen nach Popconfirm-Bestätigung mit der ID aus', async () => {
    const onErledigen = vi.fn();
    renderListe(<ErinnerungListe erinnerungen={[erinnerung({})]} darfSchreiben onErledigen={onErledigen} onQuittieren={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /erledigt/i }));
    // Popconfirm öffnet ein Bestätigungs-Popover mit eigenem „Erledigt"-OK-Button.
    const popconfirm = await screen.findByRole('tooltip');
    fireEvent.click(within(popconfirm).getByRole('button', { name: /erledigt/i }));
    expect(onErledigen).toHaveBeenCalledWith(1);
  });

  it('blendet Aktionen ohne Schreibrecht aus', () => {
    renderListe(<ErinnerungListe erinnerungen={[erinnerung({})]} darfSchreiben={false} onErledigen={() => {}} onQuittieren={() => {}} />);
    expect(screen.queryByRole('button', { name: /erledigt/i })).not.toBeInTheDocument();
  });

  it('zeigt Vollzogen-Tag wenn vollzug_status vollzogen ist', () => {
    renderListe(<ErinnerungListe
      erinnerungen={[erinnerung({ vollzug_status: 'vollzogen', vollzogen_at: '2026-06-11 11:00:00' })]}
      darfSchreiben onErledigen={() => {}} onQuittieren={() => {}}
    />);
    expect(screen.getByText('Vollzogen')).toBeInTheDocument();
  });

  it('unterscheidet Erledigt und Quittiert in der Abgeschlossen-Ansicht via Status-Badge', () => {
    renderListe(<ErinnerungListe
      ansicht="abgeschlossen"
      erinnerungen={[
        erinnerung({ id: 2, titel: 'Erledigte', status: 'erledigt', erledigt_at: '2026-06-11 12:00:00' }),
        erinnerung({ id: 3, titel: 'Quittierte', status: 'quittiert', quittiert_at: '2026-06-11 10:30:00' }),
      ]}
      darfSchreiben onErledigen={() => {}} onQuittieren={() => {}}
    />);
    // Status-Badge zeigt das jeweilige Fachlabel.
    expect(screen.getByText('Erledigt')).toBeInTheDocument();
    expect(screen.getAllByText(/Quittiert/).length).toBeGreaterThan(0);
  });

  it('zeigt einen Deeplink zum Bezugsobjekt (Auftrag) mit Objekt-Selektion', () => {
    renderListe(<ErinnerungListe
      erinnerungen={[erinnerung({ bezug_typ: 'auftrag', bezug_id: 42 })]}
      darfSchreiben onErledigen={() => {}} onQuittieren={() => {}}
    />);
    const link = screen.getByRole('link', { name: /Auftrag #42/ });
    // F36/LFH-257: Deeplink selektiert das referenzierte Objekt (?auftrag=), statt nur
    // auf die ungefilterte Liste zu zeigen.
    expect(link).toHaveAttribute('href', '/einsaetze/1/auftraege?auftrag=42');
  });
});
