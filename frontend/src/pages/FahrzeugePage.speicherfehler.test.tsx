import { http, HttpResponse } from 'msw';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { offeneRueckfrage } from '../test/rueckfrage';
import { setzeViewportBreite } from '../test/viewport';
import FahrzeugePage from './FahrzeugePage';
import { benutzerFixture, einsatzFixture } from '../test/fixtures';

/**
 * Abgelehnte Speichervorgänge der Fahrzeugseite stehen am Ort der Handlung (LFH-1077,
 * `frontend/AGENTS.md`, „Rückwege und Fehler“): im Disponier-Dialog, an der Zeile, an der Karte,
 * an der Kachel des Tableaus und im Besatzungsblock. Kein Fehler-Toast; der Grund bleibt bis zum
 * nächsten Absenden.
 */

const einsatz = einsatzFixture({ id: 7, bezeichnung: 'Hochwasser Nord' });

const ef = {
  id: 10,
  einsatz_id: 7,
  fahrzeug_id: 1,
  einheit_id: null,
  ist_adhoc: false,
  funkrufname: 'Florian 1',
  kennzeichen: 'XX-AB 1',
  fahrzeugtyp: 'LF 20',
  opta: null,
  traegerorganisation: null,
  status_id: 2,
  status_label: 'disponiert',
  status_kategorie: 'gebunden',
  status_farbe: null,
  bemerkung: null,
  disponiert_at: '2026-05-26 09:10:00',
  disponiert_von: 1,
  soll_besatzung: null,
};
const zweites = { ...ef, id: 11, fahrzeug_id: 2, funkrufname: 'Florian 2' };
const stati = [
  { id: 2, label: 'disponiert', kategorie: 'gebunden', farbe: null, fms_anker: 3, sortier: 20 },
  { id: 3, label: 'vor_ort', kategorie: 'gebunden', farbe: null, fms_anker: 4, sortier: 40 },
];

function person(overrides: Record<string, unknown>) {
  return {
    id: 100,
    einsatz_id: 7,
    personal_id: 5,
    einheit_id: null,
    fahrzeug_id: null,
    ist_adhoc: false,
    name: 'Anna Crew',
    funktion: null,
    traegerorganisation: null,
    staerke_position: 'mannschaft',
    status_id: null,
    status_label: null,
    status_kategorie: null,
    status_farbe: null,
    bemerkung: null,
    disponiert_at: '2026-05-26 09:10:00',
    disponiert_von: 1,
    ...overrides,
  };
}

function tor() {
  let frei: () => void = () => {};
  const offen = new Promise<void>((r) => (frei = r));
  return { offen, frei: () => frei() };
}

function render({
  liste = [ef, zweites],
  personal = [] as unknown[],
  pool = [] as unknown[],
  route = '/einsaetze/7/fahrzeuge',
} = {}) {
  server.use(
    meHandler(benutzerFixture()),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json(liste)),
    http.get('/api/einsaetze/7/personal', () => HttpResponse.json(personal)),
    http.get('/api/einsaetze/7/einheiten', () => HttpResponse.json([])),
    http.get('/api/fahrzeug-status', () => HttpResponse.json(stati)),
    http.get('/api/fahrzeuge', () => HttpResponse.json(pool)),
  );
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/fahrzeuge" element={<FahrzeugePage />} />
    </Routes>,
    { route },
  );
}

const zeile = (container: HTMLElement, id: number) =>
  container.querySelector<HTMLElement>(`[data-row-key="${id}"]`)!;
const karte = (funkrufname: string) =>
  screen.getByText(funkrufname).closest<HTMLElement>('[data-lfh="datensicht-karte"]')!;
const toasts = () => document.querySelectorAll('.ant-message-notice').length;

async function waehleStatus(wurzel: HTMLElement, funkrufname: string, label: RegExp) {
  await userEvent.click(
    within(wurzel).getByRole('button', { name: `Status von ${funkrufname} ändern` }),
  );
  const menue = [...document.querySelectorAll<HTMLElement>('.ant-dropdown')]
    .filter((d) => !d.classList.contains('ant-dropdown-hidden') && d.style.pointerEvents !== 'none')
    .pop()!;
  await userEvent.click(within(menue).getByRole('menuitem', { name: label }));
}

const statusAbgelehnt = () =>
  http.patch('/api/einsaetze/7/fahrzeuge/10', () =>
    HttpResponse.json({ error: 'Status abgelehnt' }, { status: 409 }),
  );

describe('FahrzeugePage · Speicherfehler am Ort (LFH-1077)', () => {
  it('Ad-hoc: der Grund steht im Dialog, das nächste Absenden räumt ihn, Abbrechen und Öffnen zeigen ihn nicht', async () => {
    const zweiterVersuch = tor();
    let versuche = 0;
    server.use(
      http.post('/api/einsaetze/7/fahrzeuge', async () => {
        versuche += 1;
        if (versuche > 1) await zweiterVersuch.offen;
        return HttpResponse.json({ error: 'Funkrufname schon disponiert' }, { status: 409 });
      }),
    );
    render();
    await screen.findByText('Florian 1');
    await userEvent.click(screen.getByRole('button', { name: 'Ad-hoc-Fahrzeug' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Funkrufname' }), 'Florian 7');
    const knopf = within(dialog).getByRole('button', { name: 'Disponieren' });
    await userEvent.click(knopf);

    const grund = await within(dialog).findByRole('alert');
    expect(grund).toHaveTextContent('Nicht disponiert');
    expect(grund).toHaveTextContent('Funkrufname schon disponiert');
    expect(within(dialog).getByRole('textbox', { name: 'Funkrufname' })).toHaveValue('Florian 7');
    expect(toasts()).toBe(0);

    await userEvent.click(knopf);
    await waitFor(() => expect(within(dialog).queryByRole('alert')).toBeNull());
    await act(async () => zweiterVersuch.frei());
    await within(dialog).findByRole('alert');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ad-hoc-Fahrzeug' }));
    expect(within(await screen.findByRole('dialog')).queryByRole('alert')).toBeNull();
    expect(toasts()).toBe(0);
  });

  it('Disponieren aus dem Bestand: der Grund steht im Dialog, kein Toast', async () => {
    server.use(
      http.post('/api/einsaetze/7/fahrzeuge', () =>
        HttpResponse.json({ error: 'Fahrzeug außer Dienst' }, { status: 409 }),
      ),
    );
    render({
      pool: [
        {
          id: 3,
          funkrufname: 'Florian 3',
          fahrzeugtyp: 'LF 20',
          traegerorganisation: null,
          kennzeichen: null,
          opta: null,
          standort: null,
          fms_issi: null,
          sondersignal: false,
          tragenkapazitaet: null,
          staerke: null,
          bemerkung: null,
          dienststatus: 'in_dienst',
          angelegt_at: '2026-05-26 09:00:00',
          ist_demo: false,
        },
      ],
    });
    await screen.findByText('Florian 1');
    await userEvent.click(screen.getByRole('button', { name: 'Fahrzeug disponieren' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Fahrzeug' }));
    await userEvent.click(await screen.findByText('Florian 3 (LF 20)'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disponieren' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Fahrzeug außer Dienst');
    expect(toasts()).toBe(0);
  });

  it('Status in der Tabelle: der Grund steht an der Zeile, die andere zeigt nichts', async () => {
    server.use(statusAbgelehnt());
    const { container } = render();
    await screen.findByText('Florian 1');
    await waehleStatus(zeile(container, 10), 'Florian 1', /vor_ort/);

    expect(await within(zeile(container, 10)).findByRole('alert')).toHaveTextContent(
      'Status abgelehnt',
    );
    expect(within(zeile(container, 11)).queryByRole('alert')).toBeNull();
    expect(toasts()).toBe(0);
  });

  it('Status und Entfernen an der Karte unter md', async () => {
    setzeViewportBreite(390);
    server.use(
      statusAbgelehnt(),
      http.delete('/api/einsaetze/7/fahrzeuge/11', () =>
        HttpResponse.json({ error: 'Fahrzeug hat Besatzung' }, { status: 409 }),
      ),
    );
    render();
    await screen.findByText('Florian 1');
    await waehleStatus(karte('Florian 1'), 'Florian 1', /vor_ort/);
    expect(await within(karte('Florian 1')).findByRole('alert')).toHaveTextContent(
      'Status abgelehnt',
    );

    await userEvent.click(within(karte('Florian 2')).getByRole('button', { name: 'Entfernen' }));
    await userEvent.click(
      within(await offeneRueckfrage()).getByRole('button', { name: 'Aus Einsatz entfernen' }),
    );
    expect(await within(karte('Florian 2')).findByRole('alert')).toHaveTextContent(
      'Fahrzeug hat Besatzung',
    );
    expect(toasts()).toBe(0);
  });

  it('Status im FMS-Tableau: der Grund steht an der Kachel', async () => {
    server.use(statusAbgelehnt());
    render({ route: '/einsaetze/7/fahrzeuge?ansicht=tableau' });
    const tableau = await screen.findByRole('region', { name: 'FMS-Tableau' });
    const kachel = () =>
      tableau.querySelector<HTMLElement>('[data-lfh="fms-kachel"][data-ef-id="10"]')!;
    await within(tableau).findByRole('button', { name: 'Status von Florian 1 ändern' });
    await waehleStatus(kachel(), 'Florian 1', /vor_ort/);

    expect(await within(kachel()).findByRole('alert')).toHaveTextContent('Status abgelehnt');
    expect(
      within(
        tableau.querySelector<HTMLElement>('[data-lfh="fms-kachel"][data-ef-id="11"]')!,
      ).queryByRole('alert'),
    ).toBeNull();
    expect(toasts()).toBe(0);
  });

  it('Bemerkung an zwei Zeilen nebenläufig: die späte Ablehnung landet an ihrer Zeile, der Wortlaut bleibt', async () => {
    const ersteAntwort = tor();
    server.use(
      http.patch('/api/einsaetze/7/fahrzeuge/10', async () => {
        await ersteAntwort.offen;
        return HttpResponse.json({ error: 'Bemerkung zu lang' }, { status: 422 });
      }),
      http.patch('/api/einsaetze/7/fahrzeuge/11', () =>
        HttpResponse.json({ ...zweites, bemerkung: 'ok' }),
      ),
    );
    const { container } = render();
    await screen.findByText('Florian 1');
    await userEvent.click(screen.getByRole('button', { name: /Spalten · 1 ausgeblendet/ }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Bemerkung' }));

    const schreibe = async (id: number, funkrufname: string, text: string) => {
      await userEvent.click(
        within(zeile(container, id)).getByRole('button', {
          name: `Bemerkung zu ${funkrufname} hinzufügen`,
        }),
      );
      const feld = within(zeile(container, id)).getByRole('textbox');
      await userEvent.type(feld, text);
      fireEvent.keyDown(feld, { keyCode: 13 });
      fireEvent.keyUp(feld, { keyCode: 13 });
    };
    await schreibe(10, 'Florian 1', 'Tank leer');
    await schreibe(11, 'Florian 2', 'Achse');
    await act(async () => ersteAntwort.frei());

    expect(await within(zeile(container, 10)).findByRole('alert')).toHaveTextContent(
      'Bemerkung zu lang',
    );
    expect(within(zeile(container, 10)).getByRole('textbox')).toHaveValue('Tank leer');
    expect(within(zeile(container, 11)).queryByRole('alert')).toBeNull();
    expect(toasts()).toBe(0);
  });

  it('Besatzung: Zuordnen und Freigeben melden im Besatzungsblock', async () => {
    server.use(
      http.put('/api/einsaetze/7/fahrzeuge/10/besatzung/101', () =>
        HttpResponse.json({ error: 'Kraft ist schon auf einem Fahrzeug' }, { status: 409 }),
      ),
      http.delete('/api/einsaetze/7/fahrzeuge/10/besatzung/100', () =>
        HttpResponse.json({ error: 'Kraft ist Fahrzeugführer' }, { status: 409 }),
      ),
    );
    const { container } = render({
      liste: [ef],
      personal: [
        person({ id: 100, name: 'Anna Crew', fahrzeug_id: 10 }),
        person({ id: 101, name: 'Bert Frei' }),
      ],
    });
    await screen.findByText('Florian 1');
    await userEvent.click(screen.getByRole('button', { name: 'Besatzung zu Florian 1' }));
    const block = () => container.querySelector<HTMLElement>('[data-lfh="besatzung-block"]')!;
    await within(block()).findByText(/Anna Crew/);

    await userEvent.click(within(block()).getByRole('combobox'));
    await userEvent.click(await screen.findByText('Bert Frei'));
    const zuordnen = await within(block()).findByRole('alert');
    expect(zuordnen).toHaveTextContent('Nicht zugeordnet');
    expect(zuordnen).toHaveTextContent('Kraft ist schon auf einem Fahrzeug');

    await userEvent.click(within(block()).getByRole('button', { name: 'Freigeben' }));
    await waitFor(() =>
      expect(within(block()).getByText('Kraft ist Fahrzeugführer')).toBeInTheDocument(),
    );
    expect(toasts()).toBe(0);
  });
});
