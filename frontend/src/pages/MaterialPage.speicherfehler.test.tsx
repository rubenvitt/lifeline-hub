import { http, HttpResponse } from 'msw';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { offeneRueckfrage } from '../test/rueckfrage';
import MaterialPage from './MaterialPage';
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
    http.get('/api/einsaetze/1/material', () => HttpResponse.json(liste)),
    http.get('/api/material', () => HttpResponse.json(pool)),
    http.get('/api/einsaetze/1/personal', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
  );
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/material" element={<MaterialPage />} />
    </Routes>,
    { route: '/einsaetze/1/material' },
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

  it('Entfernen an zwei Zeilen nebenläufig: die späte Ablehnung landet an ihrer Zeile', async () => {
    const ersteAntwort = tor();
    server.use(
      http.delete('/api/einsaetze/1/material/10', async () => {
        await ersteAntwort.offen;
        return HttpResponse.json(
          { error: 'Material ist einer Einheit zugeordnet' },
          { status: 409 },
        );
      }),
      http.delete('/api/einsaetze/1/material/11', () => new HttpResponse(null, { status: 204 })),
    );
    const { container } = render();
    await screen.findByText('Wolldecke');

    await userEvent.click(within(zeile(container, 10)).getByRole('button', { name: 'Entfernen' }));
    await userEvent.click(
      within(await offeneRueckfrage()).getByRole('button', { name: 'Aus Einsatz entfernen' }),
    );
    // Die zweite Zeile schreibt, bevor die erste Antwort da ist.
    await userEvent.click(within(zeile(container, 11)).getByRole('button', { name: 'Entfernen' }));
    const offen = [
      ...document.querySelectorAll<HTMLElement>('.ant-popconfirm:not(.ant-popover-hidden)'),
    ].pop()!;
    await userEvent.click(within(offen).getByRole('button', { name: 'Aus Einsatz entfernen' }));
    await act(async () => ersteAntwort.frei());

    expect(await within(zeile(container, 10)).findByRole('alert')).toHaveTextContent(
      'Material ist einer Einheit zugeordnet',
    );
    expect(within(zeile(container, 11)).queryByRole('alert')).toBeNull();
    expect(toasts()).toBe(0);
  });

  it('Menge: der Grund steht an der Zeile, das Feld bleibt bedienbar und sendet erneut', async () => {
    const gesendet: unknown[] = [];
    server.use(
      http.patch('/api/einsaetze/1/material/10', async ({ request }) => {
        gesendet.push(await request.json());
        return HttpResponse.json({ error: 'Menge übersteigt den Bestand' }, { status: 422 });
      }),
    );
    const { container } = render();
    await screen.findByText('Wolldecke');
    const feld = within(zeile(container, 10)).getByRole('spinbutton', { name: 'Menge Wolldecke' });
    fireEvent.change(feld, { target: { value: '70' } });
    fireEvent.blur(feld);

    expect(await within(zeile(container, 10)).findByRole('alert')).toHaveTextContent(
      'Menge übersteigt den Bestand',
    );
    expect(feld).toHaveValue('70');
    expect(toasts()).toBe(0);

    // Nach der Ablehnung sperrt das Feld nicht: ein neuer Wert geht hinaus.
    fireEvent.change(feld, { target: { value: '60' } });
    fireEvent.blur(feld);
    await waitFor(() => expect(gesendet).toEqual([{ menge: 70 }, { menge: 60 }]));
  });

  it('Menge: nach einer Ablehnung schickt das Verlassen denselben Wert nicht noch einmal, Enter schon', async () => {
    const gesendet: unknown[] = [];
    server.use(
      http.patch('/api/einsaetze/1/material/10', async ({ request }) => {
        gesendet.push(await request.json());
        return HttpResponse.json({ error: 'Menge übersteigt den Bestand' }, { status: 422 });
      }),
    );
    const { container } = render();
    await screen.findByText('Wolldecke');
    const feld = within(zeile(container, 10)).getByRole('spinbutton', { name: 'Menge Wolldecke' });
    fireEvent.change(feld, { target: { value: '70' } });
    fireEvent.blur(feld);
    expect(await within(zeile(container, 10)).findByRole('alert')).toHaveTextContent(
      'Menge übersteigt den Bestand',
    );

    // Erneut hinein- und hinausklicken: kein zweiter Versuch mit dem abgelehnten Wert.
    fireEvent.focus(feld);
    fireEvent.blur(feld);
    await act(async () => {});
    expect(gesendet).toEqual([{ menge: 70 }]);

    // Enter ist der ausdrückliche Wiederholungsweg.
    fireEvent.keyDown(feld, { key: 'Enter', code: 'Enter', keyCode: 13 });
    await waitFor(() => expect(gesendet).toEqual([{ menge: 70 }, { menge: 70 }]));
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

    await waehle(/verbraucht/);
    await waitFor(() => expect(within(zeile(container, 10)).queryByRole('alert')).toBeNull());
    await act(async () => zweiterVersuch.frei());
  });
});
