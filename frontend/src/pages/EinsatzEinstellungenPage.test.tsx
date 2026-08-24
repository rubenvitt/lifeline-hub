import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Route, Routes } from 'react-router';
import { renderMitProviders } from '../test/utils';
import EinsatzEinstellungenPage from './EinsatzEinstellungenPage';

/**
 * Layout-Tests der Sektions-Zerlegung (LFH-345 · C10, H15/M15).
 *
 * Die fachlichen Bestandstests dieser Seite sind NICHT verschwunden — sie sind auf die vier
 * Sektionsdateien gezogen (`einstellungen/EinsatzAllgemein.test.tsx`, `…Verhalten…`,
 * `…Aufbewahrung…`, `…Module…`) und dort unverändert gültig. Hier bleibt nur, was das Layout
 * selbst zusichert: das Tab-Band, der Sektionswechsel und der eingefrorene Einsatz.
 */

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ benutzer: { id: 1, system_rolle: 'admin' } }),
  AuthProvider: ({ children }: { children?: unknown }) => children,
}));

vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn(),
  ladeEinstellungen: vi.fn(),
}));

import { ladeEinsatz, ladeEinstellungen } from '../api/einsaetze';

const EINSTELLUNGEN = {
  einsatz_id: 1,
  standard_modul: null,
  basemap_modus: null,
  karten_zoom_start: null,
  fachebenen_sichtbar: null,
  zeitzone: null,
  zeitformat: null,
  einheiten: null,
  koordinatenformat: null,
  etb_nummer_praefix: null,
  etb_nummer_start: null,
  meldung_nummer_praefix: null,
  meldung_nummer_start: null,
  auftrag_nummer_praefix: null,
  auftrag_nummer_start: null,
  meldung_bestaetigung_frist_min: null,
  auftrag_quittierung_frist_min: null,
  auto_etb_eintraege: null,
  etb_nummer_eingefroren: false,
  meldung_nummer_eingefroren: false,
  auftrag_nummer_eingefroren: false,
  retention_dauer_tage: null,
  org_defaults: { org_id: 1 },
  geaendert_at: null,
  geaendert_von: null,
};

/** Rendert das Layout unter einer Sektionsroute; das Kind ist eine Attrappe für den Outlet. */
function rendern(route = '/einsaetze/1/einstellungen/allgemein') {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/einstellungen" element={<EinsatzEinstellungenPage />}>
        <Route path="allgemein" element={<div>Sektionsinhalt Allgemein</div>} />
        <Route path="verhalten" element={<div>Sektionsinhalt Verhalten</div>} />
        <Route path="aufbewahrung" element={<div>Sektionsinhalt Aufbewahrung</div>} />
        <Route path="module" element={<div>Sektionsinhalt Module</div>} />
      </Route>
    </Routes>,
    { route },
  );
}

describe('EinsatzEinstellungenPage (Sektions-Layout)', () => {
  beforeEach(() => {
    vi.mocked(ladeEinsatz).mockResolvedValue({
      id: 1,
      bezeichnung: 'Lage',
      status: 'aktiv',
      meine_rolle: 'einsatzleitung',
    } as never);
    vi.mocked(ladeEinstellungen).mockResolvedValue(EINSTELLUNGEN as never);
  });

  it('zeigt die vier Sektionen als Reiter und den Inhalt der aktiven', async () => {
    rendern();

    expect(await screen.findByRole('tab', { name: 'Allgemein' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Verhalten & Automatik' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Aufbewahrung' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Module' })).toBeInTheDocument();
    expect(screen.getByText('Sektionsinhalt Allgemein')).toBeInTheDocument();
  });

  it('markiert die Sektion aus der URL, nicht einen eigenen Nav-Zustand', async () => {
    // Der aktive Reiter folgt dem Pfad — sonst zeigte ein Deeplink auf „Module" das Band
    // mit „Allgemein" markiert, und der Bedienende hielte den Link für kaputt.
    rendern('/einsaetze/1/einstellungen/aufbewahrung');

    expect(await screen.findByRole('tab', { name: 'Aufbewahrung', selected: true })).toBeInTheDocument();
    expect(screen.getByText('Sektionsinhalt Aufbewahrung')).toBeInTheDocument();
  });

  it('navigiert beim Reiterklick auf die Sektions-Route', async () => {
    rendern();

    fireEvent.click(await screen.findByRole('tab', { name: 'Module' }));

    await waitFor(() => expect(screen.getByText('Sektionsinhalt Module')).toBeInTheDocument());
  });

  it('blendet einen Hinweis ein, wenn der Einsatz abgeschlossen ist', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue({
      id: 1,
      bezeichnung: 'Lage',
      status: 'abgeschlossen',
      meine_rolle: 'einsatzleitung',
    } as never);

    rendern();

    expect(await screen.findByText(/eingefroren/)).toBeInTheDocument();
  });

  it('laesst den Kopf-Aktionen-Slot leer — der Speichern-Knopf liegt im Formular', async () => {
    // Die Speichern-Leiste ist seit C10 sticky am unteren Rand IM `<form>` (Erfassungs-Norm
    // B4/LFH-332: nur so sendet Enter ab). Ein Knopf im Kopf-Slot wäre der alte Zustand —
    // geprüft wird die Marke, die `EinsatzSeite` für genau diesen Zuschnitt setzt.
    const { container } = rendern();

    await screen.findByRole('tab', { name: 'Allgemein' });
    expect(container.querySelector('[data-lfh="seitenkopf-aktionen"]')).toBeNull();
  });
});
