import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from 'antd';
import { useState } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { freigabenFixture } from '../test/fixtures';
import { renderMitProviders } from '../test/utils';
import { gewaehlteOptionen, oeffne, optionenVon, waehle } from '../test/auswahlListe';
import type { Einheit, EinsatzFahrzeug, Fahrzeug } from '../api/types';
import FahrzeugeDisponierenModal from './FahrzeugeDisponierenModal';

const fahrzeug = (id: number, funkrufname: string, felder: Partial<Fahrzeug> = {}): Fahrzeug =>
  ({
    id,
    funkrufname,
    fahrzeugtyp: 'RTW',
    ist_demo: false,
    sondersignal: true,
    dienststatus: 'im_dienst',
    angelegt_at: '2026-10-01T08:00:00Z',
    ...felder,
  }) as Fahrzeug;

const POOL: Fahrzeug[] = [
  fahrzeug(1, '83-1', { kennzeichen: 'MS-RK 831' }),
  fahrzeug(2, '83-2', { fahrzeugtyp: 'KTW' }),
  fahrzeug(3, '83-3'),
  fahrzeug(4, '83-4'),
];

const EINHEITEN = [
  { id: 20, name: 'Sanitätszug', aufgeloest_at: null },
  { id: 30, name: 'Alter Zug', aufgeloest_at: '2026-10-13T10:00:00Z' },
] as Einheit[];

/** 83-3 ist schon disponiert. */
const AKTIV = [{ id: 90, fahrzeug_id: 3, funkrufname: '83-3' }] as EinsatzFahrzeug[];
/** 83-4 ist entlassen (LLH-1079 Teil II): es kommt über „Erneut disponieren“ zurück. */
const ENTLASSEN = [
  { id: 91, fahrzeug_id: 4, funkrufname: '83-4', beendet_als: 'entlassen' },
] as EinsatzFahrzeug[];

let bodies: unknown[];

function standardHandler(freigaben = freigabenFixture()) {
  server.use(
    http.get('/api/einsaetze/1/modul-freigaben', () => HttpResponse.json(freigaben)),
    http.get('/api/fahrzeuge', () => HttpResponse.json(POOL)),
    http.get('/api/einsaetze/1/fahrzeuge', ({ request }) =>
      HttpResponse.json(new URL(request.url).searchParams.has('entlassene') ? ENTLASSEN : AKTIV),
    ),
    http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json(EINHEITEN)),
    http.post('/api/einsaetze/1/fahrzeuge/sammel', async ({ request }) => {
      const body = (await request.json()) as { fahrzeug_ids: number[] };
      bodies.push(body);
      return HttpResponse.json(
        body.fahrzeug_ids.map((id) => ({ id: 100 + id, fahrzeug_id: id })),
        { status: 201 },
      );
    }),
  );
}

beforeEach(() => {
  bodies = [];
});

function Harness({ serie = false }: { serie?: boolean }) {
  const [offen, setOffen] = useState(true);
  return (
    <>
      <Button onClick={() => setOffen(true)}>Wieder öffnen</Button>
      <FahrzeugeDisponierenModal
        offen={offen}
        einsatzId={1}
        serie={serie}
        onSchliessen={() => setOffen(false)}
      />
    </>
  );
}

describe('FahrzeugeDisponierenModal', () => {
  it('trägt die Erfassungs-Norm: keine Modal-Fusszeile, Knopf im <form>', async () => {
    standardHandler();
    renderMitProviders(<Harness />);
    const knopf = await screen.findByRole('button', { name: 'Disponieren' });
    expect(document.querySelector('.ant-modal-footer')).toBeNull();
    expect(knopf.closest('form')).not.toBeNull();
    expect(screen.getByRole('dialog', { name: 'Fahrzeuge disponieren' })).toBeInTheDocument();
  });

  /** Feldbudget (LFH-19) mit Gegenprobe über die Freigabe der Einheiten. */
  it('zeigt Auswahl und Ziel-Einheit, die Einheit nur bei Freigabe', async () => {
    standardHandler();
    const { unmount } = renderMitProviders(<Harness />);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('combobox', { name: 'In Einheit' });
    expect(dialog.querySelectorAll('.ant-form-item')).toHaveLength(2);
    unmount();

    standardHandler(freigabenFixture({ einheiten: { zugriff: false } }));
    renderMitProviders(<Harness />);
    const gesperrt = await screen.findByRole('dialog');
    await within(gesperrt).findByRole('combobox', { name: 'Fahrzeuge' });
    await new Promise((r) => setTimeout(r, 50));
    expect(gesperrt.querySelectorAll('.ant-form-item')).toHaveLength(1);
  });

  it('bietet weder disponierte noch entlassene Fahrzeuge an und sucht über das Kennzeichen', async () => {
    standardHandler();
    renderMitProviders(<Harness />);
    await screen.findByRole('dialog');
    await oeffne('Fahrzeuge');
    await waitFor(() => expect(optionenVon('Fahrzeuge')).toEqual(['83-1 (RTW)', '83-2 (KTW)']));
    await userEvent.keyboard('MS-RK');
    await waitFor(() => expect(optionenVon('Fahrzeuge')).toEqual(['83-1 (RTW)']));
  });

  it('disponiert zwei Fahrzeuge in eine Einheit in einem Absenden', async () => {
    standardHandler();
    renderMitProviders(<Harness />);
    const dialog = await screen.findByRole('dialog');
    await waehle('Fahrzeuge', '83-1 (RTW)', '83-2 (KTW)');
    await oeffne('In Einheit');
    await waitFor(() => expect(optionenVon('In Einheit')).toEqual(['Sanitätszug']));
    await waehle('In Einheit', 'Sanitätszug');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disponieren' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ fahrzeug_ids: [1, 2], einheit_id: 20 });
    expect(await screen.findByText('2 Fahrzeuge disponiert')).toBeInTheDocument();
  });

  it('behält im Serienmodus mit „Werte behalten“ die Einheit und leert die Auswahl', async () => {
    standardHandler();
    renderMitProviders(<Harness serie />);
    const dialog = await screen.findByRole('dialog');
    await waehle('Fahrzeuge', '83-1 (RTW)');
    await waehle('In Einheit', 'Sanitätszug');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Werte behalten' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern und nächste' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(await within(dialog).findByText('Erfasst: 1')).toBeInTheDocument();
    expect(within(dialog).getByText('Sanitätszug')).toBeInTheDocument();
    expect(await gewaehlteOptionen('Fahrzeuge')).toEqual([]);
  });

  it('nennt den Grund am Fahrzeug im Dialog und behält die Auswahl', async () => {
    standardHandler();
    server.use(
      http.post('/api/einsaetze/1/fahrzeuge/sammel', () =>
        HttpResponse.json(
          {
            error: 'Nicht alle Kräfte lassen sich disponieren',
            zeilen: [{ art: 'fahrzeug', id: 2, grund: 'schon disponiert' }],
          },
          { status: 422 },
        ),
      ),
    );
    renderMitProviders(<Harness />);
    const dialog = await screen.findByRole('dialog');
    await waehle('Fahrzeuge', '83-1 (RTW)', '83-2 (KTW)');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disponieren' }));

    const liste = await within(dialog).findByRole('list', { name: 'Nicht disponiert' });
    expect(liste).toHaveTextContent('83-2 (KTW) – schon disponiert');
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
    expect(await gewaehlteOptionen('Fahrzeuge')).toEqual(['83-1 (RTW)', '83-2 (KTW)']);
  });
});
