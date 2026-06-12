import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import MeldungenPage from './MeldungenPage';
import type { Meldung } from '../api/types';
import { ladeEinsatz } from '../api/einsaetze';

vi.mock('../etb/useEinsatzLiveStream', () => ({ useEinsatzLiveStream: () => {} }));
vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn().mockResolvedValue({ id: 1, bezeichnung: 'Lage', status: 'aktiv', meine_rolle: 'einsatzleitung' }),
  ladeMitglieder: vi.fn().mockResolvedValue([
    { benutzer_id: 2, anzeigename: 'Sani Schmidt', benutzername: 'sani', einsatz_rolle: 'fuehrungspersonal', zugewiesen_at: '' },
  ]),
}));

const listeMeldungen = vi.fn();
const legeMeldungAn = vi.fn();
const setzeMeldungStatus = vi.fn();
const weiseBearbeiterZu = vi.fn();
const markiereLagerelevant = vi.fn();
vi.mock('../api/meldungen', () => ({
  listeMeldungen: (...a: unknown[]) => listeMeldungen(...a),
  legeMeldungAn: (...a: unknown[]) => legeMeldungAn(...a),
  setzeMeldungStatus: (...a: unknown[]) => setzeMeldungStatus(...a),
  weiseBearbeiterZu: (...a: unknown[]) => weiseBearbeiterZu(...a),
  markiereLagerelevant: (...a: unknown[]) => markiereLagerelevant(...a),
}));

const meldung = (over: Partial<Meldung> = {}): Meldung => ({
  id: 1, einsatz_id: 1, lfd_nr: 1, absender: 'Florian Nord 1', empfaenger: 'ELW 1',
  meldeweg: 'funk', inhalt: 'Deich instabil', meldungsart: 'sofortmeldung', prioritaet: 'normal',
  status: 'neu', bearbeiter_id: null, bearbeiter_name: null, lagerelevant: false,
  ereigniszeit: '2026-06-12 09:00:00', eingang_at: '2026-06-12 09:05:00',
  etb_meldung_id: 7, auftrag_id: null, erfasst_von_id: 1, erstellt_at: '2026-06-12 09:05:00',
  lage_meldung_id: null, ist_offen: true, ...over,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AntApp>
        <MemoryRouter initialEntries={['/einsaetze/1/meldungen']}>
          <Routes><Route path="/einsaetze/:id/meldungen" element={<MeldungenPage />} /></Routes>
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>,
  );
}

describe('MeldungenPage', () => {
  beforeEach(() => { vi.clearAllMocks(); listeMeldungen.mockResolvedValue([meldung()]); });

  it('zeigt eingegangene Meldungen im Posteingang', async () => {
    renderPage();
    expect(await screen.findByText('Florian Nord 1')).toBeInTheDocument();
    expect(screen.getByText('Deich instabil')).toBeInTheDocument();
    // Status-Tag „Neu" der Meldung (eindeutig über die Tag-Klasse; „Neu" steht auch im Segment-Filter).
    expect(screen.getByText('Neu', { selector: '.ant-tag' })).toBeInTheDocument();
  });

  it('erfasst eine Meldung mit Mindestfeldern (Absender, Inhalt, Meldeweg)', async () => {
    legeMeldungAn.mockResolvedValue(meldung());
    renderPage();
    await screen.findByText('Florian Nord 1');
    await userEvent.type(screen.getByLabelText('Absender'), 'RTW 2');
    await userEvent.type(screen.getByLabelText('Inhalt / Wortlaut'), 'Eingetroffen');
    await userEvent.click(screen.getByRole('button', { name: 'Meldung erfassen' }));
    await waitFor(() => expect(legeMeldungAn).toHaveBeenCalledWith(1, expect.objectContaining({
      absender: 'RTW 2', inhalt: 'Eingetroffen', meldeweg: 'funk',
    })));
    // Ereigniszeit wird immer mitgesendet (Pflicht, leer ⇒ jetzt).
    expect(legeMeldungAn.mock.calls[0][1].ereigniszeit).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('filtert nach Status (Posteingang)', async () => {
    renderPage();
    await screen.findByText('Florian Nord 1');
    // Segment-Label „Abgeschlossen" ist eindeutig (kollidiert nicht mit Action-Links).
    await userEvent.click(screen.getByText('Abgeschlossen'));
    await waitFor(() => expect(listeMeldungen).toHaveBeenCalledWith(1, { status: 'erledigt' }));
  });

  it('Beobachter sieht Posteingang, aber keine Erfassung', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValueOnce({
      id: 1, bezeichnung: 'Lage', status: 'aktiv', meine_rolle: 'beobachter',
    } as Awaited<ReturnType<typeof ladeEinsatz>>);
    renderPage();
    expect(await screen.findByText('Florian Nord 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Meldung erfassen' })).not.toBeInTheDocument();
  });

  // --- LFH-94: Sichten/Status/Beobachter ---

  it('sichtet eine neue Meldung', async () => {
    setzeMeldungStatus.mockResolvedValue(meldung({ status: 'gesichtet' }));
    renderPage();
    await screen.findByText('Florian Nord 1');
    await userEvent.click(screen.getByText('Sichten', { selector: 'a' }));
    await waitFor(() => expect(setzeMeldungStatus).toHaveBeenCalledWith(1, 1, 'gesichtet'));
  });

  it('setzt eine Meldung auf erledigt', async () => {
    setzeMeldungStatus.mockResolvedValue(meldung({ status: 'erledigt' }));
    renderPage();
    await screen.findByText('Florian Nord 1');
    await userEvent.click(screen.getByText('Erledigt', { selector: 'a' }));
    await waitFor(() => expect(setzeMeldungStatus).toHaveBeenCalledWith(1, 1, 'erledigt'));
  });

  it('Beobachter sieht keine Status-Aktionen', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValueOnce({
      id: 1, bezeichnung: 'Lage', status: 'aktiv', meine_rolle: 'beobachter',
    } as Awaited<ReturnType<typeof ladeEinsatz>>);
    renderPage();
    await screen.findByText('Florian Nord 1');
    expect(screen.queryByText('Sichten', { selector: 'a' })).not.toBeInTheDocument();
  });

  // --- LFH-95: Lage-Übergabe ---

  it('übergibt eine Meldung an die Lage', async () => {
    markiereLagerelevant.mockResolvedValue(meldung({ lagerelevant: true }));
    renderPage();
    await screen.findByText('Florian Nord 1');
    await userEvent.click(screen.getByText('An Lage übergeben', { selector: 'a' }));
    await waitFor(() => expect(markiereLagerelevant).toHaveBeenCalledWith(1, 1));
  });

  it('zeigt lagerelevante Meldung als markiert, ohne erneute Übergabe-Aktion', async () => {
    listeMeldungen.mockResolvedValue([meldung({ lagerelevant: true, lage_meldung_id: 9 })]);
    renderPage();
    await screen.findByText('Florian Nord 1');
    expect(screen.getByText('Lagerelevant ✓')).toBeInTheDocument();
    expect(screen.queryByText('An Lage übergeben', { selector: 'a' })).not.toBeInTheDocument();
  });

  it('weist einer Meldung einen Bearbeiter zu', async () => {
    weiseBearbeiterZu.mockResolvedValue(meldung({ bearbeiter_id: 2, bearbeiter_name: 'Sani Schmidt' }));
    renderPage();
    await screen.findByText('Florian Nord 1');
    // antd Select über combobox-Rolle+Name öffnen, dann echten Options-Knoten klicken (Commit über onChange).
    await userEvent.click(screen.getByRole('combobox', { name: 'Bearbeiter für Meldung 1' }));
    await userEvent.click(await screen.findByText('Sani Schmidt'));
    await waitFor(() => expect(weiseBearbeiterZu).toHaveBeenCalledWith(1, 1, 2));
  });

  it('filtert clientseitig auf offene Meldungen (LFH-94)', async () => {
    listeMeldungen.mockResolvedValue([
      meldung({ id: 1, status: 'neu', ist_offen: true }),
      meldung({ id: 2, lfd_nr: 2, absender: 'RTW 9', status: 'erledigt', ist_offen: false }),
    ]);
    renderPage();
    await screen.findByText('Florian Nord 1');
    expect(screen.getByText('RTW 9')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Offen'));
    // 'Offen' ist kein Server-Status → listeMeldungen ohne status; erledigte fällt clientseitig raus.
    await waitFor(() => expect(screen.queryByText('RTW 9')).not.toBeInTheDocument());
    expect(screen.getByText('Florian Nord 1')).toBeInTheDocument();
  });
});
