import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Route, Routes } from 'react-router';
import { renderMitProviders } from '../../test/utils';
import EinsatzVerhalten from './EinsatzVerhalten';

/**
 * Sektion „Verhalten & Automatik" (LFH-345 · C10). Die fachlichen Aussagen stammen aus dem
 * Bestandstest von `EinsatzEinstellungenPage` (LFH-133, Task 15, Finding E) und sind
 * unverändert gültig.
 */

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
      <Route path="/einsaetze/:id/einstellungen/verhalten" element={<EinsatzVerhalten />} />
    </Routes>,
    { route: '/einsaetze/1/einstellungen/verhalten' },
  );
}

describe('EinsatzVerhalten', () => {
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

  it('zeigt die Verhalten-Felder vor und sendet sie im Payload (LFH-133)', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      ...BASIS,
      etb_nummer_praefix: 'EB-',
      etb_nummer_start: 100,
      meldung_bestaetigung_frist_min: 30,
      auftrag_quittierung_frist_min: 45,
      auto_etb_eintraege: 0,
    } as never);

    rendern();

    expect(await screen.findByText('Verhalten & Automatik')).toBeInTheDocument();
    expect((screen.getByLabelText('Präfix ETB') as HTMLInputElement).value).toBe('EB-');

    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(speichereEinstellungen).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          etb_nummer_praefix: 'EB-',
          etb_nummer_start: 100,
          meldung_bestaetigung_frist_min: 30,
          auftrag_quittierung_frist_min: 45,
          // auto_etb_eintraege: 0 im Datensatz → Select „Aus" → false im Payload.
          auto_etb_eintraege: false,
        }),
      ),
    );
  });

  it('sperrt Praefix/Startwert eines eingefrorenen Nummernkreises (LFH-133)', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      ...BASIS,
      etb_nummer_eingefroren: true,
    } as never);

    rendern();

    // ETB-Kreis eingefroren → Präfix-Feld disabled; Auftrags-Kreis frei → editierbar.
    expect(await screen.findByLabelText('Präfix ETB')).toBeDisabled();
    expect(screen.getByLabelText('Präfix Aufträge')).toBeEnabled();
  });

  it('erbt den Org-Standard fuer auto_etb (einsatz=null) → Payload null', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      ...BASIS,
      auto_etb_eintraege: null,
      org_defaults: { org_id: 1, auto_etb_eintraege: 0 },
    } as never);

    rendern();

    expect(await screen.findByText('Standard (Org): Aus')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(speichereEinstellungen).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ auto_etb_eintraege: null }),
      ),
    );
  });

  it('zeigt die Org-Standard-Hinweise dieser Sektion und sendet trotzdem null', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      ...BASIS,
      org_defaults: {
        org_id: 1,
        etb_nummer_praefix: 'EB-',
        meldung_nummer_praefix: 'ME-',
        auftrag_nummer_praefix: 'AU-',
        meldung_bestaetigung_frist_min: 30,
        auftrag_quittierung_frist_min: 60,
        auto_etb_eintraege: 1,
      },
    } as never);

    rendern();

    expect(await screen.findByText('Standard (Org): EB-')).toBeInTheDocument();
    expect(screen.getByText('Standard (Org): 30 Min.')).toBeInTheDocument();
    expect(screen.getByText('Standard (Org): 60 Min.')).toBeInTheDocument();
    expect(screen.getByText('Standard (Org): An')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(speichereEinstellungen).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          etb_nummer_praefix: null,
          meldung_bestaetigung_frist_min: null,
          auftrag_quittierung_frist_min: null,
        }),
      ),
    );
  });

  it('laesst die fremden Sektionen als Bestandswert mitfahren (Vollersatz-PUT)', async () => {
    // Die Aussage, die den ganzen Umbau trägt: Speichern HIER darf die Aufbewahrungsfrist,
    // das Standard-Modul und die Karten-Defaults nicht nullen.
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      ...BASIS,
      standard_modul: 'etb',
      basemap_modus: 'offline',
      karten_zoom_start: 12,
      retention_dauer_tage: 365,
      zeitzone: 'Europe/Berlin',
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
          retention_dauer_tage: 365,
          zeitzone: 'Europe/Berlin',
        }),
      ),
    );
  });

  /**
   * Der Tastaturvertrag der Erfassungs-Norm (B4/LFH-332), hier per Tastendruck belegt statt
   * nur strukturell: diese Sektion hat echte `Input`-Felder. Auf „Allgemein" geht das nicht —
   * `@rc-component/select` verschluckt jedes Enter mit `preventDefault()`.
   */
  it('sendet bei Enter im Praefix-Feld ab (der Knopf liegt im <form>)', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue(BASIS as never);

    rendern();

    const feld = await screen.findByLabelText('Präfix ETB');
    await userEvent.type(feld, 'EB-{Enter}');

    await waitFor(() =>
      expect(speichereEinstellungen).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ etb_nummer_praefix: 'EB-' }),
      ),
    );
  });
});
