import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import InstanzkopplungSeite from './InstanzkopplungSeite';
import type { InstanzUebersicht } from '../api/types';

vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
  AuthProvider: ({ children }: { children?: unknown }) => children,
}));
vi.mock('../api/instanz', () => ({
  loadInstanzUebersicht: vi.fn(),
  issueKopplungscode: vi.fn(),
  redeemKopplungscode: vi.fn(),
  widerrufeKopplung: vi.fn(),
  registriereUnterschriftsschluessel: vi.fn(),
  gegenzeichne: vi.fn(),
  widerrufeUnterschriftsschluessel: vi.fn(),
}));

import { useAuth } from '../auth/AuthContext';
import {
  gegenzeichne,
  loadInstanzUebersicht,
  issueKopplungscode,
  widerrufeKopplung,
  widerrufeUnterschriftsschluessel,
} from '../api/instanz';
import { adminFixture, authWertFixture, benutzerFixture } from '../test/fixtures';

const uebersicht = (teil: Partial<InstanzUebersicht> = {}): InstanzUebersicht => ({
  name: 'ELW 1 DRK Nord',
  kennung: 'k-elw',
  fingerabdruck: 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH',
  protokoll: 1,
  softwarestand: '1.0.0',
  passkeys_eingerichtet: true,
  eigener_schluessel: true,
  kopplungen: [
    {
      id: 1,
      gegenueber_name: 'Hub Landesverband',
      gegenueber_kennung: 'k-hub',
      gegenueber_fingerabdruck: 'ZZZZ-YYYY',
      richtung: 'meldet_sich',
      gegenueber_adresse: 'https://hub.example.org',
      zustand: 'aktiv',
      protokoll: 'update_hier',
      zuletzt_gesehen_at: '2026-11-08 12:00:00',
      org: {
        id: 1,
        fremde_org_name: 'DRK LV',
        fremde_org_kennung: 'k-hub/1',
        angelegt_at: '2026-11-08 11:00:00',
      },
    },
  ],
  schluessel: [
    {
      id: 7,
      benutzer_name: 'Bea Admin',
      bezeichnung: 'Stick B',
      fingerabdruck: 'SSSS-TTTT',
      zustand: 'wartet_auf_gegenzeichnung',
      herkunft: 'lokal',
      eigen: false,
      erstellt_at: '2026-11-08 10:00:00',
    },
  ],
  ...teil,
});

describe('InstanzkopplungSeite', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue(authWertFixture(adminFixture()));
    vi.mocked(loadInstanzUebersicht).mockResolvedValue(uebersicht());
  });

  it('zeigt Fingerabdruck, Kopplung mit Richtung und Hinweis, Schlüssel', async () => {
    renderMitProviders(<InstanzkopplungSeite />);
    expect(await screen.findByText('AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH')).toBeInTheDocument();
    expect(
      screen.getByText('Hub Landesverband · diese Instanz meldet sich dort'),
    ).toBeInTheDocument();
    expect(screen.getByText('Update nötig: diese Instanz ist zu alt')).toBeInTheDocument();
    expect(screen.getByText('Bea Admin · Stick B')).toBeInTheDocument();
  });

  it('Code ausstellen zeigt den Code einmal', async () => {
    vi.mocked(issueKopplungscode).mockResolvedValue({
      code: 'ABCD-EFGH-JKMN-PQRS',
      laeuft_ab_at: '2026-11-08 12:15:00',
      fingerabdruck: 'AAAA',
    });
    renderMitProviders(<InstanzkopplungSeite />);
    const knopf = await screen.findByRole('button', { name: /Code ausstellen/ });
    await waitFor(() => expect(knopf).not.toBeDisabled());
    await userEvent.click(knopf);
    expect(await screen.findByText('ABCD-EFGH-JKMN-PQRS')).toBeInTheDocument();
  });

  it('ohne eigenen Schlüssel ist Code ausstellen gesperrt und sagt warum', async () => {
    vi.mocked(loadInstanzUebersicht).mockResolvedValue(uebersicht({ eigener_schluessel: false }));
    renderMitProviders(<InstanzkopplungSeite />);
    expect(
      await screen.findByText('Erst einen eigenen Unterschriftsschlüssel registrieren'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Code ausstellen/ })).toBeDisabled();
  });

  it('Gegenzeichnen ruft die Zeremonie für den wartenden Schlüssel', async () => {
    vi.mocked(gegenzeichne).mockResolvedValue({
      ...uebersicht().schluessel[0],
      zustand: 'gueltig',
    });
    renderMitProviders(<InstanzkopplungSeite />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Aktionen zum Schlüssel Stick B von Bea Admin' }),
    );
    await userEvent.click(await screen.findByText('Gegenzeichnen'));
    await waitFor(() => expect(gegenzeichne).toHaveBeenCalledWith(7));
  });

  it.each([
    {
      was: 'Kopplung',
      menue: 'Aktionen zur Kopplung mit Hub Landesverband',
      eintrag: 'Widerrufen …',
      dialog: 'Kopplung mit Hub Landesverband widerrufen?',
      anfrage: widerrufeKopplung,
    },
    {
      was: 'Schlüssel',
      menue: 'Aktionen zum Schlüssel Stick B von Bea Admin',
      eintrag: 'Widerrufen …',
      dialog: 'Schlüssel Stick B von Bea Admin widerrufen?',
      anfrage: widerrufeUnterschriftsschluessel,
    },
  ])('Widerruf ($was): solange er läuft, führt kein Knopf aus dem Dialog', async (fall) => {
    let ablehnen: (e: Error) => void = () => {};
    vi.mocked(fall.anfrage).mockReturnValue(
      new Promise<never>((_, reject) => {
        ablehnen = reject;
      }),
    );
    renderMitProviders(<InstanzkopplungSeite />);
    await userEvent.click(await screen.findByRole('button', { name: fall.menue }));
    await userEvent.click(await screen.findByText(fall.eintrag));
    const dialog = await screen.findByRole('dialog', { name: fall.dialog });
    await userEvent.click(within(dialog).getByRole('button', { name: /Widerrufen/ }));
    await waitFor(() => expect(fall.anfrage).toHaveBeenCalled());
    expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: /close|schließen/i })).toBeDisabled();
    ablehnen(new Error('Gegenstelle lehnt ab'));
    expect(await within(dialog).findByText('Nicht widerrufen')).toBeInTheDocument();
  });

  it('ohne Admin-Rolle nur Ansicht', async () => {
    vi.mocked(useAuth).mockReturnValue(
      authWertFixture(benutzerFixture({ org_rolle: 'fuehrungskraft' })),
    );
    renderMitProviders(<InstanzkopplungSeite />);
    expect(await screen.findByText(/nur System-Admin/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Code ausstellen/ })).not.toBeInTheDocument();
  });

  it('ein späterer Fehlschlag des Abrufs blendet vorhandene Daten nicht aus', async () => {
    vi.mocked(loadInstanzUebersicht)
      .mockResolvedValueOnce(uebersicht())
      .mockRejectedValue(new Error('offline'));
    const { client } = renderMitProviders(<InstanzkopplungSeite />);
    expect(await screen.findByText('Bea Admin · Stick B')).toBeInTheDocument();
    await client.refetchQueries();
    await waitFor(() => expect(loadInstanzUebersicht).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Bea Admin · Stick B')).toBeInTheDocument();
    expect(screen.queryByText('Instanzkopplung nicht ladbar')).not.toBeInTheDocument();
  });
});
