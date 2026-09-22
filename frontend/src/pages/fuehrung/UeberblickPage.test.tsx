import { delay, http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import UeberblickPage from './UeberblickPage';

dayjs.extend(utc);

/** Fixtures relativ zur echten Uhr — die Seite tickt mit `dayjs()`. Wire: UTC ohne Zone. */
const vor = (min: number) => dayjs.utc().subtract(min, 'minute').format('YYYY-MM-DD HH:mm:ss');
const nach = (min: number) => dayjs.utc().add(min, 'minute').format('YYYY-MM-DD HH:mm:ss');

const einsatz = {
  id: 1,
  bezeichnung: 'Hochwasser Weserlauf',
  status: 'aktiv',
  begonnen_at: vor(300),
  angelegt_at: vor(300),
  einsatzart: 'realeinsatz',
  org_id: 1,
  org_name: 'THW',
  meine_sachgebiete: [],
  meine_rolle: 'fuehrungspersonal',
  naechste_lagebesprechung_at: nach(120),
};

const person = (id: number, erfasst_at: string) => ({
  id,
  einsatz_id: 1,
  registrier_nr: id,
  status: 'betroffen',
  erfasst_at,
  erfasst_von: 1,
  geaendert_at: erfasst_at,
  geaendert_von: 1,
  aktuelle_sichtung: null,
});

const auftrag = (over: Record<string, unknown>) => ({
  id: 1,
  einsatz_id: 1,
  auftrag_text: 'Deich sichern',
  prioritaet: 'normal',
  richtung: 'intern',
  frist_at: null,
  erteilt_at: vor(30),
  erstellt_at: vor(30),
  erstellt_von_id: 1,
  vollzug_status: 'offen',
  empfaenger_anzahl: 1,
  quittiert_anzahl: 0,
  ist_ueberfaellig: false,
  bearbeitungsstatus: 'offen',
  quell_etb_eintrag_id: null,
  empfaenger: [],
  ...over,
});

const volleDaten = {
  personen: [person(1, vor(10)), person(2, vor(200)), person(3, vor(300))],
  personal: [
    {
      id: 1,
      name: 'A',
      einheit_id: 10,
      staerke_position: 'fuehrer',
      status_kategorie: 'verfuegbar',
    },
    {
      id: 2,
      name: 'B',
      einheit_id: 10,
      staerke_position: 'mannschaft',
      status_kategorie: 'gebunden',
    },
  ],
  fahrzeuge: [
    { id: 1, funkrufname: 'Florian 1', einheit_id: 10, status_kategorie: 'nicht_verfuegbar' },
  ],
  material: [],
  einheiten: [
    {
      id: 10,
      name: 'Zug 1',
      abschnitt_id: 5,
      ueber_einheit_id: null,
      soll: null,
      // Abgeleitet aus dem ausgefallenen Fahrzeug unten (LFH-609).
      status: { quelle: 'fahrzeuge', kategorie: 'nicht_verfuegbar', verteilung: [] },
    },
  ],
  abschnitte: [
    {
      id: 5,
      einsatz_id: 1,
      name: 'Abschnitt Nord',
      leiter_name: 'EA-N · Vitt',
      sortier: 1,
      sprechgruppen: [],
      ueber_abschnitt_id: null,
    },
  ],
  gefahren: [{ id: 1, hoechste_warnstufe: 'hoch' }],
  auftraege: [
    auftrag({ id: 21, auftrag_text: 'Pegel melden', frist_at: nach(90) }),
    auftrag({
      id: 22,
      auftrag_text: 'Trupps verlegen',
      frist_at: vor(15),
      ist_ueberfaellig: true,
      empfaenger: [
        {
          id: 1,
          auftrag_id: 22,
          empfaenger_typ: 'abschnitt',
          snap_anzeige: 'EA-Nord',
          abschnitt_id: 5,
        },
      ],
    }),
    auftrag({
      id: 23,
      auftrag_text: 'Folge A',
      bearbeitungsstatus: 'vollzogen',
    }),
    auftrag({
      id: 24,
      auftrag_text: 'Folge B',
      bearbeitungsstatus: 'vollzogen',
    }),
  ],
  erinnerungen: [
    { id: 3, titel: 'Lagebericht an Kreisstab', faellig_at: nach(20), status: 'offen' },
  ],
  etb: [
    {
      id: 411,
      lfd_nr: 411,
      typ: 'entscheidung',
      ereigniszeit: vor(12),
      received_at: vor(12),
      inhalt: 'Turnhalle Ost wird Notunterkunft.',
      erfasser_id: 1,
      erfasser_name: 'Brandt',
      // Die Zahl kommt aus dem ETB-Eintrag (LFH-636), nicht aus der Auftragsliste: die
      // Aufträge 23/24 oben tragen bewusst KEINEN `quell_etb_eintrag_id`, sonst stimmten
      // beide Quellen überein und der Test könnte die alte Ableitung nicht fangen.
      folgeauftraege: [
        { id: 23, lfd_nr: 3 },
        { id: 24, lfd_nr: 4 },
      ],
    },
  ],
  /** Maßgebliche Pegel (LFH-606) — im Grundbestand keiner festgelegt. */
  pegel: [] as unknown[],
};

type Daten = typeof volleDaten;

/** Ein Leitpegel mit frischer Messung (relativ zur echten Uhr, wie die Seite rechnet). */
const leitpegel = (messung: Record<string, unknown> | null) => ({
  id: 1,
  station_uuid: '47174d8f-1b8e-4599-8a59-b580dd55bc87',
  name: 'HANN. MÜNDEN',
  gewaesser: 'WESER',
  reihenfolge: 0,
  ...(messung ? { messung } : {}),
});

function stelleBereit(d: Daten, ueberschreiben: Parameters<typeof server.use> = []) {
  const json = (x: object) => () => HttpResponse.json(x);
  server.use(
    ...ueberschreiben,
    http.get('/api/einsaetze/1', json(einsatz)),
    http.get('/api/einsaetze/1/personen', json(d.personen)),
    http.get('/api/einsaetze/1/personal', json(d.personal)),
    http.get('/api/einsaetze/1/fahrzeuge', json(d.fahrzeuge)),
    http.get('/api/einsaetze/1/material', json(d.material)),
    http.get('/api/einsaetze/1/einheiten', json(d.einheiten)),
    http.get('/api/einsaetze/1/abschnitte', json(d.abschnitte)),
    http.get('/api/einsaetze/1/gefahrengebiete', json(d.gefahren)),
    http.get('/api/einsaetze/1/auftraege', json(d.auftraege)),
    http.get('/api/einsaetze/1/erinnerungen', json(d.erinnerungen)),
    http.get('/api/einsaetze/1/pegel', json(d.pegel ?? [])),
    http.get('/api/einsaetze/1/etb', ({ request }) => {
      const url = new URL(request.url);
      // Die Seite fragt NUR Entscheidungen ab — ein Abruf ohne Filter wäre ein Fehler.
      return url.searchParams.get('typ') === 'entscheidung'
        ? HttpResponse.json(d.etb)
        : HttpResponse.json({ error: 'ohne Typfilter' }, { status: 400 });
    }),
  );
}

function Ort() {
  const l = useLocation();
  return <div data-testid="ort">{`${l.pathname}${l.search}`}</div>;
}

function rendern() {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/ueberblick" element={<UeberblickPage />} />
      <Route path="*" element={<Ort />} />
    </Routes>,
    { route: '/einsaetze/1/ueberblick' },
  );
}

const band = () => screen.getByRole('group', { name: 'Lage in Zahlen' });
const paneel = (name: string | RegExp) => screen.getByRole('region', { name });

describe('UeberblickPage', () => {
  it('Seitenkopf: Ortspfad mit Einsatzname, Titel und genau eine Primäraktion', async () => {
    stelleBereit(volleDaten);
    rendern();
    expect(await screen.findByRole('heading', { name: 'Überblick' })).toBeInTheDocument();
    expect(await screen.findByText('Hochwasser Weserlauf')).toBeInTheDocument();
    const aktionen = document.querySelector<HTMLElement>('[data-lfh="seitenkopf-aktionen"]')!;
    const primaer = Array.from(aktionen.querySelectorAll('button')).filter((b) =>
      b.className.includes('btn-primary'),
    );
    expect(primaer.map((b) => b.textContent)).toEqual(['Eintrag']);
  });

  it('„Eintrag" springt in die ETB-Schnellerfassung, „Lagebericht" zu den Lageberichten', async () => {
    stelleBereit(volleDaten);
    rendern();
    await userEvent.click(await screen.findByRole('button', { name: 'Eintrag' }));
    expect(screen.getByTestId('ort')).toHaveTextContent('/einsaetze/1/etb?neu=1');
  });

  it('„Lagebericht" führt zur Lageberichte-Liste', async () => {
    stelleBereit(volleDaten);
    rendern();
    await userEvent.click(await screen.findByRole('button', { name: 'Lagebericht' }));
    expect(screen.getByTestId('ort')).toHaveTextContent('/einsaetze/1/lageberichte');
  });

  it('Kennzahlenband: fünf Zahlen mit Notiz, jede ein Link ins Fachmodul', async () => {
    stelleBereit(volleDaten);
    rendern();
    await waitFor(() => expect(within(band()).getByText('+1 in 60 min')).toBeInTheDocument());
    const links = within(band()).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/einsaetze/1/personen',
      '/einsaetze/1/kraefteuebersicht',
      '/einsaetze/1/gefahren',
      '/einsaetze/1/auftraege',
      '/einsaetze/1/einsatzabschnitte',
    ]);
    const b = within(band());
    expect(links[0]).toHaveTextContent('3');
    expect(b.getByText('F/UF/M//Σ 1/0/1//2')).toBeInTheDocument();
    // Warnstufe: das Wort ist der zweite Kanal. Ohne festgelegten Pegel keine Pegel-Notiz —
    // die Gegenaussage zum Fall „mit Pegel" unten (LFH-606).
    expect(links[2]).toHaveTextContent('hoch');
    expect(links[2]).toHaveTextContent('1 Gefahrengebiet mit Warnstufe');
    expect(links[2]).not.toHaveTextContent(/Pegel/);
    expect(b.getByText('davon 1 ü.')).toBeInTheDocument();
    expect(b.getByText('Abschnitt Nord')).toBeInTheDocument();
  });

  it('Warnstufe mit festgelegtem Pegel: Notiz „Pegel 6,84 m steigend" (LFH-606)', async () => {
    stelleBereit({
      ...volleDaten,
      pegel: [
        leitpegel({
          wasserstand_cm: 684,
          zeitpunkt: new Date(Date.now() - 10 * 60_000).toISOString(),
          trend_cm_pro_h: 9.2,
        }),
      ],
    });
    rendern();
    await waitFor(() => expect(within(band()).getByText(/Pegel 6,84 m/)).toBeInTheDocument());
    const warnstufe = within(band()).getAllByRole('link')[2];
    expect(warnstufe).toHaveTextContent('hoch');
    expect(warnstufe).toHaveTextContent('1 Gefahrengebiet mit Warnstufe · Pegel 6,84 m steigend');
    // Die Kennzahl gehört weiter der Warnstufe: Ziel bleibt die Gefahrenseite.
    expect(warnstufe).toHaveAttribute('href', '/einsaetze/1/gefahren');
  });

  it('Warnstufe bei Pegel-Ausfall und bei gescheitertem Pegel-Abruf: „Pegel: Stand unbekannt"', async () => {
    stelleBereit({ ...volleDaten, pegel: [leitpegel(null)] });
    const erster = rendern();
    expect(await within(band()).findByText(/Pegel: Stand unbekannt/)).toBeInTheDocument();
    erster.unmount();

    stelleBereit(volleDaten, [
      http.get('/api/einsaetze/1/pegel', () => new HttpResponse(null, { status: 500 })),
    ]);
    rendern();
    expect(await within(band()).findByText(/Pegel: Stand unbekannt/)).toBeInTheDocument();
    // Der tote Pegel-Abruf macht die Warnstufe nicht unlesbar.
    expect(within(band()).getAllByRole('link')[2]).toHaveTextContent('hoch');
  });

  it('Abschnittszeile: Leiter, Stärke, Einheiten nach Status ehrlich beschriftet, Auftrag, Deeplink', async () => {
    stelleBereit(volleDaten);
    rendern();
    const p = await waitFor(() => paneel('Einsatzabschnitte'));
    const zeile = await within(p).findByRole('link', { name: /Abschnitt Nord/ });
    expect(zeile).toHaveAttribute('href', '/einsaetze/1/einsatzabschnitte?abschnitt=5');
    expect(zeile).toHaveTextContent('EA-N · Vitt');
    expect(zeile).toHaveTextContent('1 Einheit');
    expect(zeile).toHaveTextContent('1/0/1//2');
    expect(zeile).toHaveTextContent('Trupps verlegen');
    // Der zweite Kanal der Zellen muss im Linknamen ankommen, nicht nur optisch.
    // LFH-609: gezählt wird die EINHEIT nach ihrem Status (Ausfall), nicht mehr ihre Mittel
    // (Personal A bereit, B gebunden, Fahrzeug Ausfall ergäbe 1/1/1).
    expect(zeile).toHaveAccessibleName(/0\s*bereit/);
    expect(zeile).toHaveAccessibleName(/0\s*gebunden/);
    expect(zeile).toHaveAccessibleName(/1\s*Ausfall/);
    // Je Zelle das Wort für Vorleser.
    const zellen = zeile.querySelectorAll('[data-lfh="status-zelle"]');
    expect(Array.from(zellen).map((z) => z.getAttribute('title'))).toEqual([
      'bereit',
      'gebunden',
      'Ausfall',
    ]);
    expect(Array.from(zellen).map((z) => z.getAttribute('data-ton'))).toEqual([
      'normal',
      'bedien',
      'alarm',
    ]);
    expect(within(p).getByText(/Einheiten nach Status/)).toBeInTheDocument();
    expect(within(p).getByText('1 Abschnitte · 1 Einheiten')).toBeInTheDocument();
  });

  it('Abschnittszeile mit Lage (LFH-608): Kante, Stufenwort, Kürzel, fester Auftrag, Fortschritt', async () => {
    stelleBereit({
      ...volleDaten,
      abschnitte: [
        {
          ...volleDaten.abschnitte[0],
          leiter_name: 'Vitt',
          kurzbezeichnung: 'EA-N',
          lagezustand: 'kritisch',
          abschnittsauftrag: 'Deichsicherung km 3,8 – 5,4',
          fortschritt: 72,
        } as Daten['abschnitte'][number],
      ],
    });
    rendern();
    const p = await waitFor(() => paneel('Einsatzabschnitte'));
    const zeile = await within(p).findByRole('link', { name: /Abschnitt Nord/ });
    // Die Farbe trägt die Kante, das Wort trägt die Aussage (WCAG 1.4.1).
    const kante = zeile.querySelector<HTMLElement>('[data-lfh="abschnitt-lagekante"]')!;
    expect(kante).toHaveAttribute('data-rolle', 'alarm');
    expect(zeile).toHaveAccessibleName(/kritisch/);
    expect(zeile).toHaveTextContent('EA-N · Vitt');
    // Der feste Auftrag steht vorn; der offene Einzelauftrag bleibt als kleine Zeile.
    expect(zeile).toHaveTextContent('Deichsicherung km 3,8 – 5,4');
    expect(zeile).toHaveTextContent('1 offen · Trupps verlegen');
    // Fortschritt: Balken UND Zahl, daneben die Zählung — zwei Aussagen, beide benannt.
    const balken = zeile.querySelector<HTMLElement>('[data-lfh="abschnitt-fortschritt"]')!;
    expect(balken.style.width).toBe('72%');
    expect(zeile).toHaveTextContent('72 %');
    expect(zeile).toHaveTextContent('0/1 Aufträge erledigt');
  });

  it('Abschnittszeile meldet einen schlechter beurteilten Unterabschnitt als eigenes Etikett', async () => {
    stelleBereit({
      ...volleDaten,
      abschnitte: [
        { ...volleDaten.abschnitte[0], lagezustand: 'planmaessig' } as Daten['abschnitte'][number],
        {
          ...volleDaten.abschnitte[0],
          id: 6,
          name: 'Deichspitze',
          ueber_abschnitt_id: 5,
          lagezustand: 'kritisch',
        } as unknown as Daten['abschnitte'][number],
      ],
    });
    rendern();
    const p = await waitFor(() => paneel('Einsatzabschnitte'));
    const zeile = await within(p).findByRole('link', { name: /Abschnitt Nord/ });
    expect(
      zeile.querySelector('[data-lfh="abschnitt-lagekante"]')!.getAttribute('data-rolle'),
    ).toBe('normal');
    expect(within(zeile).getByText('UA kritisch')).toBeInTheDocument();
  });

  it('Abschnittszeile ohne gepflegte Lage: keine Kantenfarbe, kein Balken, Auftrag wie bisher', async () => {
    stelleBereit(volleDaten);
    rendern();
    const p = await waitFor(() => paneel('Einsatzabschnitte'));
    const zeile = await within(p).findByRole('link', { name: /Abschnitt Nord/ });
    expect(
      zeile.querySelector('[data-lfh="abschnitt-lagekante"]')!.getAttribute('data-rolle'),
    ).toBeNull();
    expect(zeile.querySelector('[data-lfh="abschnitt-fortschritt"]')).toBeNull();
    expect(zeile).not.toHaveTextContent('%');
    expect(zeile).not.toHaveTextContent(/planmäßig|angespannt|kritisch/);
    expect(zeile).toHaveTextContent('Trupps verlegen');
    expect(zeile).toHaveTextContent('0/1 Aufträge erledigt');
  });

  it('Offene Aufträge: überfällige zuerst, Status-Wort, Empfänger und Frist, Deeplink', async () => {
    stelleBereit(volleDaten);
    rendern();
    const p = await waitFor(() => paneel('Offene Aufträge'));
    await within(p).findByText('1 überfällig');
    const zeilen = within(p).getAllByRole('link');
    expect(zeilen.map((z) => z.getAttribute('href'))).toEqual([
      '/einsaetze/1/auftraege?auftrag=22',
      '/einsaetze/1/auftraege?auftrag=21',
    ]);
    expect(zeilen[0]).toHaveTextContent('überfällig');
    expect(zeilen[0]).toHaveTextContent('an EA-Nord · Frist');
    expect(zeilen[1]).toHaveTextContent('läuft');
    expect(zeilen[1]).toHaveTextContent('ohne Empfänger · Frist');
    expect(zeilen[1]).not.toHaveTextContent('an ohne');
  });

  it('Entscheidungen: Zeitachseneintrag mit Typwort, Folgeaufträge gezählt, ETB-Link mit Filter', async () => {
    stelleBereit(volleDaten);
    rendern();
    const p = await waitFor(() => paneel('Entscheidungen der letzten Stunde'));
    const eintrag = await within(p).findByText('Turnhalle Ost wird Notunterkunft.');
    const li = eintrag.closest('li')!;
    expect(li).toHaveAttribute('data-typ', 'entscheidung');
    expect(within(li).getByText('Entscheidung')).toBeInTheDocument();
    expect(within(li).getByText('Nr. 411')).toBeInTheDocument();
    expect(within(li).getByText('2 Aufträge')).toBeInTheDocument();
    expect(
      within(p).getByRole('link', { name: 'Entscheidungen im Einsatztagebuch öffnen' }),
    ).toHaveAttribute('href', '/einsaetze/1/etb?typ=entscheidung');
  });

  it('Entscheidungen: ohne Eintrag der letzten Stunde ehrlich als „Letzte Entscheidungen"', async () => {
    stelleBereit({
      ...volleDaten,
      etb: [{ ...volleDaten.etb[0], ereigniszeit: vor(200) }],
    });
    rendern();
    const p = await waitFor(() => paneel('Letzte Entscheidungen'));
    expect(await within(p).findByText('keine in der letzten Stunde')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Entscheidungen der letzten Stunde' })).toBeNull();
  });

  it('Nächste Marken: Fristen aus Aufträgen, Erinnerungen und Lagebesprechung, mit Wort', async () => {
    stelleBereit(volleDaten);
    rendern();
    const p = await waitFor(() => paneel('Nächste Marken'));
    await within(p).findByText('Lagebesprechung');
    const marken = within(p).getAllByRole('link');
    expect(marken.map((m) => m.getAttribute('data-ton'))).toEqual([
      'alarm',
      'achtung',
      'neutral',
      'neutral',
    ]);
    expect(marken[0]).toHaveTextContent('überfällig');
    expect(marken[0]).toHaveAttribute('href', '/einsaetze/1/auftraege?auftrag=22');
    expect(marken[1]).toHaveTextContent('Lagebericht an Kreisstab');
    expect(marken[1]).toHaveAttribute('href', '/einsaetze/1/erinnerungen');
    expect(marken[3]).toHaveAttribute('href', '/einsaetze/1/stab');
  });

  it('Nächste Marken: offene Pegel-Prognose führt in die Pegel-Einstellungen, verstrichene fehlt (LFH-628)', async () => {
    // Wire-Zeit UTC ohne Zone, relativ zur echten Uhr (die Seite rechnet mit ihr).
    const wire = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
    const prognose = (ms: number) => ({
      hoechststand_cm: 710,
      zeitpunkt: wire(ms),
      gesetzt_at: wire(Date.now()),
    });
    stelleBereit({
      ...volleDaten,
      pegel: [
        { ...leitpegel(null), prognose: prognose(Date.now() + 3 * 3_600_000) },
        {
          ...leitpegel(null),
          id: 2,
          station_uuid: '5f9c1b54-3c41-4d93-bb48-2b7c7c3f5a61',
          name: 'WAHNHAUSEN',
          gewaesser: 'FULDA',
          reihenfolge: 1,
          prognose: prognose(Date.now() - 3_600_000),
        },
      ],
    });
    rendern();
    const p = await waitFor(() => paneel('Nächste Marken'));
    const marke = await within(p).findByRole('link', {
      name: /Erwarteter Höchststand Pegel HANN\. MÜNDEN \(WESER\): 7,10 m/,
    });
    expect(marke).toHaveAttribute('href', '/einsaetze/1/einstellungen/pegel');
    expect(marke).toHaveAttribute('data-ton', 'neutral');
    expect(within(p).queryByText(/Pegel WAHNHAUSEN/)).toBeNull();
  });

  it('Leerzustand: jedes Paneel sagt „nichts da" und bietet, wo sinnvoll, eine Aktion', async () => {
    stelleBereit({
      personen: [],
      personal: [],
      fahrzeuge: [],
      material: [],
      einheiten: [],
      abschnitte: [],
      gefahren: [],
      auftraege: [],
      erinnerungen: [],
      etb: [],
    } as unknown as Daten);
    server.use(
      http.get('/api/einsaetze/1', () =>
        HttpResponse.json({ ...einsatz, naechste_lagebesprechung_at: null }),
      ),
    );
    rendern();
    expect(await screen.findByText('Keine offenen Aufträge.')).toBeInTheDocument();
    expect(
      await screen.findByText('Noch keine Entscheidung im Einsatztagebuch.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Keine anstehenden Fristen.')).toBeInTheDocument();
    expect(
      await screen.findByText('Noch keine Abschnitte und keine Kräfte erfasst.'),
    ).toBeInTheDocument();
    expect(within(band()).getByText('keine')).toBeInTheDocument();
    expect(within(band()).getByText('noch keine angelegt')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Eintrag erfassen' }));
    expect(screen.getByTestId('ort')).toHaveTextContent('/einsaetze/1/etb?neu=1');
  });

  /*
   * Review 22.09.2026: die Schreibwege der Seite trugen keinen Rechte-Riegel. Getestet als
   * PAAR — mit Recht stehen die Leer-Aktionen (oben: „Eintrag erfassen"), ohne Recht fehlen
   * sie, und die Primäraktion steht gesperrt mit Grund (C10/M16, C11/M45).
   */
  const leereDaten = {
    personen: [],
    personal: [],
    fahrzeuge: [],
    material: [],
    einheiten: [],
    abschnitte: [],
    gefahren: [],
    auftraege: [],
    erinnerungen: [],
    etb: [],
  } as unknown as Daten;

  it('mit Schreibrecht: Leer-Aktion „Abschnitt anlegen", kein Rechtehinweis', async () => {
    stelleBereit(leereDaten);
    rendern();
    await userEvent.click(await screen.findByRole('button', { name: 'Abschnitt anlegen' }));
    expect(screen.getByTestId('ort')).toHaveTextContent('/einsaetze/1/einsatzabschnitte');
  });

  it('mit Schreibrecht: „Eintrag" bedienbar, kein Rechtehinweis', async () => {
    stelleBereit(volleDaten);
    rendern();
    await screen.findByText('Hochwasser Weserlauf');
    expect(screen.getByRole('button', { name: 'Eintrag' })).toBeEnabled();
    expect(screen.queryByText(/Nur Einsatzleitung und Führungspersonal/)).toBeNull();
  });

  it('ohne Schreibrecht: „Eintrag" gesperrt mit Grund, Leer-Aktionen zum Schreiben fehlen', async () => {
    stelleBereit(leereDaten, [
      http.get('/api/einsaetze/1', () =>
        HttpResponse.json({ ...einsatz, meine_rolle: 'beobachter' }),
      ),
    ]);
    rendern();
    expect(await screen.findByText(/Nur Einsatzleitung und Führungspersonal/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Eintrag' })).toBeDisabled();
    expect(
      await screen.findByText('Noch keine Entscheidung im Einsatztagebuch.'),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('Noch keine Abschnitte und keine Kräfte erfasst.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eintrag erfassen' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Abschnitt anlegen' })).toBeNull();
    // Reine Navigation bleibt: sie schreibt nichts.
    expect(screen.getByRole('button', { name: 'Zu den Aufträgen' })).toBeInTheDocument();
  });

  it('abgeschlossener Einsatz: der Grund nennt den Abschluss, nicht die Rolle', async () => {
    stelleBereit(volleDaten, [
      http.get('/api/einsaetze/1', () =>
        HttpResponse.json({ ...einsatz, status: 'abgeschlossen' }),
      ),
    ]);
    rendern();
    expect(await screen.findByText(/Der Einsatz ist abgeschlossen/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Eintrag' })).toBeDisabled();
  });

  it('Fehler ist nicht leer: ausgefallene Aufträge zeigen „Stand unbekannt", der Rest bleibt', async () => {
    stelleBereit(volleDaten, [
      http.get('/api/einsaetze/1/auftraege', () =>
        HttpResponse.json({ error: 'kaputt' }, { status: 500 }),
      ),
    ]);
    rendern();
    const p = await waitFor(() => paneel('Offene Aufträge'));
    expect(await within(p).findByRole('alert')).toHaveTextContent('Stand unbekannt');
    expect(within(p).getByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(within(p).queryByText('Keine offenen Aufträge.')).toBeNull();
    const auftragsZahl = within(band()).getByRole('link', { name: /Offene Aufträge/ });
    expect(auftragsZahl).toHaveTextContent('?');
    // Die Betroffenenzahl hängt an ihrer eigenen Quelle und bleibt lesbar.
    expect(within(band()).getByRole('link', { name: /Betroffene/ })).toHaveTextContent('3');
    // Die Folgeaufträge hängen seit LFH-636 am ETB-Eintrag, nicht an der Auftragsliste:
    // die Zahl bleibt stehen, und der frühere Ausfallhinweis ist weg.
    const entscheidungen = await waitFor(() => paneel('Entscheidungen der letzten Stunde'));
    expect(await within(entscheidungen).findByText('2 Aufträge')).toBeInTheDocument();
    expect(screen.queryByText(/Folgeaufträge werden nicht gezählt/)).toBeNull();
  });

  it('Ladezustand: Kennzahlen und Paneele zeigen „wird abgerufen", keine Null', async () => {
    const haengt = async () => {
      await delay('infinite');
      return HttpResponse.json([]);
    };
    stelleBereit(volleDaten, [
      http.get('/api/einsaetze/1/personen', haengt),
      http.get('/api/einsaetze/1/auftraege', haengt),
    ]);
    rendern();
    const betroffene = await within(band()).findByRole('link', { name: /Betroffene/ });
    expect(betroffene).toHaveTextContent('wird abgerufen');
    expect(betroffene.querySelector('[aria-busy="true"]')).not.toBeNull();
    const p = paneel('Offene Aufträge');
    expect(within(p).getByText('wird abgerufen')).toHaveAttribute('aria-busy', 'true');
    // Eine unabhängige Quelle lädt trotzdem durch.
    await waitFor(() =>
      expect(within(band()).getByRole('link', { name: /Warnstufe/ })).toHaveTextContent('hoch'),
    );
  });
});
