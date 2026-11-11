import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import type { LagebildFreigabeAnzeige } from '../../api/types';
import EinsatzLagebildExtern, { freigabeZeile } from './EinsatzLagebildExtern';

/** Sektion „Lagebild für Externe“ auf der Seite „Geräte“ (LLH-1496, Spec `lagebild-extern`). */

const freigabe = (
  id: number,
  extra: Partial<LagebildFreigabeAnzeige> = {},
): LagebildFreigabeAnzeige => ({
  id,
  empfaenger: `Empfänger ${id}`,
  stufe: 'lagebild',
  gueltig: true,
  gueltig_bis: '2026-11-12 10:00:00',
  angelegt_at: '2026-11-11 10:00:00',
  angelegt_von_name: 'Erika Leitung',
  oeffnungen: 0,
  protokoll: [],
  ...extra,
});

const zeit = (w: string) => w.slice(11, 16);

describe('freigabeZeile', () => {
  it('nennt Stufe, Gültigkeit, Öffnungen und wer den Link ausgab', () => {
    expect(freigabeZeile(freigabe(1), zeit)).toBe(
      'Lagebild · gültig bis 10:00 · 0 Öffnungen · von Erika Leitung',
    );
    expect(
      freigabeZeile(
        freigabe(2, {
          stufe: 'oeffentlich',
          gueltig_bis: undefined,
          oeffnungen: 1,
          zuletzt_abgerufen_at: '2026-11-11 11:30:00',
          angelegt_von_name: undefined,
        }),
        zeit,
      ),
    ).toBe('Öffentlich · bis Einsatzende · 1 Öffnung · zuletzt 11:30');
  });

  it('trennt widerrufen und abgelaufen', () => {
    expect(
      freigabeZeile(
        freigabe(1, {
          gueltig: false,
          widerrufen_at: '2026-11-11 12:00:00',
          widerrufen_von_name: 'Max',
        }),
        zeit,
      ),
    ).toContain('widerrufen von Max um 12:00');
    expect(freigabeZeile(freigabe(1, { gueltig: false }), zeit)).toContain('abgelaufen');
  });
});

function bereit(liste: LagebildFreigabeAnzeige[] = []) {
  const aufrufe: { pfad: string; body: unknown }[] = [];
  server.use(
    http.get('/api/einsaetze/1/lagebild-freigaben', () => HttpResponse.json(liste)),
    http.post('/api/einsaetze/1/lagebild-freigaben', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      aufrufe.push({ pfad: 'anlegen', body });
      return HttpResponse.json(
        {
          freigabe: freigabe(9, {
            empfaenger: body.empfaenger as string,
            stufe: body.stufe as 'lagebild',
          }),
          schluessel: 'llh_lb_GEHEIM',
        },
        { status: 201 },
      );
    }),
    http.post('/api/einsaetze/1/lagebild-freigaben/1/widerrufen', () => {
      aufrufe.push({ pfad: 'widerrufen', body: null });
      return HttpResponse.json([
        freigabe(1, {
          gueltig: false,
          widerrufen_at: '2026-11-11 12:00:00',
          widerrufen_von_name: 'Erika Leitung',
        }),
      ]);
    }),
  );
  return aufrufe;
}

describe('EinsatzLagebildExtern', () => {
  it('gibt einen Link aus und zeigt ihn einmal mit QR', async () => {
    const aufrufe = bereit();
    renderMitProviders(<EinsatzLagebildExtern einsatzId={1} darf />);
    expect(await screen.findByText('Noch kein Link ausgegeben')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Link ausgeben/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Empfänger'), '  Krisenstab Kreis ');
    await userEvent.click(within(dialog).getByRole('button', { name: /Ausgeben/ }));

    await waitFor(() => expect(aufrufe).toHaveLength(1));
    expect(aufrufe[0].body).toEqual({
      empfaenger: 'Krisenstab Kreis',
      stufe: 'lagebild',
      dauer: '24h',
    });
    const link = await screen.findByText(`${window.location.origin}/extern#llh_lb_GEHEIM`);
    expect(link.closest('[data-lfh="lagebild-link"]')?.querySelector('svg')).not.toBeNull();
    // Die Liste trägt den neuen Link sofort, ohne den Schlüssel.
    expect(
      screen.getByText('Krisenstab Kreis', { selector: '[data-lfh="lagebild-freigabe-titel"]' }),
    ).toBeInTheDocument();
  });

  it('widerruft nach Rückfrage und zeigt das Protokoll', async () => {
    const aufrufe = bereit([
      freigabe(1, {
        oeffnungen: 2,
        zuletzt_abgerufen_at: '2026-11-11 11:40:00',
        protokoll: [
          { begonnen_at: '2026-11-11 11:00:00', zuletzt_at: '2026-11-11 11:40:00', abrufe: 5 },
          { begonnen_at: '2026-11-11 10:30:00', zuletzt_at: '2026-11-11 10:30:00', abrufe: 1 },
        ],
      }),
    ]);
    renderMitProviders(<EinsatzLagebildExtern einsatzId={1} darf />);
    const oeffnungen = await screen.findAllByText(/Abruf/, {
      selector: '[data-lfh="lagebild-freigabe-oeffnung"]',
    });
    expect(oeffnungen).toHaveLength(2);
    expect(oeffnungen[0]).toHaveTextContent('5 Abrufe');
    expect(oeffnungen[1]).toHaveTextContent('1 Abruf');

    await userEvent.click(screen.getByRole('button', { name: 'Link für Empfänger 1 widerrufen' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Widerrufen' }));
    await waitFor(() => expect(aufrufe).toEqual([{ pfad: 'widerrufen', body: null }]));
    expect(await screen.findByText(/widerrufen von Erika Leitung/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Link für Empfänger 1 widerrufen' }),
    ).not.toBeInTheDocument();
  });

  it('ohne Recht nur zur Ansicht', async () => {
    bereit([freigabe(1)]);
    renderMitProviders(<EinsatzLagebildExtern einsatzId={1} darf={false} />);
    expect(await screen.findByText('Empfänger 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Link ausgeben/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /widerrufen/ })).not.toBeInTheDocument();
  });
});
