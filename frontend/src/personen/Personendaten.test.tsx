import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { PersonDetail } from '../api/types';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
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
    // Lesezeile: nichts zu bearbeiten.
    expect(screen.queryByRole('button', { name: /Haushalt/ })).toBeNull();
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

  it('ohne Haushalt keine Zeile', () => {
    renderMitProviders(
      <Personendaten
        einsatzId={1}
        person={{ ...TOM, haushalt_id: null, haushalt_nummer: null }}
        darfSchreiben
      />,
      { datenRouter: true },
    );
    expect(document.querySelector('[data-lfh="haushalt-zeile"]')).toBeNull();
  });
});
