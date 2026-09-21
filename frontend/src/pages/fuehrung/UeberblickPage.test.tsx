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
  einheiten: [{ id: 10, name: 'Zug 1', abschnitt_id: 5, ueber_einheit_id: null, soll: null }],
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
      quell_etb_eintrag_id: 411,
      bearbeitungsstatus: 'vollzogen',
    }),
    auftrag({
      id: 24,
      auftrag_text: 'Folge B',
      quell_etb_eintrag_id: 411,
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
    },
  ],
};

type Daten = typeof volleDaten;

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
    // Warnstufe: das Wort ist der zweite Kanal — ohne Pegel-Notiz (LFH-606).
    expect(links[2]).toHaveTextContent('hoch');
    expect(links[2]).not.toHaveTextContent(/Pegel/);
    expect(b.getByText('davon 1 ü.')).toBeInTheDocument();
    expect(b.getByText('Abschnitt Nord')).toBeInTheDocument();
  });

  it('Abschnittszeile: Leiter, Stärke, Mittelverteilung ehrlich beschriftet, Auftrag, Deeplink', async () => {
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
    expect(zeile).toHaveAccessibleName(/1\s*bereit/);
    expect(zeile).toHaveAccessibleName(/1\s*Ausfall/);
    // Personal A bereit, B gebunden, Fahrzeug Ausfall — je Zelle das Wort für Vorleser.
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
    expect(within(p).getByText(/Mittel \(Fahrzeuge \+ Personal\)/)).toBeInTheDocument();
    expect(within(p).getByText('1 Abschnitte · 1 Einheiten')).toBeInTheDocument();
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
    // Folgeaufträge werden nicht still als „keine" gezeigt.
    expect(
      await screen.findByText('Aufträge nicht abrufbar — Folgeaufträge werden nicht gezählt.'),
    ).toBeInTheDocument();
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
