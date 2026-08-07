import { http, HttpResponse } from 'msw';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import PersonalTab from './PersonalTab';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-26 10:00:00',
};
const nichtAdmin = { ...admin, system_rolle: 'keiner' };

const personal = [
  {
    id: 1, benutzer_id: null, name: 'Thomas Müller', personalnummer: '4711',
    traegerorganisation: 'DRK', telefon: null, staerke_position: 'fuehrer',
    bemerkung: null, dienststatus: 'in_dienst', angelegt_at: '2026-05-26 10:00:00',
    qualifikationen: [{ id: 1, label: 'Sanitäter' }],
  },
];

/**
 * Zweite Person NUR für die Ordnungs-Prüfung, deshalb als Parameter und nicht in `personal`:
 * die Bestandstests greifen ihre Knöpfe per `getByRole` (Einzahl), eine zweite Zeile brächte
 * eine zweite „Bearbeiten"-Schaltfläche und machte sie mehrdeutig. Absichtlich NICHT
 * alphabetisch hinter „Thomas Müller" — sonst wäre die Reihenfolge nach dem Sortierklick
 * dieselbe wie davor und die Zusicherung bewiese nichts.
 *
 * Der Umlaut in „Ömer" ist der Grund für genau diesen Namen und keinen anderen: „Ö" ist
 * byteweise (U+00D6) HINTER „T", sprachbewusst nach DIN 5007-1 aber davor. Damit fällt die
 * Sortier-Zusicherung auch, wenn nur das `localeCompare(…, 'de')` der Leitspalte zu einem
 * schlichten Zeichenvergleich verkommt — vorher blieb sie bei dieser Mutation grün (gemessen).
 * Wer den Namen „normalisiert", nimmt der Prüfung ihren Zweck.
 */
const zweiPersonen = [
  personal[0],
  {
    ...personal[0], id: 2, name: 'Ömer Berg', personalnummer: '0815',
    traegerorganisation: 'THW', staerke_position: 'mannschaft',
    dienststatus: 'ausser_dienst', qualifikationen: [],
  },
];

/** Die Leitspalte aller Datenzeilen — der Kopf ist ein eigenes `<table>`, siehe KatalogTabelle. */
const namen = (c: HTMLElement) =>
  [...c.querySelectorAll('tr.ant-table-row td:first-child')].map((z) => z.textContent);

/**
 * Der Eintrag IM Filtermenü. Der gesuchte Text steht zweimal im Dokument — in der Zelle als
 * `Tag` und im Menü —, ein schlichtes `findByText` bräche also an der Mehrdeutigkeit. Und das
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
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/personal', () => HttpResponse.json(liste)),
    http.get('/api/personal-vorschlaege', () => HttpResponse.json({ traegerorganisation: ['DRK'] })),
    http.get('/api/qualifikationen', () => HttpResponse.json([{ id: 1, label: 'Sanitäter', sortier: 10 }])),
    http.get('/api/benutzer', () => HttpResponse.json([])),
  );
  return renderMitProviders(
    <AuthProvider>
      <PersonalTab />
    </AuthProvider>,
  );
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

  it('sperrt während des Dienststatuswechsels alle Zeilen und markiert nur das Ziel als ladend', async () => {
    let freigeben: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { freigeben = resolve; });
    server.use(http.post('/api/personal/1/ausser-dienst', async () => {
      await gate;
      return HttpResponse.json({ ...personal[0], dienststatus: 'ausser_dienst' });
    }));
    const { container } = render(admin, [personal[0], { ...personal[0], id: 2, name: 'Erika Muster' }]);
    await screen.findByText('Thomas Müller');
    const erste = container.querySelector('[data-row-key="1"]') as HTMLElement;
    const zweite = container.querySelector('[data-row-key="2"]') as HTMLElement;

    await userEvent.click(within(erste).getByRole('button', { name: 'Außer Dienst' }));
    await userEvent.click(await screen.findByRole('button', { name: 'OK' }));

    expect(within(erste).getByRole('button', { name: /Außer Dienst/ })).toBeDisabled();
    expect(within(erste).getByRole('button', { name: /Außer Dienst/ })).toHaveClass('ant-btn-loading');
    expect(within(zweite).getByRole('button', { name: 'Außer Dienst' })).toBeDisabled();
    expect(within(zweite).getByRole('button', { name: 'Außer Dienst' })).not.toHaveClass('ant-btn-loading');
    expect(within(zweite).getByRole('button', { name: 'Bearbeiten' })).toBeDisabled();
    await act(async () => { freigeben?.(); });
  });

  it('Nicht-Admin sieht keine Schreib-Aktionen', async () => {
    render(nichtAdmin);
    await screen.findByText('Thomas Müller');
    expect(screen.queryByRole('button', { name: 'Person anlegen' })).not.toBeInTheDocument();
  });

  it('Ordnung: die Leitspalte sortiert, Suche und Dienststatus-Filter verengen', async () => {
    const { container } = render(admin, zweiPersonen);
    await screen.findByText('Thomas Müller');
    expect(namen(container)).toEqual(['Thomas Müller', 'Ömer Berg']);

    // Der Sortierauslöser sitzt in der Kopfzelle der fixierten Leitspalte. jsdom rechnet
    // dort kein Layout — dass der Klick auch am 390-px-Schirm ankommt, ist hier NICHT belegt.
    // Die Erwartung ist zugleich die Kollationsprobe: byteweise käme „Ömer" hinter „Thomas",
    // die Reihenfolge bliebe also die der Serverantwort.
    await userEvent.click(container.querySelector<HTMLElement>('th.ant-table-cell-fix-start')!);
    expect(namen(container)).toEqual(['Ömer Berg', 'Thomas Müller']);

    // Träger: eine Spalte mit Datenbezug, deren Rohwert ein Mensch auch so tippt.
    const feld = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await userEvent.type(feld, 'THW');
    expect(namen(container)).toEqual(['Ömer Berg']);
    await userEvent.clear(feld);
    expect(namen(container)).toHaveLength(2);

    // Gefiltert wird die ZEILENMENGE, nicht die Anwesenheit des Trichters: antd zeichnet ihn
    // schon bei gesetztem `filters`, gefiltert wird aber erst mit `onFilter`.
    // Der Trichter wird über seine Kopfzelle gegriffen, nicht als einziger im Container: heute
    // ist Status die einzige filterbare Spalte, morgen ist es vielleicht nicht mehr so.
    await userEvent.click(statusTrichter());
    await userEvent.click(await menueEintrag('in Dienst'));
    await userEvent.click(
      document.querySelector<HTMLElement>('.ant-table-filter-dropdown-btns .ant-btn-primary')!,
    );
    expect(namen(container)).toEqual(['Thomas Müller']);
  });

  /**
   * Die Stärke-Position darf NICHTS zum Suchkorpus des Primitivs beitragen, das die ROHWERTE
   * der Spalten mit `dataIndex` liest. Gemessen mit `dataIndex: 'staerke_position'`: „mann"
   * und „sch" trafen jede Mannschafts-Person (Rohwert `mannschaft`), während „Führer" mit
   * Umlaut nichts traf — genau verkehrt herum zu dem, was der Platzhalter verspricht.
   *
   * Die Kontrollsuche steht vorweg und ist nicht Zierde: ohne sie wäre die leere Erwartung auch
   * dann grün, wenn das Suchfeld gar nicht gefunden wäre.
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
   * Der zweite Filterwert. Er stand ungeprüft: mit `value: 'voellig_falsch'` statt
   * `'ausser_dienst'` blieb die Datei grün (gemessen) — belegt war nur die halbe Achse.
   * Eigener `it` mit frischem Rendern, weil sich die Auswahl im Filtermenü nach dem Anwenden
   * nicht verlässlich zurücknehmen lässt (die „Reset"-Schaltfläche ist dort deaktiviert,
   * gemessen in `SprechgruppenTab.test.tsx`).
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
   * Das Partnerpaar zu AK4 (LFH-331 · B3). Die negative Hälfte allein belegte nichts:
   * änderte man den Leertext beim Umbau, wäre sie auch im Leerfall trivial grün. Erst
   * die positive Hälfte darunter — gleiches Literal, gleiche Datei — macht sie zu einer
   * Aussage über die Zustandsweiche statt über die Schreibweise eines Strings.
   */
  it('zeigt bei gescheitertem Abruf den Fehler und NICHT den Leertext', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/personal', () => new HttpResponse(null, { status: 500 })),
      http.get('/api/personal-vorschlaege', () => HttpResponse.json({ traegerorganisation: [] })),
      http.get('/api/qualifikationen', () => HttpResponse.json([])),
      http.get('/api/benutzer', () => HttpResponse.json([])),
    );
    renderMitProviders(
      <AuthProvider>
        <PersonalTab />
      </AuthProvider>,
    );

    expect(await screen.findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Noch kein Personal')).not.toBeInTheDocument();
  });

  it('zeigt bei leerem Katalog den Leertext und KEINEN Fehler', async () => {
    render(admin, []);

    expect(await screen.findByText('Noch kein Personal')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });
});
