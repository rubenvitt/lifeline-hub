import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderMitProviders } from '../../test/utils';
import Sichtungslegende from './Sichtungslegende';

describe('Sichtungslegende (LFH-648)', () => {
  it('nennt alle sieben Kategorien mit Kürzel und Wort — die Farbe ist nie der einzige Kanal', () => {
    renderMitProviders(<Sichtungslegende />);
    const liste = screen.getByRole('list', { name: 'Sichtungslegende' });
    const eintraege = within(liste).getAllByRole('listitem');
    expect(eintraege.map((e) => e.textContent)).toEqual([
      'ISK I · akut',
      'IISK II · schwer',
      'IIISK III · leicht',
      'IVSK IV · abwartend',
      'Ttot · verstorben',
      'Uunverletzt · ohne Verletzung',
      '–ohne Sichtung',
    ]);
  });

  it('das Farbfeld ist Dekoration: kein eigenes Vorleseziel, trägt aber die Markerfarbe', () => {
    renderMitProviders(<Sichtungslegende />);
    const feld = document.querySelector('[data-sichtung-feld="sk1"]') as HTMLElement;
    expect(feld.closest('[aria-hidden="true"]')).not.toBeNull();
    // jsdom normalisiert die Farbe zu rgb(); SK I ist `sichtungsfarben.rot` (#f5222d).
    expect(feld.style.background).toBe('rgb(245, 34, 45)');
  });
});
