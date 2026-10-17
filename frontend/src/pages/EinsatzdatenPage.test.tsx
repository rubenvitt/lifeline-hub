import { http, HttpResponse } from 'msw';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Route, Routes, useNavigate } from 'react-router';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { meHandler, server } from '../test/server';
import { neuerQueryClient, renderMitProviders } from '../test/utils';
import { einsatzKeys } from '../api/queryKeys';
import type {
  ExterneStelle,
  BenutzerAnzeige,
  EinsatzAnzeige,
  EinsatzFahrzeug,
  Einsatzleiter,
  EinsatzPersonal,
  Fahrzeug,
  Fuehrungsstelle,
  FuehrungsstellePatch,
  Sprechgruppe,
} from '../api/types';
import EinsatzdatenPage, { gleicherZeitpunkt } from './EinsatzdatenPage';
import { alsZeitpunkt } from '../anzeige/zeitEingabe';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
import { mitProzessZone } from '../test/prozessZone';
import { setzeViewportBreite } from '../test/viewport';
import { tippeZeit } from '../test/zeitEingabe';
import { adminFixture, einsatzFixture, freigabenFixture } from '../test/fixtures';

dayjs.extend(utc);

const MONATE = ['jan', 'feb', 'mrz', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dez'];
/** Erwartete Anzeige im Zeitfeld: volle DTG in der Browserzone („141200jul26“). */
const dtgLokal = (d: dayjs.Dayjs) => `${d.format('DDHHmm')}${MONATE[d.month()]}${d.format('YY')}`;

// MapLibre läuft in jsdom nicht; der Ausschnitt hat eigene Tests (`anzeige/Kartenausschnitt.test.tsx`).
vi.mock('../anzeige/Kartenausschnitt', () => ({
  Kartenausschnitt: ({ punkt }: { punkt: { lat: number; lon: number } | null }) => (
    <div data-testid="kartenausschnitt">
      {punkt ? `Karte ${punkt.lat}, ${punkt.lon}` : 'Nicht verortet'}
    </div>
  ),
}));

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

const personalListe = [
  { id: 3, name: 'Anna Schulz', funktion: 'Zugführerin' },
  { id: 4, name: 'Bernd Berg', funktion: null },
] as unknown as EinsatzPersonal[];

const anna: Einsatzleiter = {
  art: 'personal',
  name: 'Anna Schulz',
  personal_id: 3,
  personal_noch_disponiert: true,
  seit: '2026-10-11 12:30:00',
};

const vorschlaege = [
  { id: 1, text: 'H1' },
  { id: 2, text: 'MANV' },
];

/** Katalog „Externe Stellen“ (LFH-1194); die Seite fragt nur die aktiven ab. */
const externeStellen: ExterneStelle[] = [
  { id: 1, bezeichnung: 'ILS Musterkreis', art: 'leitstelle', aktiv: true, zustaendig: true },
  { id: 2, bezeichnung: 'Polizei Musterstadt', art: 'polizei', aktiv: true, zustaendig: false },
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

/** Fahrzeuge der Organisation im Dienst; 41 ist disponiert (`fahrzeug_id` fehlt dort: ad hoc). */
const stammFahrzeuge = [
  {
    id: 501,
    funkrufname: 'Kater Musterstadt 1',
    fahrzeugtyp: 'KdoW',
    angelegt_at: '2026-01-01T00:00:00',
    dienststatus: 'in_dienst',
    ist_demo: false,
    sondersignal: true,
  },
  {
    id: 502,
    funkrufname: 'Demo ELW 1',
    fahrzeugtyp: 'ELW 1',
    angelegt_at: '2026-01-01T00:00:00',
    dienststatus: 'in_dienst',
    ist_demo: true,
    sondersignal: true,
  },
  {
    id: 503,
    funkrufname: 'Florian Musterstadt 44/1',
    fahrzeugtyp: 'HLF 20',
    angelegt_at: '2026-01-01T00:00:00',
    dienststatus: 'in_dienst',
    ist_demo: false,
    sondersignal: true,
  },
] satisfies Fahrzeug[];

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
    http.get('/api/externe-stellen', () => HttpResponse.json(externeStellen)),
    http.get('/api/einsaetze/:id/ort-vorschau', () =>
      HttpResponse.json({ peilung: null, ortsname: null }),
    ),
    http.get('/api/einsaetze/7/fuehrungsstelle', () =>
      HttpResponse.json({
        art: 'mobil',
        sprechgruppen: [],
        fahrzeug_ids: [],
      } satisfies Fuehrungsstelle),
    ),
    http.get('/api/einsaetze/7/sprechgruppen', () => HttpResponse.json(sprechgruppenListe)),
    http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json(fahrzeugListe)),
    http.get('/api/einsaetze/7/personal', () => HttpResponse.json(personalListe)),
    http.get('/api/fahrzeuge', () => HttpResponse.json(stammFahrzeuge)),
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
  // LLH-1111: den Termin der Lagebesprechung pflegt nur noch die Seite Lagebesprechung
  // (`PUT …/lagebesprechung/termin`); der Kopf-PATCH lehnt das Feld ab.
  it('zeigt keinen Besprechungstermin mehr, auch wenn der Einsatzkopf einen trägt (LLH-1111)', async () => {
    setup({ einsatz: { naechste_lagebesprechung_at: '2026-09-09 13:17:43' } });
    // Positiv zuerst: das Paneel steht mit seinen Angaben — sonst wäre die Abwesenheit trivial.
    const einsatz = within(await screen.findByRole('region', { name: 'Einsatz' }));
    expect(einsatz.getByText('Angelegt')).toBeInTheDocument();
    expect(screen.queryByText('Nächste Lagebesprechung')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Nächste Lagebesprechung/ })).toBeNull();
  });

  it('zeigt Kopfdaten im Lesemodus; eine leere lesende Angabe als —', async () => {
    setup({ einsatz: { einsatznummer_intern: null } });
    expect(await screen.findByText('Realeinsatz')).toBeInTheDocument();
    // Eine Mitgliederliste gibt es hier nicht mehr (LFH-1170).
    expect(screen.queryByText('Frank Führung')).toBeNull();
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
      Einsatz: ['Bezeichnung', 'Einsatzart', 'Einsatznummer', 'Leitstellen-Nr.', 'Angelegt'],
      Einsatzort: ['Adresse', 'Koordinate'],
      Erstmeldung: ['Meldende Stelle', 'Sachverhalt / Meldebild', 'Anzahl Betroffene (initial)'],
    };
    for (const [name, etiketten] of Object.entries(paneele)) {
      const paneel = await screen.findByRole('region', { name });
      const dts = [...paneel.querySelectorAll('dt')].map((dt) => dt.textContent);
      expect(dts, name).toEqual(etiketten);
    }
    // Die Kopfleiste trägt Stichwort, Alarmzeit, Einsatzort, Einsatzleitung — und kein Paneel
    // wiederholt sie. Die Angaben des Einsatzes stehen je genau einmal; „Bezeichnung“ im Paneel
    // „Eigene Führungsstelle“ ist die der Führungsstelle (LFH-1181), eine andere Angabe.
    const alle = [...document.querySelectorAll('dt')].map((dt) => dt.textContent);
    for (const kopf of ['Einsatzstichwort', 'Alarmzeit', 'Einsatzort', 'Einsatzleitung']) {
      expect(alle).not.toContain(kopf);
    }
    const einsatzAngaben = Object.keys(paneele).flatMap((name) =>
      [...screen.getByRole('region', { name }).querySelectorAll('dt')].map((dt) => dt.textContent),
    );
    expect(einsatzAngaben.length).toBeGreaterThan(0);
    expect(new Set(einsatzAngaben).size).toBe(einsatzAngaben.length);
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

  it('Meldende Stelle schlägt den Katalog nach Art gruppiert vor und sendet genau den Text', async () => {
    setup();
    const bodies = patchMitschnitt();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Meldende Stelle eintragen' }));
    const feld = screen.getByRole('combobox', { name: 'Meldende Stelle' });
    expect(feld).toHaveAttribute('maxlength', '200');
    await user.type(feld, 'mus');
    // Gruppen „Leitstelle“ und „Polizei“; die zuständige Leitstelle trägt das Wort.
    const zustaendig = await screen.findByTitle('ILS Musterkreis · zuständig');
    expect(screen.getByTitle('Polizei Musterstadt')).toBeInTheDocument();
    const gruppen = [...document.querySelectorAll('.ant-select-item-group')].map(
      (g) => g.textContent,
    );
    expect(gruppen).toEqual(['Leitstelle', 'Polizei']);
    await user.click(zustaendig);
    expect(feld).toHaveValue('ILS Musterkreis');
    await user.click(screen.getByRole('button', { name: 'Meldende Stelle speichern' }));
    await waitFor(() => expect(bodies).toEqual([{ meldende_stelle: 'ILS Musterkreis' }]));
  });

  it('Meldende Stelle nimmt weiter Freitext', async () => {
    setup();
    const bodies = patchMitschnitt();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Meldende Stelle eintragen' }));
    await user.type(
      screen.getByRole('combobox', { name: 'Meldende Stelle' }),
      'Polizei vor Ort, Streife 12/3',
    );
    await user.click(screen.getByRole('button', { name: 'Meldende Stelle speichern' }));
    await waitFor(() =>
      expect(bodies).toEqual([{ meldende_stelle: 'Polizei vor Ort, Streife 12/3' }]),
    );
  });

  it('leeren einer optionalen Angabe sendet null', async () => {
    setup({ einsatz: { einsatzort: 'Deich Süd' } });
    const bodies = patchMitschnitt({ einsatzort: 'Deich Süd' });
    const user = userEvent.setup();
    // Der Einsatzort wird im Paneel „Einsatzort“ bearbeitet (LFH-1175); Enter sucht dort, gespeichert
    // wird über den Knopf.
    await user.click(await screen.findByRole('button', { name: 'Adresse bearbeiten' }));
    await user.clear(screen.getByRole('textbox', { name: 'Adresse' }));
    await user.click(screen.getByRole('button', { name: 'Adresse speichern' }));
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
    // Feld leeren und Enter: Enter übernimmt das leere Feld und sendet die Zeile ab.
    await tippeZeit(user, screen.getByRole('textbox', { name: 'Alarmzeit' }), '');

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
      dtgLokal(dayjs.utc(basisEinsatz.begonnen_at).local()),
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
      // Enter übernimmt die Eingabe ins Feld (ohne natives Absenden, `fireEvent`); der Knopf sendet.
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
    const kalenderKnopf = screen.getByRole('button', { name: 'Kalender und Uhrzeit' });
    await user.click(kalenderKnopf);
    // Der Kalender nimmt beim Öffnen den Fokus (Uhrzeitfeld); dort landet das erste Escape.
    await screen.findByRole('dialog', { name: 'Tag und Uhrzeit wählen' });
    await user.keyboard('{Escape}');
    // Die Zeile steht noch, nur der Kalender ist zu. Ob er aus dem DOM ist, zeigt jsdom nicht: es
    // beendet die Schließ-Animation nie; der Knopf meldet den Zustand.
    expect(kalenderKnopf).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('textbox', { name: 'Alarmzeit' })).toBeInTheDocument();
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
    await user.type(screen.getByRole('combobox', { name: 'Meldende Stelle' }), 'ILS{Enter}');
    expect(await screen.findByText('Einsatz ist abgeschlossen')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Meldende Stelle' })).toHaveValue('ILS');
    expect(document.querySelector('.ant-message-error')).toBeNull();
  });

  it('Kopfleiste leitet die Einsatzleitung nicht aus der App-Rolle ab (LFH-1199)', async () => {
    // „Admin" trägt die Einsatzrolle `einsatzleitung`, ein Einsatzleiter ist nicht erfasst.
    setup();
    const zelle = await screen.findByRole('group', { name: 'Einsatzleitung' });
    expect(await within(zelle).findByText('nicht erfasst')).toBeInTheDocument();
    expect(within(zelle).queryByText('Admin')).toBeNull();
    expect(within(zelle).queryByRole('button')).toBeNull();
  });

  it('Einsatzort in der Kopfleiste, Einsatzleitung, Einsatznummer und „Angelegt“ tragen keine Aufforderung', async () => {
    setup({
      einsatz: { einsatzort: 'Deich Süd', einsatzort_lat: 48.1234, einsatzort_lon: 11.5678 },
    });
    await screen.findByRole('region', { name: 'Einsatz' });
    for (const angabe of ['Einsatzort', 'Einsatzleitung', 'Einsatznummer', 'Angelegt']) {
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
    // Seit LFH-1194 eine Auswahl mit Vorschlägen aus dem Katalog „Externe Stellen“.
    await user.type(screen.getByRole('combobox', { name: 'Meldende Stelle' }), 'ILS Nord{Enter}');
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
 * Bezeichnung und Koordinate als Zeile (LFH-1170): bis dahin nur im Vollformular änderbar. Setzen
 * und Leeren der Koordinate belegt das Paneel „Einsatzort“ (LFH-1175) weiter unten.
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

  it('zeigt eine fremd gesetzte Angabe nach dem Ereignis ohne Neuladen der Seite', async () => {
    const { client, fremdAendern, abrufe } = setupMitFremdAenderung();
    expect(
      await screen.findByRole('button', { name: 'Leitstellen-Nr. eintragen' }),
    ).toBeInTheDocument();
    const vorher = abrufe();
    fremdAendern({ leitstellen_nr: 'LS-9' });
    await act(() => client.invalidateQueries({ queryKey: ['einsatz', 7] }));
    await waitFor(() => expect(abrufe()).toBeGreaterThan(vorher));
    expect(
      await screen.findByRole('button', { name: 'Leitstellen-Nr. bearbeiten' }),
    ).toHaveAccessibleDescription('LS-9');
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
    expect(feld).toHaveValue('141200jul26');
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
 * Eigene Führungsstelle (LFH-849, Spec `einsatz-fuehrungsstelle`): ein Paneel mit Art und sieben
 * Angaben (LFH-1181), jede schickt nur ihr Feld an `…/fuehrungsstelle`.
 */
describe('EinsatzdatenPage · Eigene Führungsstelle (LFH-849)', () => {
  /** Nimmt jeden PATCH-Body auf und legt ihn wie der Server über den Stand. */
  function fuehrungsstelleMitschnitt(
    start: Fuehrungsstelle = { art: 'mobil', sprechgruppen: [], fahrzeug_ids: [] },
  ) {
    const bodies: FuehrungsstellePatch[] = [];
    let stand: Fuehrungsstelle = start;
    server.use(
      http.get('/api/einsaetze/7/fuehrungsstelle', () => HttpResponse.json(stand)),
      http.patch('/api/einsaetze/7/fuehrungsstelle', async ({ request }) => {
        const body = (await request.json()) as FuehrungsstellePatch;
        bodies.push(body);
        const { sprechgruppe_ids, fahrzeug_ids, einsatzleiter, ...felder } = body;
        // Wie der Server: `null` leert, ein Wert ersetzt (die Art ist nie `null`).
        const naechster = { ...stand } as Record<string, unknown>;
        if (einsatzleiter === null) delete naechster.einsatzleiter;
        else if (einsatzleiter) {
          naechster.einsatzleiter = {
            art: einsatzleiter.art,
            name:
              einsatzleiter.art === 'personal'
                ? personalListe.find((x) => x.id === einsatzleiter.personal_id)!.name
                : einsatzleiter.name,
            ...(einsatzleiter.art === 'personal' ? { personal_id: einsatzleiter.personal_id } : {}),
            personal_noch_disponiert: einsatzleiter.art === 'personal',
            seit: einsatzleiter.seit ?? '2026-10-11 12:00:00',
          };
        }
        for (const [k, v] of Object.entries(felder)) {
          if (v == null) delete naechster[k];
          else naechster[k] = v;
        }
        if (fahrzeug_ids) naechster.fahrzeug_ids = [...fahrzeug_ids].sort((a, b) => a - b);
        if (sprechgruppe_ids) {
          naechster.sprechgruppen = sprechgruppenListe.filter((g) =>
            sprechgruppe_ids.includes(g.id),
          );
        }
        stand = naechster as unknown as Fuehrungsstelle;
        return HttpResponse.json(stand);
      }),
    );
    return bodies;
  }

  async function paneel() {
    return within(await screen.findByRole('region', { name: 'Eigene Führungsstelle' }));
  }

  it('zeigt Art und acht Angaben; leer mit Aufforderung (LFH-1181, LFH-1199)', async () => {
    setup();
    fuehrungsstelleMitschnitt();
    const p = await paneel();
    const art = await p.findByRole('radiogroup', { name: 'Art' });
    expect(within(art).getByRole('radio', { name: 'mobil' })).toBeChecked();
    for (const etikett of [
      'Einsatzleiter',
      'Bezeichnung',
      'Standort',
      'Rufname',
      'Sprechgruppen',
      'Kommunikationsmittel',
      'Erreichbarkeit',
      'Führungsfahrzeuge',
    ]) {
      expect(await p.findByRole('button', { name: `${etikett} eintragen` })).toBeInTheDocument();
    }
  });

  it('Art wählen: nur die Art geht hinaus (LFH-1181)', async () => {
    setup();
    const bodies = fuehrungsstelleMitschnitt();
    const user = userEvent.setup();
    const p = await paneel();
    await user.click(await p.findByRole('radio', { name: 'ortsfest' }));
    await waitFor(() => expect(bodies).toEqual([{ art: 'ortsfest' }]));
    await waitFor(() => expect(p.getByRole('radio', { name: 'ortsfest' })).toBeChecked());
  });

  it('Bezeichnung: nur dieses Feld geht hinaus (LFH-1181)', async () => {
    setup();
    const bodies = fuehrungsstelleMitschnitt();
    const user = userEvent.setup();
    const p = await paneel();
    await user.click(await p.findByRole('button', { name: 'Bezeichnung eintragen' }));
    await user.type(p.getByRole('textbox', { name: 'Bezeichnung' }), 'ELW 2 Musterstadt{Enter}');
    await waitFor(() => expect(bodies).toEqual([{ bezeichnung: 'ELW 2 Musterstadt' }]));
    expect(
      await p.findByRole('button', { name: 'Bezeichnung bearbeiten' }),
    ).toHaveAccessibleDescription('ELW 2 Musterstadt');
  });

  it('Standort „wie Einsatzort“: Adresse und Koordinate gehen einmalig hinaus (LFH-1181)', async () => {
    setup({
      einsatz: {
        einsatzort: 'Industriestraße 4',
        einsatzort_lat: 48.1234,
        einsatzort_lon: 11.5678,
      },
    });
    const bodies = fuehrungsstelleMitschnitt();
    const user = userEvent.setup();
    const p = await paneel();
    await user.click(await p.findByRole('button', { name: 'Standort eintragen' }));
    await user.click(p.getByRole('button', { name: 'wie Einsatzort' }));
    expect(p.getByRole('textbox', { name: 'Adresse des Standorts' })).toHaveValue(
      'Industriestraße 4',
    );
    await user.click(p.getByRole('button', { name: 'Standort speichern' }));
    await waitFor(() =>
      expect(bodies).toEqual([
        { standort_adresse: 'Industriestraße 4', standort_lat: 48.1234, standort_lon: 11.5678 },
      ]),
    );
    expect(
      await p.findByRole('button', { name: 'Standort bearbeiten' }),
    ).toHaveAccessibleDescription(/Industriestraße 4/);
  });

  it('Standort: ohne Einsatzort kein „wie Einsatzort“, Adresse allein geht hinaus (LFH-1181)', async () => {
    setup();
    const bodies = fuehrungsstelleMitschnitt();
    const user = userEvent.setup();
    const p = await paneel();
    await user.click(await p.findByRole('button', { name: 'Standort eintragen' }));
    expect(p.queryByRole('button', { name: 'wie Einsatzort' })).toBeNull();
    await user.type(
      p.getByRole('textbox', { name: 'Adresse des Standorts' }),
      'Rathaus, Marktplatz 1',
    );
    await user.click(p.getByRole('button', { name: 'Standort speichern' }));
    await waitFor(() =>
      expect(bodies).toEqual([
        { standort_adresse: 'Rathaus, Marktplatz 1', standort_lat: null, standort_lon: null },
      ]),
    );
  });

  it('Standort: eine unlesbare Koordinate steht als Fehler an der Zeile, nichts geht hinaus (LFH-1181)', async () => {
    setup();
    const bodies = fuehrungsstelleMitschnitt();
    const user = userEvent.setup();
    const p = await paneel();
    await user.click(await p.findByRole('button', { name: 'Standort eintragen' }));
    await user.type(p.getByRole('textbox', { name: 'Koordinate' }), 'abc');
    await user.click(p.getByRole('button', { name: 'Standort speichern' }));
    // Den Grund nennt die Koordinateneingabe am Feld, die Zeile meldet „Nicht gespeichert“.
    expect(await p.findByText(/Ungültige Koordinate/)).toBeInTheDocument();
    expect(await p.findByText('Nicht gespeichert')).toBeInTheDocument();
    expect(bodies).toEqual([]);
  });

  it('Standort „wie Einsatzort“ ohne Koordinate am Einsatzort leert auch die Koordinate (LFH-1181)', async () => {
    setup({
      einsatz: { einsatzort: 'Industriestraße 4', einsatzort_lat: null, einsatzort_lon: null },
    });
    const bodies = fuehrungsstelleMitschnitt({
      art: 'mobil',
      sprechgruppen: [],
      fahrzeug_ids: [],
      standort_lat: 52.1,
      standort_lon: 9.9,
    });
    const user = userEvent.setup();
    const p = await paneel();
    await user.click(await p.findByRole('button', { name: 'Standort bearbeiten' }));
    await user.click(p.getByRole('button', { name: 'wie Einsatzort' }));
    await user.click(p.getByRole('button', { name: 'Standort speichern' }));
    await waitFor(() =>
      expect(bodies).toEqual([
        { standort_adresse: 'Industriestraße 4', standort_lat: null, standort_lon: null },
      ]),
    );
  });

  it('Art: zwei schnelle Wechsel, es gilt der letzte (LFH-1181)', async () => {
    setup();
    const bodies = fuehrungsstelleMitschnitt();
    const user = userEvent.setup();
    const p = await paneel();
    await user.click(await p.findByRole('radio', { name: 'ortsfest' }));
    await user.click(p.getByRole('radio', { name: 'mobil' }));
    await waitFor(() => expect(bodies).toEqual([{ art: 'ortsfest' }, { art: 'mobil' }]));
    await waitFor(() => expect(p.getByRole('radio', { name: 'mobil' })).toBeChecked());
  });

  it('Ortsfest: Führungsfahrzeuge eingeklappt mit Anzahl, aufklappbar (LFH-1181)', async () => {
    setup();
    fuehrungsstelleMitschnitt({ art: 'ortsfest', sprechgruppen: [], fahrzeug_ids: [41] });
    const user = userEvent.setup();
    const p = await paneel();
    const kopf = await p.findByRole('button', { name: /1 Führungsfahrzeug/ });
    expect(p.queryByRole('button', { name: 'Führungsfahrzeuge bearbeiten' })).toBeNull();
    await user.click(kopf);
    expect(
      await p.findByRole('button', { name: 'Führungsfahrzeuge bearbeiten' }),
    ).toHaveAccessibleDescription('Florian Musterstadt 10/1 (ELW 2)');
  });

  it('Ortsfest ohne Fahrzeug: eingeklappt, keine Angabe verlangt (LFH-1181)', async () => {
    setup();
    fuehrungsstelleMitschnitt({ art: 'ortsfest', sprechgruppen: [], fahrzeug_ids: [] });
    const p = await paneel();
    expect(await p.findByRole('button', { name: /kein Führungsfahrzeug/ })).toBeInTheDocument();
    expect(p.queryByRole('button', { name: 'Führungsfahrzeuge eintragen' })).toBeNull();
  });

  it('Rufname: nur dieses Feld geht hinaus, die Zeile zeigt den Wert', async () => {
    setup();
    const bodies = fuehrungsstelleMitschnitt();
    const user = userEvent.setup();
    const p = await paneel();
    await user.click(await p.findByRole('button', { name: 'Rufname eintragen' }));
    await user.type(
      p.getByRole('combobox', { name: 'Rufname' }),
      'Florian Musterstadt 10/1{Enter}',
    );
    await waitFor(() => expect(bodies).toEqual([{ rufname: 'Florian Musterstadt 10/1' }]));
    expect(
      await p.findByRole('button', { name: 'Rufname bearbeiten' }),
    ).toHaveAccessibleDescription('Florian Musterstadt 10/1');
  });

  /** Gruppen der offenen Vorschlagsliste mit ihren Funkrufnamen, in Anzeigefolge. */
  function vorschlagsliste(): string[] {
    const liste = document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)');
    if (!liste) return [];
    return [...liste.querySelectorAll('.ant-select-item')].map((el) =>
      el.classList.contains('ant-select-item-group')
        ? `# ${el.textContent}`
        : (el.getAttribute('title') ?? el.textContent ?? ''),
    );
  }

  it('Rufname: Vorschläge aus den Führungsfahrzeugen, gruppiert, Demo-Daten zuletzt (LFH-1187)', async () => {
    setup();
    fuehrungsstelleMitschnitt({ art: 'mobil', sprechgruppen: [], fahrzeug_ids: [42] });
    const user = userEvent.setup();
    const p = await paneel();
    await user.click(await p.findByRole('button', { name: 'Rufname eintragen' }));
    await user.click(p.getByRole('combobox', { name: 'Rufname' }));
    await waitFor(() =>
      expect(vorschlagsliste()).toEqual([
        '# Fahrzeuge der Führungsstelle',
        'Florian Musterstadt 19/1MTW',
        '# Disponierte Führungsfahrzeuge',
        'Florian Musterstadt 10/1ELW 2',
        '# Führungsfahrzeuge der Organisation',
        'Kater Musterstadt 1KdoW',
        '# Demo-Daten',
        'Demo ELW 1ELW 1Demo',
      ]),
    );
  });

  it('Rufname: Tippen filtert, die Wahl übernimmt den Funkrufnamen exakt (LFH-1187)', async () => {
    setup();
    const bodies = fuehrungsstelleMitschnitt();
    const user = userEvent.setup();
    const p = await paneel();
    await user.click(await p.findByRole('button', { name: 'Rufname eintragen' }));
    await user.type(p.getByRole('combobox', { name: 'Rufname' }), 'kater');
    await waitFor(() =>
      expect(vorschlagsliste()).toEqual([
        '# Führungsfahrzeuge der Organisation',
        'Kater Musterstadt 1KdoW',
      ]),
    );
    await user.click(screen.getByText('Kater Musterstadt 1'));
    expect(p.getByRole('combobox', { name: 'Rufname' })).toHaveValue('Kater Musterstadt 1');
    await user.click(p.getByRole('button', { name: 'Rufname speichern' }));
    await waitFor(() => expect(bodies).toEqual([{ rufname: 'Kater Musterstadt 1' }]));
  });

  it('Rufname: genau ein zugeordnetes Fahrzeug steht im Platzhalter, nicht im Wert (LFH-1187)', async () => {
    setup();
    const bodies = fuehrungsstelleMitschnitt({
      art: 'mobil',
      sprechgruppen: [],
      fahrzeug_ids: [41],
    });
    const user = userEvent.setup();
    const p = await paneel();
    await user.click(await p.findByRole('button', { name: 'Rufname eintragen' }));
    const feld = p.getByRole('combobox', { name: 'Rufname' });
    expect(feld).toHaveValue('');
    await waitFor(() =>
      expect(feld.closest('.ant-select')).toHaveTextContent('Florian Musterstadt 10/1'),
    );
    // Enter auf dem leeren Feld übernimmt den Platzhalter nicht: nichts geht hinaus.
    await user.keyboard('{Enter}');
    expect(await p.findByRole('button', { name: 'Rufname eintragen' })).toBeVisible();
    expect(bodies).toEqual([]);
  });

  /**
   * Enter, wie der Browser es schickt: rc-select liest `which`, das user-event in jsdom auf 0
   * lässt. Ohne `which` wäre der Fall unsichtbar.
   */
  const ENTER = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 };
  const PFEIL_RUNTER = { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40 };

  it('Rufname: Enter behält Freitext, der Anfang eines Vorschlags ist (LFH-1187)', async () => {
    setup();
    const bodies = fuehrungsstelleMitschnitt();
    const user = userEvent.setup();
    const p = await paneel();
    await user.click(await p.findByRole('button', { name: 'Rufname eintragen' }));
    const feld = p.getByRole('combobox', { name: 'Rufname' });
    await user.type(feld, 'Florian Musterstadt 10');
    await waitFor(() => expect(vorschlagsliste()).toContain('Florian Musterstadt 10/1ELW 2'));
    // `fireEvent` meldet `false`, wenn jemand `preventDefault` ruft — dann sendete das Formular nicht.
    expect(fireEvent.keyDown(feld, ENTER)).toBe(true);
    expect(feld).toHaveValue('Florian Musterstadt 10');
    await user.click(p.getByRole('button', { name: 'Rufname speichern' }));
    await waitFor(() => expect(bodies).toEqual([{ rufname: 'Florian Musterstadt 10' }]));
  });

  it('Rufname: Pfeil und Enter übernehmen den angesteuerten Vorschlag (LFH-1187)', async () => {
    setup();
    const bodies = fuehrungsstelleMitschnitt();
    const user = userEvent.setup();
    const p = await paneel();
    await user.click(await p.findByRole('button', { name: 'Rufname eintragen' }));
    const feld = p.getByRole('combobox', { name: 'Rufname' });
    await user.type(feld, 'kater');
    await waitFor(() => expect(vorschlagsliste()).toContain('Kater Musterstadt 1KdoW'));
    fireEvent.keyDown(feld, PFEIL_RUNTER);
    expect(fireEvent.keyDown(feld, ENTER)).toBe(false);
    expect(feld).toHaveValue('Kater Musterstadt 1');
    // Das Popup ist zu; das nächste Enter sendet.
    expect(fireEvent.keyDown(feld, ENTER)).toBe(true);
    await user.click(p.getByRole('button', { name: 'Rufname speichern' }));
    await waitFor(() => expect(bodies).toEqual([{ rufname: 'Kater Musterstadt 1' }]));
  });

  it('Rufname: Pfeil, dann Escape — das nächste Enter sendet den Text (LFH-1187)', async () => {
    setup();
    fuehrungsstelleMitschnitt();
    const user = userEvent.setup();
    const p = await paneel();
    await user.click(await p.findByRole('button', { name: 'Rufname eintragen' }));
    const feld = p.getByRole('combobox', { name: 'Rufname' });
    await user.type(feld, 'Kater');
    await waitFor(() => expect(vorschlagsliste()).toContain('Kater Musterstadt 1KdoW'));
    fireEvent.keyDown(feld, PFEIL_RUNTER);
    fireEvent.keyDown(feld, { key: 'Escape', code: 'Escape', keyCode: 27, which: 27 });
    await waitFor(() => expect(feld).toHaveAttribute('aria-expanded', 'false'));
    expect(fireEvent.keyDown(feld, ENTER)).toBe(true);
    expect(feld).toHaveValue('Kater');
  });

  it('Rufname: ohne Schreibrecht kein Abruf der Organisationsfahrzeuge (LFH-1187)', async () => {
    let abrufe = 0;
    setup({
      einsatz: { meine_rolle: 'beobachter' },
      benutzer: { ...admin, system_rolle: 'keiner' },
    });
    server.use(
      http.get('/api/fahrzeuge', () => {
        abrufe += 1;
        return HttpResponse.json(stammFahrzeuge);
      }),
    );
    fuehrungsstelleMitschnitt({
      art: 'mobil',
      sprechgruppen: [],
      fahrzeug_ids: [],
      rufname: 'Florian 10/1',
    });
    const p = await paneel();
    expect(await p.findByText('Florian 10/1')).toBeInTheDocument();
    expect(abrufe).toBe(0);
  });

  it('Rufname: ohne Freigabe der Fahrzeuge nur die Organisation, kein Fehler (LFH-1187)', async () => {
    setup();
    server.use(
      http.get('/api/einsaetze/7/modul-freigaben', () =>
        HttpResponse.json(freigabenFixture({ fahrzeuge: { zugriff: false } })),
      ),
    );
    fuehrungsstelleMitschnitt({ art: 'mobil', sprechgruppen: [], fahrzeug_ids: [41] });
    const user = userEvent.setup();
    const p = await paneel();
    await user.click(await p.findByRole('button', { name: 'Rufname eintragen' }));
    await user.click(p.getByRole('combobox', { name: 'Rufname' }));
    await waitFor(() =>
      expect(vorschlagsliste()).toEqual([
        '# Führungsfahrzeuge der Organisation',
        'Kater Musterstadt 1KdoW',
        '# Demo-Daten',
        'Demo ELW 1ELW 1Demo',
      ]),
    );
    expect(
      p.getByRole('combobox', { name: 'Rufname' }).closest('.ant-select'),
    ).not.toHaveTextContent('Florian Musterstadt 10/1');
  });

  it('Rufname: ohne Stammdaten bleiben die disponierten Vorschläge (LFH-1187)', async () => {
    setup();
    server.use(
      http.get('/api/fahrzeuge', () => HttpResponse.json({ error: 'kaputt' }, { status: 500 })),
    );
    fuehrungsstelleMitschnitt();
    const user = userEvent.setup();
    const p = await paneel();
    await user.click(await p.findByRole('button', { name: 'Rufname eintragen' }));
    await user.click(p.getByRole('combobox', { name: 'Rufname' }));
    await waitFor(() =>
      expect(vorschlagsliste()).toEqual([
        '# Disponierte Führungsfahrzeuge',
        'Florian Musterstadt 10/1ELW 2',
      ]),
    );
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

  it('Einsatzleiter: Person wählen schickt nur den Einsatzleiter, ohne „seit“ = jetzt (LFH-1199)', async () => {
    setup({ zeitzone: 'Europe/Berlin' });
    const bodies = fuehrungsstelleMitschnitt();
    const user = userEvent.setup();
    const p = await paneel();
    await user.click(await p.findByRole('button', { name: 'Einsatzleiter eintragen' }));
    await user.click(p.getByRole('combobox', { name: 'Einsatzleiter' }));
    await user.click(await screen.findByText('Anna Schulz · Zugführerin'));
    await user.click(p.getByRole('button', { name: 'Einsatzleiter speichern' }));
    await waitFor(() =>
      expect(bodies).toEqual([{ einsatzleiter: { art: 'personal', personal_id: 3 } }]),
    );
    expect(
      await p.findByRole('button', { name: 'Einsatzleiter bearbeiten' }),
    ).toHaveAccessibleDescription('Anna Schulz · seit 111400');
    // Die Kopfleiste zeigt denselben Namen.
    const kopf = screen.getByRole('group', { name: 'Einsatzleitung' });
    expect(within(kopf).getByText('Anna Schulz')).toBeInTheDocument();
  });

  it('Einsatzleiter: Freitext als externer Einsatzleiter', async () => {
    setup();
    const bodies = fuehrungsstelleMitschnitt();
    const user = userEvent.setup();
    const p = await paneel();
    await user.click(await p.findByRole('button', { name: 'Einsatzleiter eintragen' }));
    await user.type(p.getByRole('combobox', { name: 'Einsatzleiter' }), 'KBM Weber');
    await user.click(await screen.findByText('„KBM Weber“ als externen Einsatzleiter übernehmen'));
    await user.click(p.getByRole('button', { name: 'Einsatzleiter speichern' }));
    await waitFor(() =>
      expect(bodies).toEqual([{ einsatzleiter: { art: 'extern', name: 'KBM Weber' } }]),
    );
    expect(
      await p.findByRole('button', { name: 'Einsatzleiter bearbeiten' }),
    ).toHaveAccessibleDescription(/^KBM Weber \(extern\) · seit \d{6}$/);
  });

  it('Einsatzleiter: unveränderte Wahl sendet nichts, Leeren sendet `null`', async () => {
    setup();
    const bodies = fuehrungsstelleMitschnitt({
      art: 'mobil',
      sprechgruppen: [],
      fahrzeug_ids: [],
      einsatzleiter: anna,
    });
    const user = userEvent.setup();
    const p = await paneel();
    await user.click(await p.findByRole('button', { name: 'Einsatzleiter bearbeiten' }));
    await user.click(p.getByRole('button', { name: 'Einsatzleiter speichern' }));
    expect(await p.findByRole('button', { name: 'Einsatzleiter bearbeiten' })).toBeVisible();
    expect(bodies).toEqual([]);

    await user.click(p.getByRole('button', { name: 'Einsatzleiter bearbeiten' }));
    await user.click(p.getByRole('button', { name: 'Einsatzleiter leeren' }));
    await user.click(p.getByRole('button', { name: 'Einsatzleiter speichern' }));
    await waitFor(() => expect(bodies).toEqual([{ einsatzleiter: null }]));
    expect(await p.findByRole('button', { name: 'Einsatzleiter eintragen' })).toBeVisible();
  });

  it('Einsatzleiter: die bisherige Person erneut gewählt behält ihr „seit“', async () => {
    setup();
    const bodies = fuehrungsstelleMitschnitt({
      art: 'mobil',
      sprechgruppen: [],
      fahrzeug_ids: [],
      einsatzleiter: anna,
    });
    const user = userEvent.setup();
    const p = await paneel();
    await user.click(await p.findByRole('button', { name: 'Einsatzleiter bearbeiten' }));
    await user.click(p.getByRole('combobox', { name: 'Einsatzleiter' }));
    await user.click(await screen.findByText('Bernd Berg'));
    await user.click(p.getByRole('combobox', { name: 'Einsatzleiter' }));
    await user.click(await screen.findByText('Anna Schulz · Zugführerin'));
    await user.click(p.getByRole('button', { name: 'Einsatzleiter speichern' }));
    expect(await p.findByRole('button', { name: 'Einsatzleiter bearbeiten' })).toBeVisible();
    expect(bodies).toEqual([]);
  });

  it('Einsatzleiter: Freitext nur unter der Grenze und nie für eine Person der Liste', async () => {
    setup();
    fuehrungsstelleMitschnitt();
    const user = userEvent.setup();
    const p = await paneel();
    await user.click(await p.findByRole('button', { name: 'Einsatzleiter eintragen' }));
    const feld = p.getByRole('combobox', { name: 'Einsatzleiter' });
    await user.type(feld, 'anna schulz');
    expect(screen.queryByText(/als externen Einsatzleiter übernehmen/)).toBeNull();
    await user.clear(feld);
    fireEvent.change(feld, { target: { value: 'x'.repeat(201) } });
    expect(await p.findByText(/zu lang/)).toBeInTheDocument();
    expect(screen.queryByText(/als externen Einsatzleiter übernehmen/)).toBeNull();
  });

  it('Einsatzleiter: ohne Freigabe Personal nur Freitext, mit Grund', async () => {
    setup();
    server.use(
      http.get('/api/einsaetze/7/modul-freigaben', () =>
        HttpResponse.json(freigabenFixture({ personal: { zugriff: false } })),
      ),
    );
    fuehrungsstelleMitschnitt();
    const user = userEvent.setup();
    const p = await paneel();
    await user.click(await p.findByRole('button', { name: 'Einsatzleiter eintragen' }));
    expect(await p.findByText('Personal nicht freigegeben — nur Freitext')).toBeInTheDocument();
    await user.click(p.getByRole('combobox', { name: 'Einsatzleiter' }));
    expect(screen.queryByText('Anna Schulz · Zugführerin')).toBeNull();
  });

  it('Einsatzleiter: entlassene Person mit Vermerk, Fehler an der Zeile', async () => {
    setup();
    fuehrungsstelleMitschnitt({
      art: 'mobil',
      sprechgruppen: [],
      fahrzeug_ids: [],
      einsatzleiter: { ...anna, personal_id: undefined, personal_noch_disponiert: false },
    });
    server.use(
      http.patch('/api/einsaetze/7/fuehrungsstelle', () =>
        HttpResponse.json({ error: 'Person ist nicht disponiert' }, { status: 422 }),
      ),
    );
    const user = userEvent.setup();
    const p = await paneel();
    const knopf = await p.findByRole('button', { name: 'Einsatzleiter bearbeiten' });
    expect(knopf).toHaveAccessibleDescription(/^Anna Schulz · nicht mehr disponiert · seit/);
    await user.click(knopf);
    await user.click(p.getByRole('combobox', { name: 'Einsatzleiter' }));
    await user.click(await screen.findByText('Bernd Berg'));
    await user.click(p.getByRole('button', { name: 'Einsatzleiter speichern' }));
    expect(await p.findByText('Person ist nicht disponiert')).toBeInTheDocument();
  });

  it('Kopfleiste zeigt den Einsatzleiter der Führungsstelle (LFH-1199)', async () => {
    setup();
    fuehrungsstelleMitschnitt({
      art: 'mobil',
      sprechgruppen: [],
      fahrzeug_ids: [],
      einsatzleiter: { ...anna, personal_noch_disponiert: false },
    });
    const kopf = await screen.findByRole('group', { name: 'Einsatzleitung' });
    expect(
      await within(kopf).findByText('Anna Schulz · nicht mehr disponiert'),
    ).toBeInTheDocument();
    expect(within(kopf).queryByRole('button')).toBeNull();
  });

  it('Fahrzeuge: Auswahl geht als `fahrzeug_ids`, Anzeige mit Typ (LFH-1106)', async () => {
    setup();
    const bodies = fuehrungsstelleMitschnitt();
    const user = userEvent.setup();
    const p = await paneel();
    await user.click(await p.findByRole('button', { name: 'Führungsfahrzeuge eintragen' }));
    await user.click(p.getByRole('combobox', { name: 'Führungsfahrzeuge' }));
    await user.click(await screen.findByText('Florian Musterstadt 10/1 (ELW 2)'));
    await user.click(p.getByRole('button', { name: 'Führungsfahrzeuge speichern' }));
    await waitFor(() => expect(bodies).toEqual([{ fahrzeug_ids: [41] }]));
    expect(
      await p.findByRole('button', { name: 'Führungsfahrzeuge bearbeiten' }),
    ).toHaveAccessibleDescription('Florian Musterstadt 10/1 (ELW 2)');
  });

  it('Fahrzeuge: ein entlassenes Fahrzeug fällt still weg', async () => {
    setup();
    fuehrungsstelleMitschnitt({ art: 'mobil', sprechgruppen: [], fahrzeug_ids: [42, 999] });
    const p = await paneel();
    expect(
      await p.findByRole('button', { name: 'Führungsfahrzeuge bearbeiten' }),
    ).toHaveAccessibleDescription('Florian Musterstadt 19/1 (MTW)');
  });

  it('Fahrzeuge: ohne Freigabe gesperrt mit Grund, die übrigen Angaben bleiben bedienbar', async () => {
    setup();
    server.use(
      http.get('/api/einsaetze/7/modul-freigaben', () =>
        HttpResponse.json(freigabenFixture({ fahrzeuge: { zugriff: false } })),
      ),
    );
    fuehrungsstelleMitschnitt({ art: 'mobil', sprechgruppen: [], fahrzeug_ids: [41] });
    const p = await paneel();
    expect(await p.findByText('nicht freigegeben')).toBeInTheDocument();
    expect(p.queryByRole('button', { name: /^Führungsfahrzeuge / })).toBeNull();
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
      art: 'mobil',
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
    fuehrungsstelleMitschnitt({
      art: 'mobil',
      sprechgruppen: [],
      fahrzeug_ids: [],
      rufname: 'Florian 10/1',
    });
    const p = await paneel();
    expect(await p.findByText('Florian 10/1')).toBeInTheDocument();
    expect(p.queryByRole('button', { name: /eintragen|bearbeiten/ })).toBeNull();
    expect(p.queryByRole('radiogroup', { name: 'Art' })).toBeNull();
    // Erfasst (Rufname): „mobil“ ist gewählt, nicht die Vorgabe.
    expect(p.getByText('mobil')).toBeInTheDocument();
    // Die Fahrzeugzeile hat eine eigene Quelle; „—" steht dort erst, wenn sie geladen ist. Sieben
    // leere Angaben: Einsatzleiter, Bezeichnung, Standort, Sprechgruppen, Kommunikationsmittel,
    // Erreichbarkeit, Führungsfahrzeuge.
    await waitFor(() => expect(p.getAllByText('—')).toHaveLength(7));
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
    await user.type(p.getByRole('combobox', { name: 'Rufname' }), 'X{Enter}');
    const fehler = await p.findByText('Einsatz ist abgeschlossen');
    expect(fehler.closest('.ant-message')).toBeNull();
    expect(p.getByRole('combobox', { name: 'Rufname' })).toHaveValue('X');
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
      http.get('/api/externe-stellen', () => HttpResponse.json(externeStellen)),
      http.get('/api/einsaetze/:id/ort-vorschau', () =>
        HttpResponse.json({ peilung: null, ortsname: null }),
      ),
      http.get('/api/einsaetze/:id/fuehrungsstelle', () =>
        HttpResponse.json({
          art: 'mobil',
          sprechgruppen: [],
          fahrzeug_ids: [],
        } satisfies Fuehrungsstelle),
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

/**
 * LFH-1175, Spec `einsatzdaten-bearbeitung` und `ortsfeld`: Paneel „Einsatzort“ mit Adresse
 * (Ortsfeld mit Suche), Koordinate, Kartenausschnitt und Sprung zur Lagekarte.
 */
describe('EinsatzdatenPage · Paneel Einsatzort (LFH-1175)', () => {
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

  function geocoder() {
    const begriffe: string[] = [];
    server.use(
      http.get('/api/einsaetze/7/ort-suche', ({ request }) => {
        begriffe.push(new URL(request.url).searchParams.get('q')!);
        return HttpResponse.json({
          zustand: 'ok',
          treffer: [
            {
              lat: 51.1,
              lon: 10.4,
              name: 'Bahnhofstraße 1, Musterstadt, Landkreis X, 12345, Deutschland',
              kurz: 'Bahnhofstraße 1, 12345 Musterstadt',
            },
          ],
        });
      }),
    );
    return begriffe;
  }

  it('ein Treffer speichert Adresse und Koordinate in genau einem PATCH', async () => {
    setup({ einsatz: { einsatzort: 'Bahnhofstr' } });
    const bodies = patchMitschnitt({ einsatzort: 'Bahnhofstr' });
    const begriffe = geocoder();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Adresse bearbeiten' }));
    const feld = screen.getByRole('textbox', { name: 'Adresse' });
    await user.clear(feld);
    await user.type(feld, 'Bahnhofstraße 1{Enter}');
    expect(bodies).toEqual([]);
    const liste = await screen.findByRole('list', { name: 'Treffer' });
    expect(begriffe).toEqual(['Bahnhofstraße 1']);
    await user.click(within(liste).getByRole('button', { name: /Bahnhofstraße 1, 12345/ }));
    await user.click(screen.getByRole('button', { name: 'Adresse speichern' }));
    await waitFor(() =>
      expect(bodies).toEqual([
        {
          einsatzort: 'Bahnhofstraße 1, 12345 Musterstadt',
          einsatzort_lat: 51.1,
          einsatzort_lon: 10.4,
        },
      ]),
    );
    expect(await screen.findByText('Karte 51.1, 10.4')).toBeInTheDocument();
  });

  it('ein Treffer mit unverändertem Text sendet trotzdem: er bringt die Koordinate', async () => {
    const text = 'Bahnhofstraße 1, 12345 Musterstadt';
    setup({ einsatz: { einsatzort: text } });
    const bodies = patchMitschnitt({ einsatzort: text });
    geocoder();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Adresse bearbeiten' }));
    await user.click(screen.getByRole('button', { name: 'Ort suchen' }));
    const liste = await screen.findByRole('list', { name: 'Treffer' });
    await user.click(within(liste).getByRole('button', { name: /Bahnhofstraße 1, 12345/ }));
    await user.click(screen.getByRole('button', { name: 'Adresse speichern' }));
    await waitFor(() =>
      expect(bodies).toEqual([{ einsatzort: text, einsatzort_lat: 51.1, einsatzort_lon: 10.4 }]),
    );
  });

  it('Escape schließt zuerst die Trefferliste, erst das zweite verwirft die Zeile', async () => {
    setup({ einsatz: { einsatzort: 'Deich Süd' } });
    const bodies = patchMitschnitt({ einsatzort: 'Deich Süd' });
    geocoder();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Adresse bearbeiten' }));
    await user.click(screen.getByRole('button', { name: 'Ort suchen' }));
    await screen.findByRole('list', { name: 'Treffer' });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('list', { name: 'Treffer' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Adresse' })).toHaveValue('Deich Süd');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Adresse' })).not.toBeInTheDocument();
    expect(bodies).toEqual([]);
  });

  it('nur geänderter Text speichert nur die Adresse, die Koordinate bleibt', async () => {
    const stand = { einsatzort: 'Deich Süd', einsatzort_lat: 48.1, einsatzort_lon: 11.6 };
    setup({ einsatz: stand });
    const bodies = patchMitschnitt(stand);
    const begriffe = geocoder();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Adresse bearbeiten' }));
    await user.type(screen.getByRole('textbox', { name: 'Adresse' }), ', Abschnitt 2');
    await user.click(screen.getByRole('button', { name: 'Adresse speichern' }));
    await waitFor(() => expect(bodies).toEqual([{ einsatzort: 'Deich Süd, Abschnitt 2' }]));
    expect(begriffe).toEqual([]);
    expect(screen.getByText('Karte 48.1, 11.6')).toBeInTheDocument();
  });

  it('die Zeile Koordinate sendet das Paar, geleert als Paar aus null', async () => {
    setup();
    const bodies = patchMitschnitt();
    const user = userEvent.setup();
    expect(await screen.findByText('Nicht verortet')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Koordinate eintragen' }));
    await user.type(screen.getByRole('textbox', { name: 'Koordinate' }), '51.16040, 10.45140');
    await user.click(screen.getByRole('button', { name: 'Koordinate speichern' }));
    await waitFor(() =>
      expect(bodies).toEqual([{ einsatzort_lat: 51.1604, einsatzort_lon: 10.4514 }]),
    );
    expect(await screen.findByText('Karte 51.1604, 10.4514')).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Koordinate bearbeiten' }));
    await user.clear(screen.getByRole('textbox', { name: 'Koordinate' }));
    await user.click(screen.getByRole('button', { name: 'Koordinate speichern' }));
    await waitFor(() => expect(bodies[1]).toEqual({ einsatzort_lat: null, einsatzort_lon: null }));
  });

  it('eine ungültige Koordinate geht nicht hinaus, der Fehler steht an der Zeile', async () => {
    setup({ einsatz: { einsatzort_lat: 48.1, einsatzort_lon: 11.6 } });
    const bodies = patchMitschnitt({ einsatzort_lat: 48.1, einsatzort_lon: 11.6 });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Koordinate bearbeiten' }));
    const feld = screen.getByRole('textbox', { name: 'Koordinate' });
    await user.clear(feld);
    await user.type(feld, 'Deich');
    await user.click(screen.getByRole('button', { name: 'Koordinate speichern' }));
    // Die Eingabe nennt den Grund selbst, die Zeile bleibt offen (`isValid`, LFH-1170).
    expect(await screen.findByText(/^Ungültige Koordinate/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Koordinate' })).toHaveValue('Deich');
    expect(bodies).toEqual([]);
    expect(screen.getByText('Karte 48.1, 11.6')).toBeInTheDocument();
  });

  it('der Sprung zur Lagekarte steht nur mit Koordinate und Lagekarten-Recht', async () => {
    setup({ einsatz: { einsatzort_lat: 51.1, einsatzort_lon: 10.4 } });
    const sprung = await screen.findByRole('link', { name: /Auf Lagekarte zeigen/ });
    expect(sprung).toHaveAttribute('href', expect.stringContaining('/einsaetze/7/lagekarte'));
    expect(sprung.getAttribute('href')).toContain('zentrum=');
  });

  it('ohne Koordinate kein Sprung zur Lagekarte', async () => {
    setup();
    expect(await screen.findByText('Nicht verortet')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Auf Lagekarte zeigen/ })).toBeNull();
  });

  it('ohne Lagekarten-Recht kein Sprung', async () => {
    setup({ einsatz: { einsatzort_lat: 51.1, einsatzort_lon: 10.4 } });
    server.use(
      http.get('/api/einsaetze/7/modul-freigaben', () =>
        HttpResponse.json(freigabenFixture({ lagekarte: { zugriff: false, sichtbar: false } })),
      ),
    );
    expect(await screen.findByText('Karte 51.1, 10.4')).toBeInTheDocument();
    // Die Freigaben laden nach; der Sprung erscheint nie.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('link', { name: /Auf Lagekarte zeigen/ })).toBeNull();
  });

  it('ohne Schreibrecht zeigt das Paneel nur an', async () => {
    setup({
      einsatz: {
        meine_rolle: 'beobachter',
        einsatzort: 'Deich Süd',
        einsatzort_lat: 48.1,
        einsatzort_lon: 11.6,
      },
      benutzer: { ...admin, system_rolle: 'keiner' },
    });
    expect(await screen.findByText('Karte 48.1, 11.6')).toBeInTheDocument();
    expect(screen.getAllByText('Deich Süd').length).toBeGreaterThan(0);
    expect(
      screen.queryByRole('button', { name: /^(Adresse|Koordinate) (bearbeiten|eintragen)$/ }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ort suchen' })).toBeNull();
  });
});
