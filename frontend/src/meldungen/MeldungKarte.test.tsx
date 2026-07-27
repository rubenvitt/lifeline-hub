import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import MeldungKarte from './MeldungKarte';
import type { Meldung } from '../api/types';

const meldung = (over: Partial<Meldung> = {}): Meldung => ({
  id: 1, einsatz_id: 7, lfd_nr: 1, absender: 'Florian Nord 1', empfaenger: 'ELW 1',
  meldeweg: 'funk', inhalt: 'Deich instabil', meldungsart: 'sofortmeldung', prioritaet: 'normal', richtung: 'intern',
  status: 'neu', bearbeiter_id: null, bearbeiter_name: null, lagerelevant: false,
  ereigniszeit: '2026-06-12 09:00:00', eingang_at: '2026-06-12 09:05:00',
  etb_meldung_id: 7, auftrag_id: null, erfasst_von_id: 1, erstellt_at: '2026-06-12 09:05:00',
  lage_meldung_id: null, ist_offen: true, erledigt_at: null,
  bestaetigung_pflicht: false, bestaetigung_frist_at: null, eskaliert: false,
  bestaetigt_at: null, bestaetigt_von_id: null, bestaetigt_von_name: null,
  ist_bestaetigt: false, ist_ueberfaellig: false, ...over,
});

function renderKarte(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('MeldungKarte — Auftrags-Deeplink (F36/LFH-257)', () => {
  it('verlinkt den ausgelösten Auftrag mit ?auftrag=<id>-Selektion', () => {
    renderKarte(<MeldungKarte meldung={meldung({ auftrag_id: 99 })} einsatzId={7} />);
    const link = screen.getByRole('link', { name: /Auftrag/ });
    expect(link).toHaveAttribute('href', '/einsaetze/7/auftraege?auftrag=99');
  });

  it('rendert ohne ausgelösten Auftrag keinen Auftrags-Deeplink', () => {
    renderKarte(<MeldungKarte meldung={meldung({ auftrag_id: null })} einsatzId={7} />);
    expect(screen.queryByRole('link', { name: /Auftrag/ })).toBeNull();
  });
});
