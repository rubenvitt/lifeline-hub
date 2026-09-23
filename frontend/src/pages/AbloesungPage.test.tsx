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
  return render(
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
});
