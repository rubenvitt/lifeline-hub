import { screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import BrAnlegenModal from '../bereitstellungsraum/BrAnlegenModal';
import UhsAnlegenModal from './UhsAnlegenModal';

/**
 * Standort beim Anlegen einer UHS und eines Bereitstellungsraums als Ortsfeld (LLH-1114, Spec
 * `ortsfeld`): ein Treffer oder eine getippte Koordinate geht mit Text und Koordinate in den POST,
 * Freitext nur als Text. Mutationsprobe: die Koordinate nicht abbilden → rot in „… Koordinate …“.
 */

// MapLibre läuft in jsdom nicht; der Ausschnitt hat eigene Tests (`anzeige/Kartenausschnitt.test.tsx`).
vi.mock('../../anzeige/Kartenausschnitt', () => ({
  Kartenausschnitt: ({
    punkt,
    etikett,
  }: {
    punkt: { lat: number; lon: number } | null;
    etikett: string;
  }) => (
    <div role="group" aria-label={`Karte: ${etikett}`}>
      {punkt && `${punkt.lat},${punkt.lon}`}
    </div>
  ),
}));

const TREFFER = {
  zustand: 'ok',
  treffer: [
    { lat: 53.0775, lon: 8.81, name: 'Turnhalle Nord, Musterstadt', kurz: 'Turnhalle Nord' },
  ],
};

beforeEach(() => {
  server.use(
    http.get('/api/incidents/:eid', ({ params }) =>
      HttpResponse.json({ id: Number(params.eid), einsatzort_lat: 52.1, einsatzort_lon: 8.6 }),
    ),
    http.get('/api/incidents/:eid/place-preview', () =>
      HttpResponse.json({ ortsname: null, peilung: null }),
    ),
    http.get('/api/incidents/:eid/place-search', () => HttpResponse.json(TREFFER)),
  );
});

function mitschnitt(pfad: string) {
  const rumpfe: Record<string, unknown>[] = [];
  server.use(
    http.post(pfad, async ({ request }) => {
      rumpfe.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({ id: 9, einsatz_id: 1, bezeichnung: 'X' }, { status: 201 });
    }),
  );
  return rumpfe;
}

describe.each([
  {
    was: 'UHS',
    pfad: '/api/incidents/1/uhs',
    zeige: () => renderMitProviders(<UhsAnlegenModal einsatzId={1} open onClose={vi.fn()} />),
  },
  {
    was: 'Bereitstellungsraum',
    pfad: '/api/incidents/1/staging-areas',
    zeige: () => renderMitProviders(<BrAnlegenModal einsatzId={1} open onClose={vi.fn()} />),
  },
])('$was anlegen · Standort als Ortsfeld (LLH-1114)', ({ pfad, zeige }) => {
  it('ein Treffer schickt Standort und Koordinate mit', async () => {
    const rumpfe = mitschnitt(pfad);
    zeige();
    await userEvent.type(await screen.findByLabelText('Bezeichnung'), 'Nord');
    await userEvent.type(screen.getByLabelText('Standort (optional)'), 'Turnhalle{Enter}');
    await userEvent.click(await screen.findByRole('button', { name: /Turnhalle Nord/ }));
    expect(screen.getByRole('group', { name: 'Karte: Standort' })).toHaveTextContent(
      '53.0775,8.81',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(rumpfe).toHaveLength(1));
    expect(rumpfe[0]).toMatchObject({
      bezeichnung: 'Nord',
      standort: 'Turnhalle Nord',
      lat: 53.0775,
      lon: 8.81,
    });
  });

  it('eine getippte Koordinate geht ohne Suche als Punkt mit', async () => {
    const rumpfe = mitschnitt(pfad);
    zeige();
    await userEvent.type(await screen.findByLabelText('Bezeichnung'), 'Nord');
    await userEvent.type(screen.getByLabelText('Standort (optional)'), '53.07750, 8.81000');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(rumpfe).toHaveLength(1));
    expect(rumpfe[0]).toMatchObject({ standort: '53.07750, 8.81000', lat: 53.0775, lon: 8.81 });
  });

  it('Freitext schickt nur den Standort, ohne Standort nichts davon', async () => {
    const rumpfe = mitschnitt(pfad);
    zeige();
    await userEvent.type(await screen.findByLabelText('Bezeichnung'), 'Nord');
    await userEvent.type(screen.getByLabelText('Standort (optional)'), 'Hinter der Halle');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(rumpfe).toHaveLength(1));
    expect(rumpfe[0].standort).toBe('Hinter der Halle');
    expect(rumpfe[0]).not.toHaveProperty('lat');
    expect(rumpfe[0]).not.toHaveProperty('lon');
  });
});

/** Zählt die bedienbaren Felder (wie `verpflegung/StelleDialog.test.tsx`). */
function sichtbareFelder(dialog: HTMLElement): number {
  const felder = new Set<Element>();
  for (const rolle of ['textbox', 'spinbutton', 'combobox'] as const) {
    for (const el of within(dialog).queryAllByRole(rolle)) {
      const item = el.closest('.ant-form-item');
      if (item) felder.add(item);
    }
  }
  return felder.size;
}

/**
 * Feldbudget des Dialogs (LLH-1921, design.md D2): Bezeichnung, Typ und Standort sichtbar, die
 * Notiz unter „Weitere Angaben“. Gegenprobe: Aufklappen → vier Felder.
 */
describe('UHS anlegen · Notiz unter „Weitere Angaben“ (LLH-1921)', () => {
  const zeige = () => renderMitProviders(<UhsAnlegenModal einsatzId={1} open onClose={vi.fn()} />);

  it('zeigt drei Felder, aufgeklappt vier', async () => {
    zeige();
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByLabelText('Bezeichnung');
    expect(sichtbareFelder(dialog)).toBe(3);
    await userEvent.click(within(dialog).getByRole('button', { name: /Weitere Angaben/ }));
    await waitFor(() => expect(sichtbareFelder(dialog)).toBe(4));
  });

  it('nennt eine eingetragene Notiz im Kopf und schickt sie mit', async () => {
    const rumpfe = mitschnitt('/api/incidents/1/uhs');
    zeige();
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(await within(dialog).findByLabelText('Bezeichnung'), 'Nord');
    const kopf = within(dialog).getByRole('button', { name: /Weitere Angaben/ });
    expect(kopf).not.toHaveTextContent('Notiz');
    await userEvent.click(kopf);
    await userEvent.type(within(dialog).getByLabelText('Notiz (optional)'), 'Zugang Ost');
    await userEvent.click(kopf);
    expect(kopf).toHaveTextContent('Weitere Angaben · Notiz');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(rumpfe).toHaveLength(1));
    expect(rumpfe[0]).toMatchObject({ bezeichnung: 'Nord', notiz: 'Zugang Ost' });
  });
});

/**
 * „Weitere Angaben“ beginnt bei jedem Öffnen zugeklappt (Review LLH-1921): der Dialog bleibt bei
 * Liste und Switcher eingehängt, ohne Zurücksetzen öffnete er nach einem Abbruch mit vier Feldern.
 */
describe('UHS anlegen · „Weitere Angaben“ beginnt zugeklappt', () => {
  function Harness() {
    const [offen, setOffen] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setOffen(true)}>
          Öffnen
        </button>
        <UhsAnlegenModal einsatzId={1} open={offen} onClose={() => setOffen(false)} />
      </>
    );
  }

  it('nach Abbrechen und erneutem Öffnen wieder drei Felder', async () => {
    renderMitProviders(<Harness />);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByLabelText('Bezeichnung');
    await userEvent.click(within(dialog).getByRole('button', { name: /Weitere Angaben/ }));
    await waitFor(() => expect(sichtbareFelder(dialog)).toBe(4));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Öffnen' }));
    const neu = await screen.findByRole('dialog');
    await within(neu).findByLabelText('Bezeichnung');
    await waitFor(() =>
      expect(within(neu).getByRole('button', { name: /Weitere Angaben/ })).toHaveAttribute(
        'aria-expanded',
        'false',
      ),
    );
  });
});
