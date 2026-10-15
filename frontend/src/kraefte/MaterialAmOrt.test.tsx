import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { freigabenFixture } from '../test/fixtures';
import type { EinsatzMaterial } from '../api/types';
import type { MaterialOrtRef } from './materialPosten';
import MaterialAmOrt, { type MaterialAmOrtProps } from './MaterialAmOrt';

/**
 * Der eine Baustein für Material an Einheit, Fahrzeug, UHS und Bereitstellungsraum (LLH-1225,
 * design.md D8): Zeilen mit Menge und Status, Kopfzahl, „Ausgeben“, Lösen je Ort, „Material
 * zuordnen …“ über den einen Schreibweg, Leerhinweis, Sperrgrund und Modulsperre.
 */

const em = (p: Partial<EinsatzMaterial>): EinsatzMaterial =>
  ({
    id: 0,
    bezeichnung: 'Posten',
    kategorie: null,
    art: 'geraet',
    menge: 1,
    ausgegeben: 0,
    status: 'einsatzbereit',
    einheit_id: null,
    einsatz_fahrzeug_id: null,
    uhs_id: null,
    br_id: null,
    beendet_at: null,
    ...p,
  }) as EinsatzMaterial;

const UHS: MaterialOrtRef = { art: 'uhs', id: 7 };

const POSTEN = [
  em({
    id: 1,
    bezeichnung: 'Wolldecke',
    kategorie: 'Betreuung',
    art: 'verbrauchsgut',
    menge: 50,
    ausgegeben: 20,
    uhs_id: 7,
  }),
  em({ id: 2, bezeichnung: 'Trage', status: 'defekt', uhs_id: 7 }),
  em({ id: 3, bezeichnung: 'Zeltbahn', art: 'verbrauchsgut', menge: 4, ausgegeben: 4, uhs_id: 7 }),
];

const ANGEBOT = [
  ...POSTEN,
  em({ id: 10, bezeichnung: 'Stromerzeuger' }),
  em({ id: 11, bezeichnung: 'Feldbett', einheit_id: 2 }),
];

function grundHandler() {
  server.use(
    http.get('/api/einsaetze/1/modul-freigaben', () => HttpResponse.json(freigabenFixture())),
    http.get('/api/einsaetze/1/einheiten', () =>
      HttpResponse.json([{ id: 2, name: 'Staffel A', ueber_einheit_id: null }]),
    ),
    http.get('/api/einsaetze/1/abschnitte', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([])),
  );
}

function zeige(props: Partial<MaterialAmOrtProps> = {}) {
  grundHandler();
  return renderMitProviders(
    <MaterialAmOrt
      einsatzId={1}
      ort={UHS}
      posten={POSTEN}
      angebot={{ data: ANGEBOT, isError: false }}
      darfSchreiben
      materialFrei
      loesenText="Lösen"
      {...props}
    />,
  );
}

const zeile = (text: string) =>
  screen.getByText(text).closest('[data-lfh="material-am-ort-zeile"]') as HTMLElement;

function patchMitschnitt(antwort?: () => Response) {
  const gesendet: { url: string; body: unknown }[] = [];
  server.use(
    http.patch('/api/einsaetze/1/material/:emId', async ({ request }) => {
      gesendet.push({ url: new URL(request.url).pathname, body: await request.json() });
      return antwort ? antwort() : HttpResponse.json({});
    }),
  );
  return gesendet;
}

describe('MaterialAmOrt (LLH-1225 D8)', () => {
  it('Zeilen mit Kategorie, Menge und Status; Kopfzahl mit Ausfall', () => {
    zeige();
    expect(screen.getByTestId('material-am-ort-kopf')).toHaveTextContent('3 Posten · 2 Ausfall');
    expect(zeile('Wolldecke')).toHaveTextContent('Betreuung');
    expect(zeile('Wolldecke')).toHaveTextContent('30 von 50 übrig');
    expect(zeile('Wolldecke')).toHaveTextContent('einsatzbereit');
    expect(zeile('Trage')).toHaveTextContent('defekt');
    expect(zeile('Zeltbahn')).toHaveTextContent('aufgebraucht');
  });

  it('„Ausgeben“ nur am Verbrauchsgut mit Rest; der Dialog schickt die neue Ausgabe', async () => {
    const gesendet = patchMitschnitt();
    zeige();
    expect(within(zeile('Trage')).queryByRole('button', { name: /ausgeben/ })).toBeNull();
    expect(within(zeile('Zeltbahn')).queryByRole('button', { name: /ausgeben/ })).toBeNull();
    await userEvent.click(
      within(zeile('Wolldecke')).getByRole('button', { name: 'Wolldecke ausgeben' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Wolldecke ausgeben');
    await userEvent.type(within(dialog).getByRole('spinbutton', { name: 'Menge ausgeben' }), '5');
    expect(within(dialog).getByTestId('ausgabe-danach')).toHaveTextContent(
      'Danach 25 von 50 übrig',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ausgeben' }));
    await waitFor(() =>
      expect(gesendet).toEqual([{ url: '/api/einsaetze/1/material/1', body: { ausgegeben: 25 } }]),
    );
    expect(await screen.findByText('Wolldecke: 5 ausgegeben')).toBeInTheDocument();
  });

  it('Lösen schickt das Ort-Feld leer, ohne Rückfrage; die Ablehnung steht an der Zeile', async () => {
    const gesendet = patchMitschnitt(() =>
      HttpResponse.json({ error: 'Material ist verliehen' }, { status: 409 }),
    );
    zeige();
    await userEvent.click(within(zeile('Trage')).getByRole('button', { name: 'Trage lösen' }));
    await waitFor(() =>
      expect(gesendet).toEqual([{ url: '/api/einsaetze/1/material/2', body: { uhs_id: null } }]),
    );
    expect(await within(zeile('Trage')).findByText('Material ist verliehen')).toHaveAttribute(
      'data-fehler',
    );
  });

  it('der Lösen-Wortlaut folgt dem Ort', () => {
    zeige({
      ort: { art: 'fahrzeug', id: 4 },
      posten: [em({ id: 5, bezeichnung: 'Stromerzeuger', einsatz_fahrzeug_id: 4 })],
      loesenText: 'Vom Fahrzeug lösen',
    });
    const knopf = within(zeile('Stromerzeuger')).getByRole('button', {
      name: 'Stromerzeuger vom Fahrzeug lösen',
    });
    expect(knopf).toHaveTextContent('Vom Fahrzeug lösen');
    expect(knopf).toHaveClass('ant-btn-dangerous');
  });

  it('„Material zuordnen …“ bietet ohne Ort und an anderem Ort an und setzt den Ort hierher', async () => {
    const gesendet = patchMitschnitt();
    zeige();
    await userEvent.click(screen.getByRole('combobox', { name: 'Material zuordnen' }));
    expect(await screen.findByText('Stromerzeuger · 1')).toBeInTheDocument();
    expect(await screen.findByText('Feldbett · 1 · Staffel A')).toBeInTheDocument();
    // Die Posten dieses Orts stehen nicht im Angebot.
    expect(screen.queryByText(/^Trage ·/)).toBeNull();
    await userEvent.click(screen.getByText('Feldbett · 1 · Staffel A'));
    await waitFor(() =>
      expect(gesendet).toEqual([{ url: '/api/einsaetze/1/material/11', body: { uhs_id: 7 } }]),
    );
  });

  it('eine Ablehnung des Zuordnens steht unter der Auswahl', async () => {
    patchMitschnitt(() => HttpResponse.json({ error: 'UHS ist aufgelöst' }, { status: 422 }));
    zeige();
    await userEvent.click(screen.getByRole('combobox', { name: 'Material zuordnen' }));
    await userEvent.click(await screen.findByText('Stromerzeuger · 1'));
    expect(await screen.findByText('UHS ist aufgelöst')).toBeInTheDocument();
    expect(screen.getByText('Nicht zugeordnet')).toBeInTheDocument();
  });

  it('nichts anzubieten: Auswahl gesperrt, daneben der Sprung ins Modul Material', async () => {
    zeige({ angebot: { data: POSTEN, isError: false } });
    const feld = screen.getByRole('combobox', { name: 'Material zuordnen' });
    await waitFor(() => expect(feld).toBeDisabled());
    expect(feld).toHaveAccessibleDescription(/Kein Material ohne Ort/);
    expect(screen.getByRole('link', { name: /im Modul Material erfassen/ })).toHaveAttribute(
      'href',
      '/einsaetze/1/material',
    );
  });

  it('beendeter Ort: Zuordnen gesperrt mit Grund, Lösen geht, kein Ausgeben', () => {
    zeige({ sperrgrund: 'UHS aufgelöst' });
    const feld = screen.getByRole('combobox', { name: 'Material zuordnen' });
    expect(feld).toBeDisabled();
    expect(feld).toHaveAccessibleDescription('UHS aufgelöst');
    expect(within(zeile('Trage')).getByRole('button', { name: 'Trage lösen' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Wolldecke ausgeben' })).toBeNull();
  });

  it('ohne Freigabe Material: Posten stehen, Auswahl gesperrt, kein Lösen und kein Ausgeben', () => {
    zeige({ materialFrei: false, angebot: undefined });
    const feld = screen.getByRole('combobox', { name: 'Material zuordnen' });
    expect(feld).toBeDisabled();
    expect(feld).toHaveAccessibleDescription('Modul Material gesperrt');
    expect(zeile('Trage')).toHaveTextContent('defekt');
    expect(screen.queryByRole('button', { name: /lösen|ausgeben/ })).toBeNull();
  });

  it('nur lesend (Gerät, kein Schreibrecht): keine Bedienelemente', () => {
    zeige({ darfSchreiben: false, angebot: undefined });
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(zeile('Wolldecke')).toHaveTextContent('30 von 50 übrig');
  });

  it('ohne Posten steht der Leertext', () => {
    zeige({ posten: [], leerText: 'Keine Beladung' });
    expect(screen.getByText('Keine Beladung')).toBeInTheDocument();
    expect(screen.getByTestId('material-am-ort-kopf')).toHaveTextContent('0 Posten');
  });
});
