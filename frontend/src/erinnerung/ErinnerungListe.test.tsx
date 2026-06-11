import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

describe('ErinnerungListe', () => {
  it('zeigt Titel und markiert fällige Erinnerungen', () => {
    render(<ErinnerungListe erinnerungen={[erinnerung({ ist_faellig: true })]} darfSchreiben onErledigen={() => {}} onQuittieren={() => {}} />);
    expect(screen.getByText('Lagemeldung')).toBeInTheDocument();
    expect(screen.getByText(/^fällig$/i)).toBeInTheDocument();
  });

  it('löst onErledigen mit der ID aus', () => {
    const onErledigen = vi.fn();
    render(<ErinnerungListe erinnerungen={[erinnerung({})]} darfSchreiben onErledigen={onErledigen} onQuittieren={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /erledigt/i }));
    expect(onErledigen).toHaveBeenCalledWith(1);
  });

  it('blendet Aktionen ohne Schreibrecht aus', () => {
    render(<ErinnerungListe erinnerungen={[erinnerung({})]} darfSchreiben={false} onErledigen={() => {}} onQuittieren={() => {}} />);
    expect(screen.queryByRole('button', { name: /erledigt/i })).not.toBeInTheDocument();
  });

  it('zeigt Vollzogen-Tag wenn vollzug_status vollzogen ist', () => {
    render(<ErinnerungListe
      erinnerungen={[erinnerung({ vollzug_status: 'vollzogen', vollzogen_at: '2026-06-11 11:00:00' })]}
      darfSchreiben onErledigen={() => {}} onQuittieren={() => {}}
    />);
    expect(screen.getByText('Vollzogen')).toBeInTheDocument();
  });

  it('zeigt Quittiert-Tag wenn quittiert_at gesetzt ist', () => {
    render(<ErinnerungListe
      erinnerungen={[erinnerung({ quittiert_at: '2026-06-11 10:30:00' })]}
      darfSchreiben onErledigen={() => {}} onQuittieren={() => {}}
    />);
    expect(screen.getByText('Quittiert')).toBeInTheDocument();
  });
});
