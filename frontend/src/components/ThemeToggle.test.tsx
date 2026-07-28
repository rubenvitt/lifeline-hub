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
import ThemeToggle from './ThemeToggle';

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
