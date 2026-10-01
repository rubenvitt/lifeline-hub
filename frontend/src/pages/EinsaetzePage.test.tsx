import { delay, http, HttpResponse } from 'msw';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import dayjs from 'dayjs';
import { Route, Routes } from 'react-router';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { mitProzessZone } from '../test/prozessZone';
import { formatZeitKurz } from '../anzeige/format';
import type { BenutzerAnzeige, EinsatzAnzeige } from '../api/types';
import { globalKeys } from '../api/queryKeys';
import EinsaetzePage, { kartenTitelStil } from './EinsaetzePage';
import { dichten } from '../theme/tokens';
import { adminFixture } from '../test/fixtures';

const admin = adminFixture();

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
    expect(screen.getByText('einsatzleitung')).toBeInTheDocument();
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

  it('führt genau vier Felder — die Obergrenze einer Schnellerfassung', async () => {
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze', () => HttpResponse.json([])),
    );
    renderMitProviders(<EinsaetzePage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Neuer Einsatz' }));
    const dialog = await screen.findByRole('dialog');

    for (const feld of ['Bezeichnung', 'Stichwort', 'Einsatzart', 'Alarmzeit']) {
      expect(screen.getByLabelText(feld)).toBeInTheDocument();
    }
    expect(dialog.querySelectorAll('.ant-form-item').length).toBe(4);
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
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze', async () => {
        await delay(60);
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
    const erwartet = formatZeitKurz('2026-06-08 06:12:00');
    expect(await screen.findByText(new RegExp(`seit ${erwartet}`))).toBeInTheDocument();
  });

  it('die Karte trägt die Einsatzart als zweiten Tag neben dem Status', async () => {
    mockEinsaetze([e({ einsatzart: 'uebung' })]);
    render();
    // Die Map trägt eine Beschriftung statt des Wire-Werts (Vertrag in `theme/statusFarben.ts`).
    expect(await screen.findByText('Aktiv')).toBeInTheDocument();
    expect(screen.getByText('Übung')).toBeInTheDocument();
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
   * Der Verweis ist ein eigenes Bedienziel in Knopfform außerhalb des Satzes: im Satz trennte ihn
   * nur die Farbe vom Text (WCAG 1.4.1), und sein `minHeight` risse die Textzeile in `handschuh`
   * auf 72 px. Höhe und Polsterung erbt er vom `ConfigProvider`, ohne punktuelles `size`.
   */
  it('der Verweis steht als eigenes Bedienziel außerhalb des Satzes, ohne punktuelle Größe', async () => {
    demoStatus({ importiert: false });
    rendern(admin);
    const link = await screen.findByRole('link', { name: 'Zu den Demo-Daten' });
    expect(link).toHaveClass('ant-btn');
    expect(link).not.toHaveClass('ant-btn-sm');
    expect(link).not.toHaveClass('ant-btn-lg');
    const satz = screen.getByText(/Übungseinsatz samt Stammdaten/);
    expect(satz.contains(link)).toBe(false);
    expect(link.contains(satz)).toBe(false);
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
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Alarmzeit')).toHaveValue('14.07.2026 12:00'),
    );
    expect(within(dialog).getByText('Europe/Berlin')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Sturm Süd');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(rumpf).not.toBeNull());
    expect(rumpf!.begonnen_at).toBe('2026-07-14 10:00:00');
  });
});
