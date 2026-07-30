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
    renderMitProviders(
      <BemerkungZelle wert="Tank leer" darfSchreiben kennung="Florian 1" onSpeichern={onSpeichern} />,
    );

    expect(screen.getByText('Tank leer')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: BEMERKUNG_HINZUFUEGEN })).toBeNull();

    /**
     * Über die KENNUNG gegriffen, nicht über antds Vorgabenamen: `test/utils.tsx` rendert
     * ohne `locale`, dort heißt der Stift „Edit" — in Produktion setzt `ThemeModeProvider`
     * `deDE`, dort „Bearbeiten" (`locale/de_DE.js:78-79`). Ein Test auf „Edit" prüfte also
     * einen Namen, den nie jemand zu sehen bekommt, und bräche, sobald die Testhülle eine
     * Locale bekommt.
     */
    await userEvent.click(screen.getByRole('button', { name: 'Bemerkung zu Florian 1 bearbeiten' }));
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

  it('nach dem Verlassen liegt der Fokus wieder auf dem Platzhalter, nicht auf <body>', async () => {
    /**
     * antd stellt den Fokus beim Verlassen selbst her — aber nur auf seinen EIGENEN Stift
     * (`Base/index.js:90-95`, `useLayoutEffect` auf `editIconRef`). Auf dem leeren Zweig
     * hängt `Typography.Text` in derselben Runde aus dem Baum aus, in der `bearbeitet` auf
     * `false` fällt: der Effekt läuft für diesen Wert nie, `editIconRef` ist ohnehin leer,
     * und der Fokus fällt auf `<body>`. Genau diese Klasse führt die Erfassungs-Norm bereits
     * („der Fokus landet gemessen auf `<body>`").
     *
     * Beide Auswege werden geprüft — Abbrechen UND Übernehmen —, weil sie verschiedene
     * Zweige nehmen und ein Fix nur für einen von beiden nicht auffiele.
     */
    const onSpeichern = vi.fn();
    renderMitProviders(<BemerkungZelle wert={null} darfSchreiben onSpeichern={onSpeichern} />);

    const platzhalter = () => screen.getByRole('button', { name: BEMERKUNG_HINZUFUEGEN });

    await userEvent.click(platzhalter());
    druecke(screen.getByRole('textbox'), ESCAPE);
    expect(document.activeElement).toBe(platzhalter());

    await userEvent.click(platzhalter());
    druecke(screen.getByRole('textbox'), ENTER);
    expect(document.activeElement).toBe(platzhalter());
  });

  it('Lesezweig zeigt „—" und KEINEN Platzhalter — eine Aufforderung ohne Aktion wäre gelogen', () => {
    /**
     * „Lesezweig konsistent halten" heißt gleiche BEDEUTUNG des Leerzustands, nicht gleicher
     * Wortlaut: ohne Schreibrecht gibt es keine Aktion, ein „Bemerkung hinzufügen" wäre eine
     * Aufforderung ins Leere. Über gleiche Zeilenhöhe sagt dieser Test nichts — jsdom rechnet
     * kein Layout, und die beiden Zweige sind gemessen auch nicht gleich hoch.
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

  it('mit Zeilenkennung tragen mehrere Zellen unterscheidbare Namen — sichtbar bleibt der kurze Text', () => {
    /**
     * Die Bündelungs-Festlegung aus LFH-365 verlangt die Zeilenkennung im zugänglichen Namen,
     * „weil n Zeilen sonst n gleichnamige Knöpfe liefern". Das gilt hier genauso: auf der
     * Materialseite steht die Bemerkungsspalte per Voreinstellung SICHTBAR, eine 50-Zeilen-
     * Liste lieferte also 50-mal denselben Namen in der Knopfliste eines Screenreaders.
     *
     * Sichtbar bleibt der kurze Text — die Kennung steht daneben schon in der Zeile und
     * würde die Spalte sonst unnötig breit machen.
     */
    renderMitProviders(
      <>
        <BemerkungZelle wert={null} darfSchreiben kennung="Florian 1" onSpeichern={vi.fn()} />
        <BemerkungZelle wert="Tank leer" darfSchreiben kennung="Florian 2" onSpeichern={vi.fn()} />
      </>,
    );

    const leer = screen.getByRole('button', { name: 'Bemerkung zu Florian 1 hinzufügen' });
    expect(leer).toHaveTextContent(BEMERKUNG_HINZUFUEGEN);
    expect(screen.getByRole('button', { name: 'Bemerkung zu Florian 2 bearbeiten' })).toBeInTheDocument();
  });

  it('ohne Änderung wird nicht gespeichert — ein Fehlklick kostet keinen Schreibvorgang', async () => {
    /**
     * antd vergleicht nicht: `Base/index.js` ruft `onChange` beim Verlassen unbedingt. Ein
     * Klick auf den Platzhalter und ein Klick daneben schickten damit ein PATCH mit leerem
     * Wert, samt Invalidierung und Live-Ereignis an alle Verbundenen — für nichts. Der
     * sichtbare Platzhalter macht diesen Fehlklick deutlich leichter als der alte Stift.
     */
    const onSpeichern = vi.fn();
    renderMitProviders(<BemerkungZelle wert={null} darfSchreiben onSpeichern={onSpeichern} />);

    await userEvent.click(screen.getByRole('button', { name: BEMERKUNG_HINZUFUEGEN }));
    fireEvent.blur(screen.getByRole('textbox'));

    expect(onSpeichern).not.toHaveBeenCalled();
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
