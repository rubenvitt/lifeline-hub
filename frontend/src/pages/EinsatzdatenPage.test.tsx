import { http, HttpResponse } from 'msw';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes, useNavigate } from 'react-router';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { meHandler, server } from '../test/server';
import { neuerQueryClient, renderMitProviders } from '../test/utils';
import { einsatzKeys } from '../api/queryKeys';
import type {
  BenutzerAnzeige,
  EinsatzAnzeige,
  EinsatzFahrzeug,
  Fuehrungsstelle,
  FuehrungsstellePatch,
  Sprechgruppe,
} from '../api/types';
import EinsatzdatenPage, { gleicherZeitpunkt } from './EinsatzdatenPage';
import { alsZeitpunkt } from '../anzeige/zeitEingabe';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
import { mitProzessZone } from '../test/prozessZone';
import { setzeViewportBreite } from '../test/viewport';
import { adminFixture, einsatzFixture, freigabenFixture } from '../test/fixtures';

dayjs.extend(utc);

const admin = adminFixture();

const basisEinsatz = einsatzFixture({
  id: 7,
  bezeichnung: 'Hochwasser Nord',
  stichwort: 'H1',
  begonnen_at: '2026-05-23 09:00:00',
  einsatznummer_intern: '2026-001',
});

const mitglieder = [
  {
    benutzer_id: 1,
    anzeigename: 'Admin',
    benutzername: 'admin',
    einsatz_rolle: 'einsatzleitung',
    zugewiesen_at: '2026-05-23 09:00:00',
  },
  {
    benutzer_id: 2,
    anzeigename: 'Frank Führung',
    benutzername: 'frank',
    einsatz_rolle: 'fuehrungspersonal',
    zugewiesen_at: '2026-05-23 09:05:00',
  },
];

const vorschlaege = [
  { id: 1, text: 'H1' },
  { id: 2, text: 'MANV' },
];

const sprechgruppenListe: Sprechgruppe[] = [
  {
    id: 1,
    einsatz_id: null,
    einsatz_lokal: false,
    bezeichnung: '311',
    betriebsart: 'TMO',
    hinweis: null,
    aktiv: true,
    sortier: 1,
  },
  {
    id: 2,
    einsatz_id: 7,
    einsatz_lokal: true,
    bezeichnung: '505',
    betriebsart: 'DMO',
    hinweis: null,
    aktiv: true,
    sortier: 2,
  },
];

const fahrzeugListe = [
  {
    id: 41,
    einsatz_id: 7,
    funkrufname: 'Florian Musterstadt 10/1',
    fahrzeugtyp: 'ELW 2',
    disponiert_at: '2026-10-09T10:00:00',
    ist_adhoc: true,
    ist_demo: false,
  },
  {
    id: 42,
    einsatz_id: 7,
    funkrufname: 'Florian Musterstadt 19/1',
    fahrzeugtyp: 'MTW',
    disponiert_at: '2026-10-09T10:00:00',
    ist_adhoc: true,
    ist_demo: false,
  },
] satisfies EinsatzFahrzeug[];

interface SetupOpts {
  einsatz?: Partial<EinsatzAnzeige>;
  benutzer?: BenutzerAnzeige;
  /** Anzeigezone; ohne gilt die Browserzone (kein Provider, wie bisher). */
  zeitzone?: string;
}

function setup(opts: SetupOpts = {}) {
  const einsatz = { ...basisEinsatz, ...opts.einsatz };
  const benutzer = opts.benutzer ?? admin;
  server.use(
    meHandler(benutzer),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    http.get('/api/einsaetze/7/mitglieder', () => HttpResponse.json(mitglieder)),
    http.get('/api/einsaetze/:id/mitglieder/auswahl', () => HttpResponse.json([])),
    http.get('/api/stichwort-vorschlaege', () => HttpResponse.json(vorschlaege)),
    http.get('/api/einsaetze/:id/ort-vorschau', () =>
      HttpResponse.json({ peilung: null, ortsname: null }),
    ),
    http.get('/api/einsaetze/7/fuehrungsstelle', () =>
      HttpResponse.json({ sprechgruppen: [], fahrzeug_ids: [] } satisfies Fuehrungsstelle),
    ),
    http.get('/api/einsaetze/7/sprechgruppen', () => HttpResponse.json(sprechgruppenListe)),
    http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json(fahrzeugListe)),
  );
  const routen = (
    <Routes>
      <Route path="/einsaetze/:id/einsatzdaten" element={<EinsatzdatenPage />} />
    </Routes>
  );
  return renderMitProviders(
    opts.zeitzone ? (
      <AnzeigeKonventionenProvider konventionen={{ zeitzone: opts.zeitzone }}>
        {routen}
      </AnzeigeKonventionenProvider>
    ) : (
      routen
    ),
    { route: '/einsaetze/7/einsatzdaten' },
  );
}

describe('gleicherZeitpunkt (LFH-472)', () => {
  it('vergleicht den Instant, nicht die Objektidentität', () => {
    // Zwei Renders bauen zwei Objekte für denselben Wirestring; „unverändert" muss das bleiben.
    expect(
      gleicherZeitpunkt(alsZeitpunkt('2026-05-23 09:00:00')!, alsZeitpunkt('2026-05-23 09:00:00')!),
    ).toBe(true);
    expect(
      gleicherZeitpunkt(alsZeitpunkt('2026-05-23 09:00:00')!, alsZeitpunkt('2026-05-23 09:00:01')!),
    ).toBe(false);
  });

  it('leer ist nur leer gleich', () => {
    expect(gleicherZeitpunkt(null, null)).toBe(true);
    expect(gleicherZeitpunkt(null, alsZeitpunkt('2026-05-23 09:00:00')!)).toBe(false);
    expect(gleicherZeitpunkt(alsZeitpunkt('2026-05-23 09:00:00')!, null)).toBe(false);
  });
});

/** Nimmt jeden PATCH-Body auf und legt ihn wie der Server über den Stand (GET danach frisch). */
function serverStand(einsatz: Partial<EinsatzAnzeige> = {}) {
  const bodies: Record<string, unknown>[] = [];
  let stand: EinsatzAnzeige = { ...basisEinsatz, ...einsatz };
  server.use(
    http.get('/api/einsaetze/7', () => HttpResponse.json(stand)),
    http.patch('/api/einsaetze/7', async ({ request }) => {
      const body = (await request.json()) as Partial<EinsatzAnzeige>;
      bodies.push(body);
      stand = { ...stand, ...body };
      return HttpResponse.json(stand);
    }),
  );
  return {
    bodies,
    stand: () => stand,
    fremdAendern: (teil: Partial<EinsatzAnzeige>) => {
      stand = { ...stand, ...teil };
    },
  };
}

describe('EinsatzdatenPage', () => {
  it('LFH-463: zeigt den Besprechungstermin lokal; derselbe Instant gilt als unverändert', async () => {
    setup({ einsatz: { naechste_lagebesprechung_at: '2026-09-09 13:17:43' } });
    const { bodies } = serverStand({ naechste_lagebesprechung_at: '2026-09-09 13:17:43' });
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Nächste Lagebesprechung bearbeiten' }),
    );
    expect(screen.getByRole('textbox', { name: 'Nächste Lagebesprechung' })).toHaveValue(
      dayjs.utc('2026-09-09 13:17:43').local().format('YYYY-MM-DD HH:mm:ss'),
    );
    await user.click(screen.getByRole('button', { name: 'Nächste Lagebesprechung speichern' }));
    expect(
      await screen.findByRole('button', { name: 'Nächste Lagebesprechung bearbeiten' }),
    ).toBeVisible();
    expect(bodies).toEqual([]);
  });

  it('LFH-463: leeren des Besprechungstermins sendet explizit null', async () => {
    setup({ einsatz: { naechste_lagebesprechung_at: '2026-09-09 13:17:43' } });
    const { bodies } = serverStand({ naechste_lagebesprechung_at: '2026-09-09 13:17:43' });
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Nächste Lagebesprechung bearbeiten' }),
    );
    const feld = screen.getByRole('textbox', { name: 'Nächste Lagebesprechung' });
    // jsdom aktiviert den CSS-Hoverzustand des Clear-Buttons nicht; hier zählt der onClear-Pfad.
    fireEvent.click(feld.closest('.ant-picker')!.querySelector<HTMLElement>('.ant-picker-clear')!);
    await user.click(screen.getByRole('button', { name: 'Nächste Lagebesprechung speichern' }));
    await waitFor(() => expect(bodies).toEqual([{ naechste_lagebesprechung_at: null }]));
  });

  it('zeigt Kopfdaten im Lesemodus; eine leere lesende Angabe als —', async () => {
    setup({ einsatz: { einsatznummer_intern: null } });
    expect(await screen.findByText('Realeinsatz')).toBeInTheDocument();
    // „Admin“ ist die Einsatzleitung in der Kopfleiste; eine Mitgliederliste gibt es hier nicht mehr.
    expect(screen.getByText('Admin')).toBeInTheDocument();
    const einsatz = within(screen.getByRole('region', { name: 'Einsatz' }));
    expect(einsatz.getByText('—')).toBeInTheDocument();
    // Mit Schreibrecht zeigen leere bearbeitbare Angaben ihre Aufforderung statt „—“.
    expect(await screen.findByRole('button', { name: 'Meldende Stelle eintragen' })).toBeVisible();
  });

  it('zeigt Koordinaten über formatKoordinate (WGS84-Default: toFixed(5))', async () => {
    setup({ einsatz: { einsatzort_lat: 48.1234, einsatzort_lon: 11.5678 } });
    // Ohne EinsatzAnzeigeProvider greift DEFAULT_KONVENTIONEN → WGS84 → lat.toFixed(5), lon.toFixed(5)
    expect(await screen.findByText('48.12340, 11.56780')).toBeInTheDocument();
  });

  it('kein Knopf „Bearbeiten“ und kein Formular — der Zeilenweg ist der einzige (LFH-1170)', async () => {
    setup();
    expect(await screen.findByRole('button', { name: 'Bezeichnung bearbeiten' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull();
    expect(screen.queryByText('Einsatzdaten bearbeiten')).toBeNull();
  });

  it('Beobachter: keine Aufforderung an der Bezeichnung', async () => {
    setup({
      einsatz: { meine_rolle: 'beobachter' },
      benutzer: { ...admin, system_rolle: 'keiner' },
    });
    await screen.findByText('Realeinsatz');
    expect(screen.queryByRole('button', { name: 'Bezeichnung bearbeiten' })).toBeNull();
  });

  it('LFH-1066: sperrt den Admin einer fremden Org und nennt den Grund', async () => {
    setup({ einsatz: { meine_rolle: null }, benutzer: { ...admin, org_id: 2 } });
    expect(
      await screen.findByText('nur Einsatzleitung, Führungspersonal oder Org-Admin'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /eintragen$|bearbeiten$/ })).toBeNull();
    const fs = within(await screen.findByRole('region', { name: 'Eigene Führungsstelle' }));
    expect(fs.queryByRole('button', { name: 'Rufname eintragen' })).toBeNull();
  });

  it('LFH-1066: der Admin der Einsatz-Org bearbeitet ohne Mitgliedschaft, ohne Grund-Zeile', async () => {
    setup({ einsatz: { meine_rolle: null } });
    expect(await screen.findByRole('button', { name: 'Bezeichnung bearbeiten' })).toBeVisible();
    const fs = within(await screen.findByRole('region', { name: 'Eigene Führungsstelle' }));
    expect(await fs.findByRole('button', { name: 'Rufname eintragen' })).toBeInTheDocument();
    expect(screen.queryByText('nur Einsatzleitung, Führungspersonal oder Org-Admin')).toBeNull();
  });

  it('LFH-1066: ein Admin einer fremden Org als Führungspersonal bearbeitet weiter', async () => {
    setup({ einsatz: { meine_rolle: 'fuehrungspersonal' }, benutzer: { ...admin, org_id: 2 } });
    expect(await screen.findByRole('button', { name: 'Bezeichnung bearbeiten' })).toBeVisible();
  });

  it('abgeschlossener Einsatz: keine Aufforderung an der Bezeichnung', async () => {
    setup({ einsatz: { status: 'abgeschlossen', abgeschlossen_at: '2026-05-24 10:00:00' } });
    await screen.findByText('Realeinsatz');
    expect(screen.queryByRole('button', { name: 'Bezeichnung bearbeiten' })).toBeNull();
  });

  it('zeigt keine Mitgliederliste mehr — der Zugriff liegt in den Einstellungen (LFH-1170)', async () => {
    setup();
    await screen.findByText('Realeinsatz');
    expect(screen.queryByRole('region', { name: 'Zugriff' })).toBeNull();
    expect(screen.queryByText('Frank Führung')).toBeNull();
  });
});

/**
 * Gliederung (LFH-1170, Spec `einsatzdaten-bearbeitung`): Kennungen im Seitenkopf, kein
 * Klappbereich, vier Paneele in fester Reihenfolge, jede Angabe genau einmal.
 */
describe('EinsatzdatenPage · Gliederung (LFH-1170)', () => {
  /** Das Mono-Meta neben dem Titel. */
  async function kopfMeta() {
    await screen.findByRole('heading', { level: 1 });
    return document.querySelector<HTMLElement>('.lfh-seitenkopf__meta');
  }

  it('nennt sich „Einsatzdaten“, der Einsatzname steht im Pfad, der Status nicht im h1', async () => {
    // LFH-954: vorher war das h1 der Einsatzname samt Status, „Einsatzdaten“ stand nirgends.
    const { container } = setup({
      einsatz: { status: 'abgeschlossen', abgeschlossen_at: '2026-05-24 10:00:00' },
    });
    const h1 = await screen.findByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent(/^Einsatzdaten$/);
    expect(container.querySelector('.lfh-seitenkopf__pfad')).toHaveTextContent(
      basisEinsatz.bezeichnung,
    );
  });

  it('Einsatznummer und Leitstellen-Nr. stehen ohne Aufklappen im Seitenkopf', async () => {
    setup({ einsatz: { einsatznummer_intern: 'E-2026-0001', leitstellen_nr: 'ILS-4711' } });
    await waitFor(async () => expect(await kopfMeta()).toHaveTextContent('E-2026-0001 · ILS-4711'));
  });

  it('nur die Einsatznummer: kein Trennzeichen', async () => {
    setup({ einsatz: { einsatznummer_intern: 'E-2026-0001', leitstellen_nr: null } });
    await waitFor(async () => expect(await kopfMeta()).toHaveTextContent('E-2026-0001'));
    expect(await kopfMeta()).not.toHaveTextContent('·');
  });

  it('ohne beide Kennungen keine leere Kennung im Kopf', async () => {
    setup({ einsatz: { einsatznummer_intern: null, leitstellen_nr: null } });
    await screen.findByText('Realeinsatz');
    expect(
      document.querySelector('.lfh-seitenkopf__meta [data-lfh="einsatz-kennungen"]'),
    ).toBeNull();
  });

  it('kein Klappbereich „Technische Angaben“; die Kennungen stehen sichtbar im Paneel „Einsatz“', async () => {
    setup({ einsatz: { einsatznummer_intern: 'E-2026-0431', leitstellen_nr: 'LS-1' } });
    const einsatz = within(await screen.findByRole('region', { name: 'Einsatz' }));
    expect(screen.queryByText('Technische Angaben')).toBeNull();
    expect(einsatz.getByText('E-2026-0431')).toBeVisible();
    expect(einsatz.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' })).toBeVisible();
    expect(einsatz.getByText('Angelegt')).toBeVisible();
  });

  it('ordnet die Angaben den Paneelen zu, jede genau einmal', async () => {
    setup();
    const paneele = {
      Einsatz: [
        'Bezeichnung',
        'Einsatzart',
        'Einsatznummer',
        'Leitstellen-Nr.',
        'Angelegt',
        'Nächste Lagebesprechung',
      ],
      Einsatzort: ['Koordinate'],
      Erstmeldung: ['Meldende Stelle', 'Sachverhalt / Meldebild', 'Anzahl Betroffene (initial)'],
    };
    for (const [name, etiketten] of Object.entries(paneele)) {
      const paneel = await screen.findByRole('region', { name });
      const dts = [...paneel.querySelectorAll('dt')].map((dt) => dt.textContent);
      expect(dts, name).toEqual(etiketten);
    }
    // Die Kopfleiste trägt Stichwort, Alarmzeit, Einsatzort, Einsatzleitung — und kein Paneel
    // wiederholt sie.
    const alle = [...document.querySelectorAll('dt')].map((dt) => dt.textContent);
    for (const kopf of ['Einsatzstichwort', 'Alarmzeit', 'Einsatzort', 'Einsatzleitung']) {
      expect(alle).not.toContain(kopf);
    }
    expect(new Set(alle).size).toBe(alle.length);
  });

  it('hält die Lesereihenfolge Einsatz → Einsatzort → Erstmeldung → Eigene Führungsstelle', async () => {
    setup();
    await screen.findByRole('region', { name: 'Eigene Führungsstelle' });
    const reihenfolge = ['Einsatz', 'Einsatzort', 'Erstmeldung', 'Eigene Führungsstelle'].map(
      (name) => screen.getByRole('region', { name }),
    );
    for (let i = 1; i < reihenfolge.length; i++) {
      expect(
        reihenfolge[i - 1].compareDocumentPosition(reihenfolge[i]) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it.each([
    [1440, 'repeat(2, minmax(0, 1fr))'],
    [1024, 'minmax(0, 1fr)'],
    [390, 'minmax(0, 1fr)'],
  ])('Paneel-Raster bei %i px: %s', async (breite, spalten) => {
    setzeViewportBreite(breite);
    setup();
    await screen.findByRole('region', { name: 'Erstmeldung' });
    const raster = document.querySelector<HTMLElement>('[data-lfh="einsatzdaten-paneele"]');
    expect(raster?.style.gridTemplateColumns).toBe(spalten);
  });

  it('LFH-617: die Einsatznummer ist Anzeige — die Leitstellen-Nr. geht ohne sie in den PATCH', async () => {
    setup({ einsatz: { einsatznummer_intern: 'E-2026-0431', leitstellen_nr: 'LS-1' } });
    const { bodies } = serverStand({ einsatznummer_intern: 'E-2026-0431', leitstellen_nr: 'LS-1' });
    const user = userEvent.setup();
    const einsatz = within(await screen.findByRole('region', { name: 'Einsatz' }));
    expect(einsatz.queryByRole('button', { name: /^Einsatznummer/ })).toBeNull();
    await user.click(einsatz.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' }));
    await user.type(screen.getByRole('textbox', { name: 'Leitstellen-Nr.' }), '2{Enter}');
    await waitFor(() => expect(bodies).toEqual([{ leitstellen_nr: 'LS-12' }]));
  });
});

describe('EinsatzdatenPage · Zeilenbearbeitung (LFH-472)', () => {
  /**
   * Nimmt jeden PATCH-Body auf und legt ihn wie der Server über den Stand; das GET danach (die
   * Invalidierung) liefert den neuen Stand, nicht den alten.
   */
  function patchMitschnitt(einsatz: Partial<EinsatzAnzeige> = {}) {
    const bodies: Record<string, unknown>[] = [];
    let stand: EinsatzAnzeige = { ...basisEinsatz, ...einsatz };
    server.use(
      http.get('/api/einsaetze/7', () => HttpResponse.json(stand)),
      http.patch('/api/einsaetze/7', async ({ request }) => {
        const body = (await request.json()) as Partial<EinsatzAnzeige>;
        bodies.push(body);
        stand = { ...stand, ...body };
        return HttpResponse.json(stand);
      }),
    );
    return bodies;
  }

  it('trägt die Leitstellen-Nr. nach, ohne die Leseansicht zu verlassen — nur dieses Feld geht raus', async () => {
    setup();
    const bodies = patchMitschnitt();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Leitstellen-Nr. eintragen' }));

    // Die Leseansicht steht weiter: Kopfleiste und Paneele sind sichtbar, kein Formular.
    expect(screen.getByText('Einsatzstichwort')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Erstmeldung' })).toBeInTheDocument();
    expect(screen.queryByText('Einsatzdaten bearbeiten')).toBeNull();

    await user.type(screen.getByRole('textbox', { name: 'Leitstellen-Nr.' }), 'ILS-4711{Enter}');
    await waitFor(() => expect(bodies).toEqual([{ leitstellen_nr: 'ILS-4711' }]));
    expect(
      await screen.findByRole('button', { name: 'Leitstellen-Nr. bearbeiten' }),
    ).toHaveAccessibleDescription('ILS-4711');
    // Der Seitenkopf nennt die nachgetragene Nummer.
    expect(document.querySelector('.lfh-seitenkopf__meta')).toHaveTextContent('ILS-4711');
  });

  it('Einsatzstichwort über die Vorschlagseingabe ändern', async () => {
    setup();
    const bodies = patchMitschnitt();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Einsatzstichwort bearbeiten' }));
    const feld = screen.getByRole('combobox', { name: 'Einsatzstichwort' });
    expect(feld).toHaveValue('H1');
    await user.clear(feld);
    await user.type(feld, 'MANV 2');
    await user.click(screen.getByRole('button', { name: 'Einsatzstichwort speichern' }));
    await waitFor(() => expect(bodies).toEqual([{ stichwort: 'MANV 2' }]));
  });

  it('leeren einer optionalen Angabe sendet null', async () => {
    setup({ einsatz: { einsatzort: 'Deich Süd' } });
    const bodies = patchMitschnitt({ einsatzort: 'Deich Süd' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Einsatzort bearbeiten' }));
    await user.clear(screen.getByRole('textbox', { name: 'Einsatzort' }));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(bodies).toEqual([{ einsatzort: null }]));
  });

  it('unveränderter Wert sendet nichts', async () => {
    setup({ einsatz: { meldende_stelle: 'ILS Nord' } });
    const bodies = patchMitschnitt({ meldende_stelle: 'ILS Nord' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Meldende Stelle bearbeiten' }));
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('button', { name: 'Meldende Stelle bearbeiten' })).toBeVisible();
    expect(bodies).toEqual([]);
  });

  it('Anzahl Betroffene geht als Zahl raus, nicht als Text', async () => {
    setup();
    const bodies = patchMitschnitt();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Anzahl Betroffene (initial) eintragen' }),
    );
    await user.type(screen.getByRole('spinbutton', { name: 'Anzahl Betroffene (initial)' }), '12');
    await user.click(screen.getByRole('button', { name: 'Anzahl Betroffene (initial) speichern' }));
    await waitFor(() => expect(bodies).toEqual([{ anzahl_betroffene_initial: 12 }]));
  });

  it('Alarmzeit geleert: kein PATCH, alte Zeit steht wieder da, Hinweis an der Zeile', async () => {
    setup();
    const bodies = patchMitschnitt();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Alarmzeit bearbeiten' }));
    const feld = screen.getByRole('textbox', { name: 'Alarmzeit' });
    fireEvent.click(feld.closest('.ant-picker')!.querySelector<HTMLElement>('.ant-picker-clear')!);
    await user.click(screen.getByRole('button', { name: 'Alarmzeit speichern' }));

    expect(
      await screen.findByText('Alarmzeit ist eine Pflichtangabe — der bisherige Wert bleibt.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Alarmzeit bearbeiten' })).toBeInTheDocument();
    expect(bodies).toEqual([]);
  });

  it('Alarmzeit unverändert gespeichert: kein PATCH (Wandlung ohne Versatz)', async () => {
    setup();
    const bodies = patchMitschnitt();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Alarmzeit bearbeiten' }));
    expect(screen.getByRole('textbox', { name: 'Alarmzeit' })).toHaveValue(
      dayjs.utc(basisEinsatz.begonnen_at).local().format('YYYY-MM-DD HH:mm:ss'),
    );
    await user.click(screen.getByRole('button', { name: 'Alarmzeit speichern' }));
    expect(await screen.findByRole('button', { name: 'Alarmzeit bearbeiten' })).toBeVisible();
    expect(bodies).toEqual([]);
  });

  /*
   * Eingetippt wird die LOKALE Wanduhrzeit des Instants, erwartet der UTC-Wirestring desselben
   * Instants. Unter TZ=UTC wäre das trivial grün; scharf ist es unter TZ=Europe/Berlin
   * (`check-all.sh`). Die Instants liegen je eine Stunde vor und nach beiden Umstellungen 2026
   * und meiden die doppelte Stunde im Oktober, die als Wanduhrzeit mehrdeutig ist. Je Instant ein
   * eigener Fall: als Schleife in EINEM Test lagen vier Seitendurchläufe an der Grenze von
   * `testTimeout` (gemessen 9,6–13 s, LFH-692).
   */
  it.each([
    '2026-03-29 00:30:00',
    '2026-03-29 01:30:00',
    '2026-10-24 23:30:00',
    '2026-10-25 02:30:00',
  ])(
    'Alarmzeit inline: gesendet wird der gewählte absolute Zeitpunkt, beidseits der Sommerzeit-Umstellungen (%s)',
    async (wire) => {
      setup();
      const bodies = patchMitschnitt();
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Alarmzeit bearbeiten' }));
      const feld = screen.getByRole('textbox', { name: 'Alarmzeit' });
      await user.clear(feld);
      await user.type(feld, dayjs.utc(wire).local().format('YYYY-MM-DD HH:mm:ss'));
      // Enter übernimmt die Eingabe in den Picker; der Knopf sendet.
      fireEvent.keyDown(feld, { key: 'Enter' });
      await user.click(screen.getByRole('button', { name: 'Alarmzeit speichern' }));
      await waitFor(() => expect(bodies, wire).toEqual([{ begonnen_at: wire }]));
    },
  );

  it('Escape bei offenem Kalender schließt erst den Kalender, das zweite verwirft die Zeile', async () => {
    setup();
    const bodies = patchMitschnitt();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Alarmzeit bearbeiten' }));
    const feld = screen.getByRole('textbox', { name: 'Alarmzeit' });
    // Ein Klick ins Feld öffnet den Kalender.
    await user.click(feld);
    await waitFor(() =>
      expect(
        document.querySelector('.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)'),
      ).not.toBeNull(),
    );
    fireEvent.keyDown(feld, { key: 'Escape' });
    // Die Zeile steht noch. Ob der Kalender zu ist, zeigt jsdom nicht: es beendet die
    // Schließ-Animation nie, `-hidden` käme nicht an.
    expect(screen.getByRole('textbox', { name: 'Alarmzeit' })).toBeInTheDocument();
    // rc-picker meldet das Schließen erst im nächsten Frame (`useDelayState`); ein Mensch drückt
    // das zweite Escape nie schneller.
    await act(() => new Promise((fertig) => requestAnimationFrame(() => fertig(undefined))));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Alarmzeit' }), { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Alarmzeit' })).toBeNull();
    expect(bodies).toEqual([]);
  });

  it('Speicherfehler steht an der Zeile, die Eingabe bleibt offen, kein Toast', async () => {
    setup();
    server.use(
      http.patch('/api/einsaetze/7', () =>
        HttpResponse.json({ error: 'Einsatz ist abgeschlossen' }, { status: 409 }),
      ),
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Meldende Stelle eintragen' }));
    await user.type(screen.getByRole('textbox', { name: 'Meldende Stelle' }), 'ILS{Enter}');
    expect(await screen.findByText('Einsatz ist abgeschlossen')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Meldende Stelle' })).toHaveValue('ILS');
    expect(document.querySelector('.ant-message-error')).toBeNull();
  });

  it('Einsatzleitung, Einsatznummer und „Angelegt“ tragen keine Aufforderung', async () => {
    setup({ einsatz: { einsatzort_lat: 48.1234, einsatzort_lon: 11.5678 } });
    await screen.findByRole('region', { name: 'Einsatz' });
    for (const angabe of ['Einsatzleitung', 'Einsatznummer', 'Angelegt']) {
      for (const aufforderung of ['bearbeiten', 'eintragen']) {
        expect(screen.queryByRole('button', { name: `${angabe} ${aufforderung}` })).toBeNull();
      }
    }
    // Gegenprobe: Bezeichnung, Koordinate und Leitstellen-Nr. daneben tragen eine.
    expect(screen.getByRole('button', { name: 'Bezeichnung bearbeiten' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Koordinate bearbeiten' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leitstellen-Nr. eintragen' })).toBeInTheDocument();
  });

  it('zwei Personen, zwei Zeilen: die ältere Seite überschreibt die fremde Leitstellen-Nr. nicht', async () => {
    setup({ einsatz: { leitstellen_nr: 'LS-1' } });
    const { bodies, stand, fremdAendern } = serverStand({ leitstellen_nr: 'LS-1' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Meldende Stelle eintragen' }));
    fremdAendern({ leitstellen_nr: 'LS-99' });
    await user.type(screen.getByRole('textbox', { name: 'Meldende Stelle' }), 'ILS Nord{Enter}');
    await waitFor(() => expect(bodies).toEqual([{ meldende_stelle: 'ILS Nord' }]));
    expect(stand().leitstellen_nr).toBe('LS-99');
  });

  it.each([
    [
      'Beobachter',
      { meine_rolle: 'beobachter' as const },
      { ...admin, system_rolle: 'keiner' as const },
    ],
    [
      'abgeschlossener Einsatz',
      { status: 'abgeschlossen' as const, abgeschlossen_at: '2026-05-24 10:00:00' },
      admin,
    ],
  ])(
    'ohne Schreibrecht (%s) keine Aufforderung an einer Zeile',
    async (_fall, einsatz, benutzer) => {
      setup({ einsatz, benutzer });
      await screen.findByRole('region', { name: 'Einsatz' });
      expect(screen.queryAllByRole('button', { name: / (bearbeiten|eintragen)$/ })).toEqual([]);
      expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    },
  );
});

/**
 * Bezeichnung und Koordinate als Zeile (LFH-1170): bis dahin nur im Vollformular änderbar.
 */
describe('EinsatzdatenPage · Bezeichnung und Koordinate als Zeile (LFH-1170)', () => {
  it('Bezeichnung: genau { bezeichnung } geht hinaus, der Ortspfad folgt', async () => {
    const { container } = setup();
    const { bodies } = serverStand();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Bezeichnung bearbeiten' }));
    const feld = screen.getByRole('textbox', { name: 'Bezeichnung' });
    expect(feld).toHaveValue('Hochwasser Nord');
    await user.clear(feld);
    await user.type(feld, 'Hochwasser Süd{Enter}');
    await waitFor(() => expect(bodies).toEqual([{ bezeichnung: 'Hochwasser Süd' }]));
    await waitFor(() =>
      expect(container.querySelector('.lfh-seitenkopf__pfad')).toHaveTextContent('Hochwasser Süd'),
    );
  });

  it('Bezeichnung nur aus Leerzeichen: kein PATCH, alter Wert, Pflichthinweis an der Zeile', async () => {
    setup();
    const { bodies } = serverStand();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Bezeichnung bearbeiten' }));
    const feld = screen.getByRole('textbox', { name: 'Bezeichnung' });
    await user.clear(feld);
    await user.type(feld, '   {Enter}');
    expect(
      await screen.findByText('Bezeichnung ist eine Pflichtangabe — der bisherige Wert bleibt.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Bezeichnung bearbeiten' }),
    ).toHaveAccessibleDescription('Hochwasser Nord');
    expect(bodies).toEqual([]);
  });

  it('Bezeichnung unverändert oder nur mit angehängtem Leerraum: kein PATCH', async () => {
    setup();
    const { bodies } = serverStand();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Bezeichnung bearbeiten' }));
    await user.type(screen.getByRole('textbox', { name: 'Bezeichnung' }), '  {Enter}');
    expect(await screen.findByRole('button', { name: 'Bezeichnung bearbeiten' })).toBeVisible();
    expect(bodies).toEqual([]);
  });

  it('Koordinate setzen: genau das Paar geht hinaus', async () => {
    setup();
    const { bodies } = serverStand();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Koordinate eintragen' }));
    await user.type(screen.getByRole('textbox', { name: 'Koordinate' }), '52.52, 13.405');
    await user.click(screen.getByRole('button', { name: 'Koordinate speichern' }));
    await waitFor(() =>
      expect(bodies).toEqual([{ einsatzort_lat: 52.52, einsatzort_lon: 13.405 }]),
    );
  });

  it('Koordinate leeren: beide Felder null', async () => {
    setup({ einsatz: { einsatzort_lat: 48.1234, einsatzort_lon: 11.5678 } });
    const { bodies } = serverStand({ einsatzort_lat: 48.1234, einsatzort_lon: 11.5678 });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Koordinate bearbeiten' }));
    await user.clear(screen.getByRole('textbox', { name: 'Koordinate' }));
    await user.click(screen.getByRole('button', { name: 'Koordinate speichern' }));
    await waitFor(() => expect(bodies).toEqual([{ einsatzort_lat: null, einsatzort_lon: null }]));
  });

  it('Koordinate unverändert: kein PATCH', async () => {
    setup({ einsatz: { einsatzort_lat: 48.1234, einsatzort_lon: 11.5678 } });
    const { bodies } = serverStand({ einsatzort_lat: 48.1234, einsatzort_lon: 11.5678 });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Koordinate bearbeiten' }));
    await user.click(screen.getByRole('button', { name: 'Koordinate speichern' }));
    expect(await screen.findByRole('button', { name: 'Koordinate bearbeiten' })).toBeVisible();
    expect(bodies).toEqual([]);
  });

  // LFH-517: ungültig ist nicht leer — kein PATCH, der die gespeicherte Koordinate löscht.
  it('unlesbare Koordinate: kein PATCH, die Eingabe bleibt mit Fehler an der Zeile offen', async () => {
    setup({ einsatz: { einsatzort_lat: 48.1234, einsatzort_lon: 11.5678 } });
    const { bodies } = serverStand({ einsatzort_lat: 48.1234, einsatzort_lon: 11.5678 });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Koordinate bearbeiten' }));
    const feld = screen.getByRole('textbox', { name: 'Koordinate' });
    await user.clear(feld);
    await user.type(feld, '48.5; 11.5');
    await user.click(screen.getByRole('button', { name: 'Koordinate speichern' }));
    expect(
      await screen.findByText('Ungültige Koordinate im Format WGS84 dezimal'),
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Koordinate' })).toHaveValue('48.5; 11.5');
    expect(bodies).toEqual([]);

    // Nach Korrektur geht das richtige Paar hinaus.
    await user.clear(screen.getByRole('textbox', { name: 'Koordinate' }));
    await user.type(screen.getByRole('textbox', { name: 'Koordinate' }), '48.5, 11.5');
    await user.click(screen.getByRole('button', { name: 'Koordinate speichern' }));
    await waitFor(() => expect(bodies).toEqual([{ einsatzort_lat: 48.5, einsatzort_lon: 11.5 }]));
  });
});

/**
 * LFH-555: der Einsatzkopf ist live. Ein fremdes `einsatz`-Ereignis frischt den Kopf-Cache auf,
 * während hier jemand tippt. Die Eingaben dieses Schirms dürfen dabei nicht verloren gehen.
 * Nachgestellt über die Invalidierung, die der Live-Strom auslöst (`['einsatz', id]`).
 */
describe('EinsatzdatenPage · Live-Refetch des Kopfs (LFH-555)', () => {
  function setupMitFremdAenderung() {
    let stand: EinsatzAnzeige = { ...basisEinsatz };
    let abrufe = 0;
    const r = setup();
    server.use(
      http.get('/api/einsaetze/7', () => {
        abrufe += 1;
        return HttpResponse.json(stand);
      }),
    );
    return {
      ...r,
      abrufe: () => abrufe,
      fremdAendern: (teil: Partial<EinsatzAnzeige>) => {
        stand = { ...stand, ...teil };
      },
    };
  }

  it('zeigt einen fremd gesetzten Termin nach dem Ereignis ohne Neuladen der Seite', async () => {
    const { client, fremdAendern, abrufe } = setupMitFremdAenderung();
    await screen.findByText('Nächste Lagebesprechung');
    const vorher = abrufe();
    fremdAendern({ naechste_lagebesprechung_at: '2026-09-30 16:00:00' });
    await act(() => client.invalidateQueries({ queryKey: ['einsatz', 7] }));
    await waitFor(() => expect(abrufe()).toBeGreaterThan(vorher));
    expect(
      await screen.findByRole('button', { name: /^Nächste Lagebesprechung bearbeiten/ }),
    ).toBeInTheDocument();
  });

  it('eine offene Zeile „Sachverhalt / Meldebild“ behält ihren Text, der Rest zeigt den neuen Stand', async () => {
    const { client, fremdAendern, abrufe } = setupMitFremdAenderung();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Sachverhalt / Meldebild eintragen' }),
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Sachverhalt / Meldebild' }),
      'Mein Entwurf',
    );

    const vorher = abrufe();
    fremdAendern({ meldende_stelle: 'ILS Süd' });
    await act(() => client.invalidateQueries({ queryKey: ['einsatz', 7] }));
    await waitFor(() => expect(abrufe()).toBeGreaterThan(vorher));

    expect(screen.getByRole('textbox', { name: 'Sachverhalt / Meldebild' })).toHaveValue(
      'Mein Entwurf',
    );
    expect(
      await screen.findByRole('button', { name: 'Meldende Stelle bearbeiten' }),
    ).toHaveAccessibleDescription('ILS Süd');
  });

  it('eine offene Zeile behält ihren Entwurf', async () => {
    const { client, fremdAendern, abrufe } = setupMitFremdAenderung();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Leitstellen-Nr. eintragen' }));
    const feld = await screen.findByRole('textbox', { name: 'Leitstellen-Nr.' });
    await user.type(feld, 'LS-42');

    const vorher = abrufe();
    fremdAendern({ leitstellen_nr: 'LS-99' });
    await act(() => client.invalidateQueries({ queryKey: ['einsatz', 7] }));
    await waitFor(() => expect(abrufe()).toBeGreaterThan(vorher));

    expect(screen.getByRole('textbox', { name: 'Leitstellen-Nr.' })).toHaveValue('LS-42');
  });
});

/**
 * LFH-692 (Delta `einsatzdaten-bearbeitung`, Szenario „Browser in anderer Zone“): Browser auf UTC,
 * Anzeigezone Europe/Berlin. Vorher zeigte die Zeile die Browser-Wanduhr neben der Berliner
 * Leseansicht.
 */
describe('EinsatzdatenPage — Alarmzeit in der Anzeigezone (LFH-692)', () => {
  mitProzessZone('UTC');

  it('Zeilenbearbeitung zeigt 12:00 wie die Leseansicht; 13:00 sendet 11:00 UTC', async () => {
    setup({ zeitzone: 'Europe/Berlin', einsatz: { begonnen_at: '2026-07-14 10:00:00' } });
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.patch('/api/einsaetze/7', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        bodies.push(body);
        return HttpResponse.json({ ...basisEinsatz, ...body });
      }),
    );
    const user = userEvent.setup();
    // Leseansicht: taktische DTG in Berlin.
    expect(await screen.findByText('141200JUL2026')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Alarmzeit bearbeiten' }));
    const feld = screen.getByRole('textbox', { name: 'Alarmzeit' });
    expect(feld).toHaveValue('2026-07-14 12:00:00');
    await user.clear(feld);
    await user.type(feld, '2026-07-14 13:00:00');
    fireEvent.keyDown(feld, { key: 'Enter' });
    await user.click(screen.getByRole('button', { name: 'Alarmzeit speichern' }));
    await waitFor(() => expect(bodies).toEqual([{ begonnen_at: '2026-07-14 11:00:00' }]));
  });
});

/**
 * ── Einstieg in den Einsatzbericht (LFH-726) ──
 *
 * „Einsatzbericht drucken" öffnet die Druckansicht und sendet nichts ab: Kopf-Slot, sekundär, als
 * Link mit Knopfgestalt. Auch für Beobachter und abgeschlossene Einsätze — der Bericht prüft die
 * Rechte je Quelle selbst.
 */
describe('EinsatzdatenPage — Einstieg in den Einsatzbericht (LFH-726)', () => {
  async function kopf() {
    return waitFor(() => {
      const k = document.querySelector<HTMLElement>('[data-lfh="seitenkopf-aktionen"]');
      expect(k).not.toBeNull();
      return k!;
    });
  }

  it('verlinkt sekundär auf die Druckansicht; höchstens eine Primäraktion bleibt', async () => {
    setup();
    const k = await kopf();
    const link = await within(k).findByRole('link', { name: 'Einsatzbericht drucken' });
    expect(link).toHaveAttribute('href', '/einsaetze/7/einsatzdaten/bericht');
    expect(link).not.toHaveClass('ant-btn-primary');
    expect(k.querySelectorAll('.ant-btn-primary').length).toBeLessThanOrEqual(1);
  });

  it('steht auch für Beobachter und im abgeschlossenen Einsatz da', async () => {
    setup({
      einsatz: { meine_rolle: 'beobachter', status: 'abgeschlossen' },
      benutzer: { ...admin, system_rolle: 'keiner' },
    });
    const k = await kopf();
    expect(await within(k).findByRole('link', { name: 'Einsatzbericht drucken' })).toBeVisible();
  });
});

/**
 * Sprung zum Zugriff (LFH-1170, Spec `einsatz-zugriff`): die Mitgliederverwaltung liegt in den
 * Einsatz-Einstellungen; die Einsatzdaten tragen für die Einsatzleitung einen Nebenweg dorthin.
 */
describe('EinsatzdatenPage — Nebenweg „Zugriff verwalten“ (LFH-1170)', () => {
  it('die Einsatzleitung springt in die Sektion „Zugriff“', async () => {
    setup({ benutzer: { ...admin, system_rolle: 'keiner' } });
    const kopf = await waitFor(() => {
      const k = document.querySelector<HTMLElement>('[data-lfh="seitenkopf-aktionen"]');
      expect(k).not.toBeNull();
      return k!;
    });
    const sprung = await within(kopf).findByRole('link', { name: /Zugriff verwalten/ });
    expect(sprung).toHaveAttribute('href', '/einsaetze/7/einstellungen/zugriff');
  });

  it.each([
    ['Führungspersonal', 'fuehrungspersonal' as const],
    ['Beobachter', 'beobachter' as const],
  ])('fehlt für %s', async (_fall, meine_rolle) => {
    setup({ einsatz: { meine_rolle }, benutzer: { ...admin, system_rolle: 'keiner' } });
    await screen.findByRole('link', { name: 'Einsatzbericht drucken' });
    expect(screen.queryByRole('link', { name: /Zugriff verwalten/ })).toBeNull();
  });

  it('fehlt am abgeschlossenen Einsatz', async () => {
    setup({ einsatz: { status: 'abgeschlossen', abgeschlossen_at: '2026-05-24 10:00:00' } });
    await screen.findByRole('link', { name: 'Einsatzbericht drucken' });
    expect(screen.queryByRole('link', { name: /Zugriff verwalten/ })).toBeNull();
  });
});

/**
 * Eigene Führungsstelle (LFH-849, Spec `einsatz-fuehrungsstelle`): ein Paneel mit vier Zeilen,
 * jede schickt nur ihr Feld an `…/fuehrungsstelle`.
 */
describe('EinsatzdatenPage · Eigene Führungsstelle (LFH-849)', () => {
  /** Nimmt jeden PATCH-Body auf und legt ihn wie der Server über den Stand. */
  function fuehrungsstelleMitschnitt(
    start: Fuehrungsstelle = { sprechgruppen: [], fahrzeug_ids: [] },
  ) {
    const bodies: FuehrungsstellePatch[] = [];
    let stand: Fuehrungsstelle = start;
    server.use(
      http.get('/api/einsaetze/7/fuehrungsstelle', () => HttpResponse.json(stand)),
      http.patch('/api/einsaetze/7/fuehrungsstelle', async ({ request }) => {
        const body = (await request.json()) as FuehrungsstellePatch;
        bodies.push(body);
        const { sprechgruppe_ids, fahrzeug_ids, ...felder } = body;
        const naechster: Fuehrungsstelle = { ...stand };
        for (const [k, v] of Object.entries(felder)) {
          if (v == null) delete naechster[k as keyof typeof felder];
          else naechster[k as keyof typeof felder] = v;
        }
        if (fahrzeug_ids) naechster.fahrzeug_ids = [...fahrzeug_ids].sort((a, b) => a - b);
        if (sprechgruppe_ids) {
          naechster.sprechgruppen = sprechgruppenListe.filter((g) =>
            sprechgruppe_ids.includes(g.id),
          );
        }
        stand = naechster;
        return HttpResponse.json(stand);
      }),
    );
    return bodies;
  }

  async function paneel() {
    return within(await screen.findByRole('region', { name: 'Eigene Führungsstelle' }));
  }

  it('zeigt fünf Angaben; leer mit Aufforderung', async () => {
    setup();
    fuehrungsstelleMitschnitt();
    const p = await paneel();
    for (const etikett of [
      'Rufname',
      'Sprechgruppen',
      'Kommunikationsmittel',
      'Erreichbarkeit',
      'Fahrzeuge',
    ]) {
      expect(await p.findByRole('button', { name: `${etikett} eintragen` })).toBeInTheDocument();
    }
  });

  it('Rufname: nur dieses Feld geht hinaus, die Zeile zeigt den Wert', async () => {
    setup();
    const bodies = fuehrungsstelleMitschnitt();
    const user = userEvent.setup();
    const p = await paneel();
    await user.click(await p.findByRole('button', { name: 'Rufname eintragen' }));
    await user.type(p.getByRole('textbox', { name: 'Rufname' }), 'Florian Musterstadt 10/1{Enter}');
    await waitFor(() => expect(bodies).toEqual([{ rufname: 'Florian Musterstadt 10/1' }]));
    expect(
      await p.findByRole('button', { name: 'Rufname bearbeiten' }),
    ).toHaveAccessibleDescription('Florian Musterstadt 10/1');
  });

  it('Sprechgruppen: Auswahl geht als `sprechgruppe_ids`, Anzeige nach Betriebsart', async () => {
    setup();
    const bodies = fuehrungsstelleMitschnitt();
    const user = userEvent.setup();
    const p = await paneel();
    await user.click(await p.findByRole('button', { name: 'Sprechgruppen eintragen' }));
    await user.click(p.getByRole('combobox', { name: 'Sprechgruppen' }));
    await user.click(await screen.findByText('311'));
    await user.click(await screen.findByText('505 (lokal)'));
    await user.click(p.getByRole('button', { name: 'Sprechgruppen speichern' }));
    await waitFor(() => expect(bodies).toEqual([{ sprechgruppe_ids: [1, 2] }]));
    expect(
      await p.findByRole('button', { name: 'Sprechgruppen bearbeiten' }),
    ).toHaveAccessibleDescription('TMO 311 · DMO 505');
  });

  it('Fahrzeuge: Auswahl geht als `fahrzeug_ids`, Anzeige mit Typ (LFH-1106)', async () => {
    setup();
    const bodies = fuehrungsstelleMitschnitt();
    const user = userEvent.setup();
    const p = await paneel();
    await user.click(await p.findByRole('button', { name: 'Fahrzeuge eintragen' }));
    await user.click(p.getByRole('combobox', { name: 'Fahrzeuge' }));
    await user.click(await screen.findByText('Florian Musterstadt 10/1 (ELW 2)'));
    await user.click(p.getByRole('button', { name: 'Fahrzeuge speichern' }));
    await waitFor(() => expect(bodies).toEqual([{ fahrzeug_ids: [41] }]));
    expect(
      await p.findByRole('button', { name: 'Fahrzeuge bearbeiten' }),
    ).toHaveAccessibleDescription('Florian Musterstadt 10/1 (ELW 2)');
  });

  it('Fahrzeuge: ein entlassenes Fahrzeug fällt still weg', async () => {
    setup();
    fuehrungsstelleMitschnitt({ sprechgruppen: [], fahrzeug_ids: [42, 999] });
    const p = await paneel();
    expect(
      await p.findByRole('button', { name: 'Fahrzeuge bearbeiten' }),
    ).toHaveAccessibleDescription('Florian Musterstadt 19/1 (MTW)');
  });

  it('Fahrzeuge: ohne Freigabe gesperrt mit Grund, die übrigen Angaben bleiben bedienbar', async () => {
    setup();
    server.use(
      http.get('/api/einsaetze/7/modul-freigaben', () =>
        HttpResponse.json(freigabenFixture({ fahrzeuge: { zugriff: false } })),
      ),
    );
    fuehrungsstelleMitschnitt({ sprechgruppen: [], fahrzeug_ids: [41] });
    const p = await paneel();
    expect(await p.findByText('nicht freigegeben')).toBeInTheDocument();
    expect(p.queryByRole('button', { name: /^Fahrzeuge / })).toBeNull();
    expect(p.getByRole('button', { name: 'Rufname eintragen' })).toBeInTheDocument();
  });

  it('Kommunikationsmittel: Schlüssel hinaus, Label in der Anzeige', async () => {
    setup();
    const bodies = fuehrungsstelleMitschnitt();
    const user = userEvent.setup();
    const p = await paneel();
    await user.click(await p.findByRole('button', { name: 'Kommunikationsmittel eintragen' }));
    await user.click(p.getByRole('combobox', { name: 'Kommunikationsmittel' }));
    await user.click(await screen.findByText('Digitalfunk'));
    await user.click(p.getByRole('button', { name: 'Kommunikationsmittel speichern' }));
    await waitFor(() => expect(bodies).toEqual([{ kommunikationsmittel: 'digitalfunk' }]));
    expect(
      await p.findByRole('button', { name: 'Kommunikationsmittel bearbeiten' }),
    ).toHaveAccessibleDescription('Digitalfunk');
  });

  it('Erreichbarkeit: unverändert sendet nichts, geleert sendet null', async () => {
    setup();
    const bodies = fuehrungsstelleMitschnitt({
      sprechgruppen: [],
      fahrzeug_ids: [],
      erreichbarkeit: '0171 1234567',
    });
    const user = userEvent.setup();
    const p = await paneel();
    await user.click(await p.findByRole('button', { name: 'Erreichbarkeit bearbeiten' }));
    await user.keyboard('{Enter}');
    expect(await p.findByRole('button', { name: 'Erreichbarkeit bearbeiten' })).toBeVisible();
    expect(bodies).toEqual([]);

    await user.click(p.getByRole('button', { name: 'Erreichbarkeit bearbeiten' }));
    await user.clear(p.getByRole('textbox', { name: 'Erreichbarkeit' }));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(bodies).toEqual([{ erreichbarkeit: null }]));
    expect(await p.findByRole('button', { name: 'Erreichbarkeit eintragen' })).toBeVisible();
  });

  it('Beobachter: Angaben ohne Aufforderung, leer als „—“', async () => {
    setup({
      einsatz: { meine_rolle: 'beobachter' },
      benutzer: { ...admin, system_rolle: 'keiner' },
    });
    fuehrungsstelleMitschnitt({ sprechgruppen: [], fahrzeug_ids: [], rufname: 'Florian 10/1' });
    const p = await paneel();
    expect(await p.findByText('Florian 10/1')).toBeInTheDocument();
    expect(p.queryByRole('button', { name: /eintragen|bearbeiten/ })).toBeNull();
    // Die Zeile „Fahrzeuge“ wartet auf die Modulfreigaben; erst danach steht dort „—“.
    await waitFor(() => expect(p.getAllByText('—')).toHaveLength(4));
  });

  it('Speicherfehler steht an der Zeile, die Eingabe bleibt offen', async () => {
    setup();
    server.use(
      http.patch('/api/einsaetze/7/fuehrungsstelle', () =>
        HttpResponse.json({ error: 'Einsatz ist abgeschlossen' }, { status: 409 }),
      ),
    );
    const user = userEvent.setup();
    const p = await paneel();
    await user.click(await p.findByRole('button', { name: 'Rufname eintragen' }));
    await user.type(p.getByRole('textbox', { name: 'Rufname' }), 'X{Enter}');
    const fehler = await p.findByText('Einsatz ist abgeschlossen');
    expect(fehler.closest('.ant-message')).toBeNull();
    expect(p.getByRole('textbox', { name: 'Rufname' })).toHaveValue('X');
  });
});

/**
 * Der Einsatzabschluss steht auf den Einsatzdaten, nicht im Kopf einer Arbeitsseite (LFH-960,
 * Spec `bedien-wortlaut`): ein eigener letzter Abschnitt, nur für die Einsatzleitung eines aktiven
 * Einsatzes, und die Rückfrage bestätigt mit der Handlung.
 */
describe('EinsatzdatenPage · Einsatzabschluss (LFH-960)', () => {
  const leitung = { ...admin, system_rolle: 'keiner' as const };

  it('fragt mit „Einsatz endgültig abschließen“ nach und schließt erst nach Bestätigung ab', async () => {
    let abgeschlossen = false;
    setup({ benutzer: leitung, einsatz: { meine_rolle: 'einsatzleitung' } });
    server.use(
      http.post('/api/einsaetze/7/abschliessen', () => {
        abgeschlossen = true;
        return HttpResponse.json({ ...basisEinsatz, status: 'abgeschlossen' });
      }),
    );
    const user = userEvent.setup();

    expect(await screen.findByRole('heading', { name: 'Einsatzabschluss' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Einsatz abschließen' }));
    expect(await screen.findByText('Einsatz abschließen?')).toBeInTheDocument();
    const ok = screen.getByRole('button', { name: 'Einsatz endgültig abschließen' });
    expect(ok).toHaveClass('ant-btn-dangerous');
    expect(screen.queryByRole('button', { name: 'Ja' })).not.toBeInTheDocument();
    expect(abgeschlossen).toBe(false);

    await user.click(ok);
    await waitFor(() => expect(abgeschlossen).toBe(true));
  });

  it('steht nicht im Seitenkopf', async () => {
    const { container } = setup({ benutzer: leitung, einsatz: { meine_rolle: 'einsatzleitung' } });
    await screen.findByRole('button', { name: 'Einsatz abschließen' });
    const kopf = container.querySelector('[data-lfh="seitenkopf-aktionen"]') as HTMLElement;
    expect(kopf).not.toBeNull();
    expect(within(kopf).queryByRole('button', { name: 'Einsatz abschließen' })).toBeNull();
  });

  it.each(['fuehrungspersonal', 'beobachter'] as const)('fehlt für %s', async (meine_rolle) => {
    setup({ benutzer: leitung, einsatz: { meine_rolle } });
    await screen.findByText('Realeinsatz');
    expect(screen.queryByRole('heading', { name: 'Einsatzabschluss' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Einsatz abschließen' })).toBeNull();
  });

  it('fehlt bei einem abgeschlossenen Einsatz', async () => {
    setup({ einsatz: { status: 'abgeschlossen', abgeschlossen_at: '2026-05-24 10:00:00' } });
    await screen.findByText('Realeinsatz');
    expect(screen.queryByRole('button', { name: 'Einsatz abschließen' })).toBeNull();
  });

  const abschlussPaneel = async () =>
    within(await screen.findByRole('region', { name: 'Einsatzabschluss' }));

  async function schliesseAb(user: ReturnType<typeof userEvent.setup>) {
    await user.click(
      (await abschlussPaneel()).getByRole('button', { name: 'Einsatz abschließen' }),
    );
    await user.click(await screen.findByRole('button', { name: 'Einsatz endgültig abschließen' }));
  }

  // LFH-1077: der Grund steht am Paneel, nicht im Toast.
  it('zeigt eine Ablehnung am Paneel „Einsatzabschluss“, ohne Toast', async () => {
    setup({ benutzer: leitung, einsatz: { meine_rolle: 'einsatzleitung' } });
    server.use(
      http.post('/api/einsaetze/7/abschliessen', () =>
        HttpResponse.json({ error: 'Offene Aufträge vorhanden' }, { status: 409 }),
      ),
    );
    const user = userEvent.setup();
    await schliesseAb(user);

    const grund = await (await abschlussPaneel()).findByRole('alert');
    expect(grund).toHaveTextContent('Nicht abgeschlossen');
    expect(grund).toHaveTextContent('Offene Aufträge vorhanden');
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it('räumt den Grund beim nächsten Abschließen', async () => {
    let aufrufe = 0;
    setup({ benutzer: leitung, einsatz: { meine_rolle: 'einsatzleitung' } });
    server.use(
      http.post('/api/einsaetze/7/abschliessen', async () => {
        aufrufe += 1;
        if (aufrufe === 1)
          return HttpResponse.json({ error: 'Offene Aufträge vorhanden' }, { status: 409 });
        return new Promise<never>(() => {});
      }),
    );
    const user = userEvent.setup();
    await schliesseAb(user);
    await (await abschlussPaneel()).findByText('Offene Aufträge vorhanden');

    await schliesseAb(user);
    await waitFor(() => expect(aufrufe).toBe(2));
    expect((await abschlussPaneel()).queryByRole('alert')).toBeNull();
  });

  it('meldet eine Ablehnung aus dem vorigen Einsatz nicht im neuen', async () => {
    let lehneAb: (() => void) | null = null;
    const leitungEinsatz = { ...basisEinsatz, meine_rolle: 'einsatzleitung' as const };
    server.use(
      meHandler(leitung),
      http.get('/api/einsaetze/:id', ({ params }) =>
        HttpResponse.json({ ...leitungEinsatz, id: Number(params.id) }),
      ),
      http.get('/api/einsaetze/:id/mitglieder', () => HttpResponse.json(mitglieder)),
      http.get('/api/einsaetze/:id/mitglieder/auswahl', () => HttpResponse.json([])),
      http.get('/api/stichwort-vorschlaege', () => HttpResponse.json(vorschlaege)),
      http.get('/api/einsaetze/:id/ort-vorschau', () =>
        HttpResponse.json({ peilung: null, ortsname: null }),
      ),
      http.get('/api/einsaetze/:id/fuehrungsstelle', () =>
        HttpResponse.json({ sprechgruppen: [], fahrzeug_ids: [] } satisfies Fuehrungsstelle),
      ),
      http.get('/api/einsaetze/:id/sprechgruppen', () => HttpResponse.json(sprechgruppenListe)),
      http.post(
        '/api/einsaetze/7/abschliessen',
        () =>
          new Promise<Response>((r) => {
            lehneAb = () =>
              r(HttpResponse.json({ error: 'Offene Aufträge vorhanden' }, { status: 409 }));
          }),
      ),
    );
    function ZuEinsatz8() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate('/einsaetze/8/einsatzdaten')}>
          Zu Einsatz 8
        </button>
      );
    }
    const client = neuerQueryClient();
    // Einsatz 8 liegt schon im Cache: die Seite wechselt ohne Ladeansicht, das Paneel bleibt stehen.
    client.setQueryDefaults(einsatzKeys.einsatz(8), { gcTime: Infinity, staleTime: Infinity });
    client.setQueryData(einsatzKeys.einsatz(8), { ...leitungEinsatz, id: 8 });
    renderMitProviders(
      <>
        <ZuEinsatz8 />
        <Routes>
          <Route path="/einsaetze/:id/einsatzdaten" element={<EinsatzdatenPage />} />
        </Routes>
      </>,
      { route: '/einsaetze/7/einsatzdaten', client },
    );
    const user = userEvent.setup();
    await schliesseAb(user);
    // Erst wechseln, wenn die Anfrage des vorigen Einsatzes beim Server liegt.
    await waitFor(() => expect(lehneAb).not.toBeNull());
    await user.click(screen.getByRole('button', { name: 'Zu Einsatz 8' }));
    const paneel8 = await abschlussPaneel();
    act(() => lehneAb?.());
    // Erst prüfen, wenn die Ablehnung angekommen ist und die Beobachter sie gesehen haben.
    await waitFor(() => expect(client.getMutationCache().getAll()[0]?.state.status).toBe('error'));
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(paneel8.queryByRole('alert')).toBeNull();
    expect((await abschlussPaneel()).queryByRole('alert')).toBeNull();
  });
});
