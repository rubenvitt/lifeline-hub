import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import { freigabenFixture } from '../../test/fixtures';
import type { Einheit, EinsatzFahrzeug, EinsatzPersonal, ModulFreigaben } from '../../api/types';
import { buildEinheitRechte } from './einheitAnsichtKern';
import FahrzeugeBesatzung from './FahrzeugeBesatzung';

/**
 * Paneel „Fahrzeuge und Besatzung“ (LLH-1036 Teil II, design.md D5, D9, D10): die Rechnung des
 * Kräftebaums (`mittelDerEinheit`), ein Menü je Person, „Aus Einheit lösen“ je Fahrzeug, ohne
 * Freigabe Personal oder Fahrzeuge die Mitglieder flach mit Hinweis.
 */

const person = (id: number, name: string, teil: Partial<EinsatzPersonal> = {}): EinsatzPersonal =>
  ({
    id,
    name,
    einheit_id: 10,
    fahrzeug_id: null,
    staerke_position: null,
    einsatzfunktion: null,
    funktion: null,
    ...teil,
  }) as EinsatzPersonal;

const fahrzeug = (id: number, funkrufname: string, teil: Partial<EinsatzFahrzeug> = {}) =>
  ({
    id,
    funkrufname,
    einheit_id: 10,
    fahrzeugtyp: 'HLF 20',
    soll_besatzung: { fuehrer: 1, unterfuehrer: 1, mannschaft: 4 },
    status_id: 102,
    status_label: '2 – Frei auf Wache',
    status_kategorie: 'verfuegbar',
    ...teil,
  }) as EinsatzFahrzeug;

const PERSONAL = [
  person(2, 'Bernd Mann', { fahrzeug_id: 30, staerke_position: 'mannschaft' }),
  person(1, 'Anna Führer', { fahrzeug_id: 30, staerke_position: 'fuehrer' }),
  person(3, 'Clara Unter', {
    fahrzeug_id: 30,
    staerke_position: 'unterfuehrer',
    einsatzfunktion: 'Maschinistin',
  }),
  person(4, 'Dora Ohne'),
  person(5, 'Emil Fremdfahrer', { fahrzeug_id: 99 }),
  person(6, 'Fritz Gast', { einheit_id: 11, fahrzeug_id: 30 }),
];
const FAHRZEUGE = [
  fahrzeug(31, '83-2'),
  fahrzeug(30, '83-1'),
  fahrzeug(99, 'Florian 9', { einheit_id: 11 }),
];

function einheit(o: Partial<Einheit> = {}): Einheit {
  return {
    id: 10,
    name: '1. Zug',
    fuehrer_id: 1,
    aufgeloest_at: null,
    personal_mitglieder: [
      { ep_id: 1, name: 'Anna Führer', staerke_position: 'fuehrer', ist_fuehrer: true },
      { ep_id: 2, name: 'Bernd Mann', staerke_position: 'mannschaft', ist_fuehrer: false },
      { ep_id: 3, name: 'Clara Unter', staerke_position: 'unterfuehrer', ist_fuehrer: false },
      { ep_id: 4, name: 'Dora Ohne', staerke_position: null, ist_fuehrer: false },
      { ep_id: 5, name: 'Emil Fremdfahrer', staerke_position: null, ist_fuehrer: false },
    ],
    fahrzeug_mitglieder: [
      {
        ef_id: 30,
        funkrufname: '83-1',
        fahrzeugtyp: 'HLF 20',
        status: {
          status_id: 102,
          label: '2 – Frei auf Wache',
          kategorie: 'verfuegbar',
          fms_anker: 2,
          sortier: 2,
        },
      },
      { ef_id: 31, funkrufname: '83-2', fahrzeugtyp: 'HLF 20', status: null },
    ],
    material_mitglieder: [],
    ...o,
  } as unknown as Einheit;
}
const GAST = { ...einheit(), id: 11, name: 'Gr 2' } as Einheit;

const KATALOG = [
  {
    id: 102,
    label: '2 – Frei auf Wache',
    kategorie: 'verfuegbar',
    farbe: null,
    fms_anker: 2,
    sortier: 2,
  },
  {
    id: 103,
    label: '3 – Einsatz übernommen',
    kategorie: 'im_einsatz',
    farbe: null,
    fms_anker: 3,
    sortier: 3,
  },
];

interface Optionen {
  e?: Einheit;
  personal?: readonly EinsatzPersonal[] | undefined;
  fahrzeuge?: readonly EinsatzFahrzeug[] | undefined;
  darfSchreiben?: boolean;
  freigaben?: ModulFreigaben;
  listState?: 'daten' | 'laden' | 'fehler';
}

function zeige({
  e = einheit(),
  personal = PERSONAL,
  fahrzeuge = FAHRZEUGE,
  darfSchreiben = true,
  freigaben = freigabenFixture(),
  listState = 'daten',
}: Optionen = {}) {
  server.use(http.get('/api/fahrzeug-status', () => HttpResponse.json(KATALOG)));
  const rechte = buildEinheitRechte(darfSchreiben, freigaben);
  const onSetFuehrer = vi.fn<(epId: number) => Promise<unknown>>().mockResolvedValue(undefined);
  const onReload = vi.fn();
  const r = renderMitProviders(
    <FahrzeugeBesatzung
      einsatzId={1}
      einheit={e}
      einheiten={[e, GAST]}
      // Wie die Seite: ohne Freigabe oder solange eine Liste lädt bzw. fehlt, keine Liste.
      personal={rechte.hasBesatzung && listState === 'daten' ? personal : undefined}
      fahrzeuge={rechte.hasBesatzung && listState === 'daten' ? fahrzeuge : undefined}
      rechte={rechte}
      listState={listState}
      onReload={onReload}
      onSetFuehrer={onSetFuehrer}
    />,
  );
  return { ...r, onSetFuehrer, onReload };
}

const paneel = () => screen.getByRole('region', { name: 'Fahrzeuge und Besatzung' });
const gruppe = (name: string) => screen.getByRole('group', { name });
const namenIn = (el: HTMLElement) =>
  [...el.querySelectorAll('[data-lfh="einheit-person"] [data-lfh="einheit-person-name"]')].map(
    (n) => n.textContent,
  );
const personZeile = (name: string) =>
  screen
    .getByText(name, {
      selector: '[data-lfh="einheit-person-name"], [data-lfh="einheit-person-name"] *',
    })
    .closest('[data-lfh="einheit-person"]') as HTMLElement;
const fahrzeugZeile = (funkrufname: string) =>
  within(gruppe(`Fahrzeug ${funkrufname}`))
    .getByText(funkrufname)
    .closest('[data-lfh="einheit-fahrzeug"]') as HTMLElement;

/**
 * Das offene antd-Menü (`frontend/AGENTS.md`, „Datensatz-Aktionen werden gebündelt“). Jede Person
 * hat ihr eigenes Portal, das beim ersten Öffnen ans Ende von `body` kommt; das zuletzt
 * geöffnete ist deshalb das letzte, auch solange das vorige noch ausblendet.
 */
async function oeffneMenue(name: string) {
  await userEvent.click(screen.getByRole('button', { name: `Aktionen zu Person ${name}` }));
  return waitFor(() => {
    const offen = document.querySelectorAll<HTMLElement>(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    );
    expect(offen.length).toBeGreaterThan(0);
    return offen[offen.length - 1];
  });
}
/** Wählt am Status eines Fahrzeugs einen Eintrag, im zuletzt geöffneten Menü. */
async function waehleStatus(funkrufname: string, eintrag: string) {
  await userEvent.click(
    within(fahrzeugZeile(funkrufname)).getByRole('button', {
      name: `Status von ${funkrufname} ändern`,
    }),
  );
  const menue = await waitFor(() => {
    const offen = document.querySelectorAll<HTMLElement>(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    );
    expect(offen.length).toBeGreaterThan(0);
    return offen[offen.length - 1];
  });
  await userEvent.click(within(menue).getByText(eintrag));
}
const eintraege = (menue: HTMLElement) =>
  within(menue)
    .getAllByRole('menuitem')
    .map((m) => m.textContent);

describe('FahrzeugeBesatzung · Gruppierung (D5)', () => {
  it('Fahrzeuge in Funkrufname-Folge, je mit Besatzung EF, F, UF, M; der Rest unter „Ohne Fahrzeug“', () => {
    zeige();
    const fahrzeugGruppen = within(paneel())
      .getAllByRole('group')
      .map((g) => g.getAttribute('aria-label'));
    expect(fahrzeugGruppen).toEqual(['Fahrzeug 83-1', 'Fahrzeug 83-2', 'Ohne Fahrzeug']);
    expect(namenIn(gruppe('Fahrzeug 83-1'))).toEqual(['Anna Führer', 'Clara Unter', 'Bernd Mann']);
    expect(namenIn(gruppe('Fahrzeug 83-2'))).toEqual([]);
    expect(namenIn(gruppe('Ohne Fahrzeug'))).toEqual(['Dora Ohne', 'Emil Fremdfahrer']);
    // Marken EF und Position, Funktion als Nebentext.
    expect(personZeile('Anna Führer')).toHaveTextContent(/^FEF/);
    expect(personZeile('Clara Unter')).toHaveTextContent('Maschinistin');
  });

  it('nennt Besatzung Ist/Soll mit Wort und die fremde Besatzung am Fahrzeug', () => {
    zeige();
    const zeile = fahrzeugZeile('83-1');
    expect(zeile).toHaveTextContent('Ist 1/1/2//4 · Soll 1/1/4//6');
    expect(zeile).toHaveTextContent('unterbesetzt');
    expect(zeile).toHaveTextContent('davon 1 aus Gr 2');
    expect(zeile).toHaveTextContent('HLF 20');
    expect(fahrzeugZeile('83-2')).toHaveTextContent('Besatzung nicht erfasst');
  });

  it('eine Person auf dem Fahrzeug einer anderen Einheit fährt dort', () => {
    zeige();
    expect(personZeile('Emil Fremdfahrer')).toHaveTextContent('fährt auf Florian 9');
    expect(within(paneel()).queryByText('Fritz Gast')).toBeNull();
  });

  it('Einheit ohne Fahrzeug: Personal ohne Zwischenebene', () => {
    zeige({
      e: einheit({ fahrzeug_mitglieder: [] }),
      personal: [person(4, 'Dora Ohne'), person(7, 'Gerd Zwei')],
      fahrzeuge: [],
    });
    expect(within(paneel()).queryByRole('group')).toBeNull();
    expect(within(paneel()).queryByText('Ohne Fahrzeug')).toBeNull();
    expect(namenIn(paneel())).toEqual(['Dora Ohne', 'Gerd Zwei']);
  });

  it('Namen und Funkrufnamen springen in ihr Modul', () => {
    zeige();
    expect(
      within(personZeile('Anna Führer')).getByRole('link', { name: 'Anna Führer' }),
    ).toHaveAttribute('href', '/einsaetze/1/personal/1');
    expect(within(fahrzeugZeile('83-1')).getByRole('link', { name: '83-1' })).toHaveAttribute(
      'href',
      '/einsaetze/1/fahrzeuge?fahrzeug=30',
    );
  });
});

describe('FahrzeugeBesatzung · ohne Freigabe Personal oder Fahrzeuge (D5)', () => {
  it('Personal gesperrt: Fahrzeuge und Mitglieder flach, Hinweis, kein Link ins Personal', () => {
    zeige({ freigaben: freigabenFixture({ personal: { zugriff: false } }) });
    expect(within(paneel()).getByRole('status')).toHaveTextContent(
      'Ohne Besatzung Modul Personal gesperrt',
    );
    expect(within(paneel()).queryByRole('group')).toBeNull();
    expect(namenIn(paneel())).toEqual([
      'Anna Führer',
      'Bernd Mann',
      'Clara Unter',
      'Dora Ohne',
      'Emil Fremdfahrer',
    ]);
    expect(within(paneel()).queryByText(/fährt auf/)).toBeNull();
    expect(within(paneel()).queryByText(/Ist \d/)).toBeNull();
    expect(within(paneel()).queryByRole('link', { name: 'Anna Führer' })).toBeNull();
    // Die Fahrzeuge stehen weiter, Status als Wort, Funkrufname als Link (Fahrzeuge frei).
    const zeile = screen.getByText('83-1').closest('[data-lfh="einheit-fahrzeug"]') as HTMLElement;
    expect(zeile).toHaveTextContent('Frei auf Wache');
    expect(within(zeile).getByRole('link', { name: '83-1' })).toBeInTheDocument();
    expect(within(zeile).queryByRole('button', { name: /^Status von/ })).toBeNull();
  });

  it('Fahrzeuge gesperrt: ebenso flach, kein Link ins Fahrzeugmodul, Menü ohne Besatzungswege', async () => {
    zeige({ freigaben: freigabenFixture({ fahrzeuge: { zugriff: false } }) });
    expect(within(paneel()).getByRole('status')).toHaveTextContent(
      'Ohne Besatzung Modul Fahrzeuge gesperrt',
    );
    expect(within(paneel()).queryByRole('link', { name: '83-1' })).toBeNull();
    expect(within(paneel()).getByRole('link', { name: 'Dora Ohne' })).toBeInTheDocument();
    expect(eintraege(await oeffneMenue('Dora Ohne'))).toEqual([
      'Als Einheitsführer',
      'Aus Einheit lösen',
    ]);
  });

  it('Gegenprobe: mit beiden Freigaben kein Hinweis, Besatzung steht', () => {
    zeige();
    expect(within(paneel()).queryByRole('status')).toBeNull();
    expect(gruppe('Fahrzeug 83-1')).toBeInTheDocument();
  });
});

describe('FahrzeugeBesatzung · Menü je Person (D9)', () => {
  it('Person ohne Fahrzeug: Einheitsführer, auf jedes Fahrzeug, rot aus der Einheit', async () => {
    zeige();
    const menue = await oeffneMenue('Dora Ohne');
    expect(eintraege(menue)).toEqual([
      'Als Einheitsführer',
      'Auf 83-1',
      'Auf 83-2',
      'Aus Einheit lösen',
    ]);
    expect(within(menue).getByRole('separator')).toBeInTheDocument();
  });

  it('der Einheitsführer auf 83-1: auf das andere Fahrzeug, vom Fahrzeug lösen', async () => {
    zeige();
    expect(eintraege(await oeffneMenue('Anna Führer'))).toEqual([
      'Auf 83-2',
      'Vom Fahrzeug lösen',
      'Aus Einheit lösen',
    ]);
  });

  it('„Auf 83-2“ setzt die Besatzung, „Vom Fahrzeug lösen“ löst sie', async () => {
    const aufrufe: string[] = [];
    server.use(
      http.put('/api/einsaetze/1/fahrzeuge/:efId/besatzung/:epId', ({ params }) => {
        aufrufe.push(`PUT ${params.efId}/${params.epId}`);
        return new HttpResponse(null, { status: 204 });
      }),
      http.delete('/api/einsaetze/1/fahrzeuge/:efId/besatzung/:epId', ({ params }) => {
        aufrufe.push(`DELETE ${params.efId}/${params.epId}`);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    zeige();
    await userEvent.click(within(await oeffneMenue('Dora Ohne')).getByText('Auf 83-2'));
    await userEvent.click(within(await oeffneMenue('Clara Unter')).getByText('Vom Fahrzeug lösen'));
    await waitFor(() => expect(aufrufe).toEqual(['PUT 31/4', 'DELETE 30/3']));
  });

  it('„Als Einheitsführer“ geht über den Kopfweg, „Aus Einheit lösen“ über die Einheit', async () => {
    const geloest: string[] = [];
    server.use(
      http.delete('/api/einsaetze/1/einheiten/10/personal/:epId', ({ params }) => {
        geloest.push(String(params.epId));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { onSetFuehrer } = zeige();
    await userEvent.click(within(await oeffneMenue('Dora Ohne')).getByText('Als Einheitsführer'));
    expect(onSetFuehrer).toHaveBeenCalledWith(4);
    await userEvent.click(within(await oeffneMenue('Bernd Mann')).getByText('Aus Einheit lösen'));
    await waitFor(() => expect(geloest).toEqual(['2']));
  });

  it('zwei schnelle Aktionen: der Grund steht an der Zeile, die abgelehnt wurde', async () => {
    let lehneAb: () => void = () => {};
    const ersteAblehnung = new Promise<void>((r) => (lehneAb = r));
    server.use(
      http.put('/api/einsaetze/1/fahrzeuge/:efId/besatzung/:epId', async ({ params }) => {
        if (params.epId === '4') {
          await ersteAblehnung;
          return HttpResponse.json({ error: 'Fahrzeug ist voll' }, { status: 409 });
        }
        await delay('infinite');
        return new HttpResponse(null, { status: 204 });
      }),
    );
    zeige();
    await userEvent.click(within(await oeffneMenue('Dora Ohne')).getByText('Auf 83-1'));
    await userEvent.click(within(await oeffneMenue('Emil Fremdfahrer')).getByText('Auf 83-2'));
    lehneAb();
    expect(await within(personZeile('Dora Ohne')).findByText('Fahrzeug ist voll')).toHaveAttribute(
      'data-fehler',
    );
    expect(personZeile('Emil Fremdfahrer').querySelector('[data-fehler]')).toBeNull();
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });
  it('Rückmeldung vor der Antwort: der Auslöser der Person lädt, der einer anderen nicht', async () => {
    server.use(
      http.put('/api/einsaetze/1/fahrzeuge/:efId/besatzung/:epId', async () => {
        await delay('infinite');
        return new HttpResponse(null, { status: 204 });
      }),
    );
    zeige();
    await userEvent.click(within(await oeffneMenue('Dora Ohne')).getByText('Auf 83-2'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Aktionen zu Person Dora Ohne' })).toHaveClass(
        'ant-btn-loading',
      ),
    );
    expect(screen.getByRole('button', { name: 'Aktionen zu Person Bernd Mann' })).not.toHaveClass(
      'ant-btn-loading',
    );
  });
});

describe('FahrzeugeBesatzung · Fahrzeugzeile (D10)', () => {
  it('FMS-Status an der Zeile setzen schickt `status_id`', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.patch('/api/einsaetze/1/fahrzeuge/30', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(FAHRZEUGE[1]);
      }),
    );
    zeige();
    await userEvent.click(
      within(fahrzeugZeile('83-1')).getByRole('button', { name: /^Status von 83-1/ }),
    );
    await userEvent.click(await screen.findByText('S3 · Einsatz übernommen'));
    await waitFor(() => expect(bodies).toEqual([{ status_id: 103 }]));
  });

  it('„Aus Einheit lösen“ rot an der Zeile, der Grund steht dort', async () => {
    server.use(
      http.delete('/api/einsaetze/1/einheiten/10/fahrzeug/30', () =>
        HttpResponse.json({ error: 'Fahrzeug ist gebunden' }, { status: 409 }),
      ),
    );
    zeige();
    const knopf = within(fahrzeugZeile('83-1')).getByRole('button', { name: 'Aus Einheit lösen' });
    expect(knopf).toHaveClass('ant-btn-dangerous');
    await userEvent.click(knopf);
    expect(await within(fahrzeugZeile('83-1')).findByText('Fahrzeug ist gebunden')).toHaveAttribute(
      'data-fehler',
    );
    expect(fahrzeugZeile('83-2').querySelector('[data-fehler]')).toBeNull();
  });

  it('abgelehnte FMS-Wahl: der Grund steht an der Fahrzeugzeile, kein Toast', async () => {
    server.use(
      http.patch('/api/einsaetze/1/fahrzeuge/30', () =>
        HttpResponse.json({ error: 'Status ist gesperrt' }, { status: 409 }),
      ),
    );
    zeige();
    await waehleStatus('83-1', 'S3 · Einsatz übernommen');
    expect(await within(fahrzeugZeile('83-1')).findByText('Status ist gesperrt')).toHaveAttribute(
      'data-fehler',
    );
    expect(fahrzeugZeile('83-2').querySelector('[data-fehler]')).toBeNull();
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it('FMS-Wahl an einem zweiten Fahrzeug, während die erste noch läuft, geht hinaus', async () => {
    const aufrufe: string[] = [];
    server.use(
      http.patch('/api/einsaetze/1/fahrzeuge/:efId', async ({ params, request }) => {
        aufrufe.push(`${params.efId}:${JSON.stringify(await request.json())}`);
        if (params.efId === '30') await delay('infinite');
        return HttpResponse.json(FAHRZEUGE[0]);
      }),
    );
    zeige();
    await waehleStatus('83-1', 'S3 · Einsatz übernommen');
    await waitFor(() =>
      expect(
        within(fahrzeugZeile('83-1')).getByRole('button', { name: /^Status von 83-1 ändern/ }),
      ).toBeDisabled(),
    );
    await waehleStatus('83-2', 'S3 · Einsatz übernommen');
    await waitFor(() => expect(aufrufe).toEqual(['30:{"status_id":103}', '31:{"status_id":103}']));
  });

  it('„Aus Einheit lösen“ lädt bis zur Antwort, nur an seiner Zeile', async () => {
    server.use(
      http.delete('/api/einsaetze/1/einheiten/10/fahrzeug/30', async () => {
        await delay('infinite');
        return new HttpResponse(null, { status: 204 });
      }),
    );
    zeige();
    await userEvent.click(
      within(fahrzeugZeile('83-1')).getByRole('button', { name: 'Aus Einheit lösen' }),
    );
    // Ladend trägt der Knopf das Symbol „loading“ im Namen.
    await waitFor(() =>
      expect(
        within(fahrzeugZeile('83-1')).getByRole('button', { name: /Aus Einheit lösen$/ }),
      ).toHaveClass('ant-btn-loading'),
    );
    expect(
      within(fahrzeugZeile('83-2')).getByRole('button', { name: 'Aus Einheit lösen' }),
    ).not.toHaveClass('ant-btn-loading');
  });
});

describe('FahrzeugeBesatzung · Listen laden oder fehlen', () => {
  it('Ladezustand: benannt, ohne Zeilen und ohne Menüs', () => {
    zeige({ listState: 'laden' });
    expect(screen.getByLabelText('Fahrzeuge und Besatzung wird geladen')).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(paneel().querySelectorAll('[data-lfh="einheit-person"]')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /^Aktionen zu Person / })).toBeNull();
  });

  it('Fehlerzustand: Alarm mit „Erneut abrufen“, Mitglieder flach ohne Besatzungswege', async () => {
    const { onReload } = zeige({ listState: 'fehler' });
    const alarm = within(paneel()).getByRole('alert');
    await userEvent.click(within(alarm).getByRole('button', { name: 'Erneut abrufen' }));
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(namenIn(paneel())).toEqual([
      'Anna Führer',
      'Bernd Mann',
      'Clara Unter',
      'Dora Ohne',
      'Emil Fremdfahrer',
    ]);
    expect(screen.queryByRole('group', { name: 'Ohne Fahrzeug' })).toBeNull();
    expect(eintraege(await oeffneMenue('Dora Ohne'))).toEqual([
      'Als Einheitsführer',
      'Aus Einheit lösen',
    ]);
  });
});

describe('FahrzeugeBesatzung · ohne Schreibrecht (D14)', () => {
  it('Beobachter: keine Menüs, keine Lösen-Knöpfe, FMS als Wort, Links bleiben', () => {
    zeige({ darfSchreiben: false });
    expect(within(paneel()).queryAllByRole('button', { name: /^Aktionen zu Person/ })).toHaveLength(
      0,
    );
    expect(within(paneel()).queryByRole('button', { name: 'Aus Einheit lösen' })).toBeNull();
    expect(within(paneel()).queryByRole('button', { name: /^Status von/ })).toBeNull();
    expect(fahrzeugZeile('83-1')).toHaveTextContent('Frei auf Wache');
    expect(within(paneel()).getByRole('link', { name: 'Anna Führer' })).toBeInTheDocument();
  });
});
