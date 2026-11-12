import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import { waehleMenueEintrag } from '../../test/menue';
import Anbindungen, { zustandAnzeige } from './Anbindungen';
import { ablehnungText, scopeText } from '../../api/anbindungen';

vi.mock('../../auth/AuthContext', () => ({
  useAuth: vi.fn(),
  AuthProvider: ({ children }: { children?: unknown }) => children,
}));

import { useAuth } from '../../auth/AuthContext';
import { adminFixture, authWertFixture, benutzerFixture } from '../../test/fixtures';

/** Anbindungen: Maschinenzugänge für Fremdsysteme (LLH-1652). */

const zugang = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Adapter ${id}`,
  scopes: ['alarmmeldungen:write'],
  gueltig_bis: null,
  zustand: 'aktiv',
  is_abgelaufen: false,
  fingerabdruck: 'CPV0-CWYP-XP44-QW0W-5GH2-V0ND-M1T0-YADC',
  fingerabdruck_neu: null,
  angelegt_at: '2026-11-12 09:00:00',
  widerrufen_at: null,
  zuletzt_genutzt_at: null,
  letzte_ablehnung: null,
  ...extra,
});

function stelleBereit(zugaenge: unknown[] = [zugang('a')], gesperrt: string | null = null) {
  const aufrufe: { pfad: string; body: unknown }[] = [];
  server.use(
    http.get('/api/admin/anbindungen', () =>
      HttpResponse.json({ zugaenge, gesperrt_grund: gesperrt, instanz_fingerabdruck: 'ABCD' }),
    ),
    http.post('/api/admin/anbindungen', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      aufrufe.push({ pfad: 'anlegen', body });
      return HttpResponse.json(
        {
          zugang: zugang('neu', { name: body.name, zustand: 'wartet', fingerabdruck: null }),
          code: 'K7QM-3XRA-W9EB-T2HD',
          laeuft_ab_at: '2026-11-12 09:15:00',
        },
        { status: 201 },
      );
    }),
    http.post('/api/admin/anbindungen/a/widerrufen', () => {
      aufrufe.push({ pfad: 'widerrufen', body: null });
      return HttpResponse.json(
        zugang('a', { zustand: 'widerrufen', widerrufen_at: '2026-11-12 10:00:00' }),
      );
    }),
    http.post('/api/admin/anbindungen/a/code', () => {
      aufrufe.push({ pfad: 'code', body: null });
      return HttpResponse.json(
        { zugang: zugang('a'), code: 'ZZZZ-YYYY-XXXX-WWWW', laeuft_ab_at: '2026-11-12 09:15:00' },
        { status: 201 },
      );
    }),
  );
  return aufrufe;
}

describe('Anbindungen (LLH-1652)', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue(authWertFixture(adminFixture()));
  });

  it('zeigt Rechte in Klartext mit Wire-Wert, Fingerabdruck und letzte Ablehnung', async () => {
    stelleBereit([
      zugang('a', {
        scopes: ['einsaetze:read', 'events:read'],
        letzte_ablehnung: { at: '2026-11-12 10:38:00', grund: 'uhr', abweichung_s: -420 },
      }),
    ]);
    renderMitProviders(<Anbindungen />);
    expect(await screen.findByText('Adapter a')).toBeInTheDocument();
    const rechte = document.querySelector('[data-lfh="anbindung-rechte"]')!;
    expect(rechte.textContent).toBe(
      'Einsätze lesen einsaetze:read · Ereignisse abrufen events:read',
    );
    expect(screen.getByText('CPV0-CWYP-XP44-QW0W-5GH2-V0ND-M1T0-YADC')).toBeInTheDocument();
    expect(document.querySelector('[data-lfh="anbindung-ablehnung"]')!.textContent).toMatch(
      /^Letzte Ablehnung: Uhr geht 7 min nach · /,
    );
  });

  it('legt an und zeigt den Code einmal, mit Kommando', async () => {
    const aufrufe = stelleBereit([]);
    const user = userEvent.setup();
    renderMitProviders(<Anbindungen />);
    await screen.findByText('Noch keine Anbindung');
    await user.click(screen.getByRole('button', { name: /Anbindung anlegen/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Anbindung anlegen' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Traccar-Brücke');
    await user.click(within(dialog).getByRole('checkbox', { name: /Positionen einliefern/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen und Code zeigen' }));
    await waitFor(() =>
      expect(aufrufe).toEqual([
        {
          pfad: 'anlegen',
          body: { name: 'Traccar-Brücke', scopes: ['positionen:write'], gueltig_bis: null },
        },
      ]),
    );
    const code = await screen.findByText('K7QM-3XRA-W9EB-T2HD');
    const box = code.closest<HTMLElement>('[data-lfh="anbindung-code"]')!;
    expect(box.textContent).toMatch(/nur jetzt sichtbar/);
    expect(box.textContent).toMatch(/lifeline-hub zugang redeem .* K7QM-3XRA-W9EB-T2HD/);
  });

  it('verlangt beim Anlegen mindestens ein Recht', async () => {
    const aufrufe = stelleBereit([]);
    const user = userEvent.setup();
    renderMitProviders(<Anbindungen />);
    await screen.findByText('Noch keine Anbindung');
    await user.click(screen.getByRole('button', { name: /Anbindung anlegen/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Anbindung anlegen' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'x');
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen und Code zeigen' }));
    expect(await within(dialog).findByText('Mindestens ein Recht wählen')).toBeInTheDocument();
    expect(aufrufe).toEqual([]);
  });

  it('widerruft erst nach Rückfrage; neuer Code aus dem Menü', async () => {
    const aufrufe = stelleBereit();
    renderMitProviders(<Anbindungen />);
    await screen.findByText('Adapter a');
    await waehleMenueEintrag(
      screen.getByRole('button', { name: 'Aktionen zu Anbindung Adapter a' }),
      /Neuer Code/,
    );
    expect(await screen.findByText('ZZZZ-YYYY-XXXX-WWWW')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Fertig' }));
    await waehleMenueEintrag(
      screen.getByRole('button', { name: 'Aktionen zu Anbindung Adapter a' }),
      /Widerrufen/,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Adapter a widerrufen?' });
    expect(aufrufe).toEqual([{ pfad: 'code', body: null }]);
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Widerrufen' }));
    await waitFor(() =>
      expect(aufrufe).toEqual([
        { pfad: 'code', body: null },
        { pfad: 'widerrufen', body: null },
      ]),
    );
  });

  it('lässt ohne System-Admin nur lesen', async () => {
    vi.mocked(useAuth).mockReturnValue(authWertFixture(benutzerFixture()));
    stelleBereit();
    renderMitProviders(<Anbindungen />);
    await screen.findByText('Adapter a');
    expect(screen.queryByRole('button', { name: /Anbindung anlegen/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Aktionen zu/ })).not.toBeInTheDocument();
  });

  it('sperrt am gekoppelten ELW das Anlegen und nennt den Hub', async () => {
    stelleBereit([], 'Diese Instanz meldet sich für die Organisation bei Hub Kreis.');
    renderMitProviders(<Anbindungen />);
    expect(
      await screen.findByText(/meldet sich für die Organisation bei Hub Kreis/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Anbindung anlegen/ })).toBeDisabled();
  });
});

describe('Anbindungen · Wortlaut', () => {
  it('Zustand als Wort', () => {
    expect(zustandAnzeige({ zustand: 'aktiv', is_abgelaufen: false })).toEqual({
      wort: 'aktiv',
      ton: 'normal',
    });
    expect(zustandAnzeige({ zustand: 'aktiv', is_abgelaufen: true }).wort).toBe('abgelaufen');
    expect(zustandAnzeige({ zustand: 'wartet', is_abgelaufen: false }).wort).toBe(
      'wartet auf Schlüssel',
    );
    expect(zustandAnzeige({ zustand: 'widerrufen', is_abgelaufen: true }).wort).toBe('widerrufen');
  });

  it('Ablehnungsgrund mit Richtung der Uhr', () => {
    expect(ablehnungText({ grund: 'uhr', abweichung_s: -420 })).toBe('Uhr geht 7 min nach');
    expect(ablehnungText({ grund: 'uhr', abweichung_s: 610 })).toBe('Uhr geht 10 min vor');
    expect(ablehnungText({ grund: 'uhr', abweichung_s: 20 })).toBe('Token lebt länger als 60 s');
    expect(ablehnungText({ grund: 'body', abweichung_s: null })).toBe(
      'Body passt nicht zur Signatur (bh)',
    );
  });

  it('unbekannter Scope bleibt als Wire-Wert stehen', () => {
    expect(scopeText('lage:read')).toBe('Lage lesen');
    expect(scopeText('neu:use')).toBe('neu:use');
  });
});
