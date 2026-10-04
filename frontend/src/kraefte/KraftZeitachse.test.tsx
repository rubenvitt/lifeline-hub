import { http, HttpResponse } from 'msw';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { mitProzessZone } from '../test/prozessZone';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
import { renderMitProviders } from '../test/utils';
import { merkeServerzeit, serveruhrVergessenFuerTests } from '../offline/serveruhr';
import { einsatzKeys } from '../api/queryKeys';
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

  it('Nachtrag: die Vorbelegung „jetzt“ gilt nach der Serveruhr (LFH-895)', async () => {
    const serverMs = Date.parse('2026-09-30T10:00:00Z');
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    vi.setSystemTime(serverMs + 5 * 60_000);
    serveruhrVergessenFuerTests();
    merkeServerzeit(new Response(null, { headers: { Date: new Date(serverMs).toUTCString() } }));
    try {
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
      await waehle('Ereignis', 'Eintreffen');
      await userEvent.type(within(dialog).getByLabelText('Notiz (optional)'), 'x{Enter}');
      await waitFor(() => expect(rumpf).not.toBeNull());
      const gesendet = Date.parse(`${String(rumpf!.zeitpunkt_at).replace(' ', 'T')}Z`);
      expect(Math.abs(gesendet - serverMs)).toBeLessThanOrEqual(5_000);
    } finally {
      vi.useRealTimers();
      serveruhrVergessenFuerTests();
    }
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

/**
 * LFH-692 (Spec `zeiteingabe`, Szenario „Zukunftstag nach Kalender der Anzeigezone“): Browser auf
 * UTC, Organisation auf Europe/Berlin, 30.09. 23:30 UTC ist in Berlin schon der 01.10. 01:30.
 */
describe('KraftZeitachse — Nachtrag in der Anzeigezone (LFH-692)', () => {
  mitProzessZone('UTC');
  afterEach(() => {
    vi.useRealTimers();
  });

  it('„jetzt“ steht in Berlin, und der Berliner Kalendertag ist wählbar', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-09-30T23:30:00Z'));
    server.use(http.get(PFAD, () => HttpResponse.json(ZEITACHSE)));
    renderMitProviders(
      <AnzeigeKonventionenProvider konventionen={{ zeitzone: 'Europe/Berlin' }}>
        <KraftZeitachse einsatzId={1} art="person" id={7} kennung="Anna" darfSchreiben />
      </AnzeigeKonventionenProvider>,
    );
    await waitFor(() => expect(eintraege()).toHaveLength(3));
    await userEvent.click(screen.getAllByRole('button', { name: 'Nachtragen' })[0]);
    const dialog = await screen.findByRole('dialog');
    const feld = within(dialog).getByRole('textbox', { name: 'Zeitpunkt' });
    await waitFor(() => expect(feld).toHaveValue('2026-10-01 01:30'));
    await userEvent.click(feld);
    const zelle = (tag: string) => document.querySelector(`td[title="${tag}"]`);
    await waitFor(() => expect(zelle('2026-10-01')).not.toBeNull());
    expect(zelle('2026-10-01')).not.toHaveClass('ant-picker-cell-disabled');
    expect(zelle('2026-10-02')).toHaveClass('ant-picker-cell-disabled');
  });
});

/**
 * LFH-861 (Prüfliste LFH-552, Kriterium 12): ein fremdes neues Ereignis schiebt sich nicht unter
 * Fokus oder Zeiger ein, es wartet hinter dem Sammelbanner. Eigene Nachträge und jede Streichung
 * erscheinen sofort.
 */
describe('KraftZeitachse — Zufluss hinter dem Sammelbanner (LFH-861)', () => {
  /** Fremdes Ereignis, nach Zeit ZWISCHEN den ersten beiden — es schöbe Zeile 2 nach unten. */
  const FREMD: Zeitachse['ereignisse'][number] = {
    id: 4,
    art: 'eintreffen',
    zeitpunkt_at: '2026-09-30 04:20:00',
    quelle: 'status',
    erfasst_von: 2,
    erfasst_at: '2026-09-30 04:20:00',
  };
  const MIT_FREMD: Zeitachse = {
    ...ZEITACHSE,
    ereignisse: [ZEITACHSE.ereignisse[0], FREMD, ...ZEITACHSE.ereignisse.slice(1)],
  };

  const liste = () => document.querySelector<HTMLElement>('[data-lfh="zeitachse-liste"]')!;
  const banner = () => document.querySelector('[data-lfh="sammelbanner"]');
  const zeilen = () => eintraege().map((e) => e.textContent);

  /** Was die Live-Invalidierung (SSE `personal`) auslöst: neuer Serverstand, Refetch. */
  async function liveNachlegen(client: QueryClient, daten: Zeitachse) {
    server.use(http.get(PFAD, () => HttpResponse.json(daten)));
    await act(() => client.invalidateQueries({ queryKey: einsatzKeys.kraefteZeitachse(1) }));
  }

  async function bereit() {
    const r = rendere();
    await waitFor(() => expect(eintraege()).toHaveLength(3));
    return r;
  }

  it('Fokus auf „Streichen": das fremde Ereignis wartet, die fokussierte Zeile bleibt stehen', async () => {
    const { client } = await bereit();
    const knopf = screen.getByRole('button', { name: /^Eintreffen .* streichen$/ });
    act(() => knopf.focus());
    const vorher = zeilen();
    await liveNachlegen(client, MIT_FREMD);
    await waitFor(() => expect(banner()).toHaveTextContent('1 neues Ereignis'));
    expect(eintraege()).toHaveLength(3);
    expect(zeilen()).toEqual(vorher);
    expect(eintraege()[1]).toContainElement(knopf);
    // Das Banner steht UNTER der Liste: darüber verschiebt sich nichts.
    const ol = liste().querySelector('ol')!;
    expect(ol.compareDocumentPosition(banner()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Zeiger über der Liste: das fremde Ereignis wartet; „anzeigen" holt es herein', async () => {
    const { client } = await bereit();
    fireEvent.mouseEnter(liste());
    await liveNachlegen(client, MIT_FREMD);
    await waitFor(() => expect(banner()).not.toBeNull());
    expect(eintraege()).toHaveLength(3);
    fireEvent.click(within(banner() as HTMLElement).getByRole('button', { name: 'anzeigen' }));
    expect(eintraege()).toHaveLength(4);
    expect(eintraege()[1]).toHaveTextContent('aus Status');
    expect(banner()).toBeNull();
  });

  it('weder Fokus noch Zeiger in der Liste: das fremde Ereignis steht sofort da', async () => {
    const { client } = await bereit();
    await liveNachlegen(client, MIT_FREMD);
    await waitFor(() => expect(eintraege()).toHaveLength(4));
    expect(banner()).toBeNull();
  });

  it('verlässt der Zeiger die Liste, fließt das Gehaltene ein', async () => {
    const { client } = await bereit();
    fireEvent.mouseEnter(liste());
    await liveNachlegen(client, MIT_FREMD);
    await waitFor(() => expect(banner()).not.toBeNull());
    fireEvent.mouseLeave(liste());
    expect(eintraege()).toHaveLength(4);
    expect(banner()).toBeNull();
  });

  it('verlässt der Fokus die Liste, fließt das Gehaltene ein; ein Sprung innerhalb hält', async () => {
    const { client } = await bereit();
    const erster = screen.getByRole('button', { name: /^Alarmierung .* streichen$/ });
    const zweiter = screen.getByRole('button', { name: /^Eintreffen .* streichen$/ });
    act(() => erster.focus());
    await liveNachlegen(client, MIT_FREMD);
    await waitFor(() => expect(banner()).not.toBeNull());
    act(() => zweiter.focus());
    expect(eintraege()).toHaveLength(3);
    act(() => screen.getByRole('button', { name: 'Nachtragen' }).focus());
    expect(eintraege()).toHaveLength(4);
    expect(banner()).toBeNull();
  });

  it('verschwindet der fokussierte Knopf ohne focusout (WebKit), taut die Liste beim nächsten Stand', async () => {
    const { client } = await bereit();
    const knopf = screen.getByRole('button', { name: /^Alarmierung .* streichen$/ });
    act(() => knopf.focus());
    await liveNachlegen(client, MIT_FREMD);
    await waitFor(() => expect(banner()).not.toBeNull());
    // Fremd gestrichen: der Knopf fällt weg; der Fokus liegt danach auf <body>.
    const gestrichen: Zeitachse = {
      ...MIT_FREMD,
      ereignisse: MIT_FREMD.ereignisse.map((e) =>
        e.id === 1
          ? {
              ...e,
              gestrichen_at: '2026-09-30 06:00:00',
              gestrichen_von: 2,
              streichgrund: 'doppelt',
            }
          : e,
      ),
    };
    // jsdom feuert beim Entfernen des fokussierten Knotens kein `focusout` — wie WebKit.
    await liveNachlegen(client, gestrichen);
    await waitFor(() => expect(eintraege()).toHaveLength(4));
    expect(banner()).toBeNull();
  });

  it('eine fremde Streichung einer gezeigten Zeile erscheint sofort, auch unter dem Zeiger', async () => {
    const { client } = await bereit();
    fireEvent.mouseEnter(liste());
    await liveNachlegen(client, {
      ...ZEITACHSE,
      ereignisse: ZEITACHSE.ereignisse.map((e) =>
        e.id === 2
          ? {
              ...e,
              gestrichen_at: '2026-09-30 06:00:00',
              gestrichen_von: 2,
              streichgrund: 'doppelt',
            }
          : e,
      ),
    });
    await waitFor(() => expect(eintraege()[1]).toHaveAttribute('data-gestrichen', 'true'));
    expect(banner()).toBeNull();
  });

  it('der eigene Nachtrag erscheint sofort, ein gleichzeitig eingetroffenes fremdes Ereignis wartet', async () => {
    const EIGEN: Zeitachse['ereignisse'][number] = {
      id: 5,
      art: 'entlassung',
      zeitpunkt_at: '2026-09-30 05:30:00',
      quelle: 'nachtrag',
      notiz: 'per Funk',
      erfasst_von: 1,
      erfasst_at: '2026-09-30 05:31:00',
    };
    const NACH_NACHTRAG: Zeitachse = {
      ...MIT_FREMD,
      ereignisse: [...MIT_FREMD.ereignisse, EIGEN],
    };
    server.use(
      http.post(PFAD, () => {
        server.use(http.get(PFAD, () => HttpResponse.json(NACH_NACHTRAG)));
        return HttpResponse.json(NACH_NACHTRAG, { status: 201 });
      }),
    );
    const { client } = await bereit();
    fireEvent.mouseEnter(liste());
    await liveNachlegen(client, MIT_FREMD);
    await waitFor(() => expect(banner()).not.toBeNull());

    const user = userEvent.setup({ skipHover: true });
    await user.click(screen.getByRole('button', { name: 'Nachtragen' }));
    const dialog = await screen.findByRole('dialog');
    await waehle('Ereignis', 'Entlassung');
    await user.type(within(dialog).getByLabelText('Notiz (optional)'), 'per Funk{Enter}');

    await waitFor(() => expect(eintraege()).toHaveLength(4));
    expect(eintraege()[3]).toHaveTextContent('per Funk');
    expect(banner()).toHaveTextContent('1 neues Ereignis');
  });
});
