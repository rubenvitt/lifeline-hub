import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import type { Zeitachse } from '../api/types';
import KraftZeitachse, { ZEITACHSE_RECHTE_TEXT } from './KraftZeitachse';

const PFAD = '/api/einsaetze/1/personal/7/zeitachse';

const ZEITACHSE: Zeitachse = {
  ereignisse: [
    {
      id: 1,
      art: 'alarmierung',
      zeitpunkt_at: '2026-09-30 04:10:00',
      quelle: 'status',
      erfasst_von: 1,
      erfasst_at: '2026-09-30 04:10:00',
    },
    {
      id: 2,
      art: 'eintreffen',
      zeitpunkt_at: '2026-09-30 04:40:00',
      quelle: 'einheit',
      ursprung_id: 9,
      ursprung_einheit_name: 'Florian 1',
      erfasst_von: 1,
      erfasst_at: '2026-09-30 04:40:00',
    },
    {
      id: 3,
      art: 'entlassung',
      zeitpunkt_at: '2026-09-30 05:00:00',
      quelle: 'nachtrag',
      notiz: 'falsch erfasst',
      erfasst_von: 1,
      erfasst_at: '2026-09-30 05:01:00',
      gestrichen_at: '2026-09-30 05:02:00',
      gestrichen_von: 1,
      streichgrund: 'Zeit verwechselt',
    },
  ],
  perioden: [
    {
      beginn_at: '2026-09-30 04:10:00',
      anker: 'alarmierung',
      eintreffen_at: '2026-09-30 04:40:00',
    },
  ],
};

function rendere(darfSchreiben = true, daten: Zeitachse = ZEITACHSE) {
  server.use(http.get(PFAD, () => HttpResponse.json(daten)));
  return renderMitProviders(
    <KraftZeitachse
      einsatzId={1}
      art="person"
      id={7}
      kennung="Anna"
      darfSchreiben={darfSchreiben}
    />,
  );
}

async function waehle(feld: string, option: string) {
  await userEvent.click(screen.getByRole('combobox', { name: feld }));
  const knoten = await waitFor(() => {
    const k = document.querySelector<HTMLElement>(
      `.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="${option}"]`,
    );
    expect(k).not.toBeNull();
    return k!;
  });
  await userEvent.click(knoten);
}

const eintraege = () => [...document.querySelectorAll('[data-lfh="zeitachse-ereignis"]')];

describe('KraftZeitachse (LFH-552)', () => {
  it('„Herkunft sichtbar": Fan-out trägt „über Einheit" mit dem Namen der Einheit', async () => {
    rendere();
    await waitFor(() => expect(eintraege()).toHaveLength(3));
    expect(eintraege()[1]).toHaveTextContent('über Einheit «Florian 1»');
    expect(eintraege()[0]).toHaveTextContent('aus Status');
  });

  it('eine gestrichene Zeile bleibt lesbar: durchgestrichen, mit Grund, ohne Streichknopf', async () => {
    rendere();
    await waitFor(() => expect(eintraege()).toHaveLength(3));
    const g = eintraege()[2] as HTMLElement;
    expect(g).toHaveAttribute('data-gestrichen', 'true');
    expect(g.querySelector('s')).toHaveTextContent('falsch erfasst');
    expect(g).toHaveTextContent('gestrichen: Zeit verwechselt');
    expect(within(g).queryByRole('button', { name: /streichen/ })).toBeNull();
    // Die übrigen Zeilen tragen genau einen Streichknopf mit Zeilenkennung im Namen.
    expect(
      within(eintraege()[0] as HTMLElement).getByRole('button', {
        name: /^Alarmierung .* streichen$/,
      }),
    ).toBeEnabled();
  });

  it('zeigt die Dauerzeile aus den Perioden (Anker, gesamt)', async () => {
    rendere();
    const zeile = await waitFor(() => {
      const z = document.querySelector('[data-lfh="kraft-dauer"]');
      expect(z).not.toBeNull();
      return z!;
    });
    expect(zeile).toHaveTextContent(/Im Einsatz \d+ h \d\d/);
    expect(zeile).toHaveTextContent(/seit Alarmierung/);
    expect(zeile).toHaveTextContent(/gesamt/);
  });

  it('Leerzustand ohne Ereignisse — kein Dauerwert', async () => {
    rendere(true, { ereignisse: [], perioden: [] });
    expect(await screen.findByText(/Noch keine Ereignisse/)).toBeInTheDocument();
    expect(document.querySelector('[data-lfh="kraft-dauer"]')).toBeNull();
  });

  it('Nachtrag: sendet Art, Zeitpunkt (UTC) und Notiz; Enter im Textfeld sendet', async () => {
    let rumpf: Record<string, unknown> | null = null;
    server.use(
      http.post(PFAD, async ({ request }) => {
        rumpf = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(ZEITACHSE, { status: 201 });
      }),
    );
    rendere();
    await waitFor(() => expect(eintraege()).toHaveLength(3));
    await userEvent.click(screen.getByRole('button', { name: 'Nachtragen' }));
    const dialog = await screen.findByRole('dialog');
    // Die Ablösung ist nicht nachtragbar.
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Ereignis' }));
    expect(
      document.querySelector(
        '.ant-select-dropdown:not(.ant-select-dropdown-hidden) [title="Ablösung"]',
      ),
    ).toBeNull();
    await userEvent.keyboard('{Escape}');
    await waehle('Ereignis', 'Eintreffen');
    const notiz = within(dialog).getByLabelText('Notiz (optional)');
    await userEvent.type(notiz, ' per Funk {Enter}');
    await waitFor(() => expect(rumpf).not.toBeNull());
    expect(rumpf).toMatchObject({ art: 'eintreffen', notiz: 'per Funk' });
    expect(String(rumpf!.zeitpunkt_at)).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
  });

  it('eine 422 steht im Dialog, nicht im Toast, und die Felder bleiben', async () => {
    server.use(
      http.post(PFAD, () =>
        HttpResponse.json(
          { error: 'Die Einsatzperiode trägt schon ein Eintreffen' },
          { status: 422 },
        ),
      ),
    );
    rendere();
    await waitFor(() => expect(eintraege()).toHaveLength(3));
    await userEvent.click(screen.getByRole('button', { name: 'Nachtragen' }));
    const dialog = await screen.findByRole('dialog');
    await waehle('Ereignis', 'Eintreffen');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Nachtragen' }));
    expect(
      await within(dialog).findByText('Die Einsatzperiode trägt schon ein Eintreffen'),
    ).toBeInTheDocument();
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
    expect(within(dialog).getByTitle('Eintreffen')).toBeInTheDocument();
  });

  it('Streichen verlangt einen Grund und schickt ihn', async () => {
    let rumpf: Record<string, unknown> | null = null;
    server.use(
      http.post(`${PFAD}/1/streichen`, async ({ request }) => {
        rumpf = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(ZEITACHSE);
      }),
    );
    rendere();
    await waitFor(() => expect(eintraege()).toHaveLength(3));
    await userEvent.click(screen.getByRole('button', { name: /^Alarmierung .* streichen$/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Ereignis streichen' });
    expect(dialog).toHaveTextContent('lässt sich nicht zurücknehmen');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Streichen' }));
    expect(await within(dialog).findByText('Bitte einen Grund angeben')).toBeInTheDocument();
    expect(rumpf).toBeNull();
    await userEvent.type(within(dialog).getByLabelText('Grund'), 'Zeit verwechselt');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Streichen' }));
    await waitFor(() => expect(rumpf).toEqual({ grund: 'Zeit verwechselt' }));
  });

  it('ohne Schreibrecht: Grund genannt, Nachtragen und Streichen gesperrt statt entfernt', async () => {
    rendere(false);
    await waitFor(() => expect(eintraege()).toHaveLength(3));
    expect(screen.getByText(ZEITACHSE_RECHTE_TEXT)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nachtragen' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Alarmierung .* streichen$/ })).toBeDisabled();
  });

  describe('Vorbelegung des Zeitpunkts', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    /** Review LFH-552: der zweite Nachtrag Stunden später trägt nicht die Zeit des ersten. */
    it('setzt „jetzt" bei jedem Öffnen neu', async () => {
      // Mitlaufend: eine stehende Uhr hielte die Schließanimation des Dialogs an.
      vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
      vi.setSystemTime(new Date('2026-09-30T04:45:00Z'));
      const ruempfe: Record<string, unknown>[] = [];
      server.use(
        http.post(PFAD, async ({ request }) => {
          ruempfe.push((await request.json()) as Record<string, unknown>);
          return HttpResponse.json(ZEITACHSE, { status: 201 });
        }),
      );
      rendere();
      await waitFor(() => expect(eintraege()).toHaveLength(3));
      const laeufe = [
        ['2026-09-30T04:45:00Z', 'Eintreffen'],
        ['2026-09-30T07:00:00Z', 'Entlassung'],
      ] as const;
      for (const [i, [uhr, art]] of laeufe.entries()) {
        vi.setSystemTime(new Date(uhr));
        // Der Öffner steht im Dokument vor jedem Dialog (dessen Knopf heißt ebenso).
        await userEvent.click(screen.getAllByRole('button', { name: 'Nachtragen' })[0]);
        // Der zuletzt geöffnete Dialog; der vorige kann noch in seiner Schließanimation stehen.
        const offen = await screen.findAllByRole('dialog');
        const dialog = offen[offen.length - 1];
        await userEvent.click(within(dialog).getByRole('combobox', { name: 'Ereignis' }));
        const option = await waitFor(() => {
          const k = document.querySelector<HTMLElement>(
            `.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="${art}"]`,
          );
          expect(k).not.toBeNull();
          return k!;
        });
        await userEvent.click(option);
        await userEvent.click(within(dialog).getByRole('button', { name: 'Nachtragen' }));
        await waitFor(() => expect(ruempfe).toHaveLength(i + 1));
      }
      expect(ruempfe.map((r) => String(r.zeitpunkt_at).slice(0, 16))).toEqual([
        '2026-09-30 04:45',
        '2026-09-30 07:00',
      ]);
    });
  });

  it('eine Ablösung — auch die Kopie über die Einheit — trägt keinen Streichknopf', async () => {
    rendere(true, {
      ereignisse: [
        {
          id: 8,
          art: 'abloesung',
          zeitpunkt_at: '2026-09-30 12:40:00',
          quelle: 'einheit',
          ursprung_id: 4,
          ursprung_einheit_name: 'Florian 1',
          erfasst_von: 1,
          erfasst_at: '2026-09-30 12:40:00',
        },
      ],
      perioden: [],
    });
    await waitFor(() => expect(eintraege()).toHaveLength(1));
    expect(within(eintraege()[0] as HTMLElement).queryByRole('button')).toBeNull();
  });

  it('die Rückfrage zum Streichen bestätigt rot (unumkehrbar)', async () => {
    rendere();
    await waitFor(() => expect(eintraege()).toHaveLength(3));
    await userEvent.click(screen.getByRole('button', { name: /^Alarmierung .* streichen$/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Ereignis streichen' });
    expect(within(dialog).getByRole('button', { name: 'Streichen' })).toHaveClass(
      'ant-btn-dangerous',
    );
  });
});
