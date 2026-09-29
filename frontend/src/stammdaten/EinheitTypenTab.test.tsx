import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import EinheitTypenTab from './EinheitTypenTab';
import { adminFixture } from '../test/fixtures';

const admin = adminFixture();
const nichtAdmin = adminFixture({ system_rolle: 'keiner' });

const typen = [
  { id: 1, label: 'Zug', soll: { fuehrer: 1, unterfuehrer: 3, mannschaft: 18 }, sortier: 40 },
  { id: 2, label: 'Sonstige', soll: null, sortier: 50 },
];

function render(benutzer: typeof admin, katalog = typen) {
  server.use(
    meHandler(benutzer),
    http.get('/api/einheit-typen', () => HttpResponse.json(katalog)),
  );
  return renderMitProviders(<EinheitTypenTab />);
}

describe('EinheitTypenTab', () => {
  it('zeigt Typen mit Soll-Stärke und „—" bei fehlender Soll', async () => {
    render(nichtAdmin);
    expect(await screen.findByText('Zug')).toBeInTheDocument();
    expect(screen.getByText('1/3/18//22')).toBeInTheDocument();
    expect(screen.getByText('Sonstige')).toBeInTheDocument();
  });

  // Zahlen stehen Mono mit `tabular-nums` — Stärke UND Sortierung. Das Label bleibt Satzschrift;
  // ohne die Gegenprobe wäre „alles Mono" ebenso grün.
  it('setzt Soll-Stärke und Sortierung in die Zahlenschrift, das Label nicht', async () => {
    render(nichtAdmin);
    await screen.findByText('Zug');
    for (const zahl of ['1/3/18//22', '40']) {
      const knoten = screen.getByText(zahl);
      expect(knoten.style.fontFamily).toContain('JetBrains Mono');
      expect(knoten.style.fontVariantNumeric).toBe('tabular-nums');
    }
    expect(screen.getByText('Zug').style.fontFamily).toBe('');
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

    // Voreinstellung ist die gelieferte Reihenfolge, bewusst un-alphabetisch (Zug vor Sonstige),
    // sonst wäre die Zusicherung stumpf. Dass das Backend nach `sortier` ordnet, prüft dieser Test
    // nicht: hier antwortet msw.
    expect(labels()).toEqual(['Zug', 'Sonstige']);

    await userEvent.click(screen.getByRole('columnheader', { name: /Label/ }));
    await waitFor(() => expect(labels()).toEqual(['Sonstige', 'Zug']));

    await userEvent.type(screen.getByPlaceholderText('Label'), 'Zug');
    await waitFor(() => expect(labels()).toEqual(['Zug']));
  });

  /**
   * Zwei Zuschnitte (LFH-346): die PRIMÄRAKTION steht gesperrt — versteckt wäre „kein Recht"
   * von „diese Seite kann das nicht" nicht zu unterscheiden; den Grund nennt der Hinweis. Die
   * ZEILENAKTIONEN entfallen: n Zeilen × 2 gesperrte Knöpfe kosteten Platz für null
   * Handlungsmöglichkeit.
   */
  it('Nicht-Admin: Primäraktion GESPERRT, Zeilenaktionen weg', async () => {
    render(nichtAdmin);
    await screen.findByText('Zug');
    // `waitFor`, weil der Knopf beim ersten Anstrich noch ungesperrt sein kann: das
    // Recht kommt aus `auth/me` und trifft eine Runde nach der Tabelle ein.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Typ anlegen' })).toBeDisabled());
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deaktivieren' })).not.toBeInTheDocument();
  });

  /**
   * Partnerpaar zu AK4 (LFH-331): die negative Hälfte allein wäre auch im Leerfall trivial
   * grün; erst die positive darunter mit demselben Literal macht sie zu einer Aussage über die
   * Zustandsweiche.
   */
  it('zeigt bei gescheitertem Abruf den Fehler und NICHT den Leertext', async () => {
    server.use(
      meHandler(admin),
      http.get('/api/einheit-typen', () => new HttpResponse(null, { status: 500 })),
    );
    renderMitProviders(<EinheitTypenTab />);

    expect(await screen.findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Kein Einheitstyp')).not.toBeInTheDocument();
  });

  it('zeigt bei leerem Katalog den Leertext und KEINEN Fehler', async () => {
    render(admin, []);

    expect(await screen.findByText('Kein Einheitstyp')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });

  /**
   * Geprüft wird der RUMPF, nicht bloß, dass gesendet wurde: ein Vorgabe-Objekt (drei `null`
   * für die Soll-Stärke, `sortier: 0`) kann still falsch sein, und ein Test, der nur zählt,
   * bliebe grün.
   *
   * Der Knopf trägt den Namen des früheren Dialog-Knopfes, deshalb gelten die Rechte-Prüfungen
   * oben unverändert.
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
      expect(ruempfe).toEqual([
        {
          label: 'Gruppe',
          soll_fuehrer: null,
          soll_unterfuehrer: null,
          soll_mannschaft: null,
          sortier: 0,
        },
      ]),
    );
  });

  /**
   * Der Dialog ist reines Bearbeiten, und kein anderer Test dieser Datei öffnet ihn: ohne diese
   * Prüfung schiffte eine kaputte Vorbelegung mit grüner Suite.
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
   * Die Zusicherung der Hülle `ErfassungsModal`: Enter kommt aus der eingebauten
   * Formularübermittlung und greift nur, wenn der Knopf IM `<form>` liegt. Beide Hälften
   * zusammen sind die Aussage: keine antd-Fußzeile UND ein `form` als Vorfahr des Knopfes.
   */
  it('trägt keine antd-Fusszeile — der Absende-Knopf liegt im Formular', async () => {
    render(admin);
    await screen.findByText('Zug');
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
    await screen.findByText('Zug');
    await userEvent.click(screen.getAllByRole('button', { name: 'Bearbeiten' })[0]);

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByLabelText('Label')).toHaveFocus());
  });

  /**
   * `onErfassen` bekommt `mutateAsync`, nicht `mutate` — sonst löste die Hülle den Erfolgszweig
   * aus, während der Server ablehnt: Felder leer, Dialog zu, nichts gespeichert.
   */
  it('lässt nach einer Ablehnung Dialog und Wortlaut stehen', async () => {
    server.use(
      http.patch('/api/einheit-typen/1', () =>
        HttpResponse.json({ error: 'Label bereits vergeben' }, { status: 422 }),
      ),
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
