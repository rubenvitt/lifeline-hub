import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { RegistrierListe } from '../../api/types';
import { queueLeerenFuerTests, schreibaktionEinreihen } from '../../offline/queue';
import { meHandler, server } from '../../test/server';
import { benutzerFixture } from '../../test/fixtures';
import { renderMitProviders, setzeOnline } from '../../test/utils';
import RegistrierungPaneel from './RegistrierungPaneel';

/**
 * Registrierliste einer Betreuungsstelle (LLH-1612, Spec `betreuung-registrierung`,
 * „Registrierliste einer Betreuungsstelle“, „Abmelden“, „Registrieren in der Oberfläche“). Am
 * Draht (MSW): was gelesen, was gesendet wird.
 */

const LISTE = '/api/einsaetze/7/betreuung/stellen/8/registrierungen';
const ABMELDEN = '/api/einsaetze/7/betreuung/stellen/8/abmeldungen';
const TURNHALLE = { id: 8, bezeichnung: 'Turnhalle Ost', status: 'in_betrieb' as const };

const WEBER: RegistrierListe = {
  stelle_id: 8,
  haushalte: [
    {
      id: 3,
      nummer: 1,
      bezugsperson_id: 21,
      bezugsperson_name: 'Weber, Anna',
      personen: [
        {
          id: 21,
          registrier_nr: 12,
          name: 'Weber',
          vorname: 'Anna',
          geburtsdatum: '1985-04-03',
          kostform: 'vegetarisch',
          erfasst_at: '2026-11-09 08:00:00',
        },
        {
          id: 22,
          registrier_nr: 13,
          name: 'Weber',
          vorname: 'Tom',
          kostform: 'normal',
          erfasst_at: '2026-11-09 08:00:00',
        },
        {
          id: 23,
          registrier_nr: 14,
          name: 'Weber',
          vorname: 'Lea',
          kostform: 'saeugling_kleinkind',
          erfasst_at: '2026-11-09 08:00:00',
        },
      ],
    },
  ],
  ohne_haushalt: [
    {
      id: 30,
      registrier_nr: 20,
      name: 'Muster',
      vorname: 'Max',
      erfasst_at: '2026-11-09 07:00:00',
    },
  ],
};

interface Draht {
  abmeldungen: unknown[];
}

function rendere(
  props: Partial<Parameters<typeof RegistrierungPaneel>[0]> = {},
  liste: RegistrierListe = WEBER,
): Draht {
  const draht: Draht = { abmeldungen: [] };
  server.use(
    meHandler(benutzerFixture({ id: 11 })),
    http.get(LISTE, () => HttpResponse.json(liste)),
    http.post(ABMELDEN, async ({ request }) => {
      draht.abmeldungen.push(await request.json());
      return HttpResponse.json({ stelle_id: 8, person_ids: [21, 22, 23] });
    }),
  );
  renderMitProviders(
    <RegistrierungPaneel einsatzId={7} stelle={TURNHALLE} personenFrei darfSchreiben {...props} />,
  );
  return draht;
}

const band = () => screen.getByRole('group', { name: 'Kostformen' });

beforeEach(() => {
  setzeOnline(true);
});
afterEach(async () => {
  setzeOnline(true);
  await queueLeerenFuerTests();
});

describe('Registrierliste — Liste mit Band', () => {
  it('Band „Kostformen“ zählt je Kostform und „ohne Angabe“; H-1 trägt drei Personen', async () => {
    const user = userEvent.setup();
    rendere();
    await waitFor(() => expect(within(band()).getByText('Normalkost')).toBeInTheDocument());
    const zahl = (titel: string) =>
      within(band()).getByText(titel).closest('[data-lfh="kennzahl"]')?.textContent;
    expect(zahl('Normalkost')).toContain('1');
    expect(zahl('vegetarisch')).toContain('1');
    expect(zahl('Säugling/Kleinkind')).toContain('1');
    expect(zahl('vegan')).toContain('0');
    expect(zahl('ohne Angabe')).toContain('1');

    const kopf = screen.getByRole('button', { name: /H-1 · Weber, Anna · 3 Personen/ });
    await user.click(kopf);
    const haushalt = await screen.findByRole('list', { name: 'Personen in H-1' });
    const zeilen = within(haushalt).getAllByRole('listitem');
    expect(zeilen).toHaveLength(3);
    expect(zeilen[0]).toHaveTextContent('R-012');
    expect(zeilen[0]).toHaveTextContent('Weber, Anna');
    expect(zeilen[0]).toHaveTextContent('03.04.1985');
    expect(zeilen[0]).toHaveTextContent('vegetarisch');
    // Personen ohne Haushalt als eigener Block.
    expect(screen.getByRole('list', { name: 'Personen ohne Haushalt' })).toHaveTextContent(
      'Muster, Max',
    );
  });

  it('leer: kein Haushalt, der Leerzustand sagt es', async () => {
    rendere({}, { stelle_id: 8, haushalte: [], ohne_haushalt: [] });
    expect(await screen.findByText('Niemand registriert')).toBeInTheDocument();
  });
});

describe('Registrierliste — ohne Personenrecht', () => {
  it('statt der Liste ein Grund, „Registrieren“ fehlt, die Liste wird nicht abgefragt', async () => {
    let abgefragt = 0;
    server.use(
      http.get(LISTE, () => {
        abgefragt += 1;
        return HttpResponse.json(WEBER);
      }),
    );
    renderMitProviders(
      <RegistrierungPaneel einsatzId={7} stelle={TURNHALLE} personenFrei={false} darfSchreiben />,
    );
    expect(screen.getByText(/Registrierung · Keine Berechtigung/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrieren' })).toBeNull();
    await new Promise((r) => setTimeout(r, 30));
    expect(abgefragt).toBe(0);
  });
});

describe('Registrieren gesperrt', () => {
  it('geschlossene Stelle: „Registrieren“ gesperrt, der Grund steht daneben', async () => {
    rendere({ stelle: { ...TURNHALLE, status: 'geschlossen' } });
    const knopf = await screen.findByRole('button', { name: 'Registrieren' });
    expect(knopf).toBeDisabled();
    expect(knopf).toHaveAccessibleDescription('Stelle geschlossen');
  });

  it('ohne Schreibrecht: gesperrt, keine Zeilenaktionen', async () => {
    const user = userEvent.setup();
    rendere({ darfSchreiben: false });
    expect(await screen.findByRole('button', { name: 'Registrieren' })).toBeDisabled();
    await user.click(await screen.findByRole('button', { name: /H-1/ }));
    await screen.findByRole('list', { name: 'Personen in H-1' });
    expect(screen.queryByRole('button', { name: /abmelden/i })).toBeNull();
  });
});

describe('Registrierliste drucken (LLH-1616)', () => {
  it('führt auf die Druckansicht der Stelle, auch ohne Schreibrecht', async () => {
    rendere({ darfSchreiben: false });
    const link = await screen.findByRole('link', { name: 'Registrierliste drucken' });
    expect(link).toHaveAttribute('href', '/einsaetze/7/betreuung/8/registrierliste/druck');
  });

  it('fehlt ohne Personenrecht', async () => {
    server.use(meHandler(benutzerFixture({ id: 11 })));
    renderMitProviders(
      <RegistrierungPaneel einsatzId={7} stelle={TURNHALLE} personenFrei={false} darfSchreiben />,
    );
    await screen.findByText(/Registrierung ·/);
    expect(screen.queryByRole('link', { name: 'Registrierliste drucken' })).toBeNull();
  });
});

// Nicht über den Namen des Dialogs suchen: unter Test vergibt `@rc-component/util` jedem `useId`
// dieselbe Kennung (`test-id`), seit antd 6.7 auch dem Collapse-Inhalt, auf den dann das
// `aria-labelledby` des Dialogs zeigt.
async function abmeldeDialog(titel: string): Promise<HTMLElement> {
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(titel)).toBeInTheDocument();
  return dialog;
}

describe('Abmelden', () => {
  it('Haushalt: Rückfrage nennt Haushalt und Zahl, Ziel optional, ein Request mit haushalt_id', async () => {
    const user = userEvent.setup();
    const draht = rendere();
    await user.click(await screen.findByRole('button', { name: /H-1 · Weber, Anna/ }));
    await user.click(await screen.findByRole('button', { name: 'H-1 abmelden' }));
    const dialog = await abmeldeDialog('H-1 abmelden?');
    expect(dialog).toHaveTextContent('3 Personen');
    await user.type(within(dialog).getByRole('textbox', { name: 'Ziel' }), 'zu Verwandten');
    await user.click(within(dialog).getByRole('button', { name: 'Haushalt abmelden' }));

    await waitFor(() => expect(draht.abmeldungen).toHaveLength(1));
    expect(draht.abmeldungen[0]).toEqual({
      haushalt_id: 3,
      ziel: 'zu Verwandten',
      client_id: expect.any(String),
    });
  });

  it('eine Person: nur ihre Kennung geht hinaus, ohne Ziel kein Schlüssel', async () => {
    const user = userEvent.setup();
    const draht = rendere();
    await user.click(await screen.findByRole('button', { name: /H-1 · Weber, Anna/ }));
    await user.click(await screen.findByRole('button', { name: 'R-013 Weber, Tom abmelden' }));
    const dialog = await abmeldeDialog('R-013 Weber, Tom abmelden?');
    await user.click(within(dialog).getByRole('button', { name: 'Person abmelden' }));

    await waitFor(() => expect(draht.abmeldungen).toHaveLength(1));
    expect(draht.abmeldungen[0]).toEqual({ person_ids: [22], client_id: expect.any(String) });
  });
});

describe('Vorgemerkt ohne Netz', () => {
  it('ein vorgemerkter Haushalt steht oben als „vorgemerkt“ und zählt nicht im Band', async () => {
    await schreibaktionEinreihen(11, 7, {
      art: 'registrierung',
      stelle_id: 8,
      bezeichnung: 'Turnhalle Ost',
      daten: {
        personen: [
          { name: 'Krause', vorname: 'Jan', kostform: 'vegan' },
          { name: 'Krause', vorname: 'Ida', kostform: 'vegan' },
        ],
        client_id: 'reg-x',
        zeitpunkt_at: '2026-11-09 09:00:00',
      },
    });
    rendere();
    const vorgemerkt = await screen.findByRole('list', { name: 'Vorgemerkte Registrierungen' });
    expect(vorgemerkt).toHaveTextContent('vorgemerkt');
    expect(vorgemerkt).toHaveTextContent('Krause, Jan');
    expect(vorgemerkt).toHaveTextContent('2 Personen');
    await waitFor(() => expect(within(band()).getByText('vegan')).toBeInTheDocument());
    expect(
      within(band()).getByText('vegan').closest('[data-lfh="kennzahl"]')?.textContent,
    ).toContain('0');
  });

  it('ohne geladene Liste (ohne Netz) stehen die vorgemerkten Haushalte trotzdem da (Review LLH-1612)', async () => {
    await schreibaktionEinreihen(11, 7, {
      art: 'registrierung',
      stelle_id: 8,
      bezeichnung: 'Turnhalle Ost',
      daten: {
        personen: [{ name: 'Krause', vorname: 'Jan', kostform: 'vegan' }],
        client_id: 'reg-y',
        zeitpunkt_at: '2026-11-09 09:00:00',
      },
    });
    rendere();
    // Die Liste antwortet nie: das Paneel bleibt im Laden, die Vormerkung steht trotzdem.
    server.use(http.get(LISTE, () => new Promise(() => {})));
    const vorgemerkt = await screen.findByRole('list', { name: 'Vorgemerkte Registrierungen' });
    expect(vorgemerkt).toHaveTextContent('Krause, Jan');
  });

  it('ohne Netz und ohne Cache: „Registrierliste ohne Netz nicht geladen“ statt „wird abgerufen“ (CodeRabbit)', async () => {
    setzeOnline(false);
    rendere();
    expect(await screen.findByText('Registrierliste ohne Netz nicht geladen')).toBeInTheDocument();
    expect(screen.queryByText(/wird abgerufen/)).not.toBeInTheDocument();
  });
});
