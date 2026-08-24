import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Route, Routes } from 'react-router';
import { renderMitProviders } from '../../test/utils';
import EinsatzAufbewahrung from './EinsatzAufbewahrung';

/**
 * Sektion „Aufbewahrung & Archiv" (LFH-345 · C10) — die Sektion mit dem GRÖSSTEN Risiko und
 * deshalb dem vollständigsten Payload-Test: EIN Feld geht hinein, siebzehn kommen aus der
 * Merge-Basis. Nullte der Merge, fiele es genau hier auf.
 *
 * Die fachlichen Aussagen stammen aus dem Bestandstest von `EinsatzEinstellungenPage`
 * (LFH-135, Task 15) und sind unverändert gültig.
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

/** Bewusst durchweg NICHT-null: ein Payload-Vergleich gegen lauter null wäre auch dann grün,
 *  wenn der Merge Felder verlöre (fehlender Key liest sich in Vitest wie `undefined`). */
const VOLL = {
  einsatz_id: 1,
  standard_modul: 'etb',
  basemap_modus: 'offline',
  karten_zoom_start: 12,
  fachebenen_sichtbar: { nina: true, dwd: false, pegelonline: false, kritis: false },
  zeitzone: 'Europe/Berlin',
  zeitformat: '12h',
  einheiten: 'imperial',
  koordinatenformat: 'mgrs',
  etb_nummer_praefix: 'EB-',
  etb_nummer_start: 100,
  meldung_nummer_praefix: 'M-',
  meldung_nummer_start: 200,
  auftrag_nummer_praefix: 'A-',
  auftrag_nummer_start: 300,
  meldung_bestaetigung_frist_min: 30,
  auftrag_quittierung_frist_min: 45,
  auto_etb_eintraege: 0,
  etb_nummer_eingefroren: false,
  meldung_nummer_eingefroren: false,
  auftrag_nummer_eingefroren: false,
  retention_dauer_tage: 365,
  org_defaults: { org_id: 1 },
  geaendert_at: null,
  geaendert_von: null,
};

function rendern() {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/einstellungen/aufbewahrung" element={<EinsatzAufbewahrung />} />
    </Routes>,
    { route: '/einsaetze/1/einstellungen/aufbewahrung' },
  );
}

describe('EinsatzAufbewahrung', () => {
  beforeEach(() => {
    vi.mocked(ladeEinsatz).mockResolvedValue({
      id: 1,
      bezeichnung: 'Lage',
      status: 'aktiv',
      meine_rolle: 'einsatzleitung',
    } as never);
    vi.mocked(ladeEinstellungen).mockResolvedValue(VOLL as never);
    vi.mocked(speichereEinstellungen).mockResolvedValue({} as never);
    benutzerRolle.wert = 'admin';
  });

  it('zeigt die Aufbewahrungs-Dauer vor und sendet sie im Payload (LFH-135)', async () => {
    rendern();

    expect(await screen.findByText('Aufbewahrung & Archiv')).toBeInTheDocument();
    expect((screen.getByLabelText('Aufbewahrungs-Dauer (Tage)') as HTMLInputElement).value).toBe(
      '365',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(speichereEinstellungen).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ retention_dauer_tage: 365 }),
      ),
    );
  });

  /**
   * DER Regressionstest des ganzen Umbaus (H15/M15). Der PUT ist Vollersatz: eine Sektion
   * mit einem einzigen Feld muss siebzehn fremde Werte mitschicken. Fehlte einer, verlöre
   * der Datensatz ihn beim Speichern hier — stumm, ohne roten Test und ohne Fehlerbild.
   * Deshalb der volle Objekt-Vergleich statt `objectContaining`: nur er sieht ein Feld, das
   * gar nicht erst im Payload steht.
   */
  it('schickt beim Speichern den VOLLEN Payload — alle 18 Felder (Vollersatz-PUT)', async () => {
    rendern();
    fireEvent.click(await screen.findByRole('button', { name: 'Speichern' }));

    await waitFor(() =>
      expect(speichereEinstellungen).toHaveBeenCalledWith(1, {
        standard_modul: 'etb',
        // Karten-Defaults leben seit LFH-319 auf der Lagekarte und sind in KEINER Sektion
        // sichtbar — sie fahren nur über die Merge-Basis mit.
        basemap_modus: 'offline',
        karten_zoom_start: 12,
        fachebenen_sichtbar: { nina: true, dwd: false, pegelonline: false, kritis: false },
        zeitzone: 'Europe/Berlin',
        zeitformat: '12h',
        einheiten: 'imperial',
        koordinatenformat: 'mgrs',
        etb_nummer_praefix: 'EB-',
        etb_nummer_start: 100,
        meldung_nummer_praefix: 'M-',
        meldung_nummer_start: 200,
        auftrag_nummer_praefix: 'A-',
        auftrag_nummer_start: 300,
        meldung_bestaetigung_frist_min: 30,
        auftrag_quittierung_frist_min: 45,
        auto_etb_eintraege: false,
        retention_dauer_tage: 365,
      }),
    );
  });

  it('haelt „erbt Org-Standard" auch beim Speichern DIESER Sektion als null fest', async () => {
    // Die Einsatz-Ebene ist dreiwertig. Würde die Merge-Basis die zweiwertige Org-Formel
    // benutzen, verwandelte ein Speichern hier ein geerbtes „erbt Org" in ein explizites „An".
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      ...VOLL,
      auto_etb_eintraege: null,
    } as never);

    rendern();
    fireEvent.click(await screen.findByRole('button', { name: 'Speichern' }));

    await waitFor(() =>
      expect(speichereEinstellungen).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ auto_etb_eintraege: null }),
      ),
    );
  });

  it('deaktiviert das Aufbewahrungs-Feld bei abgeschlossenem Einsatz (LFH-135)', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue({
      id: 1,
      bezeichnung: 'Lage',
      status: 'abgeschlossen',
      meine_rolle: 'einsatzleitung',
    } as never);

    rendern();

    expect(await screen.findByLabelText('Aufbewahrungs-Dauer (Tage)')).toBeDisabled();
  });

  it('zeigt den Org-Standard-Hinweis und sendet trotzdem null, wenn das Feld leer ist', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      ...VOLL,
      retention_dauer_tage: null,
      org_defaults: { org_id: 1, retention_dauer_tage: 365 },
    } as never);

    rendern();

    expect(await screen.findByText('Standard (Org): 365 Tage')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(speichereEinstellungen).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ retention_dauer_tage: null }),
      ),
    );
  });

  it('haelt den Speichern-Knopf IM Formular (Erfassungs-Norm B4/LFH-332)', async () => {
    rendern();

    const knopf = await screen.findByRole('button', { name: 'Speichern' });
    expect(knopf.closest('form')).not.toBeNull();
    expect(knopf).toHaveAttribute('type', 'submit');
  });
});
