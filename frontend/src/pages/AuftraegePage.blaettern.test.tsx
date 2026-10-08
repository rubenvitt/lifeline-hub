import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { MemoryRouter, Routes, Route } from 'react-router';
import AuftraegePage from './AuftraegePage';
import type { Auftrag } from '../api/types';

/**
 * Das Auftragsboard blättert am Server (LFH-1071, Spec `auftraege-blaettern`): offene und
 * Kennzahlen getrennt, Abgeschlossene erst in ihrer Ansicht und seitenweise, ein Deeplink auf einen
 * nicht geladenen Auftrag über den Einzelabruf.
 */

vi.mock('../live/useEinsatzLiveStream', () => ({ useEinsatzLiveStream: () => {} }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ benutzer: { id: 1 } }) }));
vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn().mockResolvedValue({
    id: 1,
    bezeichnung: 'Lage',
    status: 'aktiv',
    meine_rolle: 'einsatzleitung',
  }),
}));
vi.mock('../api/befehle', () => ({
  listeBefehle: vi.fn().mockResolvedValue([]),
  legeBefehlAn: vi.fn(),
}));
vi.mock('../api/einsatzabschnitte', () => ({ listeAbschnitte: vi.fn().mockResolvedValue([]) }));
vi.mock('../api/einheiten', () => ({ listeEinheiten: vi.fn().mockResolvedValue([]) }));

const listeAuftraege = vi.fn();
const listeOffeneAuftraege = vi.fn();
const listeAbgeschlosseneAuftraege = vi.fn();
const ladeAuftragKennzahlen = vi.fn();
const ladeAuftrag = vi.fn();
vi.mock('../api/auftraege', async (original) => {
  const echt = await original<typeof import('../api/auftraege')>();
  return {
    AUFTRAEGE_SEITE: echt.AUFTRAEGE_SEITE,
    auftragAbschlussCursor: echt.auftragAbschlussCursor,
    listeAuftraege: (...a: unknown[]) => listeAuftraege(...a),
    listeOffeneAuftraege: (...a: unknown[]) => listeOffeneAuftraege(...a),
    listeAbgeschlosseneAuftraege: (...a: unknown[]) => listeAbgeschlosseneAuftraege(...a),
    ladeAuftragKennzahlen: (...a: unknown[]) => ladeAuftragKennzahlen(...a),
    ladeAuftrag: (...a: unknown[]) => ladeAuftrag(...a),
    legeAuftragAn: vi.fn(),
    quittiereEmpfaenger: vi.fn(),
    setzeVollzug: vi.fn(),
    nimmAb: vi.fn(),
  };
});

const auftrag = (id: number, over: Partial<Auftrag> = {}): Auftrag => ({
  id,
  einsatz_id: 1,
  auftrag_text: `Auftrag ${id}`,
  absicht: null,
  lage: null,
  ort: null,
  zeit: null,
  mittel: null,
  verbindung: null,
  sicherheit: null,
  prioritaet: 'normal',
  richtung: 'intern',
  frist_at: null,
  erteilt_at: '2026-06-11 09:00:00',
  in_arbeit_at: null,
  vollzugsmeldung: null,
  abgenommen_at: null,
  abgenommen_von_id: null,
  etb_anordnung_id: 5,
  quell_etb_eintrag_id: null,
  erstellt_von_id: 1,
  erstellt_at: '2026-06-11 09:00:00',
  vollzug_status: 'offen',
  vollzogen_at: null,
  vollzogen_von_id: null,
  empfaenger_anzahl: 1,
  quittiert_anzahl: 0,
  ist_ueberfaellig: false,
  bearbeitungsstatus: 'offen',
  empfaenger: [],
  ...over,
});

/** Abgenommen; je größer die id, desto früher. */
const abgenommen = (id: number) =>
  auftrag(id, {
    bearbeitungsstatus: 'abgenommen',
    abgenommen_at: `2026-06-11 ${String(23 - Math.floor(id / 60)).padStart(2, '0')}:${String(59 - (id % 60)).padStart(2, '0')}:00`,
  });

function renderPage(route = '/einsaetze/1/auftraege') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AntApp>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/einsaetze/:id/auftraege" element={<AuftraegePage />} />
          </Routes>
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>,
  );
  return { client };
}

describe('Auftragsboard blättert am Server (LFH-1071)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeOffeneAuftraege.mockResolvedValue([auftrag(500, { auftrag_text: 'Offener Auftrag' })]);
    ladeAuftragKennzahlen.mockResolvedValue({ offen: 1, abgeschlossen: 150 });
    const alle = Array.from({ length: 150 }, (_, i) => abgenommen(i + 1));
    listeAbgeschlosseneAuftraege.mockImplementation(
      (_e: number, _f: unknown, vor?: { id: number }) =>
        Promise.resolve(vor ? alle.slice(100) : alle.slice(0, 100)),
    );
  });

  it('lädt Abgeschlossene erst in ihrer Ansicht und zählt aus den Kennzahlen', async () => {
    renderPage();
    await screen.findByText('Offener Auftrag');
    expect(listeAuftraege).not.toHaveBeenCalled();
    expect(listeAbgeschlosseneAuftraege).not.toHaveBeenCalled();
    expect(await screen.findByText('Abgeschlossen (150)')).toBeInTheDocument();
    expect(screen.getByText('Offen (1)')).toBeInTheDocument();
    expect(screen.getByText('1 offen · 150 abgeschlossen')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Abgeschlossen (150)'));
    expect(await screen.findByText('100 von 150 geladen')).toBeInTheDocument();
    expect(listeAbgeschlosseneAuftraege).toHaveBeenCalledTimes(1);
    expect(listeAbgeschlosseneAuftraege).toHaveBeenLastCalledWith(
      1,
      { richtung: undefined, abschnittId: undefined, einheitId: undefined },
      undefined,
    );
  });

  it('„Ältere laden“ holt die nächste Seite ab dem letzten Auftrag', async () => {
    renderPage();
    await screen.findByText('Offener Auftrag');
    await userEvent.click(await screen.findByText('Abgeschlossen (150)'));
    await userEvent.click(await screen.findByRole('button', { name: 'Ältere laden' }));
    await waitFor(() => expect(listeAbgeschlosseneAuftraege).toHaveBeenCalledTimes(2));
    expect(listeAbgeschlosseneAuftraege).toHaveBeenLastCalledWith(1, expect.anything(), {
      zeit: abgenommen(100).abgenommen_at,
      id: 100,
    });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Ältere laden' })).not.toBeInTheDocument(),
    );
  });

  it('?auftrag= auf einen nicht geladenen Auftrag holt ihn einzeln und heftet ihn an', async () => {
    ladeAuftrag.mockResolvedValue(abgenommen(140));
    renderPage('/einsaetze/1/auftraege?auftrag=140');
    expect(await screen.findByText('Verlinkter Auftrag')).toBeInTheDocument();
    expect(ladeAuftrag).toHaveBeenCalledWith(1, 140);
    await waitFor(() =>
      expect(document.querySelector('[data-auftrag-id="140"]')).toHaveAttribute(
        'data-hervorgehoben',
        'true',
      ),
    );
  });

  it('?auftrag= auf einen offenen Auftrag braucht keinen Einzelabruf', async () => {
    renderPage('/einsaetze/1/auftraege?auftrag=500');
    await waitFor(() =>
      expect(document.querySelector('[data-auftrag-id="500"]')).toHaveAttribute(
        'data-hervorgehoben',
        'true',
      ),
    );
    expect(ladeAuftrag).not.toHaveBeenCalled();
    expect(screen.queryByText('Verlinkter Auftrag')).not.toBeInTheDocument();
  });
});
