import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { setzeZeitdarstellung } from '../anzeige/zeitDarstellungStore';
import { meHandler, server } from '../test/server';
import { adminFixture } from '../test/fixtures';
import { renderMitProviders } from '../test/utils';
import type { Schichtmodell } from '../api/types';
import SchichtmodelleTab from './SchichtmodelleTab';

/** LLH-1122: Sektion „Schichtmodelle“ der Stammdaten. */

const modell = (
  over: Partial<Schichtmodell> & { id: number; bezeichnung: string },
): Schichtmodell => ({
  typ: 'rhythmus',
  rhythmus_minuten: 360,
  vorwarnung_minuten: 30,
  planungsvorlauf_minuten: 120,
  ist_vorgabe: false,
  ist_demo: false,
  ...over,
});

const SAND = modell({ id: 1, bezeichnung: 'Sanitätsdienst', ist_vorgabe: true });
const HOCHWASSER = modell({
  id: 2,
  bezeichnung: '12-h-Schicht Hochwasser',
  typ: 'wechselzeiten',
  rhythmus_minuten: undefined,
  wechselzeiten: ['06:00', '18:00'],
  mindestdauer_minuten: 240,
  vorwarnung_minuten: 45,
  ist_demo: true,
});

function stelleBereit(liste: Schichtmodell[] = [SAND, HOCHWASSER]) {
  const aufrufe: string[] = [];
  server.use(
    meHandler(adminFixture()),
    http.get('/api/schichtmodelle', () => HttpResponse.json(liste)),
    http.post('/api/schichtmodelle', async ({ request }) => {
      const body = await request.json();
      aufrufe.push(`POST ${JSON.stringify(body)}`);
      return HttpResponse.json({ id: 9, ist_demo: false, ...(body as object) }, { status: 201 });
    }),
    http.put('/api/schichtmodelle/:id', async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>;
      aufrufe.push(`PUT ${params.id} ${JSON.stringify(body)}`);
      return HttpResponse.json({ id: Number(params.id), ist_demo: false, ...body });
    }),
    http.delete('/api/schichtmodelle/:id', ({ params }) => {
      aufrufe.push(`DELETE ${params.id}`);
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return aufrufe;
}

async function zeilenaktion(name: string, eintrag: string) {
  await userEvent.click(await screen.findByRole('button', { name: `Aktionen zu ${name}` }));
  const menue = await waitFor(() => {
    const m = document.querySelector<HTMLElement>(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    );
    expect(m).not.toBeNull();
    return m!;
  });
  await userEvent.click(within(menue).getByRole('menuitem', { name: eintrag }));
}

describe('SchichtmodelleTab (LLH-1122)', () => {
  it('listet die Modelle mit Regel, Vorwarnung, Vorgabe- und Demo-Marke', async () => {
    stelleBereit();
    renderMitProviders(<SchichtmodelleTab />);
    const zeile = (await screen.findByText('12-h-Schicht Hochwasser')).closest('tr')!;
    expect(zeile).toHaveTextContent('Wechsel 0600/1800 · Mindestdauer 4 h');
    expect(zeile).toHaveTextContent('45 min');
    expect(within(zeile).getByText('Demo')).toBeInTheDocument();
    const vorgabe = screen.getByText('Sanitätsdienst').closest('tr')!;
    expect(vorgabe).toHaveTextContent('Vorgabe der Organisation');
    expect(vorgabe).toHaveTextContent('Rhythmus 6 h');
  });

  describe('Zeitdarstellung (LLH-1437)', () => {
    afterEach(() => setzeZeitdarstellung(null));

    it('nennt die Wechselzeiten mit Doppelpunkt, wenn das Gerät „Datum und Uhrzeit“ gewählt hat', async () => {
      setzeZeitdarstellung('datum_uhrzeit');
      stelleBereit();
      renderMitProviders(<SchichtmodelleTab />);
      const zeile = (await screen.findByText('12-h-Schicht Hochwasser')).closest('tr')!;
      expect(zeile).toHaveTextContent('Wechsel 06:00/18:00 · Mindestdauer 4 h');
    });
  });

  it('legt ein Modell mit Wechselzeiten an: taktisch eingegeben, als HH:MM gesendet', async () => {
    const aufrufe = stelleBereit([]);
    renderMitProviders(<SchichtmodelleTab />);
    await userEvent.click(await screen.findByRole('button', { name: 'Schichtmodell anlegen' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Bezeichnung' }),
      'Hochwasser',
    );
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Wechselzeiten' }));
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Wechselzeiten' }),
      '1800 0600',
    );
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Mindestdauer' }), '4');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(aufrufe).toEqual([
        'POST {"bezeichnung":"Hochwasser","typ":"wechselzeiten","wechselzeiten":["06:00","18:00"],"mindestdauer_minuten":240,"ist_vorgabe":false}',
      ]),
    );
  });

  it('Feldbudget: drei Felder offen, Vorwarnung und Planungsvorlauf im Klappteil mit Vorgabe im Kopf', async () => {
    stelleBereit([]);
    renderMitProviders(<SchichtmodelleTab />);
    await userEvent.click(await screen.findByRole('button', { name: 'Schichtmodell anlegen' }));
    const dialog = await screen.findByRole('dialog');
    // Offen: Bezeichnung, Typ, Rhythmus; alles Weitere im Klappteil.
    const offen = within(dialog)
      .getAllByRole('textbox')
      .filter((f) => !f.closest('.ant-collapse'))
      .map((f) => f.getAttribute('id'));
    expect(offen).toHaveLength(2);
    expect(within(dialog).getByRole('radiogroup', { name: 'Typ' })).toBeInTheDocument();
    expect(
      within(dialog)
        .getByRole('textbox', { name: 'Vorwarnung', hidden: true })
        .closest('.ant-collapse'),
    ).not.toBeNull();
    const kopf = within(dialog).getByRole('button', {
      name: /Vorwarnung 30 min \(Vorgabe\) · Planungsvorlauf 2 h \(Vorgabe\)/,
    });
    expect(kopf).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(kopf);
    expect(within(dialog).getByRole('textbox', { name: 'Vorwarnung' })).toHaveAttribute(
      'placeholder',
      '30 min (Vorgabe)',
    );
  });

  it('ein Prüffehler im Klappteil öffnet ihn', async () => {
    const aufrufe = stelleBereit([]);
    renderMitProviders(<SchichtmodelleTab />);
    await userEvent.click(await screen.findByRole('button', { name: 'Schichtmodell anlegen' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Bezeichnung' }), 'SanD');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Rhythmus' }), '6');
    const kopf = within(dialog).getByRole('button', { name: /Vorwarnung/ });
    await userEvent.click(kopf);
    // „45“ sind 45 Stunden: mehr als ein Tag.
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Vorwarnung' }), '45');
    await userEvent.click(kopf);
    await waitFor(() => expect(kopf).toHaveAttribute('aria-expanded', 'false'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(kopf).toHaveAttribute('aria-expanded', 'true'));
    expect(await within(dialog).findByText('Zwischen 1 min und 24 h')).toBeInTheDocument();
    expect(aufrufe).toEqual([]);
  });

  it('wechselt die Vorgabe in einem Handgriff: erst aufheben, dann setzen', async () => {
    const aufrufe = stelleBereit();
    renderMitProviders(<SchichtmodelleTab />);
    await zeilenaktion('12-h-Schicht Hochwasser', 'Als Vorgabe setzen');
    await waitFor(() => expect(aufrufe).toHaveLength(2));
    expect(aufrufe[0]).toMatch(/^PUT 1 .*"ist_vorgabe":false/);
    expect(aufrufe[1]).toMatch(/^PUT 2 .*"ist_vorgabe":true/);
    // Der ganze Satz geht mit, ohne Felder des anderen Typs (sonst 422).
    expect(aufrufe[1]).toContain('"wechselzeiten":["06:00","18:00"]');
    expect(aufrufe[1]).not.toContain('rhythmus_minuten');
  });

  it('Bearbeiten behält die Vorgabe der Organisation', async () => {
    const aufrufe = stelleBereit();
    renderMitProviders(<SchichtmodelleTab />);
    await zeilenaktion('Sanitätsdienst', 'Bearbeiten');
    const dialog = await screen.findByRole('dialog');
    const rhythmus = within(dialog).getByRole('textbox', { name: 'Rhythmus' });
    expect(rhythmus).toHaveValue('6 h');
    await userEvent.clear(rhythmus);
    await userEvent.type(rhythmus, '8');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(aufrufe).toEqual([
        'PUT 1 {"bezeichnung":"Sanitätsdienst","typ":"rhythmus","rhythmus_minuten":480,"ist_vorgabe":true}',
      ]),
    );
  });

  it('Löschen fragt mit der Folge nach und nennt die Handlung', async () => {
    const aufrufe = stelleBereit();
    renderMitProviders(<SchichtmodelleTab />);
    await zeilenaktion('Sanitätsdienst', 'Löschen');
    const rueckfrage = await screen.findByRole('dialog', { name: 'Sanitätsdienst löschen?' });
    expect(rueckfrage).toHaveTextContent('Laufende Einsätze behalten ihre Kopie.');
    expect(aufrufe).toEqual([]);
    await userEvent.click(
      within(rueckfrage).getByRole('button', { name: 'Schichtmodell löschen' }),
    );
    await waitFor(() => expect(aufrufe).toEqual(['DELETE 1']));
  });
});
