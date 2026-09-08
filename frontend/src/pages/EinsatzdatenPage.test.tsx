import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import type { BenutzerAnzeige, EinsatzAnzeige } from '../api/types';
import EinsatzdatenPage, { pickerZuWire, wireZuPicker } from './EinsatzdatenPage';

dayjs.extend(utc);

const admin: BenutzerAnzeige = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00', totp_aktiviert: false,
};

const basisEinsatz: EinsatzAnzeige = {
  id: 7, bezeichnung: 'Hochwasser Nord', stichwort: 'H1', status: 'aktiv',
  begonnen_at: '2026-05-23 09:00:00', abgeschlossen_at: null, abgeschlossen_von: null,
  einsatzart: 'realeinsatz', einsatznummer_intern: '2026-001', angelegt_at: '2026-05-23 09:00:05',
  leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null,
  meldende_stelle: null, sachverhalt: null, anzahl_betroffene_initial: null,
  meine_rolle: 'einsatzleitung',
  org_id: 1, org_name: 'DRK Musterstadt',
};

const mitglieder = [
  { benutzer_id: 1, anzeigename: 'Admin', benutzername: 'admin', einsatz_rolle: 'einsatzleitung', zugewiesen_at: '2026-05-23 09:00:00' },
  { benutzer_id: 2, anzeigename: 'Frank Führung', benutzername: 'frank', einsatz_rolle: 'fuehrungspersonal', zugewiesen_at: '2026-05-23 09:05:00' },
];

const vorschlaege = [{ id: 1, text: 'H1' }, { id: 2, text: 'MANV' }];

interface SetupOpts {
  einsatz?: Partial<EinsatzAnzeige>;
  benutzer?: BenutzerAnzeige;
}

function setup(opts: SetupOpts = {}) {
  const einsatz = { ...basisEinsatz, ...opts.einsatz };
  const benutzer = opts.benutzer ?? admin;
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    http.get('/api/einsaetze/7/mitglieder', () => HttpResponse.json(mitglieder)),
    http.get('/api/benutzer', () => HttpResponse.json([])),
    http.get('/api/stichwort-vorschlaege', () => HttpResponse.json(vorschlaege)),
    http.get('/api/einsaetze/:id/ort-vorschau', () => HttpResponse.json({ peilung: null, ortsname: null })),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/einsatzdaten" element={<EinsatzdatenPage />} />
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/7/einsatzdaten' },
  );
}

describe('Führungsstellen-Berechtigung', () => {
  it.each([null, 'beobachter', 'fuehrungspersonal'] as const)('LFH-461 Review: System-Admin mit Einsatzrolle %s darf keine Führungsstelle bearbeiten', async (meine_rolle) => {
    setup({ einsatz: { meine_rolle } });
    await screen.findByText('Frank Führung');
    expect(screen.queryAllByRole('button', { name: /Führungsstelle für/ })).toHaveLength(0);
  });

  it('LFH-461 Review: aktive Einsatzleitung darf die Führungsstelle bearbeiten', async () => {
    setup({ benutzer: { ...admin, system_rolle: 'keiner' } });
    expect(await screen.findByRole('button', { name: 'Führungsstelle für Frank Führung bearbeiten' })).toBeInTheDocument();
  });

});

describe('Alarmzeit-Wandlung (Wire ↔ Picker)', () => {
  it('liest den Wirestring als UTC — geprüft am absoluten Instant, nicht an der Wanduhrzeit', () => {
    // Die Assertion prüft den INSTANT, nicht das Format: `Date.UTC(...)` ist in jeder
    // Zeitzone derselbe Zeitpunkt. Die frühere Fassung (`dayjs(wire)`) parst den naiven
    // Wirestring als LOKALE Zeit und landet damit auf einem anderen Instant — in
    // Europe/Berlin um 2 h daneben. Eine Prüfung auf die Form 'YYYY-MM-DD HH:mm:ss'
    // wäre hier wertlos, sie ist in jeder Zeitzone grün.
    //
    // Bleibt eine unvermeidbare Grenze: unter TZ=UTC sind beide Lesarten derselbe
    // Instant, der Test also trivial grün. Gegengeprüft wird deshalb unter
    // TZ=Europe/Berlin (dort ist er scharf) — dieselbe Einschränkung, die
    // `ErinnerungFormular.test.tsx` für die Gegenrichtung dokumentiert.
    expect(wireZuPicker('2026-05-23 09:00:00').valueOf()).toBe(Date.UTC(2026, 4, 23, 9, 0, 0));
  });

  it('hält den Picker in lokaler Zeit — dieselbe Wanduhrzeit, die ZeitAnzeige daneben rendert', () => {
    // `ZeitAnzeige`/`format.ts:inZone` rendert ohne konfigurierte Zone `dayjs.utc(x).local()`.
    // Der Picker muss dieselbe Wanduhrzeit zeigen, sonst steht im Bearbeiten-Modus eine
    // andere Uhrzeit als in der Descriptions-Zelle direkt daneben — der gemeldete Fehler.
    expect(wireZuPicker('2026-05-23 09:00:00').format('YYYY-MM-DD HH:mm:ss')).toBe(
      dayjs.utc('2026-05-23 09:00:00').local().format('YYYY-MM-DD HH:mm:ss'),
    );
  });

  it('normalisiert die lokale Picker-Zeit zurück auf den UTC-Wirestring', () => {
    // Fester Instant 09:00 UTC, als Dayjs im Lokal-Modus übergeben — so liefert ihn der
    // antd-DatePicker. Ohne `.utc()` im Helfer formatiert `.format()` die lokale
    // Wanduhrzeit und der Test fällt auf jeder Nicht-UTC-Maschine; der local→UTC-Shift
    // wird also echt exerziert statt durch UTC-Eingabe zum No-op zu werden.
    const lokal = dayjs.utc('2026-05-23 09:00:00').local();
    expect(pickerZuWire(lokal)).toBe('2026-05-23 09:00:00');
  });
});

describe('EinsatzdatenPage', () => {
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
    // Die Einsatznummer ist seit der Gliederung (M14) eine TECHNISCHE Angabe und steht im
    // eingeklappten Abschnitt. Ohne `forceRender` ist sie gar nicht im Baum — die
    // Gegenaussage steht deshalb hier, das Aufklappen im Gliederungs-Block weiter unten.
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
        return HttpResponse.json({ ...basisEinsatz, einsatzort_lat: 48.1234, einsatzort_lon: 11.5678 });
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
    setup({ einsatz: { meine_rolle: 'beobachter' }, benutzer: { ...admin, system_rolle: 'keiner' } });
    await screen.findByText('Realeinsatz');
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });

  it('versteckt den Bearbeiten-Button bei abgeschlossenem Einsatz', async () => {
    setup({ einsatz: { status: 'abgeschlossen', abgeschlossen_at: '2026-05-24 10:00:00' } });
    await screen.findByText('Realeinsatz');
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });

  it('speichert via PATCH und invalidiert den Einsatz-Cache', async () => {
    // Den PATCH-Body direkt im Handler prüfen und den Aufruf über ein Boolean
    // signalisieren — so umgehen wir die TS-Control-Flow-Eigenheit, dass eine
    // in einer Closure zugewiesene Variable außerhalb nicht eng typisiert wird.
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
    setup({ einsatz: { meine_rolle: 'beobachter' }, benutzer: { ...admin, system_rolle: 'keiner' } });
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
    // benutzer ohne System-Admin: sonst gewährt der admin-globale Zweig (LFH-234) die
    // Leitungs-/Verwaltungsrechte auch dem Führungspersonal-Konto. Hier zählt die Einsatz-Rolle.
    setup({ einsatz: { meine_rolle: 'fuehrungspersonal' }, benutzer: { ...admin, system_rolle: 'keiner' } });
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
 * Persistenter Speicherfehler (LFH-345 · C10, Befund H14).
 *
 * ── Warum hier KEIN Fake-Timer-Vorlauf steht ────────────────────────────────────
 * Das AK verlangt ihn, aber er belegt an dieser Stelle nichts: nach dem Klick läuft antds
 * Message-Timer bereits mit echten Timern, ein danach aktivierter Fake-Timer erreicht ihn
 * nicht mehr — der Test wäre grün gewesen, bevor es Produktivcode gab (gemessen 24.08.2026,
 * ausführlich in `einstellungen/EinsatzDefaults.test.tsx`). Und ihn VOR dem Rendern zu
 * setzen geht hier nicht: diese Seite lädt über MSW, dessen Antwortweg unter Fake-Timern
 * hängen bliebe. Bleibt die stärkere Aussage — die Meldung steht in der Seite, nicht in
 * antds Message-Container. Genau die dreht ein zurückgebautes `message.error` wieder um.
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

  // Die zweite Haelfte: ein Alert, der NIE geht, ist so falsch wie einer, der zu frueh geht.
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
 * Gliederung der Leseansicht (LFH-345 · C10, Befund M14).
 *
 * Die drei Aussagen sind die drei Hälften des Befunds: der Status stand als ROHER
 * Wire-Wert im Titel-Tag, die zwölf Zeilen standen als Datenwand ohne Gewichtung
 * nebeneinander, und der Wechsel in den Bearbeiten-Modus ließ den Fokus auf dem
 * gerade verschwundenen Knopf zurück.
 */
describe('EinsatzdatenPage · Gliederung (LFH-345, M14)', () => {
  it('zeigt den Status als Wort, nicht als Wire-Wert', async () => {
    setup({ einsatz: { status: 'abgeschlossen', abgeschlossen_at: '2026-05-24 10:00:00' } });
    const tag = await screen.findByText('Abgeschlossen');
    expect(screen.queryByText('abgeschlossen')).toBeNull();

    // Die zweite, unterscheidende Hälfte: ein lokales `status[0].toUpperCase()` erfüllte
    // das Paar oben vollständig. Erst `data-rolle` belegt, dass der Wert durch
    // `EINSATZ_STATUS` und `StatusTag` gelaufen ist — und damit über die Rollenachse des
    // Statusfarb-Vertrags statt über eine erfundene Farbe.
    expect(tag.closest('[data-rolle]')).toHaveAttribute('data-rolle', 'neutral');
  });

  it('hält die technischen Angaben eingeklappt, die Kopfangaben aber sichtbar', async () => {
    // `basisEinsatz` trägt für beide Felder `null` — ohne diese Werte prüfte der Test
    // gegen zwei Gedankenstriche und wäre über den Umbau hinweg blind.
    setup({ einsatz: { einsatzort: 'Musterstraße 1', leitstellen_nr: 'LS-4711' } });
    expect(await screen.findByText('Musterstraße 1')).toBeInTheDocument();
    expect(screen.queryByText('LS-4711')).toBeNull();

    await userEvent.click(screen.getByText('Technische Angaben'));
    expect(await screen.findByText('LS-4711')).toBeInTheDocument();
  });

  it('setzt den Fokus beim Bearbeiten aufs erste Feld', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    expect(screen.getByLabelText('Bezeichnung')).toHaveFocus();
  });
});
