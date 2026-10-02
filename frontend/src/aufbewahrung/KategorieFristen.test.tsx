import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { alsBackendZeit } from '../etb/filterZeit';
import FristPaneel from './FristPaneel';
import { adminFixture, benutzerFixture } from '../test/fixtures';
import type { BenutzerAnzeige, KategorieAufbewahrung } from '../api/types';

dayjs.extend(customParseFormat);

/**
 * Kategorie-Zeilen im Frist-Paneel (LFH-749, Spec `aufbewahrung-archiv`, „Frist am Einsatz
 * anzeigen und ändern“): Statusetikett mit Wort, Hinweis am aktiven Einsatz, Verlängern einer
 * vorgemerkten Kategorie ohne Rückfrage, Verkürzen erst nach Rückfrage, ohne Recht gesperrt.
 */

const ME_ADMIN = adminFixture();
const ME_HELFER = benutzerFixture({ id: 2, anzeigename: 'Helfer' });

let gesendet: { kategorie: string; body: Record<string, unknown> }[];

function liste(eintraege: Partial<Record<string, Partial<KategorieAufbewahrung>>>) {
  return (['behandlung', 'personenauskunft', 'anhaenge'] as const).map((k) => ({
    kategorie: k,
    ...(eintraege[k] ?? {}),
  }));
}

function mitListe(eintraege: Partial<Record<string, Partial<KategorieAufbewahrung>>>) {
  server.use(
    http.get('/api/einsaetze/1/aufbewahrung-kategorien', () => HttpResponse.json(liste(eintraege))),
  );
}

beforeEach(() => {
  gesendet = [];
  server.use(
    http.put('/api/einsaetze/1/aufbewahrungsfrist/:kategorie', async ({ request, params }) => {
      gesendet.push({
        kategorie: String(params.kategorie),
        body: (await request.json()) as Record<string, unknown>,
      });
      return HttpResponse.json(liste({}));
    }),
  );
});

function zeige(
  me: BenutzerAnzeige,
  status: 'aktiv' | 'abgeschlossen',
  rolle: string | null = null,
) {
  server.use(meHandler(me));
  return renderMitProviders(
    <FristPaneel
      einsatzId={1}
      einsatz={{ status, meine_rolle: rolle, retention_bis: null } as never}
    />,
  );
}

const wire = (ortszeit: string) => alsBackendZeit(dayjs(ortszeit, 'YYYY-MM-DD HH:mm'));

async function fristSetzen(dialog: HTMLElement, ortszeit: string) {
  const u = userEvent.setup();
  const eingabe = within(dialog).getAllByRole('textbox')[0];
  await u.click(eingabe);
  await u.clear(eingabe);
  await u.type(eingabe, `${ortszeit}{Enter}`);
}

describe('KategorieFristen', () => {
  it('Spec „Aktiver Einsatz“: Vorgabe-Satz je Kategorie, keine Aktion', async () => {
    mitListe({
      personenauskunft: { dauer_tage_vorgabe: 0, rechtsgrundlage: '§ 46 Abs. 5 BHKG NRW' },
    });
    zeige(ME_ADMIN, 'aktiv');
    expect(
      await screen.findByText(/Frist entsteht beim Abschluss \(sofort fällig\)/),
    ).toBeInTheDocument();
    expect(screen.getAllByText('folgt der Frist des Einsatzes')).toHaveLength(2);
    expect(screen.getByText('Rechtsgrundlage: § 46 Abs. 5 BHKG NRW')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Frist Personenauskunft ändern/ }),
    ).not.toBeInTheDocument();
  });

  it('zeigt den Zustand als Statusetikett mit Wort; geschwärzt ohne Aktion', async () => {
    mitListe({
      personenauskunft: {
        zustand: 'geschwaerzt',
        geschwaerzt_at: '2026-07-01 12:00:00',
        rechtsgrundlage: 'RG',
      },
      anhaenge: {
        zustand: 'frist_laeuft',
        frist_bis: '2099-01-01 00:00:00',
        rechtsgrundlage: 'RG',
      },
      behandlung: { zustand: 'ohne_frist' },
    });
    zeige(ME_ADMIN, 'abgeschlossen');
    expect(await screen.findByText('geschwärzt')).toBeInTheDocument();
    expect(screen.getByText('Frist läuft')).toBeInTheDocument();
    expect(screen.getByText('ohne Frist')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Frist Personenauskunft ändern' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Frist Anhänge ändern' })).toBeEnabled();
  });

  it('Spec „Kategorie verlängern“: eine vorgemerkte Kategorie geht ohne Rückfrage hinaus', async () => {
    mitListe({
      anhaenge: {
        zustand: 'vorgemerkt',
        frist_bis: '2026-06-01 00:00:00',
        vorgemerkt_at: '2026-06-01 00:10:00',
        karenz_ende: '2026-07-01 00:10:00',
        rechtsgrundlage: 'RG',
      },
    });
    zeige(ME_ADMIN, 'abgeschlossen');
    // Antwort des Servers: die Kategorie läuft wieder mit der neuen Frist.
    server.use(
      http.put('/api/einsaetze/1/aufbewahrungsfrist/:kategorie', async ({ request, params }) => {
        gesendet.push({
          kategorie: String(params.kategorie),
          body: (await request.json()) as Record<string, unknown>,
        });
        return HttpResponse.json(
          liste({
            anhaenge: {
              zustand: 'frist_laeuft',
              frist_bis: wire('2099-01-01 12:00'),
              rechtsgrundlage: 'RG',
            },
          }),
        );
      }),
    );
    expect(await screen.findByText(/Karenz bis/)).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Frist Anhänge ändern' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/nimmt die Vormerkung zurück/)).toBeInTheDocument();
    await fristSetzen(dialog, '2099-01-01 12:00');
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).toEqual({
      kategorie: 'anhaenge',
      body: { retention_bis: wire('2099-01-01 12:00'), rechtsgrundlage: 'RG' },
    });
    expect(screen.queryByText('Frist der Datenkategorie verkürzen?')).not.toBeInTheDocument();
    // Spec: danach `frist_laeuft` mit der neuen Frist, Vormerkung und Karenz sind weg.
    expect(await screen.findByText('Frist läuft')).toBeInTheDocument();
    expect(screen.queryByText('zur Löschung vorgemerkt')).not.toBeInTheDocument();
    expect(screen.queryByText(/Karenz bis/)).not.toBeInTheDocument();
  });

  it('Verkürzen fragt zuerst und sendet dann bestaetigt: true', async () => {
    mitListe({
      behandlung: {
        zustand: 'frist_laeuft',
        frist_bis: '2099-01-01 00:00:00',
        rechtsgrundlage: 'RG',
      },
    });
    zeige(ME_ADMIN, 'abgeschlossen');
    await userEvent.click(await screen.findByRole('button', { name: 'Frist Behandlung ändern' }));
    await fristSetzen(await screen.findByRole('dialog'), '2098-01-01 12:00');
    const titel = await screen.findByText('Frist der Datenkategorie verkürzen?');
    expect(gesendet).toHaveLength(0);
    await userEvent.click(
      within(titel.closest<HTMLElement>('.ant-modal')!).getByRole('button', { name: 'Verkürzen' }),
    );
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0].body).toMatchObject({
      bestaetigt: true,
      retention_bis: wire('2098-01-01 12:00'),
    });
  });

  it('die erste Frist verlangt eine Rechtsgrundlage', async () => {
    mitListe({ anhaenge: { zustand: 'ohne_frist' } });
    zeige(ME_ADMIN, 'abgeschlossen');
    await userEvent.click(await screen.findByRole('button', { name: 'Frist Anhänge ändern' }));
    const dialog = await screen.findByRole('dialog');
    await fristSetzen(dialog, '2099-01-01 12:00');
    expect(await within(dialog).findByText('Rechtsgrundlage angeben')).toBeInTheDocument();
    expect(gesendet).toHaveLength(0);
  });

  it('Spec „Ohne Recht“: die Aktion steht gesperrt da', async () => {
    mitListe({
      anhaenge: {
        zustand: 'frist_laeuft',
        frist_bis: '2099-01-01 00:00:00',
        rechtsgrundlage: 'RG',
      },
    });
    zeige(ME_HELFER, 'abgeschlossen', 'beobachter');
    expect(await screen.findByRole('button', { name: 'Frist Anhänge ändern' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Frist Anhänge aufheben' })).toBeDisabled();
  });
});
