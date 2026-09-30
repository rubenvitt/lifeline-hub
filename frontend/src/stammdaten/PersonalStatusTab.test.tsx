import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import PersonalStatusTab from './PersonalStatusTab';
import { adminFixture } from '../test/fixtures';

const admin = adminFixture();
const nichtAdmin = adminFixture({ system_rolle: 'keiner' });

/**
 * Fachliche Reihenfolge (`sortier` 10 vor 20), die zugleich NICHT die alphabetische ist —
 * sonst sähe die Tabelle nach dem Sortierklick genauso aus wie davor. `farbe` ist
 * ausdrücklich `string | null` typisiert, weil ein Test einen Farbcode einsetzt.
 */
const status: {
  id: number;
  label: string;
  kategorie: string;
  farbe: string | null;
  sortier: number;
  zeitachse_marke?: string;
}[] = [
  { id: 1, label: 'dienstbereit', kategorie: 'verfuegbar', farbe: null, sortier: 10 },
  { id: 2, label: 'alarmiert', kategorie: 'gebunden', farbe: null, sortier: 20 },
];

/** Die Leitspalte aller Datenzeilen — der Kopf ist ein eigenes `<table>`, siehe KatalogTabelle. */
const labels = (c: HTMLElement) =>
  [...c.querySelectorAll('tr.ant-table-row td:first-child')].map((z) => z.textContent);

/**
 * Der Eintrag IM Filtermenü. Das Kategorie-Label steht zweimal im Dokument (Zelle und Menü),
 * und das Menü hängt in einem Portal unter `document.body`, nicht unter dem `container`.
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
    meHandler(benutzer),
    http.get('/api/personal-status', () => HttpResponse.json(statusListe)),
  );
  return renderMitProviders(<PersonalStatusTab />);
}

describe('PersonalStatusTab', () => {
  it('zeigt Status mit Kategorie-Badge', async () => {
    render(admin);
    expect(await screen.findByText('dienstbereit')).toBeInTheDocument();
    expect(screen.getByText('gebunden')).toBeInTheDocument();
  });

  // Farbcode und Sortierung stehen Mono mit `tabular-nums`, das Label nicht. Die Kategorie ist
  // bereits Fläche (`StatusTag`-Vorgabe).
  it('setzt Farbcode und Sortierung in die Zahlenschrift, das Label nicht', async () => {
    render(admin, [{ ...status[0], farbe: '#22aa55' }, status[1]]);
    await screen.findByText('dienstbereit');
    for (const wert of ['#22aa55', '20']) {
      const knoten = screen.getByText(wert);
      expect(knoten.style.fontFamily).toContain('JetBrains Mono');
      expect(knoten.style.fontVariantNumeric).toBe('tabular-nums');
    }
    expect(screen.getByText('alarmiert').style.fontFamily).toBe('');
  });

  it('Admin sieht „Status anlegen", Nicht-Admin nicht', async () => {
    render(admin);
    await screen.findByText('dienstbereit');
    expect(screen.getByRole('button', { name: 'Status anlegen' })).toBeEnabled();
  });

  /**
   * Zwei Zuschnitte (LFH-346): die PRIMÄRAKTION steht gesperrt — versteckt wäre „kein Recht"
   * von „diese Seite kann das nicht" nicht zu unterscheiden; den Grund nennt der Hinweis. Die
   * ZEILENAKTIONEN entfallen: n Zeilen × 2 gesperrte Knöpfe kosteten Platz für null
   * Handlungsmöglichkeit.
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

    // Der Sortierauslöser sitzt in der Kopfzelle der fixierten Leitspalte; ob der Klick am
    // 390-px-Schirm ankommt, belegt jsdom NICHT.
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
   * Partnerpaar zu AK4 (LFH-331): die negative Hälfte allein wäre auch im Leerfall trivial
   * grün; erst die positive darunter mit demselben Literal macht sie zu einer Aussage über die
   * Zustandsweiche.
   */
  it('zeigt bei gescheitertem Abruf den Fehler und NICHT den Leertext', async () => {
    server.use(
      meHandler(admin),
      http.get('/api/personal-status', () => new HttpResponse(null, { status: 500 })),
    );
    renderMitProviders(<PersonalStatusTab />);

    expect(await screen.findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Kein Status')).not.toBeInTheDocument();
  });

  it('zeigt bei leerem Katalog den Leertext und KEINEN Fehler', async () => {
    render(admin, []);

    expect(await screen.findByText('Kein Status')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });

  /**
   * Geprüft wird der RUMPF, nicht bloß, dass gesendet wurde: eine falsche `kategorie` färbte
   * jede Kräfteübersicht falsch ein, und ein Test, der nur zählt, bliebe grün.
   *
   * Der Knopf trägt den Namen des früheren Dialog-Knopfes, deshalb gelten die Rechte-Prüfungen
   * oben unverändert.
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
   * Der Dialog ist reines Bearbeiten, und kein anderer Test dieser Datei öffnet ihn: ohne diese
   * Prüfung schiffte eine kaputte Vorbelegung mit grüner Suite.
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
   * Die Zusicherung der Hülle `ErfassungsModal`: Enter kommt aus der eingebauten
   * Formularübermittlung und greift nur, wenn der Knopf IM `<form>` liegt (ein Tastendruck
   * belegte nichts — `@rc-component/select` ruft bei jedem Enter `preventDefault()`). Beide
   * Hälften zusammen sind die Aussage: keine antd-Fußzeile UND ein `form` als Vorfahr.
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

  /** Die zweite Zusicherung der Hülle: der Fokus steht beim Öffnen im ersten Feld. */
  it('setzt den Fokus beim Öffnen ins erste Feld', async () => {
    render(admin);
    await screen.findByText('dienstbereit');
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

  /** LFH-552: die Marke liegt eingeklappt; der Vollersatz muss sie trotzdem mitschicken. */
  it('zeigt die Zeitachsen-Marke und behält sie beim Speichern ohne Aufklappen', async () => {
    let ruempf: Record<string, unknown> | null = null;
    server.use(
      http.patch('/api/personal-status/2', async ({ request }) => {
        ruempf = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: 2 });
      }),
    );
    render(admin, [status[0], { ...status[1], zeitachse_marke: 'alarmierung' }]);
    await screen.findByText('dienstbereit');
    expect(screen.getByText('Alarmierung')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Bearbeiten' })[1]);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(ruempf).not.toBeNull());
    expect(ruempf).toMatchObject({ label: 'alarmiert', zeitachse_marke: 'alarmierung' });
  });
});
