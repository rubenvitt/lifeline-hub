import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AuftraegePage from './AuftraegePage';
import type { Auftrag } from '../api/types';
import { ladeEinsatz } from '../api/einsaetze';

vi.mock('../etb/useEinsatzLiveStream', () => ({ useEinsatzLiveStream: () => {} }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ benutzer: { id: 1 } }) }));
vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn().mockResolvedValue({ id: 1, bezeichnung: 'Lage', status: 'aktiv', meine_rolle: 'einsatzleitung' }),
}));
vi.mock('../api/einsatzabschnitte', () => ({ listeAbschnitte: vi.fn().mockResolvedValue([]) }));
vi.mock('../api/einheiten', () => ({ listeEinheiten: vi.fn().mockResolvedValue([]) }));

const listeAuftraege = vi.fn();
const legeAuftragAn = vi.fn();
const quittiereEmpfaenger = vi.fn();
const setzeVollzug = vi.fn();
const nimmAb = vi.fn();
vi.mock('../api/auftraege', () => ({
  listeAuftraege: (...a: unknown[]) => listeAuftraege(...a),
  legeAuftragAn: (...a: unknown[]) => legeAuftragAn(...a),
  quittiereEmpfaenger: (...a: unknown[]) => quittiereEmpfaenger(...a),
  setzeVollzug: (...a: unknown[]) => setzeVollzug(...a),
  nimmAb: (...a: unknown[]) => nimmAb(...a),
}));

const auftrag = (over: Partial<Auftrag> = {}): Auftrag => ({
  id: 1, einsatz_id: 1, auftrag_text: 'Deich sichern', absicht: null, lage: null, ort: null,
  zeit: null, mittel: null, verbindung: null, sicherheit: null, prioritaet: 'normal',
  frist_at: null, erteilt_at: '2026-06-11 09:00:00', in_arbeit_at: null, vollzugsmeldung: null,
  abgenommen_at: null, abgenommen_von_id: null, etb_anordnung_id: 5, erstellt_von_id: 1,
  erstellt_at: '2026-06-11 09:00:00', vollzug_status: 'offen', vollzogen_at: null, vollzogen_von_id: null,
  empfaenger_anzahl: 1, quittiert_anzahl: 0, ist_ueberfaellig: false, bearbeitungsstatus: 'offen',
  empfaenger: [{ id: 1, auftrag_id: 1, empfaenger_typ: 'funktion', abschnitt_id: null, einheit_id: null, person_id: null, fahrzeug_id: null, funktion_text: 'EA Nord', snap_anzeige: 'EA Nord', quittiert_at: null, quittiert_von_id: null }],
  ...over,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AntApp>
        <MemoryRouter initialEntries={['/einsaetze/1/auftraege']}>
          <Routes><Route path="/einsaetze/:id/auftraege" element={<AuftraegePage />} /></Routes>
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>,
  );
}

describe('AuftraegePage', () => {
  beforeEach(() => { vi.clearAllMocks(); listeAuftraege.mockResolvedValue([auftrag()]); });

  it('zeigt Aufträge mit Quittierungs-Stand', async () => {
    renderPage();
    expect(await screen.findByText('Deich sichern')).toBeInTheDocument();
    expect(screen.getByText('Quittiert 0/1')).toBeInTheDocument();
  });

  it('markiert überfällige Aufträge', async () => {
    listeAuftraege.mockResolvedValue([auftrag({ ist_ueberfaellig: true, frist_at: '2026-06-11 08:00:00' })]);
    renderPage();
    expect(await screen.findByText('Überfällig')).toBeInTheDocument();
  });

  it('legt einen Auftrag an (Empfänger + Text Pflicht)', async () => {
    legeAuftragAn.mockResolvedValue(auftrag());
    renderPage();
    await screen.findByText('Deich sichern');
    await userEvent.type(screen.getByPlaceholderText('z. B. S3, Fachberater'), 'EA Nord');
    // textbox[0] = Funktions-Freitext-Input, textbox[1] = "Auftrag / Was"-TextArea.
    // (Der Empfänger-Filter der Seite ist ein combobox, kein textbox.)
    const textareas = screen.getAllByRole('textbox');
    await userEvent.type(textareas[1], 'Erkunden');
    await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));
    await waitFor(() => expect(legeAuftragAn).toHaveBeenCalledWith(1, expect.objectContaining({
      auftrag_text: 'Erkunden',
      empfaenger: [{ empfaenger_typ: 'funktion', funktion_text: 'EA Nord' }],
    })));
  });

  it('quittiert einen Empfänger', async () => {
    quittiereEmpfaenger.mockResolvedValue(auftrag());
    renderPage();
    await screen.findByText('Deich sichern');
    await userEvent.click(screen.getByText('quittieren'));
    await waitFor(() => expect(quittiereEmpfaenger).toHaveBeenCalledWith(1, 1, 1));
  });

  it('meldet Vollzug über das Modal', async () => {
    setzeVollzug.mockResolvedValue(auftrag({ bearbeitungsstatus: 'vollzogen' }));
    renderPage();
    await screen.findByText('Deich sichern');
    await userEvent.click(screen.getByText('Vollzug melden'));
    await userEvent.type(screen.getByPlaceholderText('Rückmeldung zur Erledigung'), 'Deich gehalten');
    await userEvent.click(screen.getByRole('button', { name: 'Vollzug melden' }));
    await waitFor(() => expect(setzeVollzug).toHaveBeenCalledWith(1, 1, 'vollzogen', 'Deich gehalten'));
  });

  it('filtert nach Status', async () => {
    renderPage();
    await screen.findByText('Deich sichern');
    // 'Vollzogen' erscheint nur im Segmented (Default-Auftrag ist 'offen') → eindeutig.
    await userEvent.click(screen.getByText('Vollzogen'));
    await waitFor(() => expect(listeAuftraege).toHaveBeenCalledWith(1, {
      status: 'vollzogen', abschnittId: undefined, einheitId: undefined,
    }));
  });

  it('setzt einen offenen Auftrag auf „In Bearbeitung"', async () => {
    listeAuftraege.mockResolvedValue([auftrag({ bearbeitungsstatus: 'offen' })]);
    setzeVollzug.mockResolvedValue(auftrag({ bearbeitungsstatus: 'in_arbeit' }));
    renderPage();
    await screen.findByText('Deich sichern');
    // 'In Bearbeitung' kommt auch im Segmented vor → über den Action-<a> eindeutig.
    await userEvent.click(screen.getByText('In Bearbeitung', { selector: 'a' }));
    await waitFor(() => expect(setzeVollzug).toHaveBeenCalledWith(1, 1, 'in_arbeit', undefined));
  });

  it('nimmt einen vollzogenen Auftrag ab', async () => {
    listeAuftraege.mockResolvedValue([auftrag({ bearbeitungsstatus: 'vollzogen' })]);
    nimmAb.mockResolvedValue(auftrag({ bearbeitungsstatus: 'abgenommen' }));
    renderPage();
    await screen.findByText('Deich sichern');
    await userEvent.click(screen.getByText('Abnehmen'));
    await waitFor(() => expect(nimmAb).toHaveBeenCalledWith(1, 1));
  });

  it('Beobachter sieht Aufträge, aber keine Schreib-Aktionen', async () => {
    // Einmaliger Override: clearAllMocks setzt nur Call-Records, nicht Implementierungen zurück.
    vi.mocked(ladeEinsatz).mockResolvedValueOnce({
      id: 1, bezeichnung: 'Lage', status: 'aktiv', meine_rolle: 'beobachter',
    } as Awaited<ReturnType<typeof ladeEinsatz>>);
    renderPage();
    expect(await screen.findByText('Deich sichern')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Auftrag erteilen' })).not.toBeInTheDocument();
    expect(screen.queryByText('quittieren')).not.toBeInTheDocument();
  });
});
