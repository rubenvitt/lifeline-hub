import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import type { NeuerEintrag } from '../api/etb';
import { ladeEtbAnhangHoch } from '../api/etb';
import type { Anhang, EinsatzAnzeige, EtbBaustein, EtbEintragAnzeige } from '../api/types';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import Schnellerfassung from './Schnellerfassung';

/**
 * Der Bedienweg „Anhang" der ETB-Schnellerfassung (LFH-117, design.md D9). Der Upload ist
 * gemockt: geprüft wird die Reihenfolge Upload → Erfassen, was bei welchem Fehler stehen
 * bleibt, und dass ohne Netz nur der Text geht.
 */
vi.mock('../api/etb', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/etb')>()),
  ladeEtbAnhangHoch: vi.fn(),
}));
const hochladen = vi.mocked(ladeEtbAnhangHoch);

beforeEach(() => {
  server.use(
    http.get('/api/einsaetze/:id/fahrzeuge', () => HttpResponse.json([])),
    http.get('/api/einsaetze/:id/einheiten', () => HttpResponse.json([])),
  );
  hochladen.mockReset();
});

afterEach(() => vi.restoreAllMocks());

const einsatz = {
  id: 7,
  bezeichnung: 'Test',
  stichwort: null,
  leitstellen_nr: null,
  einsatzort: null,
} as unknown as EinsatzAnzeige;

function props(over: Partial<React.ComponentProps<typeof Schnellerfassung>> = {}) {
  return {
    erfassen: vi.fn<(e: NeuerEintrag) => Promise<void>>().mockResolvedValue(undefined),
    berichtigungZu: null as EtbEintragAnzeige | null,
    onBerichtigungAbbrechen: vi.fn(),
    bausteine: [] as EtbBaustein[],
    einsatz,
    ...over,
  };
}

function datei(name: string, groesse?: number, lastModified = 1_700_000_000_000): File {
  // `lastModified` fest: jsdom stempelt sonst `Date.now()`, und die Dublettenprüfung
  // (Name + Größe + lastModified) hinge an der Uhr.
  const f = new File(['abc'], name, { type: 'image/jpeg', lastModified });
  if (groesse != null) Object.defineProperty(f, 'size', { value: groesse });
  return f;
}

function anzeige(id: number, name: string): Anhang {
  return {
    id,
    einsatz_id: 7,
    dateiname: name,
    mime: 'image/jpeg',
    groesse: 3,
    hochgeladen_von: 1,
    erstellt_at: '2026-09-25 10:00:00',
  };
}

function eingabe(container: HTMLElement): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!el) throw new Error('Dateieingabe fehlt');
  return el;
}

async function waehle(container: HTMLElement, ...dateien: File[]) {
  await userEvent.upload(eingabe(container), dateien);
}

function liste(): HTMLElement {
  return screen.getByRole('list', { name: 'Gewählte Anhänge' });
}

function feld(): HTMLElement {
  return screen.getByPlaceholderText(/Inhalt/);
}

function setzeOnline(online: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
  act(() => {
    window.dispatchEvent(new Event(online ? 'online' : 'offline'));
  });
}

describe('Schnellerfassung – Anhang wählen (LFH-117)', () => {
  it('bietet „Anhang" als Knopf an, der den Dateidialog öffnet', async () => {
    const { container } = renderMitProviders(<Schnellerfassung {...props()} />);
    const klick = vi.spyOn(eingabe(container), 'click');
    await userEvent.click(screen.getByRole('button', { name: 'Anhang' }));
    expect(klick).toHaveBeenCalledTimes(1);
    // Der Dateidialog nimmt die Dokument-Allowlist (HEIC für iPhone-Fotos).
    expect(eingabe(container).accept).toContain('.heic');
    expect(eingabe(container).multiple).toBe(true);
  });

  it('zeigt gewählte Dateien mit Name und Größe und entfernt sie einzeln', async () => {
    const { container } = renderMitProviders(<Schnellerfassung {...props()} />);
    await waehle(container, datei('a.jpg'), datei('b.jpg'));
    expect(within(liste()).getByText('a.jpg · 3 B')).toBeInTheDocument();
    expect(within(liste()).getByText('b.jpg · 3 B')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Anhang a.jpg entfernen' }));
    expect(within(liste()).queryByText(/a\.jpg/)).toBeNull();
    expect(within(liste()).getByText('b.jpg · 3 B')).toBeInTheDocument();
  });

  it('weist eine Datei über 25 MiB schon beim Wählen mit Begründung ab', async () => {
    const { container } = renderMitProviders(<Schnellerfassung {...props()} />);
    await waehle(container, datei('riesig.jpg', 25 * 1024 * 1024 + 1), datei('klein.jpg'));
    expect(screen.getByText(/riesig\.jpg ist zu groß \(25 MiB erlaubt\)/)).toBeInTheDocument();
    expect(within(liste()).queryByText(/riesig/)).toBeNull();
    expect(within(liste()).getByText('klein.jpg · 3 B')).toBeInTheDocument();
  });

  it('nimmt höchstens 10 Anhänge an, sagt warum und sperrt „Anhang" an der Grenze', async () => {
    const { container } = renderMitProviders(<Schnellerfassung {...props()} />);
    const elf = Array.from({ length: 11 }, (_, i) => datei(`f${i + 1}.jpg`));
    await waehle(container, ...elf);
    expect(within(liste()).getAllByRole('listitem')).toHaveLength(10);
    expect(within(liste()).queryByText(/f11\.jpg/)).toBeNull();
    expect(screen.getByText(/f11\.jpg: höchstens 10 Anhänge je Eintrag/)).toBeInTheDocument();
    // Zweiter Kanal neben dem Grau: der Grund steht als Satz am Knopf.
    expect(screen.getByRole('button', { name: 'Anhang' })).toBeDisabled();
    expect(screen.getByText('Höchstens 10 Anhänge je Eintrag.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Anhang f1.jpg entfernen' }));
    expect(screen.getByRole('button', { name: 'Anhang' })).toBeEnabled();
    expect(screen.queryByText('Höchstens 10 Anhänge je Eintrag.')).toBeNull();
  });

  it('nimmt dieselbe Datei nur einmal — Name, Größe und Änderungszeit entscheiden', async () => {
    const { container } = renderMitProviders(<Schnellerfassung {...props()} />);
    await waehle(container, datei('a.jpg'));
    // Eine neue Wahl liefert ein NEUES File-Objekt derselben Datei.
    await waehle(container, datei('a.jpg'));
    expect(within(liste()).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText(/a\.jpg ist schon gewählt/)).toBeInTheDocument();

    // Gegenprobe: gleicher Name, gleiche Größe, andere Änderungszeit — eine andere Datei.
    await waehle(container, datei('a.jpg', undefined, 1_700_000_999_000));
    expect(within(liste()).getAllByRole('listitem')).toHaveLength(2);
    // Gleichnamige Einträge sind für Vorlesende nur über die Position zu unterscheiden.
    expect(screen.getByRole('button', { name: 'Anhang 1, a.jpg entfernen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anhang 2, a.jpg entfernen' })).toBeInTheDocument();
  });

  it('sperrt „Anhang" ohne Netz und sagt sichtbar warum — der Text geht trotzdem', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    expect(screen.getByRole('button', { name: 'Anhang' })).toBeDisabled();
    expect(
      screen.getByText('Anhänge brauchen eine Verbindung. Der Text lässt sich trotzdem erfassen.'),
    ).toBeVisible();

    await userEvent.type(feld(), 'Lage ruhig{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect(vi.mocked(p.erfassen).mock.calls[0][0].anhang_ids).toBeUndefined();
    expect(hochladen).not.toHaveBeenCalled();
  });

  it('lässt die Hinweiszeile unverändert — kein neues Tastenkürzel', () => {
    renderMitProviders(<Schnellerfassung {...props()} />);
    const hinweis = screen.getByText(/^Enter sendet/);
    expect(hinweis).toHaveTextContent(
      'Enter sendet · Shift+Enter neue Zeile · Mehrzeiler mit Cmd/Strg+Enter senden',
    );
    expect(hinweis.parentElement).not.toHaveTextContent(/Anhang/);
  });
});

describe('Schnellerfassung – Absenden mit Anhängen (LFH-117)', () => {
  it('lädt erst hoch, dann erfasst sie mit anhang_ids in Wahlreihenfolge — per Enter', async () => {
    hochladen
      .mockResolvedValueOnce(anzeige(12, 'a.jpg'))
      .mockResolvedValueOnce(anzeige(11, 'b.jpg'));
    const p = props();
    const { container } = renderMitProviders(<Schnellerfassung {...p} />);
    const a = datei('a.jpg');
    const b = datei('b.jpg');
    await waehle(container, a, b);
    await userEvent.type(feld(), 'Foto Schadenstelle{Enter}');

    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect(hochladen.mock.calls.map((c) => c[1])).toEqual([a, b]);
    expect(hochladen.mock.calls[0][0]).toBe(7);
    expect(vi.mocked(p.erfassen).mock.calls[0][0].anhang_ids).toEqual([12, 11]);
    expect(hochladen.mock.invocationCallOrder[1]).toBeLessThan(
      vi.mocked(p.erfassen).mock.invocationCallOrder[0],
    );
    // Erfolg: Liste und Wortlaut geleert.
    await waitFor(() =>
      expect(screen.queryByRole('list', { name: 'Gewählte Anhänge' })).toBeNull(),
    );
    expect(feld()).toHaveValue('');
  });

  it('meldet den Fortschritt am Erfassen-Knopf', async () => {
    let freigeben: (a: Anhang) => void = () => {};
    hochladen
      .mockImplementationOnce(() => new Promise((r) => (freigeben = r)))
      .mockResolvedValueOnce(anzeige(2, 'b.jpg'));
    const { container } = renderMitProviders(<Schnellerfassung {...props()} />);
    await waehle(container, datei('a.jpg'), datei('b.jpg'));
    await userEvent.type(feld(), 'x{Enter}');
    expect(await screen.findByText('Lädt hoch (1/2) …')).toBeInTheDocument();
    await act(async () => freigeben(anzeige(1, 'a.jpg')));
    await waitFor(() => expect(screen.queryByText(/Lädt hoch/)).toBeNull());
  });

  it('erfasst nicht, wenn ein Upload scheitert — Wortlaut, Liste und Grund stehen', async () => {
    hochladen.mockRejectedValueOnce(new Error('Datei ist zu groß (25 MiB erlaubt)'));
    const p = props();
    const { container } = renderMitProviders(<Schnellerfassung {...p} />);
    await waehle(container, datei('a.jpg'));
    await userEvent.type(feld(), 'Foto{Enter}');

    expect(
      await screen.findByText(/a\.jpg konnte nicht hochgeladen werden: Datei ist zu groß/),
    ).toBeInTheDocument();
    expect(p.erfassen).not.toHaveBeenCalled();
    expect(feld()).toHaveValue('Foto');
    expect(within(liste()).getByText('a.jpg · 3 B')).toBeInTheDocument();
  });

  it('behält bei fachlicher Ablehnung alles und lädt beim nächsten Versuch neu hoch', async () => {
    hochladen.mockResolvedValueOnce(anzeige(1, 'a.jpg')).mockResolvedValueOnce(anzeige(2, 'a.jpg'));
    const p = props({
      erfassen: vi
        .fn<(e: NeuerEintrag) => Promise<void>>()
        .mockRejectedValueOnce(new ApiError(400, 'Anhang unbekannt oder nicht mehr vorhanden'))
        .mockResolvedValueOnce(undefined),
    });
    const { container } = renderMitProviders(<Schnellerfassung {...p} />);
    await waehle(container, datei('a.jpg'));
    await userEvent.type(feld(), 'Foto{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect(feld()).toHaveValue('Foto');
    expect(within(liste()).getByText('a.jpg · 3 B')).toBeInTheDocument();

    // Name per Muster: antds Ladeikone bleibt in jsdom am Knopf hängen (kein transitionend).
    const knopf = screen.getByRole('button', { name: /Erfassen$/ });
    await waitFor(() => expect(knopf).not.toHaveClass('ant-btn-loading'));
    fireEvent.click(knopf);
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(2));
    // Die ID des ersten Versuchs könnte die Ursache sein — sie wird nicht wiederverwendet.
    expect(hochladen).toHaveBeenCalledTimes(2);
    expect(vi.mocked(p.erfassen).mock.calls[1][0].anhang_ids).toEqual([2]);
  });

  it('lädt nach einem Teilausfall nur die fehlende Datei neu hoch', async () => {
    hochladen
      .mockResolvedValueOnce(anzeige(1, 'a.jpg'))
      .mockRejectedValueOnce(new Error('Zeitüberschreitung'))
      .mockResolvedValueOnce(anzeige(3, 'b.jpg'));
    const p = props();
    const { container } = renderMitProviders(<Schnellerfassung {...p} />);
    const a = datei('a.jpg');
    const b = datei('b.jpg');
    await waehle(container, a, b);
    await userEvent.type(feld(), 'Foto{Enter}');
    await screen.findByText(/b\.jpg konnte nicht hochgeladen werden/);
    expect(p.erfassen).not.toHaveBeenCalled();

    // Name per Muster: antds Ladeikone bleibt in jsdom am Knopf hängen (kein transitionend).
    const knopf = screen.getByRole('button', { name: /Erfassen$/ });
    await waitFor(() => expect(knopf).not.toHaveClass('ant-btn-loading'));
    fireEvent.click(knopf);
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect(hochladen.mock.calls.map((c) => c[1])).toEqual([a, b, b]);
    expect(vi.mocked(p.erfassen).mock.calls[0][0].anhang_ids).toEqual([1, 3]);
  });

  it('leert Liste und Wortlaut, wenn erfassen nach dem Einreihen ohne Fehler zurückkommt', async () => {
    // Der transiente Fall aus `useEtbErfassung`: Netzfehler NACH dem Upload → der Eintrag geht
    // samt `anhang_ids` in die Queue, und `erfassen` löst sich auf. Für die Erfassung ist das
    // ein Erfolg.
    hochladen.mockResolvedValueOnce(anzeige(1, 'a.jpg'));
    const p = props();
    const { container } = renderMitProviders(<Schnellerfassung {...p} />);
    await waehle(container, datei('a.jpg'));
    await userEvent.type(feld(), 'Foto{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect(vi.mocked(p.erfassen).mock.calls[0][0].anhang_ids).toEqual([1]);
    await waitFor(() => expect(feld()).toHaveValue(''));
    expect(screen.queryByRole('list', { name: 'Gewählte Anhänge' })).toBeNull();
  });

  it('weist ohne Netz ab, wenn Dateien in der Liste liegen — ohne etwas zu leeren', async () => {
    const p = props();
    const { container } = renderMitProviders(<Schnellerfassung {...p} />);
    await waehle(container, datei('a.jpg'));
    setzeOnline(false);
    await userEvent.type(feld(), 'Foto{Enter}');

    expect(
      await screen.findByText(/Ohne Verbindung lassen sich keine Anhänge senden/),
    ).toBeInTheDocument();
    expect(hochladen).not.toHaveBeenCalled();
    expect(p.erfassen).not.toHaveBeenCalled();
    expect(feld()).toHaveValue('Foto');
    expect(within(liste()).getByText('a.jpg · 3 B')).toBeInTheDocument();
  });

  it('leert die Liste nach Erfolg auch mit „Werte behalten" — Von/An/Meldeweg bleiben', async () => {
    hochladen.mockResolvedValueOnce(anzeige(1, 'a.jpg'));
    const p = props({
      werteBehalten: true,
      onWerteBehaltenChange: vi.fn(),
      initialWerte: { inhalt: '', typ: 'meldung', metadaten: { von: 'ELW 1' } },
    });
    const { container } = renderMitProviders(<Schnellerfassung {...p} />);
    await waehle(container, datei('a.jpg'));
    await userEvent.type(feld(), 'Foto{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByRole('list', { name: 'Gewählte Anhänge' })).toBeNull(),
    );
    expect(screen.getByText('Von: ELW 1')).toBeInTheDocument();
  });

  it('bietet „Anhang" auch im Berichtigungsmodus an', async () => {
    hochladen.mockResolvedValueOnce(anzeige(4, 'richtig.jpg'));
    const p = props({
      berichtigungZu: {
        id: 5,
        lfd_nr: 5,
        typ: 'meldung',
        inhalt: 'Original',
        von: null,
        an: null,
        meldeweg: null,
        veranlassung: null,
        erfasser_id: 1,
        erfasser_name: 'Max',
        ereigniszeit: '2026-05-23 10:00:00',
        received_at: '2026-05-23 10:00:01',
        erfasst_lokal_at: null,
        berichtigt_eintrag_id: null,
        lagebericht_id: null,
        auftrag_id: null,
        befehl_id: null,
        folgeauftraege: [],
        anhaenge: [],
      },
    });
    const { container } = renderMitProviders(<Schnellerfassung {...p} />);
    await waehle(container, datei('richtig.jpg'));
    await userEvent.type(feld(), 'Richtig ist{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect(vi.mocked(p.erfassen).mock.calls[0][0]).toMatchObject({
      typ: 'berichtigung',
      berichtigt_eintrag_id: 5,
      anhang_ids: [4],
    });
  });
});

describe('Schnellerfassung – Sendezustand (LFH-117, Review)', () => {
  it('nimmt die Erfassungszeit beim Absenden, nicht nach dem Upload', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-09-25T10:00:00Z'));
      let freigeben: (a: Anhang) => void = () => {};
      hochladen.mockImplementationOnce(() => new Promise((r) => (freigeben = r)));
      const p = props();
      const { container } = renderMitProviders(<Schnellerfassung {...p} />);
      await waehle(container, datei('a.jpg'));
      await userEvent.type(feld(), 'Foto{Enter}');
      await screen.findByText('Lädt hoch (1/1) …');
      // Der Upload dauert fünf Minuten.
      vi.setSystemTime(new Date('2026-09-25T10:05:00Z'));
      await act(async () => freigeben(anzeige(1, 'a.jpg')));
      await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
      const e = vi.mocked(p.erfassen).mock.calls[0][0];
      expect(e.erfasst_lokal_at).toBe('2026-09-25T10:00:00.000Z');
      expect(e.ereigniszeit).toBe('2026-09-25 10:00:00');
    } finally {
      vi.useRealTimers();
    }
  });

  it('sperrt Text und „Anhang" während des Absendens — nichts wird still verworfen', async () => {
    let freigeben: (a: Anhang) => void = () => {};
    hochladen.mockImplementationOnce(() => new Promise((r) => (freigeben = r)));
    const p = props();
    const { container } = renderMitProviders(<Schnellerfassung {...p} />);
    await waehle(container, datei('a.jpg'));
    await userEvent.type(feld(), 'Foto{Enter}');
    await screen.findByText('Lädt hoch (1/1) …');

    expect(feld()).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Anhang' })).toBeDisabled();
    await userEvent.type(feld(), ' und mehr');
    expect(feld()).toHaveValue('Foto');

    await act(async () => freigeben(anzeige(1, 'a.jpg')));
    await waitFor(() => expect(feld()).not.toHaveAttribute('readonly'));
    expect(screen.getByRole('button', { name: 'Anhang' })).toBeEnabled();
  });

  /**
   * Review C1: gesperrt war nur Text und „Anhang" — Typ, „Feld", die Chips und „Werte
   * behalten" blieben bedienbar, und was man dort während des Uploads änderte, ging nicht mit
   * und wurde nach dem Erfolg still geleert. Geprüft wird die GANZE Erfassung, mit einer
   * ausdrücklichen Ausnahmeliste: ein neues Bedienelement rutscht so nicht durch.
   */
  it('sperrt während des Absendens JEDES Bedienelement der Erfassung außer „Vorschau"', async () => {
    let freigeben: (a: Anhang) => void = () => {};
    hochladen.mockImplementationOnce(() => new Promise((r) => (freigeben = r)));
    const p = props({
      // Typ `lage`: dann steht auch der Sprung zum strukturierten Lagebericht in der Erfassung.
      initialWerte: { inhalt: '', typ: 'lage', metadaten: { an: 'Florian 1', von: 'Kater 2' } },
      werteBehalten: false,
      onWerteBehaltenChange: vi.fn(),
      bausteine: [{ id: 3, titel: 'Lage', inhalt: 'Text' } as unknown as EtbBaustein],
    });
    const { container } = renderMitProviders(<Schnellerfassung {...p} />);
    await waehle(container, datei('a.jpg'));
    await userEvent.type(feld(), 'Foto{Enter}');
    await screen.findByText('Lädt hoch (1/1) …');
    expect(screen.getByText(/Als strukturierten Lagebericht erfassen/)).toBeInTheDocument();

    const bereich = container.querySelector<HTMLElement>('[data-lfh="etb-erfassung"]')!;
    const ausnahmen = new Set(['Vorschau']);
    const offen: string[] = [];
    for (const el of bereich.querySelectorAll<HTMLElement>(
      'button, input, textarea, select, [role="button"], [role="combobox"]',
    )) {
      const name =
        el.getAttribute('aria-label') ?? el.textContent?.trim() ?? el.getAttribute('type') ?? '';
      if (ausnahmen.has(name)) continue;
      // „Erfassen" steht im Ladezustand — antd nimmt dann keinen Klick an.
      if (el.classList.contains('ant-btn-loading')) continue;
      const gesperrt =
        (el as HTMLButtonElement).disabled ||
        el.getAttribute('aria-disabled') === 'true' ||
        (el as HTMLInputElement).readOnly;
      if (!gesperrt) offen.push(`${el.tagName.toLowerCase()} „${name}"`);
    }
    expect(offen).toEqual([]);

    // Auch der Maus-Schnellweg am Chip-Text öffnet keinen Editor.
    await userEvent.click(screen.getByText('An: Florian 1'));
    expect(screen.queryByRole('combobox', { name: 'An' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'An' })).toBeNull();

    await act(async () => freigeben(anzeige(1, 'a.jpg')));
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect(vi.mocked(p.erfassen).mock.calls[0][0]).toMatchObject({
      typ: 'lage',
      an: 'Florian 1',
      von: 'Kater 2',
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Feld' })).toBeEnabled());
    expect(screen.getByRole('button', { name: /Eintragstyp/ })).toBeEnabled();
  });

  it('lädt nichts hoch, wenn die Liste über der Grenze liegt', async () => {
    const elf = Array.from({ length: 11 }, (_, i) => datei(`f${i + 1}.jpg`));
    const p = props({ dateien: elf, onDateienChange: vi.fn() });
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.type(feld(), 'Fotos{Enter}');
    expect(
      await screen.findByText('Höchstens 10 Anhänge je Eintrag. Entferne 1.'),
    ).toBeInTheDocument();
    expect(hochladen).not.toHaveBeenCalled();
    expect(p.erfassen).not.toHaveBeenCalled();
    expect(feld()).toHaveValue('Fotos');
  });

  it('schickt die client_id des Aufrufers', async () => {
    const p = props({ clientId: 'entwurf-7' });
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.type(feld(), 'Lage{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect(vi.mocked(p.erfassen).mock.calls[0][0].client_id).toBe('entwurf-7');
  });

  it('hält ohne Aufrufer-id eine eigene client_id bis zum Erfolg und nimmt danach eine neue', async () => {
    const p = props({
      erfassen: vi
        .fn<(e: NeuerEintrag) => Promise<void>>()
        .mockRejectedValueOnce(new Error('abgelehnt'))
        .mockResolvedValue(undefined),
    });
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.type(feld(), 'Eins{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    const knopf = screen.getByRole('button', { name: /Erfassen$/ });
    await waitFor(() => expect(knopf).not.toHaveClass('ant-btn-loading'));
    fireEvent.click(knopf);
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(feld()).toHaveValue(''));
    await userEvent.type(feld(), 'Zwei{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(3));

    const ids = vi.mocked(p.erfassen).mock.calls.map((c) => c[0].client_id);
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it('hält hochgeladene Dateien bei einer Ablehnung ohne Anhangsbezug (403) — kein zweiter Upload', async () => {
    hochladen.mockResolvedValueOnce(anzeige(1, 'a.jpg'));
    const p = props({
      erfassen: vi
        .fn<(e: NeuerEintrag) => Promise<void>>()
        .mockRejectedValueOnce(new ApiError(403, 'Keine Berechtigung'))
        .mockResolvedValueOnce(undefined),
    });
    const { container } = renderMitProviders(<Schnellerfassung {...p} />);
    await waehle(container, datei('a.jpg'));
    await userEvent.type(feld(), 'Foto{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    const knopf = screen.getByRole('button', { name: /Erfassen$/ });
    await waitFor(() => expect(knopf).not.toHaveClass('ant-btn-loading'));
    fireEvent.click(knopf);
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(2));
    expect(hochladen).toHaveBeenCalledTimes(1);
    expect(vi.mocked(p.erfassen).mock.calls[1][0].anhang_ids).toEqual([1]);
  });

  it('nimmt nach einem client_id-Konflikt (409) einen neuen Schlüssel und sagt es an der Erfassung', async () => {
    const konflikt =
      'client_id bereits für einen anderen Eintrag verwendet: dieser Wortlaut ist nicht erfasst.';
    const p = props({
      erfassen: vi
        .fn<(e: NeuerEintrag) => Promise<void>>()
        .mockRejectedValueOnce(new ApiError(409, konflikt))
        .mockResolvedValueOnce(undefined),
    });
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.type(feld(), 'Text{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(konflikt)).toBeInTheDocument();
    expect(feld()).toHaveValue('Text');
    const knopf = screen.getByRole('button', { name: /Erfassen$/ });
    await waitFor(() => expect(knopf).not.toHaveClass('ant-btn-loading'));
    fireEvent.click(knopf);
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(2));
    const [erste, zweite] = vi.mocked(p.erfassen).mock.calls.map((c) => c[0].client_id);
    expect(zweite).not.toBe(erste);
  });

  it('lässt eine laufende Berichtigung nicht abbrechen', async () => {
    let freigeben: () => void = () => {};
    const p = props({
      erfassen: vi
        .fn<(e: NeuerEintrag) => Promise<void>>()
        .mockImplementation(() => new Promise<void>((r) => (freigeben = r))),
      berichtigungZu: {
        id: 5,
        lfd_nr: 5,
        typ: 'meldung',
        inhalt: 'Original',
        von: null,
        an: null,
        meldeweg: null,
        veranlassung: null,
        erfasser_id: 1,
        erfasser_name: 'Max',
        ereigniszeit: '2026-05-23 10:00:00',
        received_at: '2026-05-23 10:00:01',
        erfasst_lokal_at: null,
        berichtigt_eintrag_id: null,
        lagebericht_id: null,
        auftrag_id: null,
        befehl_id: null,
        folgeauftraege: [],
        anhaenge: [],
      },
    });
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.type(feld(), 'Richtig ist{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeDisabled();
    await act(async () => freigeben());
  });
});
