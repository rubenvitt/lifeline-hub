import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import EtbBausteineTab from './EtbBausteineTab';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-06-02 10:00:00',
};
const nichtAdmin = { ...admin, system_rolle: 'keiner' };

const bausteine = [
  { id: 1, label: 'Lage unverändert', typ: 'lage', inhalt: 'Lage unverändert.', meldeweg: null, veranlassung: null, sortier: 10 },
];

/**
 * Zweiter Baustein NUR für die Ordnungs-Prüfung, deshalb als Parameter und nicht in
 * `bausteine`: der Bestandstest greift „Bearbeiten" per `getByRole` (Einzahl), eine zweite
 * Zeile machte die Schaltfläche mehrdeutig. Er steht fachlich hinten (`sortier` 20) und
 * alphabetisch vorn — sonst sähe die Tabelle nach dem Sortierklick genauso aus wie davor.
 */
const zweiBausteine = [
  bausteine[0],
  {
    id: 2, label: 'Abschnitt gebildet', typ: 'entscheidung',
    inhalt: 'Einsatzabschnitt gebildet.', meldeweg: null, veranlassung: null, sortier: 20,
  },
];

/**
 * Die Leitspalte aller Datenzeilen — der Kopf ist ein eigenes `<table>`, siehe KatalogTabelle.
 *
 * Gegriffen wird die MARKE, nicht `td:first-child`: seit LFH-346 · A4 teilen Label und Inhalt
 * eine Zelle, deren `textContent` sonst „Lage unverändertLage unverändert." lautete. Die
 * Marke sitzt am Label-Knoten und hält die Aussage scharf, statt sie zu lockern.
 */
const labels = (c: HTMLElement) =>
  [...c.querySelectorAll('tr.ant-table-row [data-lfh="baustein-label"]')].map(
    (z) => z.textContent,
  );

/**
 * Der Eintrag IM Filtermenü. Das Typ-Label steht zweimal im Dokument — in der Zelle als `Tag`
 * und im Menü —, ein schlichtes `findByText` bräche an der Mehrdeutigkeit. Und das Menü hängt
 * in einem Portal unter `document.body`, nicht unter dem `container`.
 */
async function menueEintrag(text: string): Promise<HTMLElement> {
  const treffer = (await screen.findAllByText(text)).find((k) =>
    k.closest('.ant-table-filter-dropdown'),
  );
  if (!treffer) throw new Error(`Kein Filtereintrag „${text}" im Menü`);
  return treffer;
}

function render(benutzer: typeof admin, liste: unknown[] = bausteine) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/etb-bausteine', () => HttpResponse.json(liste)),
  );
  return renderMitProviders(
    <AuthProvider>
      <EtbBausteineTab />
    </AuthProvider>,
  );
}

describe('EtbBausteineTab', () => {
  it('zeigt Bausteine', async () => {
    render(admin);
    expect(await screen.findByText('Lage unverändert')).toBeInTheDocument();
  });

  it('Admin sieht Anlegen + Aktionen', async () => {
    render(admin);
    await screen.findByText('Lage unverändert');
    expect(screen.getByRole('button', { name: 'Baustein anlegen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument();
  });

  it('Nicht-Admin sieht keine Schreib-Aktionen', async () => {
    render(nichtAdmin);
    await screen.findByText('Lage unverändert');
    expect(screen.queryByRole('button', { name: 'Baustein anlegen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });

  it('Ordnung: die Leitspalte sortiert, Suche und Typ-Filter verengen', async () => {
    const { container } = render(admin, zweiBausteine);
    await screen.findByText('Lage unverändert');
    // Einstieg ist die fachliche Reihenfolge des Servers (`sortier`), nicht das Alphabet.
    expect(labels(container)).toEqual(['Lage unverändert', 'Abschnitt gebildet']);

    // Der Sortierauslöser sitzt in der Kopfzelle der fixierten Leitspalte. jsdom rechnet
    // dort kein Layout — dass der Klick auch am 390-px-Schirm ankommt, ist hier NICHT belegt.
    await userEvent.click(container.querySelector<HTMLElement>('th.ant-table-cell-fix-start')!);
    expect(labels(container)).toEqual(['Abschnitt gebildet', 'Lage unverändert']);

    // Gesucht wird über das LABEL — „gebildet" steht nur dort, nicht im zweiten Label.
    const feld = screen.getByPlaceholderText('Label');
    await userEvent.type(feld, 'gebildet');
    expect(labels(container)).toEqual(['Abschnitt gebildet']);
    await userEvent.clear(feld);
    expect(labels(container)).toHaveLength(2);

    // Die andere Hälfte derselben Zusicherung, und sie ist der Preis der Zwei-Zeilen-Zelle
    // (LFH-346 · A4): der Inhalt entsteht erst beim Rendern und trägt deshalb NICHT mehr zum
    // Suchkorpus bei — das Primitiv liest nur Spalten mit auflösbarem `dataIndex`.
    // „Einsatzabschnitt" steht ausschließlich im Inhalt der zweiten Zeile; „Abschnitt" allein
    // träfe deren Label mit und bewiese nichts.
    await userEvent.type(feld, 'Einsatzabschnitt');
    expect(labels(container)).toHaveLength(0);
    await userEvent.clear(feld);

    // Gefiltert wird die ZEILENMENGE, nicht die Anwesenheit des Trichters: antd zeichnet ihn
    // schon bei gesetztem `filters`, gefiltert wird aber erst mit `onFilter`.
    await userEvent.click(container.querySelector<HTMLElement>('.ant-table-filter-trigger')!);
    await userEvent.click(await menueEintrag('Lage'));
    await userEvent.click(
      document.querySelector<HTMLElement>('.ant-table-filter-dropdown-btns .ant-btn-primary')!,
    );
    expect(labels(container)).toEqual(['Lage unverändert']);
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
      http.get('/api/etb-bausteine', () => new HttpResponse(null, { status: 500 })),
    );
    renderMitProviders(
      <AuthProvider>
        <EtbBausteineTab />
      </AuthProvider>,
    );

    expect(await screen.findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Keine Bausteine')).not.toBeInTheDocument();
  });

  it('zeigt bei leerem Katalog den Leertext und KEINEN Fehler', async () => {
    render(admin, []);

    expect(await screen.findByText('Keine Bausteine')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });
});

/**
 * Zwei-Zeilen-Zelle und Freitext-Begrenzung (LFH-346 · A4, Befund N13).
 *
 * Label und Inhalt gehören zusammen gelesen („was fügt dieser Baustein ein?"), nicht
 * verglichen — als zwei Spalten zwangen sie den Blick zum Springen, und der ungekürzte
 * Inhalt trieb die Zeilenhöhe. Warum die Kappung an der ZELLE sitzt und nicht an der
 * Spalte, steht ausführlich und im Browser gemessen in
 * `karten/OnlineQuellenVerwaltung.test.tsx`.
 */
describe('EtbBausteineTab — Zwei-Zeilen-Zelle (LFH-346 · A4)', () => {
  const langerInhalt = `${'Einsatzabschnitt gebildet, Führung übernommen, Kräfte angefordert. '.repeat(4)}Ende`;

  it('trägt Label und Inhalt in EINER Zelle, gekürzt und mit Tooltip', async () => {
    const { container } = render(admin, [{ ...bausteine[0], inhalt: langerInhalt }]);
    await screen.findByText('Lage unverändert');

    // Eine Spalte statt zweier: die Kopfzeile kennt „Inhalt" nicht mehr.
    expect(screen.getByRole('columnheader', { name: /Baustein/ })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Inhalt' })).not.toBeInTheDocument();

    // Beide Werte im SELBEN `<td>` — sonst wäre die Zelle nur umbenannt, nicht vereint.
    const labelKnoten = container.querySelector('[data-lfh="baustein-label"]')!;
    const zelle = labelKnoten.closest('td')!;
    expect(zelle).toContainElement(screen.getByText(langerInhalt));

    const tabelle = container.querySelector('.ant-table-tbody')!.closest('table')!;
    expect(tabelle.style.tableLayout).toBe('auto');
    expect(zelle).toHaveStyle({ maxWidth: '320px' });

    // Die Kürzung selbst rechnet der Browser; jsdom meldet keine Unterstützung. Belegbar ist,
    // DASS sie konfiguriert ist — antd setzt die Klasse unabhängig vom Messweg
    // (Muster `pages/lagekarte/Inspector.test.tsx`).
    expect(screen.getByText(langerInhalt)).toHaveClass('ant-typography-ellipsis');
  });

  it('nennt im Suchplatzhalter nur, was die Suche wirklich liest', async () => {
    render(admin);
    await screen.findByText('Lage unverändert');
    // Der Inhalt ist mit der Zwei-Zeilen-Zelle aus dem Korpus gefallen (Wirkung: siehe
    // Ordnungs-Test oben). Ein Platzhalter, der ihn weiter verspräche, wäre eine Lüge.
    expect(screen.getByPlaceholderText('Label')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Label oder Inhalt')).not.toBeInTheDocument();
  });
});
