import { describe, it, expect } from 'vitest';
import { delay, http, HttpResponse } from 'msw';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from '../../test/server';
import { freigabenFixture } from '../../test/fixtures';
import { renderMitProviders } from '../../test/utils';
import type { EinsatzMaterial, MaterialStatus, ModulFreigaben, UhsDetail } from '../../api/types';
import MaterialTab, { fehlmengeBegruendung } from './MaterialTab';

/**
 * Der Materialreiter der UHS als Hülle um den Baustein für Material am Ort (LLH-1225, design.md
 * D12): die Posten kommen aus dem UHS-Detail (auch ohne Materialrecht), das Angebot von
 * „Material zuordnen …“ aus der Materialliste (nur mit Freigabe Material, nicht am Gerät).
 * Zuordnen und Lösen schicken den PATCH an die Disposition; Lösen ohne Rückfrage (LFH-363).
 */

const basis = {
  einsatz_id: 1,
  material_id: 5,
  einheit_id: null,
  einsatz_fahrzeug_id: null,
  br_id: null,
  ist_adhoc: false,
  kategorie: 'Betreuung',
  bestandsnummer: null,
  traegerorganisation: null,
  status: 'einsatzbereit',
  art: 'geraet',
  ausgegeben: 0,
  menge: 1,
  bemerkung: null,
  beendet_at: null,
  disponiert_at: '2026-07-30 09:00:00',
  disponiert_von: 1,
};

/** Ohne Ort → steht im Angebot. */
const frei = {
  ...basis,
  id: 10,
  bezeichnung: 'Wolldecke',
  art: 'verbrauchsgut',
  menge: 50,
  uhs_id: null,
} as unknown as EinsatzMaterial;
/** An dieser UHS → steht in den Zeilen. */
const verortet = {
  ...basis,
  id: 12,
  bezeichnung: 'Trage',
  uhs_id: 3,
} as unknown as EinsatzMaterial;
const zweitesVerortet = {
  ...verortet,
  id: 13,
  bezeichnung: 'Vakuummatratze',
} as unknown as EinsatzMaterial;

const uhsMit = (material: EinsatzMaterial[], status = 'aktiv', storniertAt: string | null = null) =>
  ({
    id: 3,
    einsatz_id: 1,
    bezeichnung: 'Turnhalle',
    status,
    storniert_at: storniertAt,
    plaetze: [],
    belegungen: [],
    material,
  }) as unknown as UhsDetail;

interface Patch {
  emId: number;
  body: unknown;
}

const GERAET_ME = {
  id: 9,
  anzeigename: 'UHS Nord · Laptop',
  benutzername: 'geraet-3',
  system_rolle: 'keiner',
  org_rolle: 'keine',
  aktiv: true,
  erstellt_at: '2026-10-04',
  totp_aktiviert: false,
  passwort_gesetzt: false,
  geraet: {
    kopplung_id: 3,
    einsatz_id: 1,
    ansicht: 'uhs-laptop',
    uhs_id: 3,
    stelle: 'UHS Nord',
    bezeichnung: 'Laptop',
    laeuft_ab_at: '2026-10-05 12:00:00',
  },
};

/**
 * Rendert den Reiter und gibt die aufgezeichneten PATCHes und Abrufe der Materialliste zurück —
 * geprüft wird der Weg bis zum Request, nicht der Aufruf eines Doubles.
 */
function render({
  hier = [verortet],
  liste = [frei, verortet],
  schreibgeschuetzt = false,
  status = 'aktiv',
  storniertAt = null,
  freigaben = freigabenFixture(),
  listeKaputt = false,
  patch,
}: {
  hier?: EinsatzMaterial[];
  liste?: EinsatzMaterial[];
  schreibgeschuetzt?: boolean;
  status?: string;
  storniertAt?: string | null;
  freigaben?: ModulFreigaben;
  listeKaputt?: boolean;
  patch?: Parameters<typeof http.patch>[1];
} = {}) {
  const patches: Patch[] = [];
  const abrufe: string[] = [];
  server.use(
    http.get('/api/einsaetze/1/modul-freigaben', () => HttpResponse.json(freigaben)),
    http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/abschnitte', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/material', () => {
      abrufe.push('material');
      return listeKaputt
        ? HttpResponse.json({ error: 'kaputt' }, { status: 500 })
        : HttpResponse.json(liste);
    }),
    http.patch('/api/einsaetze/1/material/:emId', async (info) => {
      patches.push({ emId: Number(info.params.emId), body: await info.request.clone().json() });
      return patch ? patch(info) : HttpResponse.json({});
    }),
  );
  return {
    patches,
    abrufe,
    ...renderMitProviders(
      <MaterialTab
        einsatzId={1}
        uhs={uhsMit(hier, status, storniertAt)}
        schreibgeschuetzt={schreibgeschuetzt}
      />,
      { route: '/einsaetze/1/unfallhilfsstellen/3' },
    ),
  };
}

const zeile = (text: string) =>
  screen.getByText(text).closest('[data-lfh="material-am-ort-zeile"]') as HTMLElement;
const auswahl = () => screen.getByRole('combobox', { name: 'Material zuordnen' });
/** Bedienbar erst, wenn `/me` feststeht (am Gerät bleibt der Reiter lesend). */
const bereit = () => screen.findByRole('combobox', { name: 'Material zuordnen' });
const toasts = () => document.querySelectorAll('.ant-message-notice').length;

describe('MaterialTab · Posten aus dem UHS-Detail (LLH-1225 D12)', () => {
  it('zeigt die Posten der UHS mit Kategorie, Menge, Status und Kopfzahl', async () => {
    render({
      hier: [
        verortet,
        { ...zweitesVerortet, status: 'defekt' as MaterialStatus },
        { ...frei, id: 14, uhs_id: 3, ausgegeben: 20 } as EinsatzMaterial,
      ],
    });
    expect(screen.getByTestId('material-am-ort-kopf')).toHaveTextContent('3 Posten · 1 Ausfall');
    expect(zeile('Trage')).toHaveTextContent('Betreuung');
    expect(zeile('Wolldecke')).toHaveTextContent('30 von 50 übrig');
    expect(zeile('Vakuummatratze')).toHaveTextContent('defekt');
  });

  it('zeigt den Materialstatus als Etikett, nie den rohen Wire-Wert', () => {
    render({ hier: [{ ...verortet, status: 'desinfektion_noetig' as MaterialStatus }] });
    expect(screen.getByText('Desinfektion nötig')).toBeInTheDocument();
    expect(screen.queryByText('desinfektion_noetig')).not.toBeInTheDocument();
  });

  it('setzt die Menge in die Zahlenschrift, die Bezeichnung nicht', () => {
    render();
    const menge = within(zeile('Trage')).getByText('1');
    expect(menge.style.fontFamily).toContain('JetBrains Mono');
    expect(screen.getByText('Trage').style.fontFamily).toBe('');
  });
});

describe('MaterialTab · Zuordnen und Lösen über den einen Schreibweg (LLH-1225 D2)', () => {
  it('„Material zuordnen …“ setzt den gewählten Posten an diese UHS', async () => {
    const { patches } = render();
    await userEvent.click(await bereit());
    await userEvent.click(await screen.findByText('Wolldecke · 50'));
    // Ein aufteilbares Verbrauchsgut fragt die Menge (t1hvaqzu, design.md D6); die vorbelegte
    // ganze Menge holt den Posten wie bisher über den PATCH.
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Wolldecke hierher');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hierher' }));
    await waitFor(() => expect(patches).toEqual([{ emId: 10, body: { uhs_id: 3 } }]));
  });

  it('löst ohne Rückfrage — ein Klick, ein PATCH', async () => {
    const { patches } = render();
    await bereit();
    await userEvent.click(screen.getByRole('button', { name: 'Trage lösen' }));
    await waitFor(() => expect(patches).toEqual([{ emId: 12, body: { uhs_id: null } }]));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  /**
   * Ohne Rückfrage fängt ein `loading` je Zeile den zweiten Klick ab — sonst kostete jeder Klick
   * einen PATCH samt Invalidierung, Live-Ereignis und Erfolgsmeldung.
   */
  it('nimmt keinen zweiten Klick an, solange der PATCH läuft', async () => {
    let freigeben!: () => void;
    const versprechen = new Promise<void>((r) => (freigeben = r));
    const { patches } = render({
      hier: [verortet, zweitesVerortet],
      patch: async () => {
        await versprechen;
        return HttpResponse.json({});
      },
    });
    await bereit();
    const erste = screen.getByRole('button', { name: 'Trage lösen' });
    await userEvent.click(erste);
    await waitFor(() => expect(patches).toHaveLength(1));
    await userEvent.click(erste);
    expect(patches).toHaveLength(1);
    // Der Riegel liegt an dieser Zeile.
    expect(screen.getByRole('button', { name: 'Vakuummatratze lösen' })).not.toHaveClass(
      'ant-btn-loading',
    );
    await act(async () => freigeben());
    await waitFor(() => expect(erste).not.toHaveClass('ant-btn-loading'));
  });

  it('ohne Schreibrecht gibt es weder Lösen noch Zuordnen, und die Liste wird nicht abgefragt', () => {
    const { abrufe } = render({ schreibgeschuetzt: true });
    expect(zeile('Trage')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(abrufe).toEqual([]);
  });
});

/**
 * Sperrgrund statt stummer Sperre (LFH-970, U78): ohne anzubietendes Material steht neben der
 * Auswahl, warum sie nicht geht, und der Sprung ins Modul Material.
 */
describe('MaterialTab · Sperrgrund „Material zuordnen …“ (LFH-970)', () => {
  it('nennt den Grund und springt ins Modul Material, wenn nichts anzubieten ist', async () => {
    render({ liste: [verortet] });
    await waitFor(() => expect(auswahl()).toBeDisabled());
    expect(auswahl()).toHaveAccessibleDescription(/Kein anderes Material/);
    expect(screen.getByRole('link', { name: /^Material/ })).toHaveAttribute(
      'href',
      '/einsaetze/1/material',
    );
  });

  it('meldet einen gescheiterten Abruf als Fehler, nicht als stumme Sperre', async () => {
    render({ listeKaputt: true });
    expect(await screen.findByText('Material konnte nicht geladen werden')).toBeInTheDocument();
    expect(auswahl()).toBeDisabled();
  });

  it('meldet keinen Fehler, wenn nur ein Abgleich im Hintergrund scheitert', async () => {
    const { client } = render();
    await bereit();
    await waitFor(() => expect(auswahl()).toBeEnabled());
    await screen.findByText('Trage');
    server.use(
      http.get('/api/einsaetze/1/material', () =>
        HttpResponse.json({ error: 'kaputt' }, { status: 500 }),
      ),
    );
    await client.refetchQueries();
    await waitFor(() =>
      expect(
        client
          .getQueryCache()
          .findAll()
          .some((q) => q.state.status === 'error'),
      ).toBe(true),
    );
    expect(auswahl()).toBeEnabled();
    expect(screen.queryByText('Material konnte nicht geladen werden')).toBeNull();
  });

  it('ohne Freigabe Material: Posten stehen, Auswahl gesperrt mit Grund, die Liste wird nicht abgefragt', async () => {
    const { abrufe } = render({ freigaben: freigabenFixture({ material: { zugriff: false } }) });
    await waitFor(() => expect(auswahl()).toHaveAccessibleDescription('Modul Material gesperrt'));
    expect(auswahl()).toBeDisabled();
    expect(zeile('Trage')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Trage lösen' })).toBeNull();
    expect(abrufe).toEqual([]);
  });
});

describe('MaterialTab · Speicherfehler am Ort (LFH-1077)', () => {
  it('Zuordnen: der Grund steht unter der Auswahl, kein Toast', async () => {
    render({
      patch: () => HttpResponse.json({ error: 'Material ist ausgegeben' }, { status: 409 }),
    });
    await userEvent.click(await bereit());
    await userEvent.click(await screen.findByText('Wolldecke · 50'));
    // Bei der Mengenfrage steht der Grund im Dialog (t1hvaqzu, Spec `material-am-ort`).
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Wolldecke hierher');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hierher' }));
    expect(await within(dialog).findByText('Material ist ausgegeben')).toBeInTheDocument();
    expect(within(dialog).getByText('Nicht zugeordnet')).toBeInTheDocument();
    expect(toasts()).toBe(0);
  });

  it('Lösen: zwei Zeilen nebenläufig, die späte Ablehnung der ersten steht an ihr', async () => {
    let lehneAb: () => void = () => {};
    const ersteAblehnung = new Promise<void>((r) => (lehneAb = r));
    render({
      hier: [verortet, zweitesVerortet],
      patch: async ({ params }) => {
        if (params.emId === '12') {
          await ersteAblehnung;
          return HttpResponse.json({ error: 'Material wird gerade verlegt' }, { status: 409 });
        }
        await delay('infinite');
        return HttpResponse.json({});
      },
    });
    await bereit();
    await userEvent.click(screen.getByRole('button', { name: 'Trage lösen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Vakuummatratze lösen' }));
    await act(async () => lehneAb());
    expect(await within(zeile('Trage')).findByRole('alert')).toHaveTextContent(
      'Material wird gerade verlegt',
    );
    expect(within(zeile('Vakuummatratze')).queryByRole('alert')).toBeNull();
    expect(toasts()).toBe(0);
  });
});

/** LLH-1093 D14: eine aufgelöste UHS nimmt kein Material mehr an (Server 422). */
describe('MaterialTab · aufgelöste UHS (LLH-1093)', () => {
  it('sperrt „Material zuordnen …“ mit dem Grund „UHS aufgelöst“, Lösen bleibt', async () => {
    render({ status: 'aufgeloest' });
    expect(await bereit()).toBeDisabled();
    expect(auswahl()).toHaveAccessibleDescription('UHS aufgelöst');
    expect(screen.getByRole('button', { name: 'Trage lösen' })).toBeEnabled();
  });
});

/** Review LLH-1225: eine stornierte UHS sperrt wie eine aufgelöste. */
describe('MaterialTab · stornierte UHS', () => {
  it('sperrt Zuordnen und Ausgeben mit dem Grund „UHS storniert“, Lösen bleibt', async () => {
    render({
      hier: [verortet, { ...frei, id: 14, uhs_id: 3 } as EinsatzMaterial],
      storniertAt: '2026-10-15 08:00:00',
    });
    expect(await bereit()).toBeDisabled();
    expect(auswahl()).toHaveAccessibleDescription('UHS storniert');
    expect(screen.queryByRole('button', { name: 'Wolldecke ausgeben' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Trage lösen' })).toBeEnabled();
  });
});

/** „Fehlmenge melden“ (LLH-1133 D5, Spec `material-am-ort`, „Fehlmenge vom Ort melden“). */
describe('MaterialTab · Fehlmenge melden', () => {
  it('springt in die Erfassung einer Nachforderung, vorbelegt mit Art Material und der UHS', async () => {
    render();
    const sprung = await screen.findByRole('link', { name: /Fehlmenge melden/ });
    const href = new URL(sprung.getAttribute('href')!, 'http://x');
    expect(href.pathname).toBe('/einsaetze/1/nachforderungen');
    expect(href.searchParams.get('neu')).toBe('1');
    expect(href.searchParams.get('art')).toBe('Material');
    expect(href.searchParams.get('begruendung')).toBe('Fehlmenge UHS «Turnhalle»');
    // Bezeichnung und Anzahl kennt nur die Person: keine erfundene Fehlmenge.
    expect(href.searchParams.has('anzahl')).toBe(false);
    expect(href.searchParams.has('bezeichnung')).toBe(false);
  });

  it('fehlt ohne Freigabe des Moduls Nachforderungen', async () => {
    render({ freigaben: freigabenFixture({ nachforderungen: { zugriff: false } }) });
    // Positiver Anker: der Reiter bedient (Freigaben stehen fest), nur der Sprung fehlt.
    await bereit();
    await waitFor(() => expect(auswahl()).toBeEnabled());
    expect(screen.queryByRole('link', { name: /Fehlmenge melden/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Fehlmenge melden/ })).toBeNull();
  });

  it('fehlt ohne Schreibrecht', async () => {
    render({ schreibgeschuetzt: true });
    await waitFor(() => expect(zeile('Trage')).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: /Fehlmenge melden/ })).toBeNull();
  });
});

/** Der UHS-Laptop liest das Material seiner UHS nur (LFH-892, Spec `material-am-ort`). */
describe('MaterialTab · Gerät (UHS-Laptop)', () => {
  it('zeigt die Posten ohne Bedienelemente und fragt weder Liste noch Freigaben ab', async () => {
    const abgefragt: string[] = [];
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(GERAET_ME)),
      http.get('/api/einsaetze/1/material', () => {
        abgefragt.push('material');
        return HttpResponse.json([frei]);
      }),
      http.get('/api/einsaetze/1/modul-freigaben', () => {
        abgefragt.push('freigaben');
        return HttpResponse.json(freigabenFixture());
      }),
    );
    renderMitProviders(
      <MaterialTab einsatzId={1} uhs={uhsMit([verortet])} schreibgeschuetzt={false} />,
      { route: '/geraet/3/uhs/3' },
    );
    // Die Sitzung des Geräts kommt mit `/me`; bis dahin ist der Reiter nur lesend.
    await waitFor(() => expect(zeile('Trage')).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(abgefragt).toEqual([]);
  });
});

describe('fehlmengeBegruendung', () => {
  it('nennt die UHS einmal, auch wenn die Bezeichnung mit „UHS“ beginnt', () => {
    expect(fehlmengeBegruendung('Turnhalle')).toBe('Fehlmenge UHS «Turnhalle»');
    expect(fehlmengeBegruendung('UHS Nord')).toBe('Fehlmenge «UHS Nord»');
  });
});
