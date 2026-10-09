import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import { http, HttpResponse } from 'msw';
import { appRouten } from '../App';
import { meHandler, server } from '../test/server';
import { neuerQueryClient, setzeOnline } from '../test/utils';
import { benutzerFixture, einsatzFixture } from '../test/fixtures';
import { FakeEventSource } from '../test/eventSource';
import type {
  BrDetail,
  Einheit,
  EinsatzMaterial,
  GeraetAnzeige,
  Meldung,
  Person,
  PersonDetail,
  UhsDetail,
} from '../api/types';
import { ThemeModeProvider } from '../theme/ThemeModeProvider';
import { freigabenFixture } from '../test/fixtures';
import { zeitfenster } from '../test/verpflegungDaten';
import { formatiereDatenstand } from '../components/Datenstand';
import { kopplungEndetBald } from './GeraeteKopf';
import { ortInDerUhs } from './GeraetPatientenPage';
import { platzZahlen } from './GeraetStellePage';

/**
 * Die Gerätehülle im echten Routenbaum (LFH-892, Spec `feldgeraet-bedienung`): Startseite,
 * fremde Adressen, Kopfzeile und die geteilten Seiten ohne Sprünge in fremde Module.
 */

const JETZT = Date.parse('2026-10-04T10:00:00Z');

function geraet(ueber: Partial<GeraetAnzeige> = {}): GeraetAnzeige {
  return {
    kopplung_id: 3,
    einsatz_id: 7,
    ansicht: 'uhs-tablet',
    uhs_id: 2,
    stelle: 'UHS Nord',
    bezeichnung: 'Tablet 1',
    laeuft_ab_at: '2026-10-04 18:00:00',
    ...ueber,
  };
}

const uhs: UhsDetail = {
  id: 2,
  einsatz_id: 7,
  abschnitt_id: null,
  typ: 'behandlungsplatz',
  bezeichnung: 'UHS Nord',
  standort: null,
  notiz: null,
  lat: null,
  lon: null,
  status: 'aktiv',
  erfasst_at: '2026-10-04 08:00:00',
  erfasst_von: 1,
  geaendert_at: '2026-10-04 08:00:00',
  geaendert_von: 1,
  storniert_at: null,
  staerke: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
  kraefte: [],
  plaetze: [
    {
      id: 30,
      uhs_id: 2,
      bezeichnung: 'Liege 1',
      typ: 'bett',
      pos_x: 10,
      pos_y: 10,
      verfuegbarkeit: 'frei',
      reserviert_fuer_person_id: null,
      storniert_at: null,
    },
  ],
  belegungen: [],
  material: [],
} as UhsDetail;

function person(ueber: Partial<Person>): Person {
  return {
    id: 10,
    einsatz_id: 7,
    registrier_nr: 1,
    status: 'betroffen',
    name: 'Muster',
    vorname: 'Max',
    erfasst_at: '2026-10-04 09:00:00',
    erfasst_von: 1,
    geaendert_at: '2026-10-04 09:00:00',
    geaendert_von: 1,
    storniert_at: null,
    aktuelle_sichtung: 'sk2',
    aktuelle_sichtung_at: '2026-10-04 09:00:00',
    aktuelle_uhs_id: 2,
    aktueller_platz_id: null,
    antreff_ort: 'Brücke',
    ...ueber,
  } as Person;
}

const wartend = person({ id: 10, registrier_nr: 1 });
const ausgetreten = person({
  id: 11,
  registrier_nr: 2,
  name: 'Beispiel',
  aktuelle_uhs_id: null,
  aktuelle_verbleib_art: 'transport',
  aktueller_verbleib: 'KH Mitte',
});

function stelleBereit(g: GeraetAnzeige = geraet()) {
  server.use(
    meHandler({ ...benutzerFixture({ id: 50, anzeigename: 'UHS Nord · Tablet 1' }), geraet: g }),
    http.get('/api/einsaetze/7', () =>
      HttpResponse.json(einsatzFixture({ id: 7, meine_rolle: 'fuehrungspersonal' })),
    ),
    http.get('/api/einsaetze/7/personen', () => HttpResponse.json([wartend, ausgetreten])),
    http.get('/api/einsaetze/7/uhs/2', () => HttpResponse.json(uhs)),
    http.get('/api/einsaetze/7/personen/10', () =>
      HttpResponse.json({
        ...wartend,
        sichtungen: [],
        notizen: [],
        verbleib: [],
        abgleiche: [],
      } as PersonDetail),
    ),
  );
}

function renderApp(route: string) {
  const router = createMemoryRouter(appRouten, { initialEntries: [route] });
  render(
    <QueryClientProvider client={neuerQueryClient()}>
      <ThemeModeProvider>
        <ConfigProvider>
          <AntApp>
            <RouterProvider router={router} />
          </AntApp>
        </ConfigProvider>
      </ThemeModeProvider>
    </QueryClientProvider>,
  );
  return router;
}

const pfad = (router: ReturnType<typeof renderApp>) =>
  router.state.location.pathname + router.state.location.search;

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(JETZT);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setzeOnline(true);
  localStorage.clear();
});

describe('Gerätehülle — Startseite und Navigation', () => {
  it('Start am Tablet: Patientenliste der UHS mit „Patient aufnehmen“ als Primäraktion', async () => {
    stelleBereit();
    const router = renderApp('/geraet');
    expect(await screen.findByRole('heading', { level: 1, name: 'Patienten' })).toBeVisible();
    expect(pfad(router)).toBe('/geraet/7/patienten');
    expect(screen.getByRole('button', { name: 'Patient aufnehmen' })).toBeVisible();
    expect(await screen.findByText('Muster, Max')).toBeVisible();
    // Kein Benutzermenü, keine Modulleiste: nur die Gerätenavigation.
    const nav = screen.getByRole('navigation', { name: 'Gerätenavigation' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Patienten', 'Aufnahme', 'Grundriss']);
    expect(screen.queryByRole('button', { name: /Benutzermenü/ })).toBeNull();
  });

  it('Fremde Adresse: die Lagekarte führt auf die Startseite', async () => {
    stelleBereit();
    const router = renderApp('/einsaetze/7/lagekarte');
    await waitFor(() => expect(pfad(router)).toBe('/geraet/7/patienten'));
  });

  it('ein anderer Einsatz und eine fremde UHS führen auf die Startseite', async () => {
    stelleBereit();
    const router = renderApp('/geraet/99/patienten');
    await waitFor(() => expect(pfad(router)).toBe('/geraet/7/patienten'));
    await act(() => router.navigate('/geraet/7/uhs/5'));
    await waitFor(() => expect(pfad(router)).toBe('/geraet/7/patienten'));
  });

  it('die Aufnahme bucht immer in die eigene UHS', async () => {
    stelleBereit();
    const router = renderApp('/geraet/7/aufnahme?uhs=5');
    await waitFor(() => expect(pfad(router)).toBe('/geraet/7/aufnahme?uhs=2'));
    expect(await screen.findByRole('heading', { level: 1, name: /Aufnahme/ })).toBeVisible();
    // Keine Brotkrumen in die Stabsoberfläche.
    expect(screen.queryByRole('link', { name: 'Einsätze' })).toBeNull();
  });
});

describe('Gerätehülle — Kopfzeile', () => {
  it('zeigt Stelle, Gerät und das Kopplungsende', async () => {
    stelleBereit();
    renderApp('/geraet');
    const kopf = await screen.findByRole('banner');
    expect(within(kopf).getByText('UHS Nord')).toBeVisible();
    expect(within(kopf).getByText('Tablet 1')).toBeVisible();
    const ende = kopf.querySelector('[data-lfh="kopf-kopplungsende"]')!;
    expect(ende.getAttribute('data-bald')).toBe('nein');
    expect(ende.textContent).toMatch(/^bis /);
  });

  it('Kopplung endet bald: in 40 Minuten mit Wort hervorgehoben', async () => {
    stelleBereit(geraet({ laeuft_ab_at: '2026-10-04 10:40:00' }));
    renderApp('/geraet');
    const kopf = await screen.findByRole('banner');
    await waitFor(() =>
      expect(kopf.querySelector('[data-lfh="kopf-kopplungsende"]')).not.toBeNull(),
    );
    const ende = kopf.querySelector('[data-lfh="kopf-kopplungsende"]')!;
    expect(ende.getAttribute('data-bald')).toBe('ja');
    expect(ende.textContent).toMatch(/^endet /);
    expect(ende.getAttribute('aria-label')).toMatch(/endet bald/);
  });

  it('Verbindung weg: „offline“ und der Stand der angezeigten Daten', async () => {
    stelleBereit();
    renderApp('/geraet');
    expect(await screen.findByText('Muster, Max')).toBeVisible();
    act(() => setzeOnline(false));
    const kopf = screen.getByRole('banner');
    await waitFor(() =>
      expect(kopf.querySelector('[data-lfh="kopf-datenstand"]')?.textContent).toBe(
        `Stand ${formatiereDatenstand(JETZT)}`,
      ),
    );
    expect(kopf.querySelector('[data-lfh="kopf-sync"]')?.getAttribute('data-zustand')).toBe(
      'offline',
    );
  });

  it('Handschuh-Stufe im Gerätemenü wählbar und gespeichert', async () => {
    vi.useRealTimers();
    stelleBereit();
    renderApp('/geraet');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Gerätemenü' }));
    await user.click(await screen.findByRole('menuitem', { name: /Handschuh/ }));
    expect(localStorage.getItem('lifeline-hub.dichte')).toBe('handschuh');
  });

  it('Hilfe aus dem Gerätemenü, zurück führt „Zum Gerät“ (LFH-1096)', async () => {
    vi.useRealTimers();
    stelleBereit();
    renderApp('/geraet');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Gerätemenü' }));
    await user.click(await screen.findByRole('menuitem', { name: /Hilfe/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Hilfe' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Zum Gerät' })).toBeVisible();
  });
});

describe('Gerätehülle — geteilte Seiten ohne fremde Sprünge', () => {
  it('Patientenansicht: kein Sprung in Lagekarte oder andere Module, kein Status und Storno', async () => {
    vi.useRealTimers();
    stelleBereit();
    renderApp('/geraet/7/patienten/10');
    expect(await screen.findByRole('heading', { level: 1, name: /Person R-001/ })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Auf Lagekarte verorten' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Einsätze' })).toBeNull();
    expect(screen.queryByText(/Zuordnungen/)).toBeNull();
    expect(screen.queryByText(/Fotos und Dateien/)).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Weitere Aktionen zu Person/ }));
    await waitFor(() =>
      expect(
        document.querySelector('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]'),
      ).not.toBeNull(),
    );
    const menue = document.querySelector<HTMLElement>(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    )!;
    expect(within(menue).getByText('Bearbeiten')).toBeInTheDocument();
    expect(within(menue).queryByText('Stornieren')).toBeNull();
    expect(within(menue).queryByText(/^→/)).toBeNull();
  });

  it('Grundriss: ohne Platzbearbeitung, Status, Umschalter, Material und Dateien', async () => {
    vi.useRealTimers();
    stelleBereit();
    renderApp('/geraet/7/uhs/2');
    expect(await screen.findByRole('heading', { level: 1, name: /UHS Nord/ })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Patient aufnehmen' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Plätze bearbeiten' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Auflösen' })).toBeNull();
    // Die Reiterleiste von Material, Bewegungen und Dateien; die Reiter des Grundrisses selbst
    // stehen hier (jsdom misst keine Breite, also die Reiterform).
    expect(screen.queryByRole('tablist', { name: /Material|Bewegungen|Dateien/ })).toBeNull();
    expect(screen.queryByText('Material')).toBeNull();
    expect(screen.getByRole('region', { name: 'Bewegungen' })).toBeVisible();
  });
});

describe('UHS-Laptop — Grundriss bearbeiten und Bereich „UHS“', () => {
  const laptop = geraet({ ansicht: 'uhs-laptop', bezeichnung: 'Laptop 1' });
  const trage = {
    id: 12,
    einsatz_id: 7,
    material_id: 5,
    einheit_id: null,
    ist_adhoc: false,
    bezeichnung: 'Trage',
    kategorie: 'Transport',
    menge: 2,
    bestandsnummer: null,
    traegerorganisation: null,
    status: 'einsatzbereit',
    bemerkung: null,
    uhs_id: 2,
    disponiert_at: '2026-10-04 08:00:00',
    disponiert_von: 1,
  } as unknown as EinsatzMaterial;
  const eigene = {
    id: 40,
    einsatz_id: 7,
    lfd_nr: 4,
    absender: 'UHS Nord · Laptop 1',
    empfaenger: 'Einsatzleitung',
    meldeweg: 'sonstige',
    inhalt: 'Decken knapp',
    meldungsart: 'sonstige',
    prioritaet: 'dringend',
    richtung: 'intern',
    status: 'neu',
    bearbeiter_id: null,
    bearbeiter_name: null,
    lagerelevant: false,
    ereigniszeit: '2026-10-04 09:30:00',
    eingang_at: '2026-10-04 09:30:00',
    etb_meldung_id: 8,
    auftrag_id: 3,
    erfasst_von_id: 50,
    erstellt_at: '2026-10-04 09:30:00',
    lage_meldung_id: null,
    ist_offen: true,
    erledigt_at: null,
    bestaetigung_pflicht: false,
    bestaetigung_frist_at: null,
    eskaliert: false,
    bestaetigt_at: null,
    bestaetigt_von_id: null,
    bestaetigt_von_name: null,
    ist_bestaetigt: false,
  } as unknown as Meldung;

  function laptopBereit() {
    stelleBereit(laptop);
    const materialListe = vi.fn();
    const gesendet: unknown[] = [];
    server.use(
      http.get('/api/einsaetze/7/uhs/2', () => HttpResponse.json({ ...uhs, material: [trage] })),
      http.get('/api/einsaetze/7/material', () => {
        materialListe();
        return HttpResponse.json([], { status: 403 });
      }),
      http.get('/api/einsaetze/7/meldungen', () => HttpResponse.json([eigene])),
      http.post('/api/einsaetze/7/meldungen', async ({ request }) => {
        gesendet.push(await request.json());
        return HttpResponse.json({ ...eigene, id: 41, lfd_nr: 5 }, { status: 201 });
      }),
    );
    return { materialListe, gesendet };
  }

  it('Navigation mit „UHS“; der Grundriss lässt Plätze bearbeiten, aber nicht den Status', async () => {
    vi.useRealTimers();
    laptopBereit();
    renderApp('/geraet/7/uhs/2');
    expect(await screen.findByRole('heading', { level: 1, name: /UHS Nord/ })).toBeVisible();
    const nav = screen.getByRole('navigation', { name: 'Gerätenavigation' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Patienten', 'Aufnahme', 'Grundriss', 'UHS']);
    expect(await screen.findByRole('button', { name: 'Plätze bearbeiten' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Auflösen' })).toBeNull();
    // Material und Dateien stehen im Bereich „UHS“, nicht unter dem Grundriss.
    // Die Reiterleiste von Material, Bewegungen und Dateien; die Reiter des Grundrisses selbst
    // stehen hier (jsdom misst keine Breite, also die Reiterform).
    expect(screen.queryByRole('tablist', { name: /Material|Bewegungen|Dateien/ })).toBeNull();
  });

  it('Plätze in Zahlen, Material der UHS nur lesend und ohne die Einsatzliste', async () => {
    vi.useRealTimers();
    const { materialListe } = laptopBereit();
    renderApp('/geraet/7/stelle');
    expect(await screen.findByRole('heading', { level: 1, name: 'UHS' })).toBeVisible();
    const zahlen = await screen.findByRole('group', { name: 'Plätze in Zahlen' });
    expect(within(zahlen).getByText('Frei')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Grundriss bearbeiten' })).toBeVisible();

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Material' }));
    expect(await screen.findByText('Trage')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Lösen' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Material zuordnen' })).toBeNull();
    expect(materialListe).not.toHaveBeenCalled();
  });

  it('Meldung an die Einsatzleitung: Absender ist die Stelle, die eigenen stehen darunter', async () => {
    vi.useRealTimers();
    const { gesendet } = laptopBereit();
    renderApp('/geraet/7/stelle');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Meldungen' }));
    expect(await screen.findByText('Decken knapp')).toBeVisible();
    // Ein Auftrag zur Meldung ist kein Sprung für das Gerät.
    expect(screen.queryByRole('link', { name: /Auftrag/ })).toBeNull();

    await user.type(screen.getByLabelText('Inhalt'), 'Zwei Tragen frei');
    await user.click(screen.getByRole('radio', { name: 'dringend' }));
    await user.click(screen.getByRole('button', { name: 'Meldung senden' }));
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).toMatchObject({
      absender: 'UHS Nord · Laptop 1',
      empfaenger: 'Einsatzleitung',
      inhalt: 'Zwei Tragen frei',
      prioritaet: 'dringend',
    });
    await waitFor(() => expect(screen.getByLabelText('Inhalt')).toHaveValue(''));
  });

  it('Meldung abgelehnt: der Wortlaut bleibt stehen, die Priorität auch', async () => {
    vi.useRealTimers();
    laptopBereit();
    server.use(
      http.post('/api/einsaetze/7/meldungen', () =>
        HttpResponse.json({ error: 'Einsatz ist abgeschlossen' }, { status: 409 }),
      ),
    );
    renderApp('/geraet/7/stelle');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Meldungen' }));
    await user.type(await screen.findByLabelText('Inhalt'), 'Zwei Tragen frei');
    await user.click(screen.getByRole('radio', { name: 'sofort' }));
    await user.click(screen.getByRole('button', { name: 'Meldung senden' }));
    expect(await screen.findByText(/Einsatz ist abgeschlossen/)).toBeInTheDocument();
    expect(screen.getByLabelText('Inhalt')).toHaveValue('Zwei Tragen frei');
    expect(screen.getByRole('radio', { name: 'sofort' })).toBeChecked();
  });

  it('das Tablet hat keinen Bereich „UHS“', async () => {
    stelleBereit();
    const router = renderApp('/geraet/7/stelle');
    await waitFor(() => expect(pfad(router)).toBe('/geraet/7/patienten'));
  });
});

describe('Bereitstellungsraum — eigener Raum und Melden (LFH-1042)', () => {
  const brGeraet = geraet({
    ansicht: 'bereitstellungsraum',
    uhs_id: null,
    stelle_id: 4,
    stelle: 'BR Sportplatz',
    bezeichnung: 'Tablet BR',
  });
  const raum: BrDetail = {
    id: 4,
    einsatz_id: 7,
    abschnitt_id: null,
    bezeichnung: 'BR Sportplatz',
    standort: null,
    notiz: null,
    status: 'aktiv',
    erfasst_at: '2026-10-04 08:00:00',
    erfasst_von: 1,
    geaendert_at: '2026-10-04 08:00:00',
    geaendert_von: 1,
    storniert_at: null,
    einheiten: [{ id: 31, name: 'RTW 1' }],
    fahrzeuge: [],
  };
  const einheit = (id: number, name: string, br: number | null) =>
    ({
      id,
      einsatz_id: 7,
      abschnitt_id: null,
      ueber_einheit_id: null,
      typ_label: null,
      name,
      ist: { fuehrer: 0, unterfuehrer: 1, mannschaft: 1 },
      ist_kumuliert: { fuehrer: 0, unterfuehrer: 1, mannschaft: 1 },
      aktueller_br_id: br,
    }) as unknown as Einheit;

  function brBereit(detail: BrDetail = raum) {
    stelleBereit(brGeraet);
    const belegt: unknown[] = [];
    const status: unknown[] = [];
    const brListe = vi.fn();
    server.use(
      http.get('/api/einsaetze/7/bereitstellungsraeume/4', () => HttpResponse.json(detail)),
      http.get('/api/einsaetze/7/bereitstellungsraeume', () => {
        brListe();
        return HttpResponse.json([detail]);
      }),
      http.get('/api/einsaetze/7/einheiten', () =>
        HttpResponse.json([einheit(30, 'LF Nord', null), einheit(31, 'RTW 1', 4)]),
      ),
      http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json([])),
      http.get('/api/einsaetze/7/meldungen', () => HttpResponse.json([])),
      http.post('/api/einsaetze/7/bereitstellungsraeume/4/belegung', async ({ request }) => {
        belegt.push(await request.json());
        return HttpResponse.json({}, { status: 201 });
      }),
      http.post('/api/einsaetze/7/bereitstellungsraeume/4/status', async ({ request }) => {
        status.push(await request.json());
        return HttpResponse.json({ ...detail, status: 'aktiv' });
      }),
    );
    return { belegt, status, brListe };
  }

  it('Start am BR-Gerät: der eigene Raum, Navigation „Raum“ und „Melden“', async () => {
    vi.useRealTimers();
    const { brListe } = brBereit();
    const router = renderApp('/geraet');
    await waitFor(() => expect(pfad(router)).toBe('/geraet/7/br/4'));
    expect(await screen.findByRole('heading', { level: 1, name: /BR Sportplatz/ })).toBeVisible();
    const nav = screen.getByRole('navigation', { name: 'Gerätenavigation' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Raum', 'Melden']);
    // Kein Umschalter zwischen Räumen, kein Auflösen, keine Brotkrumen in die Stabsoberfläche.
    expect(screen.queryByRole('button', { name: 'Auflösen' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Einsätze' })).toBeNull();
    expect(brListe).not.toHaveBeenCalled();
    // Nichts auf der Platte: kein gemerkter Raum.
    expect(Object.keys(localStorage).filter((k) => k.includes('br'))).toEqual([]);
  });

  it('meldet eine freie Einheit an und eine bereitgestellte ab', async () => {
    vi.useRealTimers();
    const { belegt } = brBereit();
    renderApp('/geraet/7/br/4');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'LF Nord zuweisen' }));
    await waitFor(() => expect(belegt).toHaveLength(1));
    expect(belegt[0]).toEqual({ objekt_typ: 'einheit', objekt_id: 30, art: 'eintritt' });
    await user.click(screen.getByRole('button', { name: 'entfernen' }));
    await waitFor(() => expect(belegt).toHaveLength(2));
    expect(belegt[1]).toEqual({ objekt_typ: 'einheit', objekt_id: 31, art: 'austritt' });
  });

  it('nimmt einen geplanten Raum in Betrieb, ohne „Stornieren“ anzubieten', async () => {
    vi.useRealTimers();
    const { status } = brBereit({ ...raum, status: 'geplant', einheiten: [] });
    renderApp('/geraet/7/br/4');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'In Betrieb nehmen' }));
    await waitFor(() => expect(status).toEqual([{ status: 'aktiv' }]));
    expect(screen.queryByRole('button', { name: 'Stornieren' })).toBeNull();
  });

  it('ein fremder Raum und die Patientenliste führen auf den eigenen Raum', async () => {
    brBereit();
    const router = renderApp('/geraet/7/br/9');
    await waitFor(() => expect(pfad(router)).toBe('/geraet/7/br/4'));
    await act(() => router.navigate('/geraet/7/patienten'));
    await waitFor(() => expect(pfad(router)).toBe('/geraet/7/br/4'));
  });

  it('Meldung an die Einsatzleitung: Absender ist der Raum', async () => {
    vi.useRealTimers();
    brBereit();
    const gesendet: unknown[] = [];
    server.use(
      http.post('/api/einsaetze/7/meldungen', async ({ request }) => {
        gesendet.push(await request.json());
        return HttpResponse.json({ id: 41, lfd_nr: 5 }, { status: 201 });
      }),
    );
    renderApp('/geraet/7/meldungen');
    expect(await screen.findByRole('heading', { level: 1, name: 'Melden' })).toBeVisible();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Inhalt'), 'Raum voll');
    await user.click(screen.getByRole('button', { name: 'Meldung senden' }));
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).toMatchObject({
      absender: 'BR Sportplatz · Tablet BR',
      empfaenger: 'Einsatzleitung',
      inhalt: 'Raum voll',
    });
  });

  it('das UHS-Tablet hat keine Meldungsseite', async () => {
    stelleBereit();
    const router = renderApp('/geraet/7/meldungen');
    await waitFor(() => expect(pfad(router)).toBe('/geraet/7/patienten'));
  });
});

describe('Verpflegung — Portionen buchen und Fehlmenge melden (LFH-1044)', () => {
  const vGeraet = geraet({
    ansicht: 'verpflegung',
    uhs_id: null,
    stelle_id: null,
    stelle: null,
    bezeichnung: 'Ausgabe Deich',
  });
  /** Laufend um die echte Uhr: die Seite trennt „laufend“ von „vergangen“ nach der Uhrzeit. */
  const wire = (minuten: number) =>
    new Date(Date.now() + minuten * 60_000).toISOString().slice(0, 19).replace('T', ' ');

  function verpflegungBereit() {
    stelleBereit(vGeraet);
    const nachforderungen = vi.fn();
    server.use(
      http.get('/api/einsaetze/7/modul-freigaben', () =>
        HttpResponse.json(
          freigabenFixture({
            nachforderungen: { zugriff: false },
            personal: { zugriff: false },
            etb: { zugriff: false },
          }),
        ),
      ),
      http.get('/api/einsaetze/7/verpflegung', () =>
        HttpResponse.json({
          zeitfenster: [zeitfenster({ id: 1, einsatz_id: 7, von_at: wire(-30), bis_at: wire(60) })],
        }),
      ),
      http.get('/api/einsaetze/7/nachforderungen', () => {
        nachforderungen();
        return HttpResponse.json([]);
      }),
      http.get('/api/einsaetze/7/meldungen', () => HttpResponse.json([])),
    );
    return { nachforderungen };
  }

  it('Start am Verpflegungsgerät: Zeitfenster, Navigation „Verpflegung“ und „Melden“, kein Planen', async () => {
    vi.useRealTimers();
    const { nachforderungen } = verpflegungBereit();
    const router = renderApp('/geraet');
    await waitFor(() => expect(pfad(router)).toBe('/geraet/7/verpflegung'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Verpflegung' })).toBeVisible();
    expect(await screen.findByRole('article', { name: /Zeitfenster Mittag/ })).toBeVisible();
    const nav = screen.getByRole('navigation', { name: 'Gerätenavigation' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Verpflegung', 'Melden']);
    expect(screen.getByRole('button', { name: /^Ausgabe erfassen zu Mittag/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Zeitfenster anlegen' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Bedarf bearbeiten/ })).toBeNull();
    // Kein Dreipunkt-Menü, in dem Planen stecken könnte.
    expect(screen.queryByRole('button', { name: /^Aktionen zu/ })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Einsätze' })).toBeNull();
    expect(nachforderungen).not.toHaveBeenCalled();
  });

  it('„Fehlmenge melden“ füllt die Meldung an die Einsatzleitung vor, Absender ist das Gerät', async () => {
    vi.useRealTimers();
    verpflegungBereit();
    const gesendet: unknown[] = [];
    server.use(
      http.post('/api/einsaetze/7/meldungen', async ({ request }) => {
        gesendet.push(await request.json());
        return HttpResponse.json({ id: 41, lfd_nr: 5 }, { status: 201 });
      }),
    );
    const router = renderApp('/geraet/7/verpflegung');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /^Fehlmenge melden zu Mittag/ }));
    await waitFor(() => expect(pfad(router)).toBe('/geraet/7/meldungen'));
    const inhalt = await screen.findByLabelText<HTMLTextAreaElement>('Inhalt');
    await waitFor(() =>
      expect(inhalt.value).toMatch(
        /^Fehlmenge Verpflegung ‚Mittag‘ .+: 20 EP \(Bedarf 250, ausgegeben 230\)\.$/,
      ),
    );
    // Aus der Adresse geräumt: ein Neuladen füllt nicht erneut.
    expect(pfad(router)).toBe('/geraet/7/meldungen');
    await user.click(screen.getByRole('button', { name: 'Meldung senden' }));
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).toMatchObject({
      absender: 'Verpflegung · Ausgabe Deich',
      empfaenger: 'Einsatzleitung',
    });
    expect((gesendet[0] as { inhalt: string }).inhalt).toMatch(/^Fehlmenge Verpflegung ‚Mittag‘/);
    // Nach dem Senden steht die Maske leer da, nicht wieder vorbelegt.
    await waitFor(() => expect(screen.getByLabelText('Inhalt')).toHaveValue(''));
  });

  it('eine fremde Seite führt auf die Verpflegung', async () => {
    verpflegungBereit();
    const router = renderApp('/geraet/7/patienten');
    await waitFor(() => expect(pfad(router)).toBe('/geraet/7/verpflegung'));
  });
});

describe('Bausteine', () => {
  it('kopplungEndetBald: unter einer Stunde bald, ab einer Stunde nicht', () => {
    expect(kopplungEndetBald('2026-10-04 10:59:00', JETZT)).toBe(true);
    expect(kopplungEndetBald('2026-10-04 11:00:00', JETZT)).toBe(false);
  });

  it('ortInDerUhs: Wartebereich, Platz und nach dem Austritt der Verbleib', () => {
    expect(ortInDerUhs(wartend, uhs)).toBe('Wartebereich');
    expect(ortInDerUhs({ ...wartend, aktueller_platz_id: 30 }, uhs)).toBe('Liege 1');
    expect(ortInDerUhs(ausgetreten, uhs)).toBe('KH Mitte');
  });

  it('platzZahlen: belegt vor Verfügbarkeit, Wartebereich und stornierte zählen nicht', () => {
    const p = uhs.plaetze[0];
    const mit: UhsDetail = {
      ...uhs,
      plaetze: [
        p,
        { ...p, id: 31, verfuegbarkeit: 'defekt' },
        { ...p, id: 32, verfuegbarkeit: 'aufbereitung' },
        { ...p, id: 33 },
        { ...p, id: 34, typ: 'wartebereich' },
        { ...p, id: 35, storniert_at: '2026-10-04 09:00:00' },
      ],
    };
    expect(platzZahlen(mit, new Set([30, 32]))).toEqual({
      gesamt: 4,
      belegt: 2,
      frei: 1,
      nichtVerfuegbar: 1,
    });
  });
});
