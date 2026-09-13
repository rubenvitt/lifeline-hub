import type { QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { einsatzKeys } from '../api/queryKeys';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import LagebesprechungHistorie from './LagebesprechungHistorie';

const eintrag = (lfd_nr: number, over: object = {}) => ({
  id: lfd_nr,
  einsatz_id: 1,
  lfd_nr,
  abgehalten_at: `2026-09-13 0${lfd_nr}:00:00`,
  entschluss: `Entschluss ${lfd_nr}`,
  etb_eintrag_id: 70 + lfd_nr,
  erfasst_von_id: 1,
  erfasst_at: `2026-09-13 0${lfd_nr}:00:01`,
  ...over,
});
const LEER = 'Noch keine Lagebesprechung abgeschlossen';

const FEHLER = 'Frühere Lagebesprechungen konnten nicht geladen werden';
const VERALTET = /Angezeigter Stand konnte nicht aktualisiert werden/;

function zeige(antwort: () => Response | Promise<Response>) {
  server.use(http.get('/api/einsaetze/1/stab/lagebesprechungen', antwort));
  return renderMitProviders(<LagebesprechungHistorie einsatzId={1} />);
}

/** Stellt den Handler auf 500 um und lädt über den Client des Renders neu. */
async function neuladenScheitert(client: QueryClient) {
  server.use(
    http.get('/api/einsaetze/1/stab/lagebesprechungen', () =>
      HttpResponse.json({ error: 'kaputt' }, { status: 500 }),
    ),
  );
  await act(() => client.invalidateQueries({ queryKey: einsatzKeys.stabLagebesprechungen(1) }));
}

describe('LagebesprechungHistorie', () => {
  it('zeigt die Einträge in Serverreihenfolge mit Beleg-Link und Termin-Snapshot', async () => {
    zeige(() =>
      HttpResponse.json([eintrag(2, { naechste_at: '2026-09-13 04:00:00' }), eintrag(1)]),
    );
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    const [zwei, eins] = screen.getAllByRole('listitem');
    expect(within(zwei).getByRole('heading', { level: 4 })).toHaveTextContent(/^Nr\. 2 · /);
    expect(within(eins).getByRole('heading', { level: 4 })).toHaveTextContent(/^Nr\. 1 · /);
    expect(
      within(zwei).getByRole('link', { name: 'ETB-Eintrag zu Lagebesprechung Nr. 2' }),
    ).toHaveAttribute('href', '/einsaetze/1/etb?eintrag=72');
    // Snapshot: Nr. 2 trug einen Termin, Nr. 1 keinen.
    expect(within(zwei).queryByText(/kein Termin/)).toBeNull();
    expect(within(eins).getByText(/kein Termin/)).toBeInTheDocument();
  });

  /** Titel „Nr. n · …" der Zeilen — innerhalb oder ausserhalb des Expanders. */
  const titel = (imExpander: boolean) =>
    screen
      .getAllByRole('listitem')
      .filter((li) => (li.closest('.ant-collapse') != null) === imExpander)
      .map((li) => within(li).getByRole('heading', { level: 4 }).textContent);

  /**
   * I4 (Ruling 11): die Historie steht ÜBER der Besetzung. Ab dem vierten Eintrag wächst sie
   * nicht mehr in der Höhe — ein Live-Abschluss ändert nur die Zahl im Expander-Titel.
   */
  it('zeigt die drei jüngsten; die älteren liegen eingeklappt im Expander mit Anzahl', async () => {
    zeige(() =>
      HttpResponse.json([eintrag(5), eintrag(4), eintrag(3), eintrag(2), eintrag(1)]),
    );
    const expander = await screen.findByRole('button', {
      name: /Frühere Lagebesprechungen \(2\)/,
    });
    expect(expander).toHaveAttribute('aria-expanded', 'false');
    expect(titel(false)).toEqual([
      expect.stringMatching(/^Nr\. 5 · /),
      expect.stringMatching(/^Nr\. 4 · /),
      expect.stringMatching(/^Nr\. 3 · /),
    ]);
    expect(titel(true)).toEqual([]);

    await userEvent.click(expander);
    await waitFor(() =>
      expect(titel(true)).toEqual([
        expect.stringMatching(/^Nr\. 2 · /),
        expect.stringMatching(/^Nr\. 1 · /),
      ]),
    );
    expect(titel(false)).toHaveLength(3);
  });

  it('drei Einträge → kein Expander (Gegenfall)', async () => {
    zeige(() => HttpResponse.json([eintrag(3), eintrag(2), eintrag(1)]));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(3));
    expect(screen.queryByRole('button', { name: /Frühere Lagebesprechungen/ })).toBeNull();
  });

  it('leer: sagt es beim Wort, ohne Fehler zu behaupten', async () => {
    zeige(() => HttpResponse.json([]));
    expect(await screen.findByText(LEER)).toBeInTheDocument();
    expect(screen.queryByText(/konnten nicht geladen werden/)).toBeNull();
  });

  it('Fehler ist nicht leer', async () => {
    zeige(() => HttpResponse.json({ error: 'kaputt' }, { status: 500 }));
    expect(
      await screen.findByText('Frühere Lagebesprechungen konnten nicht geladen werden'),
    ).toBeInTheDocument();
    expect(screen.queryByText(LEER)).toBeNull();
  });

  /**
   * Fehler ≠ leer auch NACH einer ersten Antwort (LFH-331 · B3): `[]` ist truthy. Eine Prüfung
   * auf den Wahrheitswert der Daten zeigte hier „Stand veraltet" über dem Leer-Text — eine
   * Aussage über eine Menge, die nach dem gescheiterten Abruf niemand kennt.
   */
  it('leer geladen, dann scheitert das Neuladen → Fehler, kein Leer-Text', async () => {
    const { client } = zeige(() => HttpResponse.json([]));
    expect(await screen.findByText(LEER)).toBeInTheDocument();

    await neuladenScheitert(client);
    expect(await screen.findByText(FEHLER)).toBeInTheDocument();
    expect(screen.queryByText(LEER)).toBeNull();
    expect(screen.queryByText(VERALTET)).toBeNull();
  });

  it('befüllt geladen, dann scheitert das Neuladen → Stand veraltet, Zeilen bleiben (Gegenfall)', async () => {
    const { client } = zeige(() => HttpResponse.json([eintrag(2), eintrag(1)]));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));

    await neuladenScheitert(client);
    expect(await screen.findByText(VERALTET)).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByText(FEHLER)).toBeNull();
  });

  it('behauptet während des Ladens weder leer noch Fehler', async () => {
    zeige(() => new Promise<never>(() => {}));
    // Positiv abwarten, dass die Liste steht (Spinner), sonst wäre das `null` unten trivial.
    await waitFor(() => expect(document.querySelector('.ant-spin-spinning')).not.toBeNull());
    expect(screen.queryByText(LEER)).toBeNull();
    expect(screen.queryByText(/konnten nicht geladen werden/)).toBeNull();
  });
});
