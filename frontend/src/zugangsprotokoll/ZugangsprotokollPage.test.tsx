import { http, HttpResponse } from 'msw';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation, useNavigate } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { AnmeldeEintrag, BenutzerAnzeige, Zugangsaenderung } from '../api/types';
import { ZUGANGSPROTOKOLL_SEITE } from '../api/zugangsprotokoll';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { adminFixture, benutzerFixture } from '../test/fixtures';
import ZugangsprotokollPage, { parseZugangsprotokollFilter } from './ZugangsprotokollPage';

/** Zugangsprotokoll der Verwaltung (LFH-1097). */

const ME_ADMIN = adminFixture();
const ME_FK = benutzerFixture({ id: 2, anzeigename: 'FK', org_rolle: 'fuehrungskraft' });

const AENDERUNGEN: Zugangsaenderung[] = [
  {
    id: 12,
    zeitpunkt: '2026-10-08 09:00:00',
    aktion: 'rolle_geaendert',
    akteur_id: 1,
    akteur_name: 'admin',
    ziel_benutzer_id: 5,
    ziel: 'marlene',
    detail: 'system_rolle: keiner → admin',
    peer_ip: '203.0.113.5',
  },
  {
    id: 11,
    zeitpunkt: '2026-10-07 09:00:00',
    aktion: 'anmeldeweg_deaktiviert',
    akteur_id: 1,
    akteur_name: 'admin',
    ziel: 'oidc',
  },
];

const ANMELDUNGEN: AnmeldeEintrag[] = [
  {
    id: 40,
    zeitpunkt: '2026-10-08 07:00:00',
    ereignis: 'login_fehlgeschlagen',
    benutzername: 'root',
    peer_ip: '198.51.100.9',
    provider: 'passwort',
  },
];

function Ort() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output aria-label="Ort">{pathname + search}</output>
      {/* Wie der Menüeintrag: dieselbe Seite ohne Filter. */}
      <button type="button" onClick={() => navigate('/admin/zugangsprotokoll')}>
        Menü
      </button>
    </>
  );
}

/** Fängt die Abfragen beider Routen; liefert die gesehenen Suchparameter je Route. */
function zeige(
  me: BenutzerAnzeige = ME_ADMIN,
  route = '/admin/zugangsprotokoll',
  aenderungen: Zugangsaenderung[] = AENDERUNGEN,
) {
  const gesehen = { anmeldungen: [] as URLSearchParams[], aenderungen: [] as URLSearchParams[] };
  server.use(
    meHandler(me),
    http.get('/api/benutzer', () => HttpResponse.json([ME_ADMIN])),
    http.get('/api/zugangsprotokoll/zugangsaenderungen', ({ request }) => {
      const p = new URL(request.url).searchParams;
      gesehen.aenderungen.push(p);
      return HttpResponse.json(p.get('vor_id') ? [] : aenderungen);
    }),
    http.get('/api/zugangsprotokoll/anmeldungen', ({ request }) => {
      gesehen.anmeldungen.push(new URL(request.url).searchParams);
      return HttpResponse.json(ANMELDUNGEN);
    }),
  );
  renderMitProviders(
    <>
      <Routes>
        <Route path="/admin/zugangsprotokoll" element={<ZugangsprotokollPage />} />
        <Route path="/admin/stammdaten/stichworte" element={<span>Stichworte</span>} />
      </Routes>
      <Ort />
    </>,
    { route },
  );
  return gesehen;
}

async function tabelle(): Promise<HTMLElement> {
  await screen.findAllByRole('table');
  return document.querySelector<HTMLElement>('.ant-table')!;
}

describe('ZugangsprotokollPage', () => {
  it('zeigt die Admin-Spur als Vorgabe, mit Aktion als Wort und ohne DB-id', async () => {
    zeige();
    const t = await tabelle();
    expect(await within(t).findByText('Rolle geändert')).toBeInTheDocument();
    expect(within(t).getByText('marlene')).toBeInTheDocument();
    expect(within(t).getByText('system_rolle: keiner → admin')).toBeInTheDocument();
    // Ein Anmeldeweg als Ziel steht mit seinem Namen, nicht als id.
    expect(within(t).getByText('SSO')).toBeInTheDocument();
    expect(t).not.toHaveTextContent('anmeldeweg_deaktiviert');
    expect(screen.queryByText('Ältere laden')).not.toBeInTheDocument();
  });

  it('wechselt über die Segmentleiste auf die Anmeldespur und schreibt sie in die URL', async () => {
    const gesehen = zeige();
    await within(await tabelle()).findByText('Rolle geändert');
    await userEvent.click(screen.getByRole('radio', { name: 'Anmeldungen' }));
    const t = await tabelle();
    expect(await within(t).findByText('Anmeldung fehlgeschlagen')).toBeInTheDocument();
    expect(within(t).getByText('root')).toBeInTheDocument();
    expect(within(t).getByText('Passwort')).toBeInTheDocument();
    expect(screen.getByLabelText('Ort')).toHaveTextContent('spur=anmeldungen');
    expect(gesehen.anmeldungen).toHaveLength(1);
  });

  it('übernimmt Filter aus der URL in die Anfrage, Unbrauchbares fällt weg', async () => {
    const gesehen = zeige(
      ME_ADMIN,
      '/admin/zugangsprotokoll?aktion=rolle_geaendert&konto=marlene&von=2026-10-01%2000:00:00&ereignis=logout',
    );
    await within(await tabelle()).findByText('Rolle geändert');
    const p = gesehen.aenderungen[0];
    expect(p.get('aktion')).toBe('rolle_geaendert');
    expect(p.get('konto')).toBe('marlene');
    expect(p.get('von')).toBe('2026-10-01 00:00:00');
    // `ereignis` gehört zur anderen Spur.
    expect(p.has('ereignis')).toBe(false);
    expect(p.get('limit')).toBe(String(ZUGANGSPROTOKOLL_SEITE));
  });

  it('entprellt das Kontofeld und lädt dann mit dem Konto', async () => {
    const gesehen = zeige();
    await within(await tabelle()).findByText('Rolle geändert');
    fireEvent.change(screen.getByRole('combobox', { name: 'Konto' }), {
      target: { value: 'marlene' },
    });
    await waitFor(() =>
      expect(gesehen.aenderungen.some((p) => p.get('konto') === 'marlene')).toBe(true),
    );
    expect(screen.getByLabelText('Ort')).toHaveTextContent('konto=marlene');
  });

  it('behält ein getipptes Konto über einen schnellen Spurwechsel', async () => {
    const gesehen = zeige();
    await within(await tabelle()).findByText('Rolle geändert');
    fireEvent.change(screen.getByRole('combobox', { name: 'Konto' }), {
      target: { value: 'marlene' },
    });
    await userEvent.click(screen.getByRole('radio', { name: 'Anmeldungen' }));
    await waitFor(() =>
      expect(gesehen.anmeldungen.some((p) => p.get('konto') === 'marlene')).toBe(true),
    );
    expect(screen.getByLabelText('Ort')).toHaveTextContent('spur=anmeldungen');
    expect(screen.getByRole('combobox', { name: 'Konto' })).toHaveValue('marlene');
  });

  it('leert das Kontofeld, wenn die Seite von außen ohne Filter geöffnet wird', async () => {
    zeige(ME_ADMIN, '/admin/zugangsprotokoll?konto=marlene');
    await within(await tabelle()).findByText('Rolle geändert');
    expect(screen.getByRole('combobox', { name: 'Konto' })).toHaveValue('marlene');
    await userEvent.click(screen.getByRole('button', { name: 'Menü' }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Konto' })).toHaveValue(''));
  });

  it('lädt ältere Einträge über den Cursor der letzten Seite', async () => {
    const volle = Array.from({ length: ZUGANGSPROTOKOLL_SEITE }, (_, i) => ({
      ...AENDERUNGEN[1],
      id: 500 - i,
      ziel: `k${i}`,
    }));
    const gesehen = zeige(ME_ADMIN, '/admin/zugangsprotokoll', volle);
    await within(await tabelle()).findByText('k0');
    await userEvent.click(screen.getByRole('button', { name: 'Ältere laden' }));
    await waitFor(() =>
      expect(gesehen.aenderungen.some((p) => p.get('vor_id') === String(500 - 99))).toBe(true),
    );
  });

  /**
   * Mutationsprobe für den Stand `vorläufig` (LFH-1140): bis die Antwort auf einen Filterwechsel da
   * ist, stehen die alten Zeilen. Wäre schon das der neue Stand, fröre die Sicht unter dem Zeiger die
   * alte Folge ein, und die Antwort käme als Zufluss hinter dem Sammelbanner an.
   */
  it('zeigt die Antwort auf einen Filterwechsel sofort, auch mit dem Zeiger über der Tabelle', async () => {
    const NEU: Zugangsaenderung = { ...AENDERUNGEN[0], id: 14, ziel: 'kurt', detail: 'neu' };
    let freigeben: () => void = () => {};
    const gesehen = zeige();
    server.use(
      http.get('/api/zugangsprotokoll/zugangsaenderungen', async ({ request }) => {
        const p = new URL(request.url).searchParams;
        gesehen.aenderungen.push(p);
        if (p.get('konto') !== 'kurt') return HttpResponse.json(AENDERUNGEN);
        await new Promise<void>((r) => (freigeben = r));
        return HttpResponse.json([NEU]);
      }),
    );
    const t = await tabelle();
    await within(t).findByText('Rolle geändert');
    // Die Maus zielt auf die Liste, getippt wird oben im Kontofeld.
    fireEvent.pointerMove(screen.getByRole('region', { name: 'Zugangsänderungen' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Konto' }), {
      target: { value: 'kurt' },
    });
    await waitFor(() =>
      expect(gesehen.aenderungen.some((p) => p.get('konto') === 'kurt')).toBe(true),
    );
    // Vorläufig: die alten Zeilen stehen noch.
    expect(within(t).getByText('marlene')).toBeInTheDocument();

    freigeben();
    expect(await within(t).findByText('kurt')).toBeInTheDocument();
    expect(within(t).queryByText('marlene')).toBeNull();
    expect(screen.queryByRole('button', { name: /neue[rn]? Eintr/ })).toBeNull();
  });

  it('leitet die Führungskraft in die Verwaltung zurück', async () => {
    zeige(ME_FK);
    expect(await screen.findByText('Stichworte')).toBeInTheDocument();
  });
});

describe('parseZugangsprotokollFilter', () => {
  it('verwirft unbekannte Werte ganz', () => {
    const f = parseZugangsprotokollFilter(
      new URLSearchParams('spur=quatsch&von=gestern&ereignis=rolle_geaendert&konto=%20%20'),
    );
    expect(f).toEqual({
      spur: 'zugangsaenderungen',
      von: undefined,
      bis: undefined,
      konto: undefined,
      ereignis: undefined,
      aktion: undefined,
    });
  });
});
