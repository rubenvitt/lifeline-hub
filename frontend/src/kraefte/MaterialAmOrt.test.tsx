import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { freigabenFixture } from '../test/fixtures';
import type { EinsatzMaterial } from '../api/types';
import type { MaterialOrtRef } from './materialPosten';
import MaterialAmOrt, { type MaterialAmOrtProps } from './MaterialAmOrt';

/**
 * Der eine Baustein für Material an Einheit, Fahrzeug, UHS und Bereitstellungsraum (LLH-1225,
 * design.md D8): Zeilen mit Menge und Status, Kopfzahl, „Ausgeben“, Lösen je Ort, „Material
 * zuordnen …“ über den einen Schreibweg, Leerhinweis, Sperrgrund und Modulsperre.
 */

const em = (p: Partial<EinsatzMaterial>): EinsatzMaterial =>
  ({
    id: 0,
    bezeichnung: 'Posten',
    kategorie: null,
    art: 'geraet',
    menge: 1,
    ausgegeben: 0,
    status: 'einsatzbereit',
    einheit_id: null,
    einsatz_fahrzeug_id: null,
    uhs_id: null,
    br_id: null,
    beendet_at: null,
    ...p,
  }) as EinsatzMaterial;

const UHS: MaterialOrtRef = { art: 'uhs', id: 7 };

const POSTEN = [
  em({
    id: 1,
    bezeichnung: 'Wolldecke',
    kategorie: 'Betreuung',
    art: 'verbrauchsgut',
    menge: 50,
    ausgegeben: 20,
    uhs_id: 7,
  }),
  em({ id: 2, bezeichnung: 'Trage', status: 'defekt', uhs_id: 7 }),
  em({ id: 3, bezeichnung: 'Zeltbahn', art: 'verbrauchsgut', menge: 4, ausgegeben: 4, uhs_id: 7 }),
];

const ANGEBOT = [
  ...POSTEN,
  em({ id: 10, bezeichnung: 'Stromerzeuger' }),
  em({ id: 11, bezeichnung: 'Feldbett', einheit_id: 2 }),
];

function grundHandler() {
  server.use(
    http.get('/api/einsaetze/1/modul-freigaben', () => HttpResponse.json(freigabenFixture())),
    http.get('/api/einsaetze/1/einheiten', () =>
      HttpResponse.json([{ id: 2, name: 'Staffel A', ueber_einheit_id: null }]),
    ),
    http.get('/api/einsaetze/1/abschnitte', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([])),
  );
}

function zeige(props: Partial<MaterialAmOrtProps> = {}) {
  grundHandler();
  return renderMitProviders(
    <MaterialAmOrt
      einsatzId={1}
      ort={UHS}
      posten={POSTEN}
      angebot={{ data: ANGEBOT, isError: false }}
      darfSchreiben
      materialFrei
      loesenText="Lösen"
      {...props}
    />,
  );
}

const zeile = (text: string) =>
  screen.getByText(text).closest('[data-lfh="material-am-ort-zeile"]') as HTMLElement;

function patchMitschnitt(antwort?: () => Response) {
  const gesendet: { url: string; body: unknown }[] = [];
  server.use(
    http.patch('/api/einsaetze/1/material/:emId', async ({ request }) => {
      gesendet.push({ url: new URL(request.url).pathname, body: await request.json() });
      return antwort ? antwort() : HttpResponse.json({});
    }),
  );
  return gesendet;
}

describe('MaterialAmOrt (LLH-1225 D8)', () => {
  it('Zeilen mit Kategorie, Menge und Status; Kopfzahl mit Ausfall', () => {
    zeige();
    expect(screen.getByTestId('material-am-ort-kopf')).toHaveTextContent('3 Posten · 2 Ausfall');
    expect(zeile('Wolldecke')).toHaveTextContent('Betreuung');
    expect(zeile('Wolldecke')).toHaveTextContent('30 von 50 übrig');
    expect(zeile('Wolldecke')).toHaveTextContent('einsatzbereit');
    expect(zeile('Trage')).toHaveTextContent('defekt');
    expect(zeile('Zeltbahn')).toHaveTextContent('aufgebraucht');
    // Jeder Posten ist eine eigene Zeile für „Status setzen“ in der Palette (LLH-1133): in der
    // Fahrzeugkarte träfe die Statuswahl sonst den letzten Posten statt des Fahrzeugs.
    expect(zeile('Trage')).toHaveAttribute('data-row-key', expect.stringMatching(/^material-\d+$/));
  });

  it('„Ausgeben“ nur am Verbrauchsgut mit Rest; der Dialog schickt die neue Ausgabe', async () => {
    const gesendet = patchMitschnitt();
    zeige();
    expect(within(zeile('Trage')).queryByRole('button', { name: /ausgeben/ })).toBeNull();
    expect(within(zeile('Zeltbahn')).queryByRole('button', { name: /ausgeben/ })).toBeNull();
    await userEvent.click(
      within(zeile('Wolldecke')).getByRole('button', { name: 'Wolldecke ausgeben' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Wolldecke ausgeben');
    await userEvent.type(within(dialog).getByRole('spinbutton', { name: 'Menge ausgeben' }), '5');
    expect(within(dialog).getByTestId('ausgabe-danach')).toHaveTextContent(
      'Danach 25 von 50 übrig',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ausgeben' }));
    await waitFor(() =>
      expect(gesendet).toEqual([{ url: '/api/einsaetze/1/material/1', body: { ausgegeben: 25 } }]),
    );
    expect(await screen.findByText('Wolldecke: 5 ausgegeben')).toBeInTheDocument();
  });

  it('lehnt der Server „Ausgeben“ ab, bleibt der Dialog offen und nennt den Grund', async () => {
    const gesendet = patchMitschnitt(() =>
      HttpResponse.json({ error: 'Ausgabe übersteigt die Menge' }, { status: 422 }),
    );
    zeige();
    await userEvent.click(
      within(zeile('Wolldecke')).getByRole('button', { name: 'Wolldecke ausgeben' }),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('spinbutton', { name: 'Menge ausgeben' }), '5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ausgeben' }));
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(await within(dialog).findByText('Ausgabe übersteigt die Menge')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(screen.queryByText('Wolldecke: 5 ausgegeben')).toBeNull();
  });

  it('Lösen schickt das Ort-Feld leer, ohne Rückfrage; die Ablehnung steht an der Zeile', async () => {
    const gesendet = patchMitschnitt(() =>
      HttpResponse.json({ error: 'Material ist verliehen' }, { status: 409 }),
    );
    zeige();
    await userEvent.click(within(zeile('Trage')).getByRole('button', { name: 'Trage lösen' }));
    await waitFor(() =>
      expect(gesendet).toEqual([{ url: '/api/einsaetze/1/material/2', body: { uhs_id: null } }]),
    );
    expect(await within(zeile('Trage')).findByText('Material ist verliehen')).toHaveAttribute(
      'data-fehler',
    );
  });

  /** Öffnet das Statusmenü einer Zeile; antd lässt geschlossene Portale stehen (Muster `MaterialPage.test`). */
  async function statusMenue(bezeichnung: string): Promise<HTMLElement> {
    await userEvent.click(
      within(zeile(bezeichnung)).getByRole('button', { name: `Status von ${bezeichnung} ändern` }),
    );
    const offen = [...document.querySelectorAll<HTMLElement>('.ant-dropdown')].filter(
      (d) => !d.classList.contains('ant-dropdown-hidden') && d.style.pointerEvents !== 'none',
    );
    expect(offen).toHaveLength(1);
    return offen[0].querySelector<HTMLElement>('[role="menu"]')!;
  }

  it('Status am Ort (LLH-1133): die Anzeige ist der Auslöser, die Wahl schickt den Status', async () => {
    const gesendet = patchMitschnitt();
    zeige();
    const menue = await statusMenue('Trage');
    // Je Art nur die erlaubten Status (LLH-1224 D3), wie in der Materialliste.
    expect(within(menue).getByRole('menuitem', { name: /Desinfektion nötig/ })).toBeInTheDocument();
    await userEvent.click(within(menue).getByRole('menuitem', { name: /einsatzbereit/ }));
    await waitFor(() =>
      expect(gesendet).toEqual([
        { url: '/api/einsaetze/1/material/2', body: { status: 'einsatzbereit' } },
      ]),
    );
  });

  it('ein Verbrauchsgut bietet „verbraucht“ und „Desinfektion nötig“ nicht an', async () => {
    zeige();
    const menue = await statusMenue('Wolldecke');
    expect(within(menue).queryByRole('menuitem', { name: /Desinfektion nötig/ })).toBeNull();
    expect(within(menue).queryByRole('menuitem', { name: /^verbraucht$/ })).toBeNull();
  });

  it('eine Ablehnung des Statuswechsels steht an der Zeile', async () => {
    patchMitschnitt(() => HttpResponse.json({ error: 'Material ist beendet' }, { status: 409 }));
    zeige();
    const menue = await statusMenue('Trage');
    await userEvent.click(within(menue).getByRole('menuitem', { name: /einsatzbereit/ }));
    expect(await within(zeile('Trage')).findByText('Material ist beendet')).toHaveAttribute(
      'data-fehler',
    );
    expect(zeile('Trage')).toHaveTextContent('defekt');
  });

  it('am beendeten Ort bleibt der Status bedienbar wie das Lösen', () => {
    zeige({ sperrgrund: 'UHS aufgelöst' });
    expect(
      within(zeile('Trage')).getByRole('button', { name: 'Status von Trage ändern' }),
    ).toBeEnabled();
  });

  it('der Lösen-Wortlaut folgt dem Ort', () => {
    zeige({
      ort: { art: 'fahrzeug', id: 4 },
      posten: [em({ id: 5, bezeichnung: 'Stromerzeuger', einsatz_fahrzeug_id: 4 })],
      loesenText: 'Vom Fahrzeug lösen',
    });
    const knopf = within(zeile('Stromerzeuger')).getByRole('button', {
      name: 'Stromerzeuger vom Fahrzeug lösen',
    });
    expect(knopf).toHaveTextContent('Vom Fahrzeug lösen');
    expect(knopf).toHaveClass('ant-btn-dangerous');
  });

  it('„Material zuordnen …“ bietet ohne Ort und an anderem Ort an und setzt den Ort hierher', async () => {
    const gesendet = patchMitschnitt();
    zeige();
    await userEvent.click(screen.getByRole('combobox', { name: 'Material zuordnen' }));
    expect(await screen.findByText('Stromerzeuger · 1')).toBeInTheDocument();
    expect(await screen.findByText('Feldbett · 1 · Staffel A')).toBeInTheDocument();
    // Die Posten dieses Orts stehen nicht im Angebot.
    expect(screen.queryByText(/^Trage ·/)).toBeNull();
    await userEvent.click(screen.getByText('Feldbett · 1 · Staffel A'));
    await waitFor(() =>
      expect(gesendet).toEqual([{ url: '/api/einsaetze/1/material/11', body: { uhs_id: 7 } }]),
    );
  });

  it('eine Ablehnung des Zuordnens steht unter der Auswahl', async () => {
    patchMitschnitt(() => HttpResponse.json({ error: 'UHS ist aufgelöst' }, { status: 422 }));
    zeige();
    await userEvent.click(screen.getByRole('combobox', { name: 'Material zuordnen' }));
    await userEvent.click(await screen.findByText('Stromerzeuger · 1'));
    expect(await screen.findByText('UHS ist aufgelöst')).toBeInTheDocument();
    expect(screen.getByText('Nicht zugeordnet')).toBeInTheDocument();
  });

  it('nichts anzubieten: Auswahl gesperrt, daneben der Sprung ins Modul Material', async () => {
    zeige({ angebot: { data: POSTEN, isError: false } });
    const feld = screen.getByRole('combobox', { name: 'Material zuordnen' });
    await waitFor(() => expect(feld).toBeDisabled());
    expect(feld).toHaveAccessibleDescription(/Kein Material ohne Ort/);
    // Erfasst wird am Ort (LLH-1133): der Sprung führt nur noch ins Modul, nicht zum Erfassen.
    expect(screen.getByRole('link', { name: /Material/ })).toHaveAttribute(
      'href',
      '/einsaetze/1/material',
    );
    expect(screen.queryByText(/im Modul Material erfassen/)).toBeNull();
  });

  it('„Material erfassen“ legt Ad-hoc-Material in EINEM Request an diesem Ort an (LLH-1133)', async () => {
    const posts: unknown[] = [];
    const patches = patchMitschnitt();
    server.use(
      http.post('/api/einsaetze/1/material', async ({ request }) => {
        posts.push(await request.json());
        return HttpResponse.json(em({ id: 99, bezeichnung: 'Sauerstoff 2 l', uhs_id: 7 }));
      }),
    );
    zeige();
    await userEvent.click(screen.getByRole('button', { name: 'Material erfassen' }));
    const dialog = await screen.findByRole('dialog');
    // Der Ort steht fest: kein Feld „Ort“.
    expect(within(dialog).queryByLabelText('Ort')).toBeNull();
    await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Sauerstoff 2 l');
    const menge = within(dialog).getByRole('spinbutton', { name: 'Menge' });
    await userEvent.clear(menge);
    await userEvent.type(menge, '4');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disponieren' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({
      adhoc: { bezeichnung: 'Sauerstoff 2 l' },
      menge: 4,
      art: 'verbrauchsgut',
      uhs_id: 7,
    });
    // Kein zweiter Schritt: kein Ortswechsel hinterher.
    expect(patches).toEqual([]);
    expect(await screen.findByText('Ad-hoc-Material disponiert')).toBeInTheDocument();
  });

  it('am Fahrzeug geht der Posten mit dem Fahrzeug als Ort', async () => {
    const posts: unknown[] = [];
    server.use(
      http.post('/api/einsaetze/1/material', async ({ request }) => {
        posts.push(await request.json());
        return HttpResponse.json(em({ id: 99 }));
      }),
    );
    zeige({ ort: { art: 'fahrzeug', id: 4 }, posten: [], loesenText: 'Vom Fahrzeug lösen' });
    await userEvent.click(screen.getByRole('button', { name: 'Material erfassen' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Stromerzeuger');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disponieren' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ menge: 1, art: 'geraet', einsatz_fahrzeug_id: 4 });
    expect(posts[0]).not.toHaveProperty('uhs_id');
  });

  it('am beendeten Ort ist „Material erfassen“ gesperrt und nennt den Grund', () => {
    zeige({ sperrgrund: 'UHS aufgelöst' });
    const knopf = screen.getByRole('button', { name: 'Material erfassen' });
    expect(knopf).toBeDisabled();
    expect(knopf).toHaveAccessibleDescription('UHS aufgelöst');
  });

  it('ohne Freigabe Material ist „Material erfassen“ gesperrt mit „Modul Material gesperrt“', () => {
    zeige({ materialFrei: false, angebot: undefined });
    const knopf = screen.getByRole('button', { name: 'Material erfassen' });
    expect(knopf).toBeDisabled();
    expect(knopf).toHaveAccessibleDescription('Modul Material gesperrt');
  });

  it('beendeter Ort: Zuordnen gesperrt mit Grund, Lösen geht, kein Ausgeben', () => {
    zeige({ sperrgrund: 'UHS aufgelöst' });
    const feld = screen.getByRole('combobox', { name: 'Material zuordnen' });
    expect(feld).toBeDisabled();
    expect(feld).toHaveAccessibleDescription('UHS aufgelöst');
    expect(within(zeile('Trage')).getByRole('button', { name: 'Trage lösen' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Wolldecke ausgeben' })).toBeNull();
  });

  it('ohne Freigabe Material: Posten stehen, Auswahl gesperrt, kein Lösen und kein Ausgeben', () => {
    zeige({ materialFrei: false, angebot: undefined });
    const feld = screen.getByRole('combobox', { name: 'Material zuordnen' });
    expect(feld).toBeDisabled();
    expect(feld).toHaveAccessibleDescription('Modul Material gesperrt');
    expect(zeile('Trage')).toHaveTextContent('defekt');
    expect(screen.queryByRole('button', { name: /lösen|ausgeben|ändern$/ })).toBeNull();
    // Die Statusanzeige ist keine Bedienung (Spec `material-am-ort`, „Status am Ort setzen“).
    expect(screen.queryByRole('button', { name: /^Status von/ })).toBeNull();
  });

  it('nur lesend (Gerät, kein Schreibrecht): keine Bedienelemente', () => {
    zeige({ darfSchreiben: false, angebot: undefined });
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(zeile('Wolldecke')).toHaveTextContent('30 von 50 übrig');
  });

  it('ohne Posten steht der Leertext', () => {
    zeige({ posten: [], leerText: 'Keine Beladung' });
    expect(screen.getByText('Keine Beladung')).toBeInTheDocument();
    expect(screen.getByTestId('material-am-ort-kopf')).toHaveTextContent('0 Posten');
  });
});

/**
 * Kein Sprung unter dem Zeiger nach dem Lösen (LLH-1254, Change
 * `k2gckqtq-material-loesen-ohne-sprung`): Die gelöste Zeile bleibt als „Gelöst“ an ihrer Stelle,
 * bis Zeiger und Fokus den Baustein verlassen haben und `HOLD_MS` vergangen ist.
 */
describe('MaterialAmOrt: gelöste Zeile hält ihre Stelle (LLH-1254)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const reihenfolge = () =>
    [...document.querySelectorAll('[data-lfh="material-am-ort-zeile"]')].map(
      (z) => z.querySelector('span > span')?.textContent,
    );
  const ohne = (...ids: number[]) => POSTEN.filter((p) => !ids.includes(p.id));
  const marke = (bezeichnung: string) =>
    screen.getByRole('button', { name: `${bezeichnung} gelöst` });

  /** Rendert, löst einen Posten und lässt ihn aus der Quelle fallen wie nach dem Abgleich. */
  async function loeseUndGleicheAb(
    user: ReturnType<typeof userEvent.setup>,
    bezeichnung: string,
    id: number,
    props: Partial<MaterialAmOrtProps> = {},
  ) {
    const gesendet = patchMitschnitt();
    const r = zeige(props);
    await user.click(
      within(zeile(bezeichnung)).getByRole('button', { name: `${bezeichnung} lösen` }),
    );
    await screen.findByRole('button', { name: `${bezeichnung} gelöst` });
    const neu = (p: Partial<MaterialAmOrtProps>) =>
      r.rerender(
        <MaterialAmOrt
          einsatzId={1}
          ort={UHS}
          posten={ohne(id)}
          angebot={{ data: ANGEBOT, isError: false }}
          darfSchreiben
          materialFrei
          loesenText="Lösen"
          {...props}
          {...p}
        />,
      );
    neu({});
    return { gesendet, neu };
  }

  it('die gelöste Zeile steht als träge Marke „Gelöst“ an ihrer Stelle; ein zweiter Klick schickt nichts', async () => {
    const user = userEvent.setup();
    const { gesendet } = await loeseUndGleicheAb(user, 'Trage', 2);
    expect(reihenfolge()).toEqual(['Wolldecke', 'Trage', 'Zeltbahn']);
    const knopf = marke('Trage');
    expect(knopf).toHaveTextContent('Gelöst');
    expect(knopf).toHaveAttribute('aria-disabled', 'true');
    // Der Fokus bleibt auf derselben Stelle: kein Sprung für die Tastatur.
    expect(knopf).toHaveFocus();
    await user.click(knopf);
    await user.click(knopf);
    expect(gesendet).toHaveLength(1);
    // Status und Ausgeben entfallen; die Kopfzahl zählt nur echte Posten.
    expect(within(zeile('Trage')).queryByRole('button', { name: /Status von/ })).toBeNull();
    expect(screen.getByTestId('material-am-ort-kopf')).toHaveTextContent('2 Posten · 1 Ausfall');
  });

  it('solange die Quelle den Posten noch zeigt, steht schon die Marke statt des Knopfs', async () => {
    const user = userEvent.setup();
    const gesendet = patchMitschnitt();
    zeige();
    await user.click(within(zeile('Trage')).getByRole('button', { name: 'Trage lösen' }));
    expect(await screen.findByRole('button', { name: 'Trage gelöst' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Trage lösen' })).toBeNull();
    await user.click(marke('Trage'));
    expect(gesendet).toHaveLength(1);
  });

  it('kehrt der Posten zurück, gewinnt die echte Zeile', async () => {
    const user = userEvent.setup();
    const { neu } = await loeseUndGleicheAb(user, 'Trage', 2);
    neu({ posten: POSTEN });
    expect(within(zeile('Trage')).getByRole('button', { name: 'Trage lösen' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Trage gelöst' })).toBeNull();
    expect(reihenfolge()).toEqual(['Wolldecke', 'Trage', 'Zeltbahn']);
  });

  it('mehrere Platzhalter behalten ihre Plätze, auch in umgekehrter Folge gelöst', async () => {
    const user = userEvent.setup();
    const { neu } = await loeseUndGleicheAb(user, 'Trage', 2);
    await user.click(within(zeile('Wolldecke')).getByRole('button', { name: 'Wolldecke lösen' }));
    await screen.findByRole('button', { name: 'Wolldecke gelöst' });
    neu({ posten: ohne(1, 2) });
    expect(reihenfolge()).toEqual(['Wolldecke', 'Trage', 'Zeltbahn']);
  });

  it('fällt erst, wenn Zeiger und Fokus draußen sind und die Haltezeit um ist; dann alle zusammen', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await loeseUndGleicheAb(user, 'Trage', 2);
    // Zeiger und Fokus im Baustein: die Zeit allein löst nichts.
    act(() => vi.advanceTimersByTime(10_000));
    expect(marke('Trage')).toBeInTheDocument();
    // Zeiger raus, Fokus noch drin.
    await user.pointer({ target: document.body });
    act(() => vi.advanceTimersByTime(10_000));
    expect(marke('Trage')).toBeInTheDocument();
    // Fokus raus: die Haltezeit ist längst um, die Zeile fällt.
    act(() => marke('Trage').blur());
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Trage gelöst' })).toBeNull());
    expect(reihenfolge()).toEqual(['Wolldecke', 'Zeltbahn']);
  });

  it('der Zeiger allein hält, auch ohne Fokus', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await loeseUndGleicheAb(user, 'Trage', 2);
    act(() => marke('Trage').blur());
    act(() => vi.advanceTimersByTime(10_000));
    expect(marke('Trage')).toBeInTheDocument();
    await user.pointer({ target: document.body });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Trage gelöst' })).toBeNull());
  });

  it('nach dem Verlassen wartet die Zeile die Haltezeit seit dem letzten Tipp ab', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await loeseUndGleicheAb(user, 'Trage', 2);
    await user.pointer({ target: document.body });
    act(() => marke('Trage').blur());
    act(() => vi.advanceTimersByTime(1_000));
    expect(marke('Trage')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(4_000));
    expect(screen.queryByRole('button', { name: 'Trage gelöst' })).toBeNull();
  });

  it('ein Touch-Zeiger hält nicht, nur die Zeit seit dem Tipp', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    patchMitschnitt();
    const r = zeige();
    const knopf = within(zeile('Trage')).getByRole('button', { name: 'Trage lösen' });
    // Ein Tipp: betritt und verlässt den Baustein, der Fokus bleibt nicht.
    await user.pointer([
      { keys: '[TouchA>]', target: knopf, coords: { x: 1, y: 1 } },
      { pointerName: 'TouchA', target: knopf, coords: { x: 3, y: 3 } },
      { keys: '[/TouchA]', target: knopf },
    ]);
    await screen.findByRole('button', { name: 'Trage gelöst' });
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    r.rerender(
      <MaterialAmOrt
        einsatzId={1}
        ort={UHS}
        posten={ohne(2)}
        angebot={{ data: ANGEBOT, isError: false }}
        darfSchreiben
        materialFrei
        loesenText="Lösen"
      />,
    );
    act(() => vi.advanceTimersByTime(3_000));
    expect(marke('Trage')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.queryByRole('button', { name: 'Trage gelöst' })).toBeNull();
  });

  it('ein anderer Ort leert die Platzhalter', async () => {
    const user = userEvent.setup();
    const { neu } = await loeseUndGleicheAb(user, 'Trage', 2);
    neu({ ort: { art: 'uhs', id: 8 }, posten: [] });
    expect(screen.queryByRole('button', { name: 'Trage gelöst' })).toBeNull();
  });

  it('„Rückgängig“ im Hinweis ordnet den Posten wieder diesem Ort zu', async () => {
    const user = userEvent.setup();
    const { gesendet, neu } = await loeseUndGleicheAb(user, 'Trage', 2);
    const hinweis = (await screen.findByText('Trage gelöst')).closest('.ant-message-notice')!;
    await user.click(within(hinweis as HTMLElement).getByRole('button', { name: 'Rückgängig' }));
    await waitFor(() =>
      expect(gesendet).toEqual([
        { url: '/api/einsaetze/1/material/2', body: { uhs_id: null } },
        { url: '/api/einsaetze/1/material/2', body: { uhs_id: 7 } },
      ]),
    );
    neu({ posten: POSTEN });
    expect(within(zeile('Trage')).getByRole('button', { name: 'Trage lösen' })).toBeEnabled();
  });

  it('„Rückgängig“, bevor die Quelle abgeglichen hat: die echte Zeile kehrt sofort zurück', async () => {
    const user = userEvent.setup();
    patchMitschnitt();
    zeige();
    await user.click(within(zeile('Trage')).getByRole('button', { name: 'Trage lösen' }));
    const hinweis = (await screen.findByText('Trage gelöst')).closest('.ant-message-notice')!;
    await user.click(within(hinweis as HTMLElement).getByRole('button', { name: 'Rückgängig' }));
    // Der Zeiger kehrt in den Baustein zurück: nur die Rücknahme, nicht die Zeit, darf die Marke lösen.
    await user.hover(zeile('Wolldecke'));
    expect(
      await within(zeile('Trage')).findByRole('button', { name: 'Trage lösen' }),
    ).toBeEnabled();
  });

  it('eine Ablehnung des Rückgängig steht über dem Block und bleibt, wenn die Zeile fällt', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let n = 0;
    patchMitschnitt(() =>
      ++n === 1
        ? HttpResponse.json({})
        : HttpResponse.json({ error: 'Material ist verliehen' }, { status: 409 }),
    );
    zeige();
    await user.click(within(zeile('Trage')).getByRole('button', { name: 'Trage lösen' }));
    const hinweis = (await screen.findByText('Trage gelöst')).closest('.ant-message-notice')!;
    await user.click(within(hinweis as HTMLElement).getByRole('button', { name: 'Rückgängig' }));
    expect(await screen.findByText('Material ist verliehen')).toBeInTheDocument();
    expect(screen.getByText('Trage nicht zurückgenommen')).toBeInTheDocument();
    expect(document.querySelector('.ant-message-error')).toBeNull();
    // Zeiger und Fokus sind im Hinweis, die Haltezeit läuft ab: die Zeile fällt, der Grund bleibt.
    act(() => vi.advanceTimersByTime(10_000));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Trage gelöst' })).toBeNull());
    expect(screen.getByText('Material ist verliehen')).toBeInTheDocument();
  });

  it('am beendeten Ort gibt es kein Rückgängig, weil der Server das Zuordnen ablehnt', async () => {
    const user = userEvent.setup();
    patchMitschnitt();
    zeige({ sperrgrund: 'UHS aufgelöst' });
    await user.click(within(zeile('Trage')).getByRole('button', { name: 'Trage lösen' }));
    const hinweis = (await screen.findByText('Trage gelöst')).closest('.ant-message-notice')!;
    expect(within(hinweis as HTMLElement).queryByRole('button', { name: 'Rückgängig' })).toBeNull();
    expect(marke('Trage')).toBeInTheDocument();
  });

  it('der letzte Posten gelöst: kein Leertext über dem Platzhalter', async () => {
    const user = userEvent.setup();
    const { neu } = await loeseUndGleicheAb(user, 'Trage', 2);
    neu({ posten: [] });
    expect(screen.queryByText('Kein Material')).toBeNull();
    expect(reihenfolge()).toEqual(['Trage']);
  });

  it('am Platzhalter stehen Status und „Ausgeben“ unsichtbar weiter: die Höhe bleibt', async () => {
    const user = userEvent.setup();
    await loeseUndGleicheAb(user, 'Wolldecke', 1);
    const z = zeile('Wolldecke');
    const ausgeben = z.querySelector<HTMLElement>('[aria-label="Wolldecke ausgeben"]');
    expect(ausgeben).not.toBeNull();
    expect(within(z).queryByRole('button', { name: 'Wolldecke ausgeben' })).toBeNull();
    expect(z.querySelector('[aria-label="Status von Wolldecke ändern"]')).not.toBeNull();
    expect(within(z).queryByRole('button', { name: /Status von/ })).toBeNull();
  });
});
