import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { BemerkungZelle, BEMERKUNG_HINZUFUEGEN } from './BemerkungZelle';

/**
 * Verhalten der Bemerkungszelle (LFH-369 · B5i, Befund M21).
 *
 * ── WAS HIER NICHT GEPRÜFT WIRD UND WARUM ──────────────────────────────────────────────
 *
 * Keine Pixelhöhe und keine Trefffläche in Pixeln: `test/utils.tsx` rendert ein NACKTES
 * `ConfigProvider` ohne Theme, eine Höhenbehauptung im Vitest misst also antd-Vorgaben und
 * belegt nichts über die Dichte-Staffel (Norm aus CLAUDE.md). Geprüft wird stattdessen die
 * tragfähige Aussage: der Platzhalter ist ein antd-Steuerelement OHNE eigene Größenangabe —
 * damit erbt er `controlHeight` vom Provider, statt eine Zahl zu setzen, die nicht mitzieht.
 *
 * ── GEMESSENE TESTFALLE: antds Editable liest `keyCode`, userEvent setzt es nicht ───────
 *
 * `Editable.js:70-86` entscheidet über Übernehmen und Abbrechen ausschließlich am
 * **legacy `keyCode`** (13 / 27) und verlangt zusätzlich, dass keydown und keyup denselben
 * Wert tragen. `userEvent.type(feld, '…{Enter}')` liefert `key`/`code`, aber keinen
 * `keyCode` — die Bedingung wird nie wahr, die Eingabe bleibt stehen und der Test scheitert
 * mit „0 calls", als wäre die Komponente kaputt. Deshalb: Tastenwege über `fireEvent` mit
 * explizitem `keyCode`, Text weiterhin über `userEvent`.
 */
const ENTER = { keyCode: 13 };
const ESCAPE = { keyCode: 27 };

/** Feuert keydown UND keyup — antd vergleicht beide und ignoriert einen einzelnen Schlag. */
function druecke(feld: HTMLElement, taste: { keyCode: number }) {
  fireEvent.keyDown(feld, taste);
  fireEvent.keyUp(feld, taste);
}

describe('BemerkungZelle', () => {
  it('leerer Wert im Schreibzweig: benannter Platzhalter statt nacktem Stift-Icon', async () => {
    renderMitProviders(<BemerkungZelle wert={null} darfSchreiben onSpeichern={vi.fn()} />);
    expect(screen.getByRole('button', { name: BEMERKUNG_HINZUFUEGEN })).toBeInTheDocument();
  });

  it('der Platzhalter öffnet ein Eingabefeld und übergibt den getippten Wert', async () => {
    /**
     * Der Test, der den Knopf zur ARBEIT verpflichtet: ein Platzhalter, der zwar einen Namen
     * trägt, beim Klick aber nichts öffnet, bestünde die reine Anwesenheitsprüfung.
     */
    const onSpeichern = vi.fn();
    renderMitProviders(<BemerkungZelle wert={null} darfSchreiben onSpeichern={onSpeichern} />);

    await userEvent.click(screen.getByRole('button', { name: BEMERKUNG_HINZUFUEGEN }));
    const feld = screen.getByRole('textbox');
    await userEvent.type(feld, 'Tank leer');
    druecke(feld, ENTER);

    expect(onSpeichern).toHaveBeenCalledWith('Tank leer');
    // Nach dem Übernehmen ist das Feld wieder zu — der Aufrufer liefert den neuen Wert nach.
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('Wegklicken übernimmt ebenfalls — nicht nur die Eingabetaste', async () => {
    /**
     * Der zweite Weg hinaus (`Editable.js:88`, `onBlur → confirmChange`) und im Betrieb der
     * häufigere: in einer Tabellenzeile klickt man in die nächste Zelle, statt Enter zu
     * drücken. Wäre nur der Tastenweg belegt, blieb der Mausweg unbewacht.
     */
    const onSpeichern = vi.fn();
    renderMitProviders(<BemerkungZelle wert={null} darfSchreiben onSpeichern={onSpeichern} />);

    await userEvent.click(screen.getByRole('button', { name: BEMERKUNG_HINZUFUEGEN }));
    const feld = screen.getByRole('textbox');
    await userEvent.type(feld, 'Achse defekt');
    fireEvent.blur(feld);

    expect(onSpeichern).toHaveBeenCalledWith('Achse defekt');
  });

  it('gefüllter Wert: Text plus Stift, kein Platzhalter — und der Stift öffnet weiterhin', async () => {
    /**
     * Regressionsschutz für die kontrollierte `editing`-Prop: wer sie setzt und `onStart`
     * vergisst, nimmt dem gefüllten Wert lautlos die Bearbeitbarkeit. Der Stift wäre noch da
     * und klickte ins Leere.
     */
    const onSpeichern = vi.fn();
    renderMitProviders(<BemerkungZelle wert="Tank leer" darfSchreiben onSpeichern={onSpeichern} />);

    expect(screen.getByText('Tank leer')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: BEMERKUNG_HINZUFUEGEN })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('Abbrechen verwirft, ohne zu speichern, und der Platzhalter kehrt zurück', async () => {
    const onSpeichern = vi.fn();
    renderMitProviders(<BemerkungZelle wert={null} darfSchreiben onSpeichern={onSpeichern} />);

    await userEvent.click(screen.getByRole('button', { name: BEMERKUNG_HINZUFUEGEN }));
    const feld = screen.getByRole('textbox');
    await userEvent.type(feld, 'Tippfehler');
    druecke(feld, ESCAPE);

    expect(onSpeichern).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: BEMERKUNG_HINZUFUEGEN })).toBeInTheDocument();
  });

  it('Lesezweig zeigt „—" und KEINEN Platzhalter — eine Aufforderung ohne Aktion wäre gelogen', () => {
    /**
     * „Lesezweig konsistent halten" heißt gleiche Zeilenhöhe und Typografie, NICHT gleicher
     * Wortlaut: ohne Schreibrecht gibt es keine Aktion, ein „Bemerkung hinzufügen" wäre eine
     * falsche Affordanz. Dass beide Zweige gleich hoch bleiben, trägt das Primitiv dadurch,
     * dass sie durch dieselbe Datei laufen.
     */
    const { container } = renderMitProviders(
      <BemerkungZelle wert={null} darfSchreiben={false} onSpeichern={vi.fn()} />,
    );
    expect(container.textContent).toBe('—');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('Lesezweig mit Wert zeigt den Wert, nicht den Strich', () => {
    const { container } = renderMitProviders(
      <BemerkungZelle wert="Tank leer" darfSchreiben={false} onSpeichern={vi.fn()} />,
    );
    expect(container.textContent).toBe('Tank leer');
  });

  it('der Platzhalter setzt keine eigene Größe und keine Klein-Variante', () => {
    /**
     * Gate aus LFH-362: neues punktuelles `size="small"` auf interaktiven Elementen ist
     * verboten. Und ein handgebautes Bedienziel bräuchte nach LFH-365 zwei Angaben
     * (`minHeight` PLUS Polsterung) samt eigener Zusicherung über zwei Dichtestufen — ein
     * echter `Button` schuldet nichts davon, weil er vom `ConfigProvider` erbt. Genau das
     * wird hier festgenagelt: antd-Knopf, keine Klein-Marke, kein Inline-Maß.
     */
    renderMitProviders(<BemerkungZelle wert={null} darfSchreiben onSpeichern={vi.fn()} />);
    const knopf = screen.getByRole('button', { name: BEMERKUNG_HINZUFUEGEN });

    expect(knopf).toHaveClass('ant-btn');
    expect(knopf).not.toHaveClass('ant-btn-sm');
    expect(knopf.style.height).toBe('');
    expect(knopf.style.minHeight).toBe('');
    // „Rot bedient nichts": eine Bemerkung zu ergänzen ist keine Gefahr.
    expect(knopf).not.toHaveClass('ant-btn-dangerous');
  });
});
