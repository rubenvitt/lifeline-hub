import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import { waehleMenueEintrag } from '../../test/menue';
import { Route, Routes } from 'react-router';
import Anbindungen from './Anbindungen';
import AnbindungAnsicht, { zugangPatch } from './AnbindungAnsicht';
import { zustandAnzeige } from './anbindungAnzeige';
import { alsZeitpunkt } from '../../anzeige/zeitEingabe';
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
  geaendert_at: '2026-11-12 09:00:00',
  widerrufen_at: null,
  widerrufen_von_name: null,
  zuletzt_genutzt_at: null,
  letzte_ablehnung: null,
  ...extra,
});

/** Der nächste PATCH mit Basis antwortet 409 (ein anderer hat inzwischen geändert). */
const konflikt = { offen: false };

/** Liste und Ansicht unter ihren Routen; das Anlegen springt in die Ansicht. */
function renderSeiten(route = '/admin/einstellungen/anbindungen') {
  return renderMitProviders(
    <Routes>
      <Route path="/admin/einstellungen/anbindungen" element={<Anbindungen />} />
      <Route path="/admin/einstellungen/anbindungen/:zugangId" element={<AnbindungAnsicht />} />
    </Routes>,
    { route, datenRouter: true },
  );
}

function stelleBereit(zugaenge: unknown[] = [zugang('a')], gesperrt: string | null = null) {
  konflikt.offen = false;
  const aufrufe: { pfad: string; body: unknown }[] = [];
  // Der Stand des Servers: jede Änderung landet hier, damit ein Neuladen sie wieder liefert.
  let stand = [...zugaenge] as { id: string }[];
  const merke = <Z extends { id: string }>(z: Z): Z => {
    stand = stand.some((x) => x.id === z.id)
      ? stand.map((x) => (x.id === z.id ? z : x))
      : [z, ...stand];
    return z;
  };
  server.use(
    http.get('/api/admin/anbindungen', () =>
      HttpResponse.json({
        zugaenge: stand,
        gesperrt_grund: gesperrt,
        instanz_fingerabdruck: 'ABCD',
      }),
    ),
    http.post('/api/admin/anbindungen', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      aufrufe.push({ pfad: 'anlegen', body });
      return HttpResponse.json(
        {
          zugang: merke(zugang('neu', { name: body.name, zustand: 'wartet', fingerabdruck: null })),
          code: 'K7QM-3XRA-W9EB-T2HD',
          laeuft_ab_at: '2026-11-12 09:15:00',
        },
        { status: 201 },
      );
    }),
    http.post('/api/admin/anbindungen/a/widerrufen', () => {
      aufrufe.push({ pfad: 'widerrufen', body: null });
      return HttpResponse.json(
        merke(
          zugang('a', {
            zustand: 'widerrufen',
            fingerabdruck: null,
            widerrufen_at: '2026-11-12 10:00:00',
          }),
        ),
      );
    }),
    http.patch('/api/admin/anbindungen/a', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      aufrufe.push({ pfad: 'aendern', body });
      if (konflikt.offen && body.basis_geaendert_at !== undefined) {
        konflikt.offen = false;
        return HttpResponse.json({ error: 'Zwischenzeitlich geändert' }, { status: 409 });
      }
      return HttpResponse.json(
        merke(
          zugang('a', {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.scopes !== undefined ? { scopes: body.scopes } : {}),
            geaendert_at: '2026-11-12 11:00:00',
          }),
        ),
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
    renderSeiten();
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
    renderSeiten();
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

    // Escape schließt den Code nicht: er ginge verloren, bevor er abgeschrieben ist.
    screen.getByRole('button', { name: 'Fertig' }).focus();
    await user.keyboard('{Escape}');
    expect(screen.getByText('K7QM-3XRA-W9EB-T2HD')).toBeInTheDocument();
    const codeDialog = screen.getByRole('dialog', { name: 'Code für Traccar-Brücke' });
    expect(within(codeDialog).queryByRole('button', { name: /Close|Schließen/ })).toBeNull();

    // „Fertig“ führt in die Ansicht der neuen Anbindung.
    await user.click(screen.getByRole('button', { name: 'Fertig' }));
    expect(await screen.findByRole('heading', { name: /Traccar-Brücke/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Anbindungen' })).toBeInTheDocument();
  });

  it('verlangt beim Anlegen mindestens ein Recht', async () => {
    const aufrufe = stelleBereit([]);
    const user = userEvent.setup();
    renderSeiten();
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
    renderSeiten();
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

  it('die Liste bearbeitet nicht selbst, der Name führt in die Ansicht', async () => {
    stelleBereit();
    const user = userEvent.setup();
    renderSeiten();
    await screen.findByText('Adapter a');
    await user.click(screen.getByRole('button', { name: 'Aktionen zu Anbindung Adapter a' }));
    expect(await screen.findByRole('menuitem', { name: /Neuer Code/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Bearbeiten/ })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('link', { name: 'Adapter a' }));
    expect(await screen.findByRole('heading', { name: /Adapter a/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zugang bearbeiten' })).toBeInTheDocument();
  });

  it('zeigt den letzten Stand weiter, wenn das Neuladen scheitert', async () => {
    let fehlschlag = false;
    stelleBereit();
    server.use(
      http.get('/api/admin/anbindungen', () =>
        fehlschlag
          ? HttpResponse.json({ error: 'kaputt' }, { status: 500 })
          : HttpResponse.json({
              zugaenge: [zugang('a')],
              gesperrt_grund: null,
              instanz_fingerabdruck: 'ABCD',
            }),
      ),
    );
    const { client } = renderSeiten();
    await screen.findByText('Adapter a');
    fehlschlag = true;
    await client.refetchQueries();
    expect(await screen.findByText(/Stand nicht aktuell/)).toBeInTheDocument();
    expect(screen.getByText('Adapter a')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Anbindung anlegen/ })).toBeEnabled();
  });

  it('ohne Liste kein Anlegen, dafür „Erneut abrufen“', async () => {
    server.use(
      http.get('/api/admin/anbindungen', () =>
        HttpResponse.json({ error: 'kaputt' }, { status: 500 }),
      ),
    );
    renderSeiten();
    expect(await screen.findByText('Anbindungen nicht ladbar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Anbindung anlegen/ })).toBeDisabled();
  });

  it('lässt ohne System-Admin nur lesen', async () => {
    vi.mocked(useAuth).mockReturnValue(authWertFixture(benutzerFixture()));
    stelleBereit();
    renderSeiten();
    await screen.findByText('Adapter a');
    expect(screen.queryByRole('button', { name: /Anbindung anlegen/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Aktionen zu/ })).not.toBeInTheDocument();
  });

  it('sperrt am gekoppelten ELW das Anlegen und nennt den Hub', async () => {
    stelleBereit([], 'Diese Instanz meldet sich für die Organisation bei Hub Kreis.');
    renderSeiten();
    expect(
      await screen.findByText(/meldet sich für die Organisation bei Hub Kreis/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Anbindung anlegen/ })).toBeDisabled();
  });
});

describe('Anbindung · Ansicht (LLH-1652)', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue(authWertFixture(adminFixture()));
  });

  it('bearbeitet im Paneel und sendet nur Geändertes mit dem Stand beim Öffnen', async () => {
    const aufrufe = stelleBereit([zugang('a', { scopes: ['lage:read'] })]);
    const user = userEvent.setup();
    renderSeiten('/admin/einstellungen/anbindungen/a');
    await user.click(await screen.findByRole('button', { name: 'Zugang bearbeiten' }));
    expect(screen.getByRole('checkbox', { name: /Lage lesen/ })).toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: /Ereignisse abrufen/ }));
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(aufrufe).toEqual([
        {
          pfad: 'aendern',
          body: {
            scopes: ['lage:read', 'events:read'],
            basis_geaendert_at: '2026-11-12 09:00:00',
          },
        },
      ]),
    );
  });

  it('ohne Änderung kein Aufruf', async () => {
    const aufrufe = stelleBereit();
    const user = userEvent.setup();
    renderSeiten('/admin/einstellungen/anbindungen/a');
    await user.click(await screen.findByRole('button', { name: 'Zugang bearbeiten' }));
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Zugang bearbeiten' })).toBeInTheDocument(),
    );
    expect(aufrufe).toEqual([]);
  });

  it('fragt bei 409 „Zwischenzeitlich geändert“; übernehmen sendet ohne Basis', async () => {
    const aufrufe = stelleBereit();
    konflikt.offen = true;
    const user = userEvent.setup();
    renderSeiten('/admin/einstellungen/anbindungen/a');
    await user.click(await screen.findByRole('button', { name: 'Zugang bearbeiten' }));
    const name = screen.getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'Adapter neu');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await user.click(await screen.findByRole('button', { name: 'Meine Änderung übernehmen' }));
    await waitFor(() => expect(aufrufe).toHaveLength(2));
    expect(aufrufe[0].body).toEqual({
      name: 'Adapter neu',
      basis_geaendert_at: '2026-11-12 09:00:00',
    });
    expect(aufrufe[1].body).toEqual({ name: 'Adapter neu' });
  });

  it('widerrufen: kein Bearbeiten, keine Kopfaktionen, Name des Widerrufenden', async () => {
    stelleBereit([
      zugang('a', {
        zustand: 'widerrufen',
        fingerabdruck: null,
        widerrufen_at: '2026-11-12 10:00:00',
        widerrufen_von_name: 'Ruth Admin',
      }),
    ]);
    renderSeiten('/admin/einstellungen/anbindungen/a');
    expect(await screen.findByText(/von Ruth Admin/)).toBeInTheDocument();
    expect(screen.getByText('ohne Schlüssel')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Neuer Code/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Widerrufen/ })).not.toBeInTheDocument();
  });

  it('der Widerruf-Dialog bleibt offen, solange der Widerruf läuft', async () => {
    stelleBereit();
    let loslassen: () => void = () => {};
    const widerrufenerZugang = zugang('a', {
      zustand: 'widerrufen',
      fingerabdruck: null,
      widerrufen_at: '2026-11-12 10:00:00',
    });
    let fertigWiderrufen = false;
    server.use(
      http.get('/api/admin/anbindungen', () =>
        HttpResponse.json({
          zugaenge: [fertigWiderrufen ? widerrufenerZugang : zugang('a')],
          gesperrt_grund: null,
          instanz_fingerabdruck: 'ABCD',
        }),
      ),
      http.post(
        '/api/admin/anbindungen/a/widerrufen',
        () =>
          new Promise<Response>((fertig) => {
            loslassen = () => {
              fertigWiderrufen = true;
              fertig(
                HttpResponse.json(
                  zugang('a', {
                    zustand: 'widerrufen',
                    fingerabdruck: null,
                    widerrufen_at: '2026-11-12 10:00:00',
                  }),
                ),
              );
            };
          }),
      ),
    );
    const user = userEvent.setup();
    renderSeiten('/admin/einstellungen/anbindungen/a');
    await user.click(await screen.findByRole('button', { name: /Widerrufen/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Adapter a widerrufen?' });
    await user.click(within(dialog).getByRole('button', { name: 'Widerrufen' }));
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toBeDisabled(),
    );
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Adapter a widerrufen?' })).toBeInTheDocument();
    loslassen();
    expect(await screen.findByText('ohne Schlüssel')).toBeInTheDocument();
  });

  it('eine unbekannte Kennung führt zurück zur Liste', async () => {
    stelleBereit();
    renderSeiten('/admin/einstellungen/anbindungen/gibt-es-nicht');
    expect(await screen.findByText('Anbindung nicht gefunden')).toBeInTheDocument();
  });

  it('Patch: Rechte als Menge, Frist leeren', () => {
    const vorher = {
      name: 'A',
      scopes: ['lage:read', 'events:read'] as const,
      gueltig_bis: alsZeitpunkt('2026-12-01 10:00:00') ?? null,
    };
    expect(
      zugangPatch(
        { ...vorher, scopes: [...vorher.scopes] },
        { ...vorher, name: ' A ', scopes: ['events:read', 'lage:read'] },
      ),
    ).toEqual({});
    expect(
      zugangPatch(
        { ...vorher, scopes: [...vorher.scopes] },
        { ...vorher, scopes: ['events:read'], gueltig_bis: null },
      ),
    ).toEqual({ scopes: ['events:read'], gueltig_bis: null });
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
