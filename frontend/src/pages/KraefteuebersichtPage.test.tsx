import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { App as AntApp } from 'antd';
import KraefteuebersichtPage from './KraefteuebersichtPage';
import { ladeEinsatz } from '../api/einsaetze';
import { listeEinheiten } from '../api/einheiten';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { listeEinsatzMaterial } from '../api/einsatzMaterial';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { legeLageberichtAn, aktualisiereLagebericht } from '../api/lageberichte';
import type { EinsatzAnzeige } from '../api/types';

vi.mock('../api/einsaetze', () => ({ ladeEinsatz: vi.fn() }));
vi.mock('../api/einheiten', () => ({ listeEinheiten: vi.fn() }));
vi.mock('../api/einsatzPersonal', () => ({ listeEinsatzPersonal: vi.fn() }));
vi.mock('../api/einsatzFahrzeuge', () => ({ listeEinsatzFahrzeuge: vi.fn() }));
vi.mock('../api/einsatzMaterial', () => ({ listeEinsatzMaterial: vi.fn() }));
vi.mock('../api/einsatzabschnitte', () => ({ listeAbschnitte: vi.fn() }));
vi.mock('../live/useEinsatzLiveStream', () => ({ useEinsatzLiveStream: vi.fn() }));
vi.mock('../api/lageberichte', () => ({
  legeLageberichtAn: vi.fn(() => Promise.resolve({ id: 99 })),
  aktualisiereLagebericht: vi.fn(() => Promise.resolve({})),
}));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useNavigate: () => vi.fn() }));

// Nur die im Page genutzten Felder; Rest via Cast (Test-Fixture, kein echter Server-DTO).
const EINSATZ = { id: 1, bezeichnung: 'Testeinsatz', status: 'aktiv', meine_rolle: 'einsatzleitung' } as EinsatzAnzeige;

const PERSON_P1 = {
  id: 1, einsatz_id: 1, personal_id: null, einheit_id: null, fahrzeug_id: null, ist_adhoc: false,
  name: 'P1', funktion: null, traegerorganisation: null,
  staerke_position: 'mannschaft' as const, status_id: null,
  status_label: null, status_kategorie: 'gebunden' as const,
  status_farbe: null, bemerkung: null,
  disponiert_at: '2024-01-01T00:00:00', disponiert_von: null,
};

const ABSCHNITT_A1 = {
  id: 10, einsatz_id: 1, ueber_abschnitt_id: null,
  name: 'Abschnitt Nord',
  leiter_id: null, leiter_name: null, bemerkung: null, sortier: 1,
  flaeche_geojson: null, tz_fachaufgabe: null, tz_organisation: null,
  sprechgruppe_tmo: null, sprechgruppe_dmo: null, kommunikationsmittel: null, erreichbarkeit: null,
  sprechgruppen: [],
};

const EINHEIT_E10 = {
  id: 20, einsatz_id: 1, abschnitt_id: 10, abschnitt_name: 'Abschnitt Nord',
  ueber_einheit_id: null, typ_id: null, typ_label: null,
  name: '1. Zug', fuehrer_id: null, fuehrer_name: null,
  bemerkung: null, sortier: 1,
  soll: null,
  ist: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
  ist_kumuliert: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
  personal_mitglieder: [], fahrzeug_mitglieder: [], material_mitglieder: [],
  lat: null, lon: null, tz_fachaufgabe: null, tz_organisation: null,
  aktueller_br_id: null,
  sprechgruppen: [],
};

const FAHRZEUG_F1 = {
  id: 30, einsatz_id: 1, fahrzeug_id: null, einheit_id: 20,
  ist_adhoc: false, funkrufname: 'FW 1/44-1', kennzeichen: null,
  fahrzeugtyp: 'HLF 20', opta: null, traegerorganisation: null,
  status_id: null, status_label: null,
  status_kategorie: 'verfuegbar' as const,
  status_farbe: null, bemerkung: null,
  disponiert_at: '2024-01-01T00:00:00', disponiert_von: null,
  lat: null, lon: null, tz_fachaufgabe: null, tz_organisation: null,
  aktueller_br_id: null, soll_besatzung: null,
};

beforeEach(() => {
  vi.stubGlobal('print', vi.fn());
  vi.mocked(ladeEinsatz).mockResolvedValue(EINSATZ);
  vi.mocked(listeEinheiten).mockResolvedValue([]);
  vi.mocked(listeEinsatzPersonal).mockResolvedValue([]);
  vi.mocked(listeEinsatzFahrzeuge).mockResolvedValue([]);
  vi.mocked(listeEinsatzMaterial).mockResolvedValue([]);
  vi.mocked(listeAbschnitte).mockResolvedValue([]);
});

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <MemoryRouter initialEntries={['/einsaetze/1/kraefteuebersicht']}>
          <Routes><Route path="/einsaetze/:id/kraefteuebersicht" element={<KraefteuebersichtPage />} /></Routes>
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>,
  );
}

describe('KraefteuebersichtPage', () => {
  it('zeigt einen Druck-Button', async () => {
    setup();
    expect(await screen.findByRole('button', { name: /Drucken/i })).toBeInTheDocument();
  });

  it('zeigt Titel und die Gesamt-Personalstärke im Kopf', async () => {
    vi.mocked(listeEinsatzPersonal).mockResolvedValue([PERSON_P1]);
    setup();
    expect(await screen.findByRole('heading', { name: 'Kräfteübersicht' })).toBeInTheDocument();
    const statCard = screen.getByText('Gesamtstärke (F/UF/M//Ges)').closest('.ant-statistic')!;
    expect(await within(statCard as HTMLElement).findByText('0/0/1//1')).toBeInTheDocument();
  });

  it('rendert Abschnitt, Einheit und Einzelmittel als aufklappbare Zeilen', async () => {
    vi.mocked(listeAbschnitte).mockResolvedValue([ABSCHNITT_A1]);
    vi.mocked(listeEinheiten).mockResolvedValue([EINHEIT_E10]);
    vi.mocked(listeEinsatzFahrzeuge).mockResolvedValue([FAHRZEUG_F1]);
    const { container } = setup();
    // Abschnitt-Zeile muss sichtbar sein
    expect(await screen.findByText('Abschnitt Nord')).toBeInTheDocument();
    // Einheit-Zeile ist eingeklappt — Expand-Icon anklicken
    const expandIcon = container.querySelector('.ant-table-row-expand-icon-collapsed');
    expect(expandIcon).not.toBeNull();
    fireEvent.click(expandIcon!);
    expect(await screen.findByText('1. Zug')).toBeInTheDocument();
  });

  it('zeigt Fahrzeug-Verfügbarkeits-Achse im Kopf', async () => {
    vi.mocked(listeEinsatzFahrzeuge).mockResolvedValue([FAHRZEUG_F1]);
    setup();
    // Warten bis die Daten geladen sind
    const titelEl = await screen.findByText('Fzg frei');
    const statCard = titelEl.closest('.ant-statistic')!;
    expect(await within(statCard as HTMLElement).findByText('1')).toBeInTheDocument();
  });

  it('zeigt Filterleiste mit Trägerorganisation-Select', async () => {
    setup();
    // Filter bar renders after einsatzQuery resolves past the Spin early-return
    expect(await screen.findByText('Trägerorganisation')).toBeInTheDocument();
  });

  it('zeigt "In Lagebericht übernehmen" nur für Führungspersonal im aktiven Einsatz', async () => {
    // EINSATZ hat status:'aktiv' und meine_rolle:'einsatzleitung' → Button sichtbar
    setup();
    expect(await screen.findByRole('button', { name: /In Lagebericht übernehmen/i })).toBeInTheDocument();
  });

  it('versteckt "In Lagebericht übernehmen" für Beobachter', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue({ ...EINSATZ, meine_rolle: 'beobachter' } as EinsatzAnzeige);
    setup();
    // Wait for page to render past Spin
    await screen.findByRole('button', { name: /Drucken/i });
    expect(screen.queryByRole('button', { name: /In Lagebericht übernehmen/i })).toBeNull();
  });

  it('ruft legeLageberichtAn und aktualisiereLagebericht beim Klick auf Übernahme-Button auf', async () => {
    setup();
    const btn = await screen.findByRole('button', { name: /In Lagebericht übernehmen/i });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(vi.mocked(legeLageberichtAn)).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ vorlage: 'freitext' }),
      ),
    );
    await waitFor(() =>
      expect(vi.mocked(aktualisiereLagebericht)).toHaveBeenCalledWith(
        1,
        99,
        expect.objectContaining({
          abschnitte: expect.arrayContaining([
            expect.objectContaining({ schluessel: 'text' }),
          ]),
        }),
      ),
    );
  });
});
