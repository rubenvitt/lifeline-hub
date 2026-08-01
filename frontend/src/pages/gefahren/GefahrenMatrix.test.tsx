import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider } from 'antd';
import { renderMitProviders } from '../../test/utils';
import { antdToken, farbenHell, type Dichte } from '../../theme/tokens';
import GefahrenMatrix, { type GefahrenMatrixProps } from './GefahrenMatrix';
import type { GefahrBewertung } from '../../api/types';

const zelle = (over: Partial<GefahrBewertung>): GefahrBewertung => ({
  id: 1, gefahrengebiet_id: 7, gefahrentyp: 'brand', schutzobjekt: 'menschen', warnstufe: 'hoch',
  beschreibung: null, gemeldet_von: null, aktualisiert_von: 1, erstellt_at: '', geaendert_at: '', ...over,
});

/**
 * Der Eintrag wird IMMER über das geöffnete Menü gegriffen: antd lässt die Portale
 * geschlossener Dropdowns im Baum stehen, ein globales getByText träfe auch sie.
 * Muster aus `etb/EtbTabelle.test.tsx` (LFH-365 · B5e); in einer Matrix mit 58
 * Auslösern liegt je bereits geöffneter Zelle ein eigenes totes Portal herum.
 *
 * `:not(.ant-dropdown-hidden)` allein GENÜGT HIER NICHT — gemessen an genau dem Fall,
 * der zwei Zellen nacheinander öffnet. In jsdom läuft keine Bewegung zu Ende, das
 * verlassende Portal bekommt seine `ant-dropdown-hidden`-Klasse also nie und bleibt in
 * `ant-slide-up-leave-active` stehen. Der Baum trug dann zwei „offene" Dropdowns; der
 * erste Treffer war das TOTE, und `userEvent` scheiterte an dessen `pointer-events:
 * none` statt am Testgegenstand. Genau dieser Inline-Stil ist das verlässliche
 * Unterscheidungsmerkmal, deshalb filtert er hier — und die Zählung ist streng, damit
 * eine falsche Annahme laut wird statt still das falsche Menü zu greifen.
 */
function imMenue() {
  const offen = Array.from(
    document.querySelectorAll<HTMLElement>('.ant-dropdown:not(.ant-dropdown-hidden)'),
  ).filter((d) => d.style.pointerEvents !== 'none');
  if (offen.length !== 1) throw new Error(`genau ein offenes Menü erwartet, ${offen.length} gefunden`);
  const menue = offen[0].querySelector('[role="menu"]');
  if (!menue) throw new Error('das offene Dropdown trägt kein Menü');
  return within(menue as HTMLElement);
}

const PFLICHT: GefahrenMatrixProps = {
  matrix: [],
  darfSchreiben: true,
  laufendeZelle: null,
  onSetzen: () => {},
  onDetailsSpeichern: async () => {},
};

/** Ein Ort für die Pflichtprops. Ohne den trägt jeder der neun Fälle vier Zeilen
 *  Gerüst, und eine neue Prop hieße neun Änderungen. Getrennt vom Rendern, weil zwei
 *  Fälle dasselbe Element mit geänderter `matrix` NACHREICHEN müssen (`rerender`) —
 *  das ist der Weg, auf dem ein Nachladen unter einem offenen Dialog eintrifft. */
function matrixElement(over: Partial<GefahrenMatrixProps> = {}) {
  return <GefahrenMatrix {...PFLICHT} {...over} />;
}

function rendereMatrix(over: Partial<GefahrenMatrixProps> = {}) {
  return renderMitProviders(matrixElement(over));
}

/** Öffnet den Detail-Dialog einer Zelle der Zeile Brand und wartet, bis er steht. */
async function oeffneDetails(stufe: string, spalte = 'Menschen') {
  await userEvent.click(screen.getByRole('button', { name: `Bewertung Brand × ${spalte}: ${stufe}` }));
  await userEvent.click(imMenue().getByRole('menuitem', { name: 'Details …' }));
  return screen.findByLabelText('Beschreibung');
}

describe('GefahrenMatrix', () => {
  it('rendert 13 Zeilen × 5 Spalten', () => {
    rendereMatrix();
    expect(screen.getAllByText('Brand')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Ertrinken')[0]).toBeInTheDocument();
    // Zeuge der fünften SPALTE. Vorher stand hier „Einsatzkräfte" — das volle Wort
    // steht seit dem Kopfumbau nur noch im Tooltip, und den hängt antd erst beim
    // Zeigen ein. Die Kurzform ist der Text, der im Baum steht.
    expect(screen.getAllByText('Kraft')[0]).toBeInTheDocument();
  });

  it('setzt eine Warnstufe über das Zellmenü und ruft onSetzen mit vollem Zell-Zustand', async () => {
    const onSetzen = vi.fn();
    rendereMatrix({ onSetzen });
    await userEvent.click(screen.getByRole('button', { name: 'Bewertung Brand × Menschen: keine' }));
    // Regex mit `i`: der Eintrag heißt „H · Hoch", der Vorgabe-Normalisierer von
    // Testing Library trimmt und faltet Leerraum, aber er kleinschreibt nicht.
    await userEvent.click(imMenue().getByRole('menuitem', { name: /hoch/i }));
    await waitFor(() => expect(onSetzen).toHaveBeenCalledWith({
      gefahrentyp: 'brand', schutzobjekt: 'menschen', warnstufe: 'hoch',
      beschreibung: null, gemeldet_von: null,
    }));
  });

  it('gibt jeder Zelle einen eigenen Namen — 65 gleichnamige Knöpfe wären keine Bedienung', () => {
    rendereMatrix();
    const namen = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    const bewertungen = namen.filter((n) => n?.startsWith('Bewertung '));
    expect(bewertungen).toHaveLength(58); // 65 − 7 ungültige Kombinationen
    expect(new Set(bewertungen).size).toBe(bewertungen.length);
  });

  it('macht die 7 ungültigen Kombinationen ohne Farbe erkennbar — und unbedienbar', () => {
    rendereMatrix();
    // Zweiter Kanal ist TEXT: die Zelle sagt „nicht anwendbar", statt nur blass zu sein.
    expect(screen.getAllByText('n. a.')).toHaveLength(7);
    expect(
      screen.queryByRole('button', { name: /Bewertung Atemgifte × Sachwerte/ }),
    ).not.toBeInTheDocument();
  });

  it('behält beschreibung/gemeldet_von bei Warnstufen-Wechsel', async () => {
    const onSetzen = vi.fn();
    const matrix = [zelle({ warnstufe: 'hoch', beschreibung: 'Dachstuhl', gemeldet_von: 'KdoW' })];
    rendereMatrix({ matrix, onSetzen });
    await userEvent.click(screen.getByRole('button', { name: 'Bewertung Brand × Menschen: hoch' }));
    await userEvent.click(imMenue().getByRole('menuitem', { name: /akut/i }));
    await waitFor(() => expect(onSetzen).toHaveBeenCalledWith({
      gefahrentyp: 'brand', schutzobjekt: 'menschen', warnstufe: 'akut',
      beschreibung: 'Dachstuhl', gemeldet_von: 'KdoW',
    }));
  });

  it('sperrt beim laufenden PUT NUR die betroffene Zelle, nicht die anderen 57', () => {
    rendereMatrix({ laufendeZelle: 'brand×menschen' });
    // antd klont den Auslöser mit `disabled` (`antd/es/dropdown/dropdown.js:125`:
    // `disabled: child.props.disabled ?? disabled`) — die Prop am Dropdown erreicht
    // also wirklich den Knopf, nicht nur das Popup.
    expect(screen.getByRole('button', { name: 'Bewertung Brand × Menschen: keine' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Bewertung Brand × Tiere: keine' })).toBeEnabled();
  });

  it('zeigt die Stufe als Kürzel — die Fläche allein wäre der einzige Kanal', () => {
    rendereMatrix({ matrix: [zelle({ warnstufe: 'akut' })] });
    const knopf = screen.getByRole('button', { name: 'Bewertung Brand × Menschen: akut' });
    expect(knopf).toHaveTextContent('A');
  });

  it('hält den Detail-Wortlaut, wenn das Speichern abgelehnt wird', async () => {
    const onDetailsSpeichern = vi.fn().mockRejectedValue(new Error('422'));
    rendereMatrix({ matrix: [zelle({ warnstufe: 'hoch' })], onDetailsSpeichern });
    const feld = await oeffneDetails('hoch');
    await userEvent.type(feld, 'Dachstuhl brennt');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onDetailsSpeichern).toHaveBeenCalled());
    // Zugesichert ist NUR: nicht geleert. Der Wortlaut ist teurer als der Klick.
    // „Nicht geschlossen" stünde hier zu Unrecht — in jsdom läuft keine
    // Verlass-Bewegung, `.ant-modal-wrap` bleibt auch nach ERFOLGREICHEM Speichern im
    // Baum. Ein Schliesszustand ist hier also gar nicht beobachtbar; der Nachweis
    // gehört nach Playwright.
    expect(await screen.findByLabelText('Beschreibung')).toHaveValue('Dachstuhl brennt');
  });

  /**
   * Die Vorbelegung selbst — und sie war bis zum Review von KEINEM Fall gedeckt.
   *
   * Gemessen (Review-Mutationsprobe): vertauscht man die beiden Effekte in
   * `GefahrenZelleDetails`, liest der Vorbeleg-Effekt beim Öffnen eine noch leere Ref,
   * die Felder bleiben leer — und die Suite blieb trotzdem 20/20 grün. Fehlerbild in
   * der Bedienung: der Bediener öffnet „Details …", sieht ein leeres Feld statt des
   * Bestands, tippt den Meldeweg nach und speichert — die vorhandene Beschreibung ist
   * weg. Stiller Datenverlust ohne roten Test.
   *
   * Warum die Nachbarfälle das NICHT fangen: „lässt den getippten Wortlaut stehen"
   * tippt seinen Text selbst (ein `clear` auf ein bereits leeres Feld ist ein No-op),
   * und „speichert die AKTUELLE Warnstufe" liest die Stufe aus `matrix`, nie aus dem
   * Formular.
   */
  it('belegt den Dialog mit dem Bestand vor', async () => {
    rendereMatrix({
      matrix: [zelle({ warnstufe: 'hoch', beschreibung: 'Dachstuhl', gemeldet_von: 'KdoW' })],
    });
    await oeffneDetails('hoch');
    expect(screen.getByLabelText('Beschreibung')).toHaveValue('Dachstuhl');
    expect(screen.getByLabelText('Gemeldet von')).toHaveValue('KdoW');
  });

  /**
   * Die Gegenrichtung: eine Zelle OHNE Bestand darf nicht den Rest der vorigen tragen.
   *
   * Was dieser Fall NICHT belegt: dass `kennung` in den Abhängigkeiten des
   * Vorbeleg-Effekts steht. Über die Matrix ist ein Zellwechsel nur mit Schliessen
   * dazwischen erreichbar, `offen` springt dabei um, und das allein löst den Effekt
   * schon aus — gemessen: ohne `kennung` in den Abhängigkeiten bleibt diese Datei
   * vollständig grün. Den Beleg dafür trägt `GefahrenZelleDetails.test.tsx` an der
   * Vertragsgrenze der Komponente.
   */
  it('leert die Felder beim Wechsel auf eine Zelle ohne Bestand', async () => {
    rendereMatrix({
      matrix: [
        zelle({ warnstufe: 'hoch', beschreibung: 'Dachstuhl', gemeldet_von: 'KdoW' }),
        zelle({ id: 2, schutzobjekt: 'tiere', warnstufe: 'mittel' }),
      ],
    });
    await oeffneDetails('hoch');
    expect(screen.getByLabelText('Beschreibung')).toHaveValue('Dachstuhl');
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    await oeffneDetails('mittel', 'Tiere');
    expect(screen.getByLabelText('Beschreibung')).toHaveValue('');
    expect(screen.getByLabelText('Gemeldet von')).toHaveValue('');
  });

  /**
   * Das verlorene Update. Der Dialog zeigt die Warnstufe NICHT an, schickt sie aber
   * mit — hielte er den Zell-Datensatz als Momentaufnahme aus dem Augenblick des
   * Menüklicks, schriebe „Speichern" eine inzwischen gesetzte Stufe still zurück.
   * Zwei erreichbare Wege dorthin: ein zweiter Bediener am selben Gefahrengebiet
   * (`GefahrenPage` invalidiert die Matrix nach jedem erfolgreichen PUT), und derselbe
   * Bediener, der eine Stufe setzt und sofort „Details …" öffnet.
   *
   * Der `rerender` IST der Nachladefall: eine neue `matrix`-Prop unter einem bereits
   * offenen Dialog.
   */
  it('speichert die AKTUELLE Warnstufe, nicht die beim Öffnen gesehene', async () => {
    const onDetailsSpeichern = vi.fn().mockResolvedValue(undefined);
    const { rerender } = rendereMatrix({ matrix: [zelle({ warnstufe: 'hoch' })], onDetailsSpeichern });
    await oeffneDetails('hoch');
    rerender(matrixElement({ matrix: [zelle({ warnstufe: 'akut' })], onDetailsSpeichern }));
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onDetailsSpeichern).toHaveBeenCalledWith({
      gefahrentyp: 'brand', schutzobjekt: 'menschen', warnstufe: 'akut',
      beschreibung: null, gemeldet_von: null,
    }));
  });

  /**
   * Die Kehrseite des Falls darüber, und ohne sie wäre der Fix eine Verschlechterung:
   * die Zelle wird jetzt bei JEDEM Render frisch abgeleitet, hat also nach jedem
   * Nachladen eine neue Objektidentität. Ein Vorbeleg-Effekt, der an dieser Identität
   * hinge, liefe mitten im Tippen los und ersetzte den Wortlaut durch den Serverstand.
   * Der Effekt hängt deshalb an der Öffnung und an der stabilen Kennung.
   */
  it('lässt den getippten Wortlaut stehen, wenn die Matrix unter dem offenen Dialog nachlädt', async () => {
    const { rerender } = rendereMatrix({
      matrix: [zelle({ warnstufe: 'hoch', beschreibung: 'alter Stand' })],
    });
    const feld = await oeffneDetails('hoch');
    await userEvent.clear(feld);
    await userEvent.type(feld, 'Dachstuhl brennt');
    rerender(matrixElement({
      matrix: [zelle({ warnstufe: 'akut', beschreibung: 'vom Server' })],
    }));
    expect(screen.getByLabelText('Beschreibung')).toHaveValue('Dachstuhl brennt');
  });
});

/**
 * Die KURZE ACHSE des Zell-Auslösers folgt der Dichte (LFH-368 · B5h).
 *
 * WARUM ES DIESEN BLOCK GIBT: die Prüfliste begründet ihr „erfüllt" bei Kriterium 1
 * ausdrücklich mit `style={{ minWidth: token.controlHeight }}` — WCAG 2.5.8 fordert
 * 24 × 24 px, nicht 24 hoch, und der Inhalt des Knopfes ist ein EINZELNER Buchstabe
 * („N", „M", „H", „A"). Ohne die Angabe fällt die Breite auf die Textbreite plus
 * Polsterung und damit unter den Boden. Gemessen im Abschluss-Review: die Zeile ließ
 * sich streichen, ohne dass ein einziger der 59 Fälle in `pages/gefahren/` und den
 * beiden Guards rot wurde. Eine Zusicherung in Prosa ist keine.
 *
 * WARUM NICHT AM QUELLTEXT wie die `sticky`-Zusicherung in
 * `components/katalogTabelle.guard.test.ts`: dort gibt es kein gerendertes Gegenstück,
 * `position: sticky` hat in jsdom keine Wirkung. Ein INLINE-STYLE dagegen steht im Baum
 * und ist lesbar. Der Quelltext-Weg wäre hier zudem SCHWÄCHER — ein dichteblindes
 * `minWidth: 30` bestünde jedes Muster, das nach der Zeile sucht, und wäre in der
 * Handschuh-Stufe genau der Fehler, für dessen Abbau B5h existiert. Deshalb steht die
 * Ungleichheit über zwei Stufen neben den Böden; die Schablone ist
 * `etb/SlashMenu.test.tsx:92-122` (LFH-365 · B5e).
 *
 * WAS ER BELEGT UND WAS NICHT: die ABSICHT, nicht das Pixel. jsdom rechnet kein Layout;
 * die tatsächlich gerenderte Trefffläche misst erst Playwright mit `boundingBox()` und
 * steht als Zeile 1/2 der Prüfliste offen (LFH-373). Wer hier mehr hineinliest, liest
 * falsch.
 *
 * NICHT `renderMitProviders`: `test/utils.tsx` mountet ein nacktes `ConfigProvider` ohne
 * Theme, jeder Token wäre dort eine antd-Vorgabe und die Zusicherung eine Attrappe.
 */
function ausloeserBreite(dichte: Dichte): string {
  const { container, unmount } = render(
    <ConfigProvider theme={{ token: antdToken(farbenHell, dichte) }}>
      {matrixElement()}
    </ConfigProvider>,
  );
  const knopf = container.querySelector<HTMLElement>('button[aria-label^="Bewertung "]');
  if (!knopf) throw new Error('kein Zell-Auslöser im Baum — die Matrix hat sich geändert');
  const breite = knopf.style.minWidth;
  unmount();
  return breite;
}

describe('GefahrenMatrix — die kurze Achse des Zell-Auslösers folgt der Dichte (LFH-368 · B5h)', () => {
  /**
   * Ein hartkodiertes `minWidth: 30` bliebe über beide Stufen byte-gleich. Diese Zeile ist
   * neben den Böden unten nicht überflüssig, sondern macht sie erst beweiskräftig: eine
   * Schranke kann nicht belegen, dass der Wert AUS DER STUFE kommt.
   */
  it('zieht die Breite bei einer Dichteumschaltung mit', () => {
    expect(ausloeserBreite('handschuh')).not.toBe(ausloeserBreite('kompakt'));
  });

  /**
   * Die Dichte-Staffel als Literale hingeschrieben — NICHT aus `token.controlHeight`
   * zurückgelesen, sonst prüfte die Zusicherung den Token gegen sich selbst. Jede der
   * drei Stufen liegt damit zugleich über dem WCAG-2.5.8-Boden von 24 px.
   */
  it.each([
    ['kompakt', 30],
    ['komfortabel', 48],
    ['handschuh', 72],
  ] as const)('erreicht in %s den Trefflächenboden von %i px', (dichte, boden) => {
    expect(parseFloat(ausloeserBreite(dichte))).toBeGreaterThanOrEqual(boden);
  });
});
