import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Route, Routes } from 'react-router';
import { renderMitProviders } from '../../test/utils';
import EinsatzAllgemein from './EinsatzAllgemein';

/**
 * Sektion „Allgemein" (LFH-345 · C10). Die fachlichen Aussagen stammen aus dem
 * Bestandstest von `EinsatzEinstellungenPage` (LFH-131/136, Task 15) und sind unverändert
 * gültig — sie sind nur dorthin gezogen, wo die Felder jetzt wohnen.
 */

// Die Systemrolle ist umschaltbar, weil `darfImEinsatzSchreiben` einen System-Admin
// unabhaengig von `meine_rolle` durchlaesst — ein fest auf 'admin' verdrahteter Mock kann
// den Rechte-Hinweis also gar nicht ausloesen.
const { benutzerRolle } = vi.hoisted(() => ({ benutzerRolle: { wert: 'admin' } }));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ benutzer: { id: 1, system_rolle: benutzerRolle.wert } }),
  AuthProvider: ({ children }: { children?: unknown }) => children,
}));

vi.mock('../../api/einsaetze', () => ({
  ladeEinsatz: vi.fn(),
  ladeEinstellungen: vi.fn(),
  speichereEinstellungen: vi.fn(),
}));

import { ladeEinsatz, ladeEinstellungen, speichereEinstellungen } from '../../api/einsaetze';
import { ApiError } from '../../api/client';

const BASIS = {
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

function rendern() {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/einstellungen/allgemein" element={<EinsatzAllgemein />} />
    </Routes>,
    { route: '/einsaetze/1/einstellungen/allgemein' },
  );
}

describe('EinsatzAllgemein', () => {
  beforeEach(() => {
    vi.mocked(ladeEinsatz).mockResolvedValue({
      id: 1,
      bezeichnung: 'Lage',
      status: 'aktiv',
      meine_rolle: 'einsatzleitung',
    } as never);
    vi.mocked(speichereEinstellungen).mockResolvedValue({} as never);
    benutzerRolle.wert = 'admin';
  });

  it('zeigt die gespeicherten Werte (Default-Modul)', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      ...BASIS,
      standard_modul: 'etb',
      basemap_modus: 'offline',
      karten_zoom_start: 12,
      fachebenen_sichtbar: { nina: true, dwd: false, pegelonline: false, kritis: false },
    } as never);

    rendern();

    expect(await screen.findByText('Standard-Modul (Einstieg)')).toBeInTheDocument();
    // Karten-Defaults (Basemap/Fachebenen) sind seit LFH-319 aus dem Formular entfernt.
    expect(screen.queryByText('Karten-Defaults')).not.toBeInTheDocument();
    // Gewähltes Standard-Modul: das Select-Selection-Item trägt title="ETB".
    expect(screen.getByTitle('ETB')).toBeInTheDocument();
  });

  it('laesst die Karten-Defaults (basemap/fachebenen/zoom) als Bestandswert mitfahren (LFH-319)', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      ...BASIS,
      standard_modul: 'etb',
      basemap_modus: 'offline',
      karten_zoom_start: 12,
      fachebenen_sichtbar: { nina: true, dwd: false, pegelonline: false, kritis: false },
    } as never);

    rendern();
    fireEvent.click(await screen.findByRole('button', { name: 'Speichern' }));

    await waitFor(() =>
      expect(speichereEinstellungen).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          standard_modul: 'etb',
          basemap_modus: 'offline',
          karten_zoom_start: 12,
          fachebenen_sichtbar: { nina: true, dwd: false, pegelonline: false, kritis: false },
        }),
      ),
    );
  });

  it('zeigt die gespeicherten Anzeige-Konventionen vor und sendet sie im Payload (LFH-136)', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      ...BASIS,
      zeitzone: 'Europe/Berlin',
      zeitformat: '12h',
      einheiten: 'imperial',
      koordinatenformat: 'mgrs',
    } as never);

    rendern();

    expect(await screen.findByText('Anzeige-Konventionen')).toBeInTheDocument();
    expect(screen.getByTitle('12 Stunden (AM/PM)')).toBeInTheDocument();
    expect(screen.getByTitle('Imperial (ft, mi)')).toBeInTheDocument();
    expect(screen.getByTitle('MGRS')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(speichereEinstellungen).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          zeitzone: 'Europe/Berlin',
          zeitformat: '12h',
          einheiten: 'imperial',
          koordinatenformat: 'mgrs',
        }),
      ),
    );
  });

  it('zeigt Org-Standard-Hinweise bei leeren Einsatz-Feldern und sendet trotzdem null', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      ...BASIS,
      org_defaults: {
        org_id: 1,
        zeitzone: 'Europe/Berlin',
        zeitformat: '24h',
        einheiten: 'metrisch',
        koordinatenformat: 'wgs84',
      },
    } as never);

    rendern();

    expect(await screen.findByText('Standard (Org): Europe/Berlin')).toBeInTheDocument();
    expect(screen.getByText('Standard (Org): 24 Stunden')).toBeInTheDocument();
    expect(screen.getByText('Standard (Org): Metrisch (m, km)')).toBeInTheDocument();
    expect(screen.getByText('Standard (Org): WGS84 dezimal')).toBeInTheDocument();

    // Der Org-Default darf NICHT in den Payload fließen — leer bleibt null (das Backend löst auf).
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(speichereEinstellungen).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          zeitzone: null,
          zeitformat: null,
          einheiten: null,
          koordinatenformat: null,
        }),
      ),
    );
  });

  /**
   * „Enter sendet ab" ist auf DIESER Sektion nicht per Tastendruck belegbar: alle fünf
   * Felder sind `Select`/`AutoComplete`, und `@rc-component/select` ruft in
   * `BaseSelect/index.js:246` bei jedem Enter `preventDefault()`, solange der Modus nicht
   * `combobox` ist. Prüfbar ist die STRUKTUR, aus der die Zusicherung folgt — der
   * Absende-Knopf liegt im `<form>` (Muster `components/Erfassung.test.tsx`). Den
   * Tastendruck selbst belegen die Sektionen mit echten Eingabefeldern.
   */
  it('haelt den Speichern-Knopf IM Formular (Erfassungs-Norm B4/LFH-332)', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue(BASIS as never);

    rendern();

    const knopf = await screen.findByRole('button', { name: 'Speichern' });
    expect(knopf.closest('form')).not.toBeNull();
    expect(knopf).toHaveAttribute('type', 'submit');
  });

  it('erklaert das fehlende Recht, statt nur auszugrauen (M16)', async () => {
    benutzerRolle.wert = 'benutzer';
    vi.mocked(ladeEinsatz).mockResolvedValue({
      id: 1,
      bezeichnung: 'Lage',
      status: 'aktiv',
      meine_rolle: 'beobachter',
    } as never);
    vi.mocked(ladeEinstellungen).mockResolvedValue(BASIS as never);

    rendern();

    expect(await screen.findByText(/Nur die Einsatzleitung/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
  });

  it('nennt einen gescheiterten Speicherversuch dauerhaft auf der Seite (H14)', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue(BASIS as never);
    vi.mocked(speichereEinstellungen).mockRejectedValue(new ApiError(422, 'Zeitzone unbekannt'));

    rendern();
    fireEvent.click(await screen.findByRole('button', { name: 'Speichern' }));

    // Der Alert haengt an `mutation.error` und nicht an einer Toast-Queue mit eigener
    // Lebensdauer — er steht noch, wenn der Toast laengst weg waere.
    expect(await screen.findByText('Zeitzone unbekannt')).toBeInTheDocument();
    expect(screen.getByText('Nicht gespeichert')).toBeInTheDocument();
  });
});
