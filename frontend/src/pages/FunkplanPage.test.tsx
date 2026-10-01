import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route, useLocation } from 'react-router';
import { http, HttpResponse } from 'msw';
import { renderMitProviders } from '../test/utils';
import { server } from '../test/server';
import FunkplanPage from './FunkplanPage';
import { ladeEinsatz, ladeModulOverrides } from '../api/einsaetze';
import { listeEinheiten } from '../api/einheiten';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinsatzSprechgruppen } from '../api/sprechgruppen';
import { legeLageberichtAn } from '../api/lageberichte';
import { ApiError } from '../api/client';
import type {
  Einheit,
  EinsatzAnzeige,
  EinsatzFahrzeug,
  EinsatzPersonal,
  Einsatzabschnitt,
  Sprechgruppe,
} from '../api/types';

vi.mock('../api/einsaetze', () => ({ ladeEinsatz: vi.fn(), ladeModulOverrides: vi.fn() }));
vi.mock('../api/einheiten', () => ({ listeEinheiten: vi.fn() }));
vi.mock('../api/einsatzPersonal', () => ({ listeEinsatzPersonal: vi.fn() }));
vi.mock('../api/einsatzFahrzeuge', () => ({ listeEinsatzFahrzeuge: vi.fn() }));
vi.mock('../api/einsatzabschnitte', () => ({ listeAbschnitte: vi.fn() }));
vi.mock('../api/sprechgruppen', () => ({ listeEinsatzSprechgruppen: vi.fn() }));
vi.mock('../api/lageberichte', () => ({
  legeLageberichtAn: vi.fn(() => Promise.resolve({ id: 77 })),
}));
const { navigiere } = vi.hoisted(() => ({ navigiere: vi.fn() }));
vi.mock('react-router', async (orig) => ({ ...(await orig()), useNavigate: () => navigiere }));

const EINSATZ = {
  id: 1,
  bezeichnung: 'Hochwasser Nord',
  status: 'aktiv',
  meine_rolle: 'einsatzleitung',
} as EinsatzAnzeige;

function sg(
  id: number,
  betriebsart: 'TMO' | 'DMO',
  bezeichnung: string,
  lokal = false,
): Sprechgruppe {
  return { id, bezeichnung, betriebsart, aktiv: true, einsatz_lokal: lokal, sortier: id };
}

const ABSCHNITTE: Einsatzabschnitt[] = [
  {
    id: 1,
    einsatz_id: 1,
    name: 'Abschnitt Nord',
    kurzbezeichnung: 'EA-N',
    leiter_name: 'Anna Leiter',
    kommunikationsmittel: 'digitalfunk',
    erreichbarkeit: '0171 111',
    sortier: 1,
    sprechgruppen: [sg(1, 'TMO', 'TMO 311'), sg(2, 'DMO', 'DMO 505')],
  },
  { id: 2, einsatz_id: 1, name: 'Abschnitt Süd', sortier: 2, sprechgruppen: [] },
];

const EINHEITEN = [
  {
    id: 10,
    einsatz_id: 1,
    name: '1. Zug',
    funkrufname: 'Florian 1/10',
    fuehrer_name: 'Bernd Führer',
    abschnitt_id: 1,
    erreichbarkeit: '0160 GEHEIM',
    sortier: 1,
    sprechgruppen: [],
    fahrzeug_mitglieder: [],
    material_mitglieder: [],
    personal_mitglieder: [],
    ist: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
    ist_kumuliert: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
    status: { quelle: 'ohne', verteilung: [] },
  },
] as Einheit[];

const FAHRZEUGE: EinsatzFahrzeug[] = [
  {
    id: 100,
    einsatz_id: 1,
    einheit_id: 10,
    funkrufname: 'Florian 1/42-1',
    opta: 'FW-1-42-1',
    fahrzeugtyp: 'HLF 20',
    disponiert_at: '2026-09-30T10:00:00',
    ist_adhoc: false,
  },
  {
    id: 101,
    einsatz_id: 1,
    funkrufname: 'Florian ELW 1',
    disponiert_at: '2026-09-30T10:00:00',
    ist_adhoc: false,
  },
];

const PERSONAL: EinsatzPersonal[] = [
  {
    id: 1,
    einsatz_id: 1,
    name: 'Clara Führerin',
    fahrzeug_id: 100,
    staerke_position: 'fuehrer',
    disponiert_at: '2026-09-30T10:00:00',
    ist_adhoc: false,
  },
];

const SPRECHGRUPPEN = [
  sg(1, 'TMO', 'TMO 311'),
  sg(2, 'DMO', 'DMO 505'),
  sg(9, 'DMO', 'DMO 999', true),
];

beforeEach(() => {
  navigiere.mockReset();
  vi.mocked(legeLageberichtAn).mockClear();
  vi.mocked(ladeEinsatz).mockResolvedValue(EINSATZ);
  vi.mocked(ladeModulOverrides).mockResolvedValue({});
  vi.mocked(listeAbschnitte).mockResolvedValue(ABSCHNITTE);
  vi.mocked(listeEinheiten).mockResolvedValue(EINHEITEN);
  vi.mocked(listeEinsatzFahrzeuge).mockResolvedValue(FAHRZEUGE);
  vi.mocked(listeEinsatzPersonal).mockResolvedValue(PERSONAL);
  vi.mocked(listeEinsatzSprechgruppen).mockResolvedValue(SPRECHGRUPPEN);
});

function setup() {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/stab/funkplan" element={<FunkplanPage />} />
    </Routes>,
    { route: '/einsaetze/1/stab/funkplan' },
  );
}

const luecken = () => screen.getByRole('region', { name: 'Lücken' });
const lueckenZeile = (titel: string) =>
  within(luecken()).getByText(titel).closest('[data-lfh="funkplan-luecke"]') as HTMLElement;

describe('FunkplanPage — Tabelle', () => {
  it('zeigt den Baum als Tabelle mit menschenlesbarer Stelle und allen Funkspalten', async () => {
    const { container } = setup();
    expect(await screen.findByRole('heading', { level: 1, name: 'Funkplan' })).toBeInTheDocument();
    await screen.findByText('Florian 1/42-1');
    const kopf = [...container.querySelectorAll('th.ant-table-cell')].map((z) => z.textContent);
    expect(kopf.slice(0, 6)).toEqual([
      'Stelle',
      'Rufname/OPTA',
      'Leiter/Führer',
      'TMO',
      'DMO',
      'Kommunikationsmittel',
    ]);
    const nord = container.querySelector('tr[data-row-key="ab-1"]') as HTMLElement;
    expect(within(nord).getByText('EA-N')).toBeInTheDocument();
    expect(within(nord).getByText('Anna Leiter')).toBeInTheDocument();
    expect(within(nord).getByText('TMO 311')).toBeInTheDocument();
    expect(within(nord).getByText('DMO 505')).toBeInTheDocument();
    expect(within(nord).getByText('Digitalfunk')).toBeInTheDocument();
    const fz = container.querySelector('tr[data-row-key="fz-100"]') as HTMLElement;
    expect(within(fz).getByText('FW-1-42-1')).toBeInTheDocument();
    expect(within(fz).getByText('Clara Führerin')).toBeInTheDocument();
    expect(within(fz).getByText('HLF 20')).toBeInTheDocument();
  });

  it('stellt Fahrzeuge ohne Einheit in den Sammelknoten, ohne Link', async () => {
    const { container } = setup();
    await screen.findByText('Florian ELW 1');
    const sammel = container.querySelector('tr[data-row-key="sammel"]') as HTMLElement;
    expect(within(sammel).getByText('Ohne Abschnitt / Einheit')).toBeInTheDocument();
    expect(within(sammel).queryByRole('link')).toBeNull();
  });

  it('führt jede Zeile per Link zu ihrem Pflegeort', async () => {
    setup();
    expect(await screen.findByRole('link', { name: 'Abschnitt Nord' })).toHaveAttribute(
      'href',
      '/einsaetze/1/einsatzabschnitte?abschnitt=1',
    );
    const tabelle = screen.getByRole('region', { name: 'Funkplan' });
    expect(within(tabelle).getByRole('link', { name: '1. Zug' })).toHaveAttribute(
      'href',
      '/einsaetze/1/einheiten/10',
    );
    expect(within(tabelle).getByRole('link', { name: /Florian 1\/42-1/ })).toHaveAttribute(
      'href',
      '/einsaetze/1/fahrzeuge?fahrzeug=100',
    );
  });

  it('bietet keine Bearbeitung an', async () => {
    setup();
    await screen.findByText('Florian 1/42-1');
    expect(screen.queryByRole('button', { name: /bearbeiten|ändern|zuordnen/i })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('FunkplanPage — Lücken und Rechteweiche', () => {
  it('zählt die Lücken und nennt die Betroffenen', async () => {
    setup();
    await screen.findByText('Florian 1/42-1');
    const abschnitte = lueckenZeile('Abschnitte ohne Sprechgruppe');
    expect(within(abschnitte).getByText('1')).toBeInTheDocument();
    expect(within(abschnitte).getByRole('link', { name: 'Abschnitt Süd' })).toHaveAttribute(
      'href',
      '/einsaetze/1/einsatzabschnitte?abschnitt=2',
    );
    const einheiten = lueckenZeile('Einheiten ohne Sprechgruppe');
    expect(within(einheiten).getByRole('link', { name: '1. Zug' })).toHaveAttribute(
      'href',
      '/einsaetze/1/einheiten/10',
    );
    expect(
      within(lueckenZeile('Einheiten ohne Erreichbarkeit')).getByText('0'),
    ).toBeInTheDocument();
    const lokal = lueckenZeile('Einsatzlokale Sprechgruppen ohne Zuordnung');
    expect(within(lokal).getByText('1')).toBeInTheDocument();
    expect(within(lokal).getByText('DMO 999')).toBeInTheDocument();
  });

  it('benennt die fehlende eigene Gegenstelle, ohne eine Zeile zu erfinden', async () => {
    const { container } = setup();
    await screen.findByText('Florian 1/42-1');
    expect(
      within(luecken()).getByText(/Eigene Gegenstelle \(Führungsstelle\)/),
    ).toBeInTheDocument();
    expect(within(luecken()).getByText(/nicht erfasst/)).toBeInTheDocument();
    expect(container.querySelectorAll('tr[data-row-key^="fuehrungsstelle"]')).toHaveLength(0);
  });

  it('zeigt bei gesperrten Einheiten „—“ mit Grund statt „0“ und nennt die fehlende Ebene', async () => {
    vi.mocked(listeEinheiten).mockRejectedValue(new ApiError(403, 'verboten'));
    setup();
    await screen.findByText('Florian ELW 1');
    for (const titel of [
      'Einheiten ohne Sprechgruppe',
      'Einheiten ohne Erreichbarkeit',
      'Einsatzlokale Sprechgruppen ohne Zuordnung',
    ]) {
      const zeile = lueckenZeile(titel);
      expect(within(zeile).getByText('—')).toBeInTheDocument();
      expect(within(zeile).getByText(/nicht freigegeben/)).toBeInTheDocument();
      expect(within(zeile).queryByText('0')).toBeNull();
    }
    expect(screen.getByText(/Einheiten: nicht freigegeben/)).toBeInTheDocument();
  });

  it('zeigt bei gesperrtem Personal „—“ mit Grund in der Führerzelle der Fahrzeuge', async () => {
    vi.mocked(listeEinsatzPersonal).mockRejectedValue(new ApiError(403, 'verboten'));
    const { container } = setup();
    await screen.findByText('Florian 1/42-1');
    const fz = container.querySelector('tr[data-row-key="fz-100"]') as HTMLElement;
    await waitFor(() => expect(within(fz).getByText(/nicht freigegeben/)).toBeInTheDocument());
    expect(within(fz).queryByText('Clara Führerin')).toBeNull();
    // Der Rest der Tabelle bleibt: Abschnitt und Einheit tragen ihre Leitung weiter.
    expect(screen.getByText('Anna Leiter')).toBeInTheDocument();
  });
});

describe('FunkplanPage — Übernahme in den Lagebericht', () => {
  it('legt EINEN Freitext-Bericht mit dem Funkplan an, ohne Erreichbarkeit, und öffnet ihn', async () => {
    setup();
    await screen.findByText('Florian 1/42-1');
    fireEvent.click(screen.getByRole('button', { name: 'In Lagebericht übernehmen' }));
    await waitFor(() => expect(navigiere).toHaveBeenCalledWith('/einsaetze/1/lageberichte/77'));
    expect(vi.mocked(legeLageberichtAn)).toHaveBeenCalledTimes(1);
    const [einsatzId, daten] = vi.mocked(legeLageberichtAn).mock.calls[0];
    expect(einsatzId).toBe(1);
    expect(daten.vorlage).toBe('freitext');
    expect(daten.titel).toMatch(/^Funkplan /);
    const text = daten.abschnitte![0].text;
    expect(daten.abschnitte![0].schluessel).toBe('text');
    expect(text).toContain('**Abschnitt Nord**');
    expect(text).not.toContain('GEHEIM');
    expect(text).not.toContain('0171 111');
  });

  it('zeigt einen Fehler an der Seite und navigiert nicht', async () => {
    vi.mocked(legeLageberichtAn).mockRejectedValueOnce(
      new ApiError(422, 'Einsatz ist abgeschlossen'),
    );
    setup();
    await screen.findByText('Florian 1/42-1');
    fireEvent.click(screen.getByRole('button', { name: 'In Lagebericht übernehmen' }));
    expect(await screen.findByText('Einsatz ist abgeschlossen')).toBeInTheDocument();
    expect(navigiere).not.toHaveBeenCalled();
  });

  it('fehlt ohne Schreibrecht', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue({
      ...EINSATZ,
      meine_rolle: 'beobachter',
    } as EinsatzAnzeige);
    setup();
    await screen.findByText('Florian 1/42-1');
    expect(screen.queryByRole('button', { name: 'In Lagebericht übernehmen' })).toBeNull();
    expect(screen.getByRole('button', { name: /Drucken/ })).toBeInTheDocument();
  });
});

describe('FunkplanPage — Baum', () => {
  it('startet aufgeklappt; ein Klick neben den Link klappt den Knoten zu', async () => {
    const { container } = setup();
    await screen.findByText('Florian 1/42-1');
    expect(container.querySelector('tr[data-row-key="fz-100"]')).not.toBeNull();
    const zelle = container.querySelector(
      'tr[data-row-key="eh-10"] td:nth-child(2)',
    ) as HTMLElement;
    await userEvent.click(zelle);
    await waitFor(() => expect(container.querySelector('tr[data-row-key="fz-100"]')).toBeNull());
  });
});

describe('FunkplanPage — Sperre des Stabs', () => {
  it('ist nicht erreichbar, wenn der Stab im Einsatz ausgeblendet ist', async () => {
    vi.mocked(ladeModulOverrides).mockResolvedValue({
      stab: { sichtbar: false, einsatz_id: 1, modul_key: 'stab' },
    });
    const { container } = setup();
    expect(
      await screen.findByText(/Stab ist in diesem Einsatz nicht freigegeben/),
    ).toBeInTheDocument();
    expect(container.querySelector('.ant-table')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Lücken' })).toBeNull();
  });

  it('ist gesperrt, wenn der Stab eine Rolle verlangt, die die Person nicht hat', async () => {
    vi.mocked(ladeModulOverrides).mockResolvedValue({
      stab: {
        sichtbar: true,
        benoetigte_rolle: 'fuehrungskraft',
        einsatz_id: 1,
        modul_key: 'stab',
      },
    });
    const { container } = setup();
    expect(
      await screen.findByText(/Stab ist in diesem Einsatz nicht freigegeben/),
    ).toBeInTheDocument();
    expect(container.querySelector('.ant-table')).toBeNull();
  });

  it('Gegenprobe: der System-Admin sieht den Funkplan trotz Rollensperre', async () => {
    server.use(
      http.get('/api/auth/me', () =>
        HttpResponse.json({
          id: 1,
          anzeigename: 'Anna Admin',
          benutzername: 'anna',
          system_rolle: 'admin',
          org_rolle: 'keine',
          aktiv: true,
          erstellt_at: '2026-05-23 10:00:00',
        }),
      ),
    );
    vi.mocked(ladeModulOverrides).mockResolvedValue({
      stab: {
        sichtbar: true,
        benoetigte_rolle: 'fuehrungskraft',
        einsatz_id: 1,
        modul_key: 'stab',
      },
    });
    setup();
    expect(await screen.findByText('Florian 1/42-1')).toBeInTheDocument();
  });

  it('zeigt nichts, solange die Freigabe nicht ermittelt ist, und bei deren Fehler einen Fehler', async () => {
    vi.mocked(ladeModulOverrides).mockRejectedValue(new ApiError(500, 'kaputt'));
    const { container } = setup();
    expect(await screen.findByText(/Freigabe des Stabs nicht ermittelbar/)).toBeInTheDocument();
    expect(container.querySelector('.ant-table')).toBeNull();
    expect(screen.queryByRole('button', { name: 'In Lagebericht übernehmen' })).toBeNull();
  });
});

describe('FunkplanPage — nichts wird als leerer Bestand behauptet', () => {
  it('nennt den Grund statt „Weder Abschnitte …“, wenn Quellen gesperrt sind', async () => {
    vi.mocked(listeAbschnitte).mockRejectedValue(new ApiError(403, 'verboten'));
    vi.mocked(listeEinheiten).mockRejectedValue(new ApiError(403, 'verboten'));
    vi.mocked(listeEinsatzFahrzeuge).mockRejectedValue(new ApiError(403, 'verboten'));
    setup();
    const tabelle = await screen.findByRole('region', { name: 'Funkplan' });
    await waitFor(() =>
      expect(
        within(tabelle).getByText(/Abschnitte, Einheiten, Fahrzeuge: nicht freigegeben/),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Weder Abschnitte/)).toBeNull();
  });

  it('sperrt die Übernahme, solange eine Quelle noch lädt', async () => {
    vi.mocked(listeEinsatzSprechgruppen).mockReturnValue(new Promise(() => {}));
    setup();
    await screen.findByText('Florian 1/42-1');
    expect(screen.getByRole('button', { name: 'In Lagebericht übernehmen' })).toBeDisabled();
  });

  it('bietet keine Übernahme an, wenn das Modul Lageberichte nicht freigegeben ist', async () => {
    vi.mocked(ladeModulOverrides).mockResolvedValue({
      lageberichte: { sichtbar: false, einsatz_id: 1, modul_key: 'lageberichte' },
    });
    setup();
    await screen.findByText('Florian 1/42-1');
    expect(screen.queryByRole('button', { name: 'In Lagebericht übernehmen' })).toBeNull();
  });

  it('schreibt fehlende Quellen in den Lagebericht, statt sie zu verschweigen', async () => {
    vi.mocked(listeEinsatzFahrzeuge).mockRejectedValue(new ApiError(403, 'verboten'));
    setup();
    await screen.findByText('1. Zug', { selector: 'a' });
    const knopf = screen.getByRole('button', { name: 'In Lagebericht übernehmen' });
    await waitFor(() => expect(knopf).toBeEnabled());
    fireEvent.click(knopf);
    await waitFor(() => expect(vi.mocked(legeLageberichtAn)).toHaveBeenCalledTimes(1));
    const text = vi.mocked(legeLageberichtAn).mock.calls[0][1].abschnitte![0].text;
    expect(text).toContain('Fahrzeuge: nicht freigegeben');
  });
});

/**
 * Darstellung „Skizze“ (LFH-625): die Fernmeldeskizze als zweite Darstellung derselben Seite.
 * Umschalter im Kopf, Sichtvorgabe `?ansicht=` apply-then-clean, Druckkopf je Darstellung,
 * getrennte Klappmengen, dieselbe Übernahme und dasselbe Lücken-Paneel.
 */
describe('FunkplanPage — Darstellung Skizze (LFH-625)', () => {
  function SuchAnzeige() {
    return <span data-testid="suche">{useLocation().search}</span>;
  }
  function rendereMit(route = '/einsaetze/1/stab/funkplan') {
    return renderMitProviders(
      <>
        <Routes>
          <Route path="/einsaetze/:id/stab/funkplan" element={<FunkplanPage />} />
        </Routes>
        <SuchAnzeige />
      </>,
      { route },
    );
  }
  const skizze = () => screen.getByRole('region', { name: 'Fernmeldeskizze' });
  const druckkopf = (c: HTMLElement) =>
    c.querySelector('[data-lfh="druckwurzel"] [data-lfh="druckkopf"]') as HTMLElement;

  it('schaltet auch ohne Schreibrecht auf die Skizze um; die Lücken bleiben stehen', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue({ ...EINSATZ, meine_rolle: 'beobachter' });
    const { container } = rendereMit();
    await screen.findByText('Florian 1/42-1');
    const umschalter = screen.getByRole('radiogroup', { name: 'Darstellung' });
    expect(within(umschalter).getByRole('radio', { name: 'Tabelle' })).toBeChecked();
    await userEvent.click(within(umschalter).getByRole('radio', { name: 'Skizze' }));
    expect(within(skizze()).getByRole('link', { name: 'Abschnitt Nord' })).toBeInTheDocument();
    expect(container.querySelector('.ant-table')).toBeNull();
    // Fahrzeuge sind keine Knoten der Skizze.
    expect(within(skizze()).queryByText('Florian 1/42-1')).toBeNull();
    expect(screen.getByRole('region', { name: 'Lücken' })).toBeInTheDocument();
  });

  it('?ansicht=skizze öffnet die Skizze und räumt den Parameter', async () => {
    rendereMit('/einsaetze/1/stab/funkplan?ansicht=skizze');
    expect(await screen.findByRole('region', { name: 'Fernmeldeskizze' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('suche')).toHaveTextContent(/^$/));
    expect(
      within(screen.getByRole('radiogroup', { name: 'Darstellung' })).getByRole('radio', {
        name: 'Skizze',
      }),
    ).toBeChecked();
  });

  it('ein unbrauchbarer Wert wird nur geräumt, die Darstellung bleibt Tabelle', async () => {
    const { container } = rendereMit('/einsaetze/1/stab/funkplan?ansicht=quatsch');
    await screen.findByText('Florian 1/42-1');
    await waitFor(() => expect(screen.getByTestId('suche')).toHaveTextContent(/^$/));
    expect(container.querySelector('.ant-table')).not.toBeNull();
    expect(screen.queryByRole('region', { name: 'Fernmeldeskizze' })).toBeNull();
  });

  it('zeigt bei gesperrtem Stab auch mit ?ansicht=skizze nur die Sperre', async () => {
    vi.mocked(ladeModulOverrides).mockResolvedValue({
      stab: { sichtbar: false, einsatz_id: 1, modul_key: 'stab' },
    });
    rendereMit('/einsaetze/1/stab/funkplan?ansicht=skizze');
    expect(
      await screen.findByText(/Stab ist in diesem Einsatz nicht freigegeben/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Fernmeldeskizze' })).toBeNull();
  });

  it('nennt im Druckkopf die Dokumentart der aktiven Darstellung', async () => {
    const { container } = rendereMit();
    await screen.findByText('Florian 1/42-1');
    expect(druckkopf(container)).toHaveTextContent('Funkplan');
    expect(druckkopf(container)).not.toHaveTextContent('Fernmeldeskizze');
    await userEvent.click(screen.getByRole('radio', { name: 'Skizze' }));
    expect(druckkopf(container)).toHaveTextContent('Fernmeldeskizze');
    expect(container.querySelectorAll('[data-lfh="druckwurzel"]')).toHaveLength(1);
  });

  it('klappt nur in der Skizze über „Alle zuklappen“, die Tabelle behält ihren Zustand', async () => {
    const { container } = rendereMit();
    await screen.findByText('Florian 1/42-1');
    expect(screen.queryByRole('button', { name: 'Alle zuklappen' })).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: 'Skizze' }));
    await userEvent.click(screen.getByRole('button', { name: 'Alle zuklappen' }));
    expect(within(skizze()).queryByRole('link', { name: '1. Zug' })).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: 'Tabelle' }));
    // Die Tabelle steht weiter offen, mit dem Fahrzeug unter der Einheit.
    expect(container.querySelector('tr[data-row-key="fz-100"]')).not.toBeNull();
  });

  it('klappt vor dem Druck die Skizze auf', async () => {
    const drucke = vi.spyOn(window, 'print').mockImplementation(() => {});
    rendereMit('/einsaetze/1/stab/funkplan?ansicht=skizze');
    await screen.findByRole('region', { name: 'Fernmeldeskizze' });
    await userEvent.click(screen.getByRole('button', { name: 'Alle zuklappen' }));
    expect(within(skizze()).queryByRole('link', { name: '1. Zug' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Drucken / als PDF' }));
    expect(await within(skizze()).findByRole('link', { name: '1. Zug' })).toBeInTheDocument();
    await waitFor(() => expect(drucke).toHaveBeenCalledTimes(1));
    drucke.mockRestore();
  });

  it('übernimmt auch aus der Skizze den Funkplan mit genau einem Aufruf', async () => {
    rendereMit('/einsaetze/1/stab/funkplan?ansicht=skizze');
    await screen.findByRole('region', { name: 'Fernmeldeskizze' });
    const knopf = screen.getByRole('button', { name: 'In Lagebericht übernehmen' });
    await waitFor(() => expect(knopf).toBeEnabled());
    await userEvent.click(knopf);
    await waitFor(() => expect(navigiere).toHaveBeenCalledWith('/einsaetze/1/lageberichte/77'));
    expect(legeLageberichtAn).toHaveBeenCalledTimes(1);
    const [, eingabe] = vi.mocked(legeLageberichtAn).mock.calls[0];
    expect(eingabe.titel).toMatch(/^Funkplan /);
    expect(eingabe.abschnitte?.[0].text).toContain('Verbindungen ohne gemeinsame Sprechgruppe');
  });

  it('zeigt mit ?ansicht=skizze die Tabelle nie, auch nicht im ersten Bild', async () => {
    const { container } = rendereMit('/einsaetze/1/stab/funkplan?ansicht=skizze');
    const tabellen: number[] = [];
    const beobachter = new MutationObserver(() =>
      tabellen.push(container.querySelectorAll('.ant-table').length),
    );
    beobachter.observe(container, { childList: true, subtree: true });
    await screen.findByRole('region', { name: 'Fernmeldeskizze' });
    beobachter.disconnect();
    expect(Math.max(0, ...tabellen)).toBe(0);
  });

  it('zählt im Umfang der Skizze keine Fahrzeuge, die sie nicht zeigt', async () => {
    const { container } = rendereMit('/einsaetze/1/stab/funkplan?ansicht=skizze');
    await screen.findByRole('region', { name: 'Fernmeldeskizze' });
    expect(druckkopf(container)).toHaveTextContent('2 Abschnitte · 1 Einheiten');
    expect(druckkopf(container)).not.toHaveTextContent('Fahrzeuge');
    await userEvent.click(screen.getByRole('radio', { name: 'Tabelle' }));
    expect(druckkopf(container)).toHaveTextContent('2 Fahrzeuge');
  });

  it('nennt bei gesperrten Abschnitten den Grund statt eines Sammelknotens', async () => {
    vi.mocked(listeAbschnitte).mockRejectedValue(new ApiError(403, 'verboten'));
    rendereMit('/einsaetze/1/stab/funkplan?ansicht=skizze');
    expect(
      await screen.findByText('Keine Skizze darstellbar — Abschnitte: nicht freigegeben'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Fernmeldeskizze' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Ohne Abschnitt' })).toBeNull();
  });

  it('nennt bei fehlenden Einheiten den Grund und zeigt die Abschnitte', async () => {
    vi.mocked(listeEinheiten).mockRejectedValue(new ApiError(500, 'kaputt'));
    rendereMit('/einsaetze/1/stab/funkplan?ansicht=skizze');
    const region = await screen.findByRole('region', { name: 'Fernmeldeskizze' });
    expect(within(region).getByRole('link', { name: 'Abschnitt Nord' })).toBeInTheDocument();
    expect(screen.getByText('Einheiten: nicht geladen')).toBeInTheDocument();
  });
});

describe('FunkplanPage — Lücke „Verbindungen ohne gemeinsame Sprechgruppe“ (LFH-625)', () => {
  it('zählt die Verbindung und verweist auf die untere Stelle', async () => {
    vi.mocked(listeEinheiten).mockResolvedValue([
      { ...EINHEITEN[0], sprechgruppen: [sg(5, 'DMO', 'DMO 506')] },
    ]);
    setup();
    await screen.findByText('Florian 1/42-1');
    const zeile = lueckenZeile('Verbindungen ohne gemeinsame Sprechgruppe');
    expect(within(zeile).getByText('1')).toBeInTheDocument();
    // Beide Enden der Verbindung stehen da, der Verweis führt zur unteren Stelle.
    expect(within(zeile).getByRole('link', { name: '1. Zug → Abschnitt Nord' })).toHaveAttribute(
      'href',
      '/einsaetze/1/einheiten/10',
    );
  });

  it('zeigt bei gesperrten Einheiten „—“ mit Grund statt „0“', async () => {
    vi.mocked(listeEinheiten).mockRejectedValue(new ApiError(403, 'verboten'));
    setup();
    await screen.findByText('Florian ELW 1');
    const zeile = lueckenZeile('Verbindungen ohne gemeinsame Sprechgruppe');
    expect(within(zeile).getByText('—')).toBeInTheDocument();
    expect(within(zeile).getByText(/nicht freigegeben/)).toBeInTheDocument();
  });
});
