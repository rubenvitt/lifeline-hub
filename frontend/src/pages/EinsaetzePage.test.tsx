import { http, HttpResponse } from 'msw';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import dayjs from 'dayjs';
import { Route, Routes } from 'react-router';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { mitProzessZone } from '../test/prozessZone';
import { mitVorgehenderGeraeteuhr } from '../test/vorgehendeUhr';
import { formatZeitKurz, DEFAULT_KONVENTIONEN } from '../anzeige/format';
import type { BenutzerAnzeige, EinsatzAnzeige } from '../api/types';
import { globalKeys } from '../api/queryKeys';
import EinsaetzePage, { kartenTitelStil } from './EinsaetzePage';
import { dichten } from '../theme/tokens';
import { adminFixture } from '../test/fixtures';

const admin = adminFixture();

// MapLibre läuft in jsdom nicht; der Ausschnitt hat eigene Tests (`anzeige/Kartenausschnitt.test.tsx`).
vi.mock('../anzeige/Kartenausschnitt', () => ({
  Kartenausschnitt: ({ punkt }: { punkt: { lat: number; lon: number } | null }) => (
    <div data-testid="kartenausschnitt">
      {punkt ? `Karte ${punkt.lat}, ${punkt.lon}` : 'Nicht verortet'}
    </div>
  ),
}));

function einsatz(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 7,
    bezeichnung: 'Hochwasser Nord',
    stichwort: 'THW',
    status: 'aktiv',
    begonnen_at: '2026-05-23 09:00:00',
    abgeschlossen_at: null,
    abgeschlossen_von: null,
    meine_rolle: 'einsatzleitung',
    ...over,
  };
}

// `renderMitProviders` rendert den `AuthProvider` selbst — ein zweiter wäre ein doppelter
// `/api/auth/me`-Abruf.
function setup() {
  server.use(meHandler(admin));
  return renderMitProviders(<EinsaetzePage />);
}

describe('EinsaetzePage', () => {
  it('listet Einsätze mit Bezeichnung und eigener Rolle', async () => {
    server.use(http.get('/api/einsaetze', () => HttpResponse.json([einsatz()])));
    setup();
    await waitFor(() => expect(screen.getByText('Hochwasser Nord')).toBeInTheDocument());
    expect(screen.getByText('Deine Rolle: Einsatzleitung')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Datenstand \d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it('öffnet den neuen Einsatz direkt nach dem Anlegen', async () => {
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze', () => HttpResponse.json([])),
      http.post('/api/einsaetze', () =>
        HttpResponse.json(einsatz({ bezeichnung: 'Sturm Süd' }), { status: 201 }),
      ),
    );
    renderMitProviders(
      <Routes>
        <Route path="/" element={<EinsaetzePage />} />
        <Route path="/einsaetze/:id" element={<div>Workspace-7</div>} />
      </Routes>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Neuer Einsatz' }));
    await userEvent.type(screen.getByLabelText('Bezeichnung'), 'Sturm Süd');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(screen.getByText('Workspace-7')).toBeInTheDocument());
  });

  it('erfasst Einsatzart und Alarmzeit gleich mit — vorbelegt und ohne Zutun', async () => {
    // Der Dialog schickt die beiden Felder selbst. Geprüft wird der Rumpf, nicht die Anzeige: ein
    // Dialog, der die Felder zeigt und nicht sendet, sähe im DOM genauso aus.
    let rumpf: Record<string, unknown> | null = null;
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze', () => HttpResponse.json([])),
      http.post('/api/einsaetze', async ({ request }) => {
        rumpf = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(einsatz({ bezeichnung: 'Sturm Süd' }), { status: 201 });
      }),
    );
    renderMitProviders(
      <Routes>
        <Route path="/" element={<EinsaetzePage />} />
        <Route path="/einsaetze/:id" element={<div>Workspace-7</div>} />
      </Routes>,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Neuer Einsatz' }));
    await userEvent.type(screen.getByLabelText('Bezeichnung'), 'Sturm Süd');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));

    await waitFor(() => expect(rumpf).not.toBeNull());
    expect(rumpf!.einsatzart).toBe('realeinsatz');
    // Die Form allein beweist nichts, sie ist in jeder Zeitzone erfüllt. Geprüft wird der Wert
    // gegen UTC: die Alarmzeit ist eine Vorbelegung auf „jetzt" und weicht höchstens eine Minute
    // von der UTC-Zeit ab. Mit `.format()` statt `.utc().format()` schlägt das überall fehl, wo der
    // Zonenversatz ≠ 0 ist.
    expect(rumpf!.begonnen_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    const gesendet = dayjs.utc(rumpf!.begonnen_at as string, 'YYYY-MM-DD HH:mm:ss');
    expect(Math.abs(gesendet.diff(dayjs.utc(), 'minute'))).toBeLessThanOrEqual(1);
  });

  it('führt fünf Felder — der Einsatzort ist das optionale fünfte (LFH-1175)', async () => {
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze', () => HttpResponse.json([])),
    );
    renderMitProviders(<EinsaetzePage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Neuer Einsatz' }));
    const dialog = await screen.findByRole('dialog');

    for (const feld of ['Bezeichnung', 'Stichwort', 'Einsatzart', 'Alarmzeit', 'Einsatzort']) {
      expect(screen.getByLabelText(feld)).toBeInTheDocument();
    }
    expect(dialog.querySelectorAll('.ant-form-item').length).toBe(5);
    // Der Ausschnitt erscheint erst nach der Wahl eines Treffers.
    expect(screen.queryByTestId('kartenausschnitt')).toBeNull();
  });

  it('nennt das Schichtmodell der Organisation als Zeile, nicht als Feld (LLH-1122)', async () => {
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze', () => HttpResponse.json([])),
      http.get('/api/schichtmodelle', () =>
        HttpResponse.json([
          {
            id: 1,
            bezeichnung: '12-h-Schicht',
            typ: 'rhythmus',
            rhythmus_minuten: 720,
            vorwarnung_minuten: 30,
            planungsvorlauf_minuten: 120,
            ist_vorgabe: true,
            ist_demo: false,
          },
        ]),
      ),
    );
    renderMitProviders(<EinsaetzePage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Neuer Einsatz' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText('Schichtmodell: 12-h-Schicht (Vorgabe)'),
    ).toBeInTheDocument();
    // Feldbudget (LFH-1175): weiter fünf Felder.
    expect(dialog.querySelectorAll('.ant-form-item').length).toBe(5);
  });

  it('ohne Vorgabe der Organisation keine Schichtmodell-Zeile (LLH-1122)', async () => {
    let beantwortet = false;
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze', () => HttpResponse.json([])),
      http.get('/api/schichtmodelle', () => {
        beantwortet = true;
        return HttpResponse.json([
          {
            id: 2,
            bezeichnung: 'Demo-Schicht',
            typ: 'rhythmus',
            rhythmus_minuten: 720,
            vorwarnung_minuten: 30,
            planungsvorlauf_minuten: 120,
            ist_vorgabe: false,
            ist_demo: true,
          },
        ]);
      }),
    );
    renderMitProviders(<EinsaetzePage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Neuer Einsatz' }));
    const dialog = await screen.findByRole('dialog');
    // Erst nach der Antwort ist die Abwesenheit eine Aussage.
    await waitFor(() => expect(beantwortet).toBe(true));
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(within(dialog).queryByText(/Schichtmodell/)).toBeNull();
  });

  it('setzt den Fokus beim Öffnen ins erste Feld und sendet per Enter', async () => {
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze', () => HttpResponse.json([])),
      http.post('/api/einsaetze', () =>
        HttpResponse.json(einsatz({ bezeichnung: 'Sturm Süd' }), { status: 201 }),
      ),
    );
    renderMitProviders(
      <Routes>
        <Route path="/" element={<EinsaetzePage />} />
        <Route path="/einsaetze/:id" element={<div>Workspace-7</div>} />
      </Routes>,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Neuer Einsatz' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Bezeichnung')));
    await userEvent.type(screen.getByLabelText('Bezeichnung'), 'Sturm Süd{Enter}');

    await waitFor(() => expect(screen.getByText('Workspace-7')).toBeInTheDocument());
  });

  it('zeigt den Anlege-Button nicht für Nutzer ohne Recht', async () => {
    const ohneRecht = adminFixture({ system_rolle: 'keiner' });
    server.use(
      meHandler(ohneRecht),
      http.get('/api/einsaetze', () => HttpResponse.json([einsatz()])),
    );
    renderMitProviders(<EinsaetzePage />);
    await waitFor(() => expect(screen.getByText('Hochwasser Nord')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Neuer Einsatz' })).not.toBeInTheDocument();
  });

  it('trennt aktive und abgeschlossene Einsätze in eigene Sektionen', async () => {
    server.use(
      http.get('/api/einsaetze', () =>
        HttpResponse.json([
          einsatz(),
          einsatz({
            id: 8,
            bezeichnung: 'Sturmtief Abschluss',
            status: 'abgeschlossen',
            abgeschlossen_at: '2026-05-24 10:00:00',
          }),
        ]),
      ),
    );
    setup();
    await waitFor(() => expect(screen.getByText('Hochwasser Nord')).toBeInTheDocument());
    // Über die Überschrift gegriffen: das Status-Etikett der Karte trägt dieselbe Beschriftung,
    // `getByText` fände zwei Knoten. Es geht um die Sektion.
    expect(screen.getByRole('heading', { name: 'Abgeschlossen' })).toBeInTheDocument();
    expect(screen.getByText('Sturmtief Abschluss')).toBeInTheDocument();
  });

  it('oeffnet beim Klick auf eine Kachel den Workspace unter /einsaetze/:id', async () => {
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze', () => HttpResponse.json([einsatz()])),
    );
    renderMitProviders(
      <Routes>
        <Route path="/" element={<EinsaetzePage />} />
        <Route path="/einsaetze/:id" element={<div>Workspace-7</div>} />
      </Routes>,
    );
    await userEvent.click(await screen.findByText('Hochwasser Nord'));
    await waitFor(() => expect(screen.getByText('Workspace-7')).toBeInTheDocument());
  });

  it('macht jede geladene Einsatzkarte per Titel-Link erreichbar und navigiert per Enter', async () => {
    const user = userEvent.setup();
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze', () =>
        HttpResponse.json([
          einsatz(),
          einsatz({ id: 8, bezeichnung: 'Sturmtief Abschluss', status: 'abgeschlossen' }),
        ]),
      ),
      http.get('/api/stichwort-vorschlaege', () => HttpResponse.json([])),
    );
    renderMitProviders(
      <Routes>
        <Route path="/" element={<EinsaetzePage />} />
        <Route path="/einsaetze/:id" element={<div>Workspace</div>} />
      </Routes>,
    );

    const titelLinks = await screen.findAllByRole('link', {
      name: /^(Hochwasser Nord|Sturmtief Abschluss)$/,
    });
    expect(titelLinks).toHaveLength(2);
    expect(titelLinks[0]).toHaveAttribute('href', '/einsaetze/7');
    expect(titelLinks[1]).toHaveAttribute('href', '/einsaetze/8');

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Neuer Einsatz' }));
    await user.tab();
    expect(document.activeElement).toBe(titelLinks[0]);
    await user.tab();
    expect(document.activeElement).toBe(titelLinks[1]);
    await user.keyboard('{Enter}');

    expect(await screen.findByText('Workspace')).toBeInTheDocument();
  });

  it('lässt Modifier-Klicks auf den Einsatz-Titel browsernativ und ohne Karten-Navigation', async () => {
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze', () => HttpResponse.json([einsatz()])),
      http.get('/api/stichwort-vorschlaege', () => HttpResponse.json([])),
    );
    renderMitProviders(
      <Routes>
        <Route path="/" element={<EinsaetzePage />} />
        <Route path="/einsaetze/:id" element={<div>Workspace-7</div>} />
      </Routes>,
    );

    const link = await screen.findByRole('link', { name: 'Hochwasser Nord' });
    const modifierKlick = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
    });
    fireEvent(link, modifierKlick);

    expect(modifierKlick.defaultPrevented).toBe(false);
    expect(screen.queryByText('Workspace-7')).not.toBeInTheDocument();
  });

  // ── Die drei Datenzustände ── Sie müssen unterscheidbar gerendert sein: ein Serverfehler darf
  // nicht aussehen wie „noch keine Daten".

  it('zeigt beim Laden Karten-Skelette im Raster und noch keinen Anlegen-Knopf', async () => {
    // Die Antwort wartet, bis der Ladezustand geprüft ist: eine feste Verzögerung lief unter Last
    // ab, bevor die Prüfung dran war.
    let antworten!: () => void;
    const freigabe = new Promise<void>((r) => (antworten = r));
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze', async () => {
        await freigabe;
        return HttpResponse.json([einsatz()]);
      }),
    );
    renderMitProviders(<EinsaetzePage />);

    // Die Skelett-Kacheln liegen im selben Rasterknoten, der danach die Karten trägt. jsdom rechnet
    // kein Layout — gleiche Kachelhöhe ist hier nicht messbar, nur die gemeinsame Herkunft.
    const raster = await screen.findByTestId('einsaetze-raster');
    await waitFor(() =>
      expect(raster.querySelectorAll('.lfh-skelett__balken').length).toBeGreaterThan(0),
    );
    expect(screen.queryByRole('button', { name: /Neuer Einsatz/ })).toBeNull();
    antworten();

    // Erst nach dem Laden erscheint er — oben hat also der Ladezustand ihn verborgen, nicht ein
    // fehlendes Recht.
    expect(await screen.findByRole('button', { name: 'Neuer Einsatz' })).toBeInTheDocument();
    expect(screen.getByTestId('einsaetze-raster').querySelector('.lfh-skelett__balken')).toBeNull();
  });

  it('zeigt bei einem Fehler eine Meldung, deren Wiederholen-Aktion neu abruft', async () => {
    let abrufe = 0;
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze', () => {
        abrufe += 1;
        return abrufe === 1
          ? HttpResponse.json({ error: 'Serverfehler' }, { status: 500 })
          : HttpResponse.json([einsatz()]);
      }),
    );
    renderMitProviders(<EinsaetzePage />);

    const meldung = await screen.findByRole('alert');
    expect(meldung).toHaveTextContent(/Einsatzliste/i);

    // Der erneute Abruf wird über den Handler-Zähler belegt, nicht über einen Spy: nur so ist ein
    // echter Request bewiesen.
    await userEvent.click(screen.getByRole('button', { name: 'Erneut abrufen' }));

    expect(await screen.findByText('Hochwasser Nord')).toBeInTheDocument();
    expect(abrufe).toBe(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('zeigt bei leerer Liste den Leer-Zustand — auch für Anlegeberechtigte', async () => {
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze', () => HttpResponse.json([])),
    );
    const { container } = renderMitProviders(<EinsaetzePage />);

    // „leer" und „darf anlegen" schließen sich nicht aus: auch Anlegeberechtigte sehen den
    // Leerzustand.
    expect(await screen.findByText('Keine Einsätze')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Neuer Einsatz' })).toBeInTheDocument();
    // Getauscht ist der Knoten, nicht der Wortlaut — die Textzeile darüber belegt allein nichts.
    // Der Leerknoten trägt keine eigene Aktion: die Anlegen-Kachel steht darunter, ein zweiter
    // „Neuer Einsatz"-Knopf machte die Abfrage mehrdeutig.
    expect(container.querySelector('.ant-empty')).toBeNull();
  });
});

describe('Einsatzkarte — Lagebild statt vier Felder (LFH-336 · M4/M5)', () => {
  // Eigene Fixture/Hilfen statt `einsatz()`/`setup()`: die decken weder
  // `einsatzort`/`org_id`/`org_name`/`angelegt_at` noch das `/api/stichwort-vorschlaege`-Mock ab,
  // das der Anlegedialog bei jedem Mount abruft (`onUnhandledRequest: 'error'`).
  function mockEinsaetze(liste: EinsatzAnzeige[]) {
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze', () => HttpResponse.json(liste)),
      http.get('/api/stichwort-vorschlaege', () => HttpResponse.json([])),
    );
  }
  function render() {
    return renderMitProviders(<EinsaetzePage />);
  }

  const e = (over: Partial<EinsatzAnzeige>): EinsatzAnzeige =>
    ({
      id: 1,
      bezeichnung: 'Hochwasser Musterstadt',
      stichwort: 'TH Hochwasser',
      status: 'aktiv',
      einsatzart: 'realeinsatz',
      begonnen_at: '2026-06-08 06:12:00',
      angelegt_at: '2026-06-08 06:12:00',
      einsatzort: 'Musterstadt, Deichweg 3',
      org_id: 1,
      org_name: 'THW Musterstadt',
      meine_rolle: 'einsatzleitung',
      ...over,
    }) as EinsatzAnzeige;

  it('die Karte nennt den Einsatzort', async () => {
    mockEinsaetze([e({ einsatzort: 'Musterstadt, Deichweg 3' })]);
    render();
    expect(await screen.findByText(/Musterstadt, Deichweg 3/)).toBeInTheDocument();
    // Positiv gegen den Testid, nicht nur gegen den Text: die negative Prüfung weiter unten wäre
    // sonst immer grün, auch wenn `data-testid="einsatz-ort"` nie im DOM ankäme.
    expect(screen.getByTestId('einsatz-ort')).toHaveTextContent('Musterstadt, Deichweg 3');
  });

  it('die Karte nennt einen aus begonnen_at abgeleiteten Zeitstand', async () => {
    mockEinsaetze([e({ begonnen_at: '2026-06-08 06:12:00' })]);
    render();
    // `formatZeitKurz` liefert je nach Tagesbezug verschiedene Formen; geprüft wird das Wort „seit"
    // plus der Funktionswert — die Formatierung prüft `format.test.ts`.
    const erwartet = formatZeitKurz('2026-06-08 06:12:00', DEFAULT_KONVENTIONEN);
    expect(await screen.findByText(new RegExp(`seit ${erwartet}`))).toBeInTheDocument();
  });

  it('die Karte trägt die Einsatzart als zweiten Tag neben dem Status', async () => {
    mockEinsaetze([e({ einsatzart: 'uebung' })]);
    render();
    // Die Map trägt eine Beschriftung statt des Wire-Werts (Vertrag in `theme/statusFarben.ts`).
    expect(await screen.findByText('Aktiv')).toBeInTheDocument();
    expect(screen.getByText('Übung')).toBeInTheDocument();
  });

  it('die Karte nennt die eigene Rolle in Klartext und mit Kontext, nie den Rohwert', async () => {
    mockEinsaetze([e({ meine_rolle: 'fuehrungspersonal' })]);
    const { container } = render();
    expect(await screen.findByText('Deine Rolle: Führungspersonal')).toBeInTheDocument();
    expect(container).not.toHaveTextContent('fuehrungspersonal');
  });

  it('ohne Einsatzort bleibt die Ortszeile ganz weg statt leer zu stehen', async () => {
    mockEinsaetze([e({ einsatzort: null })]);
    render();
    await screen.findByText('Hochwasser Musterstadt');
    expect(screen.queryByTestId('einsatz-ort')).not.toBeInTheDocument();
  });

  it('aktive Einsätze stehen nach Beginn absteigend — der jüngste zuerst', async () => {
    mockEinsaetze([
      e({ id: 1, bezeichnung: 'Alt', begonnen_at: '2026-06-01 08:00:00' }),
      e({ id: 2, bezeichnung: 'Neu', begonnen_at: '2026-06-09 08:00:00' }),
    ]);
    render();
    await screen.findByText('Alt');
    const karten = screen.getAllByRole('link', { name: /Alt|Neu/ });
    expect(karten[0]).toHaveTextContent('Neu');
  });

  it('bei 9 aktiven Einsätzen erscheint das Suchfeld', async () => {
    mockEinsaetze(
      Array.from({ length: 9 }, (_, i) => e({ id: i + 1, bezeichnung: `Einsatz ${i + 1}` })),
    );
    render();
    expect(
      await screen.findByRole('searchbox', { name: /Einsätze durchsuchen/ }),
    ).toBeInTheDocument();
  });

  it('bei 3 aktiven Einsätzen erscheint kein Suchfeld', async () => {
    mockEinsaetze(
      Array.from({ length: 3 }, (_, i) => e({ id: i + 1, bezeichnung: `Einsatz ${i + 1}` })),
    );
    render();
    await screen.findByText('Einsatz 1');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('die Suche filtert über Bezeichnung, Ort und Stichwort', async () => {
    const nutzer = userEvent.setup();
    // Je ein Fall pro Feld mit eindeutigem Treffer, damit jedes Suchfeld für sich belegt ist.
    mockEinsaetze([
      e({ id: 1, bezeichnung: 'Hochwasser Nordkreuz', einsatzort: 'Sonstwo', stichwort: 'THW' }),
      e({ id: 2, bezeichnung: 'Einsatz Zwei', einsatzort: 'Deichweg 7', stichwort: 'THW' }),
      e({ id: 3, bezeichnung: 'Einsatz Drei', einsatzort: 'Sonstwo', stichwort: 'MANV' }),
      ...Array.from({ length: 6 }, (_, i) =>
        e({ id: i + 4, bezeichnung: `Einsatz ${i + 4}`, einsatzort: 'Sonstwo', stichwort: 'THW' }),
      ),
    ]);
    render();
    const feld = await screen.findByRole('searchbox', { name: /Einsätze durchsuchen/ });

    // Treffer über die BEZEICHNUNG.
    await nutzer.type(feld, 'Nordkreuz');
    expect(screen.getByText('Hochwasser Nordkreuz')).toBeInTheDocument();
    expect(screen.queryByText('Einsatz Zwei')).not.toBeInTheDocument();
    expect(screen.queryByText('Einsatz Drei')).not.toBeInTheDocument();

    // Treffer über den ORT.
    await nutzer.clear(feld);
    await nutzer.type(feld, 'Deichweg');
    expect(screen.getByText('Einsatz Zwei')).toBeInTheDocument();
    expect(screen.queryByText('Hochwasser Nordkreuz')).not.toBeInTheDocument();
    expect(screen.queryByText('Einsatz Drei')).not.toBeInTheDocument();

    // Treffer über das STICHWORT.
    await nutzer.clear(feld);
    await nutzer.type(feld, 'MANV');
    expect(screen.getByText('Einsatz Drei')).toBeInTheDocument();
    expect(screen.queryByText('Hochwasser Nordkreuz')).not.toBeInTheDocument();
    expect(screen.queryByText('Einsatz Zwei')).not.toBeInTheDocument();
  });

  it('bei leergefilterter Suche erscheint ein Hinweis, der den Suchbegriff nennt', async () => {
    // Die Suche kann alle aktiven Einsätze wegfiltern; dann braucht es einen eigenen Leerzustand,
    // nicht eine stumme Fläche.
    const nutzer = userEvent.setup();
    mockEinsaetze(
      Array.from({ length: 9 }, (_, i) => e({ id: i + 1, bezeichnung: `Einsatz ${i + 1}` })),
    );
    render();
    const feld = await screen.findByRole('searchbox', { name: /Einsätze durchsuchen/ });
    await nutzer.type(feld, 'kein-treffer-xyz');
    expect(await screen.findByText(/Keine Treffer/)).toBeInTheDocument();
    expect(screen.getByText(/kein-treffer-xyz/)).toBeInTheDocument();
    // Unterscheidbar vom „gar keine Einsätze"-Zustand — Einsätze sind vorhanden, nur weggefiltert.
    expect(screen.queryByText('Keine Einsätze')).not.toBeInTheDocument();
  });

  it('bei mindestens einem Treffer erscheint kein „Keine Treffer"-Hinweis', async () => {
    const nutzer = userEvent.setup();
    mockEinsaetze(
      Array.from({ length: 9 }, (_, i) => e({ id: i + 1, bezeichnung: `Einsatz ${i + 1}` })),
    );
    render();
    const feld = await screen.findByRole('searchbox', { name: /Einsätze durchsuchen/ });
    await nutzer.type(feld, 'Einsatz 1');
    expect(screen.getByText('Einsatz 1')).toBeInTheDocument();
    expect(screen.queryByText(/Keine Treffer/)).not.toBeInTheDocument();
  });

  it('die Suche wirkt nur auf die aktiven Einsätze — Abgeschlossene bleiben unberührt', async () => {
    const nutzer = userEvent.setup();
    mockEinsaetze([
      ...Array.from({ length: 9 }, (_, i) => e({ id: i + 1, bezeichnung: `Einsatz ${i + 1}` })),
      e({ id: 100, bezeichnung: 'Alter Einsatz', status: 'abgeschlossen' }),
    ]);
    render();
    await screen.findByText('Alter Einsatz');
    const feld = await screen.findByRole('searchbox', { name: /Einsätze durchsuchen/ });
    // Der Suchbegriff trifft weder aktiv noch abgeschlossen: die aktive Sektion läuft leer, die
    // abgeschlossene bleibt stehen. Filterte die Suche versehentlich auch sie, verschwände „Alter
    // Einsatz" hier mit.
    await nutzer.type(feld, 'kein-treffer');
    expect(screen.queryByText('Einsatz 1')).not.toBeInTheDocument();
    expect(screen.getByText('Alter Einsatz')).toBeInTheDocument();
  });

  it('fällt die Zahl aktiver Einsätze unter die Schwelle, bleibt kein leeres Raster ohne Ausweg stehen (M6)', async () => {
    // Fällt die Zahl aktiver Einsätze unter SUCHE_AB (etwa durch einen Refetch bei Fensterfokus),
    // während ein nicht passender Suchbegriff im Zustand steht, verschwindet das Feld samt
    // allowClear. Der Filter darf dann nicht weiterwirken, sonst stünde ein leeres Raster ohne
    // Erklärung und ohne Ausweg da.
    const nutzer = userEvent.setup();
    mockEinsaetze(
      Array.from({ length: 9 }, (_, i) => e({ id: i + 1, bezeichnung: `Einsatz ${i + 1}` })),
    );
    const { client } = render();
    const feld = await screen.findByRole('searchbox', { name: /Einsätze durchsuchen/ });
    await nutzer.type(feld, 'kein-treffer-xyz');
    expect(await screen.findByText(/Keine Treffer/)).toBeInTheDocument();
    // Der Nutzer ist woanders: wer im Feld tippt, dem verschwindet es nicht (LLH-1204).
    fireEvent.pointerLeave(document.querySelector('[data-lfh="einsaetze-bereich"]')!, {
      pointerType: 'mouse',
    });
    act(() => feld.blur());

    // Die Liste schrumpft unter SUCHE_AB — der Suchbegriff trifft weiterhin nichts.
    server.use(
      http.get('/api/einsaetze', () =>
        HttpResponse.json(
          Array.from({ length: 3 }, (_, i) => e({ id: i + 1, bezeichnung: `Einsatz ${i + 1}` })),
        ),
      ),
    );
    await client.invalidateQueries({ queryKey: globalKeys.einsaetze() });

    // Kein Suchfeld mehr — trotzdem sind die drei verbliebenen Einsätze sichtbar.
    await waitFor(() => expect(screen.queryByRole('searchbox')).not.toBeInTheDocument());
    expect(await screen.findByText('Einsatz 1')).toBeInTheDocument();
    expect(screen.getByText('Einsatz 2')).toBeInTheDocument();
    expect(screen.getByText('Einsatz 3')).toBeInTheDocument();
    expect(screen.queryByText(/Keine Treffer/)).not.toBeInTheDocument();
  });

  // Der Titel ist ein `<Link>` — ein Umbau auf ein `<div onClick>` flöge hier auf, statt still die
  // Tastaturbedienung zu kosten.
  it('die Tabulatortaste erreicht die Einsatzkarte, Enter navigiert', async () => {
    const nutzer = userEvent.setup();
    mockEinsaetze([e({ id: 7, bezeichnung: 'Hochwasser Musterstadt' })]);
    // Die Zielroute muss mitgerendert werden: `renderMitProviders` fährt einen MemoryRouter,
    // `window.location` bewegt sich dort nie.
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze" element={<EinsaetzePage />} />
        <Route path="/einsaetze/:id" element={<div>EINSATZ-DETAIL</div>} />
      </Routes>,
      { route: '/einsaetze' },
    );
    const karte = await screen.findByRole('link', { name: 'Hochwasser Musterstadt' });
    // Bis zur Karte tabben statt sie zu fokussieren: „per Tastatur erreichbar" ist die Aussage. Vor
    // den Karten liegt bei Anlegerecht der „Neuer Einsatz"-Knopf.
    for (let i = 0; i < 10 && document.activeElement !== karte; i++) await nutzer.tab();
    expect(karte).toHaveFocus();
    await nutzer.keyboard('{Enter}');
    expect(await screen.findByText('EINSATZ-DETAIL')).toBeInTheDocument();
  });

  // Die Kachel ist eine Fläche mit Status-Punkt und Mono-Zeile. Geprüft wird, was sie trägt, nicht
  // die Optik.
  it('zeigt die Einsatznummer in Mono, wenn es eine gibt — und erfindet sonst keine', async () => {
    mockEinsaetze([
      e({ id: 1, bezeichnung: 'Mit Nummer', einsatznummer_intern: 'E-2026-014' }),
      e({ id: 2, bezeichnung: 'Ohne Nummer', einsatznummer_intern: null, leitstellen_nr: null }),
    ]);
    const { container } = render();
    await screen.findByText('Mit Nummer');
    const nummern = container.querySelectorAll<HTMLElement>('[data-lfh="einsatznummer"]');
    expect(nummern).toHaveLength(1);
    expect(nummern[0]).toHaveTextContent('E-2026-014');
    expect(nummern[0].closest('span[style*="JetBrains"]')).not.toBeNull();
  });

  it('der Status-Punkt ist Dekoration, das Wort trägt die Aussage', async () => {
    mockEinsaetze([e({})]);
    const { container } = render();
    await screen.findByText('Hochwasser Musterstadt');
    const punkt = container.querySelector('[data-lfh="status-punkt"]');
    expect(punkt).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Aktiv')).toBeInTheDocument();
  });

  it('abgeschlossene Kacheln sind gedämpft über die Klasse, nicht über Deckkraft', async () => {
    mockEinsaetze([e({ id: 9, bezeichnung: 'Vorbei', status: 'abgeschlossen' })]);
    const { container } = render();
    await screen.findByText('Vorbei');
    const kachel = container.querySelector<HTMLElement>('[data-lfh="einsatzkachel"]')!;
    expect(kachel).toHaveClass('lfh-einsatzkachel--abgeschlossen');
    expect(kachel.style.opacity).toBe('');
  });

  // LLH-1168: der Einsatzleiter der Führungsstelle, nie die App-Rolle (Spec
  // `einsatz-fuehrungsstelle`, „Einsatzleiter in der Einsatzliste“).
  describe('Einsatzleiter', () => {
    const anna = {
      art: 'personal',
      name: 'Anna Schulz',
      personal_id: 17,
      personal_noch_disponiert: true,
      seit: '2026-10-12 12:30:00',
    } as const;
    const zeileVon = async (bezeichnung: string) => {
      const titel = await screen.findByText(bezeichnung);
      const kachel = titel.closest<HTMLElement>('[data-lfh="einsatzkachel"]')!;
      return kachel.querySelector<HTMLElement>('[data-lfh="einsatzleiter"]');
    };

    it('nennt den erfassten Einsatzleiter, aktiv wie abgeschlossen', async () => {
      mockEinsaetze([
        e({ id: 1, bezeichnung: 'Hochwasser', einsatzleiter: anna }),
        e({
          id: 2,
          bezeichnung: 'Vorbei',
          status: 'abgeschlossen',
          einsatzleiter: {
            art: 'extern',
            name: 'KBM Weber',
            personal_noch_disponiert: false,
            seit: anna.seit,
          },
        }),
      ]);
      render();
      expect(await zeileVon('Hochwasser')).toHaveTextContent(/^EL Anna Schulz$/);
      expect(await zeileVon('Vorbei')).toHaveTextContent(/^EL KBM Weber \(extern\)$/);
      expect(screen.getAllByTitle('Einsatzleiter')).toHaveLength(2);
    });

    it('ohne Angabe „nicht erfasst“, nie die eigene App-Rolle', async () => {
      mockEinsaetze([e({ bezeichnung: 'Hochwasser', meine_rolle: 'einsatzleitung' })]);
      render();
      expect(await zeileVon('Hochwasser')).toHaveTextContent(/^EL nicht erfasst$/);
    });

    it('geschwärzt und entlassen wie an der Führungsstelle', async () => {
      mockEinsaetze([
        e({ id: 1, bezeichnung: 'Geschwärzt', einsatzleiter: { ...anna, name: undefined } }),
        e({
          id: 2,
          bezeichnung: 'Entlassen',
          einsatzleiter: { ...anna, personal_noch_disponiert: false },
        }),
      ]);
      render();
      expect(await zeileVon('Geschwärzt')).toHaveTextContent(/^EL Name geschwärzt$/);
      expect(await zeileVon('Entlassen')).toHaveTextContent(
        /^EL Anna Schulz · nicht mehr disponiert$/,
      );
    });
  });

  it('der Seitenkopf nennt beide Mengen in Mono-Meta', async () => {
    mockEinsaetze([e({ id: 1 }), e({ id: 2, bezeichnung: 'Alt', status: 'abgeschlossen' })]);
    render();
    expect(await screen.findByText('1 aktiv · 1 abgeschlossen')).toBeInTheDocument();
  });
});

/**
 * Der Titel-Link der Einsatzkarte ist ein handgebautes Bedienziel auf der Dichte-Staffel (Gate 3):
 * ein nacktes Inline-`<a>` im Kartenkopf ist nur so hoch wie seine Zeile. Die Karte ist klickbar,
 * aber der Link ist das Tastaturziel, und Gate 3 misst jedes fokussierbare Element.
 *
 * Rein und exportiert wie `bedienzielStil` (`pages/lagekarte/Sidebar.tsx`): `test/utils.tsx`
 * rendert ein nacktes `ConfigProvider` ohne unser Theme, und jsdom rechnet kein Layout. Die Pixel
 * misst `e2e/gate3-trefflaeche.spec.ts`; hier steht, dass die Höhe aus dem Token kommt und über die
 * Stufen mitzieht.
 */
describe('Titel-Link der Einsatzkarte — Bedienziel auf der Dichte-Staffel (LFH-396)', () => {
  const tokenFuer = (stufe: keyof typeof dichten) => ({
    controlHeight: dichten[stufe].zeilenhoehe,
    paddingSM: dichten[stufe].abstand.sm,
  });

  // Die Böden als Literale, nicht aus dem Token zurückgelesen — sonst prüfte der Test den Token
  // gegen sich selbst.
  it('trägt den Boden aus controlHeight — 30 / 48 / 72 px', () => {
    expect(kartenTitelStil(tokenFuer('kompakt')).minHeight).toBe(30);
    expect(kartenTitelStil(tokenFuer('komfortabel')).minHeight).toBe(48);
    expect(kartenTitelStil(tokenFuer('handschuh')).minHeight).toBe(72);
  });

  it('wächst über die Dichtestufen, statt auf einer Stufe zu kleben', () => {
    const hoehen = (['kompakt', 'komfortabel', 'handschuh'] as const).map(
      (s) => kartenTitelStil(tokenFuer(s)).minHeight,
    );
    expect(hoehen[0]).toBeLessThan(hoehen[1]);
    expect(hoehen[1]).toBeLessThan(hoehen[2]);
  });

  /**
   * Zwei Angaben, nicht eine. Die Polsterung liegt nur auf der senkrechten Achse: waagerecht
   * polstert der Kartenkopf selbst.
   */
  it('trägt neben der Höhe eine mitziehende senkrechte Polsterung', () => {
    expect(kartenTitelStil(tokenFuer('kompakt')).padding).toBe('7px 0');
    expect(kartenTitelStil(tokenFuer('handschuh')).padding).toBe('16px 0');
  });
});

/**
 * Hinweis auf die Demo-Daten (LFH-690, design.md D13). Jede Abwesenheit steht neben einer
 * Positivprobe und hinter einem Ankerpunkt (Abfrage gelaufen bzw. Liste steht) — sonst wäre sie
 * auch grün, wenn der Hinweis nie gebaut würde.
 */
describe('Demo-Daten-Hinweis (LFH-690)', () => {
  const fuehrungskraft = adminFixture({
    id: 2,
    system_rolle: 'keiner',
    org_rolle: 'fuehrungskraft',
  });

  function demoStatus(antwort: 'aus' | { importiert: boolean }) {
    const zaehler = { get: 0 };
    let stand = antwort;
    server.use(
      http.get('/api/demo-daten', () => {
        zaehler.get += 1;
        return stand === 'aus'
          ? HttpResponse.json({ error: 'Nicht gefunden' }, { status: 404 })
          : HttpResponse.json(stand);
      }),
    );
    return { zaehler, setze: (s: typeof antwort) => (stand = s) };
  }

  function rendern(
    me: BenutzerAnzeige,
    einsaetze: unknown[] = [einsatz()],
    liste?: () => Promise<void>,
  ) {
    server.use(
      meHandler(me),
      http.get('/api/einsaetze', async () => {
        await liste?.();
        return HttpResponse.json(einsaetze);
      }),
    );
    return renderMitProviders(
      <Routes>
        <Route path="/" element={<EinsaetzePage />} />
        <Route path="/admin/demo-daten" element={<div>Ziel: Demo-Daten-Sektion</div>} />
      </Routes>,
    );
  }

  const hinweisLink = () => screen.queryByRole('link', { name: /Demo-Daten/ });
  const folgtAuf = (vorher: Node, nachher: Node) =>
    (vorher.compareDocumentPosition(nachher) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

  it('System-Admin + 200 + nicht importiert: Hinweis mit Link auf /admin/demo-daten', async () => {
    demoStatus({ importiert: false });
    rendern(admin);
    const link = await screen.findByRole('link', { name: 'Zu den Demo-Daten' });
    expect(link).toHaveAttribute('href', '/admin/demo-daten');
    const alert = link.closest('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert).toHaveClass('ant-alert-info');
    // Ein Sprung, kein Direktimport: im Hinweis steht kein Knopf-Element, nur ein Verweis.
    expect(alert!.querySelector('button')).toBeNull();
  });

  /**
   * Der Verweis ist ein eigenes Bedienziel in Knopfform außerhalb des Titels: im Text trennte ihn
   * nur die Farbe (WCAG 1.4.1), und sein `minHeight` risse die Textzeile in `handschuh` auf 72 px.
   * Höhe und Polsterung erbt er vom `ConfigProvider`, ohne punktuelles `size`.
   */
  it('der Verweis steht als eigenes Bedienziel außerhalb des Titels, ohne punktuelle Größe', async () => {
    demoStatus({ importiert: false });
    rendern(admin);
    const link = await screen.findByRole('link', { name: 'Zu den Demo-Daten' });
    expect(link).toHaveClass('ant-btn');
    expect(link).not.toHaveClass('ant-btn-sm');
    expect(link).not.toHaveClass('ant-btn-lg');
    const titel = screen.getByText('Demo-Daten nicht importiert');
    expect(titel.contains(link)).toBe(false);
    expect(link.contains(titel)).toBe(false);
    // Kein Erklärsatz neben Titel und Knopf (LFH-1078).
    expect(screen.queryByText(/Übungseinsatz/)).toBeNull();
  });

  it('ein Klick auf den Verweis navigiert in der App, ohne Seitenwechsel des Browsers', async () => {
    demoStatus({ importiert: false });
    rendern(admin);
    const link = await screen.findByRole('link', { name: 'Zu den Demo-Daten' });
    await userEvent.click(link);
    expect(await screen.findByText('Ziel: Demo-Daten-Sektion')).toBeInTheDocument();
  });

  /**
   * Der Status kommt oft nach der Einsatzliste an; ein Hinweis über dem schon gezeichneten Raster
   * schöbe es weg (CLS). Er steht deshalb unter allem, was die Liste zeichnet — auch unter den
   * abgeschlossenen Einsätzen.
   */
  it('der Hinweis steht unter dem Raster und unter den abgeschlossenen Einsätzen', async () => {
    demoStatus({ importiert: false });
    rendern(admin, [einsatz(), einsatz({ id: 8, bezeichnung: 'Alt', status: 'abgeschlossen' })]);
    const link = await screen.findByRole('link', { name: /Demo-Daten/ });
    const alert = link.closest('[role="alert"]')!;
    expect(folgtAuf(screen.getByTestId('einsaetze-raster'), alert)).toBe(true);
    expect(folgtAuf(screen.getByText('Alt'), alert)).toBe(true);
  });

  /**
   * Gegenrichtung: stünde der Hinweis schon während des Ladens da, schöbe ihn der Wechsel Skelett →
   * Kacheln.
   */
  it('der Hinweis wartet auf die Einsatzliste, auch wenn der Status zuerst da ist', async () => {
    const { zaehler } = demoStatus({ importiert: false });
    let freigeben: () => void = () => {};
    const liste = new Promise<void>((r) => (freigeben = r));
    rendern(admin, [einsatz()], () => liste);
    await waitFor(() => expect(zaehler.get).toBe(1));
    expect(screen.getByTestId('einsaetze-raster')).toHaveAttribute('aria-busy', 'true');
    await new Promise((r) => setTimeout(r, 50));
    expect(hinweisLink()).toBeNull();
    freigeben();
    expect(await screen.findByRole('link', { name: /Demo-Daten/ })).toBeInTheDocument();
  });

  it('der Hinweis steht NEBEN dem Leerzustand, nicht in ihm (LFH-331 · AK3)', async () => {
    demoStatus({ importiert: false });
    rendern(admin, []);
    const link = await screen.findByRole('link', { name: /Demo-Daten/ });
    const leer = screen.getByText('Keine Einsätze').parentElement!;
    expect(leer.contains(link)).toBe(false);
    // Unter dem Leerzustand, nicht darüber: sonst schöbe er ihn beim späten Eintreffen.
    expect(folgtAuf(leer, link)).toBe(true);
    // Der Leerknoten bleibt aktionslos.
    expect(leer.querySelector('button, a')).toBeNull();
  });

  it('404: kein Hinweis und keine Fehlermeldung', async () => {
    const { zaehler } = demoStatus('aus');
    rendern(admin);
    await waitFor(() => expect(zaehler.get).toBe(1));
    expect(await screen.findByText('Hochwasser Nord')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(hinweisLink()).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('importiert: kein Hinweis', async () => {
    const { zaehler } = demoStatus({ importiert: true });
    rendern(admin);
    await waitFor(() => expect(zaehler.get).toBe(1));
    expect(await screen.findByText('Hochwasser Nord')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(hinweisLink()).toBeNull();
  });

  it('andere Rolle: kein Hinweis und keine Anfrage an /api/demo-daten', async () => {
    const { zaehler } = demoStatus({ importiert: false });
    rendern(fuehrungskraft);
    // Ankerpunkt: die Anmeldung ist aufgelöst (Führungskraft sieht die Anlegen-Kachel).
    expect(await screen.findByRole('button', { name: 'Neuer Einsatz' })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(hinweisLink()).toBeNull();
    expect(zaehler.get).toBe(0);
  });

  it('nach dem Import verschwindet der Hinweis, sobald der Status neu geladen ist', async () => {
    const { setze } = demoStatus({ importiert: false });
    const { client } = rendern(admin);
    expect(await screen.findByRole('link', { name: /Demo-Daten/ })).toBeInTheDocument();
    setze({ importiert: true });
    // Dasselbe Fach, das die Verwaltungssektion nach jedem Vorgang invalidiert.
    await client.invalidateQueries({ queryKey: globalKeys.demoDaten() });
    await waitFor(() => expect(hinweisLink()).toBeNull());
  });
});

/**
 * LFH-692 (Spec `zeiteingabe`, Szenario „Einsatz anlegen“): außerhalb eines Einsatzes gilt die
 * Zeitzone der Organisation. Browser auf UTC, Organisation auf Europe/Berlin.
 */
describe('EinsaetzePage — Zone der Organisation (LFH-692)', () => {
  mitProzessZone('UTC');
  afterEach(() => {
    vi.useRealTimers();
  });

  it('Alarmzeit und Liste stehen in Berlin; gesendet wird der Zeitpunkt in UTC', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-07-14T10:00:00Z'));
    let rumpf: Record<string, unknown> | null = null;
    server.use(
      meHandler(admin),
      http.get('/api/org-einstellungen', () =>
        HttpResponse.json({ org_id: 1, zeitzone: 'Europe/Berlin' }),
      ),
      http.get('/api/einsaetze', () => HttpResponse.json([einsatz()])),
      http.post('/api/einsaetze', async ({ request }) => {
        rumpf = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(einsatz({ bezeichnung: 'Sturm Süd' }), { status: 201 });
      }),
    );
    renderMitProviders(
      <Routes>
        <Route path="/" element={<EinsaetzePage />} />
        <Route path="/einsaetze/:id" element={<div>Workspace-7</div>} />
      </Routes>,
    );
    // Liste: 23.05. 09:00 UTC → 11:00 in Berlin.
    expect(await screen.findByText('seit 231100')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Neuer Einsatz' }));
    const dialog = await screen.findByRole('dialog');
    // Das Feld zeigt die volle DTG in der Anzeigezone: 10:00 UTC → 12:00 Berlin.
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Alarmzeit')).toHaveValue('141200jul26'),
    );
    expect(within(dialog).getByText('Europe/Berlin')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Sturm Süd');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(rumpf).not.toBeNull());
    expect(rumpf!.begonnen_at).toBe('2026-07-14 10:00:00');
  });

  it('LFH-966: ein abgelehntes Anlegen steht im Dialog, ohne Toast; Abbrechen räumt es', async () => {
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze', () => HttpResponse.json([])),
      http.post('/api/einsaetze', () =>
        HttpResponse.json({ error: 'Bezeichnung bereits vergeben' }, { status: 409 }),
      ),
    );
    renderMitProviders(<EinsaetzePage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Neuer Einsatz' }));
    await userEvent.type(screen.getByLabelText('Bezeichnung'), 'Sturm Süd');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByText('Bezeichnung bereits vergeben')).toBeInTheDocument();
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Neuer Einsatz' }));
    await screen.findByLabelText('Bezeichnung');
    expect(screen.queryByText('Bezeichnung bereits vergeben')).toBeNull();
  });
});

/** LFH-1031: die Alarmzeit ist nach der Serveruhr vorbelegt. */
describe('EinsaetzePage — Gerät mit 5 min Vorlauf (LFH-1031)', () => {
  mitProzessZone('UTC');
  const SERVER = Date.parse('2026-10-04T10:00:00Z');
  mitVorgehenderGeraeteuhr(SERVER);

  it('ohne Eingabe geht die Serverzeit als Alarmzeit hinaus', async () => {
    let rumpf: Record<string, unknown> | null = null;
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze', () => HttpResponse.json([])),
      http.post('/api/einsaetze', async ({ request }) => {
        rumpf = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(einsatz({ bezeichnung: 'Sturm Süd' }), { status: 201 });
      }),
    );
    renderMitProviders(<EinsaetzePage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Neuer Einsatz' }));
    await userEvent.type(screen.getByLabelText('Bezeichnung'), 'Sturm Süd');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(rumpf).not.toBeNull());
    expect(rumpf!.begonnen_at).toBe('2026-10-04 10:00:00');
  });
});

/** LFH-1175, Spec `ortsfeld`, „Einsatzort beim Anlegen“. */
describe('EinsaetzePage · Einsatzort beim Anlegen (LFH-1175)', () => {
  function aufbau() {
    const rumpfe: Record<string, unknown>[] = [];
    const begriffe: string[] = [];
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze', () => HttpResponse.json([])),
      http.post('/api/einsaetze', async ({ request }) => {
        rumpfe.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(einsatz({ bezeichnung: 'Sturm Süd' }), { status: 201 });
      }),
      http.get('/api/ort-suche', ({ request }) => {
        begriffe.push(new URL(request.url).searchParams.get('q')!);
        return HttpResponse.json({
          zustand: 'ok',
          treffer: [
            {
              lat: 51.1,
              lon: 10.4,
              name: 'Bahnhofstraße 1, Musterstadt, 12345, Deutschland',
              kurz: 'Bahnhofstraße 1, 12345 Musterstadt',
            },
          ],
        });
      }),
      // Ort-Vorschau ohne Einsatz (LLH-1376): nur der Ortsname.
      http.get('/api/ort-vorschau', () =>
        HttpResponse.json({ ortsname: 'Marktplatz 3, 12345 Musterstadt' }),
      ),
    );
    renderMitProviders(
      <Routes>
        <Route path="/" element={<EinsaetzePage />} />
        <Route path="/einsaetze/:id" element={<div>Workspace-7</div>} />
      </Routes>,
    );
    return { rumpfe, begriffe };
  }

  async function dialogOeffnen() {
    await userEvent.click(await screen.findByRole('button', { name: 'Neuer Einsatz' }));
    await userEvent.type(screen.getByLabelText('Bezeichnung'), 'Sturm Süd');
  }

  it('ein Treffer schickt Adresse und Koordinate mit, Enter im Feld legt nicht an', async () => {
    const { rumpfe, begriffe } = aufbau();
    await dialogOeffnen();
    await userEvent.type(screen.getByLabelText('Einsatzort'), 'Bahnhofstraße 1{Enter}');
    const liste = await screen.findByRole('list', { name: 'Treffer' });
    expect(begriffe).toEqual(['Bahnhofstraße 1']);
    expect(rumpfe).toEqual([]);
    await userEvent.click(within(liste).getByRole('button', { name: /Bahnhofstraße 1, 12345/ }));
    expect(screen.getByText('Karte 51.1, 10.4')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(rumpfe).toHaveLength(1));
    expect(rumpfe[0]).toMatchObject({
      bezeichnung: 'Sturm Süd',
      einsatzort: 'Bahnhofstraße 1, 12345 Musterstadt',
      einsatzort_lat: 51.1,
      einsatzort_lon: 10.4,
    });
  });

  it('Freitext schickt nur die Adresse', async () => {
    const { rumpfe } = aufbau();
    await dialogOeffnen();
    await userEvent.type(screen.getByLabelText('Einsatzort'), 'Waldweg hinter Sportplatz');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(rumpfe).toHaveLength(1));
    expect(rumpfe[0].einsatzort).toBe('Waldweg hinter Sportplatz');
    expect(rumpfe[0]).not.toHaveProperty('einsatzort_lat');
    expect(rumpfe[0]).not.toHaveProperty('einsatzort_lon');
  });

  it('eine getippte Koordinate geht ohne Suche mit (LLH-1108)', async () => {
    const { rumpfe, begriffe } = aufbau();
    await dialogOeffnen();
    await userEvent.type(screen.getByLabelText('Einsatzort'), '51.16040, 10.45140');
    expect(screen.getByText('Karte 51.1604, 10.4514')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(rumpfe).toHaveLength(1));
    expect(rumpfe[0]).toMatchObject({
      einsatzort: '51.16040, 10.45140',
      einsatzort_lat: 51.1604,
      einsatzort_lon: 10.4514,
    });
    expect(begriffe).toEqual([]);
  });

  it('zu einer getippten Koordinate kommt der Ortsname als Vorschlag (LLH-1376)', async () => {
    const { rumpfe } = aufbau();
    await dialogOeffnen();
    await userEvent.type(screen.getByLabelText('Einsatzort'), '51.16040, 10.45140');
    expect(await screen.findByText('Marktplatz 3, 12345 Musterstadt')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Als Adresse übernehmen' }));
    expect(screen.getByLabelText('Einsatzort')).toHaveValue('Marktplatz 3, 12345 Musterstadt');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(rumpfe).toHaveLength(1));
    expect(rumpfe[0]).toMatchObject({
      einsatzort: 'Marktplatz 3, 12345 Musterstadt',
      einsatzort_lat: 51.1604,
      einsatzort_lon: 10.4514,
    });
  });

  it('leer schickt keinen Einsatzort', async () => {
    const { rumpfe } = aufbau();
    await dialogOeffnen();
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(rumpfe).toHaveLength(1));
    for (const feld of ['einsatzort', 'einsatzort_lat', 'einsatzort_lon']) {
      expect(rumpfe[0]).not.toHaveProperty(feld);
    }
  });
});

describe('EinsaetzePage · Zufluss unter Zeiger und Fokus (LLH-1204)', () => {
  const e = (over: Partial<EinsatzAnzeige>): EinsatzAnzeige =>
    ({
      id: 1,
      bezeichnung: 'Alt',
      stichwort: null,
      status: 'aktiv',
      einsatzart: 'realeinsatz',
      begonnen_at: '2026-06-01 08:00:00',
      angelegt_at: '2026-06-01 08:00:00',
      einsatzort: null,
      org_id: 1,
      org_name: 'THW Musterstadt',
      meine_rolle: 'einsatzleitung',
      ...over,
    }) as EinsatzAnzeige;

  const alt = e({ id: 1, bezeichnung: 'Alt', begonnen_at: '2026-06-01 08:00:00' });
  const mitte = e({ id: 2, bezeichnung: 'Mitte', begonnen_at: '2026-06-05 08:00:00' });
  const neu = e({ id: 3, bezeichnung: 'Neu von woanders', begonnen_at: '2026-06-09 08:00:00' });

  /** Die Liste liegt in einer Variablen; `liefere` tauscht sie und lädt neu wie das Org-Ereignis. */
  function aufbau(start: EinsatzAnzeige[]) {
    let liste = start;
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze', () => HttpResponse.json(liste)),
      http.get('/api/stichwort-vorschlaege', () => HttpResponse.json([])),
    );
    const { client } = renderMitProviders(<EinsaetzePage />);
    const liefere = async (naechste: EinsatzAnzeige[]) => {
      liste = naechste;
      await client.invalidateQueries({ queryKey: globalKeys.einsaetze() });
    };
    return { liefere };
  }

  const titel = () =>
    within(screen.getByTestId('einsaetze-raster'))
      .getAllByRole('link')
      .map((l) => l.textContent);
  const bereich = () => document.querySelector<HTMLElement>('[data-lfh="einsaetze-bereich"]')!;

  it('ohne Zeiger und Fokus rückt ein neuer Einsatz sofort nach vorn, ohne Banner', async () => {
    const { liefere } = aufbau([alt, mitte]);
    await screen.findByText('Alt');
    await liefere([alt, mitte, neu]);
    await waitFor(() => expect(titel()).toEqual(['Neu von woanders', 'Mitte', 'Alt']));
    expect(screen.queryByText(/neuer Einsatz/)).not.toBeInTheDocument();
  });

  it('unter dem Zeiger hält das Raster seine Folge, der neue Einsatz wartet im Sammelbanner', async () => {
    const { liefere } = aufbau([alt, mitte]);
    await screen.findByText('Alt');
    fireEvent.pointerMove(screen.getByRole('link', { name: 'Mitte' }), { pointerType: 'mouse' });
    await liefere([alt, mitte, neu]);
    const banner = await screen.findByText('1 neuer Einsatz');
    expect(titel()).toEqual(['Mitte', 'Alt']);
    // Das Banner steht im Bereich: der Weg dorthin taut nicht auf.
    expect(bereich()).toContainElement(banner);

    await userEvent.click(screen.getByRole('button', { name: 'anzeigen' }));
    expect(titel()).toEqual(['Neu von woanders', 'Mitte', 'Alt']);
    expect(screen.queryByText('1 neuer Einsatz')).not.toBeInTheDocument();
    // Der Knopf ist weg; der Fokus steht auf dem neuen Einsatz, statt auf `body` zu fallen.
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Neu von woanders' }));
  });

  it('verlässt der Zeiger den Bereich, sortiert sich der neue Einsatz ein', async () => {
    const { liefere } = aufbau([alt, mitte]);
    await screen.findByText('Alt');
    fireEvent.pointerMove(screen.getByRole('link', { name: 'Alt' }), { pointerType: 'mouse' });
    await liefere([alt, mitte, neu]);
    await screen.findByText('1 neuer Einsatz');
    fireEvent.pointerLeave(bereich(), { pointerType: 'mouse' });
    expect(titel()).toEqual(['Neu von woanders', 'Mitte', 'Alt']);
    expect(screen.queryByText('1 neuer Einsatz')).not.toBeInTheDocument();
  });

  it('der Fokus auf einer Kachel hält ebenso; erst ein Fokus außerhalb taut', async () => {
    const { liefere } = aufbau([alt, mitte]);
    await screen.findByText('Alt');
    const link = screen.getByRole('link', { name: 'Alt' });
    act(() => link.focus());
    await liefere([alt, mitte, neu]);
    await screen.findByText('1 neuer Einsatz');
    expect(titel()).toEqual(['Mitte', 'Alt']);
    expect(document.activeElement).toBe(link);

    fireEvent.blur(link, { relatedTarget: document.body });
    expect(titel()).toEqual(['Neu von woanders', 'Mitte', 'Alt']);
  });

  it('Touch hält nicht an: der Tipp betritt und verlässt den Bereich', async () => {
    const { liefere } = aufbau([alt, mitte]);
    await screen.findByText('Alt');
    fireEvent.pointerMove(screen.getByRole('link', { name: 'Alt' }), { pointerType: 'touch' });
    await liefere([alt, mitte, neu]);
    await waitFor(() => expect(titel()).toEqual(['Neu von woanders', 'Mitte', 'Alt']));
  });

  it('ein abgeschlossener Einsatz bleibt unter dem Zeiger an seinem Platz, der Inhalt fließt', async () => {
    const { liefere } = aufbau([alt, mitte]);
    await screen.findByText('Alt');
    fireEvent.pointerMove(screen.getByRole('link', { name: 'Alt' }), { pointerType: 'mouse' });
    await liefere([alt, { ...mitte, status: 'abgeschlossen' }]);
    await waitFor(() => expect(screen.getAllByText('Abgeschlossen').length).toBeGreaterThan(0));
    expect(titel()).toEqual(['Mitte', 'Alt']);
    expect(screen.queryByRole('heading', { name: 'Abgeschlossen' })).not.toBeInTheDocument();
  });

  it('trifft der achte Einsatz unter dem Zeiger ein, erscheint das Suchfeld erst nach dem Verlassen', async () => {
    const sieben = Array.from({ length: 7 }, (_, i) =>
      e({ id: 10 + i, bezeichnung: `Einsatz ${i + 1}`, begonnen_at: `2026-06-0${i + 1} 08:00:00` }),
    );
    const { liefere } = aufbau(sieben);
    await screen.findByText('Einsatz 1');
    fireEvent.pointerMove(screen.getByRole('link', { name: 'Einsatz 3' }), {
      pointerType: 'mouse',
    });
    await liefere([...sieben, neu]);
    await screen.findByText('1 neuer Einsatz');
    // Das Feld stünde über dem Raster und schöbe jede Kachel eine Zeile tiefer.
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();

    fireEvent.pointerLeave(bereich(), { pointerType: 'mouse' });
    expect(screen.getByRole('searchbox', { name: /Einsätze durchsuchen/ })).toBeInTheDocument();
    expect(titel()[0]).toBe('Neu von woanders');
  });

  it('die eigene Suche ordnet sofort, auch unter gehaltener Schleuse; nichts wartet im Banner', async () => {
    const neun = Array.from({ length: 9 }, (_, i) =>
      e({ id: 10 + i, bezeichnung: `Einsatz ${i + 1}`, begonnen_at: `2026-06-0${i + 1} 08:00:00` }),
    );
    aufbau(neun);
    const feld = await screen.findByRole('searchbox', { name: /Einsätze durchsuchen/ });
    await userEvent.type(feld, 'Einsatz 4');
    expect(titel()).toEqual(['Einsatz 4']);
    // Weg und zurück: jetzt hält die Schleuse die GEFILTERTE Menge.
    fireEvent.pointerLeave(bereich(), { pointerType: 'mouse' });
    act(() => feld.blur());
    act(() => feld.focus());
    await userEvent.clear(feld);
    expect(titel()).toHaveLength(9);
    expect(screen.queryByText(/neue Einsätze/)).not.toBeInTheDocument();
  });

  it('das Suchfeld verschwindet nicht, solange darin getippt wird', async () => {
    const neun = Array.from({ length: 9 }, (_, i) =>
      e({ id: 10 + i, bezeichnung: `Einsatz ${i + 1}`, begonnen_at: `2026-06-0${i + 1} 08:00:00` }),
    );
    const { liefere } = aufbau(neun);
    const feld = await screen.findByRole('searchbox', { name: /Einsätze durchsuchen/ });
    await userEvent.type(feld, 'Einsatz');
    await liefere(neun.slice(0, 3));
    await waitFor(() => expect(titel()).toEqual(['Einsatz 3', 'Einsatz 2', 'Einsatz 1']));
    expect(screen.getByRole('searchbox', { name: /Einsätze durchsuchen/ })).toBe(feld);
    expect(document.activeElement).toBe(feld);
    // Weitertippen ordnet neu (Zwischenschritt `neu`); der Begriff bleibt stehen.
    await userEvent.type(feld, ' 2');
    expect(feld).toHaveValue('Einsatz 2');
    expect(titel()).toEqual(['Einsatz 2']);

    // Erst wer das Feld verlässt, sieht den neuen Stand; der Filter fällt mit dem Feld.
    fireEvent.pointerLeave(bereich(), { pointerType: 'mouse' });
    act(() => feld.blur());
    await waitFor(() => expect(screen.queryByRole('searchbox')).not.toBeInTheDocument());
    expect(titel()).toEqual(['Einsatz 3', 'Einsatz 2', 'Einsatz 1']);
  });
});
