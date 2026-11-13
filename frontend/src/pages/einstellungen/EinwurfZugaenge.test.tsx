import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider } from 'antd';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../test/server';
import { renderMitProviders, setzeOnline } from '../../test/utils';
import { waehleMenueEintrag } from '../../test/menue';
import EinwurfZugaenge, {
  adresseBrauchtHttps,
  einwurfZustand,
  transportHinweis,
} from './EinwurfZugaenge';
import { einwurfAdresse } from '../../api/einwurfZugaenge';

vi.mock('../../auth/AuthContext', () => ({
  useAuth: vi.fn(),
  AuthProvider: ({ children }: { children?: unknown }) => children,
}));

import { useAuth } from '../../auth/AuthContext';
import { adminFixture, authWertFixture, benutzerFixture } from '../../test/fixtures';

/** Einwurf-Zugänge für Absender ohne Signatur (LLH-1654, Spec `einwurf-zugang`). */

const SCHLUESSEL = 'llh_ew_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const SCHLUESSEL_NEU = 'llh_ew_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

const zugang = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `BOSWatch ${id}`,
  scope: 'alarmmeldungen:write',
  gueltig_bis: null,
  is_abgelaufen: false,
  angelegt_at: '2026-11-12 09:00:00',
  schluessel_gewechselt_at: null,
  widerrufen_at: null,
  widerrufen_von_name: null,
  zuletzt_genutzt_at: null,
  ...extra,
});

interface Lage {
  zugaenge?: unknown[];
  gesperrt?: string | null;
  transport?: string;
}

function stelleBereit({ zugaenge = [zugang('a')], gesperrt = null, transport = 'tls' }: Lage = {}) {
  const aufrufe: { pfad: string; body: unknown }[] = [];
  let stand = [...zugaenge] as { id: string }[];
  const merke = <Z extends { id: string }>(z: Z): Z => {
    stand = stand.some((x) => x.id === z.id)
      ? stand.map((x) => (x.id === z.id ? z : x))
      : [z, ...stand];
    return z;
  };
  server.use(
    http.get('/api/admin/einwurf-zugaenge', () =>
      HttpResponse.json({ zugaenge: stand, gesperrt_grund: gesperrt, transport }),
    ),
    http.post('/api/admin/einwurf-zugaenge', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      aufrufe.push({ pfad: 'anlegen', body });
      return HttpResponse.json(
        {
          zugang: merke(zugang('neu', { name: body.name, scope: body.scope })),
          schluessel: SCHLUESSEL,
        },
        { status: 201 },
      );
    }),
    http.post('/api/admin/einwurf-zugaenge/a/schluessel', () => {
      aufrufe.push({ pfad: 'wechseln', body: null });
      return HttpResponse.json({
        zugang: merke(zugang('a', { schluessel_gewechselt_at: '2026-11-12 10:00:00' })),
        schluessel: SCHLUESSEL_NEU,
      });
    }),
    http.post('/api/admin/einwurf-zugaenge/a/widerrufen', () => {
      aufrufe.push({ pfad: 'widerrufen', body: null });
      return HttpResponse.json(
        merke(
          zugang('a', {
            widerrufen_at: '2026-11-12 10:00:00',
            widerrufen_von_name: 'Administrator',
          }),
        ),
      );
    }),
  );
  return aufrufe;
}

/**
 * Ohne Bewegung: jsdom meldet kein Ende einer Ausblendung, antd nähme den Inhalt eines
 * geschlossenen Dialogs sonst nie aus dem Dokument (`destroyOnHidden`). So lässt sich prüfen,
 * dass der Schlüssel nach „Fertig“ wirklich weg ist.
 */
function renderOhneBewegung() {
  return renderMitProviders(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <EinwurfZugaenge />
    </ConfigProvider>,
  );
}

const menueKnopf = (name: string) =>
  screen.getByRole('button', { name: `Aktionen zu Einwurf-Zugang ${name}` });

describe('Einwurf-Zugänge (LLH-1654)', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue(authWertFixture(adminFixture()));
  });

  it('zeigt Name, Zweck mit Wire-Wert, Zustand und „zuletzt genutzt“', async () => {
    stelleBereit({
      zugaenge: [
        zugang('a', {
          zuletzt_genutzt_at: '2026-11-12 09:30:00',
          gueltig_bis: '2027-01-01 00:00:00',
        }),
        zugang('b', { scope: 'positionen:write' }),
        zugang('c', { widerrufen_at: '2026-11-12 10:00:00', widerrufen_von_name: 'Administrator' }),
      ],
    });
    renderMitProviders(<EinwurfZugaenge />);
    const zeilen = await screen.findAllByText(/BOSWatch/);
    expect(zeilen).toHaveLength(3);
    const zeile = (name: string) =>
      screen.getByText(name).closest<HTMLElement>('[data-lfh="einwurf-eintrag"]')!;
    expect(zeile('BOSWatch a').textContent).toMatch(
      /Alarmmeldungen einliefern\s*alarmmeldungen:write/,
    );
    expect(zeile('BOSWatch a').textContent).toMatch(/aktiv/);
    expect(zeile('BOSWatch a').textContent).toMatch(/zuletzt genutzt .*· gültig bis/);
    expect(zeile('BOSWatch b').textContent).toMatch(/Positionen einliefern/);
    expect(zeile('BOSWatch b').textContent).toMatch(/noch nie genutzt/);
    expect(zeile('BOSWatch c').textContent).toMatch(/widerrufen .* von Administrator/);
    // Ein widerrufener Zugang hat keine Aktionen mehr.
    expect(
      screen.queryByRole('button', { name: 'Aktionen zu Einwurf-Zugang BOSWatch c' }),
    ).not.toBeInTheDocument();
    // Kein Hinweis, solange Einwürfe über TLS ankommen.
    expect(document.querySelector('[data-lfh="einwurf-transport"]')).toBeNull();
  });

  it('legt an und zeigt die Adresse mit dem Unterpfad des Zwecks genau einmal', async () => {
    const aufrufe = stelleBereit({ zugaenge: [] });
    const user = userEvent.setup();
    renderOhneBewegung();
    await screen.findByText('Noch kein Einwurf-Zugang');
    await user.click(screen.getByRole('button', { name: /Einwurf-Zugang anlegen/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Einwurf-Zugang anlegen' });
    // Vorgabe ist der Zweck Alarmmeldungen; hier wird die Position gewählt.
    expect(within(dialog).getByRole('radio', { name: /Alarmmeldungen einliefern/ })).toBeChecked();
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'OsmAnd ELW');
    await user.click(within(dialog).getByRole('radio', { name: /Positionen einliefern/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen und Adresse zeigen' }));
    await waitFor(() =>
      expect(aufrufe).toEqual([
        {
          pfad: 'anlegen',
          body: { name: 'OsmAnd ELW', scope: 'positionen:write', gueltig_bis: null },
        },
      ]),
    );
    const adresse = `${window.location.origin}/api/v1/einwurf/${SCHLUESSEL}/position`;
    const box = (await screen.findByText(adresse)).closest<HTMLElement>(
      '[data-lfh="einwurf-adresse"]',
    )!;
    expect(box.textContent).toMatch(/Nur jetzt sichtbar\./);

    // Escape schließt den Dialog nicht: der Schlüssel ginge verloren, bevor er eingetragen ist.
    screen.getByRole('button', { name: 'Fertig' }).focus();
    await user.keyboard('{Escape}');
    await user.click(document.querySelector<HTMLElement>('.ant-modal-wrap')!);
    expect(screen.getByText(adresse)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Adresse für OsmAnd ELW' })).toBeVisible();
    const adressDialog = screen.getByRole('dialog', { name: 'Adresse für OsmAnd ELW' });
    expect(within(adressDialog).queryByRole('button', { name: /Close|Schließen/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Fertig' }));
    // Der Dialog ist zu (antd nimmt seinen Inhalt nach der Ausblendung aus dem Dokument,
    // `destroyOnHidden`); die Zeile steht da, und sie nennt den Schlüssel nicht.
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Adresse für OsmAnd ELW' }),
      ).not.toBeInTheDocument(),
    );
    const zeile = (await screen.findByText('OsmAnd ELW')).closest<HTMLElement>(
      '[data-lfh="einwurf-eintrag"]',
    )!;
    expect(zeile.textContent).not.toContain('llh_ew_');
    expect(document.body.textContent).not.toContain(SCHLUESSEL);
  });

  it('verlangt beim Anlegen einen Namen', async () => {
    const aufrufe = stelleBereit({ zugaenge: [] });
    const user = userEvent.setup();
    renderMitProviders(<EinwurfZugaenge />);
    await screen.findByText('Noch kein Einwurf-Zugang');
    await user.click(screen.getByRole('button', { name: /Einwurf-Zugang anlegen/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Einwurf-Zugang anlegen' });
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen und Adresse zeigen' }));
    expect(await within(dialog).findByText('Name angeben')).toBeInTheDocument();
    expect(aufrufe).toEqual([]);
  });

  it('lässt einen Speicherfehler im Dialog stehen', async () => {
    stelleBereit({ zugaenge: [] });
    server.use(
      http.post('/api/admin/einwurf-zugaenge', () =>
        HttpResponse.json({ error: 'name: höchstens 80 Zeichen' }, { status: 400 }),
      ),
    );
    const user = userEvent.setup();
    renderMitProviders(<EinwurfZugaenge />);
    await screen.findByText('Noch kein Einwurf-Zugang');
    await user.click(screen.getByRole('button', { name: /Einwurf-Zugang anlegen/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Einwurf-Zugang anlegen' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'x');
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen und Adresse zeigen' }));
    expect(await within(dialog).findByText('Nicht angelegt')).toBeInTheDocument();
    expect(within(dialog).getByText(/höchstens 80 Zeichen/)).toBeInTheDocument();
    expect(screen.queryByText(/Nur jetzt sichtbar/)).not.toBeInTheDocument();
  });

  it('wechselt den Schlüssel erst nach Rückfrage und zeigt die neue Adresse einmal', async () => {
    const aufrufe = stelleBereit();
    const user = userEvent.setup();
    renderOhneBewegung();
    await screen.findByText('BOSWatch a');
    await waehleMenueEintrag(menueKnopf('BOSWatch a'), /Schlüssel wechseln/);
    const dialog = await screen.findByRole('dialog', {
      name: 'Schlüssel von BOSWatch a wechseln?',
    });
    expect(dialog.textContent).toMatch(/gilt ab sofort nicht mehr/);
    expect(aufrufe).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Schlüssel wechseln' }));
    await waitFor(() => expect(aufrufe).toEqual([{ pfad: 'wechseln', body: null }]));
    const adresse = `${window.location.origin}/api/v1/einwurf/${SCHLUESSEL_NEU}/alarmmeldung`;
    expect(await screen.findByText(adresse)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fertig' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Adresse für BOSWatch a' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('widerruft erst nach Rückfrage', async () => {
    const aufrufe = stelleBereit();
    const user = userEvent.setup();
    renderMitProviders(<EinwurfZugaenge />);
    await screen.findByText('BOSWatch a');
    await waehleMenueEintrag(menueKnopf('BOSWatch a'), /Widerrufen/);
    const dialog = await screen.findByRole('dialog', { name: 'BOSWatch a widerrufen?' });
    expect(aufrufe).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Widerrufen' }));
    await waitFor(() => expect(aufrufe).toEqual([{ pfad: 'widerrufen', body: null }]));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Aktionen zu Einwurf-Zugang BOSWatch a' }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText('BOSWatch a')).toBeInTheDocument();
  });

  it('lässt einen gescheiterten Widerruf in der Rückfrage stehen', async () => {
    stelleBereit();
    server.use(
      http.post('/api/admin/einwurf-zugaenge/a/widerrufen', () =>
        HttpResponse.json({ error: 'Datenbank beschäftigt' }, { status: 503 }),
      ),
    );
    const user = userEvent.setup();
    renderMitProviders(<EinwurfZugaenge />);
    await screen.findByText('BOSWatch a');
    await waehleMenueEintrag(menueKnopf('BOSWatch a'), /Widerrufen/);
    const dialog = await screen.findByRole('dialog', { name: 'BOSWatch a widerrufen?' });
    await user.click(within(dialog).getByRole('button', { name: 'Widerrufen' }));
    expect(await within(dialog).findByText('Nicht widerrufen')).toBeInTheDocument();
    expect(menueKnopf('BOSWatch a')).toBeInTheDocument();
  });

  it('lässt ohne System-Admin nur lesen', async () => {
    vi.mocked(useAuth).mockReturnValue(authWertFixture(benutzerFixture()));
    stelleBereit();
    renderMitProviders(<EinwurfZugaenge />);
    await screen.findByText('BOSWatch a');
    expect(
      screen.queryByRole('button', { name: /Einwurf-Zugang anlegen/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Aktionen zu/ })).not.toBeInTheDocument();
  });

  it('sperrt am gekoppelten ELW Anlegen und Wechsel, der Widerruf bleibt', async () => {
    stelleBereit({ gesperrt: 'Diese Instanz meldet sich für die Organisation bei Hub Kreis.' });
    const user = userEvent.setup();
    renderMitProviders(<EinwurfZugaenge />);
    await screen.findByText('BOSWatch a');
    // Das Paneel nennt den Grund selbst, auch wenn die Nachbarliste nicht geladen ist.
    const grund = document.querySelector<HTMLElement>('[data-lfh="einwurf-gesperrt"]')!;
    expect(grund.textContent).toMatch(/meldet sich für die Organisation bei Hub Kreis/);
    const knopf = screen.getByRole('button', { name: /Einwurf-Zugang anlegen/ });
    expect(knopf).toBeDisabled();
    expect(knopf).toHaveAttribute('aria-describedby', 'einwurf-gesperrt');
    await user.click(menueKnopf('BOSWatch a'));
    expect(await screen.findByRole('menuitem', { name: /Widerrufen/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Schlüssel wechseln/ })).not.toBeInTheDocument();
  });

  it.each([
    ['http', /Einwürfe ohne TLS erlaubt/],
    ['keiner', /Einwürfe werden abgelehnt/],
  ])('warnt bei der Transportlage %s', async (transport, titel) => {
    stelleBereit({ transport });
    renderMitProviders(<EinwurfZugaenge />);
    expect(await screen.findByText(titel)).toBeInTheDocument();
  });

  it('bietet für einen abgelaufenen Zugang keinen Schlüsselwechsel an', async () => {
    stelleBereit({
      zugaenge: [zugang('a', { is_abgelaufen: true, gueltig_bis: '2026-01-01 00:00:00' })],
    });
    const user = userEvent.setup();
    renderMitProviders(<EinwurfZugaenge />);
    await screen.findByText('BOSWatch a');
    await user.click(menueKnopf('BOSWatch a'));
    expect(await screen.findByRole('menuitem', { name: /Widerrufen/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Schlüssel wechseln/ })).not.toBeInTheDocument();
  });

  it('zeigt Frist und Widerruf mit Monat und Jahr', async () => {
    stelleBereit({
      zugaenge: [
        zugang('a', { gueltig_bis: '2027-01-01 00:00:00' }),
        zugang('b', { gueltig_bis: '2027-03-01 00:00:00' }),
        zugang('c', { widerrufen_at: '2026-11-12 09:00:00', widerrufen_von_name: 'Administrator' }),
      ],
    });
    renderMitProviders(<EinwurfZugaenge />);
    await screen.findByText('BOSWatch a');
    const frist = (name: string) =>
      /gültig bis (\S+)/.exec(
        screen.getByText(name).closest<HTMLElement>('[data-lfh="einwurf-eintrag"]')!.textContent,
      )![1];
    expect(frist('BOSWatch a')).toMatch(/27/);
    expect(frist('BOSWatch a')).not.toBe(frist('BOSWatch b'));
    const widerruf = /widerrufen (\S+) von Administrator/.exec(
      screen.getByText('BOSWatch c').closest<HTMLElement>('[data-lfh="einwurf-eintrag"]')!
        .textContent,
    )![1];
    expect(widerruf).toMatch(/nov26$/);
  });

  it('behält die Zahl im Kopf, wenn das Neuladen scheitert', async () => {
    let fehlschlag = false;
    stelleBereit();
    server.use(
      http.get('/api/admin/einwurf-zugaenge', () =>
        fehlschlag
          ? HttpResponse.json({ error: 'kaputt' }, { status: 500 })
          : HttpResponse.json({ zugaenge: [zugang('a')], gesperrt_grund: null, transport: 'tls' }),
      ),
    );
    const { client } = renderMitProviders(<EinwurfZugaenge />);
    await screen.findByText('BOSWatch a');
    const kopf = () => document.querySelector<HTMLElement>('[data-lfh="einwurf-zugaenge"]')!;
    expect(kopf().textContent).toMatch(/Einwurf-Zugänge\s*1/);
    fehlschlag = true;
    await client.refetchQueries();
    expect(await screen.findByText(/Stand nicht aktuell/)).toBeInTheDocument();
    expect(kopf().textContent).toMatch(/Einwurf-Zugänge\s*1/);
  });

  describe('ohne Verbindung', () => {
    afterEach(() => setzeOnline(true));

    it('sperrt Anlegen und die Aktionen der Zeile mit Grund', async () => {
      stelleBereit();
      const user = userEvent.setup();
      renderMitProviders(<EinwurfZugaenge />);
      await screen.findByText('BOSWatch a');
      setzeOnline(false);
      const knopf = await screen.findByRole('button', { name: /Einwurf-Zugang anlegen/ });
      await waitFor(() => expect(knopf).toBeDisabled());
      expect(knopf).toHaveAttribute('aria-describedby', 'einwurf-ohne-netz');
      expect(document.getElementById('einwurf-ohne-netz')?.textContent).toMatch(
        /Ohne Verbindung nicht änderbar/,
      );
      await user.click(menueKnopf('BOSWatch a'));
      const wechsel = await screen.findByRole('menuitem', { name: /Schlüssel wechseln/ });
      expect(wechsel).toHaveAttribute('aria-disabled', 'true');
      expect(screen.getByRole('menuitem', { name: /Widerrufen/ })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
    });

    it('lässt eine offene Rückfrage sofort scheitern, statt sie vorzumerken', async () => {
      stelleBereit();
      const user = userEvent.setup();
      renderMitProviders(<EinwurfZugaenge />);
      await screen.findByText('BOSWatch a');
      await waehleMenueEintrag(menueKnopf('BOSWatch a'), /Schlüssel wechseln/);
      const dialog = await screen.findByRole('dialog', {
        name: 'Schlüssel von BOSWatch a wechseln?',
      });
      // Das Netz fällt weg, während die Rückfrage offen ist.
      setzeOnline(false);
      let versuche = 0;
      server.use(
        http.post('/api/admin/einwurf-zugaenge/a/schluessel', () => {
          versuche += 1;
          return HttpResponse.error();
        }),
      );
      await user.click(within(dialog).getByRole('button', { name: 'Schlüssel wechseln' }));
      // Sofort versucht und gescheitert, nicht angehalten: Abbrechen geht.
      expect(await within(dialog).findByText('Schlüssel nicht gewechselt')).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toBeEnabled();
      expect(versuche).toBe(1);
      // Nicht vorgemerkt: Kehrt das Netz zurück, geht nichts von selbst hinaus.
      setzeOnline(true);
      await new Promise((fertig) => setTimeout(fertig, 100));
      expect(versuche).toBe(1);
    });

    it('sagt ohne Cache, dass nichts geladen ist, statt endlos zu laden', async () => {
      setzeOnline(false);
      stelleBereit();
      renderMitProviders(<EinwurfZugaenge />);
      expect(
        await screen.findByText('Einwurf-Zugänge ohne Verbindung nicht geladen'),
      ).toBeInTheDocument();
    });
  });

  it('ohne Liste kein Anlegen, dafür „Erneut abrufen“', async () => {
    server.use(
      http.get('/api/admin/einwurf-zugaenge', () =>
        HttpResponse.json({ error: 'kaputt' }, { status: 500 }),
      ),
    );
    renderMitProviders(<EinwurfZugaenge />);
    expect(await screen.findByText('Einwurf-Zugänge nicht ladbar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Einwurf-Zugang anlegen/ })).toBeDisabled();
  });
});

describe('Einwurf-Zugänge · Wortlaut und Adresse', () => {
  it('Zustand: widerrufen vor abgelaufen vor aktiv', () => {
    expect(einwurfZustand({ widerrufen_at: null, is_abgelaufen: false })).toEqual({
      wort: 'aktiv',
      ton: 'normal',
    });
    expect(einwurfZustand({ widerrufen_at: null, is_abgelaufen: true })).toEqual({
      wort: 'abgelaufen',
      ton: 'achtung',
    });
    expect(einwurfZustand({ widerrufen_at: '2026-11-12 10:00:00', is_abgelaufen: true })).toEqual({
      wort: 'widerrufen',
      ton: 'neutral',
    });
  });

  it('Hinweis nur für http und keiner', () => {
    expect(transportHinweis('tls')).toBeNull();
    expect(transportHinweis('proxy')).toBeNull();
    expect(transportHinweis('http')?.text).toMatch(/unverschlüsselt/);
    expect(transportHinweis('keiner')?.text).toMatch(/--tls.*--trusted-proxies/);
  });

  it('warnt vor einer http-Adresse, wenn der Server https verlangt', () => {
    expect(adresseBrauchtHttps('proxy', 'http:')).toBe(true);
    expect(adresseBrauchtHttps('tls', 'http:')).toBe(true);
    expect(adresseBrauchtHttps('keiner', 'http:')).toBe(true);
    // Mit dem Schalter des Betreibers ist http gewollt; über https gibt es nichts zu warnen.
    expect(adresseBrauchtHttps('http', 'http:')).toBe(false);
    expect(adresseBrauchtHttps('proxy', 'https:')).toBe(false);
  });

  it('die Adresse trägt den Unterpfad des Zwecks', () => {
    expect(einwurfAdresse('https://hub.example', SCHLUESSEL, 'alarmmeldungen:write')).toBe(
      `https://hub.example/api/v1/einwurf/${SCHLUESSEL}/alarmmeldung`,
    );
    expect(einwurfAdresse('https://hub.example', SCHLUESSEL, 'positionen:write')).toBe(
      `https://hub.example/api/v1/einwurf/${SCHLUESSEL}/position`,
    );
  });
});
