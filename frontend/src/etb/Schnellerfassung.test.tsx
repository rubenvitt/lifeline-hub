import { createRef } from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setzeViewportBreite, setzeViewportHoehe, setzeZeigerGrob } from '../test/viewport';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NeuerEintrag } from '../api/etb';
import type { EtbBaustein, EtbEintragAnzeige } from '../api/types';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import MarkdownEditor, { type TextAreaRef } from '../components/MarkdownEditor';
import Schnellerfassung, { fusszeileStil } from './Schnellerfassung';
import type { EntwurfWerte } from './entwuerfe/entwurfModell';
import { einsatzFixture, freigabenFixture } from '../test/fixtures';
import { einsatzKeys } from '../api/queryKeys';
import { ohneSicherenKontext } from '../test/ohneSicherenKontext';
import { useLocation } from 'react-router';
import { rufnameZugriff } from '../test/standardRufname';
import { waehle } from '../test/auswahlListe';
import dayjs from 'dayjs';
import { merkeServerzeit, serveruhrVergessenFuerTests } from '../offline/serveruhr';
import { theme } from 'antd';
import { etbTypFarbe } from '../theme/statusFarben';
import { mitProzessZone } from '../test/prozessZone';

// Die Schnellerfassung lädt über useFunkrufnamen immer /fahrzeuge + /einheiten.
// onUnhandledFrame: 'error' im Setup → Default-Handler (leere Listen) bereitstellen,
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
    einheiten: [],
    anhaenge: [],
  };
}

/**
 * Eine Meldung trägt als Vorgabe nur An = eigene Stelle; Von ist Pflicht (Change
 * `kwc2yszv-etb-neuentwurf`, Spec `etb-absender-empfaenger`). Die Grundfälle senden deshalb mit
 * einem Entwurf, dessen Von gesetzt ist; die Fälle zu Von/An setzen ihre Werte selbst.
 */
const MIT_ABSENDER: EntwurfWerte = { inhalt: '', typ: 'meldung', metadaten: { von: 'Florian 3' } };

/** Lage: Von und An tragen beide die eigene Stelle als Vorgabe. */
const LAGE: EntwurfWerte = { inhalt: '', typ: 'lage', metadaten: {} };

/** Der angezeigte Wert eines Felds der Feldzeile (Von, An: Vorschlagsfeld; Zeit: Textfeld). */
function feldWert(name: 'Von' | 'An' | 'Zeit') {
  const rolle = name === 'Zeit' ? 'textbox' : 'combobox';
  return (screen.getByRole(rolle, { name }) as HTMLInputElement).value;
}

/** Setzt An über die Feldzeile; Enter übernimmt und springt in den Inhalt. */
async function setzeAn(wert: string) {
  const an = screen.getByRole('combobox', { name: 'An' });
  await userEvent.clear(an);
  await userEvent.type(an, `${wert}{Enter}`);
}

function props(over: Partial<React.ComponentProps<typeof Schnellerfassung>> = {}) {
  return {
    erfassen: vi.fn<(e: NeuerEintrag) => Promise<void>>().mockResolvedValue(undefined),
    berichtigungZu: null,
    // Eine Berichtigung startet ohne Entwurf, mit den Werten des berichtigten Eintrags.
    initialWerte: over.berichtigungZu ? undefined : MIT_ABSENDER,
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
    renderMitProviders(<MarkdownEditor unterEbene={3} value="" onChange={() => {}} ref={ref} />);
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
      initialWerte: LAGE,
      einsatz: { ...einsatz, meine_fuehrungsstelle: 'Florian Leitung' },
      rufname: rufnameZugriff({ von: 'ELW 1', an: 'Einsatzleitung' }),
    });
    renderMitProviders(<Schnellerfassung {...p} />);
    expect(feldWert('Von')).toBe('ELW 1');
    expect(feldWert('An')).toBe('Einsatzleitung');
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Lage ruhig{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      von: 'ELW 1',
      an: 'Einsatzleitung',
    });
  });

  it('LFH-894: ein Entwurf mit eigenem An schlägt die Vorgabe nur auf dieser Seite', () => {
    renderMitProviders(
      <Schnellerfassung
        {...props({
          initialWerte: { inhalt: 'Entwurf', typ: 'lage', metadaten: { an: 'Eigener Empfänger' } },
        })}
      />,
    );
    expect(feldWert('An')).toBe('Eigener Empfänger');
    expect(feldWert('Von')).toBe('ELW 1');
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
      // Lage mit „Werte behalten“: beide Einträge tragen Von und An aus der Vorgabe.
      const p = props({ initialWerte: LAGE, werteBehalten: true, onWerteBehaltenChange: vi.fn() });
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
   * Die Taste steht als Kappe am Knopf, nicht als Satz (LFH-1078): kein „Enter sendet …“ in der
   * Leiste, kein Tastenweg im Platzhalter. Der Knopfname bleibt das Wort.
   */
  it('zeigt die Sendetaste als Kappe an „Erfassen“ — kein Tastensatz, Platzhalter „Inhalt …“', () => {
    renderMitProviders(<Schnellerfassung {...props()} />);
    const knopf = screen.getByRole('button', { name: 'Erfassen' });
    expect(knopf).toHaveAttribute('aria-keyshortcuts', 'Enter Control+Enter Meta+Enter');
    expect(knopf.querySelector('kbd')).toHaveTextContent('↵');
    const leiste = document.querySelector('[data-lfh="etb-erfassung"]')!;
    expect(leiste.textContent).not.toMatch(/Enter sendet|Shift\+Enter|Strg\+Enter|neue Zeile/);
    expect(screen.getByPlaceholderText(/Inhalt/)).toHaveAttribute('placeholder', 'Inhalt …');
  });

  it('unter md: kein Tastensatz, derselbe Platzhalter', () => {
    setzeViewportBreite(390);
    renderMitProviders(<Schnellerfassung {...props()} />);
    const leiste = document.querySelector('[data-lfh="etb-erfassung"]')!;
    expect(leiste.textContent).not.toMatch(/Enter sendet|Shift\+Enter|neue Zeile/);
    expect(screen.getByPlaceholderText(/^Inhalt …/)).toHaveAttribute('placeholder', 'Inhalt …');
    expect(screen.queryByText('@ Einheit')).toBeNull();
  });

  it('unter lg: keine Kappe, die Zeile gehört dem Textfeld — die Kürzel bleiben am Knopf', () => {
    setzeViewportBreite(820);
    renderMitProviders(<Schnellerfassung {...props()} />);
    const knopf = screen.getByRole('button', { name: 'Erfassen' });
    expect(knopf.querySelector('kbd')).toBeNull();
    expect(knopf).toHaveAttribute('aria-keyshortcuts', 'Enter Control+Enter Meta+Enter');
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

  it('ein Feld aus dem /-Menü holt den Fokus in dieses Feld der Feldzeile', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), '/');
    await userEvent.click(await screen.findByText('Ereigniszeit'));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Zeit' })).toHaveFocus());
  });

  it('schliesst das Menü nach der Auswahl', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    const nutzer = userEvent.setup();
    const feld = await screen.findByPlaceholderText(/Inhalt/);
    await nutzer.type(feld, '/');
    expect(await screen.findByTestId('slash-menu')).toBeInTheDocument();
    await nutzer.click(await screen.findByText('Von ✓'));
    await waitFor(() => expect(screen.queryByTestId('slash-menu')).toBeNull());
  });

  it('schliesst das Menü beim Klick daneben', async () => {
    // Ohne Auswahl muss es einen Weg hinaus geben außer Escape.
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    const nutzer = userEvent.setup();
    await nutzer.type(screen.getByPlaceholderText(/Inhalt/), '/');
    expect(await screen.findByTestId('slash-menu')).toBeInTheDocument();
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
    const vonFeld = screen.getByRole('combobox', { name: 'Von' });
    await waitFor(() => expect(vonFeld).toHaveFocus());
    await userEvent.clear(vonFeld);
    await userEvent.type(vonFeld, 'Florian 2{Enter}');
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

  it('LFH-937: ein zu langer Baustein-Text wird nicht gesendet, die Grenze steht da, der Text bleibt', async () => {
    const langerText = 'x'.repeat(20_001);
    const baustein: EtbBaustein = {
      id: 1,
      label: 'Lagebericht lang',
      typ: 'meldung',
      inhalt: langerText,
      meldeweg: null,
      veranlassung: null,
      sortier: 0,
    };
    const p = props({ bausteine: [baustein] });
    renderMitProviders(<Schnellerfassung {...p} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, '/lagebericht');
    await userEvent.click(await screen.findByText('Lagebericht lang'));
    await waitFor(() => expect(feld).toHaveValue(langerText));

    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));

    const hinweis = await screen.findByText(/Inhalt ist zu lang/);
    expect(hinweis.closest('[data-lfh="etb-laengen-hinweis"]')).not.toBeNull();
    expect(hinweis).toHaveTextContent('höchstens 20.000 Zeichen');
    expect(p.erfassen).not.toHaveBeenCalled();
    expect(feld).toHaveValue(langerText);
    // Der Zähler steht in der Hinweiszeile, nicht unter dem Feld (Höhenbudget der Leiste).
    expect(screen.getByText('20.001 / 20.000 · zu lang')).toBeInTheDocument();
    expect(document.querySelector('.ant-input-data-count')).toBeNull();
  });

  it('LFH-937: ein zu langes Von hält das Senden ebenso zurück', async () => {
    const p = props({
      initialWerte: { inhalt: 'Lage ruhig', typ: 'meldung', metadaten: { von: 'v'.repeat(501) } },
    });
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    expect(await screen.findByText(/Von ist zu lang/)).toHaveTextContent('höchstens 500 Zeichen');
    expect(p.erfassen).not.toHaveBeenCalled();
  });

  it('LFH-937: Zähler erst ab 80 %; eingefügter Text über der Grenze bleibt ganz stehen und geht nicht hinaus', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    fireEvent.change(feld, { target: { value: 'a'.repeat(15_999) } });
    expect(screen.queryByText(/\/ 20\.000/)).toBeNull();
    fireEvent.change(feld, { target: { value: 'a'.repeat(16_000) } });
    expect(screen.getByText('16.000 / 20.000')).toBeInTheDocument();
    fireEvent.change(feld, { target: { value: 'a'.repeat(20_005) } });
    expect(feld).toHaveValue('a'.repeat(20_005));
    expect(screen.getByText('20.005 / 20.000 · zu lang')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    expect(await screen.findByText(/Inhalt ist zu lang/)).toBeInTheDocument();
    expect(p.erfassen).not.toHaveBeenCalled();
    expect(feld).toHaveValue('a'.repeat(20_005));
  });

  it('zeigt bei Typ „Lage" den Sprung in den strukturierten Lagebericht', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    // Standardtyp ist 'meldung' → kein Button
    expect(
      screen.queryByRole('button', { name: /strukturierten Lagebericht/i }),
    ).not.toBeInTheDocument();
    // Typ auf 'Lage' umstellen — über das Segment der Feldzeile.
    await userEvent.click(screen.getByRole('radio', { name: 'Lage' }));
    expect(screen.getByRole('radio', { name: 'Lage' })).toBeChecked();
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
    await userEvent.click(screen.getByRole('radio', { name: 'Lage' }));
    await userEvent.click(
      await screen.findByRole('button', { name: /strukturierten Lagebericht/i }),
    );
    expect(screen.getByLabelText('Ort')).toHaveTextContent(`/einsaetze/${einsatz.id}/lageberichte`);
  });

  it('LFH-888: ohne Zugriff auf Lageberichte entfällt der Sprung, der Typ „Lage" bleibt', async () => {
    server.use(
      http.get('/api/einsaetze/:id/modul-freigaben', () =>
        HttpResponse.json(freigabenFixture({ lageberichte: { zugriff: false } })),
      ),
    );
    const p = props();
    const { client } = renderMitProviders(<Schnellerfassung {...p} />);
    await waitFor(() =>
      expect(client.getQueryData(einsatzKeys.modulFreigaben(einsatz.id))).toBeDefined(),
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Lage' }));
    expect(screen.getByRole('radio', { name: 'Lage' })).toBeChecked();
    expect(
      screen.queryByRole('button', { name: /strukturierten Lagebericht/i }),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Wertübernahme (LFH-332)
//
// Hier steht nur, was OHNE Remount gilt. Der Fall mit Remount (Entwurfs-Tab schließt) liegt
// in `entwuerfe/EtbEntwurfsTabs.test.tsx`.
// ---------------------------------------------------------------------------

/**
 * Return der Bildschirmtastatur (LFH-955, Spec `etb-schnellerfassung-tastatur`, design.md D1):
 * iOS und Gboard liefern Return als `Enter` ohne Umschalt. Mit grobem Zeiger sendet Enter
 * deshalb nicht, sondern bricht die Zeile um; gesendet wird über „Erfassen“ oder Strg/⌘+Enter.
 */
describe('Schnellerfassung — Tastatur nach Zeigerart (LFH-955)', () => {
  it('grober Zeiger: Return sendet nicht und lässt den Umbruch stehen', async () => {
    setzeZeigerGrob(true);
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, 'Pegel 3,20 m{Enter}steigend');
    expect(p.erfassen).not.toHaveBeenCalled();
    expect(feld).toHaveValue('Pegel 3,20 m\nsteigend');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0].inhalt).toBe(
      'Pegel 3,20 m\nsteigend',
    );
  });

  it('grober Zeiger: Return verhindert den nativen Umbruch nicht', () => {
    setzeZeigerGrob(true);
    renderMitProviders(<Schnellerfassung {...props()} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    fireEvent.change(feld, { target: { value: 'Einzeiler' } });
    expect(fireEvent.keyDown(feld, { key: 'Enter' })).toBe(true);
  });

  it.each([
    ['Ctrl', '{Control>}{Enter}{/Control}'],
    ['Meta', '{Meta>}{Enter}{/Meta}'],
  ])('grober Zeiger: %s+Enter sendet (Hardware-Tastatur am Tablet)', async (_m, folge) => {
    setzeZeigerGrob(true);
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), `Lage ruhig${folge}`);
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
  });

  it('das Textfeld trägt enterKeyHint="enter"', () => {
    setzeZeigerGrob(true);
    renderMitProviders(<Schnellerfassung {...props()} />);
    expect(screen.getByPlaceholderText(/Inhalt/)).toHaveAttribute('enterkeyhint', 'enter');
  });

  it.each([1180, 390])('grober Zeiger bei %i px: keine Tastenkappe, kein Tastensatz', (breite) => {
    setzeViewportBreite(breite);
    setzeZeigerGrob(true);
    renderMitProviders(<Schnellerfassung {...props()} />);
    const knopf = screen.getByRole('button', { name: 'Erfassen' });
    expect(knopf.querySelector('kbd')).toBeNull();
    // Return sendet hier nicht; nur die Hardware-Tastatur am Tablet hat die Kombination.
    expect(knopf).toHaveAttribute('aria-keyshortcuts', 'Control+Enter Meta+Enter');
    const leiste = document.querySelector('[data-lfh="etb-erfassung"]')!;
    expect(leiste.textContent).not.toMatch(/Shift\+Enter|Strg\+Enter|Enter sendet|Return/);
  });

  it('feiner Zeiger: der bisherige Vertrag bleibt', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    expect(screen.getByRole('button', { name: 'Erfassen' }).querySelector('kbd')).not.toBeNull();
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Einzeiler{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
  });

  it('kein Platzhalter nennt „Befehle“', () => {
    for (const breite of [390, 1440]) {
      setzeViewportBreite(breite);
      const { unmount } = renderMitProviders(<Schnellerfassung {...props()} />);
      expect(screen.getByPlaceholderText(/Inhalt/).getAttribute('placeholder')).not.toMatch(
        /Befehl/,
      );
      unmount();
    }
  });
});

describe('Schnellerfassung – Wertübernahme', () => {
  /** Setzt ein Feld der Feldzeile; Enter übernimmt und springt in den Inhalt. */
  async function setzeTextfeld(trigger: 'von' | 'veranlassung', label: string, wert: string) {
    if (trigger === 'veranlassung') {
      await userEvent.click(screen.getByRole('button', { name: '+ Veranlassung' }));
    }
    const eingabe = await screen.findByRole(trigger === 'veranlassung' ? 'textbox' : 'combobox', {
      name: label,
    });
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
    await setzeTextfeld('von', 'Von', 'Florian 2');
    await setzeTextfeld('veranlassung', 'Veranlassung', 'Nachforderung');
    await userEvent.type(feld, '{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      von: 'Florian 2',
      veranlassung: 'Nachforderung',
    });
    expect(feld).toHaveValue('');
    // Von überlebt (Wiederholfeld), Veranlassung nicht (je Eintrag verschieden).
    await waitFor(() => expect(feldWert('Von')).toBe('Florian 2'));
    expect(screen.queryByRole('textbox', { name: 'Veranlassung' })).toBeNull();
  });

  it('verwirft Von, wenn der Schalter aus ist', async () => {
    const p = props({ werteBehalten: false, onWerteBehaltenChange: vi.fn() });
    renderMitProviders(<Schnellerfassung {...p} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, 'Lage');
    await setzeTextfeld('von', 'Von', 'Florian 2');
    await userEvent.type(feld, '{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(feld).toHaveValue(''));
    // Verworfen wird der eigene Wert; eine Meldung hat für Von keine Vorgabe.
    expect(feldWert('Von')).toBe('');
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
    await setzeTextfeld('von', 'Von', 'Florian 2');
    await userEvent.type(feld, '{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(feld).toHaveValue(''));
    // Verworfen wird nur der eigene Wert; die eigene Stelle steht wieder da (LFH-894).
    expect(feldWert('Von')).toBe('ELW 1');
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
  it('zeigt den Typ als Segment „Typ des Eintrags“ mit Kante, die Zeile trägt sie auch (LLH-1112)', () => {
    renderMitProviders(<Schnellerfassung {...props()} />);
    expect(screen.getByRole('radiogroup', { name: 'Typ des Eintrags' })).toBeInTheDocument();
    const meldung = screen.getByRole('radio', { name: 'Meldung' });
    expect(meldung).toBeChecked();
    // Der Test rendert ohne Nachttheme: die Hellpalette gilt.
    const kante = etbTypFarbe('meldung', theme.getDesignToken()).kante;
    expect(meldung.style.boxShadow).toContain('2px');
    expect(meldung.querySelector('[data-lfh="segment-punkt"]')).not.toBeNull();
    const zeile = document.querySelector<HTMLElement>('.lfh-schnellerfassung')!;
    expect(zeile.style.borderInlineStart).toContain('2px solid');
    expect(kante).toBeTruthy();
    // Keine Slash-Schreibweise als Beschriftung.
    expect(document.querySelector('[data-lfh="etb-erfassung"]')!.textContent).not.toMatch(
      /\/(meldung|anordnung|lage|entscheidung)/,
    );
  });

  it('Wechsel per Klick: Typ Entscheidung, Von und An folgen der Vorgabe', async () => {
    const p = props({ initialWerte: { inhalt: 'Rückzug', typ: 'meldung', metadaten: {} } });
    renderMitProviders(<Schnellerfassung {...p} />);
    expect(feldWert('Von')).toBe('');
    expect(feldWert('An')).toBe('ELW 1');
    await userEvent.click(screen.getByRole('radio', { name: 'Entscheidung' }));
    expect(screen.getByRole('radio', { name: 'Entscheidung' })).toBeChecked();
    expect(feldWert('Von')).toBe('ELW 1');
    expect(feldWert('An')).toBe('ELW 1');
  });

  it('Typwechsel behält ein ausdrücklich gesetztes Von', async () => {
    renderMitProviders(<Schnellerfassung {...props()} />);
    expect(feldWert('Von')).toBe('Florian 3');
    await userEvent.click(screen.getByRole('radio', { name: 'Entscheidung' }));
    expect(feldWert('Von')).toBe('Florian 3');
    expect(feldWert('An')).toBe('ELW 1');
  });

  it('im Berichtigungsmodus steht „Berichtigung“ fest im Präfix, ohne Typwähler', () => {
    renderMitProviders(<Schnellerfassung {...props({ berichtigungZu: original() })} />);
    const praefix = document.querySelector('[data-lfh="schnellerfassung-praefix"]')!;
    expect(praefix).toHaveTextContent(/^Berichtigung$/);
    expect(screen.queryByRole('radiogroup', { name: 'Typ des Eintrags' })).toBeNull();
  });

  it('unter md wählt ein Knopf mit Pfeil den Typ, das Menü trägt je Typ einen Farbpunkt', async () => {
    setzeViewportBreite(390);
    renderMitProviders(<Schnellerfassung {...props()} />);
    expect(screen.queryByRole('radiogroup', { name: 'Typ des Eintrags' })).toBeNull();
    const knopf = screen.getByRole('button', { name: 'Typ des Eintrags: Meldung' });
    expect(knopf).toHaveTextContent('Meldung ▾');
    await userEvent.click(knopf);
    const eintrag = await screen.findByRole('menuitem', { name: 'Anordnung' });
    expect(eintrag.querySelector('[data-lfh="typ-punkt"]')).not.toBeNull();
    await userEvent.click(eintrag);
    expect(screen.getByRole('button', { name: 'Typ des Eintrags: Anordnung' })).toBeVisible();
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
    // Der Befehlstext ist aus dem Feld verschwunden, das Segment trägt den Typ.
    expect(feld).toHaveValue('');
    expect(screen.getByRole('radio', { name: 'Anordnung' })).toBeChecked();
    // Eine Anordnung braucht ein An; das Feld hat keine Vorgabe.
    await setzeAn('EA-Süd');
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
    expect(screen.getByRole('radio', { name: 'Lage' })).toBeChecked();
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
    await waitFor(() => expect(feldWert('Von')).toBe('Florian 1'));
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

  /**
   * Keine Befehlsliste unter dem Feld (LFH-1078): Typ und Felder zeigen der Präfix-Knopf und
   * „Feld“; ab `md` steht ohne Zeichengrenze gar keine Hinweiszeile.
   */
  it('listet keine Befehle unter dem Feld', () => {
    renderMitProviders(<Schnellerfassung {...props()} />);
    const zeile = document.querySelector('[data-lfh="schnellerfassung"]')!;
    expect(zeile).not.toHaveTextContent('/anordnung /entscheidung');
    expect(zeile).not.toHaveTextContent('@ Einheit');
    expect(zeile).not.toHaveTextContent('Nachtrag');
  });
});

describe('Schnellerfassung — Fußzeile (Spec „Einstellungen in der Fußzeile der Erfassung“)', () => {
  /**
   * Unter `md` rollt die Fußzeile waagerecht, damit nicht jeder Knopf eine eigene Reihe kostet;
   * die Pixel misst `e2e/leisten-flaeche.spec.ts`.
   */
  it('unter md einzeilig mit waagerechtem Bildlauf, sonst umbrechend', () => {
    expect(fusszeileStil(true, { marginXS: 4, marginSM: 8 })).toMatchObject({
      flexWrap: 'nowrap',
      overflowX: 'auto',
      minWidth: 0,
    });
    const breit = fusszeileStil(false, { marginXS: 4, marginSM: 8 });
    expect(breit.flexWrap).toBe('wrap');
    expect(breit.overflowX).toBeUndefined();
  });

  it.each([
    [390, true],
    [1366, false],
  ])(
    'bei %i px stehen beide Schalter in der Fußzeile, ohne Kästchen-Boden: %s',
    (breite, ohneBoden) => {
      setzeViewportBreite(breite);
      renderMitProviders(
        <Schnellerfassung {...props({ werteBehalten: false, onWerteBehaltenChange: vi.fn() })} />,
      );
      for (const name of ['Werte behalten', 'Auch in den Meldungseingang']) {
        const schalter = screen.getByRole('checkbox', { name });
        expect(schalter.closest('[data-lfh="etb-fusszeile"]'), name).not.toBeNull();
        // Der Kästchen-Boden (`antdKaestchen`, LFH-907) ist nur in der rollenden Fußzeile des
        // Handschirms aufgehoben; ab `md` hält er die Trefffläche im Handschuh-Betrieb.
        const label = schalter.closest<HTMLElement>('label.ant-checkbox-wrapper')!;
        expect(label.style.minHeight, name).toBe(ohneBoden ? '0px' : '');
      }
    },
  );

  it('rechts stehen „+ Veranlassung“, „Anhang“ und „+ weiterer Entwurf“ als Textknöpfe', async () => {
    const onWeitererEntwurf = vi.fn();
    renderMitProviders(<Schnellerfassung {...props({ onWeitererEntwurf })} />);
    const fuss = document.querySelector('[data-lfh="etb-fusszeile"]')!;
    for (const name of ['+ Veranlassung', 'Anhang', '+ weiterer Entwurf']) {
      expect(fuss.contains(screen.getByRole('button', { name })), name).toBe(true);
    }
    await userEvent.click(screen.getByRole('button', { name: '+ weiterer Entwurf' }));
    expect(onWeitererEntwurf).toHaveBeenCalledTimes(1);
    // „+ Veranlassung“ holt das Feld in die Zeile und den Fokus hinein.
    await userEvent.click(screen.getByRole('button', { name: '+ Veranlassung' }));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Veranlassung' })).toHaveFocus(),
    );
    expect(screen.queryByRole('button', { name: '+ Veranlassung' })).toBeNull();
  });

  it('„Vorschau“ nur bei Formatierung im Inhalt', async () => {
    renderMitProviders(<Schnellerfassung {...props()} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, 'Pumpe läuft');
    expect(screen.queryByRole('button', { name: 'Vorschau' })).toBeNull();
    await userEvent.type(feld, ' **jetzt**');
    expect(screen.getByRole('button', { name: 'Vorschau' })).toBeInTheDocument();
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
    // Ohne Standard fehlt die Vorgabe für An; der Grund steht am Feld, der Fokus geht dorthin.
    expect(await screen.findByText('Empfänger fehlt')).toBeVisible();
    const an = screen.getByRole('combobox', { name: 'An' });
    await waitFor(() => expect(an).toHaveFocus());
    expect(an).toHaveAttribute('aria-invalid', 'true');
    expect(an).toHaveAccessibleDescription('Empfänger fehlt');
    expect(p.erfassen).not.toHaveBeenCalled();
    expect(feld).toHaveValue('Pegel steigt');
  });

  it('Kein Standard, kein Von: der Grund steht am Feld Von, das den Fokus hat', async () => {
    const p = props({
      rufname: rufnameZugriff(null),
      initialWerte: { inhalt: 'Lage ruhig', typ: 'lage', metadaten: { an: 'ELW 1' } },
    });
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    expect(await screen.findByText('Absender fehlt')).toBeVisible();
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Von' })).toHaveFocus());
    expect(screen.queryByText('Empfänger fehlt')).toBeNull();
    expect(p.erfassen).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText(/Inhalt/)).toHaveValue('Lage ruhig');
  });

  it('fehlen beide Seiten, sind beide Felder markiert', async () => {
    const p = props({
      rufname: rufnameZugriff(null),
      initialWerte: { inhalt: 'Lage ruhig', typ: 'lage', metadaten: {} },
    });
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    expect(await screen.findByText('Absender fehlt')).toBeVisible();
    expect(screen.getByText('Empfänger fehlt')).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Von' })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('combobox', { name: 'An' })).toHaveAttribute('aria-invalid', 'true');
  });

  it('ein gesetztes An räumt seinen Grund', async () => {
    const p = props({
      rufname: rufnameZugriff(null),
      initialWerte: { inhalt: 'Lage', typ: 'meldung', metadaten: { von: 'Florian 1' } },
    });
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), '{Enter}');
    expect(await screen.findByText('Empfänger fehlt')).toBeInTheDocument();
    expect(p.erfassen).not.toHaveBeenCalled();
    await setzeAn('ELW 2');
    expect(screen.queryByText('Empfänger fehlt')).toBeNull();
  });

  it('übernimmt den Rufnamen aus der Abfrage über den Zugriff', async () => {
    const rufname = rufnameZugriff(null);
    renderMitProviders(<Schnellerfassung {...props({ rufname })} />);
    // Das erste Enter nimmt den Freitext-Eintrag der offenen Liste, das zweite übernimmt
    // (Spec `stammdaten-feld`, „Tastatur“).
    await userEvent.type(
      screen.getByRole('combobox', { name: 'Rufname für Von und An' }),
      'ELW 1{Enter}{Enter}',
    );
    await waitFor(() => expect(rufname.setze).toHaveBeenCalledWith('{"von":"ELW 1","an":"ELW 1"}'));
  });

  it('fragt erst, wenn das Fach gelesen ist', () => {
    renderMitProviders(
      <Schnellerfassung {...props({ rufname: { ...rufnameZugriff(null), geladen: false } })} />,
    );
    expect(screen.queryByRole('group', { name: /Rufnamen/ })).toBeNull();
  });

  it('kennzeichnet einen Wert aus der Vorgabe, ein eigener trägt keine Marke', () => {
    renderMitProviders(
      <Schnellerfassung
        {...props({ initialWerte: { inhalt: '', typ: 'lage', metadaten: { an: 'S2' } } })}
      />,
    );
    const von = document.querySelector('[data-lfh="etb-feld-von"]')!;
    expect(von).toHaveAttribute('data-vorgabe', 'ja');
    expect(von).toHaveAttribute('title', 'Vorgabe: eigene Stelle');
    expect(document.querySelector('[data-lfh="etb-feld-an"]')).not.toHaveAttribute('data-vorgabe');
  });

  it('„Eigene Stelle ändern“ öffnet die Abfrage mit Abbrechen', async () => {
    renderMitProviders(<Schnellerfassung {...props()} />);
    expect(screen.queryByRole('group', { name: /Rufname/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Eigene Stelle ändern' }));
    const abfrage = screen.getByRole('group', { name: 'Dein Rufname für Von und An' });
    expect(abfrage).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByRole('group', { name: /Rufname/ })).toBeNull();
  });

  it('in der Berichtigung gibt es keinen Wechsel der eigenen Stelle', () => {
    renderMitProviders(<Schnellerfassung {...props({ berichtigungZu: original() })} />);
    expect(screen.queryByRole('button', { name: 'Eigene Stelle ändern' })).toBeNull();
  });

  it('eine Berichtigung trägt Von, An und Meldeweg des berichtigten Eintrags', async () => {
    const p = props({
      berichtigungZu: { ...original(), von: 'Rettungsstaffel', an: 'EL', meldeweg: 'funk' },
    });
    renderMitProviders(<Schnellerfassung {...p} />);
    expect(feldWert('Von')).toBe('Rettungsstaffel');
    expect(feldWert('An')).toBe('EL');
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'RTW 83-1{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      typ: 'berichtigung',
      von: 'Rettungsstaffel',
      an: 'EL',
      meldeweg: 'funk',
    });
  });

  // Ohne offenes Chip-Menü: es holt sich per `autoFocus` den Fokus und riss unter CI-Last das
  // Tippen nach zwei Zeichen aus dem Feld.
  it('in der Berichtigung wird nicht gefragt, der Standard gilt trotzdem', async () => {
    const p = props({ berichtigungZu: original() });
    renderMitProviders(<Schnellerfassung {...p} />);
    expect(screen.queryByRole('group', { name: /Rufname/ })).toBeNull();
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Korrektur{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      typ: 'berichtigung',
      von: 'ELW 1',
      an: 'ELW 1',
    });
  });

  it('@ überschreibt nur die eine Seite dieses Eintrags', async () => {
    const p = props({
      initialWerte: { inhalt: '', typ: 'meldung', metadaten: {} },
      werteBehalten: false,
      onWerteBehaltenChange: vi.fn(),
    });
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
    // Der nächste Eintrag beginnt wieder als Meldung: An ist die eigene Stelle.
    await waitFor(() => expect(feldWert('An')).toBe('ELW 1'));
  });
});

// LFH-895: „jetzt“ beim Erfassen gilt nach der Serveruhr (`offline/serveruhr.ts`), eine
// eingetragene Ereigniszeit bleibt.
describe('Ereigniszeit eines vorgehenden Geräts (LFH-895)', () => {
  const SERVER = Date.parse('2026-10-04T10:00:00Z');
  const VORLAUF = 5 * 60_000;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(SERVER + VORLAUF);
    serveruhrVergessenFuerTests();
    return () => {
      vi.useRealTimers();
      serveruhrVergessenFuerTests();
    };
  });

  function serverAntwortGesehen() {
    merkeServerzeit(new Response(null, { headers: { Date: new Date(SERVER).toUTCString() } }));
  }

  async function erfasseOhneChip(p: ReturnType<typeof props>): Promise<NeuerEintrag> {
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Pumpe läuft{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    return (p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0] as NeuerEintrag;
  }

  it('ohne Zeit-Chip tragen Ereigniszeit und erfasst_lokal_at die Serverzeit', async () => {
    serverAntwortGesehen();
    const eintrag = await erfasseOhneChip(props());
    const ereignis = dayjs.utc(eintrag.ereigniszeit).valueOf();
    expect(Math.abs(ereignis - SERVER)).toBeLessThanOrEqual(1_000);
    expect(Math.abs(Date.parse(eintrag.erfasst_lokal_at!) - SERVER)).toBeLessThanOrEqual(1_000);
  });

  it('ohne bekannten Versatz gilt die Geräteuhr', async () => {
    const eintrag = await erfasseOhneChip(props());
    expect(dayjs.utc(eintrag.ereigniszeit).valueOf()).toBe(SERVER + VORLAUF);
  });

  it('eine eingetragene Ereigniszeit bleibt unverändert', async () => {
    serverAntwortGesehen();
    const eintrag = await erfasseOhneChip(
      props({
        initialWerte: {
          inhalt: '',
          typ: 'meldung',
          metadaten: { von: 'Florian 3', ereigniszeit: dayjs.utc('2026-10-04T09:30:00Z') },
        },
      }),
    );
    expect(eintrag.ereigniszeit).toBe('2026-10-04 09:30:00');
  });
});

// LLH-1088: `/zeit` als Kurzeingabe der Ereigniszeit und die Sperre gegen eine Zeit in der Zukunft.
describe('Nachtrag per /zeit und Zukunftssperre (LLH-1088)', () => {
  // Ohne Org-Zone gilt die Browserzone; die Wanduhr-Erwartungen unten sind Berliner Zeit (LLH-1411).
  mitProzessZone('Europe/Berlin');
  // 14:31 Berlin.
  const SERVER = Date.parse('2026-10-17T12:31:00Z');

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(SERVER);
    serveruhrVergessenFuerTests();
    return () => {
      vi.useRealTimers();
      serveruhrVergessenFuerTests();
    };
  });

  it('„/zeit 1420 Pumpe läuft“ setzt den Chip und lässt den Rest als Inhalt', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, '/zeit 1420 Pumpe läuft');
    expect(feld).toHaveValue('Pumpe läuft');
    expect(feldWert('Zeit')).toBe('1420');
    await userEvent.type(feld, '{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      inhalt: 'Pumpe läuft',
      ereigniszeit: '2026-10-17 12:20:00',
    });
  });

  it('„/zeit -10“ zählt von der Serveruhr zurück, auch nach einem Typbefehl', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, '/lage /zeit -10 Lage ruhig{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      typ: 'lage',
      inhalt: 'Lage ruhig',
      ereigniszeit: '2026-10-17 12:21:00',
    });
  });

  it('eine unlesbare Angabe bleibt Text, und die Hinweiszeile nennt den Grund', async () => {
    renderMitProviders(<Schnellerfassung {...props()} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, '/zeit 2590 Pumpe');
    expect(feld).toHaveValue('/zeit 2590 Pumpe');
    // Das Feld Zeit bleibt bei „jetzt“ und nennt den Grund.
    expect(feldWert('Zeit')).toBe('');
    expect(screen.getByRole('status')).toHaveTextContent(/^\/zeit: .+/);
    expect(screen.getByRole('textbox', { name: 'Zeit' })).toHaveAccessibleDescription(
      expect.stringMatching(/^\/zeit: /),
    );
  });

  it('greift nicht, wenn mitten in einer stehenden Angabe korrigiert wird', async () => {
    renderMitProviders(<Schnellerfassung {...props()} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, '/zeit 2590 Pumpe');
    // Cursor hinter die „0“, Ziffer löschen: „/zeit 259 Pumpe“ hieße 02:59.
    await userEvent.type(feld, '{Backspace}', {
      initialSelectionStart: 10,
      initialSelectionEnd: 10,
    });
    expect(feld).toHaveValue('/zeit 259 Pumpe');
    expect(feldWert('Zeit')).toBe('');
  });

  it('räumt den Grund, wenn ein Baustein den Text ersetzt', async () => {
    const baustein = { id: 1, label: 'Lage ruhig', inhalt: 'Lage ruhig' } as EtbBaustein;
    renderMitProviders(<Schnellerfassung {...props({ bausteine: [baustein] })} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, '/zeit 2590 x');
    expect(screen.getByRole('status')).toHaveTextContent(/^\/zeit: /);
    await userEvent.type(feld, ' /Lage');
    await userEvent.click(await screen.findByText('Lage ruhig'));
    await waitFor(() => expect(screen.queryByText(/^\/zeit: /)).toBeNull());
  });

  it('sendet keine Ereigniszeit in der Zukunft: Grund am Feld Zeit, Fokus dort, Text bleibt', async () => {
    const p = props({
      initialWerte: {
        inhalt: '',
        typ: 'meldung',
        // 18:20 statt 14:20.
        metadaten: { von: 'Florian 3', ereigniszeit: dayjs.utc('2026-10-17T16:20:00Z') },
      },
    });
    renderMitProviders(<Schnellerfassung {...p} />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await userEvent.type(feld, 'Pumpe läuft{Enter}');
    expect(p.erfassen).not.toHaveBeenCalled();
    expect(feld).toHaveValue('Pumpe läuft');
    expect(await screen.findByText('Zeit liegt in der Zukunft')).toBeVisible();
    const zeit = screen.getByRole('textbox', { name: 'Zeit' });
    await waitFor(() => expect(zeit).toHaveFocus());
    expect(zeit).toHaveAttribute('aria-invalid', 'true');
    expect(zeit).toHaveValue('1820');
  });

  it('zeigt im Feld Zeit den Tag, wenn die Ereigniszeit nicht von heute ist', () => {
    renderMitProviders(
      <Schnellerfassung
        {...props({
          initialWerte: {
            inhalt: '',
            typ: 'meldung',
            metadaten: { ereigniszeit: dayjs.utc('2026-10-16T21:50:00Z') },
          },
        })}
      />,
    );
    expect(feldWert('Zeit')).toBe('162350okt26');
  });

  it('Nachtrag: Feld in der Achtungsrolle, Fußzeile nennt den Abstand, der Knopf die Zeit', () => {
    renderMitProviders(
      <Schnellerfassung
        {...props({
          initialWerte: {
            inhalt: 'Keller leergepumpt',
            typ: 'meldung',
            // 14:17 Berlin, es ist 14:31.
            metadaten: { von: 'Florian 3', ereigniszeit: dayjs.utc('2026-10-17T12:17:00Z') },
          },
        })}
      />,
    );
    expect(screen.getByText('Nachtrag · Ereignis vor 14 min')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Zeit' }).closest('[data-nachtrag]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Erfassen als 1417' })).toBeInTheDocument();
  });

  it('ohne abweichende Zeit zeigt das Feld „jetzt“ mit der Uhrzeit, der Knopf heißt „Erfassen“', () => {
    renderMitProviders(<Schnellerfassung {...props()} />);
    expect(screen.getByRole('textbox', { name: 'Zeit' })).toHaveAttribute(
      'placeholder',
      'jetzt · 1431',
    );
    expect(screen.queryByText(/^Nachtrag ·/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Erfassen' })).toBeInTheDocument();
  });

  it('Funkspruch nachtragen: Zeit, Von und Weg über die Feldzeile, An aus der Vorgabe', async () => {
    const p = props({ initialWerte: { inhalt: '', typ: 'meldung', metadaten: {} } });
    renderMitProviders(<Schnellerfassung {...p} />);
    const zeit = screen.getByRole('textbox', { name: 'Zeit' });
    await userEvent.type(zeit, '1412');
    await userEvent.tab();
    const von = screen.getByRole('combobox', { name: 'Von' });
    expect(von).toHaveFocus();
    await userEvent.type(von, 'Sanitätszug Musterstadt');
    await userEvent.tab();
    expect(screen.getByRole('combobox', { name: 'An' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('combobox', { name: 'Meldeweg' })).toHaveFocus();
    await waehle('Meldeweg', 'Funk');
    // Die Wahl springt in den Inhalt.
    await waitFor(() => expect(screen.getByPlaceholderText(/Inhalt/)).toHaveFocus());
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Keller leer{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      ereigniszeit: '2026-10-17 12:12:00',
      von: 'Sanitätszug Musterstadt',
      an: 'ELW 1',
      meldeweg: 'funk',
    });
  });

  it('Reihenfolge per Tastatur: Zeit → Von → An → Meldeweg → Inhalt', async () => {
    renderMitProviders(<Schnellerfassung {...props()} />);
    screen.getByRole('textbox', { name: 'Zeit' }).focus();
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    expect(screen.getByRole('combobox', { name: 'Meldeweg' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByPlaceholderText(/Inhalt/)).toHaveFocus();
  });

  it('Nach dem Setzen der Zeit: Enter im Feld springt in den Inhalt, Enter dort sendet ohne Umbruch (LLH-1865)', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Zeit' }), '1420{Enter}');
    const feld = screen.getByPlaceholderText(/Inhalt/);
    await waitFor(() => expect(feld).toHaveFocus());
    expect(p.erfassen).not.toHaveBeenCalled();
    await userEvent.keyboard('Pumpe läuft{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      ereigniszeit: '2026-10-17 12:20:00',
      inhalt: 'Pumpe läuft',
    });
  });

  it('Geleert: ein geleertes Feld Zeit gilt wieder „jetzt“', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    const zeit = screen.getByRole('textbox', { name: 'Zeit' });
    await userEvent.type(zeit, '1420');
    await userEvent.tab();
    expect(screen.getByText('Nachtrag · Ereignis vor 11 min')).toBeVisible();
    await userEvent.clear(zeit);
    await userEvent.tab();
    expect(zeit).toHaveValue('');
    expect(screen.queryByText(/^Nachtrag ·/)).toBeNull();
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Pumpe{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      ereigniszeit: '2026-10-17 12:31:00',
    });
  });

  it('Enter im Feld Von übernimmt und springt in den Inhalt, ohne zu senden', async () => {
    const p = props({ initialWerte: { inhalt: 'Pumpe läuft', typ: 'meldung', metadaten: {} } });
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.type(screen.getByRole('combobox', { name: 'Von' }), 'Florian 7{Enter}');
    await waitFor(() => expect(screen.getByPlaceholderText(/Inhalt/)).toHaveFocus());
    expect(p.erfassen).not.toHaveBeenCalled();
    expect(feldWert('Von')).toBe('Florian 7');
  });
});

describe('Schnellerfassung — eingeklappt (LFH-955, kwc2yszv 4.1)', () => {
  it('unter md eingeklappt eine Zeile aus Typ-Knopf und Inhalt; aufgeklappt Felder und „Erfassen“', () => {
    setzeViewportBreite(390);
    const p = props();
    const { rerender } = renderMitProviders(<Schnellerfassung {...p} eingeklappt />);
    const feld = screen.getByPlaceholderText(/Inhalt/);
    expect(screen.getByRole('button', { name: 'Typ des Eintrags: Meldung' })).toBeVisible();
    expect(screen.queryByRole('combobox', { name: 'Von' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Zeit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Erfassen' })).toBeNull();
    rerender(<Schnellerfassung {...p} eingeklappt={false} />);
    // Das Feld behält seinen Platz im Baum (kein Neuaufbau, der Fokus bliebe).
    expect(screen.getByPlaceholderText(/Inhalt/)).toBe(feld);
    expect(screen.getByRole('textbox', { name: 'Zeit' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Meldeweg' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Von' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'An' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Erfassen' })).toBeVisible();
  });

  it('Einklappen schließt ein offenes /-Menü', async () => {
    const p = props();
    const { rerender } = renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), '/');
    expect(await screen.findByTestId('slash-menu')).toBeInTheDocument();
    rerender(<Schnellerfassung {...p} eingeklappt />);
    await waitFor(() => expect(screen.queryByTestId('slash-menu')).toBeNull());
  });
});

/**
 * Startfokus beim Mount (LFH-1089). Die Leiste montiert erst, wenn die Entwürfe geladen sind —
 * wer bis dahin schon in einem anderen Feld tippt (Volltextsuche), behält seinen Fokus, sonst
 * landeten die übrigen Zeichen im Entwurf.
 */
describe('Schnellerfassung – Startfokus', () => {
  /** Ein Feld außerhalb der Leiste, das vor ihrem Mount den Fokus hält. */
  function fokussiertVorab(element: HTMLElement): () => void {
    document.body.appendChild(element);
    element.focus();
    return () => element.remove();
  }

  /** Lässt den Startfokus-Effekt laufen, auch wenn er erst nach dem ersten Bild greift. */
  async function effekteAuslaufen() {
    await act(() => new Promise((r) => setTimeout(r, 50)));
  }

  it('fokussiert das Inhaltsfeld, wenn kein anderes Feld den Fokus hält und alles vorbelegt ist', async () => {
    renderMitProviders(<Schnellerfassung {...props()} />);
    await waitFor(() => expect(screen.getByPlaceholderText(/Inhalt/)).toHaveFocus());
  });

  it('Fokus beim Laden: Meldung mit leerem Von fokussiert das Feld Von', async () => {
    renderMitProviders(
      <Schnellerfassung
        {...props({ initialWerte: { inhalt: '', typ: 'meldung', metadaten: {} } })}
      />,
    );
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Von' })).toHaveFocus());
  });

  it('Alles vorbelegt: Lage mit eigener Stelle fokussiert den Inhalt', async () => {
    renderMitProviders(<Schnellerfassung {...props({ initialWerte: LAGE })} />);
    await waitFor(() => expect(screen.getByPlaceholderText(/Inhalt/)).toHaveFocus());
  });

  it('nach dem Erfassen steht der Fokus wieder im ersten leeren Pflichtfeld', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Pumpe läuft{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    // Die nächste Meldung hat kein Von: dorthin.
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Von' })).toHaveFocus());
  });

  it('nimmt einem Eingabefeld außerhalb der Leiste den Fokus nicht', async () => {
    const suche = document.createElement('input');
    suche.setAttribute('aria-label', 'Volltextsuche');
    const aufraeumen = fokussiertVorab(suche);
    try {
      renderMitProviders(<Schnellerfassung {...props()} />);
      await effekteAuslaufen();
      expect(suche).toHaveFocus();
      expect(screen.getByPlaceholderText(/Inhalt/)).not.toHaveFocus();
    } finally {
      aufraeumen();
    }
  });

  it('fokussiert trotzdem, wenn nur ein Knopf den Fokus hält (Sprung über Navigation, Reiter)', async () => {
    const knopf = document.createElement('button');
    knopf.textContent = 'ETB';
    const aufraeumen = fokussiertVorab(knopf);
    try {
      renderMitProviders(<Schnellerfassung {...props()} />);
      await waitFor(() => expect(screen.getByPlaceholderText(/Inhalt/)).toHaveFocus());
    } finally {
      aufraeumen();
    }
  });
});

// ---------------------------------------------------------------------------
// „Auch in den Meldungseingang“ (LLH-1037; Change `kwc2yszv-etb-neuentwurf`, D4)
// ---------------------------------------------------------------------------

describe('Auch in den Meldungseingang', () => {
  const NAME = 'Auch in den Meldungseingang';
  const gesendet = (p: ReturnType<typeof props>, n = 0) =>
    (p.erfassen as ReturnType<typeof vi.fn>).mock.calls[n][0] as NeuerEintrag;

  it('Vorgabe: eine Meldung von außen steht an und geht in den Meldungseingang', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    expect(screen.getByRole('checkbox', { name: NAME })).toBeChecked();
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Pegel steigt{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect(gesendet(p)).toMatchObject({ typ: 'meldung', in_meldungseingang: true });
  });

  it('Eigener Vermerk: Lage mit Von und An der eigenen Stelle steht aus', async () => {
    const p = props({ initialWerte: LAGE });
    renderMitProviders(<Schnellerfassung {...p} />);
    expect(screen.getByRole('checkbox', { name: NAME })).not.toBeChecked();
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Lage ruhig{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect(gesendet(p)).toMatchObject({ typ: 'lage', in_meldungseingang: false });
  });

  it('wechselt Von, gilt die Vorgabe neu, solange nicht von Hand gesetzt', async () => {
    renderMitProviders(<Schnellerfassung {...props({ initialWerte: LAGE })} />);
    expect(screen.getByRole('checkbox', { name: NAME })).not.toBeChecked();
    const von = screen.getByRole('combobox', { name: 'Von' });
    await userEvent.clear(von);
    await userEvent.type(von, 'Florian 3{Enter}');
    expect(screen.getByRole('checkbox', { name: NAME })).toBeChecked();
  });

  it('Zurück nach dem Erfassen: von Hand aus, danach wieder auf der Vorgabe, auch mit „Werte behalten“', async () => {
    const p = props({ werteBehalten: true, onWerteBehaltenChange: vi.fn() });
    renderMitProviders(<Schnellerfassung {...p} />);
    const schalter = screen.getByRole('checkbox', { name: NAME });
    await userEvent.click(schalter);
    expect(schalter).not.toBeChecked();
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Mitschrift{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect(gesendet(p)).toMatchObject({ typ: 'meldung', in_meldungseingang: false });
    // Von bleibt (Werte behalten), der Schalter springt auf die Vorgabe zurück.
    await waitFor(() => expect(screen.getByRole('checkbox', { name: NAME })).toBeChecked());
    expect(feldWert('Von')).toBe('Florian 3');
  });

  it('Anordnung: der Schalter fehlt, gesendet wird ausdrücklich false; ebenso in der Berichtigung', async () => {
    const p = props();
    const { unmount } = renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Anordnung' }));
    expect(screen.queryByRole('checkbox', { name: NAME })).toBeNull();
    await setzeAn('EA-Süd');
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Abmarsch{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect(gesendet(p)).toMatchObject({ typ: 'anordnung', in_meldungseingang: false });
    unmount();

    renderMitProviders(<Schnellerfassung {...props({ berichtigungZu: original() })} />);
    expect(screen.queryByRole('checkbox', { name: NAME })).toBeNull();
  });

  it('ohne Freigabe der Meldungen aus und gesperrt mit Grund; sendet false', async () => {
    server.use(
      http.get('/api/einsaetze/:id/modul-freigaben', () =>
        HttpResponse.json(freigabenFixture({ meldungen: { zugriff: false } })),
      ),
    );
    const p = props();
    const { client } = renderMitProviders(<Schnellerfassung {...p} />);
    await waitFor(() =>
      expect(client.getQueryData(einsatzKeys.modulFreigaben(einsatz.id))).toBeDefined(),
    );
    const schalter = await screen.findByRole('checkbox', { name: NAME });
    await waitFor(() => expect(schalter).not.toBeChecked());
    expect(schalter).toBeDisabled();
    expect(schalter).toHaveAccessibleDescription('Modul Meldungen gesperrt');
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Lage ruhig{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect(gesendet(p)).toMatchObject({ in_meldungseingang: false });
  });

  it('lebt im Entwurf: ein alter Entwurf mit `nurProtokollieren: true` bleibt aus, Umlegen geht an den Aufrufer', async () => {
    const onWerteChange = vi.fn();
    renderMitProviders(
      <Schnellerfassung
        {...props({
          initialWerte: {
            inhalt: 'X',
            typ: 'meldung',
            metadaten: { von: 'Florian 3' },
            nurProtokollieren: true,
          },
          onWerteChange,
        })}
      />,
    );
    const schalter = screen.getByRole('checkbox', { name: NAME });
    expect(schalter).not.toBeChecked();
    await userEvent.click(schalter);
    expect(onWerteChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ typ: 'meldung', nurProtokollieren: false }),
    );
  });
});

/**
 * LLH-1842: Eine getippte Ereigniszeit, die mit Tab oder Klick verlassen wurde, stand im Feld,
 * galt aber nicht. Mit der Feldzeile gilt ein Wert, sobald das Feld verlassen wird (Spec
 * „Feste Felder der Erfassung“).
 */
describe('Ereigniszeit bleibt nach dem Verlassen des Felds (LLH-1842)', () => {
  mitProzessZone('Europe/Berlin');
  // 14:31 Berlin.
  const SERVER = Date.parse('2026-10-17T12:31:00Z');

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(SERVER);
    serveruhrVergessenFuerTests();
    return () => {
      vi.useRealTimers();
      serveruhrVergessenFuerTests();
    };
  });

  it('ein weiteres Feld lässt die Zeit stehen, und der Eintrag trägt sie', async () => {
    const p = props();
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Zeit' }), '1420');
    await userEvent.tab();
    const von = screen.getByRole('combobox', { name: 'Von' });
    await userEvent.clear(von);
    await userEvent.type(von, 'Florian 2');
    await userEvent.tab();
    expect(feldWert('Zeit')).toBe('1420');
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Pumpe läuft{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      ereigniszeit: '2026-10-17 12:20:00',
      von: 'Florian 2',
    });
  });

  it('Senden mit dem Fokus im Feld Zeit sendet die getippte Zeit', async () => {
    const p = props({ initialWerte: { ...MIT_ABSENDER, inhalt: 'Pumpe läuft' } });
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Zeit' }), '1420');
    await userEvent.click(screen.getByRole('button', { name: /^Erfassen/ }));
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      ereigniszeit: '2026-10-17 12:20:00',
    });
  });

  it('ein unberührtes Feld Zeit setzt keine Ereigniszeit', async () => {
    const onWerteChange = vi.fn();
    renderMitProviders(<Schnellerfassung {...props({ onWerteChange })} />);
    screen.getByRole('textbox', { name: 'Zeit' }).focus();
    await userEvent.tab();
    expect(feldWert('Zeit')).toBe('');
    expect(onWerteChange).not.toHaveBeenCalled();
  });
});

describe('Buchstabierhilfe an Von und An (LFH-110)', () => {
  it('steht an beiden Feldern, ohne die Tab-Folge zu unterbrechen', () => {
    renderMitProviders(<Schnellerfassung {...props()} />);
    for (const zu of ['Von', 'An']) {
      const knopf = screen.getByRole('button', { name: `Buchstabierhilfe zu ${zu}` });
      expect(knopf).toHaveAttribute('tabindex', '-1');
    }
  });
});

describe('Von und An folgen der Tastaturregel des Vorschlagsfelds (kwc2yszv, D5)', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/einsaetze/7/fahrzeuge', () =>
        HttpResponse.json([{ id: 1, funkrufname: 'Florian 1', opta: null }]),
      ),
    );
  });

  it('Tab übernimmt den obersten Vorschlag und geht zum Feld An, nicht in den Inhalt', async () => {
    renderMitProviders(
      <Schnellerfassung
        {...props({ initialWerte: { inhalt: '', typ: 'meldung', metadaten: {} } })}
      />,
    );
    const von = screen.getByRole('combobox', { name: 'Von' });
    await userEvent.type(von, 'Flo');
    await screen.findByTitle('„Flo“ als Freitext übernehmen');
    await userEvent.tab();
    expect(feldWert('Von')).toBe('Florian 1');
    expect(screen.getByRole('combobox', { name: 'An' })).toHaveFocus();
  });

  it('Enter übernimmt den obersten Vorschlag und springt in den Inhalt, ohne zu senden', async () => {
    const p = props({ initialWerte: { inhalt: 'Pumpe', typ: 'meldung', metadaten: {} } });
    renderMitProviders(<Schnellerfassung {...p} />);
    const von = screen.getByRole('combobox', { name: 'Von' });
    await userEvent.type(von, 'Flo');
    await screen.findByTitle('„Flo“ als Freitext übernehmen');
    await userEvent.keyboard('{Enter}');
    expect(feldWert('Von')).toBe('Florian 1');
    await waitFor(() => expect(screen.getByPlaceholderText(/Inhalt/)).toHaveFocus());
    expect(p.erfassen).not.toHaveBeenCalled();
  });
});

describe('Niedriges Fenster ab md: Felder und Einstellungen in einer rollenden Zeile', () => {
  it('bei 1366 × 300 (kompakt) eine Zeile mit Typ-Knopf, Feldern und Schaltern, keine eigene Fußzeile', () => {
    setzeViewportBreite(1366);
    setzeViewportHoehe(300);
    renderMitProviders(
      <Schnellerfassung {...props({ werteBehalten: false, onWerteBehaltenChange: vi.fn() })} />,
    );
    const zeile = document.querySelector<HTMLElement>('[data-lfh="etb-feldzeile"]')!;
    expect(zeile.style.flexWrap).toBe('nowrap');
    expect(zeile.style.overflowX).toBe('auto');
    expect(screen.queryByRole('radiogroup', { name: 'Typ des Eintrags' })).toBeNull();
    expect(zeile.contains(screen.getByRole('button', { name: 'Typ des Eintrags: Meldung' }))).toBe(
      true,
    );
    for (const name of ['Werte behalten', 'Auch in den Meldungseingang']) {
      expect(zeile.contains(screen.getByRole('checkbox', { name })), name).toBe(true);
    }
    expect(document.querySelector('[data-lfh="etb-fusszeile"]')).toBeNull();
  });

  it('bei 1366 × 620 (Fükw im Browserfenster, kompakt) bleibt die Feldzeile mit Segmenten und Fußzeile', () => {
    setzeViewportBreite(1366);
    setzeViewportHoehe(620);
    renderMitProviders(<Schnellerfassung {...props()} />);
    expect(screen.getByRole('radiogroup', { name: 'Typ des Eintrags' })).toBeInTheDocument();
    expect(document.querySelector('[data-lfh="etb-fusszeile"]')).not.toBeNull();
  });
});

describe('Befunde aus dem Testnachzug (kwc2yszv)', () => {
  it('„+ weiterer Entwurf“ bleibt beim Senden bedienbar (LFH-117)', async () => {
    const onWeitererEntwurf = vi.fn();
    const p = props({
      onWeitererEntwurf,
      erfassen: vi.fn<(e: NeuerEintrag) => Promise<void>>(() => new Promise(() => {})),
    });
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Lange Sendung{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    const knopf = screen.getByRole('button', { name: '+ weiterer Entwurf' });
    expect(knopf).toBeEnabled();
    await userEvent.click(knopf);
    expect(onWeitererEntwurf).toHaveBeenCalledTimes(1);
  });

  it('Von und An markieren beim Betreten ihren Wert: Tippen ersetzt die Vorgabe', async () => {
    renderMitProviders(<Schnellerfassung {...props({ initialWerte: LAGE })} />);
    const an = screen.getByRole('combobox', { name: 'An' }) as HTMLInputElement;
    await userEvent.click(an);
    await waitFor(() => expect(an.selectionEnd).toBe('ELW 1'.length));
    expect(an.selectionStart).toBe(0);
  });

  it('nennt das erste leere Pflichtfeld für Fokuswege von außen', () => {
    const { unmount } = renderMitProviders(
      <Schnellerfassung
        {...props({ initialWerte: { inhalt: '', typ: 'meldung', metadaten: {} } })}
      />,
    );
    const karte = document.querySelector('[data-lfh="etb-erfassung"]')!;
    expect(karte).toHaveAttribute('data-startfeld', 'von');
    unmount();
    renderMitProviders(<Schnellerfassung {...props({ initialWerte: LAGE })} />);
    expect(document.querySelector('[data-lfh="etb-erfassung"]')).not.toHaveAttribute(
      'data-startfeld',
    );
  });
});

describe('Review der Erfassung (kwc2yszv E4–E7)', () => {
  it('E4: scheitert das Präferenz-Fach, steht der Startfokus trotzdem', async () => {
    renderMitProviders(
      <Schnellerfassung
        {...props({ rufname: { ...rufnameZugriff(null), geladen: false, entschieden: true } })}
      />,
    );
    // Von ist gesetzt, ohne Standard fehlt An: dorthin.
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'An' })).toHaveFocus());
  });

  it('E5: der Pflichtgrund geht, sobald die Seite über die Vorgabe gefüllt ist', async () => {
    const p = props({ initialWerte: { inhalt: 'Pumpe', typ: 'meldung', metadaten: {} } });
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    expect(await screen.findByText('Absender fehlt')).toBeVisible();
    await userEvent.click(screen.getByRole('radio', { name: 'Anordnung' }));
    expect(screen.queryByText('Absender fehlt')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Von' })).not.toHaveAttribute('aria-invalid');
  });

  it('E7: ein per Klick übernommener Freitext bleibt nach Escape stehen', async () => {
    server.use(
      http.get('/api/einsaetze/7/fahrzeuge', () =>
        HttpResponse.json([{ id: 1, funkrufname: 'Florian 1', opta: null }]),
      ),
    );
    renderMitProviders(
      <Schnellerfassung
        {...props({ initialWerte: { inhalt: '', typ: 'meldung', metadaten: {} } })}
      />,
    );
    const von = screen.getByRole('combobox', { name: 'Von' });
    await userEvent.type(von, 'Flo');
    await userEvent.click(await screen.findByTitle('„Flo“ als Freitext übernehmen'));
    await userEvent.keyboard('{Escape}');
    expect(feldWert('Von')).toBe('Flo');
  });
});

describe('Review der Erfassung — Zukunft vor dem Senden (kwc2yszv E6)', () => {
  mitProzessZone('Europe/Berlin');
  const SERVER = Date.parse('2026-10-17T12:31:00Z');
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(SERVER);
    serveruhrVergessenFuerTests();
    return () => {
      vi.useRealTimers();
      serveruhrVergessenFuerTests();
    };
  });

  it('eine Zeit in der Zukunft steht schon vor dem Senden am Feld Zeit', () => {
    renderMitProviders(
      <Schnellerfassung
        {...props({
          initialWerte: {
            inhalt: 'Pumpe',
            typ: 'meldung',
            // 14:35 Berlin, es ist 14:31.
            metadaten: { von: 'Florian 3', ereigniszeit: dayjs.utc('2026-10-17T12:35:00Z') },
          },
        })}
      />,
    );
    expect(screen.getByText('Zeit liegt in der Zukunft')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Zeit' })).toHaveAttribute('aria-invalid', 'true');
  });
});
