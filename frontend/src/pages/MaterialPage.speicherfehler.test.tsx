import { http, HttpResponse } from 'msw';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import MaterialPage from './MaterialPage';
import { waehle } from '../test/auswahlListe';
import { adminFixture, einsatzFixture } from '../test/fixtures';

/**
 * Abgelehnte Speichervorgänge der Materialseite stehen am Ort der Handlung (LFH-1077,
 * `frontend/AGENTS.md`, „Rückwege und Fehler“): im Disponier-Dialog, an der Zeile. Kein
 * Fehler-Toast; der Grund bleibt bis zum nächsten Absenden.
 */

const em = {
  id: 10,
  einsatz_id: 1,
  material_id: 5,
  einheit_id: null,
  ist_adhoc: false,
  bezeichnung: 'Wolldecke',
  kategorie: 'Betreuung',
  bestandsnummer: null,
  traegerorganisation: null,
  menge: 50,
  status: 'einsatzbereit',
  art: 'verbrauchsgut',
  ausgegeben: 0,
  bemerkung: null,
  disponiert_at: '2026-05-27 09:00:00',
  disponiert_von: 1,
};
const zweites = { ...em, id: 11, material_id: 6, bezeichnung: 'Zeltbahn' };

const pool = [
  {
    id: 5,
    bezeichnung: 'Feldbett',
    kategorie: 'Betreuung',
    bestandsnummer: null,
    traegerorganisation: null,
    standort: null,
    bemerkung: null,
    dienststatus: 'in_dienst',
    angelegt_at: '2026-05-26 09:00:00',
    ist_demo: false,
  },
];

/** Eine zurückgehaltene Antwort; `frei` gibt sie heraus. */
function tor() {
  let frei: () => void = () => {};
  const offen = new Promise<void>((r) => (frei = r));
  return { offen, frei: () => frei() };
}

function render(liste = [em, zweites]) {
  server.use(
    meHandler(adminFixture()),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzFixture())),
    http.get('/api/einsaetze/1/material', ({ request }) =>
      HttpResponse.json(new URL(request.url).searchParams.has('entlassene') ? [] : liste),
    ),
    http.get('/api/material', () => HttpResponse.json(pool)),
    // Orte für die Spalte „Ort“ (LLH-1225).
    http.get('/api/einsaetze/1/einheiten', () =>
      HttpResponse.json([{ id: 1, name: 'Staffel A', ueber_einheit_id: null, abschnitt_id: null }]),
    ),
    http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/bereitstellungsraeume', () => HttpResponse.json([])),
  );
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/material" element={<MaterialPage />} />
    </Routes>,
    { route: '/einsaetze/1/material', datenRouter: true },
  );
}

const zeile = (container: HTMLElement, id: number) =>
  container.querySelector<HTMLElement>(`[data-row-key="${id}"]`)!;
const toasts = () => document.querySelectorAll('.ant-message-notice').length;

describe('MaterialPage · Speicherfehler am Ort (LFH-1077)', () => {
  it('Disponieren: der Grund steht im Dialog, das nächste Absenden räumt ihn, Abbrechen und Öffnen zeigen ihn nicht', async () => {
    const zweiterVersuch = tor();
    let versuche = 0;
    server.use(
      http.post('/api/einsaetze/1/material', async () => {
        versuche += 1;
        if (versuche === 1) {
          return HttpResponse.json({ error: 'Material nicht im Dienst' }, { status: 409 });
        }
        await zweiterVersuch.offen;
        return HttpResponse.json({ error: 'Material nicht im Dienst' }, { status: 409 });
      }),
    );
    render([]);
    await screen.findByText('Noch kein Material disponiert');
    await userEvent.click(screen.getByRole('button', { name: 'Material disponieren' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Material' }));
    await userEvent.click(await screen.findByText('Feldbett (Betreuung)'));
    const knopf = within(dialog).getByRole('button', { name: 'Disponieren' });
    await userEvent.click(knopf);

    const grund = await within(dialog).findByRole('alert');
    expect(grund).toHaveTextContent('Nicht disponiert');
    expect(grund).toHaveTextContent('Material nicht im Dienst');
    expect(toasts()).toBe(0);

    await userEvent.click(knopf);
    await waitFor(() => expect(within(dialog).queryByRole('alert')).toBeNull());
    await act(async () => zweiterVersuch.frei());
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Material nicht im Dienst');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Material disponieren' }));
    const wieder = await screen.findByRole('dialog');
    expect(within(wieder).queryByRole('alert')).toBeNull();
    expect(toasts()).toBe(0);
  });

  it('Ad-hoc: der Grund steht im Dialog, der Wortlaut bleibt, kein Toast', async () => {
    server.use(
      http.post('/api/einsaetze/1/material', () =>
        HttpResponse.json({ error: 'Bezeichnung zu lang' }, { status: 422 }),
      ),
    );
    render([]);
    await screen.findByText('Noch kein Material disponiert');
    await userEvent.click(screen.getByRole('button', { name: 'Ad-hoc-Material' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Bezeichnung' }), 'Decken');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disponieren' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Bezeichnung zu lang');
    expect(within(dialog).getByRole('textbox', { name: 'Bezeichnung' })).toHaveValue('Decken');
    expect(toasts()).toBe(0);
  });

  it('Herausnehmen an zwei Zeilen nebenläufig: die späte Ablehnung landet an ihrer Zeile', async () => {
    const ersteAntwort = tor();
    server.use(
      http.post('/api/einsaetze/1/material/10/entlassen', async () => {
        await ersteAntwort.offen;
        return HttpResponse.json(
          { error: 'Das Material ist bereits aus dem Einsatz genommen' },
          { status: 409 },
        );
      }),
      http.post('/api/einsaetze/1/material/11/entlassen', () =>
        HttpResponse.json({ ...zweites, beendet_als: 'entlassen' }),
      ),
    );
    const { container } = render();
    await screen.findByText('Wolldecke');

    await userEvent.click(
      within(zeile(container, 10)).getByRole('button', {
        name: 'Wolldecke aus dem Einsatz nehmen',
      }),
    );
    // Die zweite Zeile schreibt, bevor die erste Antwort da ist.
    await userEvent.click(
      within(zeile(container, 11)).getByRole('button', { name: 'Zeltbahn aus dem Einsatz nehmen' }),
    );
    await act(async () => ersteAntwort.frei());

    expect(await within(zeile(container, 10)).findByRole('alert')).toHaveTextContent(
      'Das Material ist bereits aus dem Einsatz genommen',
    );
    expect(within(zeile(container, 11)).queryByRole('alert')).toBeNull();
    // Der Erfolg der zweiten trägt den Rückgängig-Toast; ein Fehler-Toast steht nirgends.
    expect(document.querySelectorAll('.ant-message-error')).toHaveLength(0);
  });

  // Der Ort speichert nur ausdrücklich (LLH-1225 D3), nie beim Verlassen; die Ablehnung zeigt die
  // `InlineAngabe` selbst an der Zeile.
  it('Ort: der Grund steht an der Zeile, Verlassen sendet nie, „Speichern“ wiederholt', async () => {
    const gesendet: unknown[] = [];
    server.use(
      http.patch('/api/einsaetze/1/material/10', async ({ request }) => {
        gesendet.push(await request.json());
        return HttpResponse.json({ error: 'Einheit ist aufgelöst' }, { status: 422 });
      }),
    );
    const { container } = render();
    await screen.findByText('Wolldecke');
    await userEvent.click(
      within(zeile(container, 10)).getByRole('button', { name: 'Ort zu Wolldecke bearbeiten' }),
    );
    await waehle('Ort zu Wolldecke', 'Staffel A');
    fireEvent.blur(screen.getByRole('combobox', { name: 'Ort zu Wolldecke' }));
    await act(async () => {});
    expect(gesendet).toEqual([]);

    await userEvent.click(
      within(zeile(container, 10)).getByRole('button', { name: 'Ort zu Wolldecke speichern' }),
    );
    expect(await within(zeile(container, 10)).findByRole('alert')).toHaveTextContent(
      'Einheit ist aufgelöst',
    );
    expect(within(zeile(container, 11)).queryByRole('alert')).toBeNull();
    expect(toasts()).toBe(0);

    await userEvent.click(
      within(zeile(container, 10)).getByRole('button', { name: 'Ort zu Wolldecke speichern' }),
    );
    await waitFor(() => expect(gesendet).toEqual([{ einheit_id: 1 }, { einheit_id: 1 }]));
  });

  it('Menge ändern: der Grund steht im Dialog, kein Toast', async () => {
    server.use(
      http.patch('/api/einsaetze/1/material/10', () =>
        HttpResponse.json({ error: 'Menge kleiner als die Ausgabe' }, { status: 422 }),
      ),
    );
    const { container } = render();
    await screen.findByText('Wolldecke');
    await userEvent.click(
      within(zeile(container, 10)).getByRole('button', { name: 'Weitere Aktionen zu Wolldecke' }),
    );
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Menge ändern …' }));
    const dialog = await screen.findByRole('dialog');
    const feld = within(dialog).getByRole('spinbutton', { name: 'Menge' });
    await waitFor(() => expect(feld).toHaveValue('50'));
    fireEvent.change(feld, { target: { value: '70' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(await within(dialog).findByText(/Menge kleiner als die Ausgabe/)).toBeInTheDocument();
    expect(toasts()).toBe(0);
  });

  it('Bemerkung: das Feld wartet, bleibt bei Ablehnung mit dem Wortlaut offen, der Grund steht an der Zeile', async () => {
    server.use(
      http.patch('/api/einsaetze/1/material/10', () =>
        HttpResponse.json({ error: 'Bemerkung zu lang' }, { status: 422 }),
      ),
    );
    const { container } = render();
    await screen.findByText('Wolldecke');
    await userEvent.click(
      within(zeile(container, 10)).getByRole('button', {
        name: 'Bemerkung zu Wolldecke hinzufügen',
      }),
    );
    const feld = within(zeile(container, 10)).getByRole('textbox');
    await userEvent.type(feld, 'nass geworden');
    fireEvent.keyDown(feld, { keyCode: 13 });
    fireEvent.keyUp(feld, { keyCode: 13 });

    expect(await within(zeile(container, 10)).findByRole('alert')).toHaveTextContent(
      'Bemerkung zu lang',
    );
    expect(within(zeile(container, 10)).getByRole('textbox')).toHaveValue('nass geworden');
    expect(within(zeile(container, 11)).queryByRole('alert')).toBeNull();
    expect(toasts()).toBe(0);
  });

  it('Status: die Ablehnung steht an der Zeile, der nächste Wechsel räumt sie', async () => {
    const zweiterVersuch = tor();
    let versuche = 0;
    server.use(
      http.patch('/api/einsaetze/1/material/10', async () => {
        versuche += 1;
        if (versuche > 1) await zweiterVersuch.offen;
        return HttpResponse.json({ error: 'Status abgelehnt' }, { status: 409 });
      }),
    );
    const { container } = render();
    await screen.findByText('Wolldecke');
    const waehle = async (label: RegExp) => {
      await userEvent.click(
        within(zeile(container, 10)).getByRole('button', { name: 'Status von Wolldecke ändern' }),
      );
      const menue = [...document.querySelectorAll<HTMLElement>('.ant-dropdown')]
        .filter(
          (d) => !d.classList.contains('ant-dropdown-hidden') && d.style.pointerEvents !== 'none',
        )
        .pop()!;
      await userEvent.click(within(menue).getByRole('menuitem', { name: label }));
    };

    await waehle(/defekt/);
    expect(await within(zeile(container, 10)).findByRole('alert')).toHaveTextContent(
      'Status abgelehnt',
    );
    expect(toasts()).toBe(0);

    await waehle(/im Einsatz/);
    await waitFor(() => expect(within(zeile(container, 10)).queryByRole('alert')).toBeNull());
    await act(async () => zweiterVersuch.frei());
  });
});
