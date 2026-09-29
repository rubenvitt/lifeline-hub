import { http, HttpResponse } from 'msw';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import type { BenutzerAnzeige, EinsatzAnzeige } from '../api/types';
import EinsatzdatenPage, {
  gleicherZeitpunkt,
  pickerZuWire,
  wireZuPicker,
} from './EinsatzdatenPage';
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

interface SetupOpts {
  einsatz?: Partial<EinsatzAnzeige>;
  benutzer?: BenutzerAnzeige;
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
  );
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/einsatzdaten" element={<EinsatzdatenPage />} />
    </Routes>,
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

describe('Alarmzeit-Wandlung (Wire ↔ Picker)', () => {
  it('liest den Wirestring als UTC — geprüft am absoluten Instant, nicht an der Wanduhrzeit', () => {
    // Geprüft wird der Instant, nicht das Format: `Date.UTC(...)` ist in jeder Zeitzone derselbe
    // Zeitpunkt, `dayjs(wire)` parste den naiven Wirestring als lokale Zeit. Unter TZ=UTC sind
    // beide Lesarten gleich und der Test trivial grün; scharf ist er unter TZ=Europe/Berlin.
    expect(wireZuPicker('2026-05-23 09:00:00').valueOf()).toBe(Date.UTC(2026, 4, 23, 9, 0, 0));
  });

  it('hält den Picker in lokaler Zeit — dieselbe Wanduhrzeit, die ZeitAnzeige daneben rendert', () => {
    // `format.ts:inZone` rendert ohne konfigurierte Zone `dayjs.utc(x).local()`. Der Picker muss
    // dieselbe Wanduhrzeit zeigen, sonst stünde im Bearbeiten-Modus eine andere Uhrzeit als in der
    // Zelle daneben.
    expect(wireZuPicker('2026-05-23 09:00:00').format('YYYY-MM-DD HH:mm:ss')).toBe(
      dayjs.utc('2026-05-23 09:00:00').local().format('YYYY-MM-DD HH:mm:ss'),
    );
  });

  it('normalisiert die lokale Picker-Zeit zurück auf den UTC-Wirestring', () => {
    // Fester Instant 09:00 UTC, als Dayjs im Lokal-Modus — so liefert ihn der antd-DatePicker. Ohne
    // `.utc()` im Helfer formatierte `.format()` die lokale Wanduhrzeit; der local→UTC-Shift wird
    // echt exerziert.
    const lokal = dayjs.utc('2026-05-23 09:00:00').local();
    expect(pickerZuWire(lokal)).toBe('2026-05-23 09:00:00');
  });
});

describe('gleicherZeitpunkt (LFH-472)', () => {
  it('vergleicht den Instant, nicht die Objektidentität', () => {
    // Zwei Renders bauen zwei Objekte für denselben Wirestring; „unverändert" muss das bleiben.
    expect(
      gleicherZeitpunkt(wireZuPicker('2026-05-23 09:00:00'), wireZuPicker('2026-05-23 09:00:00')),
    ).toBe(true);
    expect(
      gleicherZeitpunkt(wireZuPicker('2026-05-23 09:00:00'), wireZuPicker('2026-05-23 09:00:01')),
    ).toBe(false);
  });

  it('leer ist nur leer gleich', () => {
    expect(gleicherZeitpunkt(null, null)).toBe(true);
    expect(gleicherZeitpunkt(null, wireZuPicker('2026-05-23 09:00:00'))).toBe(false);
    expect(gleicherZeitpunkt(wireZuPicker('2026-05-23 09:00:00'), null)).toBe(false);
  });
});

describe('EinsatzdatenPage', () => {
  it('LFH-463: zeigt den Besprechungstermin lokal und speichert denselben UTC-Instant', async () => {
    let patchBody: Record<string, unknown> = {};
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
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(patchBody.naechste_lagebesprechung_at).toBe('2026-09-09 13:17:43'));
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

  it('zeigt die Alarmzeit im Picker lokal und schickt sie unverändert als UTC zurück', async () => {
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

    // Unverändert gespeichert muss exakt derselbe UTC-Wirestring zurückgehen: die
    // Runde Wire→Picker→Wire darf den Instant nicht verschieben.
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(patchBody.begonnen_at).toBe('2026-05-23 09:00:00'));
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
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(patchBody.einsatzort_lat).toBeCloseTo(48.1234, 4));
    expect(patchBody.einsatzort_lon).toBeCloseTo(11.5678, 4);
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
        expect(body.bezeichnung).toBe('Geändert');
        expect(body.einsatzart).toBe('realeinsatz');
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

    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(patchBody).not.toBeNull());
    // Abwesenheit des Schlüssels, nicht bloß `null`: auch `null` ist beim Server 400.
    expect(patchBody).not.toHaveProperty('einsatznummer_intern');
    expect(patchBody).toHaveProperty('leitstellen_nr', 'LS-1');
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

  it('Alarmzeit inline: gesendet wird der gewählte absolute Zeitpunkt, beidseits der Sommerzeit-Umstellungen', async () => {
    /*
     * Eingetippt wird die LOKALE Wanduhrzeit des Instants, erwartet der UTC-Wirestring desselben
     * Instants. Unter TZ=UTC wäre das trivial grün; scharf ist es unter TZ=Europe/Berlin
     * (`check-all.sh`). Die Instants liegen je eine Stunde vor und nach beiden Umstellungen 2026
     * und meiden die doppelte Stunde im Oktober, die als Wanduhrzeit mehrdeutig ist.
     */
    for (const wire of [
      '2026-03-29 00:30:00',
      '2026-03-29 01:30:00',
      '2026-10-24 23:30:00',
      '2026-10-25 02:30:00',
    ]) {
      const { unmount } = setup();
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
      unmount();
    }
  });

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
    for (const name of ['Koordinate', 'Einsatzleitung', 'Einsatznummer', 'Angelegt am (techn.)']) {
      expect(
        screen.queryByRole('button', {
          name: new RegExp(`^${name.replace(/[.()]/g, '\\$&')} (bearbeiten|eintragen)$`),
        }),
      ).toBeNull();
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
