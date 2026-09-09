import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import LageberichtDetailPage from './LageberichtDetailPage';
import { AuthProvider } from '../auth/AuthContext';
import * as einsaetzeApi from '../api/einsaetze';
import * as lageberichteApi from '../api/lageberichte';
import { EinsatzAnzeigeProvider } from '../anzeige/AnzeigeKonventionenContext';
import { einsatzKeys } from '../api/queryKeys';

vi.mock('../api/einsaetze');
vi.mock('../api/lageberichte');

function bericht(over: Record<string, unknown> = {}) {
  return {
    id: 9, einsatz_id: 1, vorlage: 'lagebericht', titel: 'Lage 1', zeitstand: '2026-06-02 10:00:00',
    status: 'freigegeben', abschnitte: [], version: 1, vorgaenger_id: null, ersteller_id: 1,
    ersteller_name: 'EL', erstellt_at: '', aktualisiert_at: '', freigegeben_von_id: 1,
    freigegeben_von_name: 'EL', freigegeben_at: '2026-06-02 11:00:00', etb_eintrag_id: 5, ...over,
  };
}

function renderBei(route: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <AuthProvider>
          <MemoryRouter initialEntries={[route]}>
            <Routes>
              <Route path="/einsaetze/:id/lageberichte" element={<div>LB-LISTE</div>} />
              <Route path="/einsaetze/:id/lageberichte/:lbId" element={<LageberichtDetailPage />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </AntApp>
    </QueryClientProvider>,
  );
}

describe('LageberichtDetailPage — Deeplink-Robustheit (LFH-25)', () => {
  it('leitet bei ungültiger Lagebericht-ID auf die Liste um', async () => {
    renderBei('/einsaetze/1/lageberichte/abc');
    expect(await screen.findByText('LB-LISTE')).toBeInTheDocument();
  });

  it('verlinkt vom freigegebenen Lagebericht per ?eintrag= auf den ETB-Eintrag (LFH-25)', async () => {
    vi.mocked(einsaetzeApi.ladeEinsatz).mockResolvedValue(
      { id: 1, status: 'aktiv', meine_rolle: 'einsatzleitung', bezeichnung: 'Übung' } as never,
    );
    vi.mocked(lageberichteApi.ladeLagebericht).mockResolvedValue(bericht() as never);
    renderBei('/einsaetze/1/lageberichte/9');
    const link = await screen.findByRole('link', { name: /ETB-Eintrag/ });
    expect(link).toHaveAttribute('href', '/einsaetze/1/etb?eintrag=5');
  });

  /**
   * Der Kopf trägt die Phasenfarbe der gemeinsamen Achse, nicht das Preset-Grün
   * (LFH-493) — der Zwilling der Probe in `BefehlDetailPage.test.tsx`. Beide Module
   * liegen auf derselben Achse (`phase.ts`: „bewusst dieselbe … und nicht deren
   * Alias"); wer nur eines umstellt, hat die Divergenz bloß verschoben.
   */
  it('malt den freigegebenen Status in der Phasenfarbe, nicht im Preset-Grün', async () => {
    vi.mocked(einsaetzeApi.ladeEinsatz).mockResolvedValue(
      { id: 1, status: 'aktiv', meine_rolle: 'einsatzleitung', bezeichnung: 'Übung' } as never,
    );
    vi.mocked(lageberichteApi.ladeLagebericht).mockResolvedValue(bericht() as never);
    renderBei('/einsaetze/1/lageberichte/9');
    const etikett = (await screen.findByText('Freigegeben')).closest('.ant-tag');
    expect(etikett).toHaveClass('ant-tag-success');
    expect(etikett).not.toHaveClass('ant-tag-green');
  });
});

/**
 * ── ZEITSTAND IN DER ANZEIGEZONE (LFH-350 · H60) ────────────────────────────────
 *
 * `zeitstand` ist ein UTC-Wirestring OHNE Zonenkennung (`YYYY-MM-DD HH:mm:ss`). Roh
 * ausgegeben stand er um den Zonenversatz falsch — im Sommer zwei Stunden zu früh, und
 * zwar ohne Fehlerbild: die Zahl sieht plausibel aus.
 *
 * Die Zone wird AUSDRÜCKLICH gestellt und der Cache dafür VORBELEGT — beides ist gemessen
 * nötig: (1) ohne Provider fällt `useAnzeigeKonventionen` auf `DEFAULT_KONVENTIONEN` und
 * damit auf die LOKALE Zone der ausführenden Maschine zurück; (2) nur den Provider
 * einzuhängen genügt nicht, weil die Einstellungs-Abfrage ERST NACH dem ersten Render
 * auflöst — `findByText` hat dann längst getroffen, und auf einem Berliner Rechner wäre der
 * Test auch mit `zeitzone: 'UTC'` grün geblieben (Gegenprobe gefahren: 4 von 5 Tests
 * blieben es). `setQueryData` stellt die Zone vor dem ersten Render.
 */
function renderMitZone(route: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(einsatzKeys.einstellungen(1), {
    einsatz_id: 1, zeitzone: 'Europe/Berlin', org_defaults: { org_id: 1 },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <AuthProvider>
          <EinsatzAnzeigeProvider einsatzId={1}>
            <MemoryRouter initialEntries={[route]}>
              <Routes>
                <Route path="/einsaetze/:id/lageberichte/:lbId" element={<LageberichtDetailPage />} />
              </Routes>
            </MemoryRouter>
          </EinsatzAnzeigeProvider>
        </AuthProvider>
      </AntApp>
    </QueryClientProvider>,
  );
}

describe('LageberichtDetailPage — Zeitstand (LFH-350 · H60)', () => {
  it('zeigt die taktische DTG in der Anzeigezone, nicht den rohen UTC-Wirestring', async () => {
    vi.mocked(einsaetzeApi.ladeEinsatz).mockResolvedValue(
      { id: 1, status: 'aktiv', meine_rolle: 'einsatzleitung', bezeichnung: 'Übung' } as never,
    );
    vi.mocked(einsaetzeApi.ladeEinstellungen).mockResolvedValue(
      { einsatz_id: 1, zeitzone: 'Europe/Berlin', org_defaults: { org_id: 1 } } as never,
    );
    vi.mocked(lageberichteApi.ladeLagebericht).mockResolvedValue(
      bericht({ zeitstand: '2026-07-25 12:00:00' }) as never,
    );
    renderMitZone('/einsaetze/1/lageberichte/9');

    // 12:00 UTC → 14:00 Sommerzeit in Berlin → DDHHmm + Monatskürzel + Jahr.
    expect(await screen.findByText('Zeitstand: 251400JUL2026')).toBeInTheDocument();
    // Gegenaussage: der Wirestring darf nirgends mehr sichtbar sein.
    expect(screen.queryByText(/2026-07-25 12:00:00/)).toBeNull();
  });
});
