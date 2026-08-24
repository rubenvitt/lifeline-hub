import { delay, http, HttpResponse } from 'msw';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { formatZeitKurz } from '../anzeige/format';
import type { EinsatzAnzeige } from '../api/types';
import { globalKeys } from '../api/queryKeys';
import EinsaetzePage from './EinsaetzePage';

const admin = {
  id: 1,
  anzeigename: 'Admin',
  benutzername: 'admin',
  system_rolle: 'admin',
  org_rolle: 'keine',
  aktiv: true,
  erstellt_at: '2026-05-23 10:00:00',
};

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

// `renderMitProviders` (test/utils.tsx:37) rendert den `AuthProvider` selbst — ein
// zweiter drumherum wäre ein doppelter `/api/auth/me`-Abruf ohne jeden Nutzen.
function setup() {
  server.use(http.get('/api/auth/me', () => HttpResponse.json(admin)));
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
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
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
    // LFH-332 · B4 (Befund H18). Der Dialog schickt die beiden Felder selbst, statt
    // sie dem 11-Feld-Kopfdatenformular zu überlassen. Geprüft wird der Rumpf, nicht
    // die Anzeige: ein Dialog, der die Felder ZEIGT und nicht SENDET, sähe im DOM
    // genauso aus.
    let rumpf: Record<string, unknown> | null = null;
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
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
    // Die Form allein beweist nichts — sie ist in jeder Zeitzone erfüllt, auch von
    // der lokalen Wanduhrzeit. Geprüft wird deshalb der WERT gegen UTC: die
    // Alarmzeit ist eine Vorbelegung auf „jetzt", also darf sie höchstens eine
    // Minute von der aktuellen UTC-Zeit abweichen. Mit `.format()` statt
    // `.utc().format()` schlägt das überall fehl, wo der Zonenversatz ≠ 0 ist.
    expect(rumpf!.begonnen_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    const gesendet = dayjs.utc(rumpf!.begonnen_at as string, 'YYYY-MM-DD HH:mm:ss');
    expect(Math.abs(gesendet.diff(dayjs.utc(), 'minute'))).toBeLessThanOrEqual(1);
  });

  it('führt genau vier Felder — die Obergrenze einer Schnellerfassung', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
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
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
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
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText('Bezeichnung')),
    );
    await userEvent.type(screen.getByLabelText('Bezeichnung'), 'Sturm Süd{Enter}');

    await waitFor(() => expect(screen.getByText('Workspace-7')).toBeInTheDocument());
  });

  it('zeigt den Anlege-Button nicht für Nutzer ohne Recht', async () => {
    const ohneRecht = { ...admin, system_rolle: 'keiner', org_rolle: 'keine' };
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(ohneRecht)),
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
    // Über die ÜBERSCHRIFT gegriffen, nicht über den Text: seit LFH-345 · C10 trägt das
    // Status-Etikett der Karte dieselbe Beschriftung („Abgeschlossen" statt des
    // Wire-Werts), `getByText` fände also zwei Knoten. Die Rollen-Abfrage sagt ohnehin
    // genauer, was der Test behauptet — es geht um die SEKTION, nicht um ein Etikett.
    expect(screen.getByRole('heading', { name: 'Abgeschlossen' })).toBeInTheDocument();
    expect(screen.getByText('Sturmtief Abschluss')).toBeInTheDocument();
  });

  it('oeffnet beim Klick auf eine Kachel den Workspace unter /einsaetze/:id', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
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
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/einsaetze', () => HttpResponse.json([
        einsatz(),
        einsatz({ id: 8, bezeichnung: 'Sturmtief Abschluss', status: 'abgeschlossen' }),
      ])),
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
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
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
    const modifierKlick = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    fireEvent(link, modifierKlick);

    expect(modifierKlick.defaultPrevented).toBe(false);
    expect(screen.queryByText('Workspace-7')).not.toBeInTheDocument();
  });

  // ── Die drei Datenzustände (LFH-328 · A2, Task 10) ────────────────────────────
  // Sie müssen UNTERSCHEIDBAR gerendert sein: vorher sah ein Anlegeberechtigter in
  // allen dreien dieselbe leere Fläche mit nur dem „Neuer Einsatz"-Knopf — ein
  // Serverfehler war von „noch keine Daten" nicht zu unterscheiden.

  it('zeigt beim Laden Karten-Skelette im Raster und noch keinen Anlegen-Knopf', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/einsaetze', async () => {
        await delay(60);
        return HttpResponse.json([einsatz()]);
      }),
    );
    renderMitProviders(<EinsaetzePage />);

    // Die Skelett-Kacheln liegen im SELBEN Rasterknoten, der danach die Karten
    // trägt (Prüfliste Kriterium 12). jsdom rechnet kein Layout — die gleiche
    // Kachelhöhe ist hier nicht messbar, nur die gemeinsame Herkunft.
    const raster = await screen.findByTestId('einsaetze-raster');
    await waitFor(() =>
      expect(raster.querySelectorAll('.lfh-skelett__balken').length).toBeGreaterThan(0),
    );
    expect(screen.queryByRole('button', { name: /Neuer Einsatz/ })).toBeNull();

    // Und erst nach dem Auflösen des Ladezustands erscheint er — das belegt, dass
    // oben der Ladezustand ihn verborgen hat und nicht ein fehlendes Recht.
    expect(await screen.findByRole('button', { name: 'Neuer Einsatz' })).toBeInTheDocument();
    expect(screen.getByTestId('einsaetze-raster').querySelector('.lfh-skelett__balken')).toBeNull();
  });

  it('zeigt bei einem Fehler eine Meldung, deren Wiederholen-Aktion neu abruft', async () => {
    let abrufe = 0;
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
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

    // Der erneute Abruf wird über den Handler-Zähler belegt, nicht über einen Spy:
    // nur so ist bewiesen, dass wirklich ein Request rausgegangen ist.
    await userEvent.click(screen.getByRole('button', { name: 'Erneut abrufen' }));

    expect(await screen.findByText('Hochwasser Nord')).toBeInTheDocument();
    expect(abrufe).toBe(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('zeigt bei leerer Liste den Leer-Zustand — auch für Anlegeberechtigte', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/einsaetze', () => HttpResponse.json([])),
    );
    const { container } = renderMitProviders(<EinsaetzePage />);

    // Bisher waren „leer" und „darf anlegen" ein Entweder-oder: der Leer-Zweig
    // lief für Anlegeberechtigte nie, sie sahen nur den Knopf im leeren Raster.
    expect(await screen.findByText('Keine Einsätze')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Neuer Einsatz' })).toBeInTheDocument();
    // Getauscht ist der Knoten, nicht der Wortlaut (LFH-331 · B3) — die Textzeile
    // darüber war vor dem Umbau genauso grün und belegt für sich genommen nichts.
    // Der Leerknoten trägt KEINE eigene Aktion: die Anlegen-Kachel steht direkt
    // darunter, ein zweiter „Neuer Einsatz"-Knopf machte die Abfrage mehrdeutig.
    expect(container.querySelector('.ant-empty')).toBeNull();
  });
});

describe('Einsatzkarte — Lagebild statt vier Felder (LFH-336 · M4/M5)', () => {
  // Eigene Fixture/Hilfen statt der Datei-Bestandshilfen `einsatz()`/`setup()`: die
  // Bestandshilfe deckt weder `einsatzort`/`org_id`/`org_name`/`angelegt_at` noch das
  // `/api/stichwort-vorschlaege`-Mock ab, das der Anlegedialog-Query bei jedem Mount
  // abruft (`onUnhandledRequest: 'error'` in `test/setup.ts`).
  function mockEinsaetze(liste: EinsatzAnzeige[]) {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/einsaetze', () => HttpResponse.json(liste)),
      http.get('/api/stichwort-vorschlaege', () => HttpResponse.json([])),
    );
  }
  function render() {
    return renderMitProviders(<EinsaetzePage />);
  }

  const e = (over: Partial<EinsatzAnzeige>): EinsatzAnzeige =>
    ({
      id: 1, bezeichnung: 'Hochwasser Musterstadt', stichwort: 'TH Hochwasser',
      status: 'aktiv', einsatzart: 'realeinsatz', begonnen_at: '2026-06-08 06:12:00',
      angelegt_at: '2026-06-08 06:12:00', einsatzort: 'Musterstadt, Deichweg 3',
      org_id: 1, org_name: 'THW Musterstadt', meine_rolle: 'einsatzleitung',
      ...over,
    }) as EinsatzAnzeige;

  it('die Karte nennt den Einsatzort', async () => {
    mockEinsaetze([e({ einsatzort: 'Musterstadt, Deichweg 3' })]);
    render();
    expect(await screen.findByText(/Musterstadt, Deichweg 3/)).toBeInTheDocument();
    // Positiv gegen den Testid, nicht nur gegen den Text: die negative Prüfung
    // weiter unten („ohne Einsatzort … nicht im Dokument") wäre sonst immer grün,
    // auch wenn `data-testid="einsatz-ort"` nie im DOM ankäme (antds
    // `Typography.Text` reicht unbekannte Props zwar durch, das ist hier aber nicht
    // unterstellt, sondern belegt).
    expect(screen.getByTestId('einsatz-ort')).toHaveTextContent('Musterstadt, Deichweg 3');
  });

  it('die Karte nennt einen aus begonnen_at abgeleiteten Zeitstand', async () => {
    mockEinsaetze([e({ begonnen_at: '2026-06-08 06:12:00' })]);
    render();
    // `formatZeitKurz` liefert „0806 12" bzw. „0612" je nach Tagesbezug; geprüft
    // wird das WORT „seit" plus der von der Funktion gelieferte Wert — die
    // Formatierung selbst ist in `format.test.ts` geprüft und wird hier nicht
    // zweitgeprüft (sonst stünde die Erwartung an zwei Orten).
    const erwartet = formatZeitKurz('2026-06-08 06:12:00');
    expect(await screen.findByText(new RegExp(`seit ${erwartet}`))).toBeInTheDocument();
  });

  it('die Karte trägt die Einsatzart als zweiten Tag neben dem Status', async () => {
    mockEinsaetze([e({ einsatzart: 'uebung' })]);
    render();
    // Grossgeschrieben seit LFH-345 · C10 (M14): die Map liegt jetzt in
    // `einsatz/einsatzStatus.ts` und trägt eine BESCHRIFTUNG statt des Wire-Werts.
    // Vorher stand hier 'aktiv' — also der Enum-Schlüssel, der nur zufällig lesbar war.
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
    // Je EIN Fall pro Feld mit einem eindeutigen Treffer — vorher trugen alle
    // Fixtures dasselbe Stichwort und schematische Bezeichnungen, sodass ein
    // Treffer allein über Bezeichnung oder Stichwort nie belegt war (Task-5-Review,
    // Finding 3: Testname behauptete mehr, als der Testkörper prüfte).
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
    // Finding 1: `leer` (Zeile 215) beruht auf `aktive`, nicht auf `sichtbareAktive`
    // — filtert die Suche ALLE aktiven Einsätze weg, blieb die Fläche bisher stumm
    // (nur der „Neuer Einsatz"-Knopf oder gar nichts), statt eine dritte Sorte
    // Leerzustand zu zeigen.
    const nutzer = userEvent.setup();
    mockEinsaetze(
      Array.from({ length: 9 }, (_, i) => e({ id: i + 1, bezeichnung: `Einsatz ${i + 1}` })),
    );
    render();
    const feld = await screen.findByRole('searchbox', { name: /Einsätze durchsuchen/ });
    await nutzer.type(feld, 'kein-treffer-xyz');
    expect(await screen.findByText(/Keine Treffer/)).toBeInTheDocument();
    expect(screen.getByText(/kein-treffer-xyz/)).toBeInTheDocument();
    // Unterscheidbar vom „gar keine Einsätze"-Zustand — der träte hier nie auf, weil
    // Einsätze vorhanden sind, nur eben weggefiltert.
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
    // Suchbegriff trifft weder auf einen aktiven noch auf den abgeschlossenen
    // Einsatz — die aktive Sektion muss leerlaufen, die abgeschlossene bleibt
    // trotzdem stehen. Filterte `sichtbareAktive` versehentlich auch die
    // abgeschlossene Sektion, verschwände „Alter Einsatz" hier mit.
    await nutzer.type(feld, 'kein-treffer');
    expect(screen.queryByText('Einsatz 1')).not.toBeInTheDocument();
    expect(screen.getByText('Alter Einsatz')).toBeInTheDocument();
  });

  it('fällt die Zahl aktiver Einsätze unter die Schwelle, bleibt kein leeres Raster ohne Ausweg stehen (M6)', async () => {
    // Befund M6: sichtbareAktive filtert UNBEDINGT, das Suchfeld erscheint nur ab
    // SUCHE_AB, und keineTreffer verlangt zusätzlich sucheZeigen. Fällt die Zahl
    // aktiver Einsätze unter die Schwelle — hier durch einen Refetch, wie ihn
    // `refetchOnWindowFocus` (Vorgabewert true, nicht abgeschaltet) jederzeit
    // auslösen kann —, während ein nicht passender Suchbegriff im Zustand steht,
    // verschwindet das Feld samt allowClear, der Filter wirkt weiter, und der
    // Nulltreffer-Hinweis erscheint nicht (er hängt an sucheZeigen): ein leeres
    // Raster ohne Erklärung und ohne Ausweg.
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

    // Kein Suchfeld mehr (unter der Schwelle) — trotzdem müssen die drei
    // verbliebenen Einsätze sichtbar sein statt in einem stummen, leeren Raster
    // ohne jede Erklärung oder jeden Ausweg zu verschwinden.
    await waitFor(() => expect(screen.queryByRole('searchbox')).not.toBeInTheDocument());
    expect(await screen.findByText('Einsatz 1')).toBeInTheDocument();
    expect(screen.getByText('Einsatz 2')).toBeInTheDocument();
    expect(screen.getByText('Einsatz 3')).toBeInTheDocument();
    expect(screen.queryByText(/Keine Treffer/)).not.toBeInTheDocument();
  });

  // AK4. Der Titel ist schon ein `<Link>` — der Test hält diese Eigenschaft fest,
  // damit ein späterer Umbau auf ein `<div onClick>` auffliegt statt still die
  // Tastaturbedienung zu kosten.
  it('die Tabulatortaste erreicht die Einsatzkarte, Enter navigiert', async () => {
    const nutzer = userEvent.setup();
    mockEinsaetze([e({ id: 7, bezeichnung: 'Hochwasser Musterstadt' })]);
    // Die Zielroute muss MITGERENDERT werden. `renderMitProviders` fährt einen
    // MemoryRouter (test/utils.tsx:38) — `window.location` bewegt sich dort nie,
    // eine Zusicherung darauf wäre rot, ohne dass die Navigation kaputt ist.
    // Dasselbe Muster wie im Dashboard-Test (dort „PERSONEN-MODUL").
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze" element={<EinsaetzePage />} />
        <Route path="/einsaetze/:id" element={<div>EINSATZ-DETAIL</div>} />
      </Routes>,
      { route: '/einsaetze' },
    );
    const karte = await screen.findByRole('link', { name: 'Hochwasser Musterstadt' });
    // Bis zur Karte tabben, statt sie zu fokussieren: „ist per Tastatur
    // ERREICHBAR" ist die Aussage, nicht „reagiert, wenn man sie fokussiert".
    // Vor den Karten liegt bei Anlegerecht der „Neuer Einsatz"-Knopf.
    for (let i = 0; i < 10 && document.activeElement !== karte; i++) await nutzer.tab();
    expect(karte).toHaveFocus();
    await nutzer.keyboard('{Enter}');
    expect(await screen.findByText('EINSATZ-DETAIL')).toBeInTheDocument();
  });
});
