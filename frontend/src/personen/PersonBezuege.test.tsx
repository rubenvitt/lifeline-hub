import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import PersonBezuege from './PersonBezuege';

/**
 * Bezüge der Person zu Tier und Schaden in EINER Liste (LLH-1129, Spec `personen-detail`, „Bezüge
 * zu Tier und Schaden in einer Liste“): Einsatzsprache, Sprung je Zeile, „Bezug lösen“ mit Grund an
 * der Zeile, „Bezug hinzufügen“ mit einer gemeinsamen Suche über freie Tiere und Schäden.
 */
const tier = (teil: Record<string, unknown>) => ({
  id: 30,
  einsatz_id: 1,
  registrier_nr: 3,
  status: 'aktiv',
  spezies: 'hund',
  rufname: 'Bello',
  halter_person_id: 10,
  halter_kontakt: null,
  antreff_ort: null,
  storniert_at: null,
  erfasst_at: '2026-10-18 08:00:00',
  erfasst_von: 1,
  geaendert_at: '2026-10-18 08:00:00',
  geaendert_von: 1,
  ...teil,
});
const schaden = (teil: Record<string, unknown>) => ({
  id: 7,
  einsatz_id: 1,
  registrier_nr: 7,
  status: 'offen',
  typ: 'Wasserschaden',
  ausmass: 'mittel',
  ort: 'Keller',
  beschreibung: '',
  geschaedigt_person_id: 10,
  storniert_at: null,
  erfasst_at: '2026-10-18 08:00:00',
  erfasst_von: 1,
  geaendert_at: '2026-10-18 08:00:00',
  geaendert_von: 1,
  ...teil,
});

let tiereDerPerson: unknown[];
let schaedenDerPerson: unknown[];
let patches: { pfad: string; body: Record<string, unknown> }[];
let tierPatchAntwort: () => Response;

beforeEach(() => {
  tiereDerPerson = [tier({})];
  schaedenDerPerson = [schaden({})];
  patches = [];
  tierPatchAntwort = () => HttpResponse.json(tier({ halter_person_id: null }));
  server.use(
    http.get('/api/einsaetze/1/tiere', ({ request }) => {
      const halter = new URL(request.url).searchParams.get('halter_person_id');
      if (halter === '10') return HttpResponse.json(tiereDerPerson);
      return HttpResponse.json([
        tier({ id: 41, registrier_nr: 9, rufname: 'Minka', spezies: 'katze', halter_person_id: null }),
        // Belegt: steht nicht zur Wahl.
        tier({ id: 42, registrier_nr: 10, rufname: 'Fremd', halter_person_id: 99 }),
      ]);
    }),
    http.get('/api/einsaetze/1/schaeden', () => HttpResponse.json(schaedenDerPerson)),
    http.get('/api/einsaetze/1/schaeden/auswahl', () =>
      HttpResponse.json([
        {
          id: 51,
          registrier_nr: 11,
          typ: 'Sturmschaden',
          ausmass: 'gering',
          status: 'offen',
          frei: true,
        },
        {
          id: 52,
          registrier_nr: 12,
          typ: 'Brand',
          ausmass: 'gross',
          status: 'abgeschlossen',
          frei: true,
        },
      ]),
    ),
    http.patch('/api/einsaetze/1/tiere/:id', async ({ request, params }) => {
      patches.push({ pfad: `tiere/${String(params.id)}`, body: (await request.json()) as never });
      return tierPatchAntwort();
    }),
    http.patch('/api/einsaetze/1/schaeden/:id', async ({ request, params }) => {
      patches.push({ pfad: `schaeden/${String(params.id)}`, body: (await request.json()) as never });
      return HttpResponse.json(schaden({ geschaedigt_person_id: null }));
    }),
  );
});

function zeige(darfZuordnen = true) {
  return renderMitProviders(<PersonBezuege einsatzId={1} personId={10} darfZuordnen={darfZuordnen} />);
}

describe('PersonBezuege (LLH-1129)', () => {
  it('zeigt Tier und Schaden als eine Liste in Einsatzsprache, jede Zeile ein Sprung', async () => {
    zeige();
    const halter = await screen.findByRole('link', { name: 'Halter von T-003 · Hund „Bello“' });
    expect(halter).toHaveAttribute('href', expect.stringContaining('/tiere/30'));
    const geschaedigt = screen.getByRole('link', {
      name: 'Geschädigt bei S-007 · Wasserschaden (mittel)',
    });
    expect(geschaedigt).toHaveAttribute('href', expect.stringContaining('/schaeden/7'));
    expect(screen.getByText('Bezüge 2')).toBeInTheDocument();
  });

  it('zeigt ohne Bezüge „Bezüge 0“ und „Bezug hinzufügen“', async () => {
    tiereDerPerson = [];
    schaedenDerPerson = [];
    zeige();
    expect(await screen.findByText('Bezüge 0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bezug hinzufügen' })).toBeVisible();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('löst einen Bezug am Tier (Halter leer)', async () => {
    zeige();
    await userEvent.click(await screen.findByRole('button', { name: 'Bezug zu T-003 lösen' }));
    await waitFor(() =>
      expect(patches).toEqual([{ pfad: 'tiere/30', body: { halter_person_id: null } }]),
    );
  });

  it('lässt eine Ablehnung an der Zeile stehen, die übrigen bleiben unverändert', async () => {
    tierPatchAntwort = () => HttpResponse.json({ error: 'Tier ist übergeben' }, { status: 409 });
    zeige();
    await userEvent.click(await screen.findByRole('button', { name: 'Bezug zu T-003 lösen' }));
    const zeile = screen
      .getByRole('link', { name: /Halter von T-003/ })
      .closest('[data-lfh="bezug"]') as HTMLElement;
    expect(await within(zeile).findByText(/Tier ist übergeben/)).toBeInTheDocument();
    const andere = screen
      .getByRole('link', { name: /Geschädigt bei S-007/ })
      .closest('[data-lfh="bezug"]') as HTMLElement;
    expect(within(andere).queryByText(/übergeben/)).toBeNull();
  });

  it('fügt über eine Suche hinzu: nur freie Tiere und Schäden, XOR-Leerung im selben PATCH', async () => {
    zeige();
    await userEvent.click(await screen.findByRole('button', { name: 'Bezug hinzufügen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Bezug hinzufügen' });
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Tier oder Schaden' }));
    expect(await screen.findByTitle('T-009 · Katze · „Minka“')).toBeInTheDocument();
    expect(screen.getByTitle('S-011 · Sturmschaden (gering)')).toBeInTheDocument();
    // Belegtes Tier und abgeschlossener Schaden stehen nicht zur Wahl.
    expect(screen.queryByTitle(/T-010/)).toBeNull();
    expect(screen.queryByTitle(/S-012/)).toBeNull();
    await userEvent.click(screen.getByTitle('S-011 · Sturmschaden (gering)'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hinzufügen' }));
    await waitFor(() =>
      expect(patches).toEqual([
        {
          pfad: 'schaeden/51',
          body: {
            geschaedigt_person_id: 10,
            geschaedigt_personal_id: null,
            geschaedigt_organisation_id: null,
            geschaedigt_kontakt: null,
          },
        },
      ]),
    );
  });

  it('bietet ohne Recht zum Zuordnen weder Hinzufügen noch Lösen an', async () => {
    zeige(false);
    await screen.findByRole('link', { name: /Halter von T-003/ });
    expect(screen.queryByRole('button', { name: 'Bezug hinzufügen' })).toBeNull();
    expect(screen.queryByRole('button', { name: /lösen/ })).toBeNull();
  });
});
