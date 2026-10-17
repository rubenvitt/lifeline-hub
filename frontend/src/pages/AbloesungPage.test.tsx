import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router';
import AbloesungPage, { SCHICHT_HERVORHEBUNG_MS } from './AbloesungPage';
import { ApiError } from '../api/client';
import { AuthProvider } from '../auth/AuthContext';
import type { Abloesung, ModulFreigaben } from '../api/types';
import { freigabenFixture } from '../test/fixtures';
import { setzeViewportBreite } from '../test/viewport';

dayjs.extend(utc);

const einsatz = vi.hoisted(() => ({
  wert: { id: 1, bezeichnung: 'Hochwasser', status: 'aktiv', meine_rolle: 'einsatzleitung' },
}));
const freigaben = vi.hoisted(() => ({ wert: undefined as ModulFreigaben | undefined }));
vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn(() => Promise.resolve(einsatz.wert)),
  ladeModulFreigaben: vi.fn(() => Promise.resolve(freigaben.wert)),
}));
const listeEinsatzPersonal = vi.fn();
vi.mock('../api/einsatzPersonal', () => ({
  listeEinsatzPersonal: (...a: unknown[]) => listeEinsatzPersonal(...a),
}));
const EINHEITEN = [
  {
    id: 11,
    name: 'Florian 1',
    abschnitt_id: 7,
    personal_mitglieder: [{ ep_id: 20, name: 'Anna Alt', ist_fuehrer: false }],
  },
  { id: 12, name: 'Florian 2', abschnitt_id: null },
  { id: 13, name: 'Florian 3', abschnitt_id: 7 },
];
const einheiten = vi.hoisted(() => ({ wert: undefined as unknown[] | undefined }));
vi.mock('../api/einheiten', () => ({
  listeEinheiten: vi.fn(() => Promise.resolve(einheiten.wert ?? EINHEITEN)),
}));

// Räume für die Klammer der Kartenzeile zum Ablöser (LLH-1131 Teil II).
const listeBr = vi.fn();
vi.mock('../api/einsatzBereitstellungsraum', () => ({
  listeBr: (...a: unknown[]) => listeBr(...a),
}));

const listeEinheitenPerioden = vi.fn();
vi.mock('../api/kraefteZeitachse', () => ({
  listeEinheitenPerioden: (...a: unknown[]) => listeEinheitenPerioden(...a),
}));

const listeAbloesungen = vi.fn();
const listeAbloesungVorgaben = vi.fn();
const beginneSchicht = vi.fn();
const vollzieheAbloesung = vi.fn();
const nimmVollzugZurueck = vi.fn();
const aendereSchicht = vi.fn();
const setzeAbloesungVorgabe = vi.fn();
const fetchEinsatzSchichtmodell = vi.fn();
vi.mock('../api/abloesungen', () => ({
  fetchEinsatzSchichtmodell: (...a: unknown[]) => fetchEinsatzSchichtmodell(...a),
  listeAbloesungen: (...a: unknown[]) => listeAbloesungen(...a),
  listeAbloesungVorgaben: (...a: unknown[]) => listeAbloesungVorgaben(...a),
  beginneSchicht: (...a: unknown[]) => beginneSchicht(...a),
  vollzieheAbloesung: (...a: unknown[]) => vollzieheAbloesung(...a),
  nimmVollzugZurueck: (...a: unknown[]) => nimmVollzugZurueck(...a),
  aendereSchicht: (...a: unknown[]) => aendereSchicht(...a),
  setzeAbloesungVorgabe: (...a: unknown[]) => setzeAbloesungVorgabe(...a),
}));

/** Wire-Zeit (UTC ohne Zone) relativ zu jetzt. */
const inMinuten = (m: number) => dayjs.utc().add(m, 'minute').format('YYYY-MM-DD HH:mm:ss');

const schicht = (over: Partial<Abloesung> & { id: number }): Abloesung => ({
  einsatz_id: 1,
  einheit_id: 10 + over.id,
  einheit_name: `Florian ${over.id}`,
  abschnitt_id: 7,
  abschnitt_name: 'Deichwache Nord',
  beginn_at: inMinuten(-300),
  rhythmus_minuten: 360,
  vorwarnung_minuten: 30,
  rhythmus_quelle: 'abschnitt',
  faellig_at: inMinuten(60),
  status: 'laufend',
  ruecknehmbar: false,
  erbende_einheiten: [],
  abloeser: [],
  folgeschichten: [],
  uebernommen_bei_vollzug: false,
  art: 'einheit',
  besatzung: [],
  abschnitt_uebergeben: false,
  planung_warnungen: [],
  angelegt_at: inMinuten(-300),
  ...over,
});

/** Springt im laufenden Router, wie ein Klick auf einen Toast der AlarmZentrale. */
const springe: { zu: (pfad: string) => void } = { zu: () => {} };
function Springer() {
  const navigate = useNavigate();
  springe.zu = (pfad) => void navigate(pfad);
  return null;
}
/** Die Suche der aktuellen Adresse, damit ein Test das Räumen des Parameters sieht. */
const adresse = { suche: '' };
function Adresse() {
  adresse.suche = useLocation().search;
  return null;
}

function renderPage(route = '/einsaetze/1/abloesung') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ergebnis = render(
    <QueryClientProvider client={client}>
      <AntApp>
        <AuthProvider>
          <MemoryRouter initialEntries={[route]}>
            <Springer />
            <Adresse />
            <Routes>
              <Route path="/einsaetze/:id/abloesung" element={<AbloesungPage />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </AntApp>
    </QueryClientProvider>,
  );
  return { ...ergebnis, client };
}

const kartenNamen = () => screen.getAllByRole('article').map((k) => k.getAttribute('aria-label'));
const sammelbanner = () => document.querySelector('[data-lfh="sammelbanner"]');

/** Stellt die Server-Antwort für „laufend" um; „abgelöst" bleibt leer. */
function laufendLiefert(schichten: Abloesung[]) {
  listeAbloesungen.mockImplementation((_e: number, status: string) =>
    Promise.resolve(status === 'laufend' ? schichten : []),
  );
}

describe('AbloesungPage (LFH-635)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    freigaben.wert = freigabenFixture();
    einsatz.wert = {
      id: 1,
      bezeichnung: 'Hochwasser',
      status: 'aktiv',
      meine_rolle: 'einsatzleitung',
    };
    // Server-Ordnung: nach Fälligkeit — die Seite zeigt sie unverändert.
    listeAbloesungen.mockImplementation((_e: number, status: string) =>
      Promise.resolve(
        status === 'laufend'
          ? [
              schicht({ id: 1, faellig_at: inMinuten(-12) }),
              schicht({ id: 2, faellig_at: inMinuten(20) }),
              schicht({ id: 3, faellig_at: inMinuten(240), rhythmus_quelle: 'einheit' }),
            ]
          : [],
      ),
    );
    listeEinheitenPerioden.mockResolvedValue([]);
    fetchEinsatzSchichtmodell.mockResolvedValue({ vorwarnung_minuten: 30, laufende_schichten: 0 });
    listeAbloesungVorgaben.mockResolvedValue([
      {
        abschnitt_id: 7,
        abschnitt_name: 'Deichwache Nord',
        rhythmus_minuten: 360,
        laufende_schichten: 3,
      },
    ]);
  });

  it('zeigt die Schichten in Fälligkeitsordnung, überfällig mit Wort, Rand und ohne Animation', async () => {
    renderPage();
    const karten = await screen.findAllByRole('article');
    expect(karten.map((k) => k.getAttribute('aria-label'))).toEqual([
      'Schicht Florian 1',
      'Schicht Florian 2',
      'Schicht Florian 3',
    ]);
    const [ueber, bald, plan] = karten;
    expect(ueber).toHaveAttribute('data-alarm', 'true');
    expect(ueber).toHaveAttribute('data-einstufung', 'ueberfaellig');
    expect(within(ueber).getByText('überfällig')).toBeInTheDocument();
    expect(within(ueber).getByText(/^seit 1\d min$/)).toBeInTheDocument();
    expect(bald).toHaveAttribute('data-einstufung', 'vorwarnung');
    expect(within(bald).getByText('Ablösung bald fällig')).toBeInTheDocument();
    expect(plan).toHaveAttribute('data-einstufung', 'planmaessig');
    expect(plan).not.toHaveAttribute('data-alarm');
    // Kein Blinken: keine Animation an der Karte.
    expect(ueber.style.animation).toBe('');
    // Kopf nennt Zahl der laufenden und der fälligen (Vorwarnung + überfällig).
    expect(screen.getByText('3 laufend · 2 fällig')).toBeInTheDocument();
    // Herkunft des Rhythmus als Wort, in einer eigenen Zeile (LFH-708): eine fremde
    // Rhythmusänderung berührt nur diese Zeile, nicht den Umbruch von Abschnitt und Beginn.
    const rhythmus = (k: HTMLElement) =>
      k.querySelector<HTMLElement>('[data-lfh="abloesung-rhythmus"]');
    expect(rhythmus(bald)).toHaveTextContent(/^Rhythmus 6 h \(Vorgabe\)$/);
    expect(rhythmus(plan)).toHaveTextContent(/^Rhythmus 6 h \(eigen\)$/);
    const herkunft = within(bald).getByText(/^Deichwache Nord · im Einsatz seit$/);
    expect(herkunft).toHaveTextContent(/^Deichwache Nord · im Einsatz seit \d{4,6}$/);
    expect(herkunft).not.toContainElement(rhythmus(bald));
  });

  it('eine Schicht nach der Vorgabe des Einsatzes nennt „Vorgabe Einsatz“ (LLH-1122)', async () => {
    listeAbloesungen.mockImplementation((_e: number, status: string) =>
      Promise.resolve(
        status === 'laufend'
          ? [
              schicht({ id: 1, rhythmus_quelle: 'einsatz', rhythmus_minuten: 450 }),
              schicht({ id: 2, faellig_at: inMinuten(90) }),
            ]
          : [],
      ),
    );
    renderPage();
    const [einsatzKarte, abschnittKarte] = await screen.findAllByRole('article');
    // Dauer als „7:30 h“, nie „7.5“ oder „7 h 30 min“ (LLH-1122).
    expect(einsatzKarte.querySelector('[data-lfh="abloesung-rhythmus"]')).toHaveTextContent(
      /^Rhythmus 7:30 h \(Vorgabe Einsatz\)$/,
    );
    // Die Abschnittsvorgabe bleibt kurz: den Abschnitt nennt die Zeile darüber (LFH-708).
    expect(abschnittKarte.querySelector('[data-lfh="abloesung-rhythmus"]')).toHaveTextContent(
      /^Rhythmus 6 h \(Vorgabe\)$/,
    );
  });

  it('das Paneel „Vorgabe des Einsatzes“ nennt Modell, Regel und Vorwarnung (LLH-1122)', async () => {
    fetchEinsatzSchichtmodell.mockResolvedValue({
      schichtmodell: {
        bezeichnung: '12-h-Schicht Hochwasser',
        typ: 'wechselzeiten',
        wechselzeiten: ['06:00', '18:00'],
        mindestdauer_minuten: 240,
        vorwarnung_minuten: 45,
        planungsvorlauf_minuten: 120,
        geaendert_at: inMinuten(-60),
      },
      vorwarnung_minuten: 45,
      laufende_schichten: 2,
    });
    renderPage();
    const paneel = await screen.findByRole('region', { name: 'Vorgabe des Einsatzes' });
    await waitFor(() =>
      expect(paneel).toHaveTextContent(
        '12-h-Schicht Hochwasser Wechsel 0600/1800 · Mindestdauer 4 h · Vorwarnung 45 min · 2 laufend',
      ),
    );
    // Gesetzt wird in den Einsatz-Einstellungen; hier nur der Sprung dorthin.
    expect(
      within(paneel).getByRole('link', { name: 'Vorgabe des Einsatzes ändern' }),
    ).toHaveAttribute('href', '/einsaetze/1/einstellungen/abloesung');
  });

  it('ohne Vorgabe des Einsatzes: „keine Vorgabe“ (LLH-1122)', async () => {
    renderPage();
    const paneel = await screen.findByRole('region', { name: 'Vorgabe des Einsatzes' });
    await waitFor(() => expect(paneel).toHaveTextContent('keine Vorgabe'));
  });

  it('Schicht beginnen: die Vorgabe des Einsatzes macht den Rhythmus entbehrlich (LLH-1122)', async () => {
    fetchEinsatzSchichtmodell.mockResolvedValue({
      schichtmodell: {
        bezeichnung: 'Sanitätsdienst',
        typ: 'rhythmus',
        rhythmus_minuten: 720,
        vorwarnung_minuten: 30,
        planungsvorlauf_minuten: 120,
        geaendert_at: inMinuten(-60),
      },
      vorwarnung_minuten: 30,
      laufende_schichten: 0,
    });
    listeAbloesungen.mockResolvedValue([]);
    beginneSchicht.mockResolvedValue(schicht({ id: 2 }));
    renderPage();
    await screen.findByText('Keine laufenden Schichten');
    await userEvent.click(screen.getByRole('button', { name: 'Schicht beginnen' }));
    const dialog = await screen.findByRole('dialog');
    // Florian 2 hat keinen Abschnitt, also gilt die Vorgabe des Einsatzes.
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Einheit' }));
    await userEvent.click(await screen.findByTitle('Florian 2'));
    const feld = within(dialog).getByRole('textbox', { name: 'Rhythmus' });
    await waitFor(() => expect(feld).toHaveAttribute('placeholder', '12 h (Vorgabe Einsatz)'));
    expect(feld).not.toBeRequired();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schicht beginnen' }));
    await waitFor(() =>
      expect(beginneSchicht).toHaveBeenCalledWith(1, {
        einheit_id: 12,
        beginn_at: undefined,
        rhythmus_minuten: undefined,
      }),
    );
  });

  it('Rhythmus einer Schicht: nur die Vorgabe des Einsatzes erlaubt ein leeres Feld (LLH-1122)', async () => {
    fetchEinsatzSchichtmodell.mockResolvedValue({
      schichtmodell: {
        bezeichnung: 'Hochwasser',
        typ: 'wechselzeiten',
        wechselzeiten: ['06:00', '18:00'],
        mindestdauer_minuten: 240,
        vorwarnung_minuten: 30,
        planungsvorlauf_minuten: 120,
        geaendert_at: inMinuten(-60),
      },
      vorwarnung_minuten: 30,
      laufende_schichten: 1,
    });
    laufendLiefert([
      schicht({
        id: 4,
        abschnitt_id: undefined,
        abschnitt_name: undefined,
        rhythmus_quelle: 'einheit',
        rhythmus_minuten: 450,
      }),
    ]);
    aendereSchicht.mockResolvedValue(schicht({ id: 4 }));
    renderPage();
    await screen.findAllByRole('article');
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen zu Florian 4' }));
    const menu = document.querySelector(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    ) as HTMLElement;
    await userEvent.click(within(menu).getByText('Rhythmus ändern'));
    const dialog = await screen.findByRole('dialog');
    const feld = within(dialog).getByRole('textbox', { name: 'Rhythmus' });
    // Der eigene Wert steht als Dauer im Feld, nie „7.5“.
    expect(feld).toHaveValue('7:30 h');
    expect(feld).toHaveAttribute('placeholder', 'Wechsel 0600/1800 (Vorgabe Einsatz)');
    expect(feld).not.toBeRequired();
    await userEvent.clear(feld);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(aendereSchicht).toHaveBeenCalledWith(1, 4, { rhythmus_minuten: null }),
    );
  });

  it('der Beginn steht in Mono mit festen Ziffern (LFH-771)', async () => {
    // Zeiten sind immer Mono mit `tabular-nums` (`frontend/AGENTS.md`, Gestaltungssprache).
    // In der Textschrift hing die Breite von `seit HHmm` an den Ziffern (Archivo hat
    // proportionale Ziffern): dieselbe Karte brach je nach Beginn anders um.
    renderPage();
    const karten = await screen.findAllByRole('article');
    for (const k of karten) {
      const beginn = k.querySelector<HTMLElement>('[data-lfh="abloesung-beginn"]')!;
      expect(beginn).toHaveTextContent(/^\d{4,6}$/);
      expect(beginn.style.fontFamily).toContain('JetBrains Mono');
      expect(beginn.style.fontVariantNumeric).toBe('tabular-nums');
    }
  });

  it('die Zeit trägt die Mindestbreite von sechs Ziffern (6ch)', async () => {
    // `kurz` zeigt heute `HHmm`, sonst `DDHHmm`. Wüchse die Spalte mit dem Text, bräche die
    // Karte kurz vor Mitternacht anders um als am Tag (LFH-708, Kriterium 12). jsdom misst
    // nicht; die Breite gegen sechs Ziffern belegt `e2e/abloesung-zufluss.spec.ts`.
    renderPage();
    const karten = await screen.findAllByRole('article');
    for (const k of karten) {
      const zeit = k.querySelector<HTMLElement>('[data-lfh="abloesung-zeit"]')!;
      expect(zeit.style.minWidth).toBe('6ch');
    }
  });

  it('ohne Schreibrecht: Grund im Kopf, Primäraktion gesperrt, keine Kartenaktionen', async () => {
    einsatz.wert = { ...einsatz.wert, meine_rolle: 'beobachter' };
    renderPage();
    await screen.findAllByRole('article');
    expect(screen.getByText('nur Einsatzleitung und Führungspersonal')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Schicht beginnen' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Ablösung vollziehen' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Aktionen zu/ })).toBeNull();
  });

  it('Vollzug: Dialog vorbelegt, POST, Rückgängig ruft die Rücknahme', async () => {
    const a = schicht({ id: 1, faellig_at: inMinuten(-12), abloesende_einheit_id: 12 });
    listeAbloesungen.mockImplementation((_e: number, status: string) =>
      Promise.resolve(status === 'laufend' ? [a] : []),
    );
    const folge = schicht({ id: 2, einheit_id: 12, einheit_name: 'Florian 2' });
    vollzieheAbloesung.mockResolvedValue({
      abgeloest: { ...a, status: 'abgeloest', ruecknehmbar: true },
      folgeschicht: folge,
      folgeschichten: [folge],
    });
    nimmVollzugZurueck.mockResolvedValue(a);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Ablösung vollziehen' }));
    const dialog = await screen.findByRole('dialog');
    // Struktur, aus der „Enter sendet" folgt: Knopf im <form>, kein antd-Fuß. Ein Select-Feld nimmt
    // Enter selbst — die Zusicherung ist die Struktur.
    const knopf = within(dialog).getByRole('button', { name: 'Vollziehen' });
    expect(knopf.closest('form')).not.toBeNull();
    expect(dialog.querySelector('.ant-modal-footer')).toBeNull();
    await userEvent.click(knopf);
    // Vorbelegt mit der Planung (Spiegel), als Liste (LLH-1132); die Schicht hat keinen
    // Abschnitt, also nichts zu übergeben.
    await waitFor(() =>
      expect(vollzieheAbloesung).toHaveBeenCalledWith(1, 1, {
        vollzogen_at: undefined,
        abloeser_ids: [12],
        abschnitt_uebergeben: false,
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: /Rückgängig/ }));
    await waitFor(() => expect(nimmVollzugZurueck).toHaveBeenCalledWith(1, 1));
  });

  /** LLH-1150: Besatzungswechsel aus dem Dialog, die neue Besatzung aus dem Personal. */
  it('Besatzungswechsel: bisherige Besatzung vorbelegt, neue gewählt, POST und Hinweis', async () => {
    const a = schicht({ id: 1, faellig_at: inMinuten(-12) });
    listeAbloesungen.mockImplementation((_e: number, status: string) =>
      Promise.resolve(status === 'laufend' ? [a] : []),
    );
    listeEinsatzPersonal.mockResolvedValue([
      { id: 20, name: 'Anna Alt', einheit_id: 11 },
      { id: 21, name: 'Cora Neu', einheit_id: null },
    ]);
    const folge = schicht({ id: 2, einheit_id: 11, einheit_name: 'Florian 1', vorgaenger_id: 1 });
    vollzieheAbloesung.mockResolvedValue({
      abgeloest: {
        ...a,
        status: 'abgeloest',
        ruecknehmbar: true,
        art: 'besatzung',
        besatzung: [
          { personal_id: 20, name: 'Anna Alt', rolle: 'alt' },
          { personal_id: 21, name: 'Cora Neu', rolle: 'neu' },
        ],
      },
      folgeschicht: folge,
      folgeschichten: [folge],
    });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Ablösung vollziehen' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(
      within(dialog).getByRole('radio', { name: 'Besatzungswechsel' }).closest('label')!,
    );
    expect(
      await within(dialog).findByText('Bisherige Besatzung: Anna Alt', { exact: false }),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Neue Besatzung' }));
    await userEvent.click(await screen.findByTitle('Cora Neu'));
    // Die bisherige Besatzung ist nicht wählbar.
    expect(document.querySelector('.ant-select-item-option[title="Anna Alt"]')).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vollziehen' }));
    await waitFor(() =>
      expect(vollzieheAbloesung).toHaveBeenCalledWith(1, 1, {
        vollzogen_at: undefined,
        art: 'besatzung',
        besatzung_ids: [21],
      }),
    );
    expect(
      await screen.findByText('Besatzungswechsel vollzogen: Florian 1, neu Cora Neu'),
    ).toBeInTheDocument();
    expect(listeEinsatzPersonal).toHaveBeenCalledWith(1);
  });

  it('Besatzungswechsel ohne Freigabe des Moduls Personal: gesperrt mit Grund, keine Anfrage', async () => {
    freigaben.wert = freigabenFixture({ personal: { zugriff: false } });
    renderPage();
    const knoepfe = await screen.findAllByRole('button', { name: 'Ablösung vollziehen' });
    await userEvent.click(knoepfe[0]);
    const dialog = await screen.findByRole('dialog');
    const wechsel = within(dialog).getByRole('radio', { name: 'Besatzungswechsel' });
    await waitFor(() => expect(wechsel).toBeDisabled());
    expect(within(dialog).getByText('Modul Personal gesperrt')).toBeInTheDocument();
    expect(listeEinsatzPersonal).not.toHaveBeenCalled();
  });

  it('Schicht beginnen: Enter-Struktur und Rhythmus als Dauer → Minuten', async () => {
    listeAbloesungen.mockResolvedValue([]);
    beginneSchicht.mockResolvedValue(schicht({ id: 2 }));
    renderPage();
    await screen.findByText('Keine laufenden Schichten');
    await userEvent.click(screen.getByRole('button', { name: 'Schicht beginnen' }));
    const dialog = await screen.findByRole('dialog');
    const knopf = within(dialog).getByRole('button', { name: 'Schicht beginnen' });
    expect(knopf.closest('form')).not.toBeNull();
    expect(dialog.querySelector('.ant-modal-footer')).toBeNull();
    // Einheit wählen (Florian 2 hat keine Abschnittsvorgabe → Rhythmus ist Pflicht)
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Einheit' }));
    await userEvent.click(await screen.findByTitle('Florian 2'));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Rhythmus' }), '4:30');
    await userEvent.click(knopf);
    await waitFor(() =>
      expect(beginneSchicht).toHaveBeenCalledWith(1, {
        einheit_id: 12,
        beginn_at: undefined,
        rhythmus_minuten: 270,
      }),
    );
  });

  it('Rhythmus-Vorgabe am Abschnitt: Minuten senden, leer entfernt', async () => {
    setzeAbloesungVorgabe.mockResolvedValue([]);
    renderPage();
    await screen.findAllByRole('article');
    const aendern = () =>
      userEvent.click(
        screen.getByRole('button', { name: 'Rhythmus-Vorgabe Deichwache Nord ändern' }),
      );
    await aendern();
    let dialog = await screen.findByRole('dialog');
    const feld = within(dialog).getByRole('textbox', { name: 'Rhythmus' });
    // Vorbelegt als Dauer, nie „6.0“ (LLH-1122).
    expect(feld).toHaveValue('6 h');
    await userEvent.clear(feld);
    await userEvent.type(feld, '8');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(setzeAbloesungVorgabe).toHaveBeenCalledWith(1, 7, 480));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await aendern();
    dialog = await screen.findByRole('dialog');
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'Rhythmus' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(setzeAbloesungVorgabe).toHaveBeenLastCalledWith(1, 7, null));
  });

  // ── LFH-1078: zeigen statt erklären ──
  it('leer: kein Anleitungssatz, „Schicht beginnen“ steht im Kopf', async () => {
    listeAbloesungen.mockResolvedValue([]);
    renderPage();
    await screen.findByText('Keine laufenden Schichten');
    expect(screen.queryByText(/Mit „Schicht beginnen/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Schicht beginnen' })).toBeEnabled();
  });

  it('Schicht beginnen: Beginn-Platzhalter aus dem Eintreffen der offenen Periode', async () => {
    listeAbloesungen.mockResolvedValue([]);
    listeEinheitenPerioden.mockResolvedValue([
      {
        einheit_id: 12,
        perioden: [
          { anker: 'alarmierung', beginn_at: inMinuten(-90), eintreffen_at: inMinuten(-60) },
        ],
      },
    ]);
    renderPage();
    await screen.findByText('Keine laufenden Schichten');
    await userEvent.click(screen.getByRole('button', { name: 'Schicht beginnen' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Einheit' }));
    await userEvent.click(await screen.findByTitle('Florian 2'));
    const beginn = within(dialog).getByRole('textbox', { name: 'Im Einsatz seit' });
    await waitFor(() => expect(beginn.getAttribute('placeholder')).toMatch(/^Eintreffen /));
  });

  it('Schicht beginnen: ohne Freigabe des Moduls Einheiten keine Zeitachsen-Anfrage', async () => {
    freigaben.wert = freigabenFixture({ einheiten: { zugriff: false } });
    listeAbloesungen.mockResolvedValue([]);
    renderPage();
    await screen.findByText('Keine laufenden Schichten');
    await userEvent.click(screen.getByRole('button', { name: 'Schicht beginnen' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Einheit' }));
    await userEvent.click(await screen.findByTitle('Florian 2'));
    // Ohne Zeitachse ist der wirksame Wert unbekannt: kein Platzhalter statt eines falschen.
    const beginn = within(dialog).getByRole('textbox', { name: 'Im Einsatz seit' });
    expect(beginn.getAttribute('placeholder')).not.toMatch(/Eintreffen|jetzt/);
    expect(listeEinheitenPerioden).not.toHaveBeenCalled();
  });

  it('Rhythmus einer Schicht: die Abschnittsvorgabe steht als Platzhalter, kein „Leer:“', async () => {
    renderPage();
    await screen.findAllByRole('article');
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen zu Florian 1' }));
    const menu = document.querySelector(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    ) as HTMLElement;
    await userEvent.click(within(menu).getByText('Rhythmus ändern'));
    const dialog = await screen.findByRole('dialog');
    const feld = within(dialog).getByRole('textbox', { name: 'Rhythmus' });
    expect(feld).toHaveAttribute('placeholder', '6 h (Vorgabe Abschnitt)');
    expect(within(dialog).queryByText(/Leer/)).toBeNull();
  });

  it('Planen: eine Warnung des Servers erscheint als Meldung, die Planung gilt (LLH-1131)', async () => {
    laufendLiefert([schicht({ id: 1 })]);
    aendereSchicht.mockResolvedValue(
      schicht({
        id: 1,
        abloesende_einheit_id: 12,
        abloesende_einheit_name: 'Florian 2',
        planung_warnungen: [
          {
            art: 'schon_geplant',
            einheit_id: 12,
            einheit_name: 'Florian 2',
            abloesung_id: 5,
            abloesung_einheit_name: 'Florian 5',
          },
        ],
      }),
    );
    renderPage();
    await screen.findAllByRole('article');
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen zu Florian 1' }));
    const menu = document.querySelector(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    ) as HTMLElement;
    await userEvent.click(within(menu).getByText('Ablösende Einheit planen'));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Ablösende Einheiten' }));
    await userEvent.click(await screen.findByTitle('Florian 2'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    expect(
      await screen.findByText('Florian 2 schon für Schicht Florian 5 geplant'),
    ).toBeInTheDocument();
    expect(aendereSchicht).toHaveBeenCalledWith(1, 1, { abloeser_ids: [12] });
  });

  it('Rhythmus-Vorgabe am Abschnitt: Platzhalter „keine Vorgabe“, kein Erklärsatz', async () => {
    renderPage();
    await screen.findAllByRole('article');
    await userEvent.click(
      screen.getByRole('button', { name: 'Rhythmus-Vorgabe Deichwache Nord ändern' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('textbox', { name: 'Rhythmus' })).toHaveAttribute(
      'placeholder',
      'keine Vorgabe',
    );
    expect(within(dialog).queryByText(/Leer|behalten/)).toBeNull();
  });

  it('ohne Abschnitte: kurzer Zustand im Vorgaben-Paneel', async () => {
    listeAbloesungVorgaben.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('Keine Einsatzabschnitte')).toBeInTheDocument();
  });

  // ── Fremde Neuzugänge per Sammelbanner (LFH-647) ──
  describe('Live-Zufluss (LFH-647)', () => {
    const eins = () => schicht({ id: 1, faellig_at: inMinuten(-12) });
    const zwei = () => schicht({ id: 2, faellig_at: inMinuten(20) });
    const drei = () => schicht({ id: 3, faellig_at: inMinuten(240), rhythmus_quelle: 'einheit' });
    // Die fremde Schicht ist die überfälligste und steht oben; landete sie unten, verschöbe sich
    // auch ohne Schleuse nichts.
    const fremd = () =>
      schicht({ id: 9, einheit_id: 19, einheit_name: 'Florian 9', faellig_at: inMinuten(-40) });

    it('eine fremd angelegte Schicht verschiebt keine Karte, bis das Banner bedient wird', async () => {
      const { client } = renderPage();
      await screen.findAllByRole('article');
      expect(sammelbanner()).toBeNull();

      laufendLiefert([fremd(), eins(), zwei(), drei()]);
      await client.invalidateQueries();

      await waitFor(() => expect(sammelbanner()).not.toBeNull());
      expect(sammelbanner()).toHaveTextContent('1 neue Schicht, davon 1 fällig');
      expect(kartenNamen()).toEqual([
        'Schicht Florian 1',
        'Schicht Florian 2',
        'Schicht Florian 3',
      ]);
      // Der Kopf zählt die zurückgehaltene mit, nur die Karte wartet.
      expect(screen.getByText('4 laufend · 3 fällig')).toBeInTheDocument();

      await userEvent.click(
        within(sammelbanner() as HTMLElement).getByRole('button', { name: 'anzeigen' }),
      );
      expect(kartenNamen()).toEqual([
        'Schicht Florian 9',
        'Schicht Florian 1',
        'Schicht Florian 2',
        'Schicht Florian 3',
      ]);
      expect(sammelbanner()).toBeNull();
    });

    it('Änderungen an vorhandenen Karten erscheinen sofort, ohne Banner', async () => {
      const { client } = renderPage();
      await screen.findAllByRole('article');
      laufendLiefert([
        eins(),
        schicht({
          id: 2,
          faellig_at: inMinuten(20),
          abloesende_einheit_id: 17,
          abloesende_einheit_name: 'Florian 17',
        }),
        drei(),
      ]);
      await client.invalidateQueries();
      const karte = await screen.findByRole('article', { name: 'Schicht Florian 2' });
      await within(karte).findByText('Ablösung geplant durch Florian 17');
      expect(sammelbanner()).toBeNull();
    });

    it('eine eigene neue Schicht steht sofort an ihrem Fälligkeitsplatz', async () => {
      // Florian 2 (Einheit 12) ist frei, damit der Dialog ihn anbietet.
      laufendLiefert([eins(), drei()]);
      const eigene = schicht({
        id: 9,
        einheit_id: 12,
        einheit_name: 'Florian 2',
        faellig_at: inMinuten(-40),
      });
      beginneSchicht.mockImplementation(() => {
        laufendLiefert([eigene, eins(), drei()]);
        return Promise.resolve(eigene);
      });
      renderPage();
      await screen.findAllByRole('article');
      await userEvent.click(screen.getByRole('button', { name: 'Schicht beginnen' }));
      const dialog = await screen.findByRole('dialog');
      await userEvent.click(within(dialog).getByRole('combobox', { name: 'Einheit' }));
      await userEvent.click(await screen.findByTitle('Florian 2'));
      await userEvent.type(within(dialog).getByRole('textbox', { name: 'Rhythmus' }), '4');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Schicht beginnen' }));

      await waitFor(() =>
        expect(kartenNamen()).toEqual([
          'Schicht Florian 2',
          'Schicht Florian 1',
          'Schicht Florian 3',
        ]),
      );
      expect(sammelbanner()).toBeNull();
    });

    it('trifft der Datenstand VOR der eigenen Antwort ein, rückt die Karte mit der Antwort nach', async () => {
      laufendLiefert([eins(), drei()]);
      const eigene = schicht({
        id: 9,
        einheit_id: 12,
        einheit_name: 'Florian 2',
        faellig_at: inMinuten(-40),
      });
      let antworte: (a: Abloesung) => void = () => {};
      beginneSchicht.mockImplementation(() => new Promise<Abloesung>((r) => (antworte = r)));
      const { client } = renderPage();
      await screen.findAllByRole('article');
      await userEvent.click(screen.getByRole('button', { name: 'Schicht beginnen' }));
      const dialog = await screen.findByRole('dialog');
      await userEvent.click(within(dialog).getByRole('combobox', { name: 'Einheit' }));
      await userEvent.click(await screen.findByTitle('Florian 2'));
      await userEvent.type(within(dialog).getByRole('textbox', { name: 'Rhythmus' }), '4');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Schicht beginnen' }));
      await waitFor(() => expect(beginneSchicht).toHaveBeenCalled());

      // Das Live-Ereignis war schneller als die Antwort: noch ist die Id nicht als eigene bekannt.
      laufendLiefert([eigene, eins(), drei()]);
      await client.invalidateQueries();
      await waitFor(() => expect(sammelbanner()).not.toBeNull());
      expect(kartenNamen()).toEqual(['Schicht Florian 1', 'Schicht Florian 3']);

      antworte(eigene);
      await waitFor(() =>
        expect(kartenNamen()).toEqual([
          'Schicht Florian 2',
          'Schicht Florian 1',
          'Schicht Florian 3',
        ]),
      );
      expect(sammelbanner()).toBeNull();
    });

    it('das Banner steht in der Segmentzeile, die immer gerendert wird', async () => {
      // Nähme das Banner eine eigene Zeile, schöbe es die Karten weg, die es schützen soll. Die
      // Höhe misst e2e.
      const { client } = renderPage();
      await screen.findAllByRole('article');
      const zeile = document.querySelector('[data-lfh="abloesung-werkzeugzeile"]');
      expect(zeile).not.toBeNull();
      laufendLiefert([fremd(), eins(), zwei(), drei()]);
      await client.invalidateQueries();
      await waitFor(() => expect(sammelbanner()).not.toBeNull());
      expect(sammelbanner()!.parentElement).toBe(zeile);
    });

    // ── Handschirm (LFH-694): neben der Segmentleiste trägt nur die Kurzform ──
    it('auf dem Handschirm ist das Banner ein Knopf „1 neu“, der volle Satz bleibt im Status', async () => {
      setzeViewportBreite(390);
      const { client } = renderPage();
      await screen.findAllByRole('article');
      laufendLiefert([fremd(), eins(), zwei(), drei()]);
      await client.invalidateQueries();
      await waitFor(() => expect(sammelbanner()).not.toBeNull());

      const banner = sammelbanner() as HTMLElement;
      expect(banner).toHaveTextContent('1 neue Schicht, davon 1 fällig');
      const knopf = within(banner).getByRole('button', { name: '1 neu anzeigen' });
      expect(knopf).toHaveTextContent(/^1 neu$/);
      expect(banner.parentElement).toBe(
        document.querySelector('[data-lfh="abloesung-werkzeugzeile"]'),
      );

      await userEvent.click(knopf);
      expect(kartenNamen()[0]).toBe('Schicht Florian 9');
      expect(sammelbanner()).toBeNull();
    });

    // ── Eine fremde Änderung von Rhythmus/Beginn ordnet nicht unter dem Cursor um (LFH-660) ──
    // Gezeigt: 1 überfällig, 4 planmäßig (2 h, eigener Rhythmus), 3 planmäßig (4 h, folgt der
    // Vorgabe). Fremd wird 3 auf „seit 30 min überfällig" gezogen — die Server-Ordnung stellte sie
    // über 4.
    const vier = (m = 120) =>
      schicht({ id: 4, faellig_at: inMinuten(m), rhythmus_quelle: 'einheit' });
    const dreiVorgezogen = () =>
      schicht({
        id: 3,
        faellig_at: inMinuten(-30),
        rhythmus_minuten: 30,
        rhythmus_quelle: 'abschnitt',
      });

    it('eine fremde Rhythmusänderung verschiebt keine Karte, bis das Banner bedient wird (LFH-660)', async () => {
      laufendLiefert([eins(), vier(), drei()]);
      const { client } = renderPage();
      await screen.findAllByRole('article');
      expect(kartenNamen()).toEqual([
        'Schicht Florian 1',
        'Schicht Florian 4',
        'Schicht Florian 3',
      ]);

      laufendLiefert([dreiVorgezogen(), eins(), vier()]);
      await client.invalidateQueries();

      await waitFor(() => expect(sammelbanner()).not.toBeNull());
      // Die fällige Karte, die unter einer planmäßigen gehalten wird, wird genannt.
      expect(sammelbanner()).toHaveTextContent(
        'Reihenfolge geändert, 1 fällige Schicht steht weiter unten',
      );
      expect(kartenNamen()).toEqual([
        'Schicht Florian 1',
        'Schicht Florian 4',
        'Schicht Florian 3',
      ]);
      // Folge eingefroren, Inhalt frisch: die Karte trägt ihre neue Einstufung schon jetzt.
      expect(screen.getByRole('article', { name: 'Schicht Florian 3' })).toHaveAttribute(
        'data-einstufung',
        'ueberfaellig',
      );
      expect(screen.getByText('3 laufend · 2 fällig')).toBeInTheDocument();

      await userEvent.click(
        within(sammelbanner() as HTMLElement).getByRole('button', { name: 'anzeigen' }),
      );
      expect(kartenNamen()).toEqual([
        'Schicht Florian 3',
        'Schicht Florian 1',
        'Schicht Florian 4',
      ]);
      expect(sammelbanner()).toBeNull();
    });

    it('auf dem Handschirm meldet eine reine Umordnung „umgeordnet“ statt einer Zahl (LFH-694)', async () => {
      setzeViewportBreite(390);
      laufendLiefert([eins(), vier(), drei()]);
      const { client } = renderPage();
      await screen.findAllByRole('article');
      laufendLiefert([dreiVorgezogen(), eins(), vier()]);
      await client.invalidateQueries();
      await waitFor(() => expect(sammelbanner()).not.toBeNull());
      expect(
        within(sammelbanner() as HTMLElement).getByRole('button', { name: 'umgeordnet anzeigen' }),
      ).toHaveTextContent(/^umgeordnet$/);
    });

    it('eine fremde Änderung, die die Folge nicht berührt, zeigt kein Banner', async () => {
      laufendLiefert([eins(), vier(), drei()]);
      const { client } = renderPage();
      await screen.findAllByRole('article');
      // 149,5 statt 150: `abstandText` rundet ab, `inMinuten` schneidet auf Sekunden. Fielen Anlage
      // und Rendern in dieselbe Millisekunde, stünde „in 2 h 30 min" da, und die Erwartung liefe in
      // den Timeout.
      laufendLiefert([eins(), schicht({ id: 4, faellig_at: inMinuten(149.5) }), drei()]);
      await client.invalidateQueries();
      await waitFor(() =>
        expect(
          within(screen.getByRole('article', { name: 'Schicht Florian 4' })).getByText(
            /^in 2 h 2\d min$/,
          ),
        ).toBeInTheDocument(),
      );
      expect(sammelbanner()).toBeNull();
    });

    it('die eigene Rhythmusänderung ordnet ihre Karte sofort ein; ein zurückgehaltener fremder Neuzugang bleibt zurück', async () => {
      laufendLiefert([eins(), vier(), drei()]);
      aendereSchicht.mockImplementation(() => {
        laufendLiefert([fremd(), dreiVorgezogen(), eins(), vier()]);
        return Promise.resolve(dreiVorgezogen());
      });
      const { client } = renderPage();
      await screen.findAllByRole('article');
      laufendLiefert([fremd(), eins(), vier(), drei()]);
      await client.invalidateQueries();
      await waitFor(() => expect(sammelbanner()).not.toBeNull());
      await userEvent.click(screen.getByRole('button', { name: 'Aktionen zu Florian 3' }));
      const menu = document.querySelector(
        '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
      ) as HTMLElement;
      await userEvent.click(within(menu).getByText('Rhythmus ändern'));
      const dialog = await screen.findByRole('dialog');
      const feld = within(dialog).getByRole('textbox', { name: 'Rhythmus' });
      await userEvent.clear(feld);
      await userEvent.type(feld, '0.5');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));

      await waitFor(() =>
        expect(kartenNamen()).toEqual([
          'Schicht Florian 3',
          'Schicht Florian 1',
          'Schicht Florian 4',
        ]),
      );
      // Keine Umordnung gemeldet — nur der fremde Neuzugang wartet weiter.
      expect(sammelbanner()).toHaveTextContent(/^1 neue Schicht, davon 1 fällig/);
      expect(sammelbanner()).not.toHaveTextContent('Reihenfolge');
    });

    it('die eigene Vorgabe ordnet nur die Schichten ein, die ihr folgen — eine fremd umgeordnete mit eigenem Rhythmus bleibt', async () => {
      // Der Server schreibt bei einer Vorgabe nur Schichten mit `rhythmus_quelle = 'abschnitt'` um.
      // 4 hat einen eigenen Rhythmus und wurde fremd vorgezogen; die eigene Vorgabe darf sie nicht
      // mit auftauen.
      laufendLiefert([eins(), vier(), drei()]);
      const { client } = renderPage();
      await screen.findAllByRole('article');
      laufendLiefert([vier(-20), eins(), drei()]);
      await client.invalidateQueries();
      await waitFor(() => expect(sammelbanner()).not.toBeNull());

      setzeAbloesungVorgabe.mockImplementation(() => {
        laufendLiefert([dreiVorgezogen(), vier(-20), eins()]);
        return Promise.resolve([]);
      });
      await userEvent.click(
        screen.getByRole('button', { name: 'Rhythmus-Vorgabe Deichwache Nord ändern' }),
      );
      const dialog = await screen.findByRole('dialog');
      const feld = within(dialog).getByRole('textbox', { name: 'Rhythmus' });
      await userEvent.clear(feld);
      await userEvent.type(feld, '0.5');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));

      await waitFor(() =>
        expect(kartenNamen()).toEqual([
          'Schicht Florian 3',
          'Schicht Florian 1',
          'Schicht Florian 4',
        ]),
      );
      expect(sammelbanner()).toHaveTextContent('Reihenfolge geändert');
    });

    it('ein Ansichtswechsel gibt die zurückgehaltenen frei', async () => {
      const { client } = renderPage();
      await screen.findAllByRole('article');
      laufendLiefert([fremd(), eins(), zwei(), drei()]);
      await client.invalidateQueries();
      await waitFor(() => expect(sammelbanner()).not.toBeNull());
      // „Abgelöst“ ist die Vorgabe unter „Vergangen“ (LLH-1128).
      await userEvent.click(screen.getByRole('radio', { name: 'Vergangen' }));
      await screen.findByText('Noch keine Ablösung vollzogen');
      await userEvent.click(screen.getByRole('radio', { name: /^Laufend/ }));
      await waitFor(() => expect(kartenNamen()).toHaveLength(4));
      expect(sammelbanner()).toBeNull();
    });
  });
});

/**
 * Speicherfehler am Ort (LFH-1077, `frontend/AGENTS.md`, „Rückwege und Fehler“): die Rücknahme an
 * der Karte meldet an der Karte, Rückgängig aus dem Toast im Hinweis der Seite. Kein Fehler-Toast.
 */
describe('AbloesungPage — Rücknahme abgelehnt (LFH-1077)', () => {
  const karte = (name: string) => screen.getByRole('article', { name: `Schicht ${name}` });
  const seitenHinweis = () =>
    waitFor(() => {
      const h = document.querySelector<HTMLElement>('[data-lfh="seiten-beschreibung"]');
      expect(h).not.toBeNull();
      return h as HTMLElement;
    });

  beforeEach(() => {
    vi.clearAllMocks();
    freigaben.wert = freigabenFixture();
    einsatz.wert = {
      id: 1,
      bezeichnung: 'Hochwasser',
      status: 'aktiv',
      meine_rolle: 'einsatzleitung',
    };
    listeEinheitenPerioden.mockResolvedValue([]);
    listeAbloesungVorgaben.mockResolvedValue([]);
  });

  describe('Rückgängig aus dem Toast', () => {
    const a = schicht({ id: 1, faellig_at: inMinuten(-12), abloesende_einheit_id: 12 });
    beforeEach(() => {
      laufendLiefert([a]);
      vollzieheAbloesung.mockResolvedValue({
        abgeloest: { ...a, status: 'abgeloest', ruecknehmbar: true },
        folgeschicht: null,
        folgeschichten: [],
      });
    });
    async function vollzieheUndNimmZurueck() {
      await userEvent.click(await screen.findByRole('button', { name: 'Ablösung vollziehen' }));
      const dialog = await screen.findByRole('dialog');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Vollziehen' }));
      const rueckgaengig = await screen.findAllByRole('button', { name: /Rückgängig/ });
      await userEvent.click(rueckgaengig[rueckgaengig.length - 1]);
    }

    it('der Grund steht im Seitenhinweis, kein Fehler-Toast', async () => {
      nimmVollzugZurueck.mockRejectedValue(new ApiError(409, 'Folgeschicht bereits abgelöst'));
      renderPage();
      await vollzieheUndNimmZurueck();

      const hinweis = await seitenHinweis();
      expect(await within(hinweis).findByRole('alert')).toHaveTextContent(
        'Folgeschicht bereits abgelöst',
      );
      expect(document.querySelectorAll('[data-fehler]')).toHaveLength(0);
      expect(document.querySelectorAll('.ant-message-error')).toHaveLength(0);
    });

    it('die nächste Rücknahme räumt den Hinweis', async () => {
      nimmVollzugZurueck
        .mockRejectedValueOnce(new ApiError(409, 'Folgeschicht bereits abgelöst'))
        .mockImplementationOnce(() => new Promise(() => {}));
      renderPage();
      await vollzieheUndNimmZurueck();
      await screen.findByText('Folgeschicht bereits abgelöst');

      await vollzieheUndNimmZurueck();
      await waitFor(() => expect(nimmVollzugZurueck).toHaveBeenCalledTimes(2));
      await waitFor(() =>
        expect(screen.queryByText('Folgeschicht bereits abgelöst')).not.toBeInTheDocument(),
      );
    });
  });

  describe('Rücknahme an der Karte', () => {
    beforeEach(() => {
      listeAbloesungen.mockImplementation((_e: number, status: string) =>
        Promise.resolve(
          status === 'laufend'
            ? []
            : [
                schicht({ id: 1, status: 'abgeloest', ruecknehmbar: true }),
                schicht({ id: 2, status: 'abgeloest', ruecknehmbar: true }),
              ],
        ),
      );
    });
    async function zeigeAbgeloeste() {
      renderPage();
      await screen.findByText('Keine laufenden Schichten');
      await userEvent.click(screen.getByRole('radio', { name: 'Vergangen' }));
      expect(screen.getByRole('radio', { name: 'Abgelöst' })).toBeChecked();
      await screen.findByRole('article', { name: 'Schicht Florian 2' });
    }
    const nimmZurueck = (name: string) =>
      userEvent.click(within(karte(name)).getByRole('button', { name: 'Vollzug zurücknehmen' }));

    it('der Grund steht an genau dieser Karte, kein Toast', async () => {
      nimmVollzugZurueck.mockRejectedValue(new ApiError(409, 'Folgeschicht bereits abgelöst'));
      await zeigeAbgeloeste();
      await nimmZurueck('Florian 1');

      expect(
        await within(karte('Florian 1')).findByText('Folgeschicht bereits abgelöst'),
      ).toHaveAttribute('data-fehler');
      expect(karte('Florian 2').querySelector('[data-fehler]')).toBeNull();
      expect(document.querySelector('[data-lfh="seiten-beschreibung"]')).toBeNull();
      expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
    });

    it('zwei Karten nebenläufig: die Ablehnung steht an ihrer Karte', async () => {
      let lehneAb: (e: Error) => void = () => {};
      nimmVollzugZurueck.mockImplementation((_e: number, id: number) =>
        id === 1
          ? new Promise((_r, reject) => (lehneAb = reject))
          : Promise.resolve(schicht({ id: 2 })),
      );
      await zeigeAbgeloeste();
      await nimmZurueck('Florian 1');
      await nimmZurueck('Florian 2');
      await waitFor(() => expect(nimmVollzugZurueck).toHaveBeenCalledTimes(2));
      await act(async () => lehneAb(new ApiError(409, 'Folgeschicht bereits abgelöst')));

      expect(
        await within(karte('Florian 1')).findByText('Folgeschicht bereits abgelöst'),
      ).toHaveAttribute('data-fehler');
      expect(karte('Florian 2').querySelector('[data-fehler]')).toBeNull();
      // Karte 2 hat Erfolg und damit ihren Erfolgs-Toast; ein Fehler-Toast fehlt.
      expect(document.querySelectorAll('.ant-message-error')).toHaveLength(0);
    });

    it('die nächste Rücknahme an derselben Karte räumt den Grund', async () => {
      nimmVollzugZurueck
        .mockRejectedValueOnce(new ApiError(409, 'Folgeschicht bereits abgelöst'))
        .mockImplementationOnce(() => new Promise(() => {}));
      await zeigeAbgeloeste();
      await nimmZurueck('Florian 1');
      await within(karte('Florian 1')).findByText('Folgeschicht bereits abgelöst');

      await nimmZurueck('Florian 1');
      await waitFor(() => expect(karte('Florian 1').querySelector('[data-fehler]')).toBeNull());
    });
  });
});

/**
 * LLH-1128 Teil II: Einheiten im Einsatz ohne Schicht, beendete Schichten, Vererbung.
 * Einheiten aus dem Mock oben: 11 „Florian 1“, 12 „Florian 2“, 13 „Florian 3“.
 */
describe('AbloesungPage — Ohne Schicht und beendet (LLH-1128)', () => {
  const offen = (einheit_id: number, beginnVor: number, eintreffenVor?: number) => ({
    einheit_id,
    perioden: [
      {
        anker: 'alarmierung',
        beginn_at: inMinuten(-beginnVor),
        eintreffen_at: eintreffenVor != null ? inMinuten(-eintreffenVor) : null,
      },
    ],
  });
  // Florian 1 trägt die Schicht und vererbt sie an Florian 3; Florian 2 ist ohne Schicht.
  const traeger = () =>
    schicht({
      id: 1,
      erbende_einheiten: [{ einheit_id: 13, einheit_name: 'Florian 3' }],
    });
  const segment = (name: RegExp | string) => screen.getByRole('radio', { name });
  const ohneKarten = () =>
    [...document.querySelectorAll('[data-lfh="abloesung-ohne-schicht"]')].map((k) =>
      k.getAttribute('aria-label'),
    );

  beforeEach(() => {
    vi.clearAllMocks();
    setzeViewportBreite(1440);
    freigaben.wert = freigabenFixture();
    einsatz.wert = {
      id: 1,
      bezeichnung: 'Hochwasser',
      status: 'aktiv',
      meine_rolle: 'einsatzleitung',
    };
    laufendLiefert([traeger()]);
    listeEinheitenPerioden.mockResolvedValue([offen(11, 300), offen(12, 90, 60), offen(13, 300)]);
    fetchEinsatzSchichtmodell.mockResolvedValue({ vorwarnung_minuten: 30, laufende_schichten: 0 });
    listeAbloesungVorgaben.mockResolvedValue([]);
  });

  it('zählt Einheiten mit offener Periode ohne eigene oder geerbte Schicht', async () => {
    renderPage();
    await waitFor(() => expect(segment(/^Ohne Schicht/)).toHaveTextContent('Ohne Schicht (1)'));
    expect(screen.getByText('1 laufend · 0 fällig · 1 ohne Schicht')).toBeInTheDocument();
    await userEvent.click(segment(/^Ohne Schicht/));
    const bereich = await screen.findByRole('region', { name: 'Einheiten ohne Schicht' });
    // Florian 3 erbt vom Träger und steht deshalb nicht da.
    expect(ohneKarten()).toEqual(['Florian 2 ohne Schicht']);
    const karte = within(bereich).getByRole('article', { name: 'Florian 2 ohne Schicht' });
    expect(within(karte).getByText('eingetroffen')).toBeInTheDocument();
  });

  it('die tragende Schicht nennt ihre Erben', async () => {
    renderPage();
    const karte = await screen.findByRole('article', { name: 'Schicht Florian 1' });
    expect(karte.querySelector('[data-lfh="abloesung-erben"]')).toHaveTextContent(
      'gilt auch für: Florian 3',
    );
  });

  it('„Schicht beginnen“ an der Zeile öffnet den Dialog mit der Einheit vorbelegt', async () => {
    beginneSchicht.mockResolvedValue(schicht({ id: 2, einheit_id: 12, einheit_name: 'Florian 2' }));
    renderPage();
    await waitFor(() => expect(segment(/^Ohne Schicht/)).toHaveTextContent('(1)'));
    await userEvent.click(segment(/^Ohne Schicht/));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Schicht beginnen für Florian 2' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Schicht beginnen' });
    expect(within(dialog).getByTitle('Florian 2')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Rhythmus' }), '6');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schicht beginnen' }));
    await waitFor(() =>
      expect(beginneSchicht).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ einheit_id: 12, rhythmus_minuten: 360 }),
      ),
    );
  });

  it('der Kopfknopf belegt nichts vor, auch nach einer Zeile', async () => {
    renderPage();
    await waitFor(() => expect(segment(/^Ohne Schicht/)).toHaveTextContent('(1)'));
    await userEvent.click(segment(/^Ohne Schicht/));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Schicht beginnen für Florian 2' }),
    );
    let dialog = await screen.findByRole('dialog', { name: 'Schicht beginnen' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'Schicht beginnen' }));
    dialog = await screen.findByRole('dialog', { name: 'Schicht beginnen' });
    expect(within(dialog).queryByTitle('Florian 2')).toBeNull();
  });

  it('ein geplanter Ablöser steht ohne Schicht, aber ohne „Schicht beginnen“', async () => {
    laufendLiefert([
      { ...traeger(), abloesende_einheit_id: 12, abloesende_einheit_name: 'Florian 2' },
    ]);
    renderPage();
    await waitFor(() => expect(segment(/^Ohne Schicht/)).toHaveTextContent('(1)'));
    await userEvent.click(segment(/^Ohne Schicht/));
    const karte = await screen.findByRole('article', { name: 'Florian 2 ohne Schicht' });
    expect(within(karte).getByText('als Ablöser geplant für Florian 1')).toBeInTheDocument();
    expect(within(karte).queryByRole('button')).toBeNull();
  });

  it('ohne Schreibrecht: die Zeilen tragen keinen Knopf', async () => {
    einsatz.wert = { ...einsatz.wert, meine_rolle: 'beobachter' };
    renderPage();
    await waitFor(() => expect(segment(/^Ohne Schicht/)).toHaveTextContent('(1)'));
    await userEvent.click(segment(/^Ohne Schicht/));
    const karte = await screen.findByRole('article', { name: 'Florian 2 ohne Schicht' });
    expect(within(karte).queryByRole('button')).toBeNull();
  });

  it('ohne Freigabe des Moduls Einheiten ist das Segment gesperrt und nennt den Grund', async () => {
    freigaben.wert = freigabenFixture({ einheiten: { zugriff: false } });
    renderPage();
    await screen.findAllByRole('article');
    await waitFor(() => expect(segment(/^Ohne Schicht/)).toHaveAttribute('aria-disabled', 'true'));
    expect(segment(/^Ohne Schicht/)).toHaveAccessibleDescription('Modul Einheiten gesperrt');
    expect(screen.getByText('1 laufend · 0 fällig')).toBeInTheDocument();
    await userEvent.click(segment(/^Ohne Schicht/));
    expect(segment(/^Laufend/)).toBeChecked();
    expect(listeEinheitenPerioden).not.toHaveBeenCalled();
  });

  it('scheitert die Zeitachse, steht der Fehler statt eines ewigen Ladens', async () => {
    listeEinheitenPerioden.mockRejectedValue(new ApiError(500, 'kaputt'));
    renderPage();
    await screen.findAllByRole('article');
    await userEvent.click(segment(/^Ohne Schicht/));
    expect(
      await screen.findByText('Einheiten ohne Schicht konnten nicht geladen werden'),
    ).toBeInTheDocument();
    expect(document.querySelector('.ant-spin')).toBeNull();
  });

  it('auf dem Handschirm stehen die Zahlen im Kopf, nicht in den Segmenten', async () => {
    setzeViewportBreite(390);
    renderPage();
    await screen.findByText('1 laufend · 0 fällig · 1 ohne Schicht');
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual([
      'Laufend',
      'Ohne Schicht',
      'Vergangen',
    ]);
  });

  it('Vergangen → Beendet lädt den Status „beendet“ und zeigt den Grund', async () => {
    listeAbloesungen.mockImplementation((_e: number, status: string) =>
      Promise.resolve(
        status === 'laufend'
          ? [traeger()]
          : status === 'beendet'
            ? [
                schicht({
                  id: 4,
                  einheit_name: 'Florian 4',
                  status: 'beendet',
                  beendet_grund: 'entlassung',
                  beendet_at: inMinuten(-30),
                }),
              ]
            : [],
      ),
    );
    renderPage();
    await screen.findAllByRole('article');
    await userEvent.click(segment('Vergangen'));
    await screen.findByText('Noch keine Ablösung vollzogen');
    await userEvent.click(segment('Beendet'));
    const bereich = await screen.findByRole('region', { name: 'Beendete Schichten' });
    const karte = within(bereich).getByRole('article', { name: 'Schicht Florian 4' });
    expect(karte.querySelector('[data-lfh="abloesung-ende"]')).toHaveTextContent(
      /^beendet · entlassen \d{4,6}$/,
    );
    expect(listeAbloesungen).toHaveBeenCalledWith(1, 'beendet');
  });

  describe('Live-Zufluss (Regeln aus abloesung/zufluss.ts)', () => {
    async function zeigeOhne() {
      const ergebnis = renderPage();
      await waitFor(() => expect(segment(/^Ohne Schicht/)).toHaveTextContent('(1)'));
      await userEvent.click(segment(/^Ohne Schicht/));
      await screen.findByRole('article', { name: 'Florian 2 ohne Schicht' });
      return ergebnis;
    }

    it('eine neue Einheit ohne Schicht wartet hinter dem Banner, der Zähler stimmt sofort', async () => {
      const { client } = await zeigeOhne();
      // Der Träger ist entlassen: Florian 1 ist ohne Schicht und länger im Einsatz als
      // Florian 2, stünde also oben. Florian 3 erbt nicht mehr, hat aber auch keine Periode mehr.
      laufendLiefert([]);
      listeEinheitenPerioden.mockResolvedValue([offen(11, 300), offen(12, 90, 60)]);
      await client.invalidateQueries();
      await waitFor(() => expect(sammelbanner()).not.toBeNull());
      expect(sammelbanner()).toHaveTextContent('1 neue Einheit ohne Schicht');
      expect(segment(/^Ohne Schicht/)).toHaveTextContent('Ohne Schicht (2)');
      expect(ohneKarten()).toEqual(['Florian 2 ohne Schicht']);
      await userEvent.click(
        within(sammelbanner() as HTMLElement).getByRole('button', { name: 'anzeigen' }),
      );
      expect(ohneKarten()).toEqual(['Florian 1 ohne Schicht', 'Florian 2 ohne Schicht']);
      expect(sammelbanner()).toBeNull();
    });

    it('eine Einheit, die eine Schicht bekommt, fällt sofort weg, ohne Banner', async () => {
      const { client } = await zeigeOhne();
      laufendLiefert([traeger(), schicht({ id: 2 })]);
      await client.invalidateQueries();
      await screen.findByText('Keine Einheit ohne Schicht');
      expect(sammelbanner()).toBeNull();
      expect(segment(/^Ohne Schicht/)).toHaveTextContent('Ohne Schicht (0)');
    });
  });
});

describe('AbloesungPage — Hinweise an der Karte und Sprung zur Schicht (LLH-1131 Teil II)', () => {
  const geplant = () =>
    schicht({ id: 1, abloeser: [{ einheit_id: 12, einheit_name: 'Florian 2' }] });
  const zeile = (k: HTMLElement) => k.querySelector<HTMLElement>('[data-lfh="abloesung-abloeser"]');

  beforeEach(() => {
    vi.clearAllMocks();
    setzeViewportBreite(1440);
    freigaben.wert = freigabenFixture();
    einsatz.wert = {
      id: 1,
      bezeichnung: 'Hochwasser',
      status: 'aktiv',
      meine_rolle: 'einsatzleitung',
    };
    einheiten.wert = undefined;
    laufendLiefert([geplant(), schicht({ id: 2, faellig_at: inMinuten(120) })]);
    listeEinheitenPerioden.mockResolvedValue([]);
    listeBr.mockResolvedValue([{ id: 4, bezeichnung: 'BR Sportplatz' }]);
    fetchEinsatzSchichtmodell.mockResolvedValue({ vorwarnung_minuten: 30, laufende_schichten: 0 });
    listeAbloesungVorgaben.mockResolvedValue([]);
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('die Kartenzeile zum Ablöser kommt aus seiner Zeitachse, der Raum aus der Raumliste', async () => {
    einheiten.wert = [EINHEITEN[0], { ...EINHEITEN[1], aktueller_br_id: 4 }];
    listeEinheitenPerioden.mockResolvedValue([
      {
        einheit_id: 12,
        perioden: [
          { anker: 'alarmierung', beginn_at: inMinuten(-40), eintreffen_at: inMinuten(-10) },
        ],
      },
    ]);
    renderPage();
    const karte = await screen.findByRole('article', { name: 'Schicht Florian 1' });
    await waitFor(() =>
      expect(zeile(karte)).toHaveTextContent(
        /^Ablösung: Florian 2 · alarmiert \d{4,6} · eingetroffen \d{4,6} \(BR Sportplatz\)$/,
      ),
    );
    expect(listeBr).toHaveBeenCalledWith(1);
  });

  it('live: ein neues Ereignis der Zeitachse ändert die Zeile über die bestehende Invalidierung', async () => {
    const { client } = renderPage();
    const karte = await screen.findByRole('article', { name: 'Schicht Florian 1' });
    await waitFor(() =>
      expect(zeile(karte)).toHaveTextContent(/^Ablösung geplant durch Florian 2$/),
    );
    // Kein Ablöser in einem Raum: keine Raumabfrage.
    expect(listeBr).not.toHaveBeenCalled();
    listeEinheitenPerioden.mockResolvedValue([
      { einheit_id: 12, perioden: [{ anker: 'alarmierung', beginn_at: inMinuten(-2) }] },
    ]);
    // Wie die Ereignisse `fahrzeug` und `einheit` es tun (`api/queryKeys.ts`).
    await act(() => client.invalidateQueries({ queryKey: ['einsatz-kraefte-zeitachse', 1] }));
    await waitFor(() =>
      expect(zeile(karte)).toHaveTextContent(/^Ablösung: Florian 2 · alarmiert \d{4,6}$/),
    );
  });

  it('ohne Freigabe der Bereitstellungsräume keine Raumabfrage und keine Klammer', async () => {
    freigaben.wert = freigabenFixture({ bereitstellungsraeume: { zugriff: false } });
    einheiten.wert = [EINHEITEN[0], { ...EINHEITEN[1], aktueller_br_id: 4 }];
    listeEinheitenPerioden.mockResolvedValue([
      { einheit_id: 12, perioden: [{ anker: 'eintreffen', beginn_at: inMinuten(-10) }] },
    ]);
    renderPage();
    const karte = await screen.findByRole('article', { name: 'Schicht Florian 1' });
    await waitFor(() =>
      expect(zeile(karte)).toHaveTextContent(/^Ablösung: Florian 2 · eingetroffen \d{4,6}$/),
    );
    expect(listeBr).not.toHaveBeenCalled();
  });

  it('die Warnungen zur Planung stehen dezent an der Karte', async () => {
    laufendLiefert([
      schicht({
        id: 1,
        abloeser: [{ einheit_id: 12, einheit_name: 'Florian 2' }],
        planung_warnungen: [
          {
            art: 'schon_geplant',
            einheit_id: 12,
            einheit_name: 'Florian 2',
            abloesung_id: 5,
            abloesung_einheit_name: 'Florian 5',
          },
        ],
      }),
    ]);
    renderPage();
    const karte = await screen.findByRole('article', { name: 'Schicht Florian 1' });
    expect(karte.querySelector('[data-lfh="abloesung-planung-warnung"]')).toHaveTextContent(
      'Florian 2 schon für Schicht Florian 5 geplant',
    );
  });

  it('?schicht= hebt die laufende Schicht hervor, rollt sie ins Bild und räumt den Parameter', async () => {
    renderPage('/einsaetze/1/abloesung?schicht=2');
    const karte = await screen.findByRole('article', { name: 'Schicht Florian 2' });
    await waitFor(() => expect(karte).toHaveAttribute('data-hervorgehoben', 'true'));
    expect(karte.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
    expect(screen.getByRole('article', { name: 'Schicht Florian 1' })).not.toHaveAttribute(
      'data-hervorgehoben',
    );
    await waitFor(() => expect(adresse.suche).toBe(''));
  });

  it('die Hervorhebung vergeht nach kurzer Zeit, ohne Animation', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderPage('/einsaetze/1/abloesung?schicht=2');
      const karte = await screen.findByRole('article', { name: 'Schicht Florian 2' });
      await waitFor(() => expect(karte).toHaveAttribute('data-hervorgehoben', 'true'));
      expect(karte.style.animation).toBe('');
      expect(karte.style.transition).toBe('');
      act(() => void vi.advanceTimersByTime(SCHICHT_HERVORHEBUNG_MS - 500));
      expect(karte).toHaveAttribute('data-hervorgehoben', 'true');
      act(() => void vi.advanceTimersByTime(1000));
      expect(karte).not.toHaveAttribute('data-hervorgehoben');
    } finally {
      vi.useRealTimers();
    }
  });

  it('eine abgelöste Schicht: die Seite wechselt nach „Vergangen → Abgelöst“', async () => {
    listeAbloesungen.mockImplementation((_e: number, status: string) =>
      Promise.resolve(
        status === 'laufend'
          ? [geplant()]
          : status === 'abgeloest'
            ? [schicht({ id: 7, status: 'abgeloest', vollzogen_at: inMinuten(-30) })]
            : [],
      ),
    );
    renderPage('/einsaetze/1/abloesung?schicht=7');
    const karte = await screen.findByRole('article', { name: 'Schicht Florian 7' });
    await waitFor(() => expect(karte).toHaveAttribute('data-hervorgehoben', 'true'));
    expect(screen.getByRole('radio', { name: 'Vergangen' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Abgelöst' })).toBeChecked();
  });

  it('eine beendete Schicht: die Seite wechselt nach „Vergangen → Beendet“', async () => {
    listeAbloesungen.mockImplementation((_e: number, status: string) =>
      Promise.resolve(
        status === 'laufend'
          ? [geplant()]
          : status === 'beendet'
            ? [
                schicht({
                  id: 8,
                  status: 'beendet',
                  beendet_grund: 'aufloesung',
                  beendet_at: inMinuten(-30),
                }),
              ]
            : [],
      ),
    );
    renderPage('/einsaetze/1/abloesung?schicht=8');
    const karte = await screen.findByRole('article', { name: 'Schicht Florian 8' });
    await waitFor(() => expect(karte).toHaveAttribute('data-hervorgehoben', 'true'));
    expect(screen.getByRole('radio', { name: 'Beendet' })).toBeChecked();
  });

  it('eine unbekannte Schicht ändert nichts', async () => {
    renderPage('/einsaetze/1/abloesung?schicht=99');
    await screen.findByRole('article', { name: 'Schicht Florian 1' });
    await waitFor(() => expect(adresse.suche).toBe(''));
    await waitFor(() => expect(listeAbloesungen).toHaveBeenCalledWith(1, 'beendet'));
    await waitFor(() => expect(listeAbloesungen).toHaveBeenCalledWith(1, 'abgeloest'));
    expect(screen.getByRole('radio', { name: /^Laufend/ })).toBeChecked();
    expect(document.querySelector('[data-hervorgehoben="true"]')).toBeNull();
  });

  it('ein Sprung auf der offenen Seite gibt eine zurückgehaltene Schicht frei und hebt sie hervor', async () => {
    const { client } = renderPage();
    await screen.findByRole('article', { name: 'Schicht Florian 1' });
    // Fremd angelegt: wartet hinter dem Banner.
    laufendLiefert([
      schicht({ id: 9, faellig_at: inMinuten(-5) }),
      geplant(),
      schicht({ id: 2, faellig_at: inMinuten(120) }),
    ]);
    await act(() => client.invalidateQueries());
    await waitFor(() => expect(sammelbanner()).not.toBeNull());
    expect(screen.queryByRole('article', { name: 'Schicht Florian 9' })).toBeNull();
    // Der Toast „Ablösung fällig“ springt zu ihr.
    act(() => springe.zu('/einsaetze/1/abloesung?schicht=9'));
    const karte = await screen.findByRole('article', { name: 'Schicht Florian 9' });
    await waitFor(() => expect(karte).toHaveAttribute('data-hervorgehoben', 'true'));
    expect(sammelbanner()).toBeNull();
  });

  it('von „Ohne Schicht“ aus wechselt der Sprung zurück auf „Laufend“', async () => {
    // Florian 2 ist geplanter Ablöser ohne eigene Schicht, steht also unter „Ohne Schicht“.
    laufendLiefert([geplant()]);
    listeEinheitenPerioden.mockResolvedValue([
      { einheit_id: 12, perioden: [{ anker: 'alarmierung', beginn_at: inMinuten(-30) }] },
    ]);
    renderPage();
    await screen.findByRole('article', { name: 'Schicht Florian 1' });
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /^Ohne Schicht/ })).toHaveTextContent('(1)'),
    );
    await userEvent.click(screen.getByRole('radio', { name: /^Ohne Schicht/ }));
    await screen.findByRole('article', { name: 'Florian 2 ohne Schicht' });
    act(() => springe.zu('/einsaetze/1/abloesung?schicht=1'));
    const karte = await screen.findByRole('article', { name: 'Schicht Florian 1' });
    await waitFor(() => expect(karte).toHaveAttribute('data-hervorgehoben', 'true'));
    expect(screen.getByRole('radio', { name: /^Laufend/ })).toBeChecked();
  });
});
