import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider } from 'antd';
import { renderMitProviders } from '../../test/utils';
import { antdToken, farbenHell, type Dichte } from '../../theme/tokens';
import GefahrenMatrix, {
  SPALTEN_FREIRAUM,
  ZELLE_UNBEWERTET,
  setzeSpaltenFreiraum,
  type GefahrenMatrixProps,
  zellBalkenStil,
} from './GefahrenMatrix';
import type { GefahrBewertung } from '../../api/types';
import { GEFAHRENTYPEN, SCHUTZOBJEKTE, kombinationGueltig } from './gefahrenSchema';

const zelle = (over: Partial<GefahrBewertung>): GefahrBewertung => ({
  id: 1,
  gefahrengebiet_id: 7,
  gefahrentyp: 'brand',
  schutzobjekt: 'menschen',
  warnstufe: 'hoch',
  beschreibung: null,
  gemeldet_von: null,
  aktualisiert_von: 1,
  erstellt_at: '',
  geaendert_at: '',
  ...over,
});

/**
 * Der Eintrag wird immer über das geöffnete Menü gegriffen: antd lässt die Portale geschlossener
 * Dropdowns im Baum stehen.
 *
 * `:not(.ant-dropdown-hidden)` genügt hier nicht: in jsdom läuft keine Bewegung zu Ende, ein
 * verlassendes Portal bleibt in `ant-slide-up-leave-active` ohne `ant-dropdown-hidden` stehen.
 * Verlässliches Merkmal ist sein `pointer-events: none`. Die Zählung ist streng, damit eine falsche
 * Annahme laut wird.
 */
function imMenue() {
  const offen = Array.from(
    document.querySelectorAll<HTMLElement>('.ant-dropdown:not(.ant-dropdown-hidden)'),
  ).filter((d) => d.style.pointerEvents !== 'none');
  if (offen.length !== 1)
    throw new Error(`genau ein offenes Menü erwartet, ${offen.length} gefunden`);
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

/**
 * Ein Ort für die Pflichtprops. Getrennt vom Rendern, weil zwei Fälle dasselbe Element mit
 * geänderter `matrix` per `rerender` nachreichen — so trifft ein Nachladen unter einem offenen
 * Dialog ein.
 */
function matrixElement(over: Partial<GefahrenMatrixProps> = {}) {
  return <GefahrenMatrix {...PFLICHT} {...over} />;
}

function rendereMatrix(over: Partial<GefahrenMatrixProps> = {}) {
  return renderMitProviders(matrixElement(over));
}

/** Öffnet den Detail-Dialog einer Zelle der Zeile Brand und wartet, bis er steht. */
async function oeffneDetails(stufe: string, spalte = 'Menschen') {
  await userEvent.click(
    screen.getByRole('button', { name: `Bewertung Brand × ${spalte}: ${stufe}` }),
  );
  await userEvent.click(imMenue().getByRole('menuitem', { name: 'Details …' }));
  return screen.findByLabelText('Beschreibung');
}

describe('GefahrenMatrix', () => {
  it('rendert 13 Zeilen × 5 Spalten', () => {
    rendereMatrix();
    expect(screen.getAllByText('Brand')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Ertrinken')[0]).toBeInTheDocument();
    // Zeuge der fünften Spalte: das volle Wort steht nur im Tooltip, im Baum steht die Kurzform.
    expect(screen.getAllByText('Kraft')[0]).toBeInTheDocument();
  });

  it('setzt eine Warnstufe über das Zellmenü und ruft onSetzen mit vollem Zell-Zustand', async () => {
    const onSetzen = vi.fn();
    rendereMatrix({ onSetzen });
    await userEvent.click(
      screen.getByRole('button', { name: 'Bewertung Brand × Menschen: nicht bewertet' }),
    );
    // Regex mit `i`: der Normalisierer von Testing Library faltet Leerraum, schreibt aber nicht
    // klein.
    await userEvent.click(imMenue().getByRole('menuitem', { name: /hoch/i }));
    await waitFor(() =>
      expect(onSetzen).toHaveBeenCalledWith({
        gefahrentyp: 'brand',
        schutzobjekt: 'menschen',
        warnstufe: 'hoch',
        beschreibung: null,
        gemeldet_von: null,
      }),
    );
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
    await waitFor(() =>
      expect(onSetzen).toHaveBeenCalledWith({
        gefahrentyp: 'brand',
        schutzobjekt: 'menschen',
        warnstufe: 'akut',
        beschreibung: 'Dachstuhl',
        gemeldet_von: 'KdoW',
      }),
    );
  });

  it('sperrt beim laufenden PUT NUR die betroffene Zelle, nicht die anderen 57', () => {
    rendereMatrix({ laufendeZelle: 'brand×menschen' });
    // antd klont den Auslöser mit `disabled` — die Prop am Dropdown erreicht wirklich den Knopf.
    expect(
      screen.getByRole('button', { name: 'Bewertung Brand × Menschen: nicht bewertet' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Bewertung Brand × Tiere: nicht bewertet' }),
    ).toBeEnabled();
  });

  it('zeigt die Stufe als Kürzel — die Fläche allein wäre der einzige Kanal', () => {
    rendereMatrix({ matrix: [zelle({ warnstufe: 'akut' })] });
    const knopf = screen.getByRole('button', { name: 'Bewertung Brand × Menschen: akut' });
    expect(knopf).toHaveTextContent('A');
  });

  /**
   * LFH-969: „keine" ist eine Meldung, eine gültige Zelle ohne Bewertung eine Lücke. Mit dem alten
   * Rückfall `?? 'keine'` hießen beide „keine" und zeigten beide „–" — dann wird dieser Fall rot.
   */
  it('trennt „nicht bewertet" von „keine" im Zeichen, im Namen und an der Zelle', () => {
    rendereMatrix({ matrix: [zelle({ warnstufe: 'keine' })] });

    const keine = screen.getByRole('button', { name: 'Bewertung Brand × Menschen: keine' });
    expect(keine).toHaveTextContent('–');
    expect(keine.closest('td')).toHaveAttribute('data-warnstufe', 'keine');

    const offen = screen.getByRole('button', { name: 'Bewertung Brand × Tiere: nicht bewertet' });
    expect(offen.textContent).toBe(ZELLE_UNBEWERTET.kuerzel);
    expect(offen.textContent).not.toBe('–');
    expect(offen.closest('td')).toHaveAttribute('data-warnstufe', 'unbewertet');

    // „n. a." bleibt, wie es war: Text, kein Knopf.
    expect(screen.getByLabelText('Atemgifte × Sachwerte: nicht anwendbar')).toHaveTextContent(
      'n. a.',
    );
  });

  it('nennt über der Matrix alle Zellzeichen und zählt die unbewerteten Felder', () => {
    rendereMatrix({
      matrix: [zelle({ warnstufe: 'keine' }), zelle({ id: 2, schutzobjekt: 'tiere' })],
    });
    const legende = screen.getByRole('note', { name: 'Legende der Matrix' });
    for (const teil of ['– keine', 'N niedrig', 'M mittel', 'H hoch', 'A akut']) {
      expect(legende).toHaveTextContent(teil);
    }
    expect(legende).toHaveTextContent('leer unbewertet');
    expect(legende).toHaveTextContent('n. a. nicht anwendbar');
    // 58 gültige Felder, zwei bewertet — „keine" zählt als bewertet.
    expect(screen.getByText(/Felder unbewertet/)).toHaveTextContent('56 Felder unbewertet');
  });

  it('zählt ein einzelnes unbewertetes Feld in der Einzahl und meldet die volle Matrix', () => {
    const alle = GEFAHRENTYPEN.flatMap((g, i) =>
      SCHUTZOBJEKTE.filter((o) => kombinationGueltig(g.wert, o.wert)).map((o, j) =>
        zelle({ id: i * 10 + j, gefahrentyp: g.wert, schutzobjekt: o.wert, warnstufe: 'keine' }),
      ),
    );
    const { rerender } = rendereMatrix({ matrix: alle.slice(1) });
    expect(screen.getByText('1 Feld unbewertet')).toBeInTheDocument();
    rerender(matrixElement({ matrix: alle }));
    expect(screen.getByText('Alle Felder bewertet')).toBeInTheDocument();
  });

  it('behauptet beim Laden weder „nicht bewertet" noch eine Zahl und sperrt die Zellen', () => {
    rendereMatrix({ laedt: true });
    expect(screen.queryByRole('button', { name: /nicht bewertet$/ })).toBeNull();
    expect(screen.queryByText(/Felder unbewertet/)).toBeNull();
    expect(screen.getByText('Bewertungen laden …')).toBeInTheDocument();
    const zelle = screen.getByRole('button', { name: 'Bewertung Brand × Menschen: lädt' });
    expect(zelle).toBeDisabled();
    expect(zelle.closest('td')).not.toHaveAttribute('data-warnstufe');
  });

  it('hält den Detail-Wortlaut, wenn das Speichern abgelehnt wird', async () => {
    const onDetailsSpeichern = vi.fn().mockRejectedValue(new Error('422'));
    rendereMatrix({ matrix: [zelle({ warnstufe: 'hoch' })], onDetailsSpeichern });
    const feld = await oeffneDetails('hoch');
    await userEvent.type(feld, 'Dachstuhl brennt');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onDetailsSpeichern).toHaveBeenCalled());
    // Zugesichert ist nur: nicht geleert. „Nicht geschlossen" ist in jsdom nicht beobachtbar
    // (`.ant-modal-wrap` bleibt auch nach erfolgreichem Speichern im Baum).
    expect(await screen.findByLabelText('Beschreibung')).toHaveValue('Dachstuhl brennt');
  });

  /**
   * Die Vorbelegung selbst. Vertauscht man die beiden Effekte in `GefahrenZelleDetails`, liest der
   * Vorbeleg-Effekt eine leere Ref — der Bediener sähe ein leeres Feld, tippte nach und
   * überschriebe die vorhandene Beschreibung. Die Nachbarfälle fangen das nicht: sie tippen ihren
   * Text selbst bzw. lesen die Stufe aus `matrix`.
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
   * Gegenrichtung: eine Zelle ohne Bestand trägt nicht den Rest der vorigen. Dass `kennung` in den
   * Abhängigkeiten des Vorbeleg-Effekts steht, belegt `GefahrenZelleDetails.test.tsx` — über die
   * Matrix ist ein Zellwechsel nur mit Schließen dazwischen erreichbar.
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
   * Das verlorene Update: der Dialog zeigt die Warnstufe nicht, schickt sie aber mit. Hielte er die
   * Zelle als Momentaufnahme vom Menüklick, schriebe „Speichern" eine inzwischen gesetzte Stufe
   * still zurück. Der `rerender` ist der Nachladefall unter offenem Dialog.
   */
  it('speichert die AKTUELLE Warnstufe, nicht die beim Öffnen gesehene', async () => {
    const onDetailsSpeichern = vi.fn().mockResolvedValue(undefined);
    const { rerender } = rendereMatrix({
      matrix: [zelle({ warnstufe: 'hoch' })],
      onDetailsSpeichern,
    });
    await oeffneDetails('hoch');
    rerender(matrixElement({ matrix: [zelle({ warnstufe: 'akut' })], onDetailsSpeichern }));
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(onDetailsSpeichern).toHaveBeenCalledWith({
        gefahrentyp: 'brand',
        schutzobjekt: 'menschen',
        warnstufe: 'akut',
        beschreibung: null,
        gemeldet_von: null,
      }),
    );
  });

  /**
   * Kehrseite des Falls darüber: die Zelle hat nach jedem Nachladen eine neue Identität. Ein
   * Vorbeleg-Effekt daran liefe mitten im Tippen los; er hängt deshalb an Öffnung und Kennung.
   */
  it('lässt den getippten Wortlaut stehen, wenn die Matrix unter dem offenen Dialog nachlädt', async () => {
    const { rerender } = rendereMatrix({
      matrix: [zelle({ warnstufe: 'hoch', beschreibung: 'alter Stand' })],
    });
    const feld = await oeffneDetails('hoch');
    await userEvent.clear(feld);
    await userEvent.type(feld, 'Dachstuhl brennt');
    rerender(
      matrixElement({
        matrix: [zelle({ warnstufe: 'akut', beschreibung: 'vom Server' })],
      }),
    );
    expect(screen.getByLabelText('Beschreibung')).toHaveValue('Dachstuhl brennt');
  });
});

/**
 * Die kurze Achse des Zell-Auslösers folgt der Dichte. Der Knopf trägt nur einen Buchstaben; ohne
 * `minWidth: token.controlHeight` fiele die Breite unter den WCAG-2.5.8-Boden.
 *
 * Geprüft am gerenderten Inline-Style statt am Quelltext: ein dichteblindes `minWidth: 30` bestünde
 * jedes Quelltext-Muster. Belegt ist die Absicht, nicht das Pixel — die Trefffläche misst
 * `e2e/gate3-trefflaeche.spec.ts`. Nicht `renderMitProviders`: dessen nacktes `ConfigProvider`
 * liefert nur antd-Vorgaben.
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
   * Ein hartkodiertes `minWidth: 30` bliebe über beide Stufen gleich — erst dieser Fall belegt,
   * dass der Wert aus der Stufe kommt.
   */
  it('zieht die Breite bei einer Dichteumschaltung mit', () => {
    expect(ausloeserBreite('handschuh')).not.toBe(ausloeserBreite('kompakt'));
  });

  /**
   * Die Staffel als Literale, nicht aus `token.controlHeight` zurückgelesen — sonst prüfte der
   * Token sich selbst. Jede Stufe liegt über dem WCAG-Boden von 24 px.
   */
  it.each([
    ['kompakt', 30],
    ['komfortabel', 48],
    ['handschuh', 72],
  ] as const)('erreicht in %s den Trefflächenboden von %i px', (dichte, boden) => {
    expect(parseFloat(ausloeserBreite(dichte))).toBeGreaterThanOrEqual(boden);
  });
});

describe('GefahrenMatrix — Warnstufenbalken (Neuentwurf)', () => {
  it('zellBalkenStil: ohne Farbe kein Balken, sonst 3 px unten als Innenschatten', () => {
    expect(zellBalkenStil(null)).toEqual({});
    expect(zellBalkenStil('red')).toEqual({ boxShadow: 'inset 0 -3px 0 0 red' });
  });

  it('trägt den Balken an einer bewerteten Zelle und keinen an einer unbewerteten', () => {
    const { container } = rendereMatrix({ matrix: [zelle({ warnstufe: 'hoch' })] });
    const bewertet = container.querySelector<HTMLElement>('td[data-warnstufe="hoch"]');
    expect(bewertet, 'die bewertete Zelle trägt ihre Stufe').not.toBeNull();
    expect(bewertet!.style.boxShadow).toMatch(/^inset 0(px)? -3px 0(px)? 0(px)? /);
    // Gegenprobe: ohne Warnstufe kein Balken — sonst wäre die erste Aussage auch mit einem
    // unbedingten Schatten wahr.
    const leer = container.querySelector<HTMLElement>('td[data-warnstufe="unbewertet"]');
    expect(leer).not.toBeNull();
    expect(leer!.style.boxShadow).toBe('');
    expect(leer!.style.backgroundColor).toBe('');
  });
});

describe('GefahrenMatrix — Fokusabstand zur fixierten Spalte (LFH-373)', () => {
  /**
   * Beim Fokus-Scroll hält der Scrollcontainer die Breite der fixierten Spalte frei
   * (`scroll-padding-inline-start`, `gefahrenMatrix.css`). Die Breite wird gemessen, nicht aus der
   * Konstante gelesen: mit `max-content` wächst die Spalte mit der Dichte.
   */
  it('setzeSpaltenFreiraum schreibt die gemessene Breite der fixierten Kopfzelle', () => {
    const wurzel = document.createElement('div');
    const kopf = document.createElement('th');
    kopf.className = 'ant-table-cell ant-table-cell-fix-start';
    Object.defineProperty(kopf, 'offsetWidth', { value: 254 });
    wurzel.append(kopf);
    setzeSpaltenFreiraum(wurzel);
    expect(wurzel.style.getPropertyValue(SPALTEN_FREIRAUM)).toBe('254px');
  });

  it('ohne fixierte Spalte ist der Freiraum 0 — nicht ein alter Wert', () => {
    const wurzel = document.createElement('div');
    wurzel.style.setProperty(SPALTEN_FREIRAUM, '254px');
    setzeSpaltenFreiraum(wurzel);
    expect(wurzel.style.getPropertyValue(SPALTEN_FREIRAUM)).toBe('0px');
  });

  it('die gerenderte Matrix trägt Klasse und Freiraum an der Tabellenwurzel', () => {
    const { container } = render(
      <ConfigProvider theme={{ token: antdToken(farbenHell, 'kompakt') }}>
        {matrixElement()}
      </ConfigProvider>,
    );
    const wurzel = container.querySelector<HTMLElement>('.ant-table-wrapper.gefahren-matrix');
    expect(wurzel, 'die Matrix trägt ihre Klasse').not.toBeNull();
    expect(wurzel!.style.getPropertyValue(SPALTEN_FREIRAUM)).toMatch(/^\d+px$/);
  });

  /**
   * Rückwärts getabbt rollt der Browser eine Zelle unter die stehende Kopfzeile; die Matrix nutzt
   * dieselbe Mechanik wie `KatalogTabelle` (`--lfh-tabellenkopf-hoehe` + `scroll-margin-top`).
   * jsdom misst 0 px — geprüft wird, dass die Variable gesetzt wird.
   */
  it('setzt den Kopf-Freiraum an der Tabellenwurzel', () => {
    const { container } = render(
      <ConfigProvider theme={{ token: antdToken(farbenHell, 'kompakt') }}>
        {matrixElement()}
      </ConfigProvider>,
    );
    const wurzel = container.querySelector<HTMLElement>('.ant-table-wrapper.gefahren-matrix');
    expect(wurzel).not.toBeNull();
    expect(wurzel!.style.getPropertyValue('--lfh-tabellenkopf-hoehe')).toMatch(/^\d+px$/);
  });
});
