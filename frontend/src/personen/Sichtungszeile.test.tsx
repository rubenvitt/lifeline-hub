import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
import Sichtungszeile from './Sichtungszeile';

/**
 * Die Sichtungszeile über der Betroffenenliste (LFH-963, design.md D5): Zahlen aus
 * `sichtungsbild`, Zahl vor Wort, SK I–IV und tot immer, „unverletzt“ und „ohne Sichtung“ nur mit
 * Bestand, die Summe heißt „gesamt“.
 */
const p = (aktuelle_sichtung: 'sk1' | 'sk2' | 'sk3' | 'sk4' | 'tot' | 'unverletzt' | null) => ({
  aktuelle_sichtung,
});

function eintraege() {
  return within(screen.getByRole('list', { name: 'Sichtungszahlen' }))
    .getAllByRole('listitem')
    .map((li) => li.textContent);
}

describe('Sichtungszeile', () => {
  it('nennt Summe und je Kategorie die Zahl vor dem Wort', () => {
    renderMitProviders(<Sichtungszeile alle={[p('sk1'), p('sk1'), p('sk3'), p(null)]} />);
    expect(eintraege()).toEqual([
      '4 gesamt',
      '2 SK I',
      '0 SK II',
      '1 SK III',
      '0 SK IV',
      '0 tot',
      '1 ohne Sichtung',
    ]);
  });

  it('lässt „unverletzt“ und „ohne Sichtung“ ohne Bestand weg, SK I–IV und tot nie', () => {
    renderMitProviders(<Sichtungszeile alle={[]} />);
    expect(eintraege()).toEqual(['0 gesamt', '0 SK I', '0 SK II', '0 SK III', '0 SK IV', '0 tot']);
  });
});
