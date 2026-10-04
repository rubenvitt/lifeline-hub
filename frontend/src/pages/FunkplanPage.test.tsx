import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, within, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route, useLocation } from 'react-router';
import { http, HttpResponse } from 'msw';
import { QueryClient } from '@tanstack/react-query';
import { renderMitProviders } from '../test/utils';
import { server } from '../test/server';
import FunkplanPage from './FunkplanPage';
import { ladeEinsatz, ladeFuehrungsstelle, ladeModulFreigaben } from '../api/einsaetze';
import { listeEinheiten } from '../api/einheiten';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinsatzSprechgruppen } from '../api/sprechgruppen';
import { legeLageberichtAn } from '../api/lageberichte';
import { ladeKommunikationsplan } from '../api/kommunikationsplan';
import { ladeFernmeldeskizze } from '../api/fernmeldeskizze';
import { ApiError } from '../api/client';
import { freigabenFixture } from '../test/fixtures';
import type {
  Einheit,
  EinsatzAnzeige,
  EinsatzFahrzeug,
  EinsatzPersonal,
  Einsatzabschnitt,
  Fernmeldeskizze,
  KommunikationsStelle,
  Sprechgruppe,
} from '../api/types';
import type { Fernmeldenetz } from '../stab/fernmeldeskizze';
import type { SkizzenAktionen } from '../stab/skizzenAktionen';

vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn(),
  ladeModulFreigaben: vi.fn(),
  ladeFuehrungsstelle: vi.fn(),
}));
vi.mock('../api/einheiten', () => ({ listeEinheiten: vi.fn() }));
vi.mock('../api/einsatzPersonal', () => ({ listeEinsatzPersonal: vi.fn() }));
vi.mock('../api/einsatzFahrzeuge', () => ({ listeEinsatzFahrzeuge: vi.fn() }));
vi.mock('../api/einsatzabschnitte', () => ({ listeAbschnitte: vi.fn() }));
vi.mock('../api/sprechgruppen', () => ({ listeEinsatzSprechgruppen: vi.fn() }));
vi.mock('../api/lageberichte', () => ({
  legeLageberichtAn: vi.fn(() => Promise.resolve({ id: 77 })),
}));
vi.mock('../api/kommunikationsplan', () => ({ ladeKommunikationsplan: vi.fn() }));
vi.mock('../api/fernmeldeskizze', () => ({ ladeFernmeldeskizze: vi.fn() }));

/**
 * Die Zeichenfläche (LFH-893, `stab/FernmeldeskizzeBild.tsx`) hat eigene Tests. Hier zählt, was
 * die Seite ihr gibt: das Netz, die Aktionen, die Wahl. Der Stub nennt die Stellen als Text.
 */
interface BildProps {
  netz: Fernmeldenetz;
  aktionen: SkizzenAktionen | null;
  einsatzbezeichnung: string;
  gewaehlt?: string | null;
  onWahl?: (key: string | null) => void;
  druckt?: boolean;
}
const { bild } = vi.hoisted(() => ({ bild: { props: null as BildProps | null } }));
vi.mock('../stab/FernmeldeskizzeBild', () => ({
  default: (p: BildProps) => {
    bild.props = p;
    return (
      <section aria-label="Fernmeldeskizze">
        {p.netz.stellen.map((st) => (
          <span key={st.key}>{st.bezeichnung}</span>
        ))}
        <span data-testid="gewaehlt">{p.gewaehlt ?? ''}</span>
      </section>
    );
  },
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
    ist_demo: false,
  },
  {
    id: 101,
    einsatz_id: 1,
    funkrufname: 'Florian ELW 1',
    disponiert_at: '2026-09-30T10:00:00',
    ist_adhoc: false,
    ist_demo: false,
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
    ist_demo: false,
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
  vi.mocked(ladeModulFreigaben).mockResolvedValue(freigabenFixture());
  vi.mocked(listeAbschnitte).mockResolvedValue(ABSCHNITTE);
  vi.mocked(listeEinheiten).mockResolvedValue(EINHEITEN);
  vi.mocked(listeEinsatzFahrzeuge).mockResolvedValue(FAHRZEUGE);
  vi.mocked(listeEinsatzPersonal).mockResolvedValue(PERSONAL);
  vi.mocked(listeEinsatzSprechgruppen).mockResolvedValue(SPRECHGRUPPEN);
  vi.mocked(ladeFuehrungsstelle).mockResolvedValue({ sprechgruppen: [] });
  vi.mocked(ladeKommunikationsplan).mockResolvedValue([]);
  vi.mocked(ladeFernmeldeskizze).mockResolvedValue(skizze());
  bild.props = null;
});

function skizze(p: Partial<Fernmeldeskizze> = {}): Fernmeldeskizze {
  return {
    lage: [],
    komponenten: [],
    verbindungen: [],
    bereiche: [],
    schriftfeld: {
      herausgeber: null,
      vs_vermerk: 'keiner',
      gueltig_ab: null,
      gez_name: null,
      gez_at: null,
    },
    stand: null,
    ...p,
  };
}

/** Die Leitstelle des Kommunikationsplans, ohne Verbindung und ohne Kanal. */
function leitstelle(p: Partial<KommunikationsStelle> = {}): KommunikationsStelle {
  return {
    id: 5,
    stellenart: 'leitstelle',
    bezeichnung: 'ILS Musterhausen',
    verbindungen: [],
    sprechgruppen: [],
    ...p,
  };
}

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
    expect(container.querySelectorAll('tr[data-row-key="fs"]')).toHaveLength(0);
    // Der Hinweis führt dorthin, wo die Führungsstelle gepflegt wird.
    expect(
      within(lueckenZeile('Eigene Gegenstelle (Führungsstelle)')).getByRole('link', {
        name: 'auf Einsatzdaten erfassen',
      }),
    ).toHaveAttribute('href', '/einsaetze/1/einsatzdaten');
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
    vi.mocked(ladeModulFreigaben).mockResolvedValue(
      freigabenFixture({ stab: { sichtbar: false } }),
    );
    const { container } = setup();
    expect(
      await screen.findByText(/Stab ist in diesem Einsatz nicht freigegeben/),
    ).toBeInTheDocument();
    expect(container.querySelector('.ant-table')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Lücken' })).toBeNull();
  });

  it('ist gesperrt, wenn der Server den Zugriff auf den Stab verweigert', async () => {
    // Etwa weil der Stab eine Rolle verlangt, die die Person nicht hat: das rechnet der Server.
    vi.mocked(ladeModulFreigaben).mockResolvedValue(
      freigabenFixture({ stab: { sichtbar: true, zugriff: false } }),
    );
    const { container } = setup();
    expect(
      await screen.findByText(/Stab ist in diesem Einsatz nicht freigegeben/),
    ).toBeInTheDocument();
    expect(container.querySelector('.ant-table')).toBeNull();
  });

  it('Gegenprobe: der Client rechnet keine Rolle nach — gibt der Server den Stab frei, ist der Funkplan da', async () => {
    // Person ohne Org- und Systemrolle; ob der Stab eine Rolle verlangt, entscheidet allein der
    // Server (LFH-669). Sagt die Freigabe „frei“, zeigt die Seite ihren Inhalt.
    server.use(
      http.get('/api/auth/me', () =>
        HttpResponse.json({
          id: 1,
          anzeigename: 'Max Mitglied',
          benutzername: 'max',
          system_rolle: 'keiner',
          org_rolle: 'keine',
          aktiv: true,
          erstellt_at: '2026-05-23 10:00:00',
        }),
      ),
    );
    vi.mocked(ladeModulFreigaben).mockResolvedValue(freigabenFixture());
    setup();
    expect(await screen.findByText('Florian 1/42-1')).toBeInTheDocument();
  });

  it('zeigt nichts, solange die Freigabe nicht ermittelt ist, und bei deren Fehler einen Fehler', async () => {
    vi.mocked(ladeModulFreigaben).mockRejectedValue(new ApiError(500, 'kaputt'));
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
    vi.mocked(ladeModulFreigaben).mockResolvedValue(
      freigabenFixture({ lageberichte: { sichtbar: false } }),
    );
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
 * Modulgrenze der Quellen (LFH-669, Spec `modul-freigabe`): der Funkplan fragt die Liste eines
 * Moduls nur bei Freigabe des Servers an. Eine gesperrte Liste geht durch dieselbe Weiche wie ein
 * 403 („nicht freigegeben“, die Ebene fehlt mit Grund) — kein Ausfall, kein vollständiger Plan.
 */
describe('FunkplanPage — Modulgrenze der Quellen (LFH-669)', () => {
  const LISTEN = [listeAbschnitte, listeEinheiten, listeEinsatzFahrzeuge, listeEinsatzPersonal];
  beforeEach(() => {
    for (const f of LISTEN) vi.mocked(f).mockClear();
  });

  it('fragt ein gesperrtes Modul nicht an und nennt die Ebene „nicht freigegeben“, nicht als Ausfall', async () => {
    vi.mocked(ladeModulFreigaben).mockResolvedValue(
      freigabenFixture({ einheiten: { zugriff: false } }),
    );
    setup();
    await screen.findByText('Florian ELW 1');
    // Vorbedingung: die freien Listen liefen.
    expect(vi.mocked(listeAbschnitte)).toHaveBeenCalled();
    expect(vi.mocked(listeEinsatzFahrzeuge)).toHaveBeenCalled();
    expect(vi.mocked(listeEinheiten)).not.toHaveBeenCalled();
    // Der Plan wirkt nicht vollständig: die fehlende Ebene steht mit Grund da.
    expect(screen.getByText(/Einheiten: nicht freigegeben/)).toBeInTheDocument();
    const zeile = lueckenZeile('Einheiten ohne Sprechgruppe');
    expect(within(zeile).getByText('—')).toBeInTheDocument();
    expect(within(zeile).queryByText('0')).toBeNull();
    // Gesperrt ist kein Ausfall.
    expect(screen.queryByText(/nicht geladen/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('zeigt auch keinen Altstand eines gesperrten Moduls aus dem Cache', async () => {
    vi.mocked(ladeModulFreigaben).mockResolvedValue(
      freigabenFixture({ einheiten: { zugriff: false } }),
    );
    const client = new QueryClient();
    client.setQueryData(['einsatz-einheiten', 1], EINHEITEN);
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/stab/funkplan" element={<FunkplanPage />} />
      </Routes>,
      { route: '/einsaetze/1/stab/funkplan', client },
    );
    await screen.findByText('Florian ELW 1');
    expect(screen.queryByText('1. Zug')).toBeNull();
    expect(screen.getByText(/Einheiten: nicht freigegeben/)).toBeInTheDocument();
  });

  it('fragt keine Liste an, solange die Freigaben laden', async () => {
    vi.mocked(ladeModulFreigaben).mockReturnValue(new Promise(() => {}));
    setup();
    await waitFor(() => expect(vi.mocked(ladeModulFreigaben)).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    for (const f of LISTEN) expect(vi.mocked(f)).not.toHaveBeenCalled();
  });

  it('fragt keine Liste an, wenn die Freigaben scheitern, und zeigt den Fehler', async () => {
    vi.mocked(ladeModulFreigaben).mockRejectedValue(new ApiError(500, 'kaputt'));
    setup();
    expect(await screen.findByText(/Freigabe des Stabs nicht ermittelbar/)).toBeInTheDocument();
    for (const f of LISTEN) expect(vi.mocked(f)).not.toHaveBeenCalled();
  });

  it('fragt keine Liste an, wenn der Stab gesperrt ist', async () => {
    vi.mocked(ladeModulFreigaben).mockResolvedValue(freigabenFixture({ stab: { zugriff: false } }));
    setup();
    await screen.findByText(/Stab ist in diesem Einsatz nicht freigegeben/);
    for (const f of LISTEN) expect(vi.mocked(f)).not.toHaveBeenCalled();
  });

  it('ein freies Modul mit echtem Ausfall bleibt ein Ausfall („nicht geladen“)', async () => {
    vi.mocked(listeEinheiten).mockRejectedValue(new ApiError(500, 'kaputt'));
    setup();
    await screen.findByText('Florian ELW 1');
    await waitFor(() => expect(screen.getByText(/Einheiten: nicht geladen/)).toBeInTheDocument());
    expect(screen.queryByText(/Einheiten: nicht freigegeben/)).toBeNull();
  });
});

/**
 * Darstellung „Skizze“ (LFH-625, LFH-893): die Fernmeldeskizze als zweite Darstellung derselben
 * Seite. Umschalter im Kopf, Sichtvorgabe `?ansicht=` apply-then-clean, Druckkopf je Darstellung,
 * dieselbe Übernahme und dasselbe Lücken-Paneel.
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
    expect(within(skizze()).getByText('Abschnitt Nord')).toBeInTheDocument();
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
    vi.mocked(ladeModulFreigaben).mockResolvedValue(
      freigabenFixture({ stab: { sichtbar: false } }),
    );
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

  // Spec „Druck als eigenes Druckstück“: die Funkplan-Tabelle folgt als Anlage ab neuer Seite.
  it('hängt im Druck der Skizze die ganze Funkplan-Tabelle als Anlage an', async () => {
    const { container } = rendereMit('/einsaetze/1/stab/funkplan?ansicht=skizze');
    await screen.findByRole('region', { name: 'Fernmeldeskizze' });
    await waitFor(() => expect(within(skizze()).getByText('1. Zug')).toBeInTheDocument());
    // Am Bildschirm keine Anlage.
    expect(container.querySelector('[data-lfh="druck-anlage"]')).toBeNull();
    fireEvent(window, new Event('beforeprint'));
    const anlage = container.querySelector(
      '[data-lfh="druckwurzel"] [data-lfh="druck-anlage"]',
    ) as HTMLElement;
    expect(anlage).not.toBeNull();
    expect(within(anlage).getByText('Anlage: Funkplan')).toBeInTheDocument();
    // Ganz offen: das Fahrzeug unter der Einheit steht da, samt Erreichbarkeit (Druck).
    expect(anlage.querySelector('tr[data-row-key="fz-100"]')).not.toBeNull();
    expect(within(anlage).getByText('0160 GEHEIM')).toBeInTheDocument();
    // Das Blatt trägt das Papierformat der Skizze (A3 quer als Vorgabe), die Anlage nicht.
    const blatt = container.querySelector('.lfh-skizze-druck-a3') as HTMLElement;
    expect(blatt).toContainElement(skizze());
    expect(blatt).toContainElement(luecken());
    expect(blatt).not.toContainElement(anlage);
    expect(bild.props?.druckt).toBe(true);
    // Die Skizze bleibt vorn, die Anlage folgt ihr.
    expect(
      skizze().compareDocumentPosition(anlage) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent(window, new Event('afterprint'));
    await waitFor(() => expect(container.querySelector('[data-lfh="druck-anlage"]')).toBeNull());
  });

  it('druckt aus der Tabelle keine Anlage', async () => {
    const { container } = rendereMit();
    await screen.findByText('Florian 1/42-1');
    fireEvent(window, new Event('beforeprint'));
    expect(container.querySelector('[data-lfh="druck-anlage"]')).toBeNull();
    fireEvent(window, new Event('afterprint'));
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
    expect(eingabe.abschnitte?.[0].text).toContain('## Kommunikationsskizze');
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

  it('fragt bei vom Server gesperrten Abschnitten nicht an und nennt den Grund (LFH-669)', async () => {
    vi.mocked(listeAbschnitte).mockClear();
    vi.mocked(ladeModulFreigaben).mockResolvedValue(
      freigabenFixture({ einsatzabschnitte: { zugriff: false } }),
    );
    rendereMit('/einsaetze/1/stab/funkplan?ansicht=skizze');
    expect(
      await screen.findByText('Keine Skizze darstellbar — Abschnitte: nicht freigegeben'),
    ).toBeInTheDocument();
    expect(vi.mocked(listeAbschnitte)).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Fernmeldeskizze' })).toBeNull();
  });

  it('nennt bei fehlenden Einheiten den Grund und zeigt die Abschnitte', async () => {
    vi.mocked(listeEinheiten).mockRejectedValue(new ApiError(500, 'kaputt'));
    rendereMit('/einsaetze/1/stab/funkplan?ansicht=skizze');
    const region = await screen.findByRole('region', { name: 'Fernmeldeskizze' });
    expect(within(region).getByText('Abschnitt Nord')).toBeInTheDocument();
    // Über der Fläche nennt den Grund nur das Bild aus `netz.fehlend` (`skizze-fehlend`); die
    // Seite setzt keine eigene Zeile davor (Review O5: sonst stand er zweimal untereinander). Der
    // Quellenhinweis unter dem Lücken-Paneel gilt der ganzen Seite und bleibt.
    await waitFor(() =>
      expect(bild.props?.netz.fehlend).toContainEqual(
        expect.objectContaining({ name: 'Einheiten', zustand: 'fehler' }),
      ),
    );
    expect(screen.queryByText('Einheiten: nicht geladen')).toBeNull();
  });
});

/**
 * Darstellung „Sprechgruppen“ (LFH-848 D8): die Kanalbelegung als dritte Darstellung derselben
 * Seite. Umschalter dreistellig, Sichtvorgabe `?ansicht=sprechgruppen` apply-then-clean, Druckkopf
 * nennt die Darstellung, Lücken-Paneel und Übernahme bleiben die der Seite.
 */
describe('FunkplanPage — Darstellung Sprechgruppen (LFH-848)', () => {
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
  const plan = () => screen.getByRole('region', { name: 'Sprechgruppen' });
  const zeile = (c: HTMLElement, id: number) =>
    c.querySelector(`[aria-label="Sprechgruppen"] tr[data-row-key="sg-${id}"]`) as HTMLElement;
  const druckkopf = (c: HTMLElement) =>
    c.querySelector('[data-lfh="druckwurzel"] [data-lfh="druckkopf"]') as HTMLElement;

  // Der Server liefert an Zuordnung und Liste dieselbe Sprechgruppe, samt Hinweis.
  const TMO311 = { ...sg(1, 'TMO', 'TMO 311'), hinweis: 'Führungskanal' };

  beforeEach(() => {
    vi.mocked(listeAbschnitte).mockResolvedValue([
      { ...ABSCHNITTE[0], sprechgruppen: [TMO311, sg(2, 'DMO', 'DMO 505')] },
      ABSCHNITTE[1],
    ]);
    // Der 1. Zug arbeitet mit Abschnitt Nord auf TMO 311.
    vi.mocked(listeEinheiten).mockResolvedValue([{ ...EINHEITEN[0], sprechgruppen: [TMO311] }]);
    vi.mocked(listeEinsatzSprechgruppen).mockResolvedValue([
      TMO311,
      sg(2, 'DMO', 'DMO 505'),
      sg(9, 'DMO', 'DMO 999', true),
      // Katalog, nirgends zugeordnet: keine Sprechgruppe dieses Einsatzes.
      sg(4, 'TMO', 'TMO 400'),
    ]);
  });

  it('schaltet dreistellig um, auch ohne Schreibrecht; Spalten fest, Lücken bleiben', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue({ ...EINSATZ, meine_rolle: 'beobachter' });
    rendereMit();
    await screen.findByText('Florian 1/42-1');
    const umschalter = screen.getByRole('radiogroup', { name: 'Darstellung' });
    expect(
      within(umschalter)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['Tabelle', 'Skizze', 'Sprechgruppen']);
    await userEvent.click(within(umschalter).getByRole('radio', { name: 'Sprechgruppen' }));
    expect(within(umschalter).getByRole('radio', { name: 'Sprechgruppen' })).toBeChecked();
    const kopf = [...plan().querySelectorAll('th.ant-table-cell')].map((z) => z.textContent);
    expect(kopf).toEqual(['Sprechgruppe', 'Betriebsart', 'Hinweis', 'Herkunft', 'Teilnehmer']);
    // Die Funkplan-Tabelle ist weg, Fahrzeuge sind keine Teilnehmer.
    expect(screen.queryByRole('region', { name: 'Funkplan' })).toBeNull();
    expect(within(plan()).queryByText('Florian 1/42-1')).toBeNull();
    expect(screen.getByRole('region', { name: 'Lücken' })).toBeInTheDocument();
    // Katalog ohne Zuordnung fehlt; TMO vor DMO.
    expect(within(plan()).queryByText('TMO 400')).toBeNull();
    expect(
      [...plan().querySelectorAll('tr[data-row-key^="sg-"]')].map((z) =>
        z.getAttribute('data-row-key'),
      ),
    ).toEqual(['sg-1', 'sg-2', 'sg-9']);
  });

  it('nennt je Sprechgruppe die Teilnehmer mit Rufnamen, jede führt zu ihrem Datensatz', async () => {
    const { container } = rendereMit('/einsaetze/1/stab/funkplan?ansicht=sprechgruppen');
    await waitFor(() => expect(zeile(container, 1)).not.toBeNull());
    const tmo = zeile(container, 1);
    await waitFor(() => expect(within(tmo).getByRole('link', { name: '1. Zug' })).toBeVisible());
    expect(within(tmo).getByText('TMO 311')).toBeInTheDocument();
    expect(within(tmo).getByText('TMO')).toBeInTheDocument();
    expect(within(tmo).getByText('Führungskanal')).toBeInTheDocument();
    expect(within(tmo).getByText('Katalog')).toBeInTheDocument();
    expect(within(tmo).getByRole('link', { name: 'Abschnitt Nord' })).toHaveAttribute(
      'href',
      '/einsaetze/1/einsatzabschnitte?abschnitt=1',
    );
    expect(within(tmo).getByRole('link', { name: '1. Zug' })).toHaveAttribute(
      'href',
      '/einsaetze/1/einheiten/10',
    );
    expect(within(tmo).getByText('EA-N')).toBeInTheDocument();
    expect(within(tmo).getByText('Florian 1/10')).toBeInTheDocument();
    // Die Sprechgruppe selbst hat keine Seite: die Kennung ist kein Link.
    expect(within(tmo).queryByRole('link', { name: 'TMO 311' })).toBeNull();
  });

  it('zeigt eine einsatzlokale Sprechgruppe ohne Zuordnung mit „keine“ Teilnehmer', async () => {
    const { container } = rendereMit('/einsaetze/1/stab/funkplan?ansicht=sprechgruppen');
    await waitFor(() => expect(zeile(container, 9)).not.toBeNull());
    // Erst mit geladenen Abschnitten und Einheiten ist „keine“ belegt (vorher „lädt“).
    await waitFor(() => expect(within(zeile(container, 9)).getByText('keine')).toBeInTheDocument());
    expect(within(zeile(container, 9)).getByText('einsatzlokal')).toBeInTheDocument();
  });

  it('?ansicht=sprechgruppen öffnet die Darstellung, räumt den Parameter, nie zuerst die Tabelle', async () => {
    const { container } = rendereMit('/einsaetze/1/stab/funkplan?ansicht=sprechgruppen');
    const tabellen: number[] = [];
    const beobachter = new MutationObserver(() =>
      tabellen.push(container.querySelectorAll('[aria-label="Funkplan"]').length),
    );
    beobachter.observe(container, { childList: true, subtree: true });
    expect(await screen.findByRole('region', { name: 'Sprechgruppen' })).toBeInTheDocument();
    beobachter.disconnect();
    expect(Math.max(0, ...tabellen)).toBe(0);
    await waitFor(() => expect(screen.getByTestId('suche')).toHaveTextContent(/^$/));
    expect(screen.getByRole('radio', { name: 'Sprechgruppen' })).toBeChecked();
  });

  it('nennt im Druckkopf die Darstellung „Sprechgruppen“ und zählt keine Fahrzeuge', async () => {
    const { container } = rendereMit();
    await screen.findByText('Florian 1/42-1');
    expect(druckkopf(container)).not.toHaveTextContent('Sprechgruppen');
    await userEvent.click(screen.getByRole('radio', { name: 'Sprechgruppen' }));
    expect(druckkopf(container)).toHaveTextContent('Funkplan – Sprechgruppen');
    expect(druckkopf(container)).toHaveTextContent('3 Sprechgruppen · 2 Abschnitte · 1 Einheiten');
    expect(druckkopf(container)).not.toHaveTextContent('Fahrzeuge');
    expect(container.querySelectorAll('[data-lfh="druckwurzel"]')).toHaveLength(1);
  });

  it('Einheiten gesperrt: „—“ mit Grund statt „keine“, bekannte Teilnehmer „unvollständig“', async () => {
    vi.mocked(listeEinheiten).mockRejectedValue(new ApiError(403, 'verboten'));
    const { container } = rendereMit('/einsaetze/1/stab/funkplan?ansicht=sprechgruppen');
    await waitFor(() =>
      expect(
        within(zeile(container, 1)).getByRole('link', { name: 'Abschnitt Nord' }),
      ).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByText(/Einheiten: nicht freigegeben/)).toBeInTheDocument(),
    );
    const lokal = zeile(container, 9);
    expect(within(lokal).queryByText('keine')).toBeNull();
    expect(within(lokal).getByText(/—.*Einheiten nicht freigegeben/)).toBeInTheDocument();
    const tmo = zeile(container, 1);
    expect(within(tmo).getByRole('link', { name: 'Abschnitt Nord' })).toBeInTheDocument();
    expect(within(tmo).getByText(/unvollständig/)).toBeInTheDocument();
    expect(within(tmo).getByText(/Einheiten nicht freigegeben/)).toBeInTheDocument();
    // Oberhalb steht, dass die Einheiten fehlen.
    expect(screen.getByText(/Einheiten: nicht freigegeben/)).toBeInTheDocument();
  });

  it('nennt die fehlende Sprechgruppenliste, statt lokale ohne Zuordnung still wegzulassen', async () => {
    vi.mocked(listeEinsatzSprechgruppen).mockRejectedValue(new ApiError(500, 'kaputt'));
    const { container } = rendereMit('/einsaetze/1/stab/funkplan?ansicht=sprechgruppen');
    await waitFor(() => expect(zeile(container, 1)).not.toBeNull());
    expect(zeile(container, 9)).toBeNull();
    expect(
      await screen.findByText(/Sprechgruppen des Einsatzes: nicht geladen/),
    ).toBeInTheDocument();
  });

  it('übernimmt auch aus dieser Darstellung den Funkplan mit genau einem Aufruf', async () => {
    rendereMit('/einsaetze/1/stab/funkplan?ansicht=sprechgruppen');
    await screen.findByRole('region', { name: 'Sprechgruppen' });
    const knopf = screen.getByRole('button', { name: 'In Lagebericht übernehmen' });
    await waitFor(() => expect(knopf).toBeEnabled());
    await userEvent.click(knopf);
    await waitFor(() => expect(navigiere).toHaveBeenCalledWith('/einsaetze/1/lageberichte/77'));
    expect(legeLageberichtAn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(legeLageberichtAn).mock.calls[0][1].titel).toMatch(/^Funkplan /);
  });

  it('zeigt bei gesperrtem Stab auch mit ?ansicht=sprechgruppen nur die Sperre', async () => {
    vi.mocked(ladeModulFreigaben).mockResolvedValue(
      freigabenFixture({ stab: { sichtbar: false } }),
    );
    rendereMit('/einsaetze/1/stab/funkplan?ansicht=sprechgruppen');
    expect(
      await screen.findByText(/Stab ist in diesem Einsatz nicht freigegeben/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Sprechgruppen' })).toBeNull();
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

describe('FunkplanPage — eigene Führungsstelle (LFH-849)', () => {
  const FS = {
    rufname: 'Florian Stadt 10/1',
    sprechgruppen: [sg(1, 'TMO', 'TMO 311')],
    kommunikationsmittel: 'digitalfunk',
    erreichbarkeit: '0171 ELW',
  };

  it('steht erfasst als erste Zeile mit Verweis auf die Einsatzdaten; der Hinweis entfällt', async () => {
    vi.mocked(ladeFuehrungsstelle).mockResolvedValue(FS);
    const { container } = setup();
    await screen.findByText('Florian Stadt 10/1');
    await screen.findByText('Florian 1/42-1');
    const zeilen = [...container.querySelectorAll('tr[data-row-key]')].map((z) =>
      z.getAttribute('data-row-key'),
    );
    expect(zeilen[0]).toBe('fs');
    expect(zeilen[1]).toBe('ab-1');
    const fs = container.querySelector('tr[data-row-key="fs"]') as HTMLElement;
    expect(within(fs).getByRole('link', { name: 'Führungsstelle' })).toHaveAttribute(
      'href',
      '/einsaetze/1/einsatzdaten',
    );
    expect(within(fs).getByText('TMO 311')).toBeInTheDocument();
    expect(within(fs).getByText('Digitalfunk')).toBeInTheDocument();
    expect(within(luecken()).queryByText(/Eigene Gegenstelle/)).toBeNull();
  });

  it('nennt bei 403 den Grund statt „nicht erfasst“', async () => {
    vi.mocked(ladeFuehrungsstelle).mockRejectedValue(new ApiError(403, 'verboten'));
    setup();
    await screen.findByText('Florian 1/42-1');
    const zeile = await waitFor(() => lueckenZeile('Eigene Gegenstelle (Führungsstelle)'));
    await waitFor(() => expect(within(zeile).getByText(/nicht freigegeben/)).toBeInTheDocument());
    expect(within(zeile).queryByText(/nicht erfasst/)).toBeNull();
  });

  it('sperrt die Übernahme, solange die Führungsstelle noch lädt', async () => {
    vi.mocked(ladeFuehrungsstelle).mockReturnValue(new Promise(() => {}));
    setup();
    await screen.findByText('Florian 1/42-1');
    expect(screen.getByRole('button', { name: 'In Lagebericht übernehmen' })).toBeDisabled();
  });

  it('zählt die Verbindung Führungsstelle → oberster Abschnitt und verweist auf den Abschnitt', async () => {
    vi.mocked(ladeFuehrungsstelle).mockResolvedValue({
      sprechgruppen: [sg(7, 'TMO', 'TMO 700')],
    });
    setup();
    await screen.findByText('Florian 1/42-1');
    const zeile = lueckenZeile('Verbindungen ohne gemeinsame Sprechgruppe');
    await waitFor(() =>
      expect(
        within(zeile).getByRole('link', { name: 'Abschnitt Nord → Führungsstelle' }),
      ).toHaveAttribute('href', '/einsaetze/1/einsatzabschnitte?abschnitt=1'),
    );
  });

  it('übernimmt die Führungsstelle ohne ihre Erreichbarkeit in den Lagebericht', async () => {
    vi.mocked(ladeFuehrungsstelle).mockResolvedValue(FS);
    setup();
    await screen.findByText('Florian Stadt 10/1');
    await userEvent.click(screen.getByRole('button', { name: 'In Lagebericht übernehmen' }));
    await waitFor(() => expect(legeLageberichtAn).toHaveBeenCalledTimes(1));
    const text = vi.mocked(legeLageberichtAn).mock.calls[0][1].abschnitte![0].text as string;
    expect(text).toContain('- **Führungsstelle** · Rufname Florian Stadt 10/1 · TMO TMO 311');
    expect(text).not.toContain('0171 ELW');
  });
});

/**
 * Taktische Fernmeldeskizze (LFH-893, Spec-Delta `stab-funkplan`): Kommunikationsplan und
 * Skizzendaten als eigene Quellen, das Netz EINMAL für Skizze, Lücken-Paneel und Übernahme.
 */
describe('FunkplanPage — Fernmeldenetz (LFH-893)', () => {
  function rendereMit(route = '/einsaetze/1/stab/funkplan') {
    return renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/stab/funkplan" element={<FunkplanPage />} />
      </Routes>,
      { route },
    );
  }
  const SL_AS = sg(31, 'TMO', 'TMO SL AS');
  const LUECKEN_NEU = [
    'Sprechgruppen mit nur einem Teilnehmer',
    'Leitstelle: keine Verbindung erfasst',
  ];

  it('Sprechgruppe mit nur einem Teilnehmer: zählt „1“ und nennt „DMO 505“', async () => {
    // „TMO 311“ tragen Abschnitt Nord und der 1. Zug, „DMO 505“ nur der 1. Zug.
    vi.mocked(listeAbschnitte).mockResolvedValue([
      { ...ABSCHNITTE[0], sprechgruppen: [sg(1, 'TMO', 'TMO 311')] },
      ABSCHNITTE[1],
    ]);
    vi.mocked(listeEinheiten).mockResolvedValue([
      { ...EINHEITEN[0], sprechgruppen: [sg(1, 'TMO', 'TMO 311'), sg(2, 'DMO', 'DMO 505')] },
    ]);
    rendereMit();
    await screen.findByText('Florian 1/42-1');
    const z = lueckenZeile('Sprechgruppen mit nur einem Teilnehmer');
    await waitFor(() => expect(within(z).getByText('1')).toBeInTheDocument());
    expect(within(z).getByText('DMO 505')).toBeInTheDocument();
    expect(within(z).queryByText('TMO 311')).toBeNull();
    // Eine einsatzlokale ohne Teilnehmer zählt nur bei „ohne Zuordnung“.
    expect(within(z).queryByText('DMO 999')).toBeNull();
  });

  it('Leitstelle ohne Verbindung: die Lücke verweist auf den Kommunikationsplan', async () => {
    vi.mocked(ladeKommunikationsplan).mockResolvedValue([leitstelle()]);
    rendereMit();
    await screen.findByText('Florian 1/42-1');
    const z = await waitFor(() => lueckenZeile('Leitstelle: keine Verbindung erfasst'));
    expect(within(z).getByRole('link', { name: 'im Kommunikationsplan erfassen' })).toHaveAttribute(
      'href',
      '/einsaetze/1/stab/kommunikationsplan',
    );
  });

  it('eine Verbindung der Leitstelle in der Skizze schließt die Lücke', async () => {
    vi.mocked(ladeKommunikationsplan).mockResolvedValue([leitstelle()]);
    vi.mocked(ladeFernmeldeskizze).mockResolvedValue(
      skizze({
        verbindungen: [
          {
            id: 1,
            von: { art: 'stelle', id: 5 },
            nach: { art: 'fuehrungsstelle', id: null },
            art: 'telefon',
            medium: 'leitung',
            status: 'bestehend',
            verkehr: null,
            hinweis: null,
          },
        ],
      }),
    );
    rendereMit();
    await screen.findByText('Florian 1/42-1');
    // Erst mit allen Quellen steht eine Zahl: TMO 311 und DMO 505 trägt nur Abschnitt Nord.
    await waitFor(() =>
      expect(
        within(lueckenZeile('Sprechgruppen mit nur einem Teilnehmer')).getByText('2'),
      ).toBeInTheDocument(),
    );
    expect(within(luecken()).queryByText('Leitstelle: keine Verbindung erfasst')).toBeNull();
    expect(within(luecken()).queryByText('Leitstelle')).toBeNull();
  });

  it('Kommunikationsplan nicht geladen: „—“ mit Grund, nicht „0“', async () => {
    vi.mocked(ladeKommunikationsplan).mockRejectedValue(new ApiError(500, 'kaputt'));
    rendereMit();
    await screen.findByText('Florian 1/42-1');
    const z = await waitFor(() => lueckenZeile('Leitstelle'));
    await waitFor(() =>
      expect(within(z).getByText('Kommunikationsplan nicht geladen')).toBeInTheDocument(),
    );
    expect(within(z).getByText('—')).toBeInTheDocument();
    const eins = lueckenZeile('Sprechgruppen mit nur einem Teilnehmer');
    expect(within(eins).getByText('—')).toBeInTheDocument();
    expect(within(eins).queryByText('0')).toBeNull();
  });

  it('Skizzendaten nicht geladen: die Lücke „Leitstelle“ nennt die Fernmeldeskizze', async () => {
    vi.mocked(ladeKommunikationsplan).mockResolvedValue([leitstelle()]);
    vi.mocked(ladeFernmeldeskizze).mockRejectedValue(new ApiError(500, 'kaputt'));
    rendereMit();
    await screen.findByText('Florian 1/42-1');
    await waitFor(() =>
      expect(
        within(lueckenZeile('Leitstelle')).getByText('Fernmeldeskizze nicht geladen'),
      ).toBeInTheDocument(),
    );
  });

  it('die neuen Lücken stehen in allen drei Darstellungen', async () => {
    vi.mocked(ladeKommunikationsplan).mockResolvedValue([leitstelle()]);
    rendereMit();
    await screen.findByText('Florian 1/42-1');
    for (const ansicht of ['Tabelle', 'Skizze', 'Sprechgruppen']) {
      await userEvent.click(screen.getByRole('radio', { name: ansicht }));
      for (const titel of LUECKEN_NEU) {
        await waitFor(() => expect(lueckenZeile(titel)).not.toBeNull());
      }
    }
  });

  it('Klick im Paneel wählt in der Skizze das Element; in der Tabelle bleibt es ein Verweis', async () => {
    rendereMit('/einsaetze/1/stab/funkplan?ansicht=skizze');
    await screen.findByRole('region', { name: 'Fernmeldeskizze' });
    const einheiten = lueckenZeile('Einheiten ohne Sprechgruppe');
    await waitFor(() => expect(within(einheiten).getByText('1')).toBeInTheDocument());
    expect(within(einheiten).queryByRole('link', { name: '1. Zug' })).toBeNull();
    await userEvent.click(within(einheiten).getByRole('button', { name: '1. Zug' }));
    expect(screen.getByTestId('gewaehlt')).toHaveTextContent('eh-10');
    expect(bild.props?.gewaehlt).toBe('eh-10');
    // Schiene: Sprechgruppe mit nur einem Teilnehmer.
    await userEvent.click(
      within(lueckenZeile('Sprechgruppen mit nur einem Teilnehmer')).getByRole('button', {
        name: 'DMO 505',
      }),
    );
    expect(bild.props?.gewaehlt).toBe('sg-2');
    // Die Fläche meldet ihre Wahl zurück (Klick ins Leere).
    act(() => bild.props?.onWahl?.(null));
    expect(screen.getByTestId('gewaehlt')).toHaveTextContent(/^$/);
    await userEvent.click(screen.getByRole('radio', { name: 'Tabelle' }));
    expect(
      within(lueckenZeile('Einheiten ohne Sprechgruppe')).getByRole('link', { name: '1. Zug' }),
    ).toHaveAttribute('href', '/einsaetze/1/einheiten/10');
  });

  it('gibt der Skizze Netz, Einsatzbezeichnung und Aktionen; ohne Schreibrecht keine Aktionen', async () => {
    rendereMit('/einsaetze/1/stab/funkplan?ansicht=skizze');
    await screen.findByRole('region', { name: 'Fernmeldeskizze' });
    await waitFor(() => expect(bild.props?.netz.darstellbar).toBe(true));
    expect(bild.props?.einsatzbezeichnung).toBe('Hochwasser Nord');
    expect(bild.props?.netz.einsatzId).toBe(1);
    expect(bild.props?.aktionen).not.toBeNull();
    expect(bild.props?.netz.rechte.stab).toBe(true);
  });

  it('Beobachter: die Skizze ist schreibgeschützt', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue({ ...EINSATZ, meine_rolle: 'beobachter' });
    rendereMit('/einsaetze/1/stab/funkplan?ansicht=skizze');
    await screen.findByRole('region', { name: 'Fernmeldeskizze' });
    await waitFor(() => expect(bild.props?.netz.darstellbar).toBe(true));
    expect(bild.props?.aktionen).toBeNull();
    expect(bild.props?.netz.rechte.stab).not.toBe(true);
  });

  it('Leitstelle als Teilnehmer: mit „geplant“ und Verweis auf den Kommunikationsplan', async () => {
    vi.mocked(ladeKommunikationsplan).mockResolvedValue([
      leitstelle({ sprechgruppen: [{ sprechgruppe: SL_AS, status: 'geplant' }] }),
    ]);
    const { container } = rendereMit('/einsaetze/1/stab/funkplan?ansicht=sprechgruppen');
    await waitFor(() =>
      expect(
        container.querySelector('[aria-label="Sprechgruppen"] tr[data-row-key="sg-31"]'),
      ).not.toBeNull(),
    );
    const z = container.querySelector(
      '[aria-label="Sprechgruppen"] tr[data-row-key="sg-31"]',
    ) as HTMLElement;
    expect(within(z).getByRole('link', { name: 'ILS Musterhausen' })).toHaveAttribute(
      'href',
      '/einsaetze/1/stab/kommunikationsplan',
    );
    expect(within(z).getByText('geplant')).toBeInTheDocument();
  });

  it('Komponente als Teilnehmer: ohne Verweis', async () => {
    vi.mocked(ladeFernmeldeskizze).mockResolvedValue(
      skizze({
        komponenten: [
          {
            id: 2,
            art: 'repeater',
            bezeichnung: 'RP Nord',
            sprechgruppen: [sg(2, 'DMO', 'DMO 505')],
          },
        ],
      }),
    );
    const { container } = rendereMit('/einsaetze/1/stab/funkplan?ansicht=sprechgruppen');
    await waitFor(() =>
      expect(
        within(
          container.querySelector(
            '[aria-label="Sprechgruppen"] tr[data-row-key="sg-2"]',
          ) as HTMLElement,
        ).getByText('RP Nord'),
      ).toBeInTheDocument(),
    );
    const z = container.querySelector(
      '[aria-label="Sprechgruppen"] tr[data-row-key="sg-2"]',
    ) as HTMLElement;
    expect(within(z).queryByRole('link', { name: 'RP Nord' })).toBeNull();
  });

  it('übernimmt den Abschnitt „Kommunikationsskizze“ mit „Gültig ab“, ohne Rufnummer', async () => {
    vi.mocked(ladeKommunikationsplan).mockResolvedValue([
      leitstelle({
        sprechgruppen: [{ sprechgruppe: sg(1, 'TMO', 'TMO 311'), status: 'geplant' }],
        verbindungen: [{ id: 1, mittel: 'festnetz', wert: '0221 112' }],
      }),
    ]);
    vi.mocked(ladeFernmeldeskizze).mockResolvedValue(
      skizze({
        schriftfeld: {
          herausgeber: null,
          vs_vermerk: 'keiner',
          gueltig_ab: '2026-07-16T12:30:00Z',
          gez_name: null,
          gez_at: null,
        },
      }),
    );
    rendereMit();
    await screen.findByText('Florian 1/42-1');
    const knopf = screen.getByRole('button', { name: 'In Lagebericht übernehmen' });
    await waitFor(() => expect(knopf).toBeEnabled());
    await userEvent.click(knopf);
    await waitFor(() => expect(legeLageberichtAn).toHaveBeenCalledTimes(1));
    const text = vi.mocked(legeLageberichtAn).mock.calls[0][1].abschnitte![0].text;
    expect(text).toContain('## Kommunikationsskizze');
    expect(text).toMatch(/\*\*Gültig ab:\*\* \d{6}[A-Z]{3}\d{4}/);
    expect(text).toMatch(/TMO 311: .*ILS Musterhausen \(geplant\)/);
    expect(text).not.toContain('0221 112');
  });

  it('sperrt die Übernahme, solange der Kommunikationsplan noch lädt', async () => {
    vi.mocked(ladeKommunikationsplan).mockReturnValue(new Promise(() => {}));
    rendereMit();
    await screen.findByText('Florian 1/42-1');
    expect(screen.getByRole('button', { name: 'In Lagebericht übernehmen' })).toBeDisabled();
  });

  it('fragt Kommunikationsplan und Skizze nicht an, wenn der Stab gesperrt ist', async () => {
    vi.mocked(ladeKommunikationsplan).mockClear();
    vi.mocked(ladeFernmeldeskizze).mockClear();
    vi.mocked(ladeModulFreigaben).mockResolvedValue(freigabenFixture({ stab: { zugriff: false } }));
    rendereMit();
    await screen.findByText(/Stab ist in diesem Einsatz nicht freigegeben/);
    expect(vi.mocked(ladeKommunikationsplan)).not.toHaveBeenCalled();
    expect(vi.mocked(ladeFernmeldeskizze)).not.toHaveBeenCalled();
  });
});
