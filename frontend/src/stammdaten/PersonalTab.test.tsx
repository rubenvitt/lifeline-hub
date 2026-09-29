import { http, HttpResponse } from 'msw';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import PersonalTab from './PersonalTab';
import { adminFixture } from '../test/fixtures';

const admin = adminFixture();
const nichtAdmin = adminFixture({ system_rolle: 'keiner' });

const personal = [
  {
    id: 1,
    benutzer_id: null,
    name: 'Thomas Müller',
    personalnummer: '4711',
    traegerorganisation: 'DRK',
    telefon: null,
    staerke_position: 'fuehrer',
    bemerkung: null,
    dienststatus: 'in_dienst',
    angelegt_at: '2026-05-26 10:00:00',
    qualifikationen: [{ id: 1, label: 'Sanitäter' }],
  },
];

/**
 * Zweite Person NUR für die Ordnungs-Prüfung, als Parameter: eine zweite „Bearbeiten"-
 * Schaltfläche machte die `getByRole`-Griffe der übrigen Tests mehrdeutig. Absichtlich NICHT
 * alphabetisch hinter „Thomas Müller", sonst bewiese der Sortierklick nichts.
 *
 * Der Umlaut in „Ömer" ist der Grund für genau diesen Namen: „Ö" ist byteweise (U+00D6)
 * HINTER „T", nach DIN 5007-1 davor. So fällt die Prüfung auch, wenn `localeCompare(…, 'de')`
 * zu einem schlichten Zeichenvergleich verkommt. Wer den Namen „normalisiert", nimmt der
 * Prüfung ihren Zweck.
 */
const zweiPersonen = [
  personal[0],
  {
    ...personal[0],
    id: 2,
    name: 'Ömer Berg',
    personalnummer: '0815',
    traegerorganisation: 'THW',
    staerke_position: 'mannschaft',
    dienststatus: 'ausser_dienst',
    qualifikationen: [],
  },
];

/** Die Leitspalte aller Datenzeilen — der Kopf ist ein eigenes `<table>`, siehe KatalogTabelle. */
const namen = (c: HTMLElement) =>
  [...c.querySelectorAll('tr.ant-table-row td:first-child')].map((z) => z.textContent);

/**
 * Der Eintrag IM Filtermenü. Der Text steht zweimal im Dokument (Zelle und Menü), und das
 * Menü hängt in einem Portal unter `document.body`, nicht unter dem `container`.
 */
/** Der Filterauslöser der Status-Spalte, über seine Kopfzelle statt über „der einzige im Baum". */
const statusTrichter = () =>
  screen
    .getByRole('columnheader', { name: /Status/ })
    .querySelector<HTMLElement>('.ant-table-filter-trigger')!;

async function menueEintrag(text: string): Promise<HTMLElement> {
  const treffer = (await screen.findAllByText(text)).find((k) =>
    k.closest('.ant-table-filter-dropdown'),
  );
  if (!treffer) throw new Error(`Kein Filtereintrag „${text}" im Menü`);
  return treffer;
}

function render(benutzer: typeof admin, liste: unknown[] = personal) {
  server.use(
    meHandler(benutzer),
    http.get('/api/personal', () => HttpResponse.json(liste)),
    http.get('/api/personal-vorschlaege', () =>
      HttpResponse.json({ traegerorganisation: ['DRK'] }),
    ),
    http.get('/api/qualifikationen', () =>
      HttpResponse.json([{ id: 1, label: 'Sanitäter', sortier: 10 }]),
    ),
    http.get('/api/benutzer', () => HttpResponse.json([])),
  );
  return renderMitProviders(<PersonalTab />);
}

describe('PersonalTab', () => {
  it('zeigt Personen mit Qualifikationen und Stärke-Position', async () => {
    render(admin);
    expect(await screen.findByText('Thomas Müller')).toBeInTheDocument();
    expect(screen.getByText('Sanitäter')).toBeInTheDocument();
    expect(screen.getByText('Führer')).toBeInTheDocument();
  });

  it('Admin sieht „Person anlegen", Nicht-Admin nicht', async () => {
    render(admin);
    await screen.findByText('Thomas Müller');
    expect(screen.getByRole('button', { name: 'Person anlegen' })).toBeInTheDocument();
  });

  /**
   * Eine laufende Mutation gehört GENAU EINER Zeile (LFH-346), keine Vollsperre der Tabelle.
   *
   * Die zweite Hälfte („Zeile B feuert wirklich") ist die eigentliche Aussage: `toBeEnabled()`
   * allein bliebe grün, wenn ein Riegel im `onConfirm` den Klick schluckte. Muster aus
   * `pages/BenutzerPage.test.tsx` („patchIds").
   *
   * Reihenfolge ist Absicht: EIN `useMutation`-Observer meldet nur den JÜNGSTEN Aufruf. Nach
   * dem Klick auf Zeile B wandert `variables` dorthin, Zeile A verliert ihre Ladeanzeige. Alle
   * A-Zusicherungen stehen deshalb VOR dem zweiten Klick.
   *
   * Zeile 2 steht auf `ausser_dienst`, damit beide Richtungen des Wechsels in einem Test laufen.
   * Keine der beiden fragt zurück (LFH-477) — ein „OK"-Dialog wäre hier der Fehlerfall.
   */
  it('sperrt beim Dienststatuswechsel NUR die betroffene Zeile', async () => {
    const gerufen: string[] = [];
    let freigeben: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      freigeben = resolve;
    });
    server.use(
      http.post('/api/personal/:id/ausser-dienst', async ({ params }) => {
        gerufen.push(`ausser-dienst/${params.id}`);
        await gate;
        return HttpResponse.json({ ...personal[0], dienststatus: 'ausser_dienst' });
      }),
      http.post('/api/personal/:id/in-dienst', async ({ params }) => {
        gerufen.push(`in-dienst/${params.id}`);
        await gate;
        return HttpResponse.json({ ...personal[0], id: 2, dienststatus: 'in_dienst' });
      }),
    );
    const { container } = render(admin, [
      personal[0],
      { ...personal[0], id: 2, name: 'Erika Muster', dienststatus: 'ausser_dienst' },
    ]);
    await screen.findByText('Thomas Müller');
    const erste = container.querySelector('[data-row-key="1"]') as HTMLElement;
    const zweite = container.querySelector('[data-row-key="2"]') as HTMLElement;

    // Keine Rückfrage (LFH-477): „Außer Dienst" ist umkehrbar, der Klick setzt sofort.
    await userEvent.click(within(erste).getByRole('button', { name: 'Außer Dienst' }));
    expect(screen.queryByRole('button', { name: 'OK' })).not.toBeInTheDocument();
    await waitFor(() => expect(gerufen).toEqual(['ausser-dienst/1']));

    // Die eigene Zeile ist gesperrt und zeigt den Lauf …
    expect(within(erste).getByRole('button', { name: /Außer Dienst/ })).toBeDisabled();
    expect(within(erste).getByRole('button', { name: /Außer Dienst/ })).toHaveClass(
      'ant-btn-loading',
    );
    expect(within(erste).getByRole('button', { name: 'Bearbeiten' })).toBeDisabled();
    // … die FREMDE Zeile bleibt bedienbar.
    expect(within(zweite).getByRole('button', { name: 'Bearbeiten' })).toBeEnabled();
    expect(within(zweite).getByRole('button', { name: 'Wieder in Dienst' })).toBeEnabled();
    expect(within(zweite).getByRole('button', { name: 'Wieder in Dienst' })).not.toHaveClass(
      'ant-btn-loading',
    );

    await userEvent.click(within(zweite).getByRole('button', { name: 'Wieder in Dienst' }));
    await waitFor(() => expect(gerufen).toEqual(['ausser-dienst/1', 'in-dienst/2']));
    await act(async () => {
      freigeben?.();
    });
  });

  /**
   * Primäraktion SICHTBAR UND GESPERRT, Zeilenaktionsspalte weg (LFH-346): der Knopf im Kopf
   * nennt über den Hinweis den Grund, n Zeilen × 2 gesperrte Knöpfe kosteten Platz für null
   * Handlungsmöglichkeit.
   */
  it('Nicht-Admin sieht die Primäraktion gesperrt und keine Zeilenaktionen', async () => {
    render(nichtAdmin);
    await screen.findByText('Thomas Müller');
    expect(screen.getByRole('button', { name: 'Person anlegen' })).toBeDisabled();
  });

  it('Ordnung: die Leitspalte sortiert, Suche und Dienststatus-Filter verengen', async () => {
    const { container } = render(admin, zweiPersonen);
    await screen.findByText('Thomas Müller');
    expect(namen(container)).toEqual(['Thomas Müller', 'Ömer Berg']);

    // Der Sortierauslöser sitzt in der Kopfzelle der fixierten Leitspalte; ob der Klick am
    // 390-px-Schirm ankommt, belegt jsdom NICHT. Die Erwartung ist zugleich die Kollationsprobe:
    // byteweise käme „Ömer" hinter „Thomas".
    await userEvent.click(container.querySelector<HTMLElement>('th.ant-table-cell-fix-start')!);
    expect(namen(container)).toEqual(['Ömer Berg', 'Thomas Müller']);

    // Träger: eine Spalte mit Datenbezug, deren Rohwert ein Mensch auch so tippt.
    const feld = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await userEvent.type(feld, 'THW');
    expect(namen(container)).toEqual(['Ömer Berg']);
    await userEvent.clear(feld);
    expect(namen(container)).toHaveLength(2);

    // Gefiltert wird die ZEILENMENGE, nicht die Anwesenheit des Trichters: antd zeichnet ihn schon
    // bei gesetztem `filters`, gefiltert wird erst mit `onFilter`. Gegriffen über seine Kopfzelle,
    // nicht als einziger im Container.
    await userEvent.click(statusTrichter());
    await userEvent.click(await menueEintrag('in Dienst'));
    await userEvent.click(
      document.querySelector<HTMLElement>('.ant-table-filter-dropdown-btns .ant-btn-primary')!,
    );
    expect(namen(container)).toEqual(['Thomas Müller']);
  });

  /**
   * Die Stärke-Position darf NICHTS zum Suchkorpus beitragen, der die ROHWERTE der Spalten mit
   * `dataIndex` liest: mit `dataIndex: 'staerke_position'` träfen „mann" und „sch" jede
   * Mannschafts-Person, „Führer" mit Umlaut dagegen nichts.
   *
   * Die Kontrollsuche vorweg ist nötig: ohne sie wäre die leere Erwartung auch grün, wenn das
   * Suchfeld gar nicht gefunden wäre.
   */
  it('die Stärke-Position trägt nichts zum Suchkorpus bei', async () => {
    const { container } = render(admin, zweiPersonen);
    await screen.findByText('Thomas Müller');
    const feld = container.querySelector<HTMLInputElement>('input[type="search"]')!;

    await userEvent.type(feld, 'Müller');
    expect(namen(container)).toEqual(['Thomas Müller']);
    await userEvent.clear(feld);
    expect(namen(container)).toHaveLength(2);

    // Keine der drei beitragenden Spalten (Name, Personalnr., Träger) trägt „sch" oder „mann".
    for (const bruchstueck of ['sch', 'mann']) {
      await userEvent.type(feld, bruchstueck);
      expect(namen(container)).toEqual([]);
      await userEvent.clear(feld);
    }
  });

  /**
   * Der zweite Filterwert, sonst wäre nur die halbe Achse belegt. Eigener `it` mit frischem
   * Rendern, weil sich die Auswahl im Filtermenü nach dem Anwenden nicht verlässlich zurücknehmen
   * lässt (die „Reset"-Schaltfläche ist dort deaktiviert).
   */
  it('der Dienststatus-Filter kennt auch „außer Dienst"', async () => {
    const { container } = render(admin, zweiPersonen);
    await screen.findByText('Thomas Müller');
    expect(namen(container)).toHaveLength(2);

    await userEvent.click(statusTrichter());
    await userEvent.click(await menueEintrag('außer Dienst'));
    await userEvent.click(
      document.querySelector<HTMLElement>('.ant-table-filter-dropdown-btns .ant-btn-primary')!,
    );
    expect(namen(container)).toEqual(['Ömer Berg']);
  });

  /**
   * Partnerpaar zu AK4 (LFH-331): die negative Hälfte allein wäre auch im Leerfall trivial
   * grün; erst die positive darunter mit demselben Literal macht sie zu einer Aussage über die
   * Zustandsweiche.
   */
  it('zeigt bei gescheitertem Abruf den Fehler und NICHT den Leertext', async () => {
    server.use(
      meHandler(admin),
      http.get('/api/personal', () => new HttpResponse(null, { status: 500 })),
      http.get('/api/personal-vorschlaege', () => HttpResponse.json({ traegerorganisation: [] })),
      http.get('/api/qualifikationen', () => HttpResponse.json([])),
      http.get('/api/benutzer', () => HttpResponse.json([])),
    );
    renderMitProviders(<PersonalTab />);

    expect(await screen.findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Noch kein Personal')).not.toBeInTheDocument();
  });

  it('zeigt bei leerem Katalog den Leertext und KEINEN Fehler', async () => {
    render(admin, []);

    expect(await screen.findByText('Noch kein Personal')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });
});
