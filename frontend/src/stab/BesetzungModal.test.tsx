import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Stabsfunktion } from '../api/types';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import BesetzungModal from './BesetzungModal';
import { SACHGEBIETE } from './sachgebiete';

const S2 = SACHGEBIETE[1];
const personal = [
  { id: 99, einsatz_id: 1, name: 'Schulz', funktion: 'Sanitäter' },
  { id: 7, einsatz_id: 1, name: 'Müller', funktion: 'Zugführer' },
];

let puts: unknown[];
let deletes: number;
beforeEach(() => {
  puts = [];
  deletes = 0;
  server.use(
    http.get('/api/einsaetze/1/personal', () => HttpResponse.json(personal)),
    http.put('/api/einsaetze/1/stab/besetzung/s2', async ({ request }) => {
      puts.push(await request.json());
      return HttpResponse.json({ anzahl_lagebesprechungen: 0, besetzung: [] });
    }),
    http.delete('/api/einsaetze/1/stab/besetzung/s2', () => {
      deletes += 1;
      return new HttpResponse(null, { status: 204 });
    }),
  );
});

function rendere(zeile: Stabsfunktion | undefined, onSchliessen = vi.fn()) {
  renderMitProviders(
    <BesetzungModal einsatzId={1} eintrag={S2} zeile={zeile} onSchliessen={onSchliessen} />,
  );
  return onSchliessen;
}

/** Offene Liste greifen, nicht die Portale geschlossener Dropdowns (antd lässt sie stehen). */
async function waehle(feld: string, option: string) {
  await userEvent.click(screen.getByRole('combobox', { name: feld }));
  const knoten = await waitFor(() => {
    const k = document.querySelector<HTMLElement>(
      `.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="${option}"]`,
    );
    expect(k).not.toBeNull();
    return k!;
  });
  await userEvent.click(knoten);
}

describe('BesetzungModal', () => {
  /**
   * Das erste Feld ist ein Select — „Enter sendet" ist für diese Maske nicht belegbar
   * (rc-select verschluckt Enter). Geprüft wird die Struktur, aus der die Zusicherung folgt.
   */
  it('trägt die Erfassungs-Norm: keine Modal-Fusszeile, Knopf im <form>', async () => {
    rendere(undefined);
    const knopf = await screen.findByRole('button', { name: 'Übernehmen' });
    expect(document.querySelector('.ant-modal-footer')).toBeNull();
    expect(knopf.closest('form')).not.toBeNull();
    expect(screen.getByRole('dialog', { name: 'Besetzung S2 · Lage' })).toBeInTheDocument();
  });

  it('leere Zeile, „nicht vergeben" bestätigt → 0 Requests, kein Fehler, Maske schliesst', async () => {
    const onSchliessen = rendere(undefined);
    await userEvent.click(await screen.findByRole('button', { name: 'Übernehmen' }));
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
    expect(puts).toEqual([]);
    expect(deletes).toBe(0);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('leere Zeile, Person gewählt → genau ein PUT mit der Dispositions-ID', async () => {
    const onSchliessen = rendere(undefined);
    await screen.findByRole('button', { name: 'Übernehmen' });
    await waehle('Besetzung', 'disponierte Person');
    await waehle('Person', 'Schulz');
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
    expect(puts).toEqual([{ besetzung_art: 'personal', personal_id: 99 }]);
    expect(deletes).toBe(0);
  });

  it('belegte Zeile, „nicht vergeben" → genau ein DELETE', async () => {
    const zeile: Stabsfunktion = {
      sachgebiet: 's2',
      besetzung_art: 'personal',
      personal_id: 7,
      name: 'Müller',
      personal_noch_disponiert: true,
      gesetzt_at: '2026-09-13 10:00:00',
      gesetzt_von_id: 1,
    };
    const onSchliessen = rendere(zeile);
    await screen.findByRole('button', { name: 'Übernehmen' });
    await waehle('Besetzung', 'nicht vergeben');
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
    expect(deletes).toBe(1);
    expect(puts).toEqual([]);
  });

  it('extern verlangt eine Bezeichnung und schickt nur sie', async () => {
    const onSchliessen = rendere(undefined);
    await screen.findByRole('button', { name: 'Übernehmen' });
    await waehle('Besetzung', 'extern (nicht disponiert)');
    await userEvent.type(screen.getByLabelText('Bezeichnung'), 'Dr. Weber');
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
    expect(puts).toEqual([{ besetzung_art: 'extern', bezeichnung: 'Dr. Weber' }]);
  });

  it('bietet die Ad-hoc-Anlage als letzten Eintrag der Personenwahl an', async () => {
    rendere(undefined);
    await screen.findByRole('button', { name: 'Übernehmen' });
    await waehle('Besetzung', 'disponierte Person');
    await waehle('Person', 'Ad-hoc-Person anlegen …');
    // Nicht über `getByRole('dialog', { name })`: im Test vergibt antd jedem Modal-Titel dieselbe
    // id (`aria-labelledby="test-id"`), mit zwei offenen Dialogen zeigt der Name beider auf den
    // ersten Titel. Der Griff über den Titeltext prüft dieselbe Aussage.
    const titel = await screen.findByText('Ad-hoc-Person disponieren');
    expect(titel.closest('.ant-modal')).not.toBeNull();
  });

  /**
   * Ruling 4: eine abgebrochene Ad-hoc-Anlage lässt die Person LEER — auch in der Anzeige. Mit
   * `undefined` fiele rc-select auf seinen inneren Zustand zurück und zeigte weiter
   * „Ad-hoc-Person anlegen …" als Wert, während der Speicher leer ist (gemessen).
   */
  it('abgebrochene Ad-hoc-Anlage: Person leer, Übernehmen meldet die Pflicht, kein Request', async () => {
    const onSchliessen = rendere(undefined);
    await screen.findByRole('button', { name: 'Übernehmen' });
    await waehle('Besetzung', 'disponierte Person');
    await waehle('Person', 'Ad-hoc-Person anlegen …');
    const adhoc = (await screen.findByText('Ad-hoc-Person disponieren')).closest<HTMLElement>(
      '.ant-modal',
    )!;
    await userEvent.click(within(adhoc).getByRole('button', { name: 'Abbrechen' }));

    const personFeld = screen.getByRole('combobox', { name: 'Person' }).closest('.ant-select')!;
    expect(personFeld).not.toHaveTextContent('Ad-hoc-Person anlegen …');

    const besetzung = screen.getByText('Besetzung S2 · Lage').closest<HTMLElement>('.ant-modal')!;
    await userEvent.click(within(besetzung).getByRole('button', { name: 'Übernehmen' }));
    expect(await screen.findByText('Person wählen')).toBeInTheDocument();
    expect(onSchliessen).not.toHaveBeenCalled();
    expect(puts).toEqual([]);
  });
});
