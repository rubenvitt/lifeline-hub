import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
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
 */
const zweiPersonen = [
  personal[0],
  {
    ...personal[0], id: 2, name: 'Anna Berg', personalnummer: '0815',
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

  it('Nicht-Admin sieht keine Schreib-Aktionen', async () => {
    render(nichtAdmin);
    await screen.findByText('Thomas Müller');
    expect(screen.queryByRole('button', { name: 'Person anlegen' })).not.toBeInTheDocument();
  });

  it('Ordnung: die Leitspalte sortiert, Suche und Dienststatus-Filter verengen', async () => {
    const { container } = render(admin, zweiPersonen);
    await screen.findByText('Thomas Müller');
    expect(namen(container)).toEqual(['Thomas Müller', 'Anna Berg']);

    // Der Sortierauslöser sitzt in der Kopfzelle der fixierten Leitspalte. jsdom rechnet
    // dort kein Layout — dass der Klick auch am 390-px-Schirm ankommt, ist hier NICHT belegt.
    await userEvent.click(container.querySelector<HTMLElement>('th.ant-table-cell-fix-start')!);
    expect(namen(container)).toEqual(['Anna Berg', 'Thomas Müller']);

    // Träger: eine Spalte mit Datenbezug, deren Rohwert ein Mensch auch so tippt.
    const feld = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await userEvent.type(feld, 'THW');
    expect(namen(container)).toEqual(['Anna Berg']);
    await userEvent.clear(feld);
    expect(namen(container)).toHaveLength(2);

    // Gefiltert wird die ZEILENMENGE, nicht die Anwesenheit des Trichters: antd zeichnet ihn
    // schon bei gesetztem `filters`, gefiltert wird aber erst mit `onFilter`.
    await userEvent.click(container.querySelector<HTMLElement>('.ant-table-filter-trigger')!);
    await userEvent.click(await menueEintrag('in Dienst'));
    await userEvent.click(
      document.querySelector<HTMLElement>('.ant-table-filter-dropdown-btns .ant-btn-primary')!,
    );
    expect(namen(container)).toEqual(['Thomas Müller']);
  });
});
