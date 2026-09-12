import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import PersonalStatusTab from './PersonalStatusTab';

const admin = {
  id: 1,
  anzeigename: 'Admin',
  benutzername: 'admin',
  system_rolle: 'admin',
  org_rolle: 'keine',
  aktiv: true,
  erstellt_at: '2026-05-26 10:00:00',
};
const nichtAdmin = { ...admin, system_rolle: 'keiner' };

/**
 * Fachliche Reihenfolge (`sortier` 10 vor 20), die zugleich NICHT die alphabetische ist —
 * sonst sähe die Tabelle nach dem Sortierklick genauso aus wie davor.
 */
const status = [
  { id: 1, label: 'dienstbereit', kategorie: 'verfuegbar', farbe: null, sortier: 10 },
  { id: 2, label: 'alarmiert', kategorie: 'gebunden', farbe: null, sortier: 20 },
];

/** Die Leitspalte aller Datenzeilen — der Kopf ist ein eigenes `<table>`, siehe KatalogTabelle. */
const labels = (c: HTMLElement) =>
  [...c.querySelectorAll('tr.ant-table-row td:first-child')].map((z) => z.textContent);

/**
 * Der Eintrag IM Filtermenü. Das Kategorie-Label steht zweimal im Dokument — in der Zelle als
 * `StatusTag` und im Menü —, ein schlichtes `findByText` bräche an der Mehrdeutigkeit. Und das
 * Menü hängt in einem Portal unter `document.body`, nicht unter dem `container`.
 */
async function menueEintrag(text: string): Promise<HTMLElement> {
  const treffer = (await screen.findAllByText(text)).find((k) =>
    k.closest('.ant-table-filter-dropdown'),
  );
  if (!treffer) throw new Error(`Kein Filtereintrag „${text}" im Menü`);
  return treffer;
}

function render(benutzer: typeof admin, statusListe: typeof status = status) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/personal-status', () => HttpResponse.json(statusListe)),
  );
  return renderMitProviders(
    <AuthProvider>
      <PersonalStatusTab />
    </AuthProvider>,
  );
}

describe('PersonalStatusTab', () => {
  it('zeigt Status mit Kategorie-Badge', async () => {
    render(admin);
    expect(await screen.findByText('dienstbereit')).toBeInTheDocument();
    expect(screen.getByText('gebunden')).toBeInTheDocument();
  });

  it('Admin sieht „Status anlegen", Nicht-Admin nicht', async () => {
    render(admin);
    await screen.findByText('dienstbereit');
    expect(screen.getByRole('button', { name: 'Status anlegen' })).toBeEnabled();
  });

  /**
   * Zwei Zuschnitte, nicht einer (LFH-346, Nacharbeit zu Befund M45). Die PRIMÄRAKTION
   * steht gesperrt — sie zu verstecken machte „kein Recht" von „diese Seite kann das gar
   * nicht" ununterscheidbar; den Grund nennt der Hinweis darüber. Die ZEILENAKTIONEN
   * entfallen weiterhin ganz: n Zeilen mal zwei gesperrte Knöpfe kosten Platz für null
   * Handlungsmöglichkeit. Beide Hälften gehören in dieselbe Aussage, sonst liest sich die
   * eine als Versehen der anderen.
   */
  it('Nicht-Admin: Primäraktion GESPERRT, Zeilenaktionen weg', async () => {
    render(nichtAdmin);
    await screen.findByText('dienstbereit');
    expect(screen.getByRole('button', { name: 'Status anlegen' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deaktivieren' })).not.toBeInTheDocument();
  });

  it('Ordnung: die Leitspalte sortiert, Suche und Kategorie-Filter verengen', async () => {
    const { container } = render(admin);
    await screen.findByText('dienstbereit');
    expect(labels(container)).toEqual(['dienstbereit', 'alarmiert']);

    // Der Sortierauslöser sitzt in der Kopfzelle der fixierten Leitspalte. jsdom rechnet
    // dort kein Layout — dass der Klick auch am 390-px-Schirm ankommt, ist hier NICHT belegt.
    await userEvent.click(container.querySelector<HTMLElement>('th.ant-table-cell-fix-start')!);
    expect(labels(container)).toEqual(['alarmiert', 'dienstbereit']);

    const feld = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await userEvent.type(feld, 'dienst');
    expect(labels(container)).toEqual(['dienstbereit']);
    await userEvent.clear(feld);
    expect(labels(container)).toHaveLength(2);

    // Gefiltert wird die ZEILENMENGE, nicht die Anwesenheit des Trichters: antd zeichnet ihn
    // schon bei gesetztem `filters`, gefiltert wird aber erst mit `onFilter`.
    await userEvent.click(container.querySelector<HTMLElement>('.ant-table-filter-trigger')!);
    await userEvent.click(await menueEintrag('gebunden'));
    await userEvent.click(
      document.querySelector<HTMLElement>('.ant-table-filter-dropdown-btns .ant-btn-primary')!,
    );
    expect(labels(container)).toEqual(['alarmiert']);
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
      http.get('/api/personal-status', () => new HttpResponse(null, { status: 500 })),
    );
    renderMitProviders(
      <AuthProvider>
        <PersonalStatusTab />
      </AuthProvider>,
    );

    expect(await screen.findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Kein Status')).not.toBeInTheDocument();
  });

  it('zeigt bei leerem Katalog den Leertext und KEINEN Fehler', async () => {
    render(admin, []);

    expect(await screen.findByText('Kein Status')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });

  /**
   * LFH-332 · B4. Geprüft wird der RUMPF, nicht bloß, dass gesendet wurde: der
   * Anlege-Zweig setzt seine Vorgaben jetzt von Hand zusammen, und `kategorie` ist
   * darunter die einzige, die zu einem SICHTBAR falschen Datensatz führt — ein
   * Status in der falschen Kategorie färbt jede Kräfteübersicht falsch ein. Ein
   * Test, der nur zählt, bliebe dabei grün.
   *
   * Der Knopf trägt weiter den Namen des gestrichenen Dialog-Knopfes, deshalb sind
   * die Rechte-Prüfungen oben unverändert gültig.
   */
  it('die Schnellerfassung legt mit Label und den Vorgaben des alten Dialogs an', async () => {
    const ruempfe: unknown[] = [];
    server.use(
      http.post('/api/personal-status', async ({ request }) => {
        ruempfe.push(await request.json());
        return HttpResponse.json({
          id: 9,
          label: 'im Anmarsch',
          kategorie: 'gebunden',
          farbe: null,
          sortier: 0,
        });
      }),
    );
    render(admin);
    await screen.findByText('dienstbereit');

    await userEvent.type(screen.getByLabelText('Neuer Personal-Status'), 'im Anmarsch{Enter}');

    await waitFor(() =>
      expect(ruempfe).toEqual([
        { label: 'im Anmarsch', kategorie: 'gebunden', farbe: null, sortier: 0 },
      ]),
    );
  });

  /**
   * Der Dialog ist seit LFH-332 · B4 reines Bearbeiten. Ohne diese Prüfung schiffe
   * eine kaputte Vorbelegung mit vollständig grüner Suite: kein anderer Test dieser
   * Datei öffnet ihn.
   */
  it('Bearbeiten öffnet den Dialog mit vorbelegten Werten', async () => {
    render(admin);
    await screen.findByText('dienstbereit');

    await userEvent.click(screen.getAllByRole('button', { name: 'Bearbeiten' })[0]);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Status bearbeiten')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Label')).toHaveValue('dienstbereit');
  });

  /**
   * LFH-346 · A6. DIE Zusicherung des Umbaus auf `ErfassungsModal`, und die einzige,
   * die strukturell prüfbar ist: Enter kommt aus der eingebauten Formularübermittlung
   * des Browsers, und die greift nur, wenn der Knopf IM `<form>` liegt (bei einer
   * Select-lastigen Maske ist der Tastendruck ohnehin kein Beleg — `@rc-component/select`
   * ruft bei jedem Enter `preventDefault()`). Beide Hälften zusammen sind die Aussage:
   * keine antd-Fusszeile (dort stünde der Knopf als DOM-Geschwister ausserhalb,
   * Befund H69) UND der Knopf hat tatsächlich ein `form` als Vorfahr. Mutationsprobe:
   * dreht man auf `<Modal onOk okText="Speichern">` zurück, fallen beide Abfragen.
   */
  it('trägt keine antd-Fusszeile — der Absende-Knopf liegt im Formular', async () => {
    render(admin);
    await screen.findByText('dienstbereit');
    await userEvent.click(screen.getAllByRole('button', { name: 'Bearbeiten' })[0]);
    const dialog = await screen.findByRole('dialog');

    expect(dialog.querySelector('.ant-modal-footer')).toBeNull();
    expect(
      within(dialog).getByRole('button', { name: 'Speichern' }).closest('form'),
    ).not.toBeNull();
  });

  /**
   * Die zweite Zusicherung der Hülle: der Fokus steht beim Öffnen im ersten Feld.
   * Vorher fokussierte dieser Dialog nichts — wer bearbeiten wollte, musste erst
   * ins Feld klicken.
   */
  it('setzt den Fokus beim Öffnen ins erste Feld', async () => {
    render(admin);
    await screen.findByText('dienstbereit');
    await userEvent.click(screen.getAllByRole('button', { name: 'Bearbeiten' })[0]);

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByLabelText('Label')).toHaveFocus());
  });

  /**
   * `onErfassen` bekommt `mutateAsync`, nicht `mutate` — sonst löste die Hülle den
   * Erfolgszweig aus, während der Server ablehnt: Felder leer, Dialog zu, nichts
   * gespeichert. Geprüft wird das Ergebnis, nicht die Schreibweise.
   */
  it('lässt nach einer Ablehnung Dialog und Wortlaut stehen', async () => {
    server.use(
      http.patch('/api/personal-status/1', () =>
        HttpResponse.json({ error: 'Label bereits vergeben' }, { status: 422 }),
      ),
    );
    render(admin);
    await screen.findByText('dienstbereit');
    await userEvent.click(screen.getAllByRole('button', { name: 'Bearbeiten' })[0]);

    const dialog = await screen.findByRole('dialog');
    const feld = within(dialog).getByLabelText('Label');
    await userEvent.clear(feld);
    await userEvent.type(feld, 'im Dienst');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    await screen.findByText('Label bereits vergeben');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByLabelText('Label')).toHaveValue('im Dienst');
  });
});
