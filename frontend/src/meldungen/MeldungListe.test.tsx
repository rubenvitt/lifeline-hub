import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
import MeldungListe from './MeldungListe';

describe('MeldungListe — Leerzustand (LFH-331 · B3)', () => {
  /**
   * Leerzustand über das Leer-Primitiv; die Text-Zusicherung allein wäre auch mit antds
   * Leer-Element grün. Keine Primäraktion: die Erfassung liegt auf der Seite darüber.
   */
  it('zeigt den Leertext über das Leer-Primitiv, ohne antds Leer-Element', () => {
    const { container } = renderMitProviders(<MeldungListe meldungen={[]} einsatzId={7} />);
    expect(screen.getByText('Keine Meldungen')).toBeInTheDocument();
    expect(container.querySelector('.ant-empty')).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
