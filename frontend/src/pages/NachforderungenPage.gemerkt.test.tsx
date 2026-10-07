import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import type { ComponentProps } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router';
import NachforderungenPage from './NachforderungenPage';
import { AuthProvider } from '../auth/AuthContext';
import { einsatzKeys } from '../api/queryKeys';
import type { Nachforderung } from '../api/types';

/**
 * Gemerktes Rendern der Nachforderungen (LFH-949, D7): ein Live-Ereignis mit einer geänderten
 * Nachforderung rendert nur deren Karte. Gezählt wird über `KommKarte`.
 */
const gezeichnet = vi.hoisted(() => vi.fn());
vi.mock('../kommunikation/KommKarte', async (original) => {
  const echt = await original<typeof import('../kommunikation/KommKarte')>();
  const Echt = echt.default;
  return {
    ...echt,
    default: (props: ComponentProps<typeof Echt>) => {
      gezeichnet();
      return <Echt {...props} />;
    },
  };
});

vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn().mockResolvedValue({
    id: 1,
    bezeichnung: 'Lage',
    status: 'aktiv',
    meine_rolle: 'einsatzleitung',
  }),
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
  id: 1,
  einsatz_id: 1,
  art: 'RTW',
  bezeichnung: '2 RTW zur Verstärkung',
  anzahl: 2,
  adressat_kategorie: 'leitstelle',
  adressat_bezeichnung: 'Leitstelle Nord',
  begruendung: null,
  prioritaet: 'dringend',
  status: 'angefordert',
  zugesagt_at: null,
  unterwegs_at: null,
  eingetroffen_at: null,
  abgelehnt_at: null,
  abgelehnt_grund: null,
  angefordert_at: '2026-06-12 09:00:00',
  etb_nachforderung_id: 7,
  erstellt_von_id: 1,
  erstellt_at: '2026-06-12 09:00:00',
  erstellt_von_name: 'Leit',
  ist_offen: true,
  ...over,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AntApp>
        <AuthProvider>
          <MemoryRouter initialEntries={['/einsaetze/1/nachforderungen']}>
            <Routes>
              <Route path="/einsaetze/:id/nachforderungen" element={<NachforderungenPage />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </AntApp>
    </QueryClientProvider>,
  );
  return client;
}

describe('NachforderungenPage rendert gemerkt (LFH-949)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('eine geänderte Nachforderung rendert nur ihre Karte', async () => {
    const zehn = Array.from({ length: 10 }, (_, i) =>
      nf({ id: i + 1, bezeichnung: `Bedarf ${i + 1}` }),
    );
    listeNachforderungen.mockResolvedValue(zehn);
    const client = renderPage();
    await screen.findByText('Bedarf 10');
    gezeichnet.mockClear();
    act(() => {
      client.setQueryData(
        einsatzKeys.nachforderungen(1),
        zehn.map((n) => (n.id === 4 ? { ...n, bezeichnung: 'Geändert' } : n)),
      );
    });
    expect(await screen.findByText('Geändert')).toBeInTheDocument();
    expect(gezeichnet).toHaveBeenCalledTimes(1);
  });
});
