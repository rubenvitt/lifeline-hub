import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import EinheitTypenTab from './EinheitTypenTab';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-26 10:00:00',
};
const nichtAdmin = { ...admin, system_rolle: 'keiner' };

const typen = [
  { id: 1, label: 'Zug', soll: { fuehrer: 1, unterfuehrer: 3, mannschaft: 18 }, sortier: 40 },
  { id: 2, label: 'Sonstige', soll: null, sortier: 50 },
];

function render(benutzer: typeof admin, katalog = typen) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/einheit-typen', () => HttpResponse.json(katalog)),
  );
  return renderMitProviders(
    <AuthProvider>
      <EinheitTypenTab />
    </AuthProvider>,
  );
}

describe('EinheitTypenTab', () => {
  it('zeigt Typen mit Soll-Stärke und „—" bei fehlender Soll', async () => {
    render(nichtAdmin);
    expect(await screen.findByText('Zug')).toBeInTheDocument();
    expect(screen.getByText('1/3/18//22')).toBeInTheDocument();
    expect(screen.getByText('Sonstige')).toBeInTheDocument();
  });

  it('Admin sieht „Typ anlegen"', async () => {
    render(admin);
    await screen.findByText('Zug');
    expect(screen.getByRole('button', { name: 'Typ anlegen' })).toBeEnabled();
  });

  // Ordnung statt bloßer Anwesenheit: geprüft wird, was Sortierung und Suche mit den Zeilen TUN.
  // Die Leitspalte liegt in der ersten Zelle; die stehende Kopfzeile schiebt eine verborgene
  // Messzeile als erste Körperzeile ein, deshalb die Verengung auf `tr.ant-table-row`.
  it('sortiert nach Label und engt per Suche ein', async () => {
    const { container } = render(nichtAdmin);
    await screen.findByText('Zug');
    const labels = () =>
      Array.from(container.querySelectorAll('tr.ant-table-row td:first-child')).map(
        (z) => z.textContent,
      );

    // Voreinstellung ist die gelieferte Reihenfolge, nicht die alphabetische — die Vorgabe
    // steht bewusst un-alphabetisch (Zug vor Sonstige), sonst wäre die Zusicherung stumpf.
    // Dass das Backend nach `sortier` ordnet, kann dieser Test nicht prüfen: hier antwortet msw.
    expect(labels()).toEqual(['Zug', 'Sonstige']);

    await userEvent.click(screen.getByRole('columnheader', { name: /Label/ }));
    await waitFor(() => expect(labels()).toEqual(['Sonstige', 'Zug']));

    await userEvent.type(screen.getByPlaceholderText('Label'), 'Zug');
    await waitFor(() => expect(labels()).toEqual(['Zug']));
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
    await screen.findByText('Zug');
    // `waitFor`, weil der Knopf beim ersten Anstrich noch ungesperrt sein kann: das
    // Recht kommt aus `auth/me` und trifft eine Runde nach der Tabelle ein.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Typ anlegen' })).toBeDisabled(),
    );
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deaktivieren' })).not.toBeInTheDocument();
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
      http.get('/api/einheit-typen', () => new HttpResponse(null, { status: 500 })),
    );
    renderMitProviders(
      <AuthProvider>
        <EinheitTypenTab />
      </AuthProvider>,
    );

    expect(await screen.findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Kein Einheitstyp')).not.toBeInTheDocument();
  });

  it('zeigt bei leerem Katalog den Leertext und KEINEN Fehler', async () => {
    render(admin, []);

    expect(await screen.findByText('Kein Einheitstyp')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });

  /**
   * LFH-332 · B4. Geprüft wird der RUMPF, nicht bloß, dass gesendet wurde: der
   * Anlege-Zweig setzt seine Vorgaben jetzt von Hand zusammen — drei `null` für die
   * Soll-Stärke und `sortier: 0` —, und genau ein solches Vorgabe-Objekt kann still
   * falsch sein. Ein Test, der nur zählt, bliebe dabei grün.
   *
   * Der Knopf trägt weiter den Namen des gestrichenen Dialog-Knopfes, deshalb sind
   * die Rechte-Prüfungen oben unverändert gültig.
   */
  it('die Schnellerfassung legt mit Label und leerer Soll-Stärke an', async () => {
    const ruempfe: unknown[] = [];
    server.use(
      http.post('/api/einheit-typen', async ({ request }) => {
        ruempfe.push(await request.json());
        return HttpResponse.json({ id: 9, label: 'Gruppe', soll: null, sortier: 0 });
      }),
    );
    render(admin);
    await screen.findByText('Zug');

    await userEvent.type(screen.getByLabelText('Neuer Einheitstyp'), 'Gruppe{Enter}');

    await waitFor(() =>
      expect(ruempfe).toEqual([{
        label: 'Gruppe',
        soll_fuehrer: null,
        soll_unterfuehrer: null,
        soll_mannschaft: null,
        sortier: 0,
      }]),
    );
  });

  /**
   * Der Dialog ist seit LFH-332 · B4 reines Bearbeiten. Ohne diese Prüfung schiffe
   * eine kaputte Vorbelegung mit vollständig grüner Suite: kein anderer Test dieser
   * Datei öffnet ihn.
   */
  it('Bearbeiten öffnet den Dialog mit vorbelegten Werten', async () => {
    render(admin);
    await screen.findByText('Zug');

    await userEvent.click(screen.getAllByRole('button', { name: 'Bearbeiten' })[0]);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Typ bearbeiten')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Label')).toHaveValue('Zug');
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
    await screen.findByText('Zug');
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
    await screen.findByText('Zug');
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
      http.patch('/api/einheit-typen/1', () =>
        HttpResponse.json({ error: 'Label bereits vergeben' }, { status: 422 })),
    );
    render(admin);
    await screen.findByText('Zug');
    await userEvent.click(screen.getAllByRole('button', { name: 'Bearbeiten' })[0]);

    const dialog = await screen.findByRole('dialog');
    const feld = within(dialog).getByLabelText('Label');
    await userEvent.clear(feld);
    await userEvent.type(feld, 'Gruppe');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    await screen.findByText('Label bereits vergeben');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByLabelText('Label')).toHaveValue('Gruppe');
  });
});
