/**
 * Die zwei Achsen des Kopfzeilen-Umschalters (LFH-329 · B1).
 *
 * Der Umschalter trägt seit B1 Farbschema UND Bediendichte. Beide sind
 * Radiogruppen im selben Teilbaum, und genau daraus entsteht die Falle, die
 * dieser Test pinnt: zwei Radiogruppen OHNE eigenen `name` gruppieren im
 * Browser nativ zusammen — ein Klick in der einen löscht dann die Auswahl der
 * anderen. antd vergibt seit v6 je Gruppe einen abgeleiteten Namen, weshalb die
 * Kollision hier nicht greift. Das ist eine Zusage der Bibliothek, keine
 * unseres Codes; sie gehört deshalb festgenagelt.
 *
 * Gemessen wird bis ans `<html>` durch, nicht nur am Zustand der Komponente:
 * eine Auswahl, die den Umschalter markiert, aber das Merkmal am Wurzelelement
 * nicht setzt, ließe das handgeschriebene CSS auf der Ausgangsstufe stehen.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeModeProvider } from '../theme/ThemeModeProvider';
import { dichten } from '../theme/tokens';
import ThemeToggle, { segmentedMasse } from './ThemeToggle';

function zeige() {
  return render(
    <ThemeModeProvider>
      <ThemeToggle />
    </ThemeModeProvider>,
  );
}

/**
 * Wählt eine Option über ihre Beschriftung.
 *
 * NICHT über das Bedienelement selbst: antd legt das Eingabeelement unsichtbar
 * unter die Beschriftung, und ein direkter Klick scheitert an dessen
 * abgeschalteten Zeigerereignissen (gemessen). Der Weg über die Beschriftung ist
 * zugleich der, den ein Mensch nimmt.
 */
async function waehle(titel: string) {
  await userEvent.click(screen.getByRole('radio', { name: titel }).closest('label')!);
}

// `src/test/setup.ts` räumt den Speicher, nicht das Merkmalsverzeichnis am
// `<html>`: ohne diesen Aufräumer erbte der nächste Test die zuletzt geklickte
// Stufe, und seine Anfangsbehauptung wäre eine Attrappe.
afterEach(() => {
  delete document.documentElement.dataset.dichte;
  delete document.documentElement.dataset.theme;
});

describe('ThemeToggle — zwei Achsen in einer Kopfzeile (LFH-329 · B1)', () => {
  it('trägt beide Umschalter, jeden mit eigener Beschriftung', () => {
    zeige();
    expect(screen.getByRole('radiogroup', { name: 'Farbschema wählen' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Bediendichte wählen' })).toBeInTheDocument();
  });

  it('die Wahl einer Stufe führt bis ans <html> durch', async () => {
    zeige();
    await waehle('Handschuh');
    expect(document.documentElement.dataset.dichte).toBe('handschuh');
  });

  it('die Theme-Auswahl überlebt einen Klick im Dichte-Schalter', async () => {
    zeige();
    await waehle('Dunkel');
    expect(document.documentElement.dataset.theme).toBe('dark');

    await waehle('Komfortabel');
    expect(document.documentElement.dataset.dichte).toBe('komfortabel');
    // Die Kernbehauptung: der Klick in der Dichte-Gruppe hat die Theme-Gruppe
    // nicht entwählt — weder am Wurzelelement noch am Bedienelement selbst.
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('radio', { name: 'Dunkel' })).toBeChecked();
  });

  it('die Dichte-Achse bietet alle drei Stufen an', () => {
    // Alle drei sichtbar, nicht bloß zwei plus Kommandopalette: A1 weist dem
    // Führungs-Tablet ausdrücklich `komfortabel` und `handschuh` zu, und eine
    // Stufe ohne sichtbaren Bedienweg ist praktisch keine.
    zeige();
    for (const titel of ['Kompakt', 'Komfortabel', 'Handschuh']) {
      expect(screen.getByRole('radio', { name: titel }), titel).toBeInTheDocument();
    }
    expect(screen.getByRole('radio', { name: 'Kompakt' })).toBeChecked();
  });
});

/**
 * Das Segment-ZIEL, nicht der Track (LFH-370 · B5j).
 *
 * antd leitet am Segmented zwei Maße NICHT aus `controlHeight` ab: `trackPadding` steht
 * per Vorgabe auf 2, und `controlPaddingHorizontal` ist eine harte Konstante 12. Gemessen
 * hieß das 26×38 / 44×38 / 68×38 gegen die Gate-3-Böden 24 / 48 / 72 — die Vorgabestufe
 * hielt, und ausgerechnet die beiden Stufen für Finger und Handschuh fielen durch.
 *
 * Die Böden stehen als LITERALE da, nicht aus `dichten` zurückgelesen — sonst prüfte die
 * Zusicherung den Token gegen sich selbst.
 */
describe('ThemeToggle · Segmentmaße', () => {
  const ZIEL = (d: keyof typeof dichten) => {
    const m = segmentedMasse({
      controlHeight: dichten[d].zeilenhoehe,
      lineWidth: 1,
      controlPaddingHorizontal: 12,
    });
    return {
      hoehe: dichten[d].zeilenhoehe - 2 * m.trackPadding,
      breite: 16 + 2 * (m.controlPaddingHorizontal - 1),
    };
  };

  it('hebt Hoehe UND Breite des Ziels auf den Boden der Stufe', () => {
    expect(ZIEL('kompakt')).toEqual({ hoehe: 30, breite: 38 });
    expect(ZIEL('komfortabel')).toEqual({ hoehe: 48, breite: 48 });
    expect(ZIEL('handschuh')).toEqual({ hoehe: 72, breite: 72 });
  });

  it('laesst die Breite mit der Stufe wachsen, statt bei 38 zu kleben', () => {
    // Die eigentliche Aussage: ohne die Korrektur steht hier dreimal 38.
    expect(ZIEL('kompakt').breite).toBeLessThan(ZIEL('komfortabel').breite);
    expect(ZIEL('komfortabel').breite).toBeLessThan(ZIEL('handschuh').breite);
  });

  it('laesst die kompakte Stufe nicht SCHRUMPFEN', () => {
    // Der 12er-Boden kommt aus dem Token selbst: die Rechnung allein ergaebe dort 8 und
    // machte das Ziel von 38 auf 30 px schmaler, wo die Breite ohnehin reichlich ist.
    expect(segmentedMasse({ controlHeight: 30, lineWidth: 1, controlPaddingHorizontal: 12 }))
      .toEqual({ trackPadding: 0, controlPaddingHorizontal: 12 });
  });

  it('reicht beide Masse an antd durch — der Tokenname muss einer sein, den es kennt', () => {
    /**
     * T1 oben beweist eine RECHNUNG, nicht dass antd die zwei Namen honoriert. Genau daran
     * scheitert der naheliegende Irrweg: `segmentedPaddingHorizontal` ist der interne Name
     * aus `segmented/style/index.js`, bietet sich beim Lesen der Quelle als erstes an —
     * und geht wirkungslos durch.
     *
     * Gemessen wird der von cssinjs erzeugte CSS-Text, verankert an der `css-var-…`-Klasse
     * GENAU dieses Segmenteds. Ohne diese Verankerung färbte ein Segmented aus einem
     * früheren Test derselben Datei den Nachweis grün.
     */
    localStorage.setItem('lifeline-hub.dichte', 'handschuh');
    zeige();
    const gruppe = screen.getByRole('radiogroup', { name: 'Bediendichte wählen' });
    const scope = [...gruppe.classList].find((k) => k.startsWith('css-var-'));
    expect(scope, 'antd vergibt dem lokalen Provider eine eigene Variablen-Klasse').toBeTruthy();

    const css = [...document.querySelectorAll('style')].map((s) => s.textContent ?? '').join('');
    const regel = css.match(new RegExp(`\\.${scope}\\.ant-segmented\\{([^}]*)\\}`))?.[1] ?? '';
    expect(regel, 'trackPadding kommt an').toContain('--ant-segmented-track-padding:0px');
    expect(regel, 'die Breite kommt an — 29 ist der Handschuh-Wert').toContain(
      '--ant-control-padding-horizontal:29px',
    );
  });
});
