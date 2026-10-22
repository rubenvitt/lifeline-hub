import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import { freigabenFixture } from '../../test/fixtures';
import type { Einheit, EinsatzMaterial, ModulFreigaben } from '../../api/types';
import { buildEinheitRechte } from './einheitAnsichtKern';
import EinheitMaterial from './EinheitMaterial';

/**
 * Paneel „Material“ der Einheit-Ansicht (LLH-1036 Teil II, design.md D11; seit LLH-1225 D10 mit
 * dem Baustein `MaterialAmOrt`): Meta „n Posten · k Ausfall“, Menge und Status je Posten,
 * Zuordnen und Lösen über den einen Schreibweg (PATCH an die Disposition, Recht Material), nie
 * über die Einheiten-Routen.
 */

const einheit = {
  id: 10,
  name: '1. Zug',
  material_mitglieder: [
    {
      em_id: 40,
      bezeichnung: 'Tragkraftspritze',
      art: 'geraet',
      menge: 1,
      ausgegeben: 0,
      status: 'einsatzbereit',
    },
    {
      em_id: 41,
      bezeichnung: 'Schlauch B',
      art: 'geraet',
      menge: 1,
      ausgegeben: 0,
      status: 'defekt',
    },
    {
      em_id: 42,
      bezeichnung: 'Wolldecke',
      art: 'verbrauchsgut',
      menge: 20,
      ausgegeben: 5,
      status: 'im_einsatz',
    },
  ],
} as unknown as Einheit;

const LISTE = [
  {
    id: 50,
    bezeichnung: 'Stromerzeuger',
    art: 'geraet',
    menge: 1,
    ausgegeben: 0,
    status: 'einsatzbereit',
    einheit_id: null,
  },
  {
    id: 40,
    bezeichnung: 'Tragkraftspritze',
    art: 'geraet',
    menge: 1,
    ausgegeben: 0,
    status: 'einsatzbereit',
    einheit_id: 10,
    kategorie: 'Brandbekämpfung',
  },
] as unknown as EinsatzMaterial[];

function zeige({
  freigaben = freigabenFixture(),
  darfSchreiben = true,
  material = einheit,
}: {
  freigaben?: ModulFreigaben;
  darfSchreiben?: boolean;
  material?: Einheit;
} = {}) {
  server.use(
    http.get('/api/einsaetze/1/modul-freigaben', () => HttpResponse.json(freigaben)),
    http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/abschnitte', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([])),
  );
  const rechte = buildEinheitRechte(darfSchreiben, freigaben);
  return renderMitProviders(
    <EinheitMaterial
      einsatzId={1}
      einheit={material}
      rechte={rechte}
      materialList={{
        data: rechte.hasMaterialListe ? LISTE : undefined,
        isError: false,
        error: null,
      }}
    />,
  );
}

const paneel = () => screen.getByRole('region', { name: 'Material' });
const zeile = (text: string) =>
  within(paneel()).getByText(text).closest('[data-lfh="material-am-ort-zeile"]') as HTMLElement;

function patchMitschnitt(antwort?: () => Response | Promise<Response>) {
  const gesendet: { url: string; body: unknown }[] = [];
  server.use(
    http.patch('/api/einsaetze/1/material/:emId', async ({ request }) => {
      gesendet.push({ url: new URL(request.url).pathname, body: await request.json() });
      return antwort ? antwort() : HttpResponse.json({});
    }),
  );
  return gesendet;
}

describe('EinheitMaterial (LLH-1036 D11, LLH-1225 D10)', () => {
  it('Meta nennt Posten und Ausfall; jeder Posten mit Menge und Status', () => {
    zeige();
    expect(paneel()).toHaveTextContent('3 Posten · 1 Ausfall');
    expect(zeile('Schlauch B')).toHaveTextContent('defekt');
    expect(zeile('Wolldecke')).toHaveTextContent('15 von 20 übrig');
  });

  it('ohne Material: nur „Kein Material“, keine Meta „0 Posten“ (LLH-1255)', () => {
    zeige({ material: { ...einheit, material_mitglieder: [] } as Einheit });
    expect(within(paneel()).getByText('Kein Material')).toBeInTheDocument();
    expect(paneel()).not.toHaveTextContent('0 Posten');
  });

  /** Das Einheit-DTO trägt keine Kategorie: sie kommt aus der Materialliste, wenn sie da ist. */
  it('Kategorie aus der Materialliste steht gedämpft an der Zeile', () => {
    zeige();
    expect(zeile('Tragkraftspritze')).toHaveTextContent('Brandbekämpfung');
  });

  it('„Aus Einheit lösen“ schickt den PATCH an die Disposition, ein Grund steht an der Zeile', async () => {
    const gesendet = patchMitschnitt(() =>
      HttpResponse.json({ error: 'Material ist verliehen' }, { status: 409 }),
    );
    zeige();
    await userEvent.click(
      within(zeile('Schlauch B')).getByRole('button', { name: 'Schlauch B aus Einheit lösen' }),
    );
    await waitFor(() =>
      expect(gesendet).toEqual([
        { url: '/api/einsaetze/1/material/41', body: { einheit_id: null } },
      ]),
    );
    expect(await within(zeile('Schlauch B')).findByText('Material ist verliehen')).toHaveAttribute(
      'data-fehler',
    );
  });

  it('Rückmeldung vor der Antwort: Lösen lädt an seiner Zeile', async () => {
    patchMitschnitt(async () => {
      await delay('infinite');
      return HttpResponse.json({});
    });
    zeige();
    await userEvent.click(
      within(zeile('Schlauch B')).getByRole('button', { name: 'Schlauch B aus Einheit lösen' }),
    );
    await waitFor(() =>
      expect(
        within(zeile('Schlauch B')).getByRole('button', { name: /aus Einheit lösen$/ }),
      ).toHaveClass('ant-btn-loading'),
    );
    expect(
      within(zeile('Wolldecke')).getByRole('button', { name: 'Wolldecke aus Einheit lösen' }),
    ).not.toHaveClass('ant-btn-loading');
  });

  it('„Material zuordnen …“ bietet Posten ohne Ort an und schickt den PATCH mit der Einheit', async () => {
    const gesendet = patchMitschnitt();
    const einheitenRoute: string[] = [];
    server.use(
      http.all('/api/einsaetze/1/einheiten/10/material/:emId', ({ request }) => {
        einheitenRoute.push(request.method);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    zeige();
    await userEvent.click(within(paneel()).getByRole('combobox', { name: 'Material zuordnen' }));
    await userEvent.click(await screen.findByText('Stromerzeuger · 1'));
    await waitFor(() =>
      expect(gesendet).toEqual([{ url: '/api/einsaetze/1/material/50', body: { einheit_id: 10 } }]),
    );
    expect(einheitenRoute).toEqual([]);
  });

  /** LLH-1225 D9: Schreiben + Material, nicht das Einheitenrecht. */
  it('mit Material, aber ohne Einheiten-Freigabe: Lösen und Zuordnen bleiben', () => {
    zeige({ freigaben: freigabenFixture({ einheiten: { zugriff: false } }) });
    expect(
      within(zeile('Schlauch B')).getByRole('button', { name: 'Schlauch B aus Einheit lösen' }),
    ).toBeEnabled();
    expect(within(paneel()).getByRole('combobox', { name: 'Material zuordnen' })).toBeEnabled();
  });

  it('ohne Freigabe Material: Auswahl gesperrt mit Grund, kein Lösen, Posten und Ausfall stehen', () => {
    zeige({ freigaben: freigabenFixture({ material: { zugriff: false } }) });
    const feld = within(paneel()).getByRole('combobox', { name: 'Material zuordnen' });
    expect(feld).toBeDisabled();
    expect(feld).toHaveAccessibleDescription('Modul Material gesperrt');
    expect(paneel()).toHaveTextContent('3 Posten · 1 Ausfall');
    expect(within(paneel()).queryByRole('button', { name: /aus Einheit lösen/ })).toBeNull();
  });

  it('ohne Schreibrecht: kein Lösen, keine Auswahl', () => {
    zeige({ darfSchreiben: false });
    expect(within(paneel()).queryByRole('button', { name: /aus Einheit lösen/ })).toBeNull();
    expect(within(paneel()).queryByRole('combobox')).toBeNull();
  });

  it('aufgelöste Einheit: Zuordnen gesperrt mit Grund, Lösen geht', () => {
    zeige({ material: { ...einheit, aufgeloest_at: '2026-10-15 08:00:00' } as Einheit });
    const feld = within(paneel()).getByRole('combobox', { name: 'Material zuordnen' });
    expect(feld).toBeDisabled();
    expect(feld).toHaveAccessibleDescription('Einheit aufgelöst');
    expect(
      within(zeile('Schlauch B')).getByRole('button', { name: 'Schlauch B aus Einheit lösen' }),
    ).toBeEnabled();
  });
});
