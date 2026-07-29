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

/** Die Leitspalte aller Datenzeilen — der Kopf ist ein eigenes `<table>`, siehe KatalogTabelle. */
const labels = (c: HTMLElement) =>
  [...c.querySelectorAll('tr.ant-table-row td:first-child')].map((z) => z.textContent);

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

    // „Einsatzabschnitt" steht NUR im Inhalt, nicht im Label — die Suche greift also
    // nachweislich über beide Textspalten, wie es der Platzhalter verspricht.
    const feld = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await userEvent.type(feld, 'Einsatzabschnitt');
    expect(labels(container)).toEqual(['Abschnitt gebildet']);
    await userEvent.clear(feld);
    expect(labels(container)).toHaveLength(2);

    // Gefiltert wird die ZEILENMENGE, nicht die Anwesenheit des Trichters: antd zeichnet ihn
    // schon bei gesetztem `filters`, gefiltert wird aber erst mit `onFilter`.
    await userEvent.click(container.querySelector<HTMLElement>('.ant-table-filter-trigger')!);
    await userEvent.click(await menueEintrag('Lage'));
    await userEvent.click(
      document.querySelector<HTMLElement>('.ant-table-filter-dropdown-btns .ant-btn-primary')!,
    );
    expect(labels(container)).toEqual(['Lage unverändert']);
  });
});
