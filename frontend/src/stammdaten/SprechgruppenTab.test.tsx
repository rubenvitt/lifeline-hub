import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import SprechgruppenTab from './SprechgruppenTab';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-26 10:00:00',
};
const nichtAdmin = { ...admin, system_rolle: 'keiner' };

const sprechgruppe = {
  id: 1,
  einsatz_id: null,
  einsatz_lokal: false,
  bezeichnung: '412_F_DRK',
  betriebsart: 'TMO',
  // `as string | null`, damit eine Zeile den Hinweis auch weglassen kann — das braucht die
  // Korpus-Probe unten, siehe `aktivPaar`.
  hinweis: 'Führungskanal' as string | null,
  aktiv: true,
  sortier: 0,
};

/**
 * Das Paar für die Korpus- und die Filterprobe: eine aktive, eine deaktivierte Zeile.
 *
 * ALLE drei Spalten mit Datenbezug (Bezeichnung, Betriebsart, Hinweis) sind hier ausdrücklich
 * überschrieben, keine erbt aus `sprechgruppe`. Grund ist gemessen: dessen Hinweis
 * „Führungskanal" trägt BEIDE Suchfragmente der Probe — „ru" in F-üh-ru-ng und „al" in kan-al —
 * und machte die Zusicherung stumpf. `hinweis: null` hält die Zeilen frei von Zufallstreffern.
 */
const aktivPaar = [
  { ...sprechgruppe, id: 1, bezeichnung: '412_F_DRK', betriebsart: 'TMO', hinweis: null, aktiv: true },
  { ...sprechgruppe, id: 2, bezeichnung: '208_D_DRK', betriebsart: 'DMO', hinweis: null, aktiv: false },
];

/** Die Leitspalte aller Datenzeilen — der Kopf ist ein eigenes `<table>`, siehe KatalogTabelle. */
const bezeichnungen = (c: HTMLElement) =>
  [...c.querySelectorAll('tr.ant-table-row td:first-child')].map((z) => z.textContent);

function render(benutzer: typeof admin, liste: (typeof sprechgruppe)[] = [sprechgruppe]) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/sprechgruppen', () => HttpResponse.json(liste)),
  );
  return renderMitProviders(
    <AuthProvider>
      <SprechgruppenTab />
    </AuthProvider>,
  );
}

describe('SprechgruppenTab', () => {
  it('zeigt Katalog-Sprechgruppen', async () => {
    render(admin);
    expect(await screen.findByText('412_F_DRK')).toBeInTheDocument();
  });

  it('zeigt Betriebsart als Tag', async () => {
    render(admin);
    await screen.findByText('412_F_DRK');
    expect(screen.getByText('TMO')).toBeInTheDocument();
  });

  it('Admin sieht „Sprechgruppe anlegen" und Aktionen', async () => {
    render(admin);
    await screen.findByText('412_F_DRK');
    expect(screen.getByRole('button', { name: 'Sprechgruppe anlegen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument();
  });

  // Ordnung statt bloßer Anwesenheit: geprüft wird, was Suche, Sortierung und Filter mit den
  // Zeilen TUN.
  // Der Filterkorb hängt in einem Portal an `document.body`, nicht im Container — und der Text
  // „DMO" steht auch als Tag im Tabellenkörper, deshalb wird alles auf den Korb verengt.
  it('filtert nach Betriebsart und engt per Suche ein', async () => {
    const dmo = { ...sprechgruppe, id: 2, bezeichnung: '208_D_DRK', betriebsart: 'DMO' };
    // Die dritte Gruppe unterscheidet die numerische Kollation von der zeichenweisen: ohne
    // `numeric: true` sortiert 42_… hinter 412_… (gemessen mit localeCompare('de')).
    const kurz = { ...sprechgruppe, id: 3, bezeichnung: '42_F_DRK' };
    const { container } = render(admin, [sprechgruppe, dmo, kurz]);
    await screen.findByText('412_F_DRK');
    expect(bezeichnungen(container)).toEqual(['412_F_DRK', '208_D_DRK', '42_F_DRK']);

    // Erst die Suche — sie lässt sich leeren; die Filterauswahl käme danach nur über die
    // „Reset"-Schaltfläche zurück, und die ist nach dem Anwenden deaktiviert (gemessen:
    // user-event bricht dort mit `pointer-events: none` ab).
    const feld = screen.getByPlaceholderText(/Bezeichnung/);
    await userEvent.type(feld, '412');
    await waitFor(() => expect(bezeichnungen(container)).toEqual(['412_F_DRK']));
    await userEvent.clear(feld);
    await waitFor(() => expect(bezeichnungen(container)).toHaveLength(3));

    // Aufsteigend nach Bezeichnung, numerisch: 42 vor 208 vor 412. Zeichenweise käme
    // 208, 412, 42 heraus — die Erwartung fällt also auch, wenn nur `numeric: true` verschwindet.
    await userEvent.click(screen.getByRole('columnheader', { name: /Bezeichnung/ }));
    await waitFor(() =>
      expect(bezeichnungen(container)).toEqual(['42_F_DRK', '208_D_DRK', '412_F_DRK']),
    );

    const kopf = screen.getByRole('columnheader', { name: /Betriebsart/ });
    await userEvent.click(kopf.querySelector('.ant-table-filter-trigger') as HTMLElement);
    const korb = document.querySelector('.ant-table-filter-dropdown') as HTMLElement;
    await userEvent.click(within(korb).getByText('DMO'));
    // `test/utils.tsx` montiert `ConfigProvider` ohne Locale — die Schaltfläche heißt „OK".
    await userEvent.click(within(korb).getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(bezeichnungen(container)).toEqual(['208_D_DRK']));
  });

  /**
   * Die Aktiv-Spalte darf NICHTS zum Suchkorpus des Primitivs beitragen, das die ROHWERTE der
   * Spalten mit `dataIndex` liest. Gemessen mit `dataIndex: 'aktiv'`: „al" traf jede INAKTIVE
   * Zeile (Rohwert `false`), „ru" jede aktive (`true`) — Treffer ohne jede Entsprechung im
   * Sichtbaren.
   *
   * Die Kontrollsuche steht vorweg und ist nicht Zierde: ohne sie wäre die leere Erwartung auch
   * dann grün, wenn das Feld gar nicht gefunden oder der Platzhalter vertippt wäre.
   */
  it('die Aktiv-Spalte trägt nichts zum Suchkorpus bei', async () => {
    const { container } = render(admin, aktivPaar);
    await screen.findByText('412_F_DRK');
    const feld = screen.getByPlaceholderText(/Bezeichnung/);

    await userEvent.type(feld, '412');
    await waitFor(() => expect(bezeichnungen(container)).toEqual(['412_F_DRK']));
    await userEvent.clear(feld);
    await waitFor(() => expect(bezeichnungen(container)).toHaveLength(2));

    await userEvent.type(feld, 'al');
    await waitFor(() => expect(bezeichnungen(container)).toEqual([]));
    await userEvent.clear(feld);
    await waitFor(() => expect(bezeichnungen(container)).toHaveLength(2));

    await userEvent.type(feld, 'ru');
    await waitFor(() => expect(bezeichnungen(container)).toEqual([]));
  });

  /**
   * Die zweite Filterachse, eigens geprüft, weil ihre Filterwerte BOOLEANS sind. Antds
   * `React.Key | boolean`-Typisierung nimmt auch die Zeichenkette `'false'` an: der Vertipper
   * compiliert, matcht aber nie — er fällt ausschließlich über die Zeilenmenge auf, nicht über
   * `tsc` (gemessen). Vorher war die Achse ganz ungeprüft: ein `onFilter: () => true` ließ die
   * Datei grün.
   */
  it('der Aktiv-Filter verengt auf die deaktivierten Zeilen', async () => {
    const { container } = render(admin, aktivPaar);
    await screen.findByText('412_F_DRK');
    expect(bezeichnungen(container)).toHaveLength(2);

    // `/^Aktiv/` statt `/Aktiv/`: die Aktionen-Spalte steht direkt daneben, und eine
    // Umbenennung dort soll die Auswahl hier nicht mehrdeutig machen.
    const kopf = screen.getByRole('columnheader', { name: /^Aktiv/ });
    await userEvent.click(kopf.querySelector('.ant-table-filter-trigger') as HTMLElement);
    const korb = document.querySelector('.ant-table-filter-dropdown') as HTMLElement;
    // „Inaktiv" steht auch als Tag im Tabellenkörper, deshalb auf den Korb verengt.
    await userEvent.click(within(korb).getByText('Inaktiv'));
    await userEvent.click(within(korb).getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(bezeichnungen(container)).toEqual(['208_D_DRK']));
  });

  it('Nicht-Admin sieht keine Schreib-Aktionen', async () => {
    render(nichtAdmin);
    await screen.findByText('412_F_DRK');
    expect(screen.queryByRole('button', { name: 'Sprechgruppe anlegen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });
});
