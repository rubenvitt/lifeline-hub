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
import { adminFixture, authWertFixture, benutzerFixture } from '../../test/fixtures';

const PROVIDER_LISTE = [
  { id: 'passwort', typ: 'passwort' as const, anzeigename: 'Passwort', aktiviert: true },
  { id: 'oidc', typ: 'oidc' as const, anzeigename: 'PocketID', aktiviert: true },
  { id: 'webauthn', typ: 'webauthn' as const, anzeigename: 'Passkey', aktiviert: false },
];

function alsAdmin() {
  vi.mocked(useAuth).mockReturnValue(authWertFixture(adminFixture()));
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
    expect(
      await screen.findByRole('switch', { name: 'Anmeldeverfahren: PocketID' }),
    ).toBeInTheDocument();
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
    expect(
      await screen.findByRole('switch', { name: 'Anmeldeverfahren: Passwort' }),
    ).toBeDisabled();
  });

  // Die Ablehnung steht an der Seite, nicht in der Toast-Queue — ein Toast verfiele nach ~3 s,
  // während der Schalter längst zurückgesprungen ist. Geprüft wird die Abwesenheit des
  // Message-Containers.
  it('haelt die Ablehnung an der Seite fest, statt sie als Toast verfallen zu lassen', async () => {
    const meldung = 'Der letzte admin-taugliche Login-Weg kann nicht deaktiviert werden';
    vi.mocked(providerSchalten).mockRejectedValue(new ApiError(409, meldung));

    renderMitProviders(<Anmeldeverfahren />);
    await userEvent.click(
      await screen.findByRole('switch', { name: 'Anmeldeverfahren: PocketID' }),
    );

    const treffer = await screen.findByText(meldung);
    expect(treffer.closest('.ant-message')).toBeNull();
  });

  it('markiert die abgelehnte Zeile — und nur die', async () => {
    vi.mocked(providerSchalten).mockRejectedValue(new ApiError(409, 'Letzter Login-Weg'));

    renderMitProviders(<Anmeldeverfahren />);
    await userEvent.click(
      await screen.findByRole('switch', { name: 'Anmeldeverfahren: PocketID' }),
    );

    await waitFor(() => {
      const markiert = document.querySelectorAll('[data-provider-zeile][data-fehler="true"]');
      expect(markiert).toHaveLength(1);
      expect(markiert[0].getAttribute('data-provider-zeile')).toBe('oidc');
    });
  });

  /**
   * Die Marke wandert, sie sammelt sich nicht an: Quelle ist `mutation.variables`, also die zuletzt
   * gescheiterte Zeile. Ein eigener Sammel-State stünde nach zwei Fehlschlägen mit zwei Marken da.
   */
  it('traegt nach einem zweiten Fehlschlag die Marke an der ZWEITEN Zeile — und nur dort', async () => {
    vi.mocked(providerSchalten).mockRejectedValue(new ApiError(409, 'Letzter Login-Weg'));

    renderMitProviders(<Anmeldeverfahren />);
    await userEvent.click(
      await screen.findByRole('switch', { name: 'Anmeldeverfahren: PocketID' }),
    );
    await waitFor(() =>
      expect(
        document.querySelector('[data-provider-zeile="oidc"][data-fehler="true"]'),
      ).not.toBeNull(),
    );

    await userEvent.click(screen.getByRole('switch', { name: 'Anmeldeverfahren: Passkey' }));

    await waitFor(() => {
      const markiert = document.querySelectorAll('[data-provider-zeile][data-fehler="true"]');
      expect(markiert).toHaveLength(1);
      expect(markiert[0].getAttribute('data-provider-zeile')).toBe('webauthn');
    });
  });

  // Gegenrichtung: ein Erfolg anderswo räumt die Marke ab (`isError` fällt).
  it('raeumt die Marke, sobald irgendeine Zeile erfolgreich schaltet', async () => {
    vi.mocked(providerSchalten).mockRejectedValueOnce(new ApiError(409, 'Letzter Login-Weg'));

    renderMitProviders(<Anmeldeverfahren />);
    await userEvent.click(
      await screen.findByRole('switch', { name: 'Anmeldeverfahren: PocketID' }),
    );
    await waitFor(() =>
      expect(
        document.querySelector('[data-provider-zeile="oidc"][data-fehler="true"]'),
      ).not.toBeNull(),
    );

    await userEvent.click(screen.getByRole('switch', { name: 'Anmeldeverfahren: Passkey' }));

    await waitFor(() =>
      expect(document.querySelectorAll('[data-provider-zeile][data-fehler="true"]')).toHaveLength(
        0,
      ),
    );
  });

  it('markiert ohne Ablehnung gar keine Zeile', async () => {
    renderMitProviders(<Anmeldeverfahren />);
    await screen.findByRole('switch', { name: 'Anmeldeverfahren: PocketID' });

    expect(document.querySelectorAll('[data-provider-zeile][data-fehler="true"]')).toHaveLength(0);
  });

  it('ist read-only für Nicht-Admins (fuehrungskraft)', async () => {
    vi.mocked(useAuth).mockReturnValue(
      authWertFixture(benutzerFixture({ id: 2, org_rolle: 'fuehrungskraft', anzeigename: 'FK' })),
    );

    renderMitProviders(<Anmeldeverfahren />);
    expect(
      await screen.findByRole('switch', { name: 'Anmeldeverfahren: PocketID' }),
    ).toBeDisabled();
  });
});

/** Der Sperrgrund steht sichtbar, nicht nur im Tooltip — auf dem Tablet gibt es kein Hover. */
describe('Anmeldeverfahren · Sperrgrund und Zeilenziel (LFH-370)', () => {
  // Eigenes `beforeEach`: sonst sickerte der Führungskraft-Mock aus dem ersten Fall durch.
  beforeEach(() => {
    alsAdmin();
    vi.mocked(providerListeAdmin).mockResolvedValue(PROVIDER_LISTE.map((p) => ({ ...p })) as never);
    vi.mocked(providerSchalten).mockResolvedValue(
      PROVIDER_LISTE.map((p) => (p.id === 'oidc' ? { ...p, aktiviert: false } : { ...p })) as never,
    );
  });

  it('nennt der Fuehrungskraft den Grund je Zeile, nicht nur die Ausgrauung', async () => {
    vi.mocked(useAuth).mockReturnValue(
      authWertFixture(benutzerFixture({ id: 2, org_rolle: 'fuehrungskraft', anzeigename: 'FK' })),
    );

    renderMitProviders(<Anmeldeverfahren />);
    await screen.findByRole('switch', { name: 'Anmeldeverfahren: PocketID' });
    // Jede Zeile trägt ihn.
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

    // Gesperrt: kein Label — eine Aufforderung ins Leere wäre schlimmer als keine.
    expect(container.querySelector(`label[for="${passwort.id}"]`)).toBeNull();
  });

  it('schaltet ueber einen Klick auf die Beschriftung — genau einmal', async () => {
    renderMitProviders(<Anmeldeverfahren />);
    const oidc = await screen.findByRole('switch', { name: 'Anmeldeverfahren: PocketID' });
    expect(oidc).toBeChecked();

    // Die Mocks dieser Datei werden nie geleert; ohne `mockClear` wäre „genau einmal" nicht
    // prüfbar.
    vi.mocked(providerSchalten).mockClear();
    await userEvent.click(screen.getByText('PocketID'));

    await waitFor(() => expect(providerSchalten).toHaveBeenCalledWith('oidc', false));
    // Ein Label-Klick, der zweimal schaltete, käme sofort wieder zurück.
    expect(vi.mocked(providerSchalten).mock.calls).toHaveLength(1);
  });

  it('das aria-label schlaegt weiterhin das neue label', async () => {
    // Wer das `aria-label` als „doppelt" entfernt, bekommt still einen anderen Accessible Name.
    renderMitProviders(<Anmeldeverfahren />);
    expect(
      await screen.findByRole('switch', { name: 'Anmeldeverfahren: PocketID' }),
    ).toBeInTheDocument();
  });
});

/**
 * Das Zeilenziel ohne Render (nacktes `ConfigProvider`, kein Layout in jsdom). Böden als Literale.
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
    // Polsterung allein trägt den Boden nicht, minHeight allein klebt den Text an die Kante.
    expect(zeilenzielStil(tokenFuer('kompakt')).padding).toBe('7px 11px');
    expect(zeilenzielStil(tokenFuer('handschuh')).padding).toBe('16px 26px');
  });
});
