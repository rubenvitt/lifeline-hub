import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PersonDetail } from '../api/types';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import PatKennzeichen from './PatKennzeichen';

/**
 * PAT-Nummer und Kontamination mit Feld-CAS (LLH-1945, Spec `formularseiten`, „Einzelangabe prüft
 * auf zwischenzeitliche Änderung“): der Wert beim Öffnen geht als `erwartet` mit; hat ein anderer
 * die Angabe inzwischen geändert, fragt der Kopf „Zwischenzeitlich geändert“.
 */
const person = {
  id: 10,
  einsatz_id: 1,
  registrier_nr: 12,
  status: 'betroffen',
  pat_nummer: 'A-1',
  kontamination: false,
} as unknown as PersonDetail;

type Body = Record<string, unknown> & { erwartet?: Record<string, unknown> };

function serverMitStand(start: PersonDetail) {
  const koerper: Body[] = [];
  let stand = { ...start };
  server.use(
    http.patch('/api/einsaetze/1/personen/10', async ({ request }) => {
      const body = (await request.json()) as Body;
      koerper.push(body);
      const alt = stand as unknown as Record<string, unknown>;
      if (body.erwartet && Object.entries(body.erwartet).some(([k, v]) => (alt[k] ?? null) !== v)) {
        return HttpResponse.json({ error: 'zwischenzeitlich geändert' }, { status: 409 });
      }
      const { erwartet: _e, ...rest } = body;
      void _e;
      stand = { ...stand, ...rest };
      return HttpResponse.json(stand);
    }),
    http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(stand)),
  );
  return {
    koerper,
    fremdAendern: (teil: Partial<PersonDetail>) => {
      stand = { ...stand, ...teil };
    },
  };
}

function renderPat() {
  const onGeschrieben = vi.fn();
  renderMitProviders(
    <PatKennzeichen einsatzId={1} person={person} bedienbar onGeschrieben={onGeschrieben} />,
  );
  return { onGeschrieben };
}

describe('PatKennzeichen', () => {
  it('schickt die PAT-Nummer mit dem Wert beim Öffnen', async () => {
    const cas = serverMitStand(person);
    const { onGeschrieben } = renderPat();
    await userEvent.click(screen.getByRole('button', { name: 'PAT-Nummer bearbeiten' }));
    const feld = screen.getByRole('textbox', { name: 'PAT-Nummer' });
    await userEvent.clear(feld);
    await userEvent.type(feld, 'B-2{Enter}');
    await waitFor(() =>
      expect(cas.koerper).toEqual([{ pat_nummer: 'B-2', erwartet: { pat_nummer: 'A-1' } }]),
    );
    await waitFor(() => expect(onGeschrieben).toHaveBeenCalledTimes(1));
  });

  it('veraltete PAT-Nummer: Rückfrage, „Meine Änderung übernehmen“ schreibt ohne Altwert', async () => {
    const cas = serverMitStand(person);
    renderPat();
    await userEvent.click(screen.getByRole('button', { name: 'PAT-Nummer bearbeiten' }));
    cas.fremdAendern({ pat_nummer: 'C-3' });
    const feld = screen.getByRole('textbox', { name: 'PAT-Nummer' });
    await userEvent.clear(feld);
    await userEvent.type(feld, 'B-2{Enter}');
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Zwischenzeitlich geändert');
    expect(dialog).toHaveTextContent(/PAT-Nummer inzwischen: „C-3“/);
    await userEvent.click(screen.getByRole('button', { name: 'Meine Änderung übernehmen' }));
    await waitFor(() => expect(cas.koerper).toHaveLength(2));
    expect(cas.koerper[1]).toEqual({ pat_nummer: 'B-2' });
  });

  it('veraltete Kontamination: Rückfrage, „Verwerfen und neu laden“ sendet nichts mehr', async () => {
    const cas = serverMitStand(person);
    const { onGeschrieben } = renderPat();
    await userEvent.click(screen.getByRole('button', { name: 'Kontamination bearbeiten' }));
    cas.fremdAendern({ kontamination: true });
    await userEvent.click(screen.getByRole('combobox', { name: 'Kontamination' }));
    await userEvent.click(await screen.findByTitle('kontaminiert'));
    await userEvent.click(screen.getByRole('button', { name: 'Kontamination speichern' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/Kontamination inzwischen: „kontaminiert“/);
    expect(cas.koerper[0]).toEqual({ kontamination: true, erwartet: { kontamination: false } });
    await userEvent.click(screen.getByRole('button', { name: 'Verwerfen und neu laden' }));
    // Verworfen schließt die Angabe (antds Dialog blendet in jsdom nur langsam aus).
    await waitFor(() =>
      expect(screen.queryByRole('combobox', { name: 'Kontamination' })).toBeNull(),
    );
    expect(cas.koerper).toHaveLength(1);
    expect(onGeschrieben).not.toHaveBeenCalled();
  });
});
