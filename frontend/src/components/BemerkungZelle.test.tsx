import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { dichten } from '../theme/tokens';
import { BemerkungZelle, BEMERKUNG_HINZUFUEGEN, wertKnopfStil } from './BemerkungZelle';

/**
 * Verhalten der Bemerkungszelle (LFH-369 · B5i).
 *
 * Keine Pixelhöhe: `test/utils.tsx` rendert ein NACKTES `ConfigProvider`, eine Höhenbehauptung
 * mäße antd-Vorgaben. Geprüft wird die tragfähige Aussage: der Platzhalter ist ein
 * antd-Steuerelement OHNE eigene Größenangabe und erbt `controlHeight` vom Provider.
 *
 * TESTFALLE: antds `Editable` entscheidet über Übernehmen/Abbrechen am **legacy `keyCode`**
 * (13 / 27) und verlangt denselben Wert an keydown und keyup. `userEvent` setzt keinen
 * `keyCode`, der Test scheiterte mit „0 calls". Tastenwege deshalb über `fireEvent` mit
 * explizitem `keyCode`, Text über `userEvent`.
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

  it('tauscht mit `bezeichnung` nur das Wort — Platzhalter, Name und Stift (LFH-613)', () => {
    const { rerender } = renderMitProviders(
      <BemerkungZelle
        wert={null}
        darfSchreiben
        onSpeichern={vi.fn()}
        kennung="R-042"
        bezeichnung="Zustand"
      />,
    );
    const knopf = screen.getByRole('button', { name: 'Zustand zu R-042 hinzufügen' });
    expect(knopf).toHaveTextContent(/^Zustand hinzufügen$/);
    rerender(
      <BemerkungZelle
        wert="gehfähig"
        darfSchreiben
        onSpeichern={vi.fn()}
        kennung="R-042"
        bezeichnung="Zustand"
      />,
    );
    expect(screen.getByRole('button', { name: 'Zustand zu R-042 bearbeiten' })).toBeInTheDocument();
    // Gegenhälfte: ohne `bezeichnung` bleibt der Bestandswortlaut.
    rerender(<BemerkungZelle wert={null} darfSchreiben onSpeichern={vi.fn()} />);
    expect(screen.getByRole('button', { name: BEMERKUNG_HINZUFUEGEN })).toHaveTextContent(
      BEMERKUNG_HINZUFUEGEN,
    );
  });

  it('der Platzhalter öffnet ein Eingabefeld und übergibt den getippten Wert', async () => {
    /**
     * Verpflichtet den Knopf zur ARBEIT: ein Platzhalter mit Namen, der beim Klick nichts öffnet,
     * bestünde die reine Anwesenheitsprüfung.
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
     * Der zweite Weg hinaus (`onBlur → confirmChange`) und im Betrieb der häufigere: man klickt in
     * die nächste Zelle, statt Enter zu drücken.
     */
    const onSpeichern = vi.fn();
    renderMitProviders(<BemerkungZelle wert={null} darfSchreiben onSpeichern={onSpeichern} />);

    await userEvent.click(screen.getByRole('button', { name: BEMERKUNG_HINZUFUEGEN }));
    const feld = screen.getByRole('textbox');
    await userEvent.type(feld, 'Achse defekt');
    fireEvent.blur(feld);

    expect(onSpeichern).toHaveBeenCalledWith('Achse defekt');
  });

  it('gefüllter Wert: der Wert selbst ist der Knopf, benannt als Aufforderung, beschrieben durch den Wert (LFH-650)', async () => {
    /**
     * Der gefüllte Wert ist ein `Button type="text"`, dieselbe Bauform wie der Platzhalter (LFH-650).
     * Die Aussagen: es IST ein antd-Knopf (erbt `controlHeight`), er steht in der Textfarbe (der
     * Wert ist Inhalt, kein Verweis), und das `aria-label` verdeckt den Wert nicht ersatzlos — die
     * Beschreibung bringt ihn zurück.
     */
    renderMitProviders(
      <BemerkungZelle wert="gehfähig" darfSchreiben kennung="R-042" onSpeichern={vi.fn()} />,
    );
    const knopf = screen.getByRole('button', { name: 'Bemerkung zu R-042 bearbeiten' });
    expect(knopf).toHaveClass('ant-btn', 'ant-btn-text');
    expect(knopf).not.toHaveClass('ant-btn-sm');
    expect(knopf).toHaveAccessibleDescription('gehfähig');
    expect(knopf).toHaveTextContent('gehfähig');
    // Das Stift-Icon ist kein eigenes Vorleseziel (`role="img"` mit englischem Namen).
    expect(within(knopf).queryByRole('img')).toBeNull();
    // Der Klick auf den WERT öffnet — nicht nur ein Ikonknopf daneben.
    await userEvent.click(within(knopf).getByText('gehfähig'));
    expect(screen.getByRole('textbox')).toHaveValue('gehfähig');
  });

  it('während ein Schreibvorgang läuft, steht der NEUE Wert schon da und öffnet nicht erneut (LFH-650)', async () => {
    /**
     * Bis zur Serverantwort darf bei einem vorher leeren Feld nicht wieder „… hinzufügen" stehen.
     * Der Aufrufer reicht den neuen Wert samt `laeuft`; die Zelle zeigt ihn mit Ladeanzeige und
     * nimmt keinen zweiten Klick an.
     */
    const { rerender } = renderMitProviders(
      <BemerkungZelle wert="gehfähig" darfSchreiben laeuft kennung="R-042" onSpeichern={vi.fn()} />,
    );
    const knopf = screen.getByRole('button', { name: 'Bemerkung zu R-042 bearbeiten' });
    expect(knopf).toHaveTextContent('gehfähig');
    expect(knopf).toHaveClass('ant-btn-loading');
    await userEvent.click(knopf);
    expect(screen.queryByRole('textbox')).toBeNull();
    // Gegenhälfte: ohne `laeuft` keine Ladeanzeige — sonst prüfte die Zeile oben nichts.
    rerender(
      <BemerkungZelle wert="gehfähig" darfSchreiben kennung="R-042" onSpeichern={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Bemerkung zu R-042 bearbeiten' })).not.toHaveClass(
      'ant-btn-loading',
    );
  });

  it('gefüllter Wert: Wertknopf statt Platzhalter — und der Knopf öffnet das Eingabefeld', async () => {
    /**
     * Der Wertknopf öffnet die Bearbeitung per `setBearbeitet(true)`; `Typography` steht nur für das
     * Eingabefeld im Baum. Fiele der `onClick` weg, klickte der Wert ins Leere.
     */
    const onSpeichern = vi.fn();
    renderMitProviders(
      <BemerkungZelle
        wert="Tank leer"
        darfSchreiben
        kennung="Florian 1"
        onSpeichern={onSpeichern}
      />,
    );

    expect(screen.getByText('Tank leer')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: BEMERKUNG_HINZUFUEGEN })).toBeNull();

    // Über die KENNUNG gegriffen: sie trägt den zugänglichen Namen des Wertknopfs.
    await userEvent.click(
      screen.getByRole('button', { name: 'Bemerkung zu Florian 1 bearbeiten' }),
    );
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

  it('auch wenn der gespeicherte Wert NACHKOMMT, fällt der Fokus nicht auf <body>', () => {
    /**
     * Der Weg, den der BETRIEB nimmt: der neue Wert kommt per Invalidierung nach, der Platzhalter
     * hängt aus, und weder der eigene Rückgabe-Effekt (in dieser Runde `warBearbeitet === false`)
     * noch antds (frisches `Typography` ohne `prevEditing`) greift von selbst.
     *
     * Mit einem Mock bliebe `wert` null und der Test blind; der Nachlauf wird per `rerender`
     * gestellt.
     */
    const { rerender } = renderMitProviders(
      <BemerkungZelle wert={null} darfSchreiben kennung="Florian 1" onSpeichern={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Bemerkung zu Florian 1 hinzufügen' }));
    druecke(screen.getByRole('textbox'), ENTER);
    rerender(
      <BemerkungZelle wert="Tank leer" darfSchreiben kennung="Florian 1" onSpeichern={vi.fn()} />,
    );

    expect(document.activeElement).not.toBe(document.body);
  });

  it('nach dem Verlassen liegt der Fokus wieder auf dem Platzhalter, nicht auf <body>', async () => {
    /**
     * antd gibt den Fokus nur an seinen EIGENEN Stift zurück. Auf dem leeren Zweig hängt
     * `Typography.Text` in derselben Runde aus, in der `bearbeitet` fällt, und der Fokus fiele auf
     * `<body>`.
     *
     * Beide Auswege werden geprüft — Abbrechen UND Übernehmen —, weil sie verschiedene Zweige
     * nehmen.
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
     * Konsistent ist die BEDEUTUNG des Leerzustands, nicht der Wortlaut: ohne Schreibrecht gibt es
     * keine Aktion. Über gleiche Zeilenhöhe sagt dieser Test nichts (jsdom rechnet kein Layout).
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
     * Die Zeilenkennung steht im zugänglichen Namen (Bündelungs-Festlegung aus LFH-365), sonst
     * lieferte eine Liste n-mal denselben Namen. Sichtbar bleibt der kurze Text, damit die Spalte
     * nicht unnötig breit wird.
     */
    renderMitProviders(
      <>
        <BemerkungZelle wert={null} darfSchreiben kennung="Florian 1" onSpeichern={vi.fn()} />
        <BemerkungZelle wert="Tank leer" darfSchreiben kennung="Florian 2" onSpeichern={vi.fn()} />
      </>,
    );

    const leer = screen.getByRole('button', { name: 'Bemerkung zu Florian 1 hinzufügen' });
    expect(leer).toHaveTextContent(BEMERKUNG_HINZUFUEGEN);
    expect(
      screen.getByRole('button', { name: 'Bemerkung zu Florian 2 bearbeiten' }),
    ).toBeInTheDocument();
  });

  it('ohne Änderung wird nicht gespeichert — ein Fehlklick kostet keinen Schreibvorgang', async () => {
    /**
     * antd vergleicht nicht: `onChange` feuert beim Verlassen unbedingt. Ein Klick auf den
     * Platzhalter und einer daneben schickten sonst ein PATCH mit leerem Wert samt Invalidierung und
     * Live-Ereignis.
     */
    const onSpeichern = vi.fn();
    renderMitProviders(<BemerkungZelle wert={null} darfSchreiben onSpeichern={onSpeichern} />);

    await userEvent.click(screen.getByRole('button', { name: BEMERKUNG_HINZUFUEGEN }));
    fireEvent.blur(screen.getByRole('textbox'));

    expect(onSpeichern).not.toHaveBeenCalled();
  });

  it('der Platzhalter setzt keine eigene Größe und keine Klein-Variante', () => {
    /**
     * Dichte-Gate (LFH-362): kein punktuelles `size="small"`. Ein echter `Button` erbt vom
     * `ConfigProvider` und schuldet nicht die zwei Angaben eines handgebauten Bedienziels
     * (LFH-365). Festgenagelt: antd-Knopf, keine Klein-Marke, kein Inline-Maß.
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

  it('der Platzhalter steht in `bedienText`, nicht in antds `colorLink` (LFH-650)', () => {
    /**
     * Der Knopftext nimmt `bedienText`, nicht `colorLink` (der auf Lücken-Tönung die Kontrastböden
     * nicht hielt, `e2e/betroffene-kontrast.spec.ts`). Als Literal — aus dem Token gelesen prüfte
     * der Test die Rolle gegen sich selbst.
     */
    renderMitProviders(<BemerkungZelle wert={null} darfSchreiben onSpeichern={vi.fn()} />);
    expect(screen.getByRole('button', { name: BEMERKUNG_HINZUFUEGEN }).style.color).toBe(
      'rgb(20, 71, 121)',
    );
  });
});

/**
 * Der gefüllte Wertknopf darf umbrechen (`height: auto`) und ist damit ein handgebautes
 * Bedienziel mit ZWEI Angaben (LFH-365). Böden als Literale, die Werte aus `dichten`.
 */
describe('wertKnopfStil (LFH-650)', () => {
  const tokenFuer = (stufe: keyof typeof dichten) => ({
    controlHeight: dichten[stufe].zeilenhoehe,
    paddingXS: dichten[stufe].abstand.xs,
    paddingSM: dichten[stufe].abstand.sm,
  });

  it('trägt den Boden aus controlHeight — 30 / 48 / 72 px', () => {
    expect(wertKnopfStil(tokenFuer('kompakt')).minHeight).toBe(30);
    expect(wertKnopfStil(tokenFuer('komfortabel')).minHeight).toBe(48);
    expect(wertKnopfStil(tokenFuer('handschuh')).minHeight).toBe(72);
  });

  it('zieht Höhe UND Polsterung über die Stufen mit, statt auf einer zu kleben', () => {
    const k = wertKnopfStil(tokenFuer('kompakt'));
    const h = wertKnopfStil(tokenFuer('handschuh'));
    expect(k.paddingBlock).toBe(3);
    expect(h.paddingBlock).toBe(7);
    expect(k.paddingInline).toBe(7);
    expect(h.paddingInline).toBe(16);
    expect(Number(k.minHeight)).toBeLessThan(Number(h.minHeight));
  });

  it('darf umbrechen: feste antd-Höhe aufgehoben, Text links', () => {
    expect(wertKnopfStil(tokenFuer('kompakt'))).toMatchObject({
      height: 'auto',
      whiteSpace: 'normal',
      textAlign: 'start',
    });
  });
});
