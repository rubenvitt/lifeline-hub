import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { benutzerFixture } from '../test/fixtures';
import SichtungDialog from '../personen/SichtungDialog';
import { bestaetigerOptionen, kannBestaetigen } from './BestaetigtVonFeld';

/**
 * „Bestätigt von“ am UHS-Gerät (LFH-1046, Spec `geraete-kopplung`): nur ein UHS-Gerät nennt eine
 * bestätigende Person; eine Person und der Lagemonitor sehen kein Feld und laden keine Liste.
 */

const TABLET = {
  kopplung_id: 3,
  einsatz_id: 1,
  ansicht: 'uhs-tablet' as const,
  uhs_id: 2,
  stelle: 'UHS Nord',
  bezeichnung: 'Tablet 1',
  laeuft_ab_at: '2026-10-08 12:00:00',
};

let gesendet: Record<string, unknown>[];
let listenAbrufe: number;

beforeEach(() => {
  gesendet = [];
  listenAbrufe = 0;
  server.use(
    http.get('/api/einsaetze/1/personen/bestaetiger', () => {
      listenAbrufe += 1;
      return HttpResponse.json([
        { id: 5, name: 'Dr. A. Muster', funktion: 'Notärztin' },
        { id: 6, name: 'Zander' },
      ]);
    }),
    http.post('/api/einsaetze/1/personen/9/sichtung', async ({ request }) => {
      gesendet.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json(
        {
          id: 1,
          einsatz_id: 1,
          person_id: 9,
          kategorie: 'sk2',
          gesichtet_at: '',
          gesichtet_von: 1,
        },
        { status: 201 },
      );
    }),
  );
});

function zeige() {
  return renderMitProviders(
    <SichtungDialog
      einsatzId={1}
      personId={9}
      offen
      onErfasst={() => {}}
      onSchliessen={() => {}}
    />,
  );
}

type Nutzer = ReturnType<typeof userEvent.setup>;

async function waehle(user: Nutzer, feld: string, eintrag: string) {
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('combobox', { name: feld }));
  await user.click(await screen.findByTitle(eintrag));
}

describe('Bestätigt von (LFH-1046)', () => {
  it('am Tablet: Auswahl aus dem Personal, die Kennung geht mit der Sichtung', async () => {
    server.use(
      meHandler({ ...benutzerFixture({ anzeigename: 'UHS Nord · Tablet 1' }), geraet: TABLET }),
    );
    const user = userEvent.setup();
    zeige();
    await screen.findByLabelText('Bestätigt von');
    await waehle(user, 'Kategorie', 'SK II');
    await waehle(user, 'Bestätigt von', 'Dr. A. Muster · Notärztin');
    await user.click(screen.getByRole('button', { name: 'Übernehmen' }));
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).toMatchObject({ kategorie: 'sk2', bestaetigt_personal_id: 5 });
  });

  it('am Tablet ohne Auswahl geht kein Feld mit', async () => {
    server.use(
      meHandler({ ...benutzerFixture({ anzeigename: 'UHS Nord · Tablet 1' }), geraet: TABLET }),
    );
    const user = userEvent.setup();
    zeige();
    await screen.findByLabelText('Bestätigt von');
    await waehle(user, 'Kategorie', 'SK II');
    await user.click(screen.getByRole('button', { name: 'Übernehmen' }));
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).not.toHaveProperty('bestaetigt_personal_id');
  });

  it('für eine Person: kein Feld, keine Liste', async () => {
    server.use(meHandler(benutzerFixture({ anzeigename: 'EL' })));
    zeige();
    await screen.findByLabelText('Kategorie');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByLabelText('Bestätigt von')).toBeNull();
    expect(listenAbrufe).toBe(0);
  });

  it('kannBestaetigen: nur UHS-Ansichten', () => {
    expect(kannBestaetigen(null)).toBe(false);
    expect(kannBestaetigen(TABLET)).toBe(true);
    expect(kannBestaetigen({ ...TABLET, ansicht: 'uhs-laptop' })).toBe(true);
    expect(kannBestaetigen({ ...TABLET, ansicht: 'lagemonitor', uhs_id: null })).toBe(false);
    expect(kannBestaetigen({ ...TABLET, ansicht: 'betreuungsstelle', uhs_id: null })).toBe(false);
  });

  it('bestaetigerOptionen nennt die Funktion, wenn es eine gibt', () => {
    expect(
      bestaetigerOptionen([
        { id: 5, name: 'Dr. A. Muster', funktion: 'Notärztin' },
        { id: 6, name: 'Zander' },
      ]),
    ).toEqual([
      { value: 5, label: 'Dr. A. Muster · Notärztin' },
      { value: 6, label: 'Zander' },
    ]);
  });
});
