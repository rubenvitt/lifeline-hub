import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import QualifikationenTab from './QualifikationenTab';
import { adminFixture } from '../test/fixtures';

const admin = adminFixture();
const nichtAdmin = adminFixture({ system_rolle: 'keiner' });

/**
 * Die Fixture kommt in FACHLICHER Reihenfolge (`sortier` 10 vor 60), die zugleich NICHT die
 * alphabetische ist — sonst sähe die Tabelle nach dem Sortierklick genauso aus wie davor und
 * die Zusicherung unten bewiese nichts.
 */
const quals = [
  { id: 1, label: 'Sanitäter', sortier: 10 },
  { id: 2, label: 'Gruppenführer', sortier: 60 },
];

/** Die Leitspalte aller Datenzeilen — der Kopf ist ein eigenes `<table>`, siehe KatalogTabelle. */
const labels = (c: HTMLElement) =>
  [...c.querySelectorAll('tr.ant-table-row td:first-child')].map((z) => z.textContent);

// Die Fixture bleibt voreingestellt: der Ordnungs-Test unten hängt an genau diesen zwei
// Zeilen in dieser Reihenfolge. Der Parameter existiert nur für den leeren Katalog.
function render(benutzer: typeof admin, katalog: typeof quals = quals) {
  server.use(
    meHandler(benutzer),
    http.get('/api/qualifikationen', () => HttpResponse.json(katalog)),
  );
  return renderMitProviders(<QualifikationenTab />);
}

describe('QualifikationenTab', () => {
  it('zeigt Qualifikationen', async () => {
    render(admin);
    expect(await screen.findByText('Sanitäter')).toBeInTheDocument();
    expect(screen.getByText('Gruppenführer')).toBeInTheDocument();
  });

  // Zahlen stehen Mono mit `tabular-nums`, das Label nicht.
  it('setzt die Sortierung in die Zahlenschrift, das Label nicht', async () => {
    render(admin);
    await screen.findByText('Sanitäter');
    const zahl = screen.getByText('60');
    expect(zahl.style.fontFamily).toContain('JetBrains Mono');
    expect(zahl.style.fontVariantNumeric).toBe('tabular-nums');
    expect(screen.getByText('Gruppenführer').style.fontFamily).toBe('');
  });

  it('Admin sieht „Qualifikation anlegen"', async () => {
    render(admin);
    await screen.findByText('Sanitäter');
    expect(screen.getByRole('button', { name: 'Qualifikation anlegen' })).toBeEnabled();
  });

  /**
   * Zwei Zuschnitte (LFH-346): die PRIMÄRAKTION steht gesperrt — versteckt wäre „kein Recht"
   * von „diese Seite kann das nicht" nicht zu unterscheiden; den Grund nennt der Hinweis. Die
   * ZEILENAKTIONEN entfallen: n Zeilen × 2 gesperrte Knöpfe kosteten Platz für null
   * Handlungsmöglichkeit.
   */
  it('Nicht-Admin: Primäraktion GESPERRT, Zeilenaktionen weg', async () => {
    render(nichtAdmin);
    await screen.findByText('Sanitäter');
    expect(screen.getByRole('button', { name: 'Qualifikation anlegen' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deaktivieren' })).not.toBeInTheDocument();
  });

  it('Ordnung: die Leitspalte sortiert, die Suche verengt, ein Filter fehlt mit Grund', async () => {
    const { container } = render(admin);
    await screen.findByText('Sanitäter');
    // Einstieg ist die fachliche Reihenfolge des Servers, nicht das Alphabet.
    expect(labels(container)).toEqual(['Sanitäter', 'Gruppenführer']);

    // Der Sortierauslöser sitzt in der Kopfzelle der fixierten Leitspalte; ob der Klick am
    // 390-px-Schirm ankommt, belegt jsdom NICHT.
    await userEvent.click(container.querySelector<HTMLElement>('th.ant-table-cell-fix-start')!);
    expect(labels(container)).toEqual(['Gruppenführer', 'Sanitäter']);

    await userEvent.type(
      container.querySelector<HTMLInputElement>('input[type="search"]')!,
      'Sani',
    );
    expect(labels(container)).toEqual(['Sanitäter']);

    // Kein Trichter, und das ist eine Aussage: der Katalog hat keine Status-/Kategoriespalte,
    // `aktiv` siebt schon der Server. Ein Filter ohne diese Spalte fiele hier auf.
    expect(container.querySelector('.ant-table-filter-trigger')).toBeNull();
  });

  /**
   * Partnerpaar zu AK4 (LFH-331): die negative Hälfte allein wäre auch im Leerfall trivial
   * grün; erst die positive darunter mit demselben Literal macht sie zu einer Aussage über die
   * Zustandsweiche.
   */
  it('zeigt bei gescheitertem Abruf den Fehler und NICHT den Leertext', async () => {
    server.use(
      meHandler(admin),
      http.get('/api/qualifikationen', () => new HttpResponse(null, { status: 500 })),
    );
    renderMitProviders(<QualifikationenTab />);

    expect(await screen.findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Keine Qualifikationen')).not.toBeInTheDocument();
  });

  it('zeigt bei leerem Katalog den Leertext und KEINEN Fehler', async () => {
    render(admin, []);

    expect(await screen.findByText('Keine Qualifikationen')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });

  /**
   * Geprüft wird der RUMPF, nicht bloß, dass gesendet wurde: ein Vorgabe-Objekt (`sortier: 0`)
   * kann still falsch sein, und ein Test, der nur zählt, bliebe grün.
   *
   * Der Knopf trägt den Namen des früheren Dialog-Knopfes, deshalb prüfen die Rechte-Prüfungen
   * oben dieselbe sichtbare Handlung.
   */
  it('die Schnellerfassung legt mit Label und Sortier-Vorgabe an', async () => {
    const ruempfe: unknown[] = [];
    server.use(
      http.post('/api/qualifikationen', async ({ request }) => {
        ruempfe.push(await request.json());
        return HttpResponse.json({ id: 9, label: 'Zugführer', sortier: 0 });
      }),
    );
    render(admin);
    await screen.findByText('Sanitäter');

    await userEvent.type(screen.getByLabelText('Neue Qualifikation'), 'Zugführer{Enter}');

    await waitFor(() => expect(ruempfe).toEqual([{ label: 'Zugführer', sortier: 0 }]));
  });

  /**
   * Der Dialog ist reines Bearbeiten, und kein anderer Test dieser Datei öffnet ihn: ohne diese
   * Prüfung schiffte eine kaputte Vorbelegung mit grüner Suite.
   */
  it('Bearbeiten öffnet den Dialog mit vorbelegten Werten', async () => {
    render(admin);
    await screen.findByText('Sanitäter');

    await userEvent.click(screen.getAllByRole('button', { name: 'Bearbeiten' })[0]);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Qualifikation bearbeiten')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Label')).toHaveValue('Sanitäter');
  });

  /**
   * Die Zusicherung der Hülle `ErfassungsModal`: Enter kommt aus der eingebauten
   * Formularübermittlung und greift nur, wenn der Knopf IM `<form>` liegt. Beide Hälften
   * zusammen sind die Aussage: keine antd-Fußzeile UND ein `form` als Vorfahr des Knopfes.
   */
  it('trägt keine antd-Fusszeile — der Absende-Knopf liegt im Formular', async () => {
    render(admin);
    await screen.findByText('Sanitäter');
    await userEvent.click(screen.getAllByRole('button', { name: 'Bearbeiten' })[0]);
    const dialog = await screen.findByRole('dialog');

    expect(dialog.querySelector('.ant-modal-footer')).toBeNull();
    expect(
      within(dialog).getByRole('button', { name: 'Speichern' }).closest('form'),
    ).not.toBeNull();
  });

  /** Die zweite Zusicherung der Hülle: der Fokus steht beim Öffnen im ersten Feld. */
  it('setzt den Fokus beim Öffnen ins erste Feld', async () => {
    render(admin);
    await screen.findByText('Sanitäter');
    await userEvent.click(screen.getAllByRole('button', { name: 'Bearbeiten' })[0]);

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByLabelText('Label')).toHaveFocus());
  });

  /**
   * `onErfassen` bekommt `mutateAsync`, nicht `mutate` — sonst löste die Hülle den Erfolgszweig
   * aus, während der Server ablehnt. Geprüft wird das Ergebnis: nach einem 422 steht der Dialog
   * offen und der Wortlaut im Feld.
   */
  it('lässt nach einer Ablehnung Dialog und Wortlaut stehen', async () => {
    server.use(
      http.patch('/api/qualifikationen/1', () =>
        HttpResponse.json({ error: 'Label bereits vergeben' }, { status: 422 }),
      ),
    );
    render(admin);
    await screen.findByText('Sanitäter');
    await userEvent.click(screen.getAllByRole('button', { name: 'Bearbeiten' })[0]);

    const dialog = await screen.findByRole('dialog');
    const feld = within(dialog).getByLabelText('Label');
    await userEvent.clear(feld);
    await userEvent.type(feld, 'Gruppenführer');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    await screen.findByText('Label bereits vergeben');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByLabelText('Label')).toHaveValue('Gruppenführer');
  });
});
