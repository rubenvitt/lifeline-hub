import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import StatusKatalogTab from './StatusKatalogTab';
import { adminFixture } from '../test/fixtures';

const admin = adminFixture();
const nichtAdmin = adminFixture({ system_rolle: 'keiner' });

/**
 * Die Feldtypen stehen ausgeschrieben da: aus dem Vorrat abgeleitet hießen `farbe` und
 * `fms_anker` `null` bzw. `number`, und ein Vorrat mit gesetzter Farbe (Prüfung „erbt keine
 * Werte") ließe sich nicht übergeben.
 */
const status: {
  id: number;
  label: string;
  kategorie: string;
  farbe: string | null;
  fms_anker: number | null;
  sortier: number;
  zeitachse_marke?: string;
}[] = [
  {
    id: 1,
    label: 'einsatzbereit',
    kategorie: 'verfuegbar',
    farbe: null,
    fms_anker: 1,
    sortier: 10,
  },
  { id: 2, label: 'disponiert', kategorie: 'gebunden', farbe: null, fms_anker: 3, sortier: 20 },
];

function render(benutzer: typeof admin, statusListe: typeof status = status) {
  server.use(
    meHandler(benutzer),
    http.get('/api/fahrzeug-status', () => HttpResponse.json(statusListe)),
  );
  return renderMitProviders(<StatusKatalogTab />);
}

describe('StatusKatalogTab', () => {
  it('zeigt Status mit Kategorie-Badge', async () => {
    render(admin);
    expect(await screen.findByText('einsatzbereit')).toBeInTheDocument();
    expect(screen.getByText('gebunden')).toBeInTheDocument();
  });

  // Farbcode, FMS-Anker und Sortierung stehen Mono mit `tabular-nums`, das Label nicht. Die
  // Kategorie ist bereits Fläche (`StatusTag`-Vorgabe).
  it('setzt Farbcode, FMS-Anker und Sortierung in die Zahlenschrift, das Label nicht', async () => {
    render(admin, [{ ...status[0], farbe: '#22aa55' }, status[1]]);
    await screen.findByText('einsatzbereit');
    for (const wert of ['#22aa55', '3', '20']) {
      const knoten = screen.getByText(wert);
      expect(knoten.style.fontFamily).toContain('JetBrains Mono');
      expect(knoten.style.fontVariantNumeric).toBe('tabular-nums');
    }
    expect(screen.getByText('disponiert').style.fontFamily).toBe('');
  });

  it('Admin sieht „Status anlegen", Nicht-Admin nicht', async () => {
    render(admin);
    await screen.findByText('einsatzbereit');
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
    await screen.findByText('einsatzbereit');
    expect(screen.getByRole('button', { name: 'Status anlegen' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deaktivieren' })).not.toBeInTheDocument();
  });

  it('Label sortierbar, Kategorie filterbar — die fachliche Reihenfolge bleibt Voreinstellung', async () => {
    /**
     * Der Vorrat steht in der Serverreihenfolge `ORDER BY sortier, id`
     * (`src/fahrzeug/status_repo.rs`): „einsatzbereit" (10) vor „disponiert" (20), alphabetisch
     * umgekehrt. Ein `defaultSortOrder` an der Label-Spalte färbte die erste Erwartung rot, ein
     * fehlender `sorter` die zweite.
     *
     * Die Filterliste kommt aus `theme/statusFarben.statusKategorie` und trägt deshalb das
     * Anzeige-Label („verfügbar"), nicht den Drahtwert (`verfuegbar`).
     *
     * `renderMitProviders` montiert `ConfigProvider` OHNE Locale — die Bestätigung im
     * Filtermenü heißt daher „OK".
     */
    const { container } = render(admin);
    await screen.findByText('einsatzbereit');
    // `tr.ant-table-row` verengt auf Datenzeilen: `sticky` schiebt eine verborgene
    // Messzeile als erste Körperzeile ein (Kopfkommentar von `KatalogTabelle`).
    const zeilen = () => container.querySelectorAll('tr.ant-table-row');

    expect(zeilen()[0].textContent).toContain('einsatzbereit');
    await userEvent.click(container.querySelector('th.ant-table-column-has-sorters')!);
    expect(zeilen()[0].textContent).toContain('disponiert');

    // Erst der Griff, dann der Klick: so meldet ein fehlender Filter sich hier statt erst am
    // leeren Filtermenü.
    const ausloeser = container.querySelector<HTMLElement>('.ant-table-filter-trigger');
    expect(ausloeser, 'die Kategoriespalte muss einen Filter tragen').not.toBeNull();
    await userEvent.click(ausloeser!);
    // Das Filtermenü hängt in einem Portal an `document.body`, nicht im Container. Die
    // Auswahl wird DARIN gegriffen: „verfügbar" steht auch als Etikett in der
    // Kategoriespalte, ein Griff über `screen` träfe zwei Knoten.
    const menue = await waitFor(() => {
      const m = document.querySelector<HTMLElement>('.ant-table-filter-dropdown');
      expect(m).not.toBeNull();
      return m!;
    });
    await userEvent.click(within(menue).getByText('verfügbar'));
    await userEvent.click(within(menue).getByRole('button', { name: 'OK' }));

    await waitFor(() => expect(zeilen()).toHaveLength(1));
    expect(zeilen()[0].textContent).toContain('einsatzbereit');
  });

  it('die Freitextsuche greift den Rohwert — deshalb nennt der Platzhalter nur das Label', async () => {
    /**
     * Gemessen wird die WIRKUNG, nicht die Anwesenheit des `suche`-Props: ohne das Prop gibt es
     * kein Suchfeld, und der Griff darauf fällt schon am `null`.
     *
     * Der zweite Teil pinnt, warum der Platzhalter nur „Label" verspricht: die Suche liest über
     * `zellenWert` den ROHWERT. Die Kategoriespalte zeigt „verfügbar", trägt aber `verfuegbar` —
     * wer den Umlaut tippt, findet nichts. Die Kategorie bedient der Spaltenfilter.
     *
     * `userEvent.clear` zwischen den Läufen, damit die Begriffe sich nicht überlagern.
     */
    const { container } = render(admin);
    await screen.findByText('einsatzbereit');
    const zeilen = () => container.querySelectorAll('tr.ant-table-row');
    expect(zeilen()).toHaveLength(2);

    const feld = container.querySelector<HTMLInputElement>('input[type="search"]');
    expect(feld, 'der Statuskatalog muss ein Suchfeld tragen').not.toBeNull();
    expect(feld!.placeholder).toBe('Label');

    await userEvent.type(feld!, 'disponiert');
    expect(zeilen()).toHaveLength(1);
    expect(zeilen()[0].textContent).toContain('disponiert');

    await userEvent.clear(feld!);
    await userEvent.type(feld!, 'verfügbar');
    expect(zeilen()).toHaveLength(0);

    await userEvent.clear(feld!);
    await userEvent.type(feld!, 'verfuegbar');
    expect(zeilen()).toHaveLength(1);
    expect(zeilen()[0].textContent).toContain('einsatzbereit');
  });

  /**
   * Partnerpaar zu AK4 (LFH-331): die negative Hälfte allein wäre auch im Leerfall trivial
   * grün; erst die positive darunter mit demselben Literal macht sie zu einer Aussage über die
   * Zustandsweiche.
   */
  it('zeigt bei gescheitertem Abruf den Fehler und NICHT den Leertext', async () => {
    server.use(
      meHandler(admin),
      http.get('/api/fahrzeug-status', () => new HttpResponse(null, { status: 500 })),
    );
    renderMitProviders(<StatusKatalogTab />);

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
   * jede Kräfteübersicht falsch ein, und `fms_anker: null` hält den Anker frei, statt eine
   * Ziffer zu erfinden. Ein Test, der nur zählt, bliebe bei beidem grün.
   *
   * Der Knopf trägt den Namen des früheren Dialog-Knopfes, deshalb gelten die Rechte-Prüfungen
   * oben unverändert.
   */
  it('die Schnellerfassung legt mit Label und den Vorgaben des alten Dialogs an', async () => {
    const ruempfe: unknown[] = [];
    server.use(
      http.post('/api/fahrzeug-status', async ({ request }) => {
        ruempfe.push(await request.json());
        return HttpResponse.json({
          id: 9,
          label: 'nicht einsatzbereit',
          kategorie: 'gebunden',
          farbe: null,
          fms_anker: null,
          sortier: 0,
        });
      }),
    );
    render(admin);
    await screen.findByText('einsatzbereit');

    await userEvent.type(
      screen.getByLabelText('Neuer Fahrzeug-Status'),
      'nicht einsatzbereit{Enter}',
    );

    await waitFor(() =>
      expect(ruempfe).toEqual([
        {
          label: 'nicht einsatzbereit',
          kategorie: 'gebunden',
          farbe: null,
          fms_anker: null,
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
    await screen.findByText('einsatzbereit');

    await userEvent.click(screen.getAllByRole('button', { name: 'Bearbeiten' })[0]);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Status bearbeiten')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Label')).toHaveValue('einsatzbereit');
    // Der FMS-Anker liegt unter „Weitere Angaben" — die Vorbelegung muss ihn erreichen, obwohl
    // das Feld beim Öffnen noch nicht montiert ist (`setFieldsValue` schreibt in den Speicher,
    // das Feld liest ihn beim Einhängen).
    await userEvent.click(within(dialog).getByRole('button', { name: /Weitere Angaben/ }));
    expect(await within(dialog).findByLabelText('FMS-Anker (0–9, optional)')).toHaveValue('1');
  });

  /**
   * Der zweite Datensatz darf nicht die Werte des ersten erben.
   *
   * Die Vorbelegung setzt KEIN `resetFields()` davor. Die Sorge ist antds Wertespeicher, der das
   * Schließen überlebt: behandelte `setFieldsValue({ fms_anker: undefined })` den Schlüssel als
   * „nicht gemeint", trüge der zweite Status Farbe und FMS-Anker des ersten. rc-field-form
   * schreibt den `undefined` heute durch, auch ohne `destroyOnHidden`. Die Prüfung pinnt deshalb
   * das ERGEBNIS, keinen der beiden Mechanismen — fällt einer bei einem antd-Sprung weg, fällt
   * es hier auf.
   *
   * Der erste Eintrag hat beide optionalen Felder gesetzt, der zweite keines.
   */
  it('ein zweiter Datensatz erbt keine Werte des ersten', async () => {
    render(admin, [
      {
        id: 1,
        label: 'einsatzbereit',
        kategorie: 'verfuegbar',
        farbe: '#112233',
        fms_anker: 5,
        sortier: 10,
      },
      {
        id: 2,
        label: 'disponiert',
        kategorie: 'gebunden',
        farbe: null,
        fms_anker: null,
        sortier: 20,
      },
    ]);
    await screen.findByText('einsatzbereit');

    await userEvent.click(screen.getAllByRole('button', { name: 'Bearbeiten' })[0]);
    const ersterDialog = await screen.findByRole('dialog');
    await userEvent.click(within(ersterDialog).getByRole('button', { name: /Weitere Angaben/ }));
    expect(await within(ersterDialog).findByLabelText('FMS-Anker (0–9, optional)')).toHaveValue(
      '5',
    );
    await userEvent.click(within(ersterDialog).getByRole('button', { name: /Cancel|Abbrechen/ }));

    await userEvent.click(screen.getAllByRole('button', { name: 'Bearbeiten' })[1]);
    const zweiterDialog = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(within(zweiterDialog).getByLabelText('Label')).toHaveValue('disponiert'),
    );
    // Der Collapse ist im frisch montierten Dialog wieder zu (`destroyOnHidden`) — das Aufklappen
    // gehört zur Prüfung.
    await userEvent.click(within(zweiterDialog).getByRole('button', { name: /Weitere Angaben/ }));
    expect(await within(zweiterDialog).findByLabelText('FMS-Anker (0–9, optional)')).toHaveValue(
      '',
    );
    expect(within(zweiterDialog).getByLabelText('Farbe (Hex, optional)')).toHaveValue('');
  });

  /**
   * Die Zusicherung der Hülle `ErfassungsModal`: Enter kommt aus der eingebauten
   * Formularübermittlung und greift nur, wenn der Knopf IM `<form>` liegt. Ein Tastendruck
   * belegte es hier nicht — `@rc-component/select` ruft bei jedem Enter `preventDefault()`.
   * Beide Hälften zusammen sind die Aussage: keine antd-Fußzeile UND ein `form` als Vorfahr.
   */
  it('trägt keine antd-Fusszeile — der Absende-Knopf liegt im Formular', async () => {
    render(admin);
    await screen.findByText('einsatzbereit');
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
    await screen.findByText('einsatzbereit');
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
      http.patch('/api/fahrzeug-status/1', () =>
        HttpResponse.json({ error: 'Label bereits vergeben' }, { status: 422 }),
      ),
    );
    render(admin);
    await screen.findByText('einsatzbereit');
    await userEvent.click(screen.getAllByRole('button', { name: 'Bearbeiten' })[0]);

    const dialog = await screen.findByRole('dialog');
    const feld = within(dialog).getByLabelText('Label');
    await userEvent.clear(feld);
    await userEvent.type(feld, 'bedingt einsatzbereit');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    await screen.findByText('Label bereits vergeben');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByLabelText('Label')).toHaveValue(
      'bedingt einsatzbereit',
    );
  });

  /**
   * DIE tragende Prüfung des Collapse-Umbaus (LFH-346): die Zählung darunter kann grün stehen,
   * während jedes Speichern drei Felder still leert.
   *
   * `StatusEingabe` ist Vollersatz. Ohne `forceRender` sind die eingeklappten Felder nicht
   * montiert, und `onFinish` liefert nur montierte Felder — ein `onErfassen` von dort schickte
   * `farbe: null`, `fms_anker: null`, `sortier: 0` an einen Datensatz, an dem niemand etwas
   * davon angefasst hat.
   *
   * Der Vorrat trägt deshalb in allen drei Feldern echte Werte, und der Weg klappt bewusst
   * NICHT auf.
   */
  it('behält Farbe, FMS-Anker, Sortierung und Zeitachsen-Marke, wenn niemand aufklappt', async () => {
    let ruempf: Record<string, unknown> | null = null;
    server.use(
      http.patch('/api/fahrzeug-status/1', async ({ request }) => {
        ruempf = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: 1 });
      }),
    );
    render(admin, [
      {
        id: 1,
        label: 'einsatzbereit',
        kategorie: 'verfuegbar',
        farbe: '#112233',
        fms_anker: 5,
        sortier: 10,
        zeitachse_marke: 'eintreffen',
      },
    ]);
    await screen.findByText('einsatzbereit');
    await userEvent.click(screen.getAllByRole('button', { name: 'Bearbeiten' })[0]);

    const dialog = await screen.findByRole('dialog');
    const feld = within(dialog).getByLabelText('Label');
    await userEvent.clear(feld);
    await userEvent.type(feld, 'bedingt einsatzbereit');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(ruempf).not.toBeNull());
    expect(ruempf).toEqual({
      label: 'bedingt einsatzbereit',
      kategorie: 'verfuegbar',
      farbe: '#112233',
      fms_anker: 5,
      sortier: 10,
      zeitachse_marke: 'eintreffen',
    });
  });

  /**
   * Die Gegenprobe: ein SICHTBAR geleertes Feld muss geleert ankommen. Ein Rückfall auf den
   * Bestandswert (`werte.farbe ?? bearbeite.farbe`) bestünde die Prüfung oben und fiele hier.
   */
  it('ein aufgeklappt geleertes Feld kommt auch geleert an', async () => {
    let ruempf: Record<string, unknown> | null = null;
    server.use(
      http.patch('/api/fahrzeug-status/1', async ({ request }) => {
        ruempf = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: 1 });
      }),
    );
    render(admin, [
      {
        id: 1,
        label: 'einsatzbereit',
        kategorie: 'verfuegbar',
        farbe: '#112233',
        fms_anker: 5,
        sortier: 10,
      },
    ]);
    await screen.findByText('einsatzbereit');
    await userEvent.click(screen.getAllByRole('button', { name: 'Bearbeiten' })[0]);

    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /Weitere Angaben/ }));
    await userEvent.clear(await within(dialog).findByLabelText('Farbe (Hex, optional)'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(ruempf).not.toBeNull());
    expect(ruempf).toMatchObject({ farbe: null, fms_anker: 5, sortier: 10 });
  });

  /**
   * Das Feldbudget: zwei sichtbare Felder statt sechs (die Zeitachsen-Marke, LFH-552, liegt
   * mit unter „Weitere Angaben").
   *
   * Gezählt werden `.ant-form-item`-Knoten, nicht `role="textbox"` — die Kategorie ist ein
   * `Select`. Die zweite Hälfte ist Pflicht: „höchstens zwei" erfüllte auch ein Dialog ohne Felder.
   */
  it('zeigt zwei Felder und deckt vier weitere erst beim Aufklappen auf', async () => {
    render(admin);
    await screen.findByText('einsatzbereit');
    await userEvent.click(screen.getAllByRole('button', { name: 'Bearbeiten' })[0]);
    const dialog = await screen.findByRole('dialog');

    expect(dialog.querySelectorAll('.ant-form-item')).toHaveLength(2);

    await userEvent.click(within(dialog).getByRole('button', { name: /Weitere Angaben/ }));
    await waitFor(() => expect(dialog.querySelectorAll('.ant-form-item')).toHaveLength(6));
  });

  describe('Zeitachsen-Marke (LFH-552)', () => {
    it('zeigt die Marke als Wort und ohne Marke „—"', async () => {
      render(admin, [{ ...status[0], zeitachse_marke: 'eintreffen' }, status[1]]);
      await screen.findByText('einsatzbereit');
      expect(screen.getByText('Eintreffen')).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Zeitachse' })).toBeInTheDocument();
    });

    it('Hinweis nur, solange kein Status eine Marke trägt', async () => {
      const { unmount } = render(admin);
      await screen.findByText('einsatzbereit');
      expect(screen.getByText(/Zeitachse: keine Marke gesetzt/)).toBeInTheDocument();
      unmount();
      render(admin, [{ ...status[0], zeitachse_marke: 'alarmierung' }, status[1]]);
      await screen.findByText('einsatzbereit');
      expect(screen.queryByText(/Zeitachse: keine Marke gesetzt/)).not.toBeInTheDocument();
    });

    it('kein Hinweis bei leerem Katalog', async () => {
      render(admin, []);
      await screen.findByText('Kein Status');
      expect(screen.queryByText(/Zeitachse: keine Marke gesetzt/)).not.toBeInTheDocument();
    });

    it('Leeren der Marke schickt null (Vollersatz entfernt sie)', async () => {
      let ruempf: Record<string, unknown> | null = null;
      server.use(
        http.patch('/api/fahrzeug-status/1', async ({ request }) => {
          ruempf = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({ id: 1 });
        }),
      );
      render(admin, [{ ...status[0], zeitachse_marke: 'eintreffen' }]);
      await screen.findByText('einsatzbereit');
      await userEvent.click(screen.getAllByRole('button', { name: 'Bearbeiten' })[0]);
      const dialog = await screen.findByRole('dialog');
      await userEvent.click(within(dialog).getByRole('button', { name: /Weitere Angaben/ }));
      const feld = (await within(dialog).findByLabelText('Zeitachse (optional)')).closest(
        '.ant-select',
      )!;
      await userEvent.hover(feld);
      await userEvent.click(feld.querySelector<HTMLElement>('.ant-select-clear')!);
      await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
      await waitFor(() => expect(ruempf).not.toBeNull());
      expect(ruempf).toMatchObject({ zeitachse_marke: null });
    });
  });
});
