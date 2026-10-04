import { http, HttpResponse } from 'msw';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import type {
  BenutzerAnzeige,
  EinsatzAnzeige,
  Fuehrungsstelle,
  FuehrungsstellePatch,
  Sprechgruppe,
} from '../api/types';
import EinsatzdatenPage, {
  geaenderteKopfdaten,
  gleicherZeitpunkt,
  type FormWerte,
} from './EinsatzdatenPage';
import { alsZeitpunkt } from '../anzeige/zeitEingabe';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
import { mitProzessZone } from '../test/prozessZone';
import { adminFixture, einsatzFixture } from '../test/fixtures';

dayjs.extend(utc);

const admin = adminFixture();

const basisEinsatz = einsatzFixture({
  id: 7,
  bezeichnung: 'Hochwasser Nord',
  stichwort: 'H1',
  begonnen_at: '2026-05-23 09:00:00',
  einsatznummer_intern: '2026-001',
});

const mitglieder = [
  {
    benutzer_id: 1,
    anzeigename: 'Admin',
    benutzername: 'admin',
    einsatz_rolle: 'einsatzleitung',
    zugewiesen_at: '2026-05-23 09:00:00',
  },
  {
    benutzer_id: 2,
    anzeigename: 'Frank Führung',
    benutzername: 'frank',
    einsatz_rolle: 'fuehrungspersonal',
    zugewiesen_at: '2026-05-23 09:05:00',
  },
];

const vorschlaege = [
  { id: 1, text: 'H1' },
  { id: 2, text: 'MANV' },
];

const sprechgruppenListe: Sprechgruppe[] = [
  {
    id: 1,
    einsatz_id: null,
    einsatz_lokal: false,
    bezeichnung: '311',
    betriebsart: 'TMO',
    hinweis: null,
    aktiv: true,
    sortier: 1,
  },
  {
    id: 2,
    einsatz_id: 7,
    einsatz_lokal: true,
    bezeichnung: '505',
    betriebsart: 'DMO',
    hinweis: null,
    aktiv: true,
    sortier: 2,
  },
];

interface SetupOpts {
  einsatz?: Partial<EinsatzAnzeige>;
  benutzer?: BenutzerAnzeige;
  /** Anzeigezone; ohne gilt die Browserzone (kein Provider, wie bisher). */
  zeitzone?: string;
}

function setup(opts: SetupOpts = {}) {
  const einsatz = { ...basisEinsatz, ...opts.einsatz };
  const benutzer = opts.benutzer ?? admin;
  server.use(
    meHandler(benutzer),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    http.get('/api/einsaetze/7/mitglieder', () => HttpResponse.json(mitglieder)),
    http.get('/api/benutzer', () => HttpResponse.json([])),
    http.get('/api/stichwort-vorschlaege', () => HttpResponse.json(vorschlaege)),
    http.get('/api/einsaetze/:id/ort-vorschau', () =>
      HttpResponse.json({ peilung: null, ortsname: null }),
    ),
    http.get('/api/einsaetze/7/fuehrungsstelle', () =>
      HttpResponse.json({ sprechgruppen: [] } satisfies Fuehrungsstelle),
    ),
    http.get('/api/einsaetze/7/sprechgruppen', () => HttpResponse.json(sprechgruppenListe)),
  );
  const routen = (
    <Routes>
      <Route path="/einsaetze/:id/einsatzdaten" element={<EinsatzdatenPage />} />
    </Routes>
  );
  return renderMitProviders(
    opts.zeitzone ? (
      <AnzeigeKonventionenProvider konventionen={{ zeitzone: opts.zeitzone }}>
        {routen}
      </AnzeigeKonventionenProvider>
    ) : (
      routen
    ),
    { route: '/einsaetze/7/einsatzdaten' },
  );
}

describe('Führungsstellen-Berechtigung', () => {
  it.each([null, 'beobachter', 'fuehrungspersonal'] as const)(
    'LFH-461 Review: System-Admin mit Einsatzrolle %s darf keine Führungsstelle bearbeiten',
    async (meine_rolle) => {
      setup({ einsatz: { meine_rolle } });
      await screen.findByText('Frank Führung');
      expect(screen.queryAllByRole('button', { name: /Führungsstelle für/ })).toHaveLength(0);
    },
  );

  it('LFH-461 Review: aktive Einsatzleitung darf die Führungsstelle bearbeiten', async () => {
    setup({ benutzer: { ...admin, system_rolle: 'keiner' } });
    expect(
      await screen.findByRole('button', { name: 'Führungsstelle für Frank Führung bearbeiten' }),
    ).toBeInTheDocument();
  });
});

describe('gleicherZeitpunkt (LFH-472)', () => {
  it('vergleicht den Instant, nicht die Objektidentität', () => {
    // Zwei Renders bauen zwei Objekte für denselben Wirestring; „unverändert" muss das bleiben.
    expect(
      gleicherZeitpunkt(alsZeitpunkt('2026-05-23 09:00:00')!, alsZeitpunkt('2026-05-23 09:00:00')!),
    ).toBe(true);
    expect(
      gleicherZeitpunkt(alsZeitpunkt('2026-05-23 09:00:00')!, alsZeitpunkt('2026-05-23 09:00:01')!),
    ).toBe(false);
  });

  it('leer ist nur leer gleich', () => {
    expect(gleicherZeitpunkt(null, null)).toBe(true);
    expect(gleicherZeitpunkt(null, alsZeitpunkt('2026-05-23 09:00:00')!)).toBe(false);
    expect(gleicherZeitpunkt(alsZeitpunkt('2026-05-23 09:00:00')!, null)).toBe(false);
  });
});

describe('geaenderteKopfdaten (LFH-839)', () => {
  const vorher: FormWerte = {
    bezeichnung: 'Hochwasser Nord',
    stichwort: 'H1',
    einsatzart: 'realeinsatz',
    einsatzort_koord: { lat: 48.1234, lon: 11.5678 },
    begonnen_at: alsZeitpunkt('2026-05-23 09:00:00')!,
    naechste_lagebesprechung_at: alsZeitpunkt('2026-05-23 12:00:00')!,
  };

  it('frische Objekte mit denselben Werten sind keine Änderung', () => {
    expect(
      geaenderteKopfdaten(vorher, {
        ...vorher,
        stichwort: ' H1 ',
        einsatzort_koord: { lat: 48.1234, lon: 11.5678 },
        begonnen_at: alsZeitpunkt('2026-05-23 09:00:00')!,
        naechste_lagebesprechung_at: alsZeitpunkt('2026-05-23 12:00:00')!,
      }),
    ).toEqual({});
  });

  it('Geleertes geht als null hinaus, die Koordinate als Paar', () => {
    expect(
      geaenderteKopfdaten(vorher, {
        ...vorher,
        stichwort: '',
        einsatzort_koord: null,
        naechste_lagebesprechung_at: null,
      }),
    ).toEqual({
      stichwort: null,
      einsatzort_lat: null,
      einsatzort_lon: null,
      naechste_lagebesprechung_at: null,
    });
  });

  it('Einsatzart und Alarmzeit gehen nur geändert hinaus', () => {
    expect(
      geaenderteKopfdaten(vorher, {
        ...vorher,
        einsatzart: 'uebung',
        begonnen_at: alsZeitpunkt('2026-05-23 09:00:01')!,
      }),
    ).toEqual({ einsatzart: 'uebung', begonnen_at: '2026-05-23 09:00:01' });
  });
});

describe('EinsatzdatenPage', () => {
  it('LFH-463: zeigt den Besprechungstermin lokal; derselbe Instant gilt als unverändert', async () => {
    let patchBody: Record<string, unknown> | null = null;
    setup({ einsatz: { naechste_lagebesprechung_at: '2026-09-09 13:17:43' } });
    server.use(
      http.patch('/api/einsaetze/7', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(basisEinsatz);
      }),
    );
    expect(await screen.findByText('Nächste Lagebesprechung')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    expect(screen.getByLabelText('Nächste Lagebesprechung (optional)')).toHaveValue(
      dayjs.utc('2026-09-09 13:17:43').local().format('YYYY-MM-DD HH:mm:ss'),
    );
    // Die Runde Wire→Feld→Instant verschiebt nichts: der Termin fehlt im Teil-Patch (LFH-839).
    await user.type(screen.getByLabelText('Bezeichnung'), ' 2');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(patchBody).not.toBeNull());
    expect(patchBody).toEqual({ bezeichnung: 'Hochwasser Nord 2' });
  });

  it('LFH-463: leeren des Besprechungstermins sendet explizit null', async () => {
    let patchBody: Record<string, unknown> = {};
    setup({ einsatz: { naechste_lagebesprechung_at: '2026-09-09 13:17:43' } });
    server.use(
      http.patch('/api/einsaetze/7', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(basisEinsatz);
      }),
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    const feld = screen.getByLabelText('Nächste Lagebesprechung (optional)');
    // jsdom aktiviert den CSS-Hoverzustand des Clear-Buttons nicht. Der Browserweg
    // wird zusätzlich im ETB-E2E geprüft; hier zählt dessen tatsächlicher onClear-Pfad.
    fireEvent.click(feld.closest('.ant-picker')!.querySelector<HTMLElement>('.ant-picker-clear')!);
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(patchBody.naechste_lagebesprechung_at).toBeNull());
  });

  it('zeigt die Alarmzeit im Picker lokal; unverändert geht sie nicht hinaus', async () => {
    let patchBody: Record<string, unknown> = {};
    setup();
    server.use(
      http.patch('/api/einsaetze/7', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(basisEinsatz);
      }),
    );

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }));

    // Der DatePicker trägt die LOKALE Entsprechung des Wire-UTC (in Europe/Berlin 11:00).
    const alarmzeit = await screen.findByLabelText('Alarmzeit');
    expect(alarmzeit).toHaveValue(
      dayjs.utc(basisEinsatz.begonnen_at).local().format('YYYY-MM-DD HH:mm:ss'),
    );

    // Die Runde Wire→Picker→Instant darf den Instant nicht verschieben: unverändert fehlt die
    // Alarmzeit im Teil-Patch (LFH-839). Eine verschobene Zeit stünde hier als Schlüssel.
    await user.type(screen.getByLabelText('Bezeichnung'), ' 2');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(patchBody).toHaveProperty('bezeichnung'));
    expect(patchBody).not.toHaveProperty('begonnen_at');
  });

  it('zeigt Kopfdaten im Lesemodus, leere Felder als —', async () => {
    setup();
    expect(await screen.findByText('Realeinsatz')).toBeInTheDocument();
    // 'Admin' erscheint als Einsatzleitung in der Kopfleiste und zusätzlich in der Zugriff-Tabelle.
    expect(screen.getAllByText('Admin').length).toBeGreaterThan(0);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    // Die Einsatznummer ist eine technische Angabe im eingeklappten Abschnitt; ohne `forceRender`
    // steht sie nicht im Baum. Das Aufklappen prüft der Gliederungs-Block weiter unten.
    expect(screen.queryByText('2026-001')).toBeNull();
  });

  it('zeigt Koordinaten über formatKoordinate (WGS84-Default: toFixed(5))', async () => {
    setup({ einsatz: { einsatzort_lat: 48.1234, einsatzort_lon: 11.5678 } });
    // Ohne EinsatzAnzeigeProvider greift DEFAULT_KONVENTIONEN → WGS84 → lat.toFixed(5), lon.toFixed(5)
    expect(await screen.findByText('48.12340, 11.56780')).toBeInTheDocument();
  });

  it('speichert einsatzort_koord als einsatzort_lat/lon im PATCH-Body', async () => {
    let patchBody: Record<string, unknown> = {};
    // Nur eine geänderte Koordinate geht hinaus (LFH-839); unverändert fehlt das Paar.
    setup({ einsatz: { einsatzort_lat: 48.1234, einsatzort_lon: 11.5678 } });
    server.use(
      http.patch('/api/einsaetze/7', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          ...basisEinsatz,
          einsatzort_lat: 48.1234,
          einsatzort_lon: 11.5678,
        });
      }),
    );

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    const feld = screen.getByRole('textbox', { name: 'Koordinate' });
    await user.clear(feld);
    await user.type(feld, '48.2234, 11.6678');
    await user.tab();
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(patchBody.einsatzort_lat).toBeCloseTo(48.2234, 4));
    expect(patchBody.einsatzort_lon).toBeCloseTo(11.6678, 4);
  });

  // LFH-517: ungültig ist nicht leer — kein PATCH, der die gespeicherte Koordinate löscht.
  it('ungültige Koordinate speichert nicht; nach Korrektur geht das richtige Paar hinaus', async () => {
    const patches: Record<string, unknown>[] = [];
    setup({ einsatz: { einsatzort_lat: 48.1234, einsatzort_lon: 11.5678 } });
    server.use(
      http.patch('/api/einsaetze/7', async ({ request }) => {
        patches.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(basisEinsatz);
      }),
    );

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    const feld = screen.getByRole('textbox', { name: 'Koordinate' });
    await user.clear(feld);
    await user.type(feld, '48.5; 11.5');
    await user.tab();
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(await screen.findByText('Ungültige Koordinate im Format WGS84 dezimal')).toBeVisible();
    expect(feld).toHaveValue('48.5; 11.5');
    expect(patches).toHaveLength(0);

    await user.clear(feld);
    await user.type(feld, '48.5, 11.5');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toMatchObject({ einsatzort_lat: 48.5, einsatzort_lon: 11.5 });
  });

  it('Gegenprobe: eine bestehende Koordinate lässt sich bewusst leeren', async () => {
    let patchBody: Record<string, unknown> = {};
    setup({ einsatz: { einsatzort_lat: 48.1234, einsatzort_lon: 11.5678 } });
    server.use(
      http.patch('/api/einsaetze/7', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(basisEinsatz);
      }),
    );

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await user.clear(screen.getByRole('textbox', { name: 'Koordinate' }));
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(patchBody).toHaveProperty('einsatzort_lat', null));
    expect(patchBody.einsatzort_lon).toBeNull();
  });

  it('zeigt den Bearbeiten-Button für schreibberechtigten, aktiven Einsatz', async () => {
    setup();
    expect(await screen.findByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument();
  });

  it('versteckt den Bearbeiten-Button für Beobachter', async () => {
    setup({
      einsatz: { meine_rolle: 'beobachter' },
      benutzer: { ...admin, system_rolle: 'keiner' },
    });
    await screen.findByText('Realeinsatz');
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });

  it('versteckt den Bearbeiten-Button bei abgeschlossenem Einsatz', async () => {
    setup({ einsatz: { status: 'abgeschlossen', abgeschlossen_at: '2026-05-24 10:00:00' } });
    await screen.findByText('Realeinsatz');
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });

  it('speichert via PATCH und invalidiert den Einsatz-Cache', async () => {
    // Den PATCH-Body im Handler prüfen und den Aufruf über ein Boolean signalisieren — eine in
    // einer Closure zugewiesene Variable wird außerhalb nicht eng typisiert.
    let patchAufgerufen = false;
    setup();
    server.use(
      http.patch('/api/einsaetze/7', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        // Nur die geänderte Angabe (LFH-839), kein Vollersatz.
        expect(body).toEqual({ bezeichnung: 'Geändert' });
        patchAufgerufen = true;
        return HttpResponse.json({ ...basisEinsatz, bezeichnung: 'Geändert' });
      }),
    );

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }));

    const bezeichnung = await screen.findByLabelText('Bezeichnung');
    await user.clear(bezeichnung);
    await user.type(bezeichnung, 'Geändert');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(patchAufgerufen).toBe(true));
  });

  it('zeigt die Zugriff-Namen read-only auch für Beobachter', async () => {
    setup({
      einsatz: { meine_rolle: 'beobachter' },
      benutzer: { ...admin, system_rolle: 'keiner' },
    });
    expect(await screen.findByText('Frank Führung')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Entfernen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hinzufügen' })).not.toBeInTheDocument();
  });

  it('zeigt Verwaltungs-Aktionen für Einsatzleitung im aktiven Einsatz', async () => {
    setup();
    expect(await screen.findByText('Frank Führung')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Entfernen' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Hinzufügen' })).toBeInTheDocument();
  });

  it('blendet Verwaltungs-Aktionen für Führungspersonal aus', async () => {
    // Benutzer ohne System-Admin: sonst gewährte der admin-globale Zweig die Leitungsrechte auch
    // dem Führungspersonal-Konto.
    setup({
      einsatz: { meine_rolle: 'fuehrungspersonal' },
      benutzer: { ...admin, system_rolle: 'keiner' },
    });
    expect(await screen.findByText('Frank Führung')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Entfernen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hinzufügen' })).not.toBeInTheDocument();
  });

  it('blendet Verwaltungs-Aktionen bei abgeschlossenem Einsatz aus', async () => {
    setup({ einsatz: { status: 'abgeschlossen', abgeschlossen_at: '2026-05-24 10:00:00' } });
    expect(await screen.findByText('Frank Führung')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Entfernen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hinzufügen' })).not.toBeInTheDocument();
  });
});

/**
 * Persistenter Speicherfehler: die Meldung steht in der Seite, nicht in antds Message-Container.
 * Kein Fake-Timer-Vorlauf: ein nach dem Klick aktivierter Fake-Timer erreicht antds laufenden
 * Message-Timer nicht, und vor dem Rendern gesetzt hinge der MSW-Antwortweg (Details in
 * `einstellungen/EinsatzDefaults.test.tsx`).
 */
describe('EinsatzdatenPage · Speicherfehler (LFH-345)', () => {
  it('meldet den Fehler an der Seite, NICHT als Toast', async () => {
    setup();
    server.use(
      http.patch('/api/einsaetze/7', () =>
        HttpResponse.json({ error: 'Bezeichnung bereits vergeben' }, { status: 409 }),
      ),
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await userEvent.type(screen.getByLabelText('Bezeichnung'), ' 2');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    const treffer = await screen.findByText('Bezeichnung bereits vergeben');
    expect(treffer.closest('.ant-message')).toBeNull();
  });

  // Die zweite Hälfte: ein Alert, der nie geht, ist so falsch wie einer, der zu früh geht.
  it('raeumt den Fehler beim naechsten Absenden weg', async () => {
    setup();
    let abgelehnt = true;
    server.use(
      http.patch('/api/einsaetze/7', () => {
        if (abgelehnt) {
          return HttpResponse.json({ error: 'Bezeichnung bereits vergeben' }, { status: 409 });
        }
        return HttpResponse.json({ ...basisEinsatz });
      }),
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await userEvent.type(screen.getByLabelText('Bezeichnung'), ' 2');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await screen.findByText('Bezeichnung bereits vergeben');

    abgelehnt = false;
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(screen.queryByText('Bezeichnung bereits vergeben')).not.toBeInTheDocument(),
    );
  });
});

/**
 * Gliederung der Leseansicht: Status als Beschriftung statt Wire-Wert, gewichtete Kopfangaben statt
 * Datenwand, und der Fokus bleibt beim Wechsel in den Bearbeiten-Modus nicht auf dem verschwundenen
 * Knopf.
 */
describe('EinsatzdatenPage · Gliederung (LFH-345, M14)', () => {
  it('zeigt den Status als Wort, nicht als Wire-Wert', async () => {
    setup({ einsatz: { status: 'abgeschlossen', abgeschlossen_at: '2026-05-24 10:00:00' } });
    const tag = await screen.findByText('Abgeschlossen');
    expect(screen.queryByText('abgeschlossen')).toBeNull();

    // Die unterscheidende Hälfte: ein lokales `status[0].toUpperCase()` erfüllte das Paar oben.
    // Erst `data-rolle` belegt, dass der Wert durch `einsatzStatus` und `StatusTag` gelaufen ist.
    expect(tag.closest('[data-rolle]')).toHaveAttribute('data-rolle', 'neutral');
  });

  it('hält die technischen Angaben eingeklappt, die Kopfangaben aber sichtbar', async () => {
    // `basisEinsatz` trägt für beide Felder `null` — ohne diese Werte prüfte der Test gegen zwei
    // Gedankenstriche.
    setup({ einsatz: { einsatzort: 'Musterstraße 1', leitstellen_nr: 'LS-4711' } });
    expect(await screen.findByText('Musterstraße 1')).toBeInTheDocument();
    expect(screen.queryByText('LS-4711')).toBeNull();

    await userEvent.click(screen.getByText('Technische Angaben'));
    expect(await screen.findByText('LS-4711')).toBeInTheDocument();
  });

  it('LFH-617: die Einsatznummer ist Anzeige, kein Eingabefeld — und geht nicht in den PATCH', async () => {
    let patchBody: Record<string, unknown> | null = null;
    setup({ einsatz: { einsatznummer_intern: 'E-2026-0431', leitstellen_nr: 'LS-1' } });
    server.use(
      http.patch('/api/einsaetze/7', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(basisEinsatz);
      }),
    );
    const user = userEvent.setup();

    // Lesezweig: die Nummer steht unter „Einsatznummer“ in den technischen Angaben.
    await user.click(await screen.findByText('Technische Angaben'));
    expect(await screen.findByText('E-2026-0431')).toBeInTheDocument();
    expect(screen.getByText('Einsatznummer')).toBeInTheDocument();

    // Bearbeiten: kein Feld für die Systemnummer, die Leitstellen-Nr. bleibt editierbar.
    await user.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    expect(screen.queryByLabelText(/Einsatznummer/)).toBeNull();
    expect(screen.getByLabelText('Leitstellen-Nr.')).toHaveValue('LS-1');

    await user.type(screen.getByLabelText('Leitstellen-Nr.'), '2');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(patchBody).not.toBeNull());
    // Abwesenheit des Schlüssels, nicht bloß `null`: auch `null` ist beim Server 400.
    expect(patchBody).not.toHaveProperty('einsatznummer_intern');
    expect(patchBody).toHaveProperty('leitstellen_nr', 'LS-12');
  });

  it('setzt den Fokus beim Bearbeiten aufs erste Feld', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    expect(screen.getByLabelText('Bezeichnung')).toHaveFocus();
  });
});

describe('EinsatzdatenPage · Zeilenbearbeitung (LFH-472)', () => {
  /**
   * Nimmt jeden PATCH-Body auf und legt ihn wie der Server über den Stand; das GET danach (die
   * Invalidierung) liefert den neuen Stand, nicht den alten.
   */
  function patchMitschnitt(einsatz: Partial<EinsatzAnzeige> = {}) {
    const bodies: Record<string, unknown>[] = [];
    let stand: EinsatzAnzeige = { ...basisEinsatz, ...einsatz };
    server.use(
      http.get('/api/einsaetze/7', () => HttpResponse.json(stand)),
      http.patch('/api/einsaetze/7', async ({ request }) => {
        const body = (await request.json()) as Partial<EinsatzAnzeige>;
        bodies.push(body);
        stand = { ...stand, ...body };
        return HttpResponse.json(stand);
      }),
    );
    return bodies;
  }

  async function technikAufklappen(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: /Technische Angaben/ }));
  }

  it('trägt die Leitstellen-Nr. nach, ohne die Leseansicht zu verlassen — nur dieses Feld geht raus', async () => {
    setup();
    const bodies = patchMitschnitt();
    const user = userEvent.setup();
    await technikAufklappen(user);
    await user.click(await screen.findByRole('button', { name: 'Leitstellen-Nr. eintragen' }));

    // Die Leseansicht steht weiter: Kopfleiste und Lagedaten sind sichtbar, kein Vollformular.
    expect(screen.getByText('Einsatzstichwort')).toBeInTheDocument();
    expect(screen.getByText('Lagedaten')).toBeInTheDocument();
    expect(screen.queryByText('Einsatzdaten bearbeiten')).toBeNull();

    await user.type(screen.getByRole('textbox', { name: 'Leitstellen-Nr.' }), 'ILS-4711{Enter}');
    await waitFor(() => expect(bodies).toEqual([{ leitstellen_nr: 'ILS-4711' }]));
    expect(
      await screen.findByRole('button', { name: 'Leitstellen-Nr. bearbeiten' }),
    ).toHaveAccessibleDescription('ILS-4711');
  });

  it('Einsatzstichwort über die Vorschlagseingabe ändern', async () => {
    setup();
    const bodies = patchMitschnitt();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Einsatzstichwort bearbeiten' }));
    const feld = screen.getByRole('combobox', { name: 'Einsatzstichwort' });
    expect(feld).toHaveValue('H1');
    await user.clear(feld);
    await user.type(feld, 'MANV 2');
    await user.click(screen.getByRole('button', { name: 'Einsatzstichwort speichern' }));
    await waitFor(() => expect(bodies).toEqual([{ stichwort: 'MANV 2' }]));
  });

  it('leeren einer optionalen Angabe sendet null', async () => {
    setup({ einsatz: { einsatzort: 'Deich Süd' } });
    const bodies = patchMitschnitt({ einsatzort: 'Deich Süd' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Einsatzort bearbeiten' }));
    await user.clear(screen.getByRole('textbox', { name: 'Einsatzort' }));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(bodies).toEqual([{ einsatzort: null }]));
  });

  it('unveränderter Wert sendet nichts', async () => {
    setup({ einsatz: { meldende_stelle: 'ILS Nord' } });
    const bodies = patchMitschnitt({ meldende_stelle: 'ILS Nord' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Meldende Stelle bearbeiten' }));
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('button', { name: 'Meldende Stelle bearbeiten' })).toBeVisible();
    expect(bodies).toEqual([]);
  });

  it('Anzahl Betroffene geht als Zahl raus, nicht als Text', async () => {
    setup();
    const bodies = patchMitschnitt();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Anzahl Betroffene (initial) eintragen' }),
    );
    await user.type(screen.getByRole('spinbutton', { name: 'Anzahl Betroffene (initial)' }), '12');
    await user.click(screen.getByRole('button', { name: 'Anzahl Betroffene (initial) speichern' }));
    await waitFor(() => expect(bodies).toEqual([{ anzahl_betroffene_initial: 12 }]));
  });

  it('Alarmzeit geleert: kein PATCH, alte Zeit steht wieder da, Hinweis an der Zeile', async () => {
    setup();
    const bodies = patchMitschnitt();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Alarmzeit bearbeiten' }));
    const feld = screen.getByRole('textbox', { name: 'Alarmzeit' });
    fireEvent.click(feld.closest('.ant-picker')!.querySelector<HTMLElement>('.ant-picker-clear')!);
    await user.click(screen.getByRole('button', { name: 'Alarmzeit speichern' }));

    expect(
      await screen.findByText('Alarmzeit ist eine Pflichtangabe — der bisherige Wert bleibt.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Alarmzeit bearbeiten' })).toBeInTheDocument();
    expect(bodies).toEqual([]);
  });

  it('Alarmzeit unverändert gespeichert: kein PATCH (Wandlung ohne Versatz)', async () => {
    setup();
    const bodies = patchMitschnitt();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Alarmzeit bearbeiten' }));
    expect(screen.getByRole('textbox', { name: 'Alarmzeit' })).toHaveValue(
      dayjs.utc(basisEinsatz.begonnen_at).local().format('YYYY-MM-DD HH:mm:ss'),
    );
    await user.click(screen.getByRole('button', { name: 'Alarmzeit speichern' }));
    expect(await screen.findByRole('button', { name: 'Alarmzeit bearbeiten' })).toBeVisible();
    expect(bodies).toEqual([]);
  });

  /*
   * Eingetippt wird die LOKALE Wanduhrzeit des Instants, erwartet der UTC-Wirestring desselben
   * Instants. Unter TZ=UTC wäre das trivial grün; scharf ist es unter TZ=Europe/Berlin
   * (`check-all.sh`). Die Instants liegen je eine Stunde vor und nach beiden Umstellungen 2026
   * und meiden die doppelte Stunde im Oktober, die als Wanduhrzeit mehrdeutig ist. Je Instant ein
   * eigener Fall: als Schleife in EINEM Test lagen vier Seitendurchläufe an der Grenze von
   * `testTimeout` (gemessen 9,6–13 s, LFH-692).
   */
  it.each([
    '2026-03-29 00:30:00',
    '2026-03-29 01:30:00',
    '2026-10-24 23:30:00',
    '2026-10-25 02:30:00',
  ])(
    'Alarmzeit inline: gesendet wird der gewählte absolute Zeitpunkt, beidseits der Sommerzeit-Umstellungen (%s)',
    async (wire) => {
      setup();
      const bodies = patchMitschnitt();
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Alarmzeit bearbeiten' }));
      const feld = screen.getByRole('textbox', { name: 'Alarmzeit' });
      await user.clear(feld);
      await user.type(feld, dayjs.utc(wire).local().format('YYYY-MM-DD HH:mm:ss'));
      // Enter übernimmt die Eingabe in den Picker; der Knopf sendet.
      fireEvent.keyDown(feld, { key: 'Enter' });
      await user.click(screen.getByRole('button', { name: 'Alarmzeit speichern' }));
      await waitFor(() => expect(bodies, wire).toEqual([{ begonnen_at: wire }]));
    },
  );

  it('Escape bei offenem Kalender schließt erst den Kalender, das zweite verwirft die Zeile', async () => {
    setup();
    const bodies = patchMitschnitt();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Alarmzeit bearbeiten' }));
    const feld = screen.getByRole('textbox', { name: 'Alarmzeit' });
    // Ein Klick ins Feld öffnet den Kalender.
    await user.click(feld);
    await waitFor(() =>
      expect(
        document.querySelector('.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)'),
      ).not.toBeNull(),
    );
    fireEvent.keyDown(feld, { key: 'Escape' });
    // Die Zeile steht noch. Ob der Kalender zu ist, zeigt jsdom nicht: es beendet die
    // Schließ-Animation nie, `-hidden` käme nicht an.
    expect(screen.getByRole('textbox', { name: 'Alarmzeit' })).toBeInTheDocument();
    // rc-picker meldet das Schließen erst im nächsten Frame (`useDelayState`); ein Mensch drückt
    // das zweite Escape nie schneller.
    await act(() => new Promise((fertig) => requestAnimationFrame(() => fertig(undefined))));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Alarmzeit' }), { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Alarmzeit' })).toBeNull();
    expect(bodies).toEqual([]);
  });

  it('Speicherfehler steht an der Zeile, die Eingabe bleibt offen, kein Toast', async () => {
    setup();
    server.use(
      http.patch('/api/einsaetze/7', () =>
        HttpResponse.json({ error: 'Einsatz ist abgeschlossen' }, { status: 409 }),
      ),
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Meldende Stelle eintragen' }));
    await user.type(screen.getByRole('textbox', { name: 'Meldende Stelle' }), 'ILS{Enter}');
    expect(await screen.findByText('Einsatz ist abgeschlossen')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Meldende Stelle' })).toHaveValue('ILS');
    expect(document.querySelector('.ant-message-error')).toBeNull();
  });

  it('Koordinate, Einsatzleitung, Einsatznummer und „Angelegt am" tragen keine Aufforderung', async () => {
    setup({ einsatz: { einsatzort_lat: 48.1234, einsatzort_lon: 11.5678 } });
    const user = userEvent.setup();
    await technikAufklappen(user);
    // Exakte Namen statt eines gebauten RegExp: die Etiketten tragen Punkt und Klammern.
    for (const angabe of [
      'Koordinate',
      'Einsatzleitung',
      'Einsatznummer',
      'Angelegt am (techn.)',
    ]) {
      for (const aufforderung of ['bearbeiten', 'eintragen']) {
        expect(screen.queryByRole('button', { name: `${angabe} ${aufforderung}` })).toBeNull();
      }
    }
    // Gegenprobe: die inline bearbeitbaren Angaben daneben tragen eine.
    expect(screen.getByRole('button', { name: 'Leitstellen-Nr. eintragen' })).toBeInTheDocument();
  });

  it.each([
    [
      'Beobachter',
      { meine_rolle: 'beobachter' as const },
      { ...admin, system_rolle: 'keiner' as const },
    ],
    [
      'abgeschlossener Einsatz',
      { status: 'abgeschlossen' as const, abgeschlossen_at: '2026-05-24 10:00:00' },
      admin,
    ],
  ])(
    'ohne Schreibrecht (%s) keine Aufforderung an einer Zeile',
    async (_fall, einsatz, benutzer) => {
      setup({ einsatz, benutzer });
      const user = userEvent.setup();
      await technikAufklappen(user);
      expect(screen.queryAllByRole('button', { name: / (bearbeiten|eintragen)$/ })).toEqual([]);
      expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    },
  );
});

/**
 * LFH-555: der Einsatzkopf ist live. Ein fremdes `einsatz`-Ereignis frischt den Kopf-Cache auf,
 * während hier jemand tippt. Die Eingaben dieses Schirms dürfen dabei nicht verloren gehen.
 * Nachgestellt über die Invalidierung, die der Live-Strom auslöst (`['einsatz', id]`).
 */
describe('EinsatzdatenPage · Live-Refetch des Kopfs (LFH-555)', () => {
  function setupMitFremdAenderung() {
    let stand: EinsatzAnzeige = { ...basisEinsatz };
    let abrufe = 0;
    const r = setup();
    server.use(
      http.get('/api/einsaetze/7', () => {
        abrufe += 1;
        return HttpResponse.json(stand);
      }),
    );
    return {
      ...r,
      abrufe: () => abrufe,
      fremdAendern: (teil: Partial<EinsatzAnzeige>) => {
        stand = { ...stand, ...teil };
      },
    };
  }

  it('zeigt einen fremd gesetzten Termin nach dem Ereignis ohne Neuladen der Seite', async () => {
    const { client, fremdAendern, abrufe } = setupMitFremdAenderung();
    await screen.findByText('Nächste Lagebesprechung');
    const vorher = abrufe();
    fremdAendern({ naechste_lagebesprechung_at: '2026-09-30 16:00:00' });
    await act(() => client.invalidateQueries({ queryKey: ['einsatz', 7] }));
    await waitFor(() => expect(abrufe()).toBeGreaterThan(vorher));
    expect(
      await screen.findByRole('button', { name: /^Nächste Lagebesprechung bearbeiten/ }),
    ).toBeInTheDocument();
  });

  it('das offene Bearbeitungsformular behält die Eingaben', async () => {
    const { client, fremdAendern, abrufe } = setupMitFremdAenderung();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    const bezeichnung = await screen.findByLabelText('Bezeichnung');
    await user.clear(bezeichnung);
    await user.type(bezeichnung, 'Mein Entwurf');

    const vorher = abrufe();
    fremdAendern({
      bezeichnung: 'Fremd geändert',
      naechste_lagebesprechung_at: '2026-09-30 16:00:00',
    });
    await act(() => client.invalidateQueries({ queryKey: ['einsatz', 7] }));
    await waitFor(() => expect(abrufe()).toBeGreaterThan(vorher));

    expect(screen.getByLabelText('Bezeichnung')).toHaveValue('Mein Entwurf');
  });

  it('eine offene Zeile behält ihren Entwurf', async () => {
    const { client, fremdAendern, abrufe } = setupMitFremdAenderung();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Technische Angaben/ }));
    await user.click(await screen.findByRole('button', { name: 'Leitstellen-Nr. eintragen' }));
    const feld = await screen.findByRole('textbox', { name: 'Leitstellen-Nr.' });
    await user.type(feld, 'LS-42');

    const vorher = abrufe();
    fremdAendern({ leitstellen_nr: 'LS-99' });
    await act(() => client.invalidateQueries({ queryKey: ['einsatz', 7] }));
    await waitFor(() => expect(abrufe()).toBeGreaterThan(vorher));

    expect(screen.getByRole('textbox', { name: 'Leitstellen-Nr.' })).toHaveValue('LS-42');
  });
});

/**
 * LFH-839: Das Vollformular schickt nur, was sich gegenüber dem Stand beim Öffnen geändert hat. Ein
 * Vollersatz überschrieb die Zeilenänderung einer anderen Person still mit dem Stand von damals.
 */
describe('EinsatzdatenPage · Vollformular sendet nur Geändertes (LFH-839)', () => {
  /** Wie der Server: jeder PATCH legt nur seine Schlüssel über den Stand; fremd ändert dazwischen. */
  function serverStand(einsatz: Partial<EinsatzAnzeige> = {}) {
    const bodies: Record<string, unknown>[] = [];
    let stand: EinsatzAnzeige = { ...basisEinsatz, ...einsatz };
    server.use(
      http.get('/api/einsaetze/7', () => HttpResponse.json(stand)),
      http.patch('/api/einsaetze/7', async ({ request }) => {
        const body = (await request.json()) as Partial<EinsatzAnzeige>;
        bodies.push(body);
        stand = { ...stand, ...body };
        return HttpResponse.json(stand);
      }),
    );
    return {
      bodies,
      stand: () => stand,
      fremdAendern: (teil: Partial<EinsatzAnzeige>) => {
        stand = { ...stand, ...teil };
      },
    };
  }

  it('nur die Bezeichnung geändert: genau { bezeichnung } geht hinaus', async () => {
    setup();
    const { bodies } = serverStand();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    const feld = screen.getByLabelText('Bezeichnung');
    await user.clear(feld);
    await user.type(feld, 'Hochwasser Süd');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(bodies).toEqual([{ bezeichnung: 'Hochwasser Süd' }]));
  });

  it('eine fremd geänderte Leitstellen-Nr. bleibt nach dem Speichern erhalten', async () => {
    setup({ einsatz: { leitstellen_nr: 'LS-1' } });
    const { bodies, stand, fremdAendern } = serverStand({ leitstellen_nr: 'LS-1' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    expect(screen.getByLabelText('Leitstellen-Nr.')).toHaveValue('LS-1');

    // Eine andere Person trägt die Nummer über die Zeile nach, während das Formular offen ist.
    fremdAendern({ leitstellen_nr: 'LS-99' });

    const feld = screen.getByLabelText('Bezeichnung');
    await user.clear(feld);
    await user.type(feld, 'Hochwasser Süd');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).not.toHaveProperty('leitstellen_nr');
    expect(stand().leitstellen_nr).toBe('LS-99');
  });

  it('ohne Änderung: kein PATCH, das Formular schließt', async () => {
    setup();
    const { bodies } = serverStand();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(screen.queryByText('Einsatzdaten bearbeiten')).toBeNull());
    expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument();
    expect(bodies).toEqual([]);
  });

  it('Texte zählen getrimmt: angehängter Leerraum ist keine Änderung', async () => {
    setup({ einsatz: { einsatzort: 'Deich Süd' } });
    const { bodies } = serverStand({ einsatzort: 'Deich Süd' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await user.type(screen.getByLabelText('Bezeichnung'), '  ');
    await user.type(screen.getByLabelText('Einsatzort (Adresse)'), ' ');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(screen.queryByText('Einsatzdaten bearbeiten')).toBeNull());
    expect(bodies).toEqual([]);
  });

  it('ein geleertes Textfeld geht als null hinaus', async () => {
    setup({ einsatz: { meldende_stelle: 'ILS Nord' } });
    const { bodies } = serverStand({ meldende_stelle: 'ILS Nord' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await user.clear(screen.getByLabelText('Meldende/anfordernde Stelle'));
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(bodies).toEqual([{ meldende_stelle: null }]));
  });

  it('die Koordinate geht als Paar hinaus, auch wenn sich nur ein Wert ändert', async () => {
    setup({ einsatz: { einsatzort_lat: 48.1234, einsatzort_lon: 11.5678 } });
    const { bodies } = serverStand({ einsatzort_lat: 48.1234, einsatzort_lon: 11.5678 });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    const feld = screen.getByRole('textbox', { name: 'Koordinate' });
    await user.clear(feld);
    await user.type(feld, '48.1234, 11.6');
    await user.tab();
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ einsatzort_lat: 48.1234, einsatzort_lon: 11.6 });
  });

  it('die Anzahl Betroffene geht als Zahl hinaus, die übrigen Felder nicht', async () => {
    setup();
    const { bodies } = serverStand();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await user.type(screen.getByLabelText('Anzahl Betroffene (initial)'), '12');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(bodies).toEqual([{ anzahl_betroffene_initial: 12 }]));
  });
});

/**
 * LFH-692 (Delta `einsatzdaten-bearbeitung`, Szenario „Browser in anderer Zone“): Browser auf UTC,
 * Anzeigezone Europe/Berlin. Vorher zeigte die Zeile die Browser-Wanduhr neben der Berliner
 * Leseansicht.
 */
describe('EinsatzdatenPage — Alarmzeit in der Anzeigezone (LFH-692)', () => {
  mitProzessZone('UTC');

  it('Zeilenbearbeitung zeigt 12:00 wie die Leseansicht; 13:00 sendet 11:00 UTC', async () => {
    setup({ zeitzone: 'Europe/Berlin', einsatz: { begonnen_at: '2026-07-14 10:00:00' } });
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.patch('/api/einsaetze/7', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        bodies.push(body);
        return HttpResponse.json({ ...basisEinsatz, ...body });
      }),
    );
    const user = userEvent.setup();
    // Leseansicht: taktische DTG in Berlin.
    expect(await screen.findByText('141200JUL2026')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Alarmzeit bearbeiten' }));
    const feld = screen.getByRole('textbox', { name: 'Alarmzeit' });
    expect(feld).toHaveValue('2026-07-14 12:00:00');
    await user.clear(feld);
    await user.type(feld, '2026-07-14 13:00:00');
    fireEvent.keyDown(feld, { key: 'Enter' });
    await user.click(screen.getByRole('button', { name: 'Alarmzeit speichern' }));
    await waitFor(() => expect(bodies).toEqual([{ begonnen_at: '2026-07-14 11:00:00' }]));
  });

  it('Vollformular: Alarmzeit in Berlin; unverändert geht sie nicht hinaus, 13:00 sendet 11:00 UTC', async () => {
    setup({ zeitzone: 'Europe/Berlin', einsatz: { begonnen_at: '2026-07-14 10:00:00' } });
    const puts: Record<string, unknown>[] = [];
    server.use(
      http.patch('/api/einsaetze/7', async ({ request }) => {
        puts.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ ...basisEinsatz, begonnen_at: '2026-07-14 10:00:00' });
      }),
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    expect(await screen.findByLabelText('Alarmzeit')).toHaveValue('2026-07-14 12:00:00');
    // Unverändert: die Wandlung Berlin↔UTC verschiebt den Instant nicht, also kein Schlüssel.
    await user.type(screen.getByLabelText('Bezeichnung'), ' 2');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).not.toHaveProperty('begonnen_at');

    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    const feld = await screen.findByLabelText('Alarmzeit');
    await user.clear(feld);
    await user.type(feld, '2026-07-14 13:00:00');
    fireEvent.keyDown(feld, { key: 'Enter' });
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1]).toEqual({ begonnen_at: '2026-07-14 11:00:00' });
  });
});

/**
 * ── Einstieg in den Einsatzbericht (LFH-726) ──
 *
 * „Einsatzbericht drucken" öffnet die Druckansicht und sendet nichts ab: Kopf-Slot, sekundär, als
 * Link mit Knopfgestalt. Auch für Beobachter und abgeschlossene Einsätze — der Bericht prüft die
 * Rechte je Quelle selbst.
 */
describe('EinsatzdatenPage — Einstieg in den Einsatzbericht (LFH-726)', () => {
  async function kopf() {
    return waitFor(() => {
      const k = document.querySelector<HTMLElement>('[data-lfh="seitenkopf-aktionen"]');
      expect(k).not.toBeNull();
      return k!;
    });
  }

  it('verlinkt sekundär auf die Druckansicht; höchstens eine Primäraktion bleibt', async () => {
    setup();
    const k = await kopf();
    const link = await within(k).findByRole('link', { name: 'Einsatzbericht drucken' });
    expect(link).toHaveAttribute('href', '/einsaetze/7/einsatzdaten/bericht');
    expect(link).not.toHaveClass('ant-btn-primary');
    expect(k.querySelectorAll('.ant-btn-primary').length).toBeLessThanOrEqual(1);
  });

  it('steht auch für Beobachter und im abgeschlossenen Einsatz da', async () => {
    setup({
      einsatz: { meine_rolle: 'beobachter', status: 'abgeschlossen' },
      benutzer: { ...admin, system_rolle: 'keiner' },
    });
    const k = await kopf();
    expect(await within(k).findByRole('link', { name: 'Einsatzbericht drucken' })).toBeVisible();
  });

  it('weicht im Bearbeiten-Modus', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await screen.findByText('Einsatzdaten bearbeiten');
    expect(screen.queryByRole('link', { name: 'Einsatzbericht drucken' })).not.toBeInTheDocument();
  });
});

/**
 * Eigene Führungsstelle (LFH-849, Spec `einsatz-fuehrungsstelle`): ein Paneel mit vier Zeilen,
 * jede schickt nur ihr Feld an `…/fuehrungsstelle`.
 */
describe('EinsatzdatenPage · Eigene Führungsstelle (LFH-849)', () => {
  /** Nimmt jeden PATCH-Body auf und legt ihn wie der Server über den Stand. */
  function fuehrungsstelleMitschnitt(start: Fuehrungsstelle = { sprechgruppen: [] }) {
    const bodies: FuehrungsstellePatch[] = [];
    let stand: Fuehrungsstelle = start;
    server.use(
      http.get('/api/einsaetze/7/fuehrungsstelle', () => HttpResponse.json(stand)),
      http.patch('/api/einsaetze/7/fuehrungsstelle', async ({ request }) => {
        const body = (await request.json()) as FuehrungsstellePatch;
        bodies.push(body);
        const { sprechgruppe_ids, ...felder } = body;
        const naechster: Fuehrungsstelle = { ...stand };
        for (const [k, v] of Object.entries(felder)) {
          if (v == null) delete naechster[k as keyof typeof felder];
          else naechster[k as keyof typeof felder] = v;
        }
        if (sprechgruppe_ids) {
          naechster.sprechgruppen = sprechgruppenListe.filter((g) =>
            sprechgruppe_ids.includes(g.id),
          );
        }
        stand = naechster;
        return HttpResponse.json(stand);
      }),
    );
    return bodies;
  }

  async function paneel() {
    return within(await screen.findByRole('region', { name: 'Eigene Führungsstelle' }));
  }

  it('zeigt vier Angaben; leer mit Aufforderung', async () => {
    setup();
    fuehrungsstelleMitschnitt();
    const p = await paneel();
    for (const etikett of ['Rufname', 'Sprechgruppen', 'Kommunikationsmittel', 'Erreichbarkeit']) {
      expect(await p.findByRole('button', { name: `${etikett} eintragen` })).toBeInTheDocument();
    }
  });

  it('Rufname: nur dieses Feld geht hinaus, die Zeile zeigt den Wert', async () => {
    setup();
    const bodies = fuehrungsstelleMitschnitt();
    const user = userEvent.setup();
    const p = await paneel();
    await user.click(await p.findByRole('button', { name: 'Rufname eintragen' }));
    await user.type(p.getByRole('textbox', { name: 'Rufname' }), 'Florian Musterstadt 10/1{Enter}');
    await waitFor(() => expect(bodies).toEqual([{ rufname: 'Florian Musterstadt 10/1' }]));
    expect(
      await p.findByRole('button', { name: 'Rufname bearbeiten' }),
    ).toHaveAccessibleDescription('Florian Musterstadt 10/1');
  });

  it('Sprechgruppen: Auswahl geht als `sprechgruppe_ids`, Anzeige nach Betriebsart', async () => {
    setup();
    const bodies = fuehrungsstelleMitschnitt();
    const user = userEvent.setup();
    const p = await paneel();
    await user.click(await p.findByRole('button', { name: 'Sprechgruppen eintragen' }));
    await user.click(p.getByRole('combobox', { name: 'Sprechgruppen' }));
    await user.click(await screen.findByText('311'));
    await user.click(await screen.findByText('505 (lokal)'));
    await user.click(p.getByRole('button', { name: 'Sprechgruppen speichern' }));
    await waitFor(() => expect(bodies).toEqual([{ sprechgruppe_ids: [1, 2] }]));
    expect(
      await p.findByRole('button', { name: 'Sprechgruppen bearbeiten' }),
    ).toHaveAccessibleDescription('TMO 311 · DMO 505');
  });

  it('Kommunikationsmittel: Schlüssel hinaus, Label in der Anzeige', async () => {
    setup();
    const bodies = fuehrungsstelleMitschnitt();
    const user = userEvent.setup();
    const p = await paneel();
    await user.click(await p.findByRole('button', { name: 'Kommunikationsmittel eintragen' }));
    await user.click(p.getByRole('combobox', { name: 'Kommunikationsmittel' }));
    await user.click(await screen.findByText('Digitalfunk'));
    await user.click(p.getByRole('button', { name: 'Kommunikationsmittel speichern' }));
    await waitFor(() => expect(bodies).toEqual([{ kommunikationsmittel: 'digitalfunk' }]));
    expect(
      await p.findByRole('button', { name: 'Kommunikationsmittel bearbeiten' }),
    ).toHaveAccessibleDescription('Digitalfunk');
  });

  it('Erreichbarkeit: unverändert sendet nichts, geleert sendet null', async () => {
    setup();
    const bodies = fuehrungsstelleMitschnitt({ sprechgruppen: [], erreichbarkeit: '0171 1234567' });
    const user = userEvent.setup();
    const p = await paneel();
    await user.click(await p.findByRole('button', { name: 'Erreichbarkeit bearbeiten' }));
    await user.keyboard('{Enter}');
    expect(await p.findByRole('button', { name: 'Erreichbarkeit bearbeiten' })).toBeVisible();
    expect(bodies).toEqual([]);

    await user.click(p.getByRole('button', { name: 'Erreichbarkeit bearbeiten' }));
    await user.clear(p.getByRole('textbox', { name: 'Erreichbarkeit' }));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(bodies).toEqual([{ erreichbarkeit: null }]));
    expect(await p.findByRole('button', { name: 'Erreichbarkeit eintragen' })).toBeVisible();
  });

  it('Beobachter: Angaben ohne Aufforderung, leer als „—“', async () => {
    setup({
      einsatz: { meine_rolle: 'beobachter' },
      benutzer: { ...admin, system_rolle: 'keiner' },
    });
    fuehrungsstelleMitschnitt({ sprechgruppen: [], rufname: 'Florian 10/1' });
    const p = await paneel();
    expect(await p.findByText('Florian 10/1')).toBeInTheDocument();
    expect(p.queryByRole('button', { name: /eintragen|bearbeiten/ })).toBeNull();
    expect(p.getAllByText('—')).toHaveLength(3);
  });

  it('Speicherfehler steht an der Zeile, die Eingabe bleibt offen', async () => {
    setup();
    server.use(
      http.patch('/api/einsaetze/7/fuehrungsstelle', () =>
        HttpResponse.json({ error: 'Einsatz ist abgeschlossen' }, { status: 409 }),
      ),
    );
    const user = userEvent.setup();
    const p = await paneel();
    await user.click(await p.findByRole('button', { name: 'Rufname eintragen' }));
    await user.type(p.getByRole('textbox', { name: 'Rufname' }), 'X{Enter}');
    const fehler = await p.findByText('Einsatz ist abgeschlossen');
    expect(fehler.closest('.ant-message')).toBeNull();
    expect(p.getByRole('textbox', { name: 'Rufname' })).toHaveValue('X');
  });
});
