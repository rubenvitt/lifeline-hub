import { createRef } from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setzeViewportBreite } from '../test/viewport';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NeuerEintrag } from '../api/etb';
import type { EtbBaustein, EtbEintragAnzeige } from '../api/types';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import MarkdownEditor, { type TextAreaRef } from '../components/MarkdownEditor';
import Schnellerfassung, { chipZeileStil, rolleWaagerechtInsBild } from './Schnellerfassung';
import type { EntwurfWerte } from './entwuerfe/entwurfModell';
import { einsatzFixture } from '../test/fixtures';
import { ohneSicherenKontext } from '../test/ohneSicherenKontext';
import { useLocation } from 'react-router';
import { rufnameZugriff } from '../test/standardRufname';

// Die Schnellerfassung lädt über useFunkrufnamen immer /fahrzeuge + /einheiten.
// onUnhandledRequest: 'error' im Setup → Default-Handler (leere Listen) bereitstellen,
// damit die Bestandstests (Freitext-Fallback) nicht an ungemockten Requests scheitern.
// Test-spezifische server.use(...) überschreiben diese Defaults.
beforeEach(() => {
  server.use(
    http.get('/api/einsaetze/:id/fahrzeuge', () => HttpResponse.json([])),
    http.get('/api/einsaetze/:id/einheiten', () => HttpResponse.json([])),
  );
});

const einsatz = einsatzFixture({ id: 7, bezeichnung: 'Test' });

function original(): EtbEintragAnzeige {
  return {
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
    berichtigt_durch: [],
    anhaenge: [],
  };
}

function props(over: Partial<React.ComponentProps<typeof Schnellerfassung>> = {}) {
  return {
    erfassen: vi.fn<(e: NeuerEintrag) => Promise<void>>().mockResolvedValue(undefined),
    berichtigungZu: null,
    onBerichtigungAbbrechen: vi.fn(),
    bausteine: [] as EtbBaustein[],
    einsatz,
    rufname: rufnameZugriff(),
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Caret-Ref-Verifikation (kritischer Integrationstest)
// ---------------------------------------------------------------------------

describe('TextAreaRef – Caret-Pfad', () => {
  it('resizableTextArea.textArea ist eine HTMLTextAreaElement-Instanz', () => {
    const ref = createRef<TextAreaRef>();
    renderMitProviders(
      <MarkdownEditor unterEbene={3} layout="toggle" value="" onChange={() => {}} ref={ref} />,
    );
    expect(ref.current?.resizableTextArea?.textArea).toBeInstanceOf(HTMLTextAreaElement);
  });

  it('/ mitten im Text triggert mit korrektem Caret-Filter (beweist echten Caret-Read)', async () => {
    // Test unterscheidet: korrekter Caret(4) → filter '' → alle Felder sichtbar.
    // Kaputter Fallback (textLength=6) → filter 'cd' → kein Feld sichtbar.
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, 'ab cd');
    // Caret zwischen "ab " und "cd" setzen, dann '/' tippen → "ab /cd", Caret=4
    await userEvent.type(feld, '/', { initialSelectionStart: 3, initialSelectionEnd: 3 });
    // Korrekter Caret(4) → filter '' → alle Felder. Kaputter Fallback(len=6) → filter 'cd' → kein Feld.
    expect(await screen.findByText('Ereigniszeit')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Container-Tests
// ---------------------------------------------------------------------------

describe('Schnellerfassung', () => {
  it('LFH-894: Von und An kommen aus dem Standard-Rufnamen, nicht aus der Führungsstelle', async () => {
    const p = props({
      einsatz: { ...einsatz, meine_fuehrungsstelle: 'Florian Leitung' },
      rufname: rufnameZugriff({ von: 'ELW 1', an: 'Einsatzleitung' }),
    });
    renderMitProviders(<Schnellerfassung {...p} />);
    expect(screen.queryByText('An: Florian Leitung')).not.toBeInTheDocument();
    expect(screen.getByText('Von: ELW 1')).toBeInTheDocument();
    expect(screen.getByText('An: Einsatzleitung')).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Lage ruhig{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      von: 'ELW 1',
      an: 'Einsatzleitung',
    });
  });

  it('LFH-894: ein Entwurf mit eigenem An schlägt den Standard nur auf dieser Seite', () => {
    renderMitProviders(
      <Schnellerfassung
        {...props({
          initialWerte: {
            inhalt: 'Entwurf',
            typ: 'meldung',
            metadaten: { an: 'Eigener Empfänger' },
          },
        })}
      />,
    );
    expect(screen.getByText('An: Eigener Empfänger')).toBeInTheDocument();
    expect(screen.getByText('Von: ELW 1')).toBeInTheDocument();
  });

  it('Enter sendet typ=meldung mit Inhalt; Feld danach leer', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, 'Pumpe läuft{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    const arg = (p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({ typ: 'meldung', inhalt: 'Pumpe läuft' });
    expect(arg.erfasst_lokal_at).toBeTruthy();
    expect(feld).toHaveValue('');
  });

  it('LFH-762: rendert und erfasst ohne sicheren Kontext (Klartext-HTTP im LAN)', async () => {
    const zuruecknehmen = ohneSicherenKontext();
    try {
      const p = props();
      renderMitProviders(<Schnellerfassung {...p} />);
      const feld = screen.getByPlaceholderText(/Inhalt/);
      await userEvent.type(feld, 'Erste{Enter}');
      await waitFor(() => expect(feld).toHaveValue(''));
      await userEvent.type(feld, 'Zweite{Enter}');
      await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(2));
      const [erste, zweite] = (p.erfassen as ReturnType<typeof vi.fn>).mock.calls.map(
        ([e]) => e as NeuerEintrag,
      );
      expect(erste).toMatchObject({ inhalt: 'Erste' });
      expect(erste.client_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      // Nach dem Erfolg ein neuer Schlüssel, sonst hielte der Server den zweiten für den ersten.
      expect(zweite.client_id).not.toBe(erste.client_id);
    } finally {
      zuruecknehmen();
    }
  });

  it('Shift+Enter sendet nicht (Zeilenumbruch)', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.type(
      screen.getByPlaceholderText(/Inhalt/),
      'Zeile1{Shift>}{Enter}{/Shift}Zeile2',
    );
    expect(p.erfassen).not.toHaveBeenCalled();
  });

  it('Plain Enter sendet einen Einzeiler', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Einzeiler{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
  });

  it.each([
    ['leer', ''],
    ['nur Whitespace', '  \t'],
  ])('Plain Enter unterdrückt bei %s keinen nativen Zeilenumbruch', async (_fall, inhalt) => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    if (inhalt) await userEvent.type(feld, inhalt);
    let nichtVerhindert = false;
    await act(async () => {
      nichtVerhindert = fireEvent.keyDown(feld, { key: 'Enter' });
    });
    expect(nichtVerhindert).toBe(true);
    expect(p.erfassen).not.toHaveBeenCalled();
  });

  it('Plain Enter ergänzt bei mehrzeiligem Inhalt eine weitere Zeile', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, 'Zeile 1{Shift>}{Enter}{/Shift}Zeile 2{Enter}');
    expect(p.erfassen).not.toHaveBeenCalled();
    expect(feld).toHaveValue('Zeile 1\nZeile 2\n');
  });

  it.each([
    ['Ctrl', '{Control>}{Enter}{/Control}'],
    ['Meta', '{Meta>}{Enter}{/Meta}'],
  ])('%s+Enter sendet auch mehrzeiligen Inhalt', async (_modifikator, tastaturfolge) => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.type(
      screen.getByPlaceholderText(/Inhalt/),
      `Zeile 1{Shift>}{Enter}{/Shift}Zeile 2${tastaturfolge}`,
    );
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
  });

  it('wiederholtes Enter sendet nicht', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, 'Einzeiler');
    await act(async () => fireEvent.keyDown(feld, { key: 'Enter', repeat: true }));
    expect(p.erfassen).not.toHaveBeenCalled();
  });

  it('sendet während einer IME-Komposition weder mit Enter noch mit Strg+Enter', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, '変換中');

    fireEvent.keyDown(feld, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(feld, { key: 'Enter', ctrlKey: true, isComposing: true });

    expect(p.erfassen).not.toHaveBeenCalled();
    expect(feld).toHaveValue('変換中');
  });

  it('sendet ein bereits behandeltes Enter nicht erneut', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, 'Bereits lokal behandelt');
    const ereignis = new KeyboardEvent('keydown', {
      key: 'Enter',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    ereignis.preventDefault();

    fireEvent(feld, ereignis);

    expect(ereignis.defaultPrevented).toBe(true);
    expect(p.erfassen).not.toHaveBeenCalled();
    expect(feld).toHaveValue('Bereits lokal behandelt');
  });

  /**
   * Der Wortlaut steht GENAU EINMAL, und zwar in der Steuerzeile.
   *
   * Die zweite Hälfte macht die Aussage widerlegbar: ohne sie bliebe der Test grün, wenn der
   * Hinweis dem Platzhalter wieder vorangestellt würde (LFH-335).
   */
  it('erklärt den Enter-Vertrag genau einmal — sichtbar, nicht im Platzhalter', () => {
    renderMitProviders(<Schnellerfassung {...props()} />);
    const hinweis = 'Enter sendet · Shift+Enter neue Zeile · Mehrzeiler mit Cmd/Strg+Enter senden';
    expect(screen.getAllByText(hinweis)).toHaveLength(1);
    expect(screen.getByText(hinweis)).toBeVisible();
    expect(screen.getByPlaceholderText(/Inhalt/)).toHaveAttribute(
      'placeholder',
      'Inhalt … ( / für Typ, Felder & Bausteine · @ für Einheit )',
    );
  });

  /**
   * Unter `md` wird die Hinweiszeile zur einzeiligen Kurzform mit dem Tastaturvertrag — genau
   * einmal; sonst belegte die angepinnte Leiste im Handschuh-Betrieb über die Hälfte des
   * Fensters (LFH-373).
   */
  it('unter md: Kurzform des Enter-Vertrags, einmal, ohne Befehlsliste', () => {
    setzeViewportBreite(390);
    renderMitProviders(<Schnellerfassung {...props()} />);
    expect(screen.getAllByText('Enter sendet · Shift+Enter neue Zeile')).toHaveLength(1);
    expect(screen.queryByText(/Mehrzeiler mit Cmd\/Strg\+Enter/)).toBeNull();
    // Der Platzhalter hat unter `md` ebenfalls eine Kurzform: der volle Wortlaut brach bei 390 px
    // um und trieb die Leiste über den 50-%-Deckel. „Inhalt …" steht weiter vorn, beide Auslöser
    // bleiben.
    expect(screen.getByPlaceholderText(/^Inhalt …/)).toHaveAttribute(
      'placeholder',
      'Inhalt … ( / für Befehle · @ für Einheit )',
    );
    expect(screen.queryByText('@ Einheit')).toBeNull();
  });

  /**
   * „Vorschau" steht neben „Erfassen" statt auf eigener Zeile — genau EIN Umschalter, und er wirkt.
   */
  it('Vorschau steht einmal in der Aktionszeile und blendet die Vorschau ein', async () => {
    const { container } = renderMitProviders(<Schnellerfassung {...props()} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, '**fett**');
    expect(screen.getAllByRole('button', { name: 'Vorschau' })).toHaveLength(1);
    expect(container.querySelector('.markdown strong')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Vorschau' }));
    expect(container.querySelector('.markdown strong')).toHaveTextContent('fett');
  });

  it('/ öffnet Menü; Feld „Von" wird als Chip erfasst und mitgesendet', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, 'Lage /von');
    // Der Standard füllt Von schon: der Menüeintrag trägt den Haken, der Editor den Wert.
    await userEvent.click(await screen.findByText('Von ✓'));
    const chipInput = await screen.findByLabelText('Von');
    await userEvent.clear(chipInput);
    await userEvent.type(chipInput, 'Florian 2{Enter}');
    await userEvent.type(feld, '{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      von: 'Florian 2',
      an: 'ELW 1',
    });
  });

  it('bietet disponierte Funkrufnamen als Absender-Vorschlag (Freitext bleibt Fallback)', async () => {
    server.use(
      http.get('/api/einsaetze/7/fahrzeuge', () =>
        HttpResponse.json([{ id: 1, funkrufname: 'Florian 1', opta: null }]),
      ),
      http.get('/api/einsaetze/7/einheiten', () => HttpResponse.json([])),
    );
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, 'Lage /von');
    await userEvent.click(await screen.findByText('Von ✓'));
    const chip = await screen.findByRole('combobox', { name: 'Von' });
    await userEvent.clear(chip);
    await userEvent.type(chip, 'Florian');
    // Klick auf den Vorschlag committet sofort via AutoComplete onSelect → onCommit.
    const vorschlag = await screen.findByText(
      (_, el) =>
        typeof el?.className === 'string' &&
        el.className.includes('ant-select-item-option-content') &&
        el.textContent === 'Florian 1',
    );
    await userEvent.click(vorschlag);
    await userEvent.type(feld, '{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      von: 'Florian 1',
    });
  });

  it('bietet disponierte Funkrufnamen auch als Empfänger-Vorschlag (an)', async () => {
    server.use(
      http.get('/api/einsaetze/7/fahrzeuge', () =>
        HttpResponse.json([{ id: 1, funkrufname: 'Florian 1', opta: null }]),
      ),
      http.get('/api/einsaetze/7/einheiten', () => HttpResponse.json([])),
    );
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, 'Lage /an');
    await userEvent.click(await screen.findByText('An ✓'));
    const chip = await screen.findByRole('combobox', { name: 'An' });
    await userEvent.clear(chip);
    await userEvent.type(chip, 'Florian');
    // Klick auf den Vorschlag committet sofort via AutoComplete onSelect → onCommit.
    const vorschlag = await screen.findByText(
      (_, el) =>
        typeof el?.className === 'string' &&
        el.className.includes('ant-select-item-option-content') &&
        el.textContent === 'Florian 1',
    );
    await userEvent.click(vorschlag);
    await userEvent.type(feld, '{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      an: 'Florian 1',
    });
  });

  it('Enter bei offenem Menü sendet nicht', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Lage /');
    await screen.findByText('Felder');
    await userEvent.keyboard('{Enter}');
    expect(p.erfassen).not.toHaveBeenCalled();
  });

  it('Enter bei offenem, leerem /-Menü sendet nicht', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Lage /xyzqfehlt');
    await screen.findByText(/Kein Treffer/i);
    await userEvent.keyboard('{Enter}');
    expect(p.erfassen).not.toHaveBeenCalled();
  });

  it('+ Feld-Button öffnet das Felder-Menü und ein Feld ist wählbar', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.click(screen.getByRole('button', { name: /Feld/ }));
    await userEvent.click(await screen.findByText('Ereigniszeit'));
    // Geprüft wird der Chip-Editor über sein `aria-label`, NICHT ein Text „Ereigniszeit": der
    // Menüeintrag heißt genauso, ein `findByText` fände also auch dann etwas, wenn bloß das Menü
    // stehenbliebe.
    expect(await screen.findByLabelText('Ereigniszeit')).toBeInTheDocument();
  });

  it('schliesst das Menü nach der Auswahl — auch wenn es über den Feld-Button kam', async () => {
    /**
     * `waehleEintrag` muss das Menü selbst schließen: `entferneTriggerText` steigt bei
     * `triggerStart < 0` (Öffnung über den Feld-Knopf) vor jedem Schließen aus, und das stehende
     * Menü verdeckte den gerade geöffneten Chip-Editor.
     *
     * Beide Öffnungswege in EINEM Test — ein Test für nur einen Weg wäre entweder trivial grün
     * oder ohne Kontrast.
     */
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    const nutzer = userEvent.setup();
    const feld = await screen.findByPlaceholderText(/Inhalt/);

    // Weg 1 — über den Feld-Button.
    await nutzer.click(screen.getByRole('button', { name: /Feld/ }));
    expect(screen.getByTestId('slash-menu')).toBeInTheDocument();
    await nutzer.click(await screen.findByText('Ereigniszeit'));
    await waitFor(() => expect(screen.queryByTestId('slash-menu')).toBeNull());

    // Weg 2 — über „/" im Text.
    await nutzer.type(feld, '/');
    expect(await screen.findByTestId('slash-menu')).toBeInTheDocument();
    await nutzer.click(await screen.findByText('Von ✓'));
    await waitFor(() => expect(screen.queryByTestId('slash-menu')).toBeNull());
  });

  it('der Feld-Knopf schliesst das Menü auch wieder', async () => {
    // Der Knopf schaltet um. Der „Klick daneben"-Griff darf ihm nicht zuvorkommen:
    // schlösse dieser zuerst, öffnete der Klick danach wieder — der Knopf könnte nie
    // schliessen, und aus einem Umschalter würde ein Einschalter.
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    const nutzer = userEvent.setup();
    const knopf = screen.getByRole('button', { name: /Feld/ });

    await nutzer.click(knopf);
    expect(screen.getByTestId('slash-menu')).toBeInTheDocument();
    await nutzer.click(knopf);
    await waitFor(() => expect(screen.queryByTestId('slash-menu')).toBeNull());
  });

  it('schliesst das Menü beim Klick daneben', async () => {
    // Die zweite Hälfte von „schließt sich nicht": ohne Auswahl muss es einen Weg hinaus geben
    // außer Escape oder einem zweiten Druck auf denselben Knopf.
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    const nutzer = userEvent.setup();

    await nutzer.click(screen.getByRole('button', { name: /Feld/ }));
    expect(screen.getByTestId('slash-menu')).toBeInTheDocument();
    await nutzer.click(document.body);
    await waitFor(() => expect(screen.queryByTestId('slash-menu')).toBeNull());
  });

  it('Berichtigungsmodus sendet typ=berichtigung + berichtigt_eintrag_id', async () => {
    const p = props({ berichtigungZu: original() });
    renderMitProviders(<Schnellerfassung {...p} />);
    expect(screen.getByText(/Berichtigung zu Nr\. 5/)).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Korrektur{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      typ: 'berichtigung',
      berichtigt_eintrag_id: 5,
    });
  });

  it('Berichtigungsmodus: Feld per / setzbar und mitgesendet, aber keine Bausteine im Menü', async () => {
    const baustein: EtbBaustein = {
      id: 1,
      label: 'Lagemeldung',
      typ: 'meldung',
      inhalt: 'X',
      meldeweg: null,
      veranlassung: null,
      sortier: 0,
    };
    const p = props({ berichtigungZu: original(), bausteine: [baustein] });
    renderMitProviders(<Schnellerfassung {...p} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, 'Korrektur /von');
    // Bausteine dürfen NICHT erscheinen
    expect(screen.queryByText('Lagemeldung')).toBeNull();
    await userEvent.click(await screen.findByText('Von ✓'));
    const chipInput = await screen.findByLabelText('Von');
    await userEvent.clear(chipInput);
    await userEvent.type(chipInput, 'Florian 2{Enter}');
    await userEvent.type(feld, '{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      typ: 'berichtigung',
      berichtigt_eintrag_id: 5,
      von: 'Florian 2',
      an: 'ELW 1',
    });
  });

  it('Baustein über / setzt den Inhalt', async () => {
    const baustein: EtbBaustein = {
      id: 1,
      label: 'Bereitstellung',
      typ: 'meldung',
      inhalt: 'Bereitstellungsraum bezogen',
      meldeweg: null,
      veranlassung: null,
      sortier: 0,
    };
    const p = props({ bausteine: [baustein] });
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), '/bereit');
    await userEvent.click(await screen.findByText('Bereitstellung'));
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/Inhalt/)).toHaveValue('Bereitstellungsraum bezogen'),
    );
  });

  it('zeigt bei Typ „Lage" den Sprung in den strukturierten Lagebericht', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    // Standardtyp ist 'meldung' → kein Button
    expect(
      screen.queryByRole('button', { name: /strukturierten Lagebericht/i }),
    ).not.toBeInTheDocument();
    // Typ auf 'Lage' umstellen — über den Präfix, der den Typ als Befehl zeigt.
    await userEvent.click(screen.getByRole('button', { name: 'Eintragstyp /meldung ändern' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Lage' }));
    expect(screen.getByRole('button', { name: 'Eintragstyp /lage ändern' })).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: /strukturierten Lagebericht/i }),
    ).toBeInTheDocument();
  });

  it('springt aus Typ „Lage" in die Lageberichtsliste des Einsatzes (LFH-797)', async () => {
    const p = props();
    function Ort() {
      return <output aria-label="Ort">{useLocation().pathname}</output>;
    }
    renderMitProviders(
      <>
        <Schnellerfassung {...p} />
        <Ort />
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Eintragstyp /meldung ändern' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Lage' }));
    await userEvent.click(
      await screen.findByRole('button', { name: /strukturierten Lagebericht/i }),
    );
    expect(screen.getByLabelText('Ort')).toHaveTextContent(`/einsaetze/${einsatz.id}/lageberichte`);
  });
});

// ---------------------------------------------------------------------------
// Wertübernahme (LFH-332)
//
// Hier steht nur, was OHNE Remount gilt. Der Fall mit Remount (Entwurfs-Tab schließt) liegt
// in `entwuerfe/EtbEntwurfsTabs.test.tsx`.
// ---------------------------------------------------------------------------

describe('Schnellerfassung – Wertübernahme', () => {
  async function setzeTextfeld(feld: HTMLElement, trigger: string, label: string, wert: string) {
    await userEvent.type(feld, ` /${trigger}`);
    // Von/An trägt der Standard schon (Haken im Menü, Wert im Editor).
    await userEvent.click(await screen.findByText(new RegExp(`^${label}( ✓)?$`)));
    const eingabe = await screen.findByLabelText(label);
    await userEvent.clear(eingabe);
    await userEvent.type(eingabe, `${wert}{Enter}`);
  }

  it('zeigt den Schalter nicht, wenn kein Aufrufer den Zustand führt', () => {
    renderMitProviders(<Schnellerfassung {...props()} />);
    expect(screen.queryByRole('checkbox', { name: 'Werte behalten' })).toBeNull();
  });

  it('zeigt den Schalter nicht im Berichtigungsmodus', () => {
    const p = props({
      berichtigungZu: original(),
      werteBehalten: true,
      onWerteBehaltenChange: vi.fn(),
    });
    renderMitProviders(<Schnellerfassung {...p} />);
    expect(screen.getByText(/Berichtigung zu Nr\. 5/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Werte behalten' })).toBeNull();
  });

  it('meldet das Umlegen des Schalters an den Aufrufer', async () => {
    const onWerteBehaltenChange = vi.fn();
    const p = props({ werteBehalten: true, onWerteBehaltenChange });
    renderMitProviders(<Schnellerfassung {...p} />);
    const schalter = screen.getByRole('checkbox', { name: 'Werte behalten' });
    expect(schalter).toBeChecked();
    await userEvent.click(schalter);
    expect(onWerteBehaltenChange).toHaveBeenCalledWith(false);
  });

  it('lässt Von stehen, verwirft aber die Veranlassung (Schalter an)', async () => {
    const p = props({ werteBehalten: true, onWerteBehaltenChange: vi.fn() });
    renderMitProviders(<Schnellerfassung {...p} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, 'Lage');
    await setzeTextfeld(feld, 'von', 'Von', 'Florian 2');
    await setzeTextfeld(feld, 'veranlassung', 'Veranlassung', 'Nachforderung');
    await userEvent.type(feld, '{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      von: 'Florian 2',
      veranlassung: 'Nachforderung',
    });
    expect(feld).toHaveValue('');
    // Von überlebt (Wiederholfeld), Veranlassung nicht (je Eintrag verschieden).
    expect(await screen.findByText('Von: Florian 2')).toBeInTheDocument();
    expect(screen.queryByText('Veranlassung: Nachforderung')).toBeNull();
  });

  it('verwirft Von, wenn der Schalter aus ist', async () => {
    const p = props({ werteBehalten: false, onWerteBehaltenChange: vi.fn() });
    renderMitProviders(<Schnellerfassung {...p} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, 'Lage');
    await setzeTextfeld(feld, 'von', 'Von', 'Florian 2');
    await userEvent.type(feld, '{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(feld).toHaveValue(''));
    // Verworfen wird nur der eigene Wert; der Standard-Rufname steht wieder da (LFH-894).
    expect(screen.queryByText('Von: Florian 2')).toBeNull();
    expect(screen.getByText('Von: ELW 1')).toBeInTheDocument();
  });

  it('leert im Berichtigungsmodus alles, obwohl der Aufrufer den Schalter an hat', async () => {
    const p = props({
      berichtigungZu: original(),
      werteBehalten: true,
      onWerteBehaltenChange: vi.fn(),
    });
    renderMitProviders(<Schnellerfassung {...p} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, 'Korrektur');
    await setzeTextfeld(feld, 'von', 'Von', 'Florian 2');
    await userEvent.type(feld, '{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(feld).toHaveValue(''));
    // Verworfen wird nur der eigene Wert; der Standard-Rufname steht wieder da (LFH-894).
    expect(screen.queryByText('Von: Florian 2')).toBeNull();
    expect(screen.getByText('Von: ELW 1')).toBeInTheDocument();
  });
});

describe('Schnellerfassung – Entwurf-Anbindung', () => {
  it('übernimmt initialWerte in das Eingabefeld', () => {
    const p = props({ initialWerte: { inhalt: 'Vorbefüllt', typ: 'meldung', metadaten: {} } });
    renderMitProviders(<Schnellerfassung {...p} />);
    expect(screen.getByPlaceholderText(/Inhalt/)).toHaveValue('Vorbefüllt');
  });

  it('feuert onWerteChange NICHT beim Mount', () => {
    const onWerteChange = vi.fn();
    const p = props({
      initialWerte: { inhalt: 'Vorbefüllt', typ: 'meldung', metadaten: {} },
      onWerteChange,
    });
    renderMitProviders(<Schnellerfassung {...p} />);
    expect(onWerteChange).not.toHaveBeenCalled();
  });

  it('feuert onWerteChange bei echter Eingabe mit aktuellem Inhalt', async () => {
    const onWerteChange = vi.fn();
    const p = props({ onWerteChange });
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Hi');
    await waitFor(() => expect(onWerteChange).toHaveBeenCalled());
    const letzter = onWerteChange.mock.calls[
      onWerteChange.mock.calls.length - 1
    ][0] as EntwurfWerte;
    expect(letzter.inhalt).toBe('Hi');
  });
});

// ---------------------------------------------------------------------------
// Typ per `/` am Zeilenanfang, `@` für Von/An, Hinweiszeile
// ---------------------------------------------------------------------------

describe('Schnellerfassung – Befehlszeile (Neuentwurf S4)', () => {
  it('zeigt den gewählten Typ als Befehl im Präfix der Zeile', () => {
    renderMitProviders(<Schnellerfassung {...props()} />);
    const praefix = document.querySelector('[data-lfh="schnellerfassung-praefix"]')!;
    expect(praefix).toHaveTextContent('/meldung');
  });

  it('im Berichtigungsmodus steht /berichtigung fest im Präfix, ohne Typwähler', () => {
    renderMitProviders(<Schnellerfassung {...props({ berichtigungZu: original() })} />);
    const praefix = document.querySelector('[data-lfh="schnellerfassung-praefix"]')!;
    expect(praefix).toHaveTextContent('/berichtigung');
    expect(screen.queryByRole('button', { name: /Eintragstyp/ })).toBeNull();
  });

  it('/ am Zeilenanfang bietet die Typen an und setzt den gewählten Typ', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, '/anord');
    const menue = await screen.findByTestId('slash-menu');
    expect(menue).toHaveTextContent('Typ');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByTestId('slash-menu')).toBeNull());
    // Der Befehlstext ist aus dem Feld verschwunden, der Typ steht im Präfix.
    expect(feld).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Eintragstyp /anordnung ändern' })).toBeVisible();
    await userEvent.type(feld, 'Verbau halten{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      typ: 'anordnung',
      inhalt: 'Verbau halten',
    });
  });

  it('/ mitten im Satz bietet KEINE Typen an — nur Felder', async () => {
    renderMitProviders(<Schnellerfassung {...props()} />);
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Lage /');
    const menue = await screen.findByTestId('slash-menu');
    expect(menue).toHaveTextContent('Felder');
    expect(menue).not.toHaveTextContent('/anordnung');
  });

  it('ein ausgetippter Befehl mit Leerzeichen setzt den Typ ohne Menü', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, '/lage Pegel steigt');
    expect(feld).toHaveValue('Pegel steigt');
    expect(screen.getByRole('button', { name: 'Eintragstyp /lage ändern' })).toBeVisible();
  });

  it('@ füllt bei einer Meldung den Absender aus den Funkrufnamen', async () => {
    server.use(
      http.get('/api/einsaetze/7/fahrzeuge', () =>
        HttpResponse.json([{ id: 1, funkrufname: 'Florian 1', opta: null }]),
      ),
    );
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, 'Lage ruhig @flo');
    await userEvent.click(await screen.findByText('Von: Florian 1'));
    expect(await screen.findByText('Von: Florian 1', { selector: '*' })).toBeInTheDocument();
    // Der Auslösetext ist weg, der Satz davor bleibt.
    expect(feld).toHaveValue('Lage ruhig ');
    await userEvent.type(feld, '{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      von: 'Florian 1',
    });
  });

  it('@ füllt bei einer Anordnung den Empfänger — Freitext bleibt möglich', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, '/anordnung Sandsäcke @EA-Süd');
    // Kein Funkrufname passt: der getippte Text steht als Freitext-Eintrag da.
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByTestId('slash-menu')).toBeNull());
    await userEvent.type(feld, '{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      typ: 'anordnung',
      an: 'EA-Süd',
    });
  });

  it('nennt die Typbefehle, @ und den Nachtrag-Weg in der Hinweiszeile', () => {
    renderMitProviders(<Schnellerfassung {...props()} />);
    const zeile = document.querySelector('[data-lfh="schnellerfassung"]')!;
    expect(zeile).toHaveTextContent('/meldung /anordnung /entscheidung /lage');
    expect(zeile).toHaveTextContent('@ Einheit');
    expect(zeile).toHaveTextContent('/zeit ⧖ Nachtrag');
    // Kein „# Koordinate": dafür gibt es keinen Weg in den Eintrag.
    expect(zeile).not.toHaveTextContent('Koordinate');
  });
});

describe('Schnellerfassung — Chip-Zeile auf dem Handschirm (LFH-373)', () => {
  /**
   * Unter `md` rollt die Zeile waagerecht, damit nicht jeder gesetzte Chip eine eigene Reihe
   * kostet; die Pixel misst `e2e/leisten-flaeche.spec.ts`.
   */
  it('unter md einzeilig mit waagerechtem Bildlauf, sonst umbrechend', () => {
    expect(chipZeileStil(true, { marginXS: 4 })).toMatchObject({
      flexWrap: 'nowrap',
      overflowX: 'auto',
      minWidth: 0,
    });
    const breit = chipZeileStil(false, { marginXS: 4 });
    expect(breit.flexWrap).toBe('wrap');
    expect(breit.overflowX).toBeUndefined();
  });

  /**
   * In der einzeilig rollenden Chip-Zeile läge „Werte behalten" hinter dem Bildlauf. Unter `md`
   * steht der Schalter deshalb in der Hinweiszeile der Erfassung (innerhalb von
   * `[data-lfh="schnellerfassung"]`), ab `md` in der Chip-Zeile.
   */
  it.each([
    [390, true],
    [1366, false],
  ])('bei %i px steht „Werte behalten" in der Hinweiszeile: %s', (breite, inHinweiszeile) => {
    setzeViewportBreite(breite);
    renderMitProviders(
      <Schnellerfassung {...props({ werteBehalten: false, onWerteBehaltenChange: vi.fn() })} />,
    );
    const schalter = screen.getByRole('checkbox', { name: /Werte behalten/ });
    expect(schalter.closest('[data-lfh="schnellerfassung"]') != null).toBe(inHinweiszeile);
  });

  it('holt einen Chip hinter dem rechten Rand waagerecht ins Bild, ohne das Dokument zu rollen', () => {
    const zeile = document.createElement('div');
    const ziel = document.createElement('input');
    zeile.getBoundingClientRect = () => ({ left: 0, right: 300 }) as DOMRect;
    ziel.getBoundingClientRect = () => ({ left: 280, right: 440 }) as DOMRect;
    const rollen = vi.spyOn(window, 'scrollTo');
    rolleWaagerechtInsBild(zeile, ziel);
    expect(zeile.scrollLeft).toBe(140);
    expect(rollen).not.toHaveBeenCalled();
    rollen.mockRestore();
  });
});

describe('Schnellerfassung – Standard-Rufname und Von/An-Pflicht (LFH-894)', () => {
  it('ohne Standard steht die Abfrage über der Zeile, und die Pflicht hält das Absenden auf', async () => {
    const p = props({ rufname: rufnameZugriff(null) });
    renderMitProviders(<Schnellerfassung {...p} />);
    expect(
      screen.getByRole('group', { name: 'Mit welchem Rufnamen schreibst du ins ETB?' }),
    ).toBeInTheDocument();
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, 'Pegel steigt{Enter}');
    expect(
      await screen.findByText('Von fehlt: Rufname oben festlegen oder /von setzen.'),
    ).toBeVisible();
    expect(p.erfassen).not.toHaveBeenCalled();
    expect(feld).toHaveValue('Pegel steigt');
  });

  it('ein fehlendes An hält auf, auch wenn Von per Eintrag gesetzt ist', async () => {
    const p = props({
      rufname: rufnameZugriff(null),
      initialWerte: { inhalt: 'Lage', typ: 'meldung', metadaten: { von: 'Florian 1' } },
    });
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), '{Enter}');
    expect(await screen.findByText(/^An fehlt/)).toBeInTheDocument();
    expect(p.erfassen).not.toHaveBeenCalled();
  });

  it('übernimmt den Rufnamen aus der Abfrage über den Zugriff', async () => {
    const rufname = rufnameZugriff(null);
    renderMitProviders(<Schnellerfassung {...props({ rufname })} />);
    await userEvent.type(
      screen.getByRole('combobox', { name: 'Rufname für Von und An' }),
      'ELW 1{Enter}',
    );
    await waitFor(() => expect(rufname.setze).toHaveBeenCalledWith('{"von":"ELW 1","an":"ELW 1"}'));
  });

  it('fragt erst, wenn das Fach gelesen ist', () => {
    renderMitProviders(
      <Schnellerfassung {...props({ rufname: { ...rufnameZugriff(null), geladen: false } })} />,
    );
    expect(screen.queryByRole('group', { name: /Rufnamen/ })).toBeNull();
  });

  it('kennzeichnet Chips aus dem Standard und bietet für sie kein Entfernen an', async () => {
    renderMitProviders(
      <Schnellerfassung
        {...props({ initialWerte: { inhalt: '', typ: 'meldung', metadaten: { an: 'S2' } } })}
      />,
    );
    const von = screen.getByText('Von: ELW 1').closest('[data-standard]');
    expect(von).toHaveAttribute('data-standard', 'ja');
    expect(von).toHaveAttribute('title', expect.stringMatching(/^Standard-Rufname/));
    // Der eigene Wert dieses Eintrags ist kein Standard.
    expect(screen.getByText('An: S2').closest('[data-standard]')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Aktionen zu Von' }));
    expect(await screen.findByRole('menuitem', { name: /Bearbeiten/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Entfernen/ })).toBeNull();
  });

  it('„Standard-Rufname ändern“ öffnet die Abfrage mit Abbrechen', async () => {
    renderMitProviders(<Schnellerfassung {...props()} />);
    expect(screen.queryByRole('group', { name: /Rufname/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Standard-Rufname ändern' }));
    const abfrage = screen.getByRole('group', { name: 'Dein Rufname für Von und An' });
    expect(abfrage).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Standard-Rufname ändern' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByRole('group', { name: /Rufname/ })).toBeNull();
  });

  it('in der Berichtigung wird nicht gefragt, der Standard gilt trotzdem', async () => {
    const p = props({ berichtigungZu: original() });
    renderMitProviders(<Schnellerfassung {...p} />);
    expect(screen.queryByRole('button', { name: 'Standard-Rufname ändern' })).toBeNull();
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Korrektur{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      typ: 'berichtigung',
      von: 'ELW 1',
      an: 'ELW 1',
    });
  });

  it('@ überschreibt nur die eine Seite dieses Eintrags', async () => {
    const p = props({ werteBehalten: false, onWerteBehaltenChange: vi.fn() });
    renderMitProviders(<Schnellerfassung {...p} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, '/anordnung Sandsäcke @EA-Süd');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByTestId('slash-menu')).toBeNull());
    await userEvent.type(feld, '{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      von: 'ELW 1',
      an: 'EA-Süd',
    });
    // Der nächste Eintrag geht wieder an den Standard.
    await waitFor(() => expect(screen.getByText('An: ELW 1')).toBeInTheDocument());
  });
});
