import { createRef } from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NeuerEintrag } from '../api/etb';
import type { EinsatzAnzeige, EtbBaustein, EtbEintragAnzeige } from '../api/types';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import MarkdownEditor, { type TextAreaRef } from '../components/MarkdownEditor';
import Schnellerfassung from './Schnellerfassung';
import type { EntwurfWerte } from './entwuerfe/entwurfModell';

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

const einsatz = { id: 7, bezeichnung: 'Test', stichwort: null, leitstellen_nr: null, einsatzort: null } as unknown as EinsatzAnzeige;

function original(): EtbEintragAnzeige {
  return {
    id: 5, lfd_nr: 5, typ: 'meldung', inhalt: 'Original', von: null, an: null,
    meldeweg: null, veranlassung: null, erfasser_id: 1, erfasser_name: 'Max',
    ereigniszeit: '2026-05-23 10:00:00', received_at: '2026-05-23 10:00:01',
    erfasst_lokal_at: null, berichtigt_eintrag_id: null,
    lagebericht_id: null, auftrag_id: null, befehl_id: null,
  };
}

function props(over: Partial<React.ComponentProps<typeof Schnellerfassung>> = {}) {
  return {
    erfassen: vi.fn<(e: NeuerEintrag) => Promise<void>>().mockResolvedValue(undefined),
    berichtigungZu: null, onBerichtigungAbbrechen: vi.fn(), bausteine: [] as EtbBaustein[], einsatz, ...over,
  };
}

// ---------------------------------------------------------------------------
// Caret-Ref-Verifikation (kritischer Integrationstest)
// ---------------------------------------------------------------------------

describe('TextAreaRef – Caret-Pfad', () => {
  it('resizableTextArea.textArea ist eine HTMLTextAreaElement-Instanz', () => {
    const ref = createRef<TextAreaRef>();
    renderMitProviders(
      <MarkdownEditor layout="toggle" value="" onChange={() => {}} ref={ref} />,
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

  it('Shift+Enter sendet nicht (Zeilenumbruch)', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Zeile1{Shift>}{Enter}{/Shift}Zeile2');
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
    await act(async () => { nichtVerhindert = fireEvent.keyDown(feld, { key: 'Enter' }); });
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
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), `Zeile 1{Shift>}{Enter}{/Shift}Zeile 2${tastaturfolge}`);
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
      key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true,
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
   * Die zweite Hälfte ist die, die die Aussage widerlegbar macht: ohne sie bliebe
   * der Test grün, wenn der Hinweis dem Platzhalter wieder vorangestellt würde —
   * und das war der Zustand, in dem das Feld nicht mehr sagte, was hineingehört
   * (der sichtbare Anfang des Platzhalters war der Tastaturvertrag, „Inhalt …"
   * stand dahinter). LFH-335 verlangt den Wortlaut im DOM, nicht zweimal.
   */
  it('erklärt den Enter-Vertrag genau einmal — sichtbar, nicht im Platzhalter', () => {
    renderMitProviders(<Schnellerfassung {...props()} />);
    const hinweis = 'Enter sendet · Shift+Enter neue Zeile · Mehrzeiler mit Cmd/Strg+Enter senden';
    expect(screen.getAllByText(hinweis)).toHaveLength(1);
    expect(screen.getByText(hinweis)).toBeVisible();
    expect(screen.getByPlaceholderText(/Inhalt/)).toHaveAttribute(
      'placeholder',
      'Inhalt … ( / für Felder & Bausteine )',
    );
  });

  it('/ öffnet Menü; Feld „Von" wird als Chip erfasst und mitgesendet', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, 'Lage /von');
    await userEvent.click(await screen.findByText('Von'));
    const chipInput = await screen.findByLabelText('Von');
    await userEvent.type(chipInput, 'ELW 1{Enter}');
    await userEvent.type(feld, '{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ von: 'ELW 1' });
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
    await userEvent.click(await screen.findByText('Von'));
    const chip = await screen.findByRole('combobox', { name: 'Von' });
    await userEvent.type(chip, 'Florian');
    // Klick auf den Vorschlag committet sofort via AutoComplete onSelect → onCommit.
    const vorschlag = await screen.findByText(
      (_, el) => typeof el?.className === 'string'
        && el.className.includes('ant-select-item-option-content')
        && el.textContent === 'Florian 1',
    );
    await userEvent.click(vorschlag);
    await userEvent.type(feld, '{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ von: 'Florian 1' });
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
    await userEvent.click(await screen.findByText('An'));
    const chip = await screen.findByRole('combobox', { name: 'An' });
    await userEvent.type(chip, 'Florian');
    // Klick auf den Vorschlag committet sofort via AutoComplete onSelect → onCommit.
    const vorschlag = await screen.findByText(
      (_, el) => typeof el?.className === 'string'
        && el.className.includes('ant-select-item-option-content')
        && el.textContent === 'Florian 1',
    );
    await userEvent.click(vorschlag);
    await userEvent.type(feld, '{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ an: 'Florian 1' });
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
    // Geprüft wird der Chip-Editor über sein `aria-label`, NICHT ein Text „Ereigniszeit"
    // irgendwo: der Menüeintrag heisst genauso, ein `findByText(/Ereigniszeit/)` fand also
    // auch dann etwas, wenn gar kein Chip aufging und bloss das Menü stehenblieb.
    expect(await screen.findByLabelText('Ereigniszeit')).toBeInTheDocument();
  });

  it('schliesst das Menü nach der Auswahl — auch wenn es über den Feld-Button kam', async () => {
    /**
     * Der Bug, gemeldet am 30.07.2026. `waehleEintrag` schloss das Menü nicht selbst,
     * sondern verliess sich auf `entferneTriggerText` — und die steigt bei
     * `triggerStart < 0` sofort aus, BEVOR sie schliesst. Der Feld-Button setzt
     * `triggerStart` ausdrücklich auf -1 (es gibt keinen „/"-Text zu entfernen), also
     * blieb das Menü genau auf diesem Weg stehen. Es liegt absolut über der Chip-Leiste
     * und verdeckte damit den Chip-Editor, der gerade aufgegangen war.
     *
     * Beide Öffnungswege in EINEM Test: über „/" schloss es immer, über den Knopf nie.
     * Ein Test für nur einen Weg wäre entweder trivial grün oder ohne Kontrast.
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

    // Weg 2 — über „/" im Text. Zur Kontrolle, dass der Fix ihn nicht verliert.
    await nutzer.type(feld, '/');
    expect(await screen.findByTestId('slash-menu')).toBeInTheDocument();
    await nutzer.click(await screen.findByText('Von'));
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
    // Die zweite Hälfte von „schliesst sich nicht": ohne Auswahl gab es überhaupt
    // keinen Weg hinaus ausser Escape oder einem zweiten Druck auf denselben Knopf.
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
    expect(screen.getByText(/Berichtigung zu #5/)).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Korrektur{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ typ: 'berichtigung', berichtigt_eintrag_id: 5 });
  });

  it('Berichtigungsmodus: Feld per / setzbar und mitgesendet, aber keine Bausteine im Menü', async () => {
    const baustein: EtbBaustein = { id: 1, label: 'Lagemeldung', typ: 'meldung', inhalt: 'X', meldeweg: null, veranlassung: null, sortier: 0 };
    const p = props({ berichtigungZu: original(), bausteine: [baustein] });
    renderMitProviders(<Schnellerfassung {...p} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, 'Korrektur /von');
    // Bausteine dürfen NICHT erscheinen
    expect(screen.queryByText('Lagemeldung')).toBeNull();
    await userEvent.click(await screen.findByText('Von'));
    await userEvent.type(await screen.findByLabelText('Von'), 'ELW 1{Enter}');
    await userEvent.type(feld, '{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ typ: 'berichtigung', berichtigt_eintrag_id: 5, von: 'ELW 1' });
  });

  it('Baustein über / setzt den Inhalt', async () => {
    const baustein: EtbBaustein = { id: 1, label: 'Bereitstellung', typ: 'meldung', inhalt: 'Bereitstellungsraum bezogen', meldeweg: null, veranlassung: null, sortier: 0 };
    const p = props({ bausteine: [baustein] });
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), '/bereit');
    await userEvent.click(await screen.findByText('Bereitstellung'));
    await waitFor(() => expect(screen.getByPlaceholderText(/Inhalt/)).toHaveValue('Bereitstellungsraum bezogen'));
  });

  it('zeigt bei Typ „Lage" den Sprung in den strukturierten Lagebericht', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    // Standardtyp ist 'meldung' → kein Button
    expect(screen.queryByRole('button', { name: /strukturierten Lagebericht/i })).not.toBeInTheDocument();
    // Typ auf 'Lage' umstellen
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByText('Lage'));
    expect(await screen.findByRole('button', { name: /strukturierten Lagebericht/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Wertübernahme (LFH-332/H61)
//
// Hier steht nur, was OHNE Remount gilt. Der Fall, der in der Anwendung wirklich
// zählt — Entwurfs-Tab schließt, Komponente wird neu montiert — kann diese Datei
// nicht prüfen; er liegt in `entwuerfe/EtbEntwurfsTabs.test.tsx`.
// ---------------------------------------------------------------------------

describe('Schnellerfassung – Wertübernahme', () => {
  async function setzeTextfeld(feld: HTMLElement, trigger: string, label: string, wert: string) {
    await userEvent.type(feld, ` /${trigger}`);
    await userEvent.click(await screen.findByText(label));
    await userEvent.type(await screen.findByLabelText(label), `${wert}{Enter}`);
  }

  it('zeigt den Schalter nicht, wenn kein Aufrufer den Zustand führt', () => {
    renderMitProviders(<Schnellerfassung {...props()} />);
    expect(screen.queryByRole('checkbox', { name: 'Werte behalten' })).toBeNull();
  });

  it('zeigt den Schalter nicht im Berichtigungsmodus', () => {
    const p = props({ berichtigungZu: original(), werteBehalten: true, onWerteBehaltenChange: vi.fn() });
    renderMitProviders(<Schnellerfassung {...p} />);
    expect(screen.getByText(/Berichtigung zu #5/)).toBeInTheDocument();
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
    await setzeTextfeld(feld, 'von', 'Von', 'ELW 1');
    await setzeTextfeld(feld, 'veranlassung', 'Veranlassung', 'Nachforderung');
    await userEvent.type(feld, '{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0])
      .toMatchObject({ von: 'ELW 1', veranlassung: 'Nachforderung' });
    expect(feld).toHaveValue('');
    // Von überlebt (Wiederholfeld), Veranlassung nicht (je Eintrag verschieden).
    expect(await screen.findByText('Von: ELW 1')).toBeInTheDocument();
    expect(screen.queryByText('Veranlassung: Nachforderung')).toBeNull();
  });

  it('verwirft Von, wenn der Schalter aus ist', async () => {
    const p = props({ werteBehalten: false, onWerteBehaltenChange: vi.fn() });
    renderMitProviders(<Schnellerfassung {...p} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, 'Lage');
    await setzeTextfeld(feld, 'von', 'Von', 'ELW 1');
    await userEvent.type(feld, '{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(feld).toHaveValue(''));
    expect(screen.queryByText('Von: ELW 1')).toBeNull();
  });

  it('leert im Berichtigungsmodus alles, obwohl der Aufrufer den Schalter an hat', async () => {
    const p = props({ berichtigungZu: original(), werteBehalten: true, onWerteBehaltenChange: vi.fn() });
    renderMitProviders(<Schnellerfassung {...p} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, 'Korrektur');
    await setzeTextfeld(feld, 'von', 'Von', 'ELW 1');
    await userEvent.type(feld, '{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(feld).toHaveValue(''));
    expect(screen.queryByText('Von: ELW 1')).toBeNull();
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
    const p = props({ initialWerte: { inhalt: 'Vorbefüllt', typ: 'meldung', metadaten: {} }, onWerteChange });
    renderMitProviders(<Schnellerfassung {...p} />);
    expect(onWerteChange).not.toHaveBeenCalled();
  });

  it('feuert onWerteChange bei echter Eingabe mit aktuellem Inhalt', async () => {
    const onWerteChange = vi.fn();
    const p = props({ onWerteChange });
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Hi');
    await waitFor(() => expect(onWerteChange).toHaveBeenCalled());
    const letzter = onWerteChange.mock.calls[onWerteChange.mock.calls.length - 1][0] as EntwurfWerte;
    expect(letzter.inhalt).toBe('Hi');
  });
});
