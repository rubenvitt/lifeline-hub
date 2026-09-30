import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router';
import { renderMitProviders } from '../test/utils';
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
});
