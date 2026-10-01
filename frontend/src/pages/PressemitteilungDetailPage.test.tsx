import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { renderMitProviders } from '../test/utils';
import { ladeEinsatz, ladeModulFreigaben } from '../api/einsaetze';
import {
  aktualisierePressemitteilung,
  gibPressemitteilungFrei,
  ladePressemitteilung,
} from '../api/presse';
import type { EinsatzAnzeige, Pressemitteilung } from '../api/types';
import PressemitteilungDetailPage from './PressemitteilungDetailPage';
import { freigabenFixture } from '../test/fixtures';

vi.mock('../api/einsaetze', () => ({ ladeEinsatz: vi.fn(), ladeModulFreigaben: vi.fn() }));
vi.mock('../api/presse', () => ({
  ladePressemitteilung: vi.fn(),
  aktualisierePressemitteilung: vi.fn(),
  gibPressemitteilungFrei: vi.fn(),
  schreibePressemitteilungFort: vi.fn(),
  ladeMedienkontakte: vi.fn(),
  ladePressemitteilungen: vi.fn(),
}));

const EINSATZ = {
  id: 1,
  bezeichnung: 'Hochwasser Nord',
  status: 'aktiv',
  meine_rolle: 'einsatzleitung',
} as EinsatzAnzeige;

const ENTWURF = {
  id: 4,
  einsatz_id: 1,
  vorlage: 'bevoelkerungshinweis',
  titel: 'Warnung Deich',
  zeitstand: '2026-09-30 12:00:00',
  status: 'entwurf',
  abschnitte: [{ schluessel: 'gefahr', text: 'Deichbruch droht' }],
  version: 1,
  ersteller_id: 1,
  ersteller_name: 'Anna',
  erstellt_at: '2026-09-30 12:00:00',
  aktualisiert_at: '2026-09-30 12:00:00',
} as Pressemitteilung;

function setup() {
  return renderMitProviders(
    <Routes>
      <Route
        path="/einsaetze/:id/stab/presse/mitteilungen/:mitteilungId"
        element={<PressemitteilungDetailPage />}
      />
    </Routes>,
    { route: '/einsaetze/1/stab/presse/mitteilungen/4' },
  );
}

beforeEach(() => {
  vi.mocked(ladeEinsatz).mockResolvedValue(EINSATZ);
  vi.mocked(ladeModulFreigaben).mockResolvedValue(freigabenFixture());
  vi.mocked(ladePressemitteilung).mockResolvedValue(ENTWURF);
  vi.mocked(aktualisierePressemitteilung).mockReset().mockResolvedValue(ENTWURF);
  vi.mocked(gibPressemitteilungFrei)
    .mockReset()
    .mockResolvedValue({ ...ENTWURF, status: 'freigegeben' });
});

describe('PressemitteilungDetailPage (LFH-554)', () => {
  it('zeigt den Entwurf mit den Abschnitten der Vorlage', async () => {
    setup();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Warnung Deich' }),
    ).toBeInTheDocument();
    // Die Akkordeon-Köpfe sind die Gliederung; jeder Abschnitt trägt zusätzlich ein Feldetikett.
    const koepfe = [...document.querySelectorAll('.ant-collapse-header')].map((k) => k.textContent);
    expect(koepfe).toEqual([
      'Gefahr',
      'Betroffenes Gebiet (leer)',
      'Verhaltenshinweise (leer)',
      'Weitere Informationen (leer)',
    ]);
    expect(screen.getByText('Entwurf')).toBeInTheDocument();
  });

  it('Führungspersonal: Freigeben gesperrt sichtbar, der Grund nennt die Einsatzleitung', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue({ ...EINSATZ, meine_rolle: 'fuehrungspersonal' });
    setup();
    const knopf = await screen.findByRole('button', { name: 'Freigeben' });
    expect(knopf).toBeDisabled();
    expect(screen.getByText(/Freigeben darf nur die Einsatzleitung/)).toBeInTheDocument();
    // Schreiben darf sie trotzdem.
    expect(screen.getByRole('button', { name: 'Entwurf speichern' })).toBeEnabled();
  });

  it('Einsatzleitung: Freigabe speichert zuerst und gibt dann frei', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Freigeben' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Pressemitteilung freigeben\?/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Freigeben' }));
    await waitFor(() => expect(gibPressemitteilungFrei).toHaveBeenCalledWith(1, 4));
    expect(aktualisierePressemitteilung).toHaveBeenCalled();
    const vorFreigabe = vi.mocked(aktualisierePressemitteilung).mock.invocationCallOrder[0];
    expect(vorFreigabe).toBeLessThan(
      vi.mocked(gibPressemitteilungFrei).mock.invocationCallOrder[0],
    );
  });

  it('ein Klick auf „Entwurf speichern“ ist EIN PATCH; der Druckkopf kennzeichnet den Entwurf', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Entwurf speichern' }));
    await waitFor(() => expect(aktualisierePressemitteilung).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(aktualisierePressemitteilung).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Entwurf · Version 1')).toBeInTheDocument();
  });

  it('eine freigegebene Mitteilung ist Lesetext mit Folgemeldung und ETB-Verweis', async () => {
    vi.mocked(ladePressemitteilung).mockResolvedValue({
      ...ENTWURF,
      status: 'freigegeben',
      etb_eintrag_id: 77,
      freigegeben_von_name: 'Erika Leitung',
    });
    setup();
    expect(await screen.findByText('Deichbruch droht')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zum ETB-Eintrag' })).toHaveAttribute(
      'href',
      '/einsaetze/1/etb?eintrag=77',
    );
    expect(screen.getByRole('button', { name: 'Folgemeldung schreiben' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Freigeben' })).toBeNull();
  });
});
