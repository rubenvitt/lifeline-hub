import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import LageberichtDetailPage from './LageberichtDetailPage';
import { AuthProvider } from '../auth/AuthContext';
import * as einsaetzeApi from '../api/einsaetze';
import * as lageberichteApi from '../api/lageberichte';
import { EinsatzAnzeigeProvider } from '../anzeige/AnzeigeKonventionenContext';
import { einsatzKeys } from '../api/queryKeys';
import { ApiError } from '../api/client';

vi.mock('../api/einsaetze');
vi.mock('../api/lageberichte');

function bericht(over: Record<string, unknown> = {}) {
  return {
    id: 9,
    einsatz_id: 1,
    vorlage: 'lagebericht',
    titel: 'Lage 1',
    zeitstand: '2026-06-02 10:00:00',
    status: 'freigegeben',
    abschnitte: [],
    version: 1,
    vorgaenger_id: null,
    ersteller_id: 1,
    ersteller_name: 'EL',
    erstellt_at: '',
    aktualisiert_at: '',
    freigegeben_von_id: 1,
    freigegeben_von_name: 'EL',
    freigegeben_at: '2026-06-02 11:00:00',
    etb_eintrag_id: 5,
    ...over,
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
    vi.mocked(einsaetzeApi.ladeEinsatz).mockResolvedValue({
      id: 1,
      status: 'aktiv',
      meine_rolle: 'einsatzleitung',
      bezeichnung: 'Übung',
    } as never);
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
    vi.mocked(einsaetzeApi.ladeEinsatz).mockResolvedValue({
      id: 1,
      status: 'aktiv',
      meine_rolle: 'einsatzleitung',
      bezeichnung: 'Übung',
    } as never);
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
    einsatz_id: 1,
    zeitzone: 'Europe/Berlin',
    org_defaults: { org_id: 1 },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <AuthProvider>
          <EinsatzAnzeigeProvider einsatzId={1}>
            <MemoryRouter initialEntries={[route]}>
              <Routes>
                <Route
                  path="/einsaetze/:id/lageberichte/:lbId"
                  element={<LageberichtDetailPage />}
                />
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
    vi.mocked(einsaetzeApi.ladeEinsatz).mockResolvedValue({
      id: 1,
      status: 'aktiv',
      meine_rolle: 'einsatzleitung',
      bezeichnung: 'Übung',
    } as never);
    vi.mocked(einsaetzeApi.ladeEinstellungen).mockResolvedValue({
      einsatz_id: 1,
      zeitzone: 'Europe/Berlin',
      org_defaults: { org_id: 1 },
    } as never);
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

/**
 * ── GESCHEITERTE FREIGABE (LFH-535, Nachzug N5 aus LFH-348 · C13) ──────────────
 *
 * Der Zwilling zu `BefehlDetailPage.test.tsx`. Die Bedienentscheidung gilt ausdrücklich
 * für BEIDE Seiten gemeinsam — sonst entsteht wieder die Divergenz, die LFH-348 · C13 mit
 * dem geteilten Verlustschutz-Hook geschlossen hat; Träger ist hier die geteilte
 * Komponente `entwurf/FreigabeDialog.tsx`.
 *
 * Die Zusicherung hat zwei Hälften: der Grund steht IM Dialog UND nicht in der
 * Message-Queue. Ohne die zweite bliebe der Test grün, wenn der Toast zurückkäme.
 */
describe('LageberichtDetailPage — gescheiterte Freigabe (LFH-535)', () => {
  beforeEach(() => {
    vi.mocked(einsaetzeApi.ladeEinsatz).mockResolvedValue({
      id: 1,
      status: 'aktiv',
      meine_rolle: 'einsatzleitung',
      bezeichnung: 'Übung',
    } as never);
    vi.mocked(lageberichteApi.ladeLagebericht).mockResolvedValue(
      bericht({ status: 'entwurf' }) as never,
    );
    vi.mocked(lageberichteApi.aktualisiereLagebericht).mockResolvedValue(
      bericht({ status: 'entwurf' }) as never,
    );
    // Die Suite fährt ohne `clearMocks`: der Zähler liefe sonst über die Tests dieser
    // Datei weiter, und „nicht aufgerufen" wäre nach dem ersten Test nie wieder grün.
    vi.mocked(lageberichteApi.gibLageberichtFrei).mockClear();
  });

  async function oeffneFreigabe() {
    renderBei('/einsaetze/1/lageberichte/9');
    await userEvent.click(await screen.findByRole('button', { name: 'Freigeben' }));
    return screen.findByRole('dialog', { name: 'Lagebericht freigeben?' });
  }

  /** Siehe `BefehlDetailPage.test.tsx` — dort steht die Begründung dieser Abfrage. */
  function toastsMit(wortlaut: string) {
    return [...document.querySelectorAll('.ant-message')].filter((n) =>
      n.textContent?.includes(wortlaut),
    );
  }

  it('zeigt den Grund IM Dialog statt im Toast und lässt ihn offen', async () => {
    vi.mocked(lageberichteApi.gibLageberichtFrei).mockRejectedValue(
      new ApiError(422, 'Abschnitt „Auftrag" ist leer'),
    );
    const dialog = await oeffneFreigabe();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Freigeben' }));

    const treffer = await within(dialog).findByText('Abschnitt „Auftrag" ist leer');
    expect(treffer.closest('.ant-message')).toBeNull();
    expect(toastsMit('Abschnitt „Auftrag" ist leer')).toHaveLength(0);
    expect(within(dialog).getByText('Freigabe fehlgeschlagen')).toBeInTheDocument();
    // „Offen" heisst in jsdom „nicht in der Verlassen-Bewegung": antds Modal räumt seinen
    // Knoten erst am Ende der Zoom-Animation ab, und jsdom feuert kein `transitionend`.
    expect(dialog).not.toHaveClass('ant-zoom-leave');
  });

  it('schliesst den Dialog bei gelungener Freigabe und quittiert per Toast (Gegenaussage)', async () => {
    vi.mocked(lageberichteApi.gibLageberichtFrei).mockResolvedValue(bericht() as never);
    const dialog = await oeffneFreigabe();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Freigeben' }));

    await waitFor(() => expect(dialog).toHaveClass('ant-zoom-leave'));
    expect(await screen.findByText('Bericht freigegeben')).toBeInTheDocument();
  });

  it('hält die Freigabe zurück, wenn schon der Speicher-Vorlauf scheitert', async () => {
    vi.mocked(lageberichteApi.aktualisiereLagebericht).mockRejectedValue(
      new ApiError(503, 'Dienst nicht erreichbar'),
    );
    const dialog = await oeffneFreigabe();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Freigeben' }));

    const treffer = await within(dialog).findByText('Dienst nicht erreichbar');
    expect(treffer.closest('.ant-message')).toBeNull();
    expect(toastsMit('Dienst nicht erreichbar')).toHaveLength(0);
    expect(within(dialog).getByText('Nicht gespeichert')).toBeInTheDocument();
    expect(lageberichteApi.gibLageberichtFrei).not.toHaveBeenCalled();
  });

  it('öffnet nach Abbrechen ohne den Grund des vorigen Versuchs', async () => {
    vi.mocked(lageberichteApi.gibLageberichtFrei).mockRejectedValue(
      new ApiError(422, 'Abschnitt „Auftrag" ist leer'),
    );
    const dialog = await oeffneFreigabe();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Freigeben' }));
    await within(dialog).findByText('Abschnitt „Auftrag" ist leer');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(dialog).toHaveClass('ant-zoom-leave'));
    await userEvent.click(screen.getByRole('button', { name: 'Freigeben' }));

    await waitFor(() => expect(dialog).not.toHaveClass('ant-zoom-leave'));
    expect(within(dialog).queryByText('Abschnitt „Auftrag" ist leer')).toBeNull();
  });
});
