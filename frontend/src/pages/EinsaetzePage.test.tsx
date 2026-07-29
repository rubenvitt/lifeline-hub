import { delay, http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
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
    expect(screen.getByText('Abgeschlossen')).toBeInTheDocument();
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
