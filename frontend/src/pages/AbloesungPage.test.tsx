import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { MemoryRouter, Routes, Route } from 'react-router';
import AbloesungPage from './AbloesungPage';
import { AuthProvider } from '../auth/AuthContext';
import type { Abloesung } from '../api/types';

dayjs.extend(utc);

const einsatz = vi.hoisted(() => ({
  wert: { id: 1, bezeichnung: 'Hochwasser', status: 'aktiv', meine_rolle: 'einsatzleitung' },
}));
vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn(() => Promise.resolve(einsatz.wert)),
}));
vi.mock('../api/einheiten', () => ({
  listeEinheiten: vi.fn().mockResolvedValue([
    { id: 11, name: 'Florian 1', abschnitt_id: 7 },
    { id: 12, name: 'Florian 2', abschnitt_id: null },
    { id: 13, name: 'Florian 3', abschnitt_id: 7 },
  ]),
}));

const listeAbloesungen = vi.fn();
const listeAbloesungVorgaben = vi.fn();
const beginneSchicht = vi.fn();
const vollzieheAbloesung = vi.fn();
const nimmVollzugZurueck = vi.fn();
const aendereSchicht = vi.fn();
const setzeAbloesungVorgabe = vi.fn();
vi.mock('../api/abloesungen', () => ({
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
  rhythmus_quelle: 'abschnitt',
  faellig_at: inMinuten(60),
  status: 'laufend',
  ruecknehmbar: false,
  angelegt_at: inMinuten(-300),
  ...over,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ergebnis = render(
    <QueryClientProvider client={client}>
      <AntApp>
        <AuthProvider>
          <MemoryRouter initialEntries={['/einsaetze/1/abloesung']}>
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
    // Herkunft des Rhythmus als Wort.
    expect(within(bald).getByText(/Vorgabe des Abschnitts/)).toBeInTheDocument();
    expect(within(plan).getByText(/eigener Wert/)).toBeInTheDocument();
  });

  it('ohne Schreibrecht: Grund im Kopf, Primäraktion gesperrt, keine Kartenaktionen', async () => {
    einsatz.wert = { ...einsatz.wert, meine_rolle: 'beobachter' };
    renderPage();
    await screen.findAllByRole('article');
    expect(
      screen.getByText(/Nur Einsatzleitung und Führungspersonal können Schichten beginnen/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Schicht beginnen' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Ablösung vollziehen' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Aktionen zu/ })).toBeNull();
  });

  it('Vollzug: Dialog vorbelegt, POST, Rückgängig ruft die Rücknahme', async () => {
    const a = schicht({ id: 1, faellig_at: inMinuten(-12), abloesende_einheit_id: 12 });
    listeAbloesungen.mockImplementation((_e: number, status: string) =>
      Promise.resolve(status === 'laufend' ? [a] : []),
    );
    vollzieheAbloesung.mockResolvedValue({
      abgeloest: { ...a, status: 'abgeloest', ruecknehmbar: true },
      folgeschicht: schicht({ id: 2, einheit_id: 12, einheit_name: 'Florian 2' }),
    });
    nimmVollzugZurueck.mockResolvedValue(a);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Ablösung vollziehen' }));
    const dialog = await screen.findByRole('dialog');
    // Struktur, aus der „Enter sendet" folgt (Erfassungs-Norm B4): Knopf im <form>, kein
    // antd-Fuß. Ein Select-Feld nimmt Enter selbst — die Zusicherung ist die Struktur.
    const knopf = within(dialog).getByRole('button', { name: 'Vollziehen' });
    expect(knopf.closest('form')).not.toBeNull();
    expect(dialog.querySelector('.ant-modal-footer')).toBeNull();
    await userEvent.click(knopf);
    await waitFor(() =>
      expect(vollzieheAbloesung).toHaveBeenCalledWith(1, 1, {
        vollzogen_at: undefined,
        abloesende_einheit_id: 12,
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: /Rückgängig/ }));
    await waitFor(() => expect(nimmVollzugZurueck).toHaveBeenCalledWith(1, 1));
  });

  it('Schicht beginnen: Enter-Struktur und Rhythmus in Stunden → Minuten', async () => {
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
    await userEvent.type(within(dialog).getByLabelText('Rhythmus (Stunden)'), '4.5');
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
    const feld = within(dialog).getByLabelText('Rhythmus (Stunden)');
    await userEvent.clear(feld);
    await userEvent.type(feld, '8');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(setzeAbloesungVorgabe).toHaveBeenCalledWith(1, 7, 480));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await aendern();
    dialog = await screen.findByRole('dialog');
    await userEvent.clear(within(dialog).getByLabelText('Rhythmus (Stunden)'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(setzeAbloesungVorgabe).toHaveBeenLastCalledWith(1, 7, null));
  });

  // ── LFH-647: fremde Neuzugänge per Sammelbanner, Prüfliste Kriterium 12 ──────────────
  describe('Live-Zufluss (LFH-647)', () => {
    const eins = () => schicht({ id: 1, faellig_at: inMinuten(-12) });
    const zwei = () => schicht({ id: 2, faellig_at: inMinuten(20) });
    const drei = () => schicht({ id: 3, faellig_at: inMinuten(240), rhythmus_quelle: 'einheit' });
    // Die fremde Schicht ist die überfälligste — die Server-Ordnung stellt sie OBEN hin.
    // Landete sie unten, verschöbe sich auch ohne Schleuse nichts, und der Test bewiese nichts.
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
      // Die Zahlen lügen nicht: der Kopf zählt die zurückgehaltene mit, nur die Karte wartet.
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
      await userEvent.type(within(dialog).getByLabelText('Rhythmus (Stunden)'), '4');
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
      await userEvent.type(within(dialog).getByLabelText('Rhythmus (Stunden)'), '4');
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
      // Nimmt das Banner beim Erscheinen eine eigene Zeile, schiebt es genau die Karten weg,
      // die es schützen soll. Die Zeile existiert vorher schon; die Höhe misst e2e.
      const { client } = renderPage();
      await screen.findAllByRole('article');
      const zeile = document.querySelector('[data-lfh="abloesung-werkzeugzeile"]');
      expect(zeile).not.toBeNull();
      laufendLiefert([fremd(), eins(), zwei(), drei()]);
      await client.invalidateQueries();
      await waitFor(() => expect(sammelbanner()).not.toBeNull());
      expect(sammelbanner()!.parentElement).toBe(zeile);
    });

    // ── LFH-660: eine fremde Änderung von Rhythmus/Beginn ordnet nicht unter dem Cursor um ──
    // Gezeigt: 1 überfällig, 4 planmäßig (2 h, eigener Rhythmus), 3 planmäßig (4 h, folgt der
    // Vorgabe). Fremd wird 3 auf „seit 30 min überfällig" gezogen — die Server-Ordnung
    // stellte sie über 4.
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
      // Kriterium 9: die fällige Karte, die unter einer planmäßigen gehalten wird, wird genannt.
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

    it('eine fremde Änderung, die die Folge nicht berührt, zeigt kein Banner', async () => {
      laufendLiefert([eins(), vier(), drei()]);
      const { client } = renderPage();
      await screen.findAllByRole('article');
      laufendLiefert([eins(), schicht({ id: 4, faellig_at: inMinuten(150) }), drei()]);
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
      const feld = within(dialog).getByLabelText('Rhythmus (Stunden)');
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
      // Der Server schreibt bei einer Vorgabe nur Schichten mit `rhythmus_quelle = 'abschnitt'`
      // um (`abloesung/repo.rs::vorgabe_setzen`). 4 hat einen eigenen Rhythmus und wurde FREMD
      // vorgezogen; die eigene Vorgabe darf sie nicht mit auftauen.
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
      const feld = within(dialog).getByLabelText('Rhythmus (Stunden)');
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
      await userEvent.click(screen.getByRole('radio', { name: 'Abgelöst' }));
      await screen.findByText('Noch keine Ablösung vollzogen');
      await userEvent.click(screen.getByRole('radio', { name: /^Laufend/ }));
      await waitFor(() => expect(kartenNamen()).toHaveLength(4));
      expect(sammelbanner()).toBeNull();
    });
  });
});
