import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Route, Routes } from 'react-router';
import { renderMitProviders } from '../test/utils';
import EinsatzEinstellungenPage from './EinsatzEinstellungenPage';

/**
 * Layout-Tests der Sektions-Zerlegung. Die fachlichen Tests liegen in den vier Sektionsdateien
 * (`einstellungen/EinsatzAllgemein.test.tsx`, `…Verhalten…`, `…Aufbewahrung…`, `…Module…`); hier
 * bleibt, was das Layout zusichert: Tab-Band, Sektionswechsel, eingefrorener Einsatz.
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
        <Route path="pegel" element={<div>Sektionsinhalt Pegel</div>} />
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

  it('zeigt die fünf Sektionen als Reiter und den Inhalt der aktiven', async () => {
    rendern();

    expect(await screen.findByRole('tab', { name: 'Allgemein' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Verhalten & Automatik' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Aufbewahrung' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Module' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Pegel' })).toBeInTheDocument();
    expect(screen.getByText('Sektionsinhalt Allgemein')).toBeInTheDocument();
  });

  it('markiert die Sektion aus der URL, nicht einen eigenen Nav-Zustand', async () => {
    // Der aktive Reiter folgt dem Pfad — sonst zeigte ein Deeplink auf „Module" das Band mit
    // „Allgemein" markiert.
    rendern('/einsaetze/1/einstellungen/aufbewahrung');

    expect(
      await screen.findByRole('tab', { name: 'Aufbewahrung', selected: true }),
    ).toBeInTheDocument();
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
    // Die Speichern-Leiste steht sticky im `<form>` (nur so sendet Enter ab), nicht im Kopf-Slot.
    // Geprüft wird die Marke, die `EinsatzSeite` für diesen Zuschnitt setzt.
    const { container } = rendern();

    await screen.findByRole('tab', { name: 'Allgemein' });
    expect(container.querySelector('[data-lfh="seitenkopf-aktionen"]')).toBeNull();
  });
});
