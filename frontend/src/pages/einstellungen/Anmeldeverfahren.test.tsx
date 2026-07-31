import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import Anmeldeverfahren, { zeilenzielStil } from './Anmeldeverfahren';
import { dichten } from '../../theme/tokens';

vi.mock('../../auth/AuthContext', () => ({
  useAuth: vi.fn(),
  AuthProvider: ({ children }: { children?: unknown }) => children,
}));
vi.mock('../../api/auth', () => ({
  providerListeAdmin: vi.fn(),
  providerSchalten: vi.fn(),
}));

import { useAuth } from '../../auth/AuthContext';
import { providerListeAdmin, providerSchalten } from '../../api/auth';
import { ApiError } from '../../api/client';

const PROVIDER_LISTE = [
  { id: 'passwort', typ: 'passwort' as const, anzeigename: 'Passwort', aktiviert: true },
  { id: 'oidc', typ: 'oidc' as const, anzeigename: 'PocketID', aktiviert: true },
  { id: 'webauthn', typ: 'webauthn' as const, anzeigename: 'Passkey', aktiviert: false },
];

function alsAdmin() {
  vi.mocked(useAuth).mockReturnValue({
    benutzer: { id: 1, system_rolle: 'admin', org_rolle: 'keine', anzeigename: 'Admin', benutzername: 'admin', aktiv: true, erstellt_at: '', totp_aktiviert: false },
    laedt: false, login: vi.fn(), logout: vi.fn(), aktualisiere: vi.fn(),
  } as never);
}

describe('Anmeldeverfahren', () => {
  beforeEach(() => {
    alsAdmin();
    vi.mocked(providerListeAdmin).mockResolvedValue(PROVIDER_LISTE.map((p) => ({ ...p })) as never);
    vi.mocked(providerSchalten).mockResolvedValue(
      PROVIDER_LISTE.map((p) => (p.id === 'oidc' ? { ...p, aktiviert: false } : { ...p })) as never,
    );
  });

  it('listet die konfigurierten Auth-Provider', async () => {
    renderMitProviders(<Anmeldeverfahren />);
    expect(await screen.findByRole('switch', { name: 'Anmeldeverfahren: PocketID' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Anmeldeverfahren: Passwort' })).toBeInTheDocument();
  });

  it('zeigt auch deaktivierte Provider (Admin-Endpoint, LFH-277)', async () => {
    renderMitProviders(<Anmeldeverfahren />);
    const passkey = await screen.findByRole('switch', { name: 'Anmeldeverfahren: Passkey' });
    expect(passkey).not.toBeChecked();
    expect(passkey).not.toBeDisabled();
  });

  it('schaltet einen Provider per PUT um und aktualisiert die Anzeige', async () => {
    renderMitProviders(<Anmeldeverfahren />);
    const oidc = await screen.findByRole('switch', { name: 'Anmeldeverfahren: PocketID' });
    expect(oidc).toBeChecked();

    await userEvent.click(oidc);

    await waitFor(() => expect(providerSchalten).toHaveBeenCalledWith('oidc', false));
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Anmeldeverfahren: PocketID' })).not.toBeChecked(),
    );
  });

  it('sperrt den passwort-Provider (garantierter Admin-Weg)', async () => {
    renderMitProviders(<Anmeldeverfahren />);
    expect(await screen.findByRole('switch', { name: 'Anmeldeverfahren: Passwort' })).toBeDisabled();
  });

  it('zeigt eine Fehlermeldung, wenn der Server ablehnt (409)', async () => {
    const meldung = 'Der letzte admin-taugliche Login-Weg kann nicht deaktiviert werden';
    vi.mocked(providerSchalten).mockRejectedValue(new ApiError(409, meldung));

    renderMitProviders(<Anmeldeverfahren />);
    await userEvent.click(await screen.findByRole('switch', { name: 'Anmeldeverfahren: PocketID' }));

    expect(await screen.findByText(meldung)).toBeInTheDocument();
  });

  it('ist read-only für Nicht-Admins (fuehrungskraft)', async () => {
    vi.mocked(useAuth).mockReturnValue({
      benutzer: { id: 2, system_rolle: 'keiner', org_rolle: 'fuehrungskraft', anzeigename: 'FK', benutzername: 'fk', aktiv: true, erstellt_at: '', totp_aktiviert: false },
      laedt: false, login: vi.fn(), logout: vi.fn(), aktualisiere: vi.fn(),
    } as never);

    renderMitProviders(<Anmeldeverfahren />);
    expect(await screen.findByRole('switch', { name: 'Anmeldeverfahren: PocketID' })).toBeDisabled();
  });
});

/**
 * Der Sperrgrund steht SICHTBAR (LFH-370 · B5j, Befund M17).
 *
 * Vorher hing er allein im Tooltip eines Wrapper-`<span>` — auf dem Führungs-Tablet gibt
 * es kein Hover, der Grund war dort gar nicht erreichbar. Und er deckte nur EINEN der drei
 * Sperrfälle ab: eine Führungskraft sah alles ausgegraut, ohne jede Begründung.
 */
describe('Anmeldeverfahren · Sperrgrund und Zeilenziel (LFH-370)', () => {
  // Eigenes `beforeEach`: das des ersten `describe` greift hier nicht, und ohne dieses
  // sickerte der Führungskraft-Mock aus dem ersten Fall in die folgenden.
  beforeEach(() => {
    alsAdmin();
    vi.mocked(providerListeAdmin).mockResolvedValue(PROVIDER_LISTE.map((p) => ({ ...p })) as never);
    vi.mocked(providerSchalten).mockResolvedValue(
      PROVIDER_LISTE.map((p) => (p.id === 'oidc' ? { ...p, aktiviert: false } : { ...p })) as never,
    );
  });

  it('nennt der Fuehrungskraft den Grund je Zeile, nicht nur die Ausgrauung', async () => {
    vi.mocked(useAuth).mockReturnValue({
      benutzer: { id: 2, system_rolle: 'keiner', org_rolle: 'fuehrungskraft', anzeigename: 'FK', benutzername: 'fk', aktiv: true, erstellt_at: '', totp_aktiviert: false },
      laedt: false, login: vi.fn(), logout: vi.fn(), aktualisiere: vi.fn(),
    } as never);

    renderMitProviders(<Anmeldeverfahren />);
    await screen.findByRole('switch', { name: 'Anmeldeverfahren: PocketID' });
    // JEDE Zeile traegt ihn — genau die Luecke, die der Tooltip nur fuer Passwort schloss.
    expect(screen.getAllByText('nur Admins').length).toBeGreaterThan(1);
  });

  it('nennt dem Admin den Grund NUR an der Passwort-Zeile', async () => {
    renderMitProviders(<Anmeldeverfahren />);
    await screen.findByRole('switch', { name: 'Anmeldeverfahren: Passwort' });
    expect(screen.getByText('nicht deaktivierbar')).toBeInTheDocument();
    expect(screen.queryByText('nur Admins')).not.toBeInTheDocument();
  });

  it('macht die bedienbare Zeile zum Ziel — und die gesperrte ausdruecklich nicht', async () => {
    const { container } = renderMitProviders(<Anmeldeverfahren />);
    const oidc = await screen.findByRole('switch', { name: 'Anmeldeverfahren: PocketID' });
    const passwort = screen.getByRole('switch', { name: 'Anmeldeverfahren: Passwort' });

    // Bedienbar: ein echtes <label htmlFor>, das auf den Switch zeigt.
    const label = container.querySelector<HTMLLabelElement>(`label[for="${oidc.id}"]`);
    expect(label, 'die bedienbare Zeile traegt ein Label').not.toBeNull();
    expect(label).toHaveTextContent('PocketID');

    // Gesperrt: KEIN Label — eine Aufforderung ins Leere waere schlimmer als keine.
    expect(container.querySelector(`label[for="${passwort.id}"]`)).toBeNull();
  });

  it('schaltet ueber einen Klick auf die Beschriftung — genau einmal', async () => {
    renderMitProviders(<Anmeldeverfahren />);
    const oidc = await screen.findByRole('switch', { name: 'Anmeldeverfahren: PocketID' });
    expect(oidc).toBeChecked();

    // Die Mocks dieser Datei werden nie geleert, die Aufrufe summieren sich sonst ueber
    // alle Tests — und „genau einmal" waere nicht pruefbar.
    vi.mocked(providerSchalten).mockClear();
    await userEvent.click(screen.getByText('PocketID'));

    await waitFor(() => expect(providerSchalten).toHaveBeenCalledWith('oidc', false));
    // Die zweite Haelfte: ein Label-Klick, der zweimal schaltete, kaeme sofort wieder
    // zurueck — und der Bediener saehe gar nichts.
    expect(vi.mocked(providerSchalten).mock.calls).toHaveLength(1);
  });

  it('das aria-label schlaegt weiterhin das neue label', async () => {
    // Die Falle fuer spaeter: wer das `aria-label` als "doppelt" entfernt, bekommt STILL
    // einen anderen Accessible Name — 'PocketID' statt 'Anmeldeverfahren: PocketID'.
    renderMitProviders(<Anmeldeverfahren />);
    expect(await screen.findByRole('switch', { name: 'Anmeldeverfahren: PocketID' })).toBeInTheDocument();
  });
});

/**
 * Das Zeilenziel ohne Render — `test/utils.tsx:31` montiert ein nacktes `ConfigProvider`,
 * jsdom rechnet kein Layout. Böden als LITERALE, nicht aus `dichten` zurückgelesen.
 */
describe('Anmeldeverfahren · Dichte', () => {
  const tokenFuer = (d: keyof typeof dichten) => ({
    controlHeight: dichten[d].zeilenhoehe,
    paddingSM: dichten[d].abstand.sm,
    padding: dichten[d].abstand.md,
  });

  it('traegt den Boden der Stufe', () => {
    expect(zeilenzielStil(tokenFuer('kompakt')).minHeight).toBe(30);
    expect(zeilenzielStil(tokenFuer('komfortabel')).minHeight).toBe(48);
    expect(zeilenzielStil(tokenFuer('handschuh')).minHeight).toBe(72);
  });

  it('traegt die ZWEITE Angabe daneben', () => {
    // Polsterung allein traegt den Boden nicht, minHeight allein klebt den Text an die Kante.
    expect(zeilenzielStil(tokenFuer('kompakt')).padding).toBe('7px 11px');
    expect(zeilenzielStil(tokenFuer('handschuh')).padding).toBe('16px 26px');
  });
});
