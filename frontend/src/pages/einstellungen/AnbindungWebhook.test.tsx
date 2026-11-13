import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../../test/server';
import { renderMitProviders, setzeOnline } from '../../test/utils';
import { offenesMenue } from '../../test/menue';
import Anbindungen from './Anbindungen';
import AnbindungAnsicht from './AnbindungAnsicht';
import { LAN_WARNUNG, versuchText, webhookPatch } from './AnbindungWebhook';
import { webhookZustandAnzeige } from './anbindungAnzeige';
import { artGesperrtGrund, webhookFehlerText } from '../../api/anbindungen';

vi.mock('../../auth/AuthContext', () => ({
  useAuth: vi.fn(),
  AuthProvider: ({ children }: { children?: unknown }) => children,
}));

import { useAuth } from '../../auth/AuthContext';
import { adminFixture, authWertFixture, benutzerFixture } from '../../test/fixtures';

/** Webhook einer Anbindung (LLH-1656, Spec `webhook-zustellung`). */

const webhook = (extra: Record<string, unknown> = {}) => ({
  id: 'wh-1',
  url: 'https://empfaenger.example/hook',
  host: 'empfaenger.example',
  arten: ['einsatz.created', 'einsatz.closed'],
  lan_erlaubt: false,
  zustand: 'aktiv',
  fehlversuche: 0,
  angelegt_at: '2026-11-13 09:00:00',
  geaendert_at: '2026-11-13 09:00:00',
  ...extra,
});

const zugang = (extra: Record<string, unknown> = {}) => ({
  id: 'a',
  name: 'Einsatzbuch',
  scopes: ['events:read', 'einsaetze:read'],
  gueltig_bis: null,
  zustand: 'aktiv',
  is_abgelaufen: false,
  fingerabdruck: 'CPV0-CWYP',
  fingerabdruck_neu: null,
  angelegt_at: '2026-11-12 09:00:00',
  geaendert_at: '2026-11-12 09:00:00',
  widerrufen_at: null,
  widerrufen_von_name: null,
  zuletzt_genutzt_at: null,
  letzte_ablehnung: null,
  einsatz_freigebbar: false,
  ...extra,
});

function stelleBereit(z: Record<string, unknown>, versuche: unknown[] = []) {
  const aufrufe: { pfad: string; body: unknown }[] = [];
  server.use(
    http.get('/api/admin/anbindungen', () =>
      HttpResponse.json({ zugaenge: [z], gesperrt_grund: null, instanz_fingerabdruck: 'ABCD' }),
    ),
    http.get('/api/admin/einwurf-zugaenge', () =>
      HttpResponse.json({ zugaenge: [], gesperrt_grund: null, transport: 'tls' }),
    ),
    http.get('/api/admin/anbindungen/a/webhook/versuche', () => HttpResponse.json(versuche)),
    http.post('/api/admin/anbindungen/a/webhook', async ({ request }) => {
      const body = await request.json();
      aufrufe.push({ pfad: 'einrichten', body });
      return HttpResponse.json(webhook(body as Record<string, unknown>), { status: 201 });
    }),
    http.patch('/api/admin/anbindungen/a/webhook', async ({ request }) => {
      const body = await request.json();
      aufrufe.push({ pfad: 'aendern', body });
      return HttpResponse.json(webhook());
    }),
    http.post('/api/admin/anbindungen/a/webhook/wieder-aufnehmen', () => {
      aufrufe.push({ pfad: 'weiter', body: null });
      return HttpResponse.json(webhook());
    }),
    http.post('/api/admin/anbindungen/a/webhook/test', () => {
      aufrufe.push({ pfad: 'test', body: null });
      return HttpResponse.json({ erfolg: false, status: 503, fehler_art: 'status', dauer_ms: 41 });
    }),
  );
  return aufrufe;
}

function renderAnsicht() {
  return renderMitProviders(
    <Routes>
      <Route path="/admin/einstellungen/anbindungen/:zugangId" element={<AnbindungAnsicht />} />
    </Routes>,
    { route: '/admin/einstellungen/anbindungen/a', datenRouter: true },
  );
}

describe('Webhook einer Anbindung (LLH-1656)', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue(authWertFixture(adminFixture()));
  });

  it('richtet ein: nur geöffnete Arten wählbar, LAN-Ausnahme mit Warnung', async () => {
    const aufrufe = stelleBereit(zugang());
    const user = userEvent.setup();
    renderAnsicht();
    expect(await screen.findByText(/Ein Webhook stellt die Ereignisse/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Webhook einrichten' }));
    const dialog = await screen.findByRole('dialog', { name: 'Webhook einrichten' });

    // Ohne „Lage lesen“ ist `lage.changed` ausgegraut und nennt den Grund.
    const lage = within(dialog).getByRole('checkbox', { name: /Lage geändert/ });
    expect(lage).toBeDisabled();
    expect(dialog.textContent).toContain('braucht „Lage lesen“');
    expect(dialog.textContent).toContain(LAN_WARNUNG);

    await user.type(
      within(dialog).getByRole('textbox', { name: 'Ziel-URL' }),
      'https://empfaenger.example/hook',
    );
    await user.click(within(dialog).getByRole('checkbox', { name: /Einsatz lesbar geworden/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Einrichten' }));
    await waitFor(() => expect(dialog.querySelector('.ant-form-item-explain-error')).toBeNull());
    await waitFor(() =>
      expect(aufrufe).toEqual([
        {
          pfad: 'einrichten',
          body: {
            url: 'https://empfaenger.example/hook',
            arten: ['einsatz.created'],
            lan_erlaubt: false,
          },
        },
      ]),
    );
  });

  it('verlangt https und mindestens eine Art', async () => {
    const aufrufe = stelleBereit(zugang());
    const user = userEvent.setup();
    renderAnsicht();
    await user.click(await screen.findByRole('button', { name: 'Webhook einrichten' }));
    const dialog = await screen.findByRole('dialog', { name: 'Webhook einrichten' });
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Ziel-URL' }),
      'http://empfaenger.example/',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Einrichten' }));
    expect(await within(dialog).findByText(/muss mit https:\/\/ beginnen/)).toBeInTheDocument();
    expect(within(dialog).getByText('Mindestens eine Art wählen')).toBeInTheDocument();
    expect(aufrufe).toEqual([]);
  });

  it('angehalten: Chip, letzter Fehler, Verlauf und „Wieder aufnehmen“', async () => {
    const aufrufe = stelleBereit(
      zugang({
        webhook: webhook({
          zustand: 'angehalten',
          angehalten_at: '2026-11-13 10:00:00',
          fehler_seit: '2026-11-12 10:00:00',
          fehlversuche: 14,
          letzter_fehler: { at: '2026-11-13 10:00:00', art: 'status', status: 503 },
        }),
      }),
      [
        {
          at: '2026-11-13 10:00:00',
          ereignis_id: 4712,
          test: false,
          erfolg: false,
          status: 503,
          fehler_art: 'status',
          dauer_ms: 87,
        },
        {
          at: '2026-11-12 09:00:00',
          ereignis_id: 4711,
          test: false,
          erfolg: true,
          status: 204,
          dauer_ms: 12,
        },
      ],
    );
    const user = userEvent.setup();
    renderAnsicht();
    expect(await screen.findByText('Webhook angehalten')).toBeInTheDocument();
    expect(document.querySelector('[data-lfh="webhook-fehler"]')!.textContent).toMatch(
      /^Ziel antwortete mit Fehler \(503\) · /,
    );
    await waitFor(() =>
      expect(document.querySelectorAll('[data-lfh="webhook-versuch"]')).toHaveLength(2),
    );
    const zeilen = [...document.querySelectorAll('[data-lfh="webhook-versuch"]')].map(
      (z) => z.textContent,
    );
    expect(zeilen[0]).toContain('#4712');
    expect(zeilen[0]).toContain('Ziel antwortete mit Fehler (503)');
    expect(zeilen[1]).toContain('zugestellt (204)');

    await user.click(screen.getByRole('button', { name: 'Wieder aufnehmen' }));
    await waitFor(() => expect(aufrufe).toEqual([{ pfad: 'weiter', body: null }]));
  });

  it('Testereignis zeigt das Ergebnis sofort', async () => {
    stelleBereit(zugang({ webhook: webhook() }));
    const user = userEvent.setup();
    renderAnsicht();
    await user.click(await screen.findByRole('button', { name: 'Testereignis senden' }));
    expect(
      (await screen.findByText(/^Testereignis:/)).closest('[data-lfh="webhook-test"]')!.textContent,
    ).toBe('Testereignis: Ziel antwortete mit Fehler (503) · 41 ms');
    // Kein „Wieder aufnehmen“, solange er nicht angehalten ist.
    expect(screen.queryByRole('button', { name: 'Wieder aufnehmen' })).not.toBeInTheDocument();
  });

  it('nennt einen Verlust mit Hinweis auf die Leserouten', async () => {
    stelleBereit(zugang({ webhook: webhook({ verlust_at: '2026-11-13 11:00:00' }) }));
    renderAnsicht();
    const hinweis = await screen.findByText(/Ereignisse verloren/);
    expect(hinweis.closest('[data-lfh="webhook-verlust"]')!.textContent).toMatch(/Leserouten/);
  });

  it('ruht mit Grund, wenn der Code noch nicht eingelöst ist', async () => {
    stelleBereit(
      zugang({
        zustand: 'wartet',
        webhook: webhook({ zustand: 'ruht', ruht_grund: 'zugang_wartet' }),
      }),
    );
    renderAnsicht();
    expect(await screen.findByText('Webhook ruht')).toBeInTheDocument();
    expect(document.querySelector('[data-lfh="webhook-zustand"]')!.textContent).toBe(
      'ruht: Code noch nicht eingelöst',
    );
  });

  it('ohne System-Admin: lesen ja, keine Bedienknöpfe', async () => {
    vi.mocked(useAuth).mockReturnValue(authWertFixture(benutzerFixture()));
    stelleBereit(zugang({ webhook: webhook({ zustand: 'angehalten' }) }));
    renderAnsicht();
    expect(await screen.findByText('Webhook angehalten')).toBeInTheDocument();
    for (const name of ['Wieder aufnehmen', 'Testereignis senden', 'Webhook entfernen …']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('die Liste zeigt einen angehaltenen Webhook im Ton „achtung“', async () => {
    stelleBereit(zugang({ webhook: webhook({ zustand: 'angehalten' }) }));
    renderMitProviders(<Anbindungen />, {
      route: '/admin/einstellungen/anbindungen',
      datenRouter: true,
    });
    await screen.findByText('Einsatzbuch');
    const chip = document.querySelector('[data-lfh="anbindung-webhook"] [data-lfh="status-chip"]')!;
    expect(chip.textContent).toContain('Webhook angehalten');
    expect(chip.getAttribute('data-ton')).toBe('achtung');
  });

  it('die Liste schweigt bei einem Webhook, der zustellt', async () => {
    stelleBereit(zugang({ webhook: webhook() }));
    renderMitProviders(<Anbindungen />, {
      route: '/admin/einstellungen/anbindungen',
      datenRouter: true,
    });
    await screen.findByText('Einsatzbuch');
    expect(document.querySelector('[data-lfh="anbindung-webhook"]')).toBeNull();
  });
});

describe('Webhook · Befunde aus dem Review (LLH-1656)', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue(authWertFixture(adminFixture()));
  });
  afterEach(() => setzeOnline(true));

  it('ohne Admin-Rolle steht der Host statt der URL', async () => {
    vi.mocked(useAuth).mockReturnValue(authWertFixture(benutzerFixture()));
    stelleBereit(zugang({ webhook: { ...webhook(), url: undefined } }));
    renderAnsicht();
    expect(await screen.findByText('empfaenger.example')).toBeInTheDocument();
    expect(document.querySelector('[data-lfh="webhook-url"]')!.textContent).toBe(
      'empfaenger.example',
    );
  });

  it('bündelt die übrigen Aktionen im Menü, Entfernen als Gefahr', async () => {
    stelleBereit(zugang({ webhook: webhook({ zustand: 'angehalten' }) }));
    const user = userEvent.setup();
    renderAnsicht();
    await screen.findByRole('button', { name: 'Wieder aufnehmen' });
    expect(screen.queryByRole('button', { name: 'Testereignis senden' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Weitere Aktionen zum Webhook/ }));
    const menue = await waitFor(() => offenesMenue());
    expect(
      within(menue).getByRole('menuitem', { name: 'Testereignis senden' }),
    ).toBeInTheDocument();
    const entfernen = within(menue).getByRole('menuitem', { name: 'Webhook entfernen …' });
    expect(entfernen.className).toMatch(/danger/);
  });

  it('ohne Netz: Aktionen gesperrt mit Grund', async () => {
    stelleBereit(zugang({ webhook: webhook() }));
    renderAnsicht();
    const knopf = await screen.findByRole('button', { name: 'Testereignis senden' });
    setzeOnline(false);
    await waitFor(() => expect(knopf).toBeDisabled());
    expect(screen.getAllByText(/Ohne Verbindung nicht änderbar/).length).toBeGreaterThan(0);
  });

  it('Verlauf: beim Laden „wird geladen“, nie „Noch kein Zustellversuch“', async () => {
    stelleBereit(zugang({ webhook: webhook() }));
    let antworten: () => void = () => {};
    server.use(
      http.get(
        '/api/admin/anbindungen/a/webhook/versuche',
        () =>
          new Promise<Response>((fertig) => {
            antworten = () => fertig(HttpResponse.json([]));
          }),
      ),
    );
    renderAnsicht();
    expect(
      (await screen.findByText('Verlauf wird geladen …')).closest(
        '[data-lfh="webhook-verlauf-laedt"]',
      ),
    ).not.toBeNull();
    expect(screen.queryByText('Noch kein Zustellversuch.')).not.toBeInTheDocument();
    antworten();
    expect(await screen.findByText('Noch kein Zustellversuch.')).toBeInTheDocument();
  });

  it('Verlauf: ein Fehler sagt, dass er nicht ladbar ist', async () => {
    stelleBereit(zugang({ webhook: webhook() }));
    server.use(
      http.get('/api/admin/anbindungen/a/webhook/versuche', () =>
        HttpResponse.json({ error: 'kaputt' }, { status: 500 }),
      ),
    );
    renderAnsicht();
    expect(await screen.findByText('Verlauf nicht ladbar')).toBeInTheDocument();
    expect(screen.queryByText('Noch kein Zustellversuch.')).not.toBeInTheDocument();
  });

  it('ein Testergebnis verschwindet, sobald das Ziel ein anderes ist', async () => {
    const aufrufe = stelleBereit(zugang({ webhook: webhook() }));
    // Der Server kennt nach dem PATCH das neue Ziel, auch beim Neuabruf der Liste.
    let stand = webhook();
    server.use(
      http.get('/api/admin/anbindungen', () =>
        HttpResponse.json({
          zugaenge: [zugang({ webhook: stand })],
          gesperrt_grund: null,
          instanz_fingerabdruck: 'ABCD',
        }),
      ),
      http.patch('/api/admin/anbindungen/a/webhook', async ({ request }) => {
        aufrufe.push({ pfad: 'aendern', body: await request.json() });
        stand = webhook({
          url: 'https://neu.example/',
          host: 'neu.example',
          geaendert_at: '2026-11-13 10:00:00',
        });
        return HttpResponse.json(stand);
      }),
    );
    const user = userEvent.setup();
    renderAnsicht();
    await user.click(await screen.findByRole('button', { name: 'Testereignis senden' }));
    await screen.findByText(/^Testereignis:/);

    await user.click(screen.getByRole('button', { name: 'Webhook bearbeiten' }));
    const feld = screen.getByRole('textbox', { name: 'Ziel-URL' });
    await user.clear(feld);
    await user.type(feld, 'https://neu.example/');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(aufrufe).toContainEqual({
        pfad: 'aendern',
        body: { url: 'https://neu.example/', basis_geaendert_at: '2026-11-13 09:00:00' },
      }),
    );
    // Die Antwort steht sofort, und das alte Testergebnis gilt nicht mehr.
    expect(await screen.findByText('https://neu.example/')).toBeInTheDocument();
    expect(screen.queryByText(/^Testereignis:/)).not.toBeInTheDocument();
  });
});

describe('Webhook · Wortlaut (LLH-1656)', () => {
  it('Zustand als Wort und Ton', () => {
    expect(webhookZustandAnzeige({ zustand: 'aktiv' })).toEqual({
      wort: 'Webhook stellt zu',
      ton: 'normal',
    });
    expect(webhookZustandAnzeige({ zustand: 'fehler' }).ton).toBe('bedien');
    expect(webhookZustandAnzeige({ zustand: 'angehalten' }).ton).toBe('achtung');
    expect(webhookZustandAnzeige({ zustand: 'ruht' }).ton).toBe('neutral');
  });

  it('Arten nach den Rechten des Zugangs', () => {
    expect(artGesperrtGrund('einsatz.created', ['events:read', 'einsaetze:read'])).toBeNull();
    expect(artGesperrtGrund('lage.changed', ['events:read', 'einsaetze:read'])).toBe(
      'braucht „Lage lesen“',
    );
    expect(artGesperrtGrund('einsatz.created', ['einsaetze:read'])).toBe(
      'braucht „Ereignisse abrufen“',
    );
  });

  it('Fehler und Versuch in Klartext', () => {
    expect(webhookFehlerText('tls')).toBe('Zertifikat des Ziels nicht anerkannt');
    expect(webhookFehlerText('status', 404)).toBe('Ziel antwortete mit Fehler (404)');
    expect(versuchText({ erfolg: true, status: 200 })).toBe('zugestellt (200)');
    expect(versuchText({ erfolg: false, fehler_art: 'dns' })).toBe(
      'Name des Ziels nicht auflösbar',
    );
  });

  it('Patch: nur Geändertes, Arten als Menge', () => {
    const vorher = {
      url: 'https://a.example/',
      arten: ['einsatz.created', 'einsatz.closed'] as const,
      lan_erlaubt: false,
    };
    expect(
      webhookPatch(
        { ...vorher, arten: [...vorher.arten] },
        { ...vorher, arten: ['einsatz.closed', 'einsatz.created'] },
      ),
    ).toEqual({});
    expect(
      webhookPatch(
        { ...vorher, arten: [...vorher.arten] },
        { url: ' https://b.example/ ', arten: ['einsatz.closed'], lan_erlaubt: true },
      ),
    ).toEqual({ url: 'https://b.example/', arten: ['einsatz.closed'], lan_erlaubt: true });
  });
});
