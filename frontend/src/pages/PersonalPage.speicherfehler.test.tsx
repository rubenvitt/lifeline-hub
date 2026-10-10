import { http, HttpResponse } from 'msw';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { offeneRueckfrage } from '../test/rueckfrage';
import { setzeViewportBreite } from '../test/viewport';
import PersonalPage from './PersonalPage';
import { adminFixture, einsatzFixture } from '../test/fixtures';

/**
 * Abgelehnte Speichervorgänge der Personalseite stehen am Ort der Handlung (LFH-1077,
 * `frontend/AGENTS.md`, „Rückwege und Fehler“): im Disponier-Dialog und an der Zeile bzw. Karte.
 * Kein Fehler-Toast; der Grund bleibt bis zum nächsten Absenden. Die Ad-hoc-Person trägt ihren
 * Fehler im eigenen Bauteil (`kraefte/AdhocPersonModal.tsx`).
 */

const ep = {
  id: 10,
  einsatz_id: 7,
  personal_id: 5,
  ist_adhoc: false,
  name: 'Thomas Müller',
  funktion: null,
  traegerorganisation: null,
  staerke_position: 'fuehrer',
  status_id: 2,
  status_label: 'alarmiert',
  status_kategorie: 'gebunden',
  status_farbe: null,
  bemerkung: null,
  disponiert_at: '2026-05-26 09:10:00',
  disponiert_von: 1,
  einheit_id: null,
  fahrzeug_id: null,
};
const zweite = { ...ep, id: 11, personal_id: 6, name: 'Sara Weber' };

const stamm = {
  id: 7,
  benutzer_id: null,
  name: 'Uwe Stamm',
  personalnummer: null,
  traegerorganisation: null,
  telefon: null,
  staerke_position: null,
  bemerkung: null,
  dienststatus: 'in_dienst',
  angelegt_at: '2026-05-26 09:00:00',
  qualifikationen: [],
  ist_demo: false,
};

function tor() {
  let frei: () => void = () => {};
  const offen = new Promise<void>((r) => (frei = r));
  return { offen, frei: () => frei() };
}

function render(liste = [ep, zweite]) {
  server.use(
    meHandler(adminFixture()),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatzFixture({ id: 7 }))),
    http.get('/api/einsaetze/7/personal', () => HttpResponse.json(liste)),
    http.get('/api/einsaetze/7/personal/zeitachse', () => HttpResponse.json([])),
    http.get('/api/einsaetze/7/einheiten', () => HttpResponse.json([])),
    http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json([])),
    http.get('/api/personal-status', () =>
      HttpResponse.json([
        { id: 2, label: 'alarmiert', kategorie: 'gebunden', farbe: null, sortier: 20 },
        { id: 3, label: 'einsatzbereit', kategorie: 'verfuegbar', farbe: null, sortier: 30 },
      ]),
    ),
    http.get('/api/personal', () => HttpResponse.json([stamm])),
  );
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/personal" element={<PersonalPage />} />
    </Routes>,
    { route: '/einsaetze/7/personal' },
  );
}

const zeile = (container: HTMLElement, id: number) =>
  container.querySelector<HTMLElement>(`[data-row-key="${id}"]`)!;
const toasts = () => document.querySelectorAll('.ant-message-notice').length;

async function waehleStatus(wurzel: HTMLElement, name: string, label: RegExp) {
  await userEvent.click(within(wurzel).getByRole('button', { name: `Status von ${name} ändern` }));
  const menue = [...document.querySelectorAll<HTMLElement>('.ant-dropdown')]
    .filter((d) => !d.classList.contains('ant-dropdown-hidden') && d.style.pointerEvents !== 'none')
    .pop()!;
  await userEvent.click(within(menue).getByRole('menuitem', { name: label }));
}

describe('PersonalPage · Speicherfehler am Ort (LFH-1077)', () => {
  it('Disponieren: der Grund steht im Dialog, das nächste Absenden räumt ihn, Abbrechen und Öffnen zeigen ihn nicht', async () => {
    const zweiterVersuch = tor();
    let versuche = 0;
    server.use(
      http.post('/api/einsaetze/7/personal', async () => {
        versuche += 1;
        if (versuche > 1) await zweiterVersuch.offen;
        return HttpResponse.json({ error: 'Person ist in einem anderen Einsatz' }, { status: 409 });
      }),
    );
    render();
    await screen.findByText('Thomas Müller');
    await userEvent.click(screen.getByRole('button', { name: 'Person disponieren' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Person' }));
    await userEvent.click(await screen.findByText('Uwe Stamm'));
    const knopf = within(dialog).getByRole('button', { name: 'Disponieren' });
    await userEvent.click(knopf);

    const grund = await within(dialog).findByRole('alert');
    expect(grund).toHaveTextContent('Nicht disponiert');
    expect(grund).toHaveTextContent('Person ist in einem anderen Einsatz');
    expect(toasts()).toBe(0);

    await userEvent.click(knopf);
    await waitFor(() => expect(within(dialog).queryByRole('alert')).toBeNull());
    await act(async () => zweiterVersuch.frei());
    await within(dialog).findByRole('alert');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Person disponieren' }));
    expect(within(await screen.findByRole('dialog')).queryByRole('alert')).toBeNull();
    expect(toasts()).toBe(0);
  });

  it('Status und Position: der Grund steht an der Zeile, der nächste Wechsel räumt ihn', async () => {
    const naechster = tor();
    let versuche = 0;
    server.use(
      http.patch('/api/einsaetze/7/personal/10', async () => {
        versuche += 1;
        if (versuche === 1) {
          return HttpResponse.json({ error: 'Status abgelehnt' }, { status: 409 });
        }
        await naechster.offen;
        return HttpResponse.json({ error: 'Position abgelehnt' }, { status: 422 });
      }),
    );
    const { container } = render();
    await screen.findByText('Thomas Müller');
    await waehleStatus(zeile(container, 10), 'Thomas Müller', /einsatzbereit/);
    expect(await within(zeile(container, 10)).findByRole('alert')).toHaveTextContent(
      'Status abgelehnt',
    );
    expect(within(zeile(container, 11)).queryByRole('alert')).toBeNull();

    // Die Stärke-Position derselben Zeile ist die nächste Aktion: sie räumt den alten Grund.
    const leeren = zeile(container, 10).querySelector('.ant-select-clear')!;
    fireEvent.mouseDown(leeren);
    fireEvent.click(leeren);
    await waitFor(() => expect(within(zeile(container, 10)).queryByRole('alert')).toBeNull());
    await act(async () => naechster.frei());
    expect(await within(zeile(container, 10)).findByRole('alert')).toHaveTextContent(
      'Position abgelehnt',
    );
    expect(toasts()).toBe(0);
  });

  it('Entfernen an zwei Zeilen nebenläufig: die späte Ablehnung landet an ihrer Zeile', async () => {
    const ersteAntwort = tor();
    server.use(
      http.delete('/api/einsaetze/7/personal/10', async () => {
        await ersteAntwort.offen;
        return HttpResponse.json({ error: 'Kraft ist Fahrzeugführer' }, { status: 409 });
      }),
      http.delete('/api/einsaetze/7/personal/11', () => new HttpResponse(null, { status: 204 })),
    );
    const { container } = render();
    await screen.findByText('Thomas Müller');
    await userEvent.click(within(zeile(container, 10)).getByRole('button', { name: 'Entfernen' }));
    await userEvent.click(
      within(await offeneRueckfrage()).getByRole('button', { name: 'Aus Einsatz entfernen' }),
    );
    await userEvent.click(within(zeile(container, 11)).getByRole('button', { name: 'Entfernen' }));
    const offen = [
      ...document.querySelectorAll<HTMLElement>('.ant-popconfirm:not(.ant-popover-hidden)'),
    ].pop()!;
    await userEvent.click(within(offen).getByRole('button', { name: 'Aus Einsatz entfernen' }));
    await act(async () => ersteAntwort.frei());

    expect(await within(zeile(container, 10)).findByRole('alert')).toHaveTextContent(
      'Kraft ist Fahrzeugführer',
    );
    expect(within(zeile(container, 11)).queryByRole('alert')).toBeNull();
    expect(toasts()).toBe(0);
  });

  it('Bemerkung: das Feld wartet und bleibt bei Ablehnung mit dem Wortlaut offen', async () => {
    setzeViewportBreite(1600);
    server.use(
      http.patch('/api/einsaetze/7/personal/10', () =>
        HttpResponse.json({ error: 'Bemerkung zu lang' }, { status: 422 }),
      ),
    );
    const { container } = render();
    await screen.findByText('Thomas Müller');
    await userEvent.click(screen.getByRole('button', { name: /Spalten · 1 ausgeblendet/ }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Bemerkung' }));
    await userEvent.click(
      within(zeile(container, 10)).getByRole('button', {
        name: 'Bemerkung zu Thomas Müller hinzufügen',
      }),
    );
    const feld = within(zeile(container, 10)).getByRole('textbox');
    await userEvent.type(feld, 'Knie verletzt');
    fireEvent.keyDown(feld, { keyCode: 13 });
    fireEvent.keyUp(feld, { keyCode: 13 });

    expect(await within(zeile(container, 10)).findByRole('alert')).toHaveTextContent(
      'Bemerkung zu lang',
    );
    expect(within(zeile(container, 10)).getByRole('textbox')).toHaveValue('Knie verletzt');
    expect(toasts()).toBe(0);
  });

  it('unter md steht der Grund an der Karte', async () => {
    setzeViewportBreite(390);
    server.use(
      http.patch('/api/einsaetze/7/personal/10', () =>
        HttpResponse.json({ error: 'Status abgelehnt' }, { status: 409 }),
      ),
    );
    render();
    await screen.findByText('Thomas Müller');
    const karte = (name: string) =>
      screen.getByText(name).closest<HTMLElement>('[data-lfh="datensicht-karte"]')!;
    await waehleStatus(karte('Thomas Müller'), 'Thomas Müller', /einsatzbereit/);

    expect(await within(karte('Thomas Müller')).findByRole('alert')).toHaveTextContent(
      'Status abgelehnt',
    );
    expect(within(karte('Sara Weber')).queryByRole('alert')).toBeNull();
    expect(toasts()).toBe(0);
  });
});
