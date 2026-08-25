import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import QualifikationenTab from './QualifikationenTab';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-26 10:00:00',
};
const nichtAdmin = { ...admin, system_rolle: 'keiner' };

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

// Die Fixture ist voreingestellt und bleibt es: der Ordnungs-Test unten hängt an genau
// diesen zwei Zeilen in genau dieser Reihenfolge. Der Parameter existiert allein für den
// leeren Katalog der AK4-Hälfte.
function render(benutzer: typeof admin, katalog: typeof quals = quals) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/qualifikationen', () => HttpResponse.json(katalog)),
  );
  return renderMitProviders(
    <AuthProvider>
      <QualifikationenTab />
    </AuthProvider>,
  );
}

describe('QualifikationenTab', () => {
  it('zeigt Qualifikationen', async () => {
    render(admin);
    expect(await screen.findByText('Sanitäter')).toBeInTheDocument();
    expect(screen.getByText('Gruppenführer')).toBeInTheDocument();
  });

  it('Admin sieht „Qualifikation anlegen"', async () => {
    render(admin);
    await screen.findByText('Sanitäter');
    expect(screen.getByRole('button', { name: 'Qualifikation anlegen' })).toBeInTheDocument();
  });

  it('Nicht-Admin sieht keine Schreib-Aktionen', async () => {
    render(nichtAdmin);
    await screen.findByText('Sanitäter');
    expect(screen.queryByRole('button', { name: 'Qualifikation anlegen' })).not.toBeInTheDocument();
  });

  it('Ordnung: die Leitspalte sortiert, die Suche verengt, ein Filter fehlt mit Grund', async () => {
    const { container } = render(admin);
    await screen.findByText('Sanitäter');
    // Einstieg ist die fachliche Reihenfolge des Servers, nicht das Alphabet.
    expect(labels(container)).toEqual(['Sanitäter', 'Gruppenführer']);

    // Der Sortierauslöser sitzt in der Kopfzelle der fixierten Leitspalte. jsdom rechnet
    // dort kein Layout — dass der Klick auch am 390-px-Schirm ankommt, ist hier NICHT belegt.
    await userEvent.click(container.querySelector<HTMLElement>('th.ant-table-cell-fix-start')!);
    expect(labels(container)).toEqual(['Gruppenführer', 'Sanitäter']);

    await userEvent.type(container.querySelector<HTMLInputElement>('input[type="search"]')!, 'Sani');
    expect(labels(container)).toEqual(['Sanitäter']);

    // Kein Trichter, und das ist eine Aussage: der Katalog hat keine Status-/Kategoriespalte,
    // `aktiv` siebt schon der Server (`qualifikation_repo.rs:55`). Wer hier einen Filter
    // nachrüstet, ohne die Spalte zu haben, fällt hier auf.
    expect(container.querySelector('.ant-table-filter-trigger')).toBeNull();
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
      http.get('/api/qualifikationen', () => new HttpResponse(null, { status: 500 })),
    );
    renderMitProviders(
      <AuthProvider>
        <QualifikationenTab />
      </AuthProvider>,
    );

    expect(await screen.findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Keine Qualifikationen')).not.toBeInTheDocument();
  });

  it('zeigt bei leerem Katalog den Leertext und KEINEN Fehler', async () => {
    render(admin, []);

    expect(await screen.findByText('Keine Qualifikationen')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });

  /**
   * LFH-332 · B4. Geprüft wird der RUMPF, nicht bloß, dass gesendet wurde: der
   * Anlege-Zweig setzt seine Vorgaben jetzt von Hand zusammen (`sortier: 0`), und
   * genau ein solches Vorgabe-Objekt kann still falsch sein. Ein Test, der nur
   * zählt, bliebe dabei grün.
   *
   * Der Knopf trägt weiter den Namen des gestrichenen Dialog-Knopfes — deshalb
   * sind die Rechte-Prüfungen oben unverändert gültig und prüfen weiterhin
   * dieselbe sichtbare Handlung.
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
   * Der Dialog ist seit LFH-332 · B4 reines Bearbeiten. Ohne diese Prüfung
   * schiffe eine kaputte Vorbelegung mit vollständig grüner Suite: kein anderer
   * Test dieser Datei öffnet ihn.
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
   * LFH-346 · A6. DIE Zusicherung des Umbaus auf `ErfassungsModal`, und die
   * einzige, die hier strukturell prüfbar ist: die Maske trägt ein `Select` nicht,
   * aber die Regel gilt gleich — Enter kommt aus der eingebauten
   * Formularübermittlung des Browsers, und die greift nur, wenn der Knopf IM
   * `<form>` liegt. Beide Hälften zusammen sind die Aussage: keine antd-Fusszeile
   * (dort stünde der Knopf als DOM-Geschwister ausserhalb, Befund H69) UND der
   * Knopf hat tatsächlich ein `form` als Vorfahr. Mutationsprobe: dreht man auf
   * `<Modal onOk okText="Speichern">` zurück, fallen beide Abfragen.
   */
  it('trägt keine antd-Fusszeile — der Absende-Knopf liegt im Formular', async () => {
    render(admin);
    await screen.findByText('Sanitäter');
    await userEvent.click(screen.getAllByRole('button', { name: 'Bearbeiten' })[0]);
    const dialog = await screen.findByRole('dialog');

    expect(dialog.querySelector('.ant-modal-footer')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Speichern' }).closest('form')).not.toBeNull();
  });

  /**
   * Die zweite Zusicherung der Hülle: der Fokus steht beim Öffnen im ersten Feld.
   * Vorher fokussierte dieser Dialog nichts — wer bearbeiten wollte, musste erst
   * ins Feld klicken.
   */
  it('setzt den Fokus beim Öffnen ins erste Feld', async () => {
    render(admin);
    await screen.findByText('Sanitäter');
    await userEvent.click(screen.getAllByRole('button', { name: 'Bearbeiten' })[0]);

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByLabelText('Label')).toHaveFocus());
  });

  /**
   * `onErfassen` bekommt `mutateAsync`, nicht `mutate` — sonst löste die Hülle den
   * Erfolgszweig aus, während der Server ablehnt: Felder leer, Dialog zu, nichts
   * gespeichert. Geprüft wird das Ergebnis, nicht die Schreibweise: nach einem 422
   * steht der Dialog noch offen und der Wortlaut noch im Feld.
   */
  it('lässt nach einer Ablehnung Dialog und Wortlaut stehen', async () => {
    server.use(
      http.patch('/api/qualifikationen/1', () =>
        HttpResponse.json({ error: 'Label bereits vergeben' }, { status: 422 })),
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
