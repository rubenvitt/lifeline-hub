import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { meHandler, server } from '../test/server';
import { renderMitProviders, sortTarget } from '../test/utils';
import QualifikationenTab from './QualifikationenTab';
import { adminFixture } from '../test/fixtures';
import { offeneRueckfrage } from '../test/rueckfrage';
import { keinStehenderFehler, stehenderFehler } from '../test/stehenderFehler';
import { optionenVon, oeffne, waehle } from '../test/auswahlListe';

const admin = adminFixture();
const nichtAdmin = adminFixture({ system_rolle: 'keiner' });

/**
 * Die Fixture kommt in FACHLICHER Reihenfolge (`sortier` 10 vor 60), die zugleich NICHT die
 * alphabetische ist — sonst sähe die Tabelle nach dem Sortierklick genauso aus wie davor und
 * die Zusicherung unten bewiese nichts.
 */
const quals: { id: number; label: string; sortier: number; schliesst_ein_id?: number | null }[] = [
  { id: 1, label: 'Sanitäter', sortier: 10 },
  { id: 2, label: 'Gruppenführer', sortier: 60 },
];

/** Eine Kette Notfallsanitäter → Rettungssanitäter → Sanitäter, daneben der Notarzt (LLH-1553). */
const kette = [
  { id: 1, label: 'Sanitäter', sortier: 10, schliesst_ein_id: null },
  { id: 2, label: 'Rettungssanitäter', sortier: 20, schliesst_ein_id: 1 },
  { id: 3, label: 'Notfallsanitäter', sortier: 30, schliesst_ein_id: 2 },
  { id: 4, label: 'Notarzt', sortier: 40, schliesst_ein_id: null },
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
    await userEvent.click(
      sortTarget(container.querySelector<HTMLElement>('th.ant-table-cell-fix-start')!),
    );
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

    // Der Grund steht IM Dialog, kein Toast (LFH-1077, `frontend/AGENTS.md`, „Rückwege und
    // Fehler“).
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Label bereits vergeben');
    expect(within(dialog).getByLabelText('Label')).toHaveValue('Gruppenführer');
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it('zeigt nach Abbrechen und erneutem Bearbeiten keinen alten Grund', async () => {
    server.use(
      http.patch('/api/qualifikationen/1', () =>
        HttpResponse.json({ error: 'Label bereits vergeben' }, { status: 422 }),
      ),
    );
    render(admin);
    await screen.findByText('Sanitäter');
    await userEvent.click(screen.getAllByRole('button', { name: 'Bearbeiten' })[0]);

    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await within(dialog).findByRole('alert');

    // Kein Warten auf das Verschwinden: rc-dialog friert den Inhalt eines schließenden Dialogs
    // ein, und jsdom beendet die Animation nie.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Bearbeiten' })[1]);
    const wieder = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(within(wieder).getByLabelText('Label')).toHaveValue('Gruppenführer'),
    );
    expect(within(wieder).queryByRole('alert')).toBeNull();
  });
});

/**
 * Fehlschläge stehen an der SEITE, nicht im Toast (LFH-473). Der Slot ist EINER für zwei
 * Handlungen (Anlegen und Deaktivieren); wer eine auslöst, räumt auch den Fehler der
 * anderen — sonst stünde nach dem nächsten Versuch ein alter Grund über der Seite.
 */
describe('QualifikationenTab — Fehlschläge als stehender Hinweis (LFH-473)', () => {
  it('Deaktivieren: der Hinweis steht und geht beim nächsten Absenden', async () => {
    let versuch = 0;
    server.use(
      http.post('/api/qualifikationen/:id/deaktivieren', () => {
        versuch += 1;
        if (versuch > 1) return new Promise<never>(() => {});
        return HttpResponse.json(
          { error: 'Qualifikation ist Personal zugeordnet' },
          { status: 409 },
        );
      }),
    );
    render(admin);
    await screen.findByText('Sanitäter');

    await userEvent.click(screen.getAllByRole('button', { name: 'Deaktivieren' })[0]);
    await userEvent.click(
      within(await offeneRueckfrage()).getByRole('button', { name: 'Qualifikation deaktivieren' }),
    );
    const hinweis = await stehenderFehler('Qualifikation ist Personal zugeordnet');
    expect(hinweis).toHaveTextContent('Nicht deaktiviert');

    await userEvent.click(screen.getAllByRole('button', { name: 'Deaktivieren' })[0]);
    await userEvent.click(
      within(await offeneRueckfrage()).getByRole('button', { name: 'Qualifikation deaktivieren' }),
    );
    await keinStehenderFehler('Qualifikation ist Personal zugeordnet');
    expect(versuch).toBe(2);
  });

  it('Anlegen: der Hinweis steht, das Feld behält den Text, Deaktivieren räumt ihn', async () => {
    server.use(
      http.post('/api/qualifikationen', () =>
        HttpResponse.json({ error: 'Label bereits vergeben' }, { status: 409 }),
      ),
      http.post('/api/qualifikationen/:id/deaktivieren', () => new Promise<never>(() => {})),
    );
    render(admin);
    await screen.findByText('Sanitäter');

    await userEvent.type(screen.getByLabelText('Neue Qualifikation'), 'Sanitäter{Enter}');
    const hinweis = await stehenderFehler('Label bereits vergeben');
    expect(hinweis).toHaveTextContent('Nicht angelegt');
    expect(screen.getByLabelText('Neue Qualifikation')).toHaveValue('Sanitäter');

    await userEvent.click(screen.getAllByRole('button', { name: 'Deaktivieren' })[0]);
    await userEvent.click(
      within(await offeneRueckfrage()).getByRole('button', { name: 'Qualifikation deaktivieren' }),
    );
    await keinStehenderFehler('Label bereits vergeben');
  });

  it('„Schließt ein“: Spalte zeigt die Stufe, die Auswahl lässt Kreise weg, Speichern schickt sie', async () => {
    const ruempfe: unknown[] = [];
    server.use(
      http.patch('/api/qualifikationen/1', async ({ request }) => {
        ruempfe.push(await request.json());
        return HttpResponse.json({ ...kette[0], schliesst_ein_id: 4 });
      }),
    );
    render(admin, kette);
    const zeile = (await screen.findByText('Notfallsanitäter')).closest('tr')!;
    expect(within(zeile).getByText('Rettungssanitäter')).toBeInTheDocument();

    // Sanitäter steht unten in der Kette: RS und NotSan schlössen einen Kreis.
    await userEvent.click(screen.getAllByRole('button', { name: 'Bearbeiten' })[0]);
    await screen.findByRole('dialog');
    await oeffne('Schließt ein');
    expect(optionenVon('Schließt ein')).toEqual(['Notarzt']);
    await waehle('Schließt ein', 'Notarzt');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(ruempfe).toHaveLength(1));
    expect(ruempfe[0]).toEqual({ label: 'Sanitäter', sortier: 10, schliesst_ein_id: 4 });
  });
});

describe('QualifikationenTab mit Stammdaten vom Hub (LLH-1493)', () => {
  it('Herkunft als Spalte, Zeile vom Hub ohne Bearbeiten und Deaktivieren', async () => {
    server.use(
      http.get('/api/instanz/stammdaten/herkunft', () =>
        HttpResponse.json({
          quelle: 'Hub DRK Landesverband',
          vom_hub: { qualifikation: ['1'] },
          admins_ohne_passkey: [],
        }),
      ),
    );
    render(admin);
    const hub = (await screen.findByText('Sanitäter')).closest('tr')!;
    await waitFor(() => expect(within(hub).getByText('vom Hub')).toBeInTheDocument());
    expect(within(hub).getByText('Wird am Hub gepflegt')).toBeInTheDocument();
    expect(within(hub).queryByRole('button', { name: 'Deaktivieren' })).toBeNull();
    const lokal = screen.getByText('Gruppenführer').closest('tr')!;
    expect(within(lokal).getByText('nur hier')).toBeInTheDocument();
    expect(within(lokal).getByRole('button', { name: 'Bearbeiten' })).toBeEnabled();
  });
});
