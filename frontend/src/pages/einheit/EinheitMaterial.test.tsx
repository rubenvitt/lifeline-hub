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
 * Paneel „Material“ der Einheit-Ansicht (LLH-1036 Teil II, design.md D11): Ausfall als Wort aus
 * der einen Material-Zählung, Meta „n Posten · k Ausfall“, „Material zuordnen …“ nur mit
 * Freigabe Material, sonst gesperrt mit Grund.
 */

const einheit = {
  id: 10,
  name: '1. Zug',
  material_mitglieder: [
    { em_id: 40, bezeichnung: 'Tragkraftspritze', menge: 1, status: 'einsatzbereit' },
    { em_id: 41, bezeichnung: 'Schlauch B', menge: 4, status: 'defekt' },
    { em_id: 42, bezeichnung: 'Wolldecke', menge: 20, status: 'im_einsatz' },
  ],
} as unknown as Einheit;

const LISTE = [
  { id: 50, bezeichnung: 'Stromerzeuger', menge: 1, status: 'einsatzbereit', einheit_id: null },
  { id: 40, bezeichnung: 'Tragkraftspritze', menge: 1, status: 'einsatzbereit', einheit_id: 10 },
] as unknown as EinsatzMaterial[];

function zeige({
  freigaben = freigabenFixture(),
  darfSchreiben = true,
}: { freigaben?: ModulFreigaben; darfSchreiben?: boolean } = {}) {
  const rechte = buildEinheitRechte(darfSchreiben, freigaben);
  return renderMitProviders(
    <EinheitMaterial
      einsatzId={1}
      einheit={einheit}
      rechte={rechte}
      materialListe={{
        data: rechte.hasMaterialListe ? LISTE : undefined,
        isError: false,
        error: null,
      }}
    />,
  );
}

const paneel = () => screen.getByRole('region', { name: 'Material' });
const zeile = (text: string) =>
  within(paneel()).getByText(text).closest('[data-lfh="einheit-zuordnung"]') as HTMLElement;

describe('EinheitMaterial (D11)', () => {
  it('Meta nennt Posten und Ausfall; nur der Ausfall trägt sein Wort', () => {
    zeige();
    expect(paneel()).toHaveTextContent('3 Posten · 1 Ausfall');
    expect(zeile('Schlauch B')).toHaveTextContent('defekt');
    expect(zeile('Tragkraftspritze')).not.toHaveTextContent('einsatzbereit');
    expect(zeile('Wolldecke')).not.toHaveTextContent('im Einsatz');
  });

  it('„Aus Einheit lösen“ löst den Posten, ein Grund steht an der Zeile', async () => {
    server.use(
      http.delete('/api/einsaetze/1/einheiten/10/material/41', () =>
        HttpResponse.json({ error: 'Material ist verliehen' }, { status: 409 }),
      ),
    );
    zeige();
    await userEvent.click(
      within(zeile('Schlauch B')).getByRole('button', { name: 'Aus Einheit lösen' }),
    );
    expect(await within(zeile('Schlauch B')).findByText('Material ist verliehen')).toHaveAttribute(
      'data-fehler',
    );
  });

  it('Rückmeldung vor der Antwort: Lösen und Auswahl laden', async () => {
    server.use(
      http.delete('/api/einsaetze/1/einheiten/10/material/41', async () => {
        await delay('infinite');
        return new HttpResponse(null, { status: 204 });
      }),
      http.put('/api/einsaetze/1/einheiten/10/material/:emId', async () => {
        await delay('infinite');
        return new HttpResponse(null, { status: 204 });
      }),
    );
    zeige();
    await userEvent.click(
      within(zeile('Schlauch B')).getByRole('button', { name: 'Aus Einheit lösen' }),
    );
    await waitFor(() =>
      expect(
        within(zeile('Schlauch B')).getByRole('button', { name: /Aus Einheit lösen$/ }),
      ).toHaveClass('ant-btn-loading'),
    );
    expect(
      within(zeile('Wolldecke')).getByRole('button', { name: 'Aus Einheit lösen' }),
    ).not.toHaveClass('ant-btn-loading');
    await userEvent.click(within(paneel()).getByRole('combobox', { name: 'Material zuordnen' }));
    await userEvent.click(await screen.findByText('Stromerzeuger ×1'));
    await waitFor(() =>
      expect(paneel().querySelector('.ant-select .anticon-loading')).not.toBeNull(),
    );
  });

  it('„Material zuordnen …“ bietet freie Posten an und ordnet zu', async () => {
    const aufrufe: string[] = [];
    server.use(
      http.put('/api/einsaetze/1/einheiten/10/material/:emId', ({ params }) => {
        aufrufe.push(String(params.emId));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    zeige();
    await userEvent.click(within(paneel()).getByRole('combobox'));
    await userEvent.click(await screen.findByText('Stromerzeuger ×1'));
    await waitFor(() => expect(aufrufe).toEqual(['50']));
  });

  it('ohne Freigabe Material: Auswahl gesperrt mit Grund, Posten und Ausfall stehen weiter', () => {
    zeige({ freigaben: freigabenFixture({ material: { zugriff: false } }) });
    const feld = within(paneel()).getByRole('combobox', { name: 'Material zuordnen' });
    expect(feld).toBeDisabled();
    expect(feld).toHaveAccessibleDescription('Modul Material gesperrt');
    expect(paneel()).toHaveTextContent('3 Posten · 1 Ausfall');
  });

  it('ohne Schreibrecht: kein Lösen, keine Auswahl', () => {
    zeige({ darfSchreiben: false });
    expect(within(paneel()).queryByRole('button', { name: 'Aus Einheit lösen' })).toBeNull();
    expect(within(paneel()).queryByRole('combobox')).toBeNull();
  });
});
