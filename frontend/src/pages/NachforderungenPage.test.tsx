import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { MemoryRouter, Routes, Route } from 'react-router';
import NachforderungenPage from './NachforderungenPage';
import { AuthProvider } from '../auth/AuthContext';
import type { Nachforderung } from '../api/types';

vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn().mockResolvedValue({ id: 1, bezeichnung: 'Lage', status: 'aktiv', meine_rolle: 'einsatzleitung' }),
}));

const listeNachforderungen = vi.fn();
const legeNachforderungAn = vi.fn();
const setzeNachforderungStatus = vi.fn();
const lehneNachforderungAb = vi.fn();
vi.mock('../api/nachforderungen', () => ({
  listeNachforderungen: (...a: unknown[]) => listeNachforderungen(...a),
  legeNachforderungAn: (...a: unknown[]) => legeNachforderungAn(...a),
  setzeNachforderungStatus: (...a: unknown[]) => setzeNachforderungStatus(...a),
  lehneNachforderungAb: (...a: unknown[]) => lehneNachforderungAb(...a),
}));

const nf = (over: Partial<Nachforderung> = {}): Nachforderung => ({
  id: 1, einsatz_id: 1, art: 'RTW', bezeichnung: '2 RTW zur Verstärkung', anzahl: 2,
  adressat_kategorie: 'leitstelle', adressat_bezeichnung: 'Leitstelle Nord', begruendung: null,
  prioritaet: 'dringend', status: 'angefordert',
  zugesagt_at: null, unterwegs_at: null, eingetroffen_at: null, abgelehnt_at: null, abgelehnt_grund: null,
  angefordert_at: '2026-06-12 09:00:00', etb_nachforderung_id: 7, erstellt_von_id: 1,
  erstellt_at: '2026-06-12 09:00:00', erstellt_von_name: 'Leit', ist_offen: true, ...over,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AntApp>
        <AuthProvider>
          <MemoryRouter initialEntries={['/einsaetze/1/nachforderungen']}>
            <Routes><Route path="/einsaetze/:id/nachforderungen" element={<NachforderungenPage />} /></Routes>
          </MemoryRouter>
        </AuthProvider>
      </AntApp>
    </QueryClientProvider>,
  );
}

describe('NachforderungenPage', () => {
  beforeEach(() => { vi.clearAllMocks(); listeNachforderungen.mockResolvedValue([nf()]); });

  it('zeigt offene Nachforderungen', async () => {
    renderPage();
    expect(await screen.findByText('2 RTW zur Verstärkung')).toBeInTheDocument();
    expect(screen.getByText('Angefordert', { selector: '.ant-tag' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Datenstand \d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it('setzt eine Nachforderung ab', async () => {
    legeNachforderungAn.mockResolvedValue(nf());
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    // Formular liegt jetzt hinter dem Kopf-Toggle (LFH-112) → erst aufklappen.
    await userEvent.click(screen.getByRole('button', { name: /Nachforderung anlegen/ }));
    await userEvent.type(screen.getByLabelText('Art'), 'SEG');
    await userEvent.type(screen.getByLabelText('Bezeichnung'), 'Eine SEG');
    await userEvent.click(screen.getByRole('button', { name: 'Nachforderung absetzen' }));
    await waitFor(() => expect(legeNachforderungAn).toHaveBeenCalledWith(1, expect.objectContaining({
      art: 'SEG', bezeichnung: 'Eine SEG', adressat_kategorie: 'leitstelle',
    })));
  });

  it('schaltet den Status linear weiter (Popconfirm)', async () => {
    setzeNachforderungStatus.mockResolvedValue(nf({ status: 'zugesagt' }));
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    // Link-Button öffnet Popconfirm; erst nach Bestätigen wird geschaltet.
    await userEvent.click(screen.getByRole('button', { name: '→ Zugesagt' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Bestätigen' }));
    await waitFor(() => expect(setzeNachforderungStatus).toHaveBeenCalledWith(1, 1, 'zugesagt'));
  });

  it('lehnt eine Nachforderung mit Grund ab (über Dialog)', async () => {
    lehneNachforderungAb.mockResolvedValue(nf({ status: 'abgelehnt' }));
    renderPage();
    await screen.findByText('2 RTW zur Verstärkung');
    // Listen-Aktion „Ablehnen" (link-button) öffnet das Modal.
    await userEvent.click(screen.getByRole('button', { name: 'Ablehnen' }));
    // Dialog öffnet: Grund erfassen und bestätigen. „Ablehnen" existiert nun
    // doppelt (Listen-Aktion + Modal-OK) → im Dialog scopen.
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Ablehnungsgrund'), 'keine Reserven');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ablehnen' }));
    await waitFor(() => expect(lehneNachforderungAb).toHaveBeenCalledWith(1, 1, 'keine Reserven'));
  });

  it('trennt Offen und Abgeschlossen clientseitig', async () => {
    // Eine offene + eine eingetroffene Nachforderung in EINER Antwort (kein Status-Filter mehr).
    listeNachforderungen.mockResolvedValue([
      nf({ id: 1, bezeichnung: '2 RTW zur Verstärkung', status: 'angefordert', ist_offen: true }),
      nf({ id: 2, bezeichnung: 'Eingetroffene SEG', status: 'eingetroffen', ist_offen: false, eingetroffen_at: '2026-06-12 10:00:00' }),
    ]);
    renderPage();
    // Default = Offen: nur die offene ist sichtbar.
    expect(await screen.findByText('2 RTW zur Verstärkung')).toBeInTheDocument();
    expect(screen.queryByText('Eingetroffene SEG')).not.toBeInTheDocument();
    // Page lädt alle (ohne Status-Filter).
    expect(listeNachforderungen).toHaveBeenCalledWith(1, {});
    // Auf Abgeschlossen wechseln → eingetroffene erscheint, offene verschwindet.
    await userEvent.click(screen.getByText(/Abgeschlossen \(/));
    expect(await screen.findByText('Eingetroffene SEG')).toBeInTheDocument();
    expect(screen.queryByText('2 RTW zur Verstärkung')).not.toBeInTheDocument();
  });

  it('eingetroffene Nachforderung zeigt keine Aktionen', async () => {
    listeNachforderungen.mockResolvedValue([nf({ status: 'eingetroffen', ist_offen: false, eingetroffen_at: '2026-06-12 10:00:00' })]);
    renderPage();
    // Eingetroffen landet in der Abgeschlossen-Ansicht → dorthin wechseln.
    await userEvent.click(await screen.findByText(/Abgeschlossen \(/));
    await screen.findByText('2 RTW zur Verstärkung');
    expect(screen.queryByRole('button', { name: 'Ablehnen' })).not.toBeInTheDocument();
    expect(screen.getByText('Eingetroffen', { selector: '.ant-tag' })).toBeInTheDocument();
  });
});
