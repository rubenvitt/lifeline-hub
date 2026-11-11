import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { PersonDetail } from '../api/types';
import { server } from '../test/server';
import { freigabenFixture } from '../test/fixtures';
import { renderMitProviders, setzeOnline } from '../test/utils';
import { EinsatzPfadeProvider, GERAET_BETREUUNG_PFADE } from '../routing/EinsatzPfade';
import Personendaten from './Personendaten';

/**
 * Kostform, Unverträglichkeiten und Haushalt in den Personendaten (LLH-1612, Spec
 * `betreuung-registrierung`, „Kostform und Unverträglichkeiten an der Person“): feldweise wie die
 * übrigen Angaben, ein PATCH je Feld mit Feld-CAS (Spec `personendaten-bearbeiten`).
 */

const TOM = {
  id: 22,
  einsatz_id: 1,
  registrier_nr: 13,
  status: 'betroffen',
  name: 'Weber',
  vorname: 'Tom',
  kostform: 'normal',
  unvertraeglichkeiten: null,
  haushalt_id: 3,
  haushalt_nummer: 1,
  aktuelle_verbleib_art: 'notunterkunft',
  aktuelle_verbleib_betreuungsstelle_id: 8,
  erfasst_at: '2026-11-09 08:00:00',
  erfasst_von: 1,
  geaendert_at: '2026-11-09 08:00:00',
  geaendert_von: 1,
  sichtungen: [],
  notizen: [],
  verbleib: [],
  abgleiche: [],
  transporte: [],
  massnahmen: [],
  verletzungen: [],
  anlaesse: [],
} as unknown as PersonDetail;

function mitschnitt() {
  const koerper: Record<string, unknown>[] = [];
  server.use(
    http.patch('/api/einsaetze/1/personen/22', async ({ request }) => {
      const k = (await request.json()) as Record<string, unknown>;
      koerper.push(k);
      const aenderung = { ...k };
      delete aenderung.erwartet;
      return HttpResponse.json({ ...TOM, ...aenderung });
    }),
  );
  return koerper;
}

describe('Personendaten — Kostform (LLH-1612)', () => {
  it('steht als Wort im Raster; „ohne Schwein“ geht als ein PATCH mit Altwert hinaus', async () => {
    const koerper = mitschnitt();
    const user = userEvent.setup();
    renderMitProviders(<Personendaten einsatzId={1} person={TOM} darfSchreiben />, {
      datenRouter: true,
    });
    const knopf = screen.getByRole('button', { name: 'Kostform bearbeiten' });
    expect(knopf).toHaveTextContent('Normalkost');
    await user.click(knopf);
    const auswahl = screen.getByRole('combobox', { name: 'Kostform' });
    await user.click(auswahl);
    await user.click(
      await waitFor(() => {
        const o = document.querySelector<HTMLElement>(
          '.ant-select-item-option[title="ohne Schweinefleisch"]',
        );
        expect(o).not.toBeNull();
        return o!;
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Kostform speichern' }));
    await waitFor(() => expect(koerper).toHaveLength(1));
    expect(koerper[0]).toEqual({ kostform: 'ohne_schwein', erwartet: { kostform: 'normal' } });
    expect(await screen.findByText('Kostform gespeichert')).toBeInTheDocument();
  });
});

describe('Personendaten — Unverträglichkeiten (LLH-1612)', () => {
  it('leer in „Ohne Angabe“; eingetragen als ein PATCH mit Altwert null', async () => {
    const koerper = mitschnitt();
    const user = userEvent.setup();
    renderMitProviders(<Personendaten einsatzId={1} person={TOM} darfSchreiben />, {
      datenRouter: true,
    });
    const ohne = document.querySelector<HTMLElement>('[data-lfh="ohne-angabe"]')!;
    await user.click(within(ohne).getByRole('button', { name: 'Unverträglichkeiten eintragen' }));
    await user.type(
      within(ohne).getByRole('textbox', { name: 'Unverträglichkeiten' }),
      'Erdnüsse{Enter}',
    );
    await waitFor(() => expect(koerper).toHaveLength(1));
    expect(koerper[0]).toEqual({
      unvertraeglichkeiten: 'Erdnüsse',
      erwartet: { unvertraeglichkeiten: null },
    });
  });

  it('über 200 Zeichen: Grund am Feld, kein Request, nie gekürzt', async () => {
    const koerper = mitschnitt();
    const user = userEvent.setup();
    renderMitProviders(<Personendaten einsatzId={1} person={TOM} darfSchreiben />, {
      datenRouter: true,
    });
    const ohne = document.querySelector<HTMLElement>('[data-lfh="ohne-angabe"]')!;
    await user.click(within(ohne).getByRole('button', { name: 'Unverträglichkeiten eintragen' }));
    const feld = within(ohne).getByRole('textbox', { name: 'Unverträglichkeiten' });
    await user.click(feld);
    await user.paste('x'.repeat(201));
    await user.keyboard('{Enter}');
    expect(
      await screen.findByText('Unverträglichkeiten darf höchstens 200 Zeichen lang sein'),
    ).toBeInTheDocument();
    expect(feld).toHaveValue('x'.repeat(201));
    expect(koerper).toHaveLength(0);
  });
});

describe('Personendaten — Haushalt (LLH-1612)', () => {
  it('Lesezeile „Haushalt H-1“ mit Sprung zur Stelle des Verbleibs', () => {
    renderMitProviders(<Personendaten einsatzId={1} person={TOM} darfSchreiben />, {
      datenRouter: true,
    });
    const zeile = document.querySelector<HTMLElement>('[data-lfh="haushalt-zeile"]')!;
    expect(zeile).toHaveTextContent('Haushalt H-1');
    expect(within(zeile).getByRole('link', { name: /Betreuungsstelle/ })).toHaveAttribute(
      'href',
      '/einsaetze/1/betreuung/8',
    );
  });

  it('ohne Schreibrecht nur die Lesezeile, keine Aktionen (LLH-1615)', () => {
    renderMitProviders(<Personendaten einsatzId={1} person={TOM} darfSchreiben={false} />, {
      datenRouter: true,
    });
    expect(document.querySelector('[data-lfh="haushalt-zeile"]')).toHaveTextContent('Haushalt H-1');
    expect(screen.queryByRole('button', { name: /Haushalt ändern|Bezugsperson/ })).toBeNull();
  });

  it('am Gerät ohne Stellenseite steht der Haushalt ohne Sprung; ohne Haushalt keine Zeile', () => {
    renderMitProviders(
      <EinsatzPfadeProvider pfade={GERAET_BETREUUNG_PFADE}>
        <Personendaten einsatzId={1} person={TOM} darfSchreiben />
      </EinsatzPfadeProvider>,
      { datenRouter: true },
    );
    const zeile = document.querySelector<HTMLElement>('[data-lfh="haushalt-zeile"]')!;
    expect(zeile).toHaveTextContent('Haushalt H-1');
    expect(within(zeile).queryByRole('link')).toBeNull();
  });

  it('ohne Haushalt keine Zeile; an einer Stelle bleibt „Haushalt ändern“ zum Zuordnen (CodeRabbit)', async () => {
    const ohneHaushalt = { ...TOM, haushalt_id: null, haushalt_nummer: null };
    const { unmount } = renderMitProviders(
      <Personendaten einsatzId={1} person={ohneHaushalt} darfSchreiben />,
      { datenRouter: true },
    );
    expect(document.querySelector('[data-lfh="haushalt-zeile"]')).toBeNull();
    expect(await screen.findByRole('button', { name: 'Haushalt ändern' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Zur Bezugsperson machen' })).toBeNull();
    unmount();
    renderMitProviders(
      <Personendaten einsatzId={1} person={ohneHaushalt} darfSchreiben={false} />,
      {
        datenRouter: true,
      },
    );
    expect(screen.queryByRole('button', { name: 'Haushalt ändern' })).toBeNull();
  });
});

describe('Personendaten — Haushalt umbauen (LLH-1615)', () => {
  it('„Zur Bezugsperson machen“ sendet an die Stelle des Verbleibs', async () => {
    const user = userEvent.setup();
    const gesendet: unknown[] = [];
    server.use(
      http.put(
        '/api/einsaetze/1/betreuung/stellen/8/haushalte/3/bezugsperson',
        async ({ request }) => {
          gesendet.push(await request.json());
          return HttpResponse.json({ id: 3, nummer: 1, bezugsperson_id: 22, personen: [] });
        },
      ),
    );
    renderMitProviders(<Personendaten einsatzId={1} person={TOM} darfSchreiben />, {
      datenRouter: true,
    });
    await user.click(await screen.findByRole('button', { name: 'Zur Bezugsperson machen' }));
    await waitFor(() => expect(gesendet).toEqual([{ person_id: 22 }]));
  });

  it('die Bezugsperson trägt das Wort und hat nur „Haushalt ändern“', async () => {
    renderMitProviders(
      <Personendaten
        einsatzId={1}
        person={{ ...TOM, haushalt_bezugsperson: true }}
        darfSchreiben
      />,
      { datenRouter: true },
    );
    const zeile = document.querySelector<HTMLElement>('[data-lfh="haushalt-zeile"]')!;
    expect(zeile).toHaveTextContent('Bezugsperson');
    expect(await within(zeile).findByRole('button', { name: 'Haushalt ändern' })).toBeEnabled();
    expect(within(zeile).queryByRole('button', { name: 'Zur Bezugsperson machen' })).toBeNull();
  });

  it('offener Feldentwurf sperrt beide Aktionen mit dem Grund der Seite (CodeRabbit)', async () => {
    const user = userEvent.setup();
    renderMitProviders(<Personendaten einsatzId={1} person={TOM} darfSchreiben />, {
      datenRouter: true,
    });
    const aendern = await screen.findByRole('button', { name: 'Haushalt ändern' });
    const bezug = screen.getByRole('button', { name: 'Zur Bezugsperson machen' });
    expect(aendern).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Name bearbeiten' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'x');
    const grund = 'Erst „Name“ speichern oder abbrechen';
    await waitFor(() => expect(aendern).toBeDisabled());
    expect(bezug).toBeDisabled();
    expect(aendern).toHaveAccessibleDescription(grund);
    expect(screen.getAllByText(grund)).toHaveLength(1);
  });

  it('ohne Netz: beide Aktionen gesperrt, der Grund steht einmal am Kopf (CodeRabbit)', async () => {
    renderMitProviders(<Personendaten einsatzId={1} person={TOM} darfSchreiben />, {
      datenRouter: true,
    });
    const aendern = await screen.findByRole('button', { name: 'Haushalt ändern' });
    setzeOnline(false);
    await waitFor(() => expect(aendern).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Zur Bezugsperson machen' })).toBeDisabled();
    expect(screen.getAllByText('Ohne Verbindung nicht änderbar')).toHaveLength(1);
    expect(aendern).toHaveAccessibleDescription('Ohne Verbindung nicht änderbar');
  });

  it('ohne Modul Betreuung oder ohne Stelle im Verbleib keine Aktionen', async () => {
    server.use(
      http.get('/api/einsaetze/1/modul-freigaben', () =>
        HttpResponse.json(freigabenFixture({ betreuung: { zugriff: false } })),
      ),
    );
    renderMitProviders(<Personendaten einsatzId={1} person={TOM} darfSchreiben />, {
      datenRouter: true,
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('button', { name: 'Haushalt ändern' })).toBeNull();
  });

  it('nicht mehr in einer Notunterkunft: keine Aktionen', async () => {
    renderMitProviders(
      <Personendaten
        einsatzId={1}
        person={
          {
            ...TOM,
            aktuelle_verbleib_art: 'entlassung',
            aktuelle_verbleib_betreuungsstelle_id: null,
          } as PersonDetail
        }
        darfSchreiben
      />,
      { datenRouter: true },
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('button', { name: 'Haushalt ändern' })).toBeNull();
  });
});
