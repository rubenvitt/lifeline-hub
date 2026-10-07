import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import type { ComponentProps } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router';
import AuftraegePage from './AuftraegePage';
import type { Auftrag } from '../api/types';
import { einsatzKeys } from '../api/queryKeys';

/**
 * Große Auftragsmengen (LFH-949, D6): ein Live-Ereignis mit einem geänderten Auftrag rendert eine
 * Karte, die Abgeschlossen-Ansicht rendert ab 51 Aufträgen nur ihren Ausschnitt, und `?auftrag=`
 * holt auch einen Auftrag weit unten ins Bild. Gezählt wird über `KommKarte`.
 */

const gezeichnet = vi.hoisted(() => vi.fn<(id: number) => void>());
vi.mock('../kommunikation/KommKarte', async (original) => {
  const echt = await original<typeof import('../kommunikation/KommKarte')>();
  const Echt = echt.default;
  return {
    ...echt,
    default: (props: ComponentProps<typeof Echt> & { 'data-auftrag-id'?: number }) => {
      gezeichnet(props['data-auftrag-id'] ?? -1);
      return <Echt {...props} />;
    },
  };
});

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
vi.mock('../api/auftraege', () => ({
  listeAuftraege: (...a: unknown[]) => listeAuftraege(...a),
  legeAuftragAn: vi.fn(),
  quittiereEmpfaenger: vi.fn(),
  setzeVollzug: vi.fn(),
  nimmAb: vi.fn(),
}));

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

/** Abgenommen, absteigend nach Abnahmezeit: Auftrag 1 steht oben. */
const abgenommen = (id: number) =>
  auftrag(id, {
    bearbeitungsstatus: 'abgenommen',
    abgenommen_at: `2026-06-11 ${String(23 - Math.floor(id / 60)).padStart(2, '0')}:${String(59 - (id % 60)).padStart(2, '0')}:00`,
  });

function renderPage(route = '/einsaetze/1/auftraege') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ergebnis = render(
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
  return { ...ergebnis, client };
}

const karten = () => document.querySelectorAll('[data-auftrag-id]');

describe('Auftragsboard mit großen Mengen (LFH-949)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ein geänderter Auftrag rendert nur seine Karte', async () => {
    const zehn = Array.from({ length: 10 }, (_, i) => auftrag(i + 1));
    listeAuftraege.mockResolvedValue(zehn);
    const { client } = renderPage();
    await screen.findByText('Auftrag 10');
    gezeichnet.mockClear();
    act(() => {
      client.setQueryData(
        einsatzKeys.auftraegeListe(1, 'alle', 'alle'),
        zehn.map((a) => (a.id === 4 ? { ...a, auftrag_text: 'Geändert' } : a)),
      );
    });
    expect(await screen.findByText('Geändert')).toBeInTheDocument();
    expect(new Set(gezeichnet.mock.calls.map(([id]) => id))).toEqual(new Set([4]));
  });

  it('Abgeschlossen mit 120 Aufträgen rendert nur den Ausschnitt', async () => {
    listeAuftraege.mockResolvedValue(Array.from({ length: 120 }, (_, i) => abgenommen(i + 1)));
    renderPage('/einsaetze/1/auftraege?auftrag=1');
    await screen.findByText('Auftrag 1');
    expect(karten().length).toBeGreaterThan(0);
    expect(karten().length).toBeLessThan(120);
    expect(document.querySelectorAll('[data-lfh="auftraege-platzhalter"]')).toHaveLength(2);
  });

  it('bis 50 abgeschlossene Aufträge stehen alle da', async () => {
    listeAuftraege.mockResolvedValue(Array.from({ length: 50 }, (_, i) => abgenommen(i + 1)));
    renderPage('/einsaetze/1/auftraege?auftrag=1');
    await screen.findByText('Auftrag 1');
    expect(karten()).toHaveLength(50);
    expect(document.querySelectorAll('[data-lfh="auftraege-platzhalter"]')).toHaveLength(0);
  });

  it('?auftrag= auf den 100. abgeschlossenen rendert und markiert ihn', async () => {
    listeAuftraege.mockResolvedValue(Array.from({ length: 120 }, (_, i) => abgenommen(i + 1)));
    renderPage('/einsaetze/1/auftraege?auftrag=100');
    await screen.findByText('Auftrag 100');
    await waitFor(() =>
      expect(document.querySelector('[data-auftrag-id="100"]')).toHaveAttribute(
        'data-hervorgehoben',
        'true',
      ),
    );
    expect(document.querySelector('[data-auftrag-id="1"]')).toBeNull();
  });
});
