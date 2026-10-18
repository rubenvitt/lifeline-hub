import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import SichtungDialog from './SichtungDialog';

/**
 * Die Nachsichtung ohne Dropdown (LLH-1083, Spec `sichtungswahl`, „Nachsichtung ohne Dropdown“):
 * eine Fläche, dann „Übernehmen“ — zwei Tipps nach dem Öffnen.
 */
let gesendet: Record<string, unknown>[];

beforeEach(() => {
  gesendet = [];
  server.use(
    http.post('/api/einsaetze/1/personen/2/sichtung', async ({ request }) => {
      gesendet.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json(
        { id: 9, person_id: 2, kategorie: 'sk1', gesichtet_at: '', gesichtet_von: 1 },
        { status: 201 },
      );
    }),
  );
});

function zeige() {
  const onErfasst = vi.fn();
  const onSchliessen = vi.fn();
  renderMitProviders(
    <SichtungDialog
      einsatzId={1}
      personId={2}
      offen
      onErfasst={onErfasst}
      onSchliessen={onSchliessen}
    />,
  );
  return { onErfasst, onSchliessen };
}

describe('SichtungDialog (LLH-1083)', () => {
  it('wählt über Flächen, nicht über ein Dropdown', () => {
    zeige();
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByRole('radiogroup', { name: 'Sichtungskategorie' }),
    ).toBeInTheDocument();
    expect(within(dialog).getAllByRole('radio')).toHaveLength(6);
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('speichert mit zwei Tipps: Fläche, Übernehmen', async () => {
    const { onErfasst } = zeige();
    await userEvent.click(screen.getByRole('radio', { name: /^SK I,/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    await waitFor(() => expect(onErfasst).toHaveBeenCalledTimes(1));
    expect(gesendet).toEqual([{ kategorie: 'sk1', notiz: null }]);
  });

  it('verlangt eine Kategorie, bevor es speichert', async () => {
    const { onErfasst } = zeige();
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    expect(await screen.findByText('Bitte eine Sichtungskategorie wählen')).toBeInTheDocument();
    expect(onErfasst).not.toHaveBeenCalled();
    expect(gesendet).toHaveLength(0);
  });
});
