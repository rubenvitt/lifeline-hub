import { http, HttpResponse } from 'msw';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import { meHandler, server } from '../test/server';
import { renderMitProviders, setzeOnline } from '../test/utils';
import type { EinsatzAnzeige, Person } from '../api/types';
import PersonenPage from './PersonenPage';
import { queueLeerenFuerTests, schreibaktionenLaden } from '../offline/queue';
import { offlineQuittungsKanalZuruecksetzenFuerTests } from '../offline/ereignisse';
import { benutzerFixture, einsatzFixture, freigabenFixture } from '../test/fixtures';
import { setzeViewportBreite } from '../test/viewport';
import { lagekartePfad } from '../routing/deeplinks';
import { einsatzKeys } from '../api/queryKeys';
import { FakeEventSource } from '../test/eventSource';

/**
 * Zeilenaktionen der Betroffenenliste (LLH-1130, Spec `betroffene-lagedaten`, „Sichtung und
 * Verbleib aus der Betroffenenliste“; Change `n08alz2v-betroffenenliste-zeilenaktionen`): die
 * Sichtungszelle als Auslöser, „Verbleib erfassen“ in der Lücke, das Zeilenmenü, die Schleuse und
 * die Lesefassung ohne Schreibrecht.
 */

class StummerKanal {
  postMessage() {}
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

beforeEach(async () => {
  offlineQuittungsKanalZuruecksetzenFuerTests();
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('BroadcastChannel', StummerKanal);
  setzeOnline(true);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  server.use(http.get('/api/einsaetze/:einsatzId/uhs', () => HttpResponse.json([])));
  await queueLeerenFuerTests();
});
afterEach(() => {
  offlineQuittungsKanalZuruecksetzenFuerTests();
  vi.unstubAllGlobals();
});

const r007: Person = {
  id: 70,
  einsatz_id: 1,
  registrier_nr: 7,
  status: 'betroffen',
  name: 'Mustermann',
  vorname: 'Max',
  geschlecht: 'maennlich',
  geburtsdatum: null,
  alter_geschaetzt: 40,
  herkunft_adresse: null,
  antreff_ort: 'Brücke',
  melder_kontakt: null,
  notiz: null,
  erfasst_at: '2026-05-27 09:00:00',
  erfasst_von: 1,
  geaendert_at: '2026-05-27 09:00:00',
  geaendert_von: 1,
  storniert_at: null,
  aktuelle_sichtung: 'sk2',
  aktuelle_sichtung_at: '2026-05-27 09:10:00',
};

const abgelehnt = (text: string, status = 422) => HttpResponse.json({ error: text }, { status });
const sichtungAntwort = (kategorie: string) => ({
  id: 1,
  person_id: 70,
  kategorie,
  notiz: null,
  erfasst_at: '2026-05-27 10:00:00',
  erfasst_von: 1,
});

/** Zeigt den Pfad, damit ein Sprung auf die Detailseite sichtbar wird. */
function Ort() {
  const ort = useLocation();
  return <div data-testid="ort">{ort.pathname + ort.search}</div>;
}

function render(personen: () => Person[], einsatz: Partial<EinsatzAnzeige> = {}) {
  server.use(
    meHandler(benutzerFixture()),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzFixture(einsatz))),
    http.get('/api/einsaetze/1/personen', () => HttpResponse.json(personen())),
  );
  return renderMitProviders(
    <>
      <Ort />
      <Routes>
        <Route path="/einsaetze/:id/personen" element={<PersonenPage />} />
        <Route path="/einsaetze/:id/personen/:personId" element={<div>Detailseite</div>} />
        <Route path="/einsaetze/:id/lagekarte" element={<div>Lagekarte</div>} />
      </Routes>
    </>,
    { route: '/einsaetze/1/personen' },
  );
}

const zeile = (nr: string) => screen.getByText(nr).closest('tr') as HTMLElement;

describe('Sichtung aus der Zeile (LLH-1130, 2.1)', () => {
  it('Nachsichtung: Zelle, Fläche, „Übernehmen“ — drei Tipps, keine Detailseite', async () => {
    const gesendet: unknown[] = [];
    let stand: Person[] = [r007];
    server.use(
      http.post('/api/einsaetze/1/personen/70/sichtung', async ({ request }) => {
        gesendet.push(await request.json());
        stand = [{ ...r007, aktuelle_sichtung: 'sk1' }];
        return HttpResponse.json(sichtungAntwort('sk1'), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    render(() => stand);

    // Tipp 1: die Sichtungszelle; ihr Name nennt die Kennung.
    await user.click(await screen.findByRole('button', { name: /^Sichtung R-007 ändern/ }));
    const flaeche = await screen.findByRole('region', { name: 'Sichtung R-007' });
    // Tipp 2: die Fläche.
    await user.click(within(flaeche).getByRole('radio', { name: /^SK I,/ }));
    // Tipp 3: „Übernehmen“.
    await user.click(within(flaeche).getByRole('button', { name: 'Übernehmen' }));

    await waitFor(() =>
      expect(gesendet).toEqual([{ kategorie: 'sk1', notiz: null, client_id: expect.any(String) }]),
    );
    expect(
      await screen.findByRole('button', { name: 'Sichtung R-007 ändern, aktuell SK I' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Detailseite')).toBeNull();
    expect(screen.getByTestId('ort')).toHaveTextContent('/einsaetze/1/personen');
  });

  it('eine abgelehnte Nachsichtung steht an ihrer Zeile', async () => {
    server.use(
      http.post('/api/einsaetze/1/personen/70/sichtung', () => abgelehnt('Person ist storniert')),
    );
    const user = userEvent.setup();
    render(() => [r007]);

    await user.click(await screen.findByRole('button', { name: /^Sichtung R-007 ändern/ }));
    const flaeche = await screen.findByRole('region', { name: 'Sichtung R-007' });
    await user.click(within(flaeche).getByRole('radio', { name: /^SK III,/ }));
    await user.click(within(flaeche).getByRole('button', { name: 'Übernehmen' }));

    expect(await within(zeile('R-007')).findByText('Person ist storniert')).toHaveAttribute(
      'data-fehler',
    );
    // Kein Toast: der Grund steht nur an der Zeile.
    expect(document.querySelector('.ant-message')).toBeNull();
  });

  it('ohne gewählte Fläche schickt „Übernehmen“ nichts', async () => {
    const gesendet: unknown[] = [];
    server.use(
      http.post('/api/einsaetze/1/personen/70/sichtung', async ({ request }) => {
        gesendet.push(await request.json());
        return HttpResponse.json(sichtungAntwort('sk1'), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    render(() => [r007]);

    await user.click(await screen.findByRole('button', { name: /^Sichtung R-007 ändern/ }));
    const flaeche = await screen.findByRole('region', { name: 'Sichtung R-007' });
    await user.click(within(flaeche).getByRole('button', { name: 'Übernehmen' }));
    expect(
      await within(flaeche).findByText('Bitte eine Sichtungskategorie wählen'),
    ).toBeInTheDocument();
    await act(async () => {});
    expect(gesendet).toEqual([]);
  });

  it('eine vermisste Person hat keinen Sichtungsauslöser', async () => {
    render(() => [{ ...r007, status: 'vermisst', aktuelle_sichtung: null }]);
    await screen.findByText('R-007');
    expect(screen.queryByRole('button', { name: /Sichtung R-007/ })).toBeNull();
  });
});

type Nutzer = ReturnType<typeof userEvent.setup>;

/** Verbleib im Dialog „Verbleib erfassen“: Transport ins genannte Ziel. */
async function erfasseTransport(user: Nutzer, ziel: string) {
  const dialog = await screen.findByRole('dialog', { name: 'Verbleib erfassen' });
  await user.click(within(dialog).getByRole('combobox', { name: 'Art' }));
  await user.click(await screen.findByTitle('Transport'));
  await user.type(within(dialog).getByLabelText('Ziel'), ziel);
  await user.click(within(dialog).getByRole('button', { name: 'Erfassen' }));
}

const verbleibAntwort = {
  id: 1,
  einsatz_id: 1,
  person_id: 70,
  art: 'transport',
  ziel: 'KH Mitte',
  zeitpunkt_at: '2026-05-27 10:00:00',
  erfasst_von: 1,
};

describe('Verbleib aus der Zeile (LLH-1130, 2.2)', () => {
  const r008: Person = { ...r007, id: 80, registrier_nr: 8, name: 'Zweite' };
  const mitVerbleib = (p: Person): Person => ({
    ...p,
    aktuelle_verbleib_art: 'transport',
    aktueller_verbleib: 'KH Mitte',
  });

  it('die leere Verbleib-Zelle bietet „Verbleib erfassen“; danach trägt die Zeile den Verbleib', async () => {
    const gesendet: unknown[] = [];
    let stand: Person[] = [r007];
    server.use(
      http.post('/api/einsaetze/1/personen/70/verbleib', async ({ request }) => {
        gesendet.push(await request.json());
        stand = [mitVerbleib(r007)];
        return HttpResponse.json(verbleibAntwort, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    render(() => stand);

    await user.click(await screen.findByRole('button', { name: 'Verbleib erfassen für R-007' }));
    await erfasseTransport(user, 'KH Mitte');

    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).toMatchObject({ art: 'transport', ziel: 'KH Mitte' });
    expect(await within(zeile('R-007')).findByText('KH Mitte')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Verbleib erfassen für R-007' })).toBeNull();
    expect(screen.queryByText('Detailseite')).toBeNull();
  });

  it('„Nur Lücken zeigen“: die Lücke schließt in der Zelle, die Zeile bleibt, die Zahl sinkt', async () => {
    let stand: Person[] = [r007, r008];
    server.use(
      http.post('/api/einsaetze/1/personen/70/verbleib', () => {
        stand = [mitVerbleib(r007), r008];
        return HttpResponse.json(verbleibAntwort, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    render(() => stand);

    await user.click(await screen.findByRole('button', { name: 'Nur Lücken zeigen' }));
    const offen = () => document.querySelector('[data-lfh="offene-felder"]')?.textContent;
    expect(offen()).toBe('2 ohne Verbleib, 0 ohne Fundort — 2 Datensätze');

    await user.click(screen.getByRole('button', { name: 'Verbleib erfassen für R-007' }));
    await erfasseTransport(user, 'KH Mitte');

    await waitFor(() => expect(offen()).toBe('1 ohne Verbleib, 0 ohne Fundort — 1 Datensatz'));
    expect(within(zeile('R-007')).getByText('KH Mitte')).toBeInTheDocument();
    expect(
      within(zeile('R-008')).getByRole('button', { name: 'Verbleib erfassen für R-008' }),
    ).toBeInTheDocument();
  });

  it('eine vermisste Person bekommt keinen Verbleib-Knopf', async () => {
    render(() => [{ ...r007, status: 'vermisst', aktuelle_sichtung: null }]);
    await screen.findByText('R-007');
    expect(screen.queryByRole('button', { name: /Verbleib erfassen/ })).toBeNull();
  });
});

/** Das offene Zeilenmenü (Muster aus `frontend/AGENTS.md`, „Datensatz-Aktionen“). */
async function offenesMenue() {
  await waitFor(() =>
    expect(
      document.querySelector('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]'),
    ).not.toBeNull(),
  );
  return document.querySelector(
    '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
  ) as HTMLElement;
}

describe('Ohne Netz aus der Zeile (LLH-1138, design.md D8)', () => {
  const benutzerId = benutzerFixture().id;

  it('Nachsichtung: die Zeile zeigt „Offline vorgemerkt“, gesendet wird nichts', async () => {
    const gesendet: unknown[] = [];
    server.use(
      http.post('/api/einsaetze/1/personen/70/sichtung', async ({ request }) => {
        gesendet.push(await request.json());
        return HttpResponse.json(sichtungAntwort('sk1'), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    render(() => [r007]);

    await user.click(await screen.findByRole('button', { name: /^Sichtung R-007 ändern/ }));
    setzeOnline(false);
    const flaeche = await screen.findByRole('region', { name: 'Sichtung R-007' });
    await user.click(within(flaeche).getByRole('radio', { name: /^SK I,/ }));
    await user.click(within(flaeche).getByRole('button', { name: 'Übernehmen' }));

    expect(await within(zeile('R-007')).findByText('Offline vorgemerkt')).toBeInTheDocument();
    // Die Zelle zeigt weiter den Serverstand.
    expect(
      within(zeile('R-007')).getByRole('button', { name: 'Sichtung R-007 ändern, aktuell SK II' }),
    ).toBeInTheDocument();
    expect(gesendet).toEqual([]);
    expect((await schreibaktionenLaden(benutzerId, 1)).map((z) => z.aktion)).toEqual([
      expect.objectContaining({
        art: 'sichtung',
        person_id: 70,
        bezeichnung: 'R-007',
        daten: expect.objectContaining({ kategorie: 'sk1', zeitpunkt_at: expect.any(String) }),
      }),
    ]);
  });

  it('Verbleib aus der Lücke: der Dialog schließt, die Zeile zeigt „Offline vorgemerkt“', async () => {
    const gesendet: unknown[] = [];
    server.use(
      http.post('/api/einsaetze/1/personen/70/verbleib', async ({ request }) => {
        gesendet.push(await request.json());
        return HttpResponse.json(verbleibAntwort, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    render(() => [r007]);

    await user.click(await screen.findByRole('button', { name: 'Verbleib erfassen für R-007' }));
    setzeOnline(false);
    await erfasseTransport(user, 'KH Mitte');

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Verbleib erfassen' })).toBeNull(),
    );
    expect(await within(zeile('R-007')).findByText('Offline vorgemerkt')).toBeInTheDocument();
    expect(gesendet).toEqual([]);
    expect((await schreibaktionenLaden(benutzerId, 1)).map((z) => z.aktion.art)).toEqual([
      'verbleib',
    ]);
  });
});

describe('Zeilenmenü (LLH-1130, 2.3)', () => {
  const eintraege = (menue: HTMLElement) =>
    within(menue)
      .getAllByRole('menuitem')
      .map((e) => e.textContent);

  it('trägt Sichten, Verbleib erfassen und Auf Lagekarte verorten; Verorten mit Rückweg', async () => {
    const user = userEvent.setup();
    render(() => [r007]);

    await user.click(await screen.findByRole('button', { name: 'Aktionen zu R-007' }));
    // Gegenprobe zu „Ohne Schreibrecht“: mit Schreibrecht steht die Spalte.
    expect(screen.getByRole('columnheader', { name: 'Aktionen' })).toBeInTheDocument();
    const menue = await offenesMenue();
    expect(eintraege(menue)).toEqual(['Sichten', 'Verbleib erfassen', 'Auf Lagekarte verorten']);
    // Das Öffnen des Menüs ist kein Zeilenklick.
    expect(screen.queryByText('Detailseite')).toBeNull();

    await user.click(within(menue).getByRole('menuitem', { name: 'Auf Lagekarte verorten' }));
    expect(await screen.findByText('Lagekarte')).toBeInTheDocument();
    expect(screen.getByTestId('ort')).toHaveTextContent(
      lagekartePfad(1, { platzieren: { typ: 'person', id: 70, zurueck: true } }),
    );
  });

  it('„Sichten“ öffnet die Nachsichtung, „Verbleib erfassen“ den Verbleib-Dialog', async () => {
    const gesendet: unknown[] = [];
    server.use(
      http.post('/api/einsaetze/1/personen/70/sichtung', async ({ request }) => {
        gesendet.push(await request.json());
        return HttpResponse.json(sichtungAntwort('sk3'), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    render(() => [r007]);

    await user.click(await screen.findByRole('button', { name: 'Aktionen zu R-007' }));
    await user.click(within(await offenesMenue()).getByRole('menuitem', { name: 'Sichten' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sichtung erfassen' });
    await user.click(within(dialog).getByRole('radio', { name: /^SK III,/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Übernehmen' }));
    await waitFor(() =>
      expect(gesendet).toEqual([{ kategorie: 'sk3', notiz: null, client_id: expect.any(String) }]),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Sichtung erfassen' })).toBeNull(),
    );

    await user.click(screen.getByRole('button', { name: 'Aktionen zu R-007' }));
    await user.click(
      within(await offenesMenue()).getByRole('menuitem', { name: 'Verbleib erfassen' }),
    );
    expect(await screen.findByRole('dialog', { name: 'Verbleib erfassen' })).toBeInTheDocument();
    expect(screen.queryByText('Detailseite')).toBeNull();
  });

  it('gesperrte Lagekarte: Verorten steht gesperrt mit Grund', async () => {
    server.use(
      http.get('/api/einsaetze/1/modul-freigaben', () =>
        HttpResponse.json(freigabenFixture({ lagekarte: { zugriff: false } })),
      ),
    );
    const user = userEvent.setup();
    render(() => [r007]);

    await user.click(await screen.findByRole('button', { name: 'Aktionen zu R-007' }));
    const menue = await offenesMenue();
    await waitFor(() =>
      expect(
        within(menue).getByRole('menuitem', {
          name: 'Auf Lagekarte verorten (Keine Berechtigung)',
        }),
      ).toHaveAttribute('aria-disabled', 'true'),
    );
  });

  it('eine vermisste Person hat kein Zeilenmenü', async () => {
    render(() => [r007, { ...r007, id: 71, registrier_nr: 9, status: 'vermisst' }]);
    expect(await screen.findByRole('button', { name: 'Aktionen zu R-007' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aktionen zu R-009' })).toBeNull();
  });

  it('unter md steht das Menü in der Karte', async () => {
    setzeViewportBreite(390);
    const user = userEvent.setup();
    render(() => [r007]);

    const ausloeser = await screen.findByRole('button', { name: 'Aktionen zu R-007' });
    expect(ausloeser.closest('[data-lfh="datensicht-karte"]')).not.toBeNull();
    await user.click(ausloeser);
    expect(eintraege(await offenesMenue())).toEqual([
      'Sichten',
      'Verbleib erfassen',
      'Auf Lagekarte verorten',
    ]);
  });
});

describe('Schleuse: Popover und Menü halten die Liste (LLH-1130, 2.4)', () => {
  const neu: Person = { ...r007, id: 72, registrier_nr: 2, name: 'Neuzugang' };
  /**
   * Wie am Touch-Gerät: weder Fokus noch Mauszeiger in der Liste, nur das Offene hält. Reacts
   * `onPointerLeave` hört auf `pointerout` mit einem Ziel außerhalb.
   */
  const fokusWeg = () => {
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    fireEvent.pointerOut(screen.getByRole('region', { name: 'Personen' }), {
      pointerType: 'mouse',
      relatedTarget: document.body,
    });
  };

  it('Popover offen, live kommt eine Person hinzu: Menge und Folge bleiben, bis es zu ist', async () => {
    const user = userEvent.setup();
    let stand: Person[] = [r007];
    const { client } = render(() => stand);

    await user.click(await screen.findByRole('button', { name: /^Sichtung R-007 ändern/ }));
    const flaeche = await screen.findByRole('region', { name: 'Sichtung R-007' });
    fokusWeg();
    stand = [r007, neu];
    act(() => client.setQueryData(einsatzKeys.personen(1), stand));

    expect(await screen.findByText('1 neuer Eintrag — anzeigen')).toBeInTheDocument();
    expect(screen.queryByText('R-002')).toBeNull();

    await user.click(within(flaeche).getByRole('button', { name: 'Abbrechen' }));
    fokusWeg();
    expect(await screen.findByText('R-002')).toBeInTheDocument();
  });

  it('Zeilenmenü offen: die Liste hält, bis es zu ist', async () => {
    const user = userEvent.setup();
    let stand: Person[] = [r007];
    const { client } = render(() => stand);

    await user.click(await screen.findByRole('button', { name: 'Aktionen zu R-007' }));
    await offenesMenue();
    fokusWeg();
    stand = [r007, neu];
    act(() => client.setQueryData(einsatzKeys.personen(1), stand));

    expect(await screen.findByText('1 neuer Eintrag — anzeigen')).toBeInTheDocument();
    expect(screen.queryByText('R-002')).toBeNull();

    await user.keyboard('{Escape}');
    fokusWeg();
    expect(await screen.findByText('R-002')).toBeInTheDocument();
  });

  it('Menü in der Karte (unter md) hält ebenso', async () => {
    setzeViewportBreite(390);
    const user = userEvent.setup();
    let stand: Person[] = [r007];
    const { client } = render(() => stand);

    await user.click(await screen.findByRole('button', { name: 'Aktionen zu R-007' }));
    await offenesMenue();
    fokusWeg();
    stand = [r007, neu];
    act(() => client.setQueryData(einsatzKeys.personen(1), stand));

    expect(await screen.findByText('1 neuer Eintrag — anzeigen')).toBeInTheDocument();
    expect(screen.queryByText('R-002')).toBeNull();

    await user.keyboard('{Escape}');
    fokusWeg();
    expect(await screen.findByText('R-002')).toBeInTheDocument();
  });

  it('Verbleib-Dialog offen: die Liste hält, bis er zu ist', async () => {
    const user = userEvent.setup();
    let stand: Person[] = [r007];
    const { client } = render(() => stand);

    await user.click(await screen.findByRole('button', { name: 'Verbleib erfassen für R-007' }));
    const dialog = await screen.findByRole('dialog', { name: 'Verbleib erfassen' });
    fokusWeg();
    stand = [r007, neu];
    act(() => client.setQueryData(einsatzKeys.personen(1), stand));

    expect(await screen.findByText('1 neuer Eintrag — anzeigen')).toBeInTheDocument();
    expect(screen.queryByText('R-002')).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    fokusWeg();
    expect(await screen.findByText('R-002')).toBeInTheDocument();
  });
});

describe('Ohne Schreibrecht (LLH-1130, 2.5)', () => {
  const ohneBedienung = () => {
    expect(screen.queryByRole('button', { name: /Sichtung R-007/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /R-007 sichten/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Verbleib erfassen/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Aktionen zu R-007' })).toBeNull();
    // Die Zeilenaktionsspalte entfällt ganz (M45), keine leere Spalte „Aktionen“.
    expect(screen.queryByRole('columnheader', { name: 'Aktionen' })).toBeNull();
  };

  it('Beobachter: „Nur Ansicht“ mit Grund über der Liste, keine Bedienelemente in den Zeilen', async () => {
    render(() => [r007, { ...r007, id: 71, registrier_nr: 9, aktuelle_sichtung: null }], {
      meine_rolle: 'beobachter',
    });
    await screen.findByText('R-007');
    const hinweis = await screen.findByRole('status');
    expect(hinweis).toHaveTextContent('Nur Ansicht');
    expect(hinweis).toHaveTextContent('nur Einsatzleitung und Führungspersonal');
    // Der Hinweis steht über der Liste.
    const liste = screen.getByRole('region', { name: 'Personen' });
    expect(hinweis.compareDocumentPosition(liste) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    ohneBedienung();
    expect(screen.queryByRole('button', { name: /R-009 sichten/ })).toBeNull();
    // Die Sichtung bleibt als Anzeige stehen.
    expect(within(zeile('R-007')).getByText('SK II')).toBeInTheDocument();
  });

  it('abgeschlossener Einsatz: „Einsatz abgeschlossen“, keine Bedienelemente', async () => {
    render(() => [r007], { status: 'abgeschlossen' });
    await screen.findByText('R-007');
    expect(await screen.findByText('Einsatz abgeschlossen')).toBeInTheDocument();
    ohneBedienung();
  });

  it('unter md: keine Bedienelemente in der Karte', async () => {
    setzeViewportBreite(390);
    render(() => [r007], { meine_rolle: 'beobachter' });
    await screen.findByText('R-007');
    expect(await screen.findByText('nur Einsatzleitung und Führungspersonal')).toBeInTheDocument();
    ohneBedienung();
  });
});
