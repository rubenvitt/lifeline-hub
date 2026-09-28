import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
import NachforderungListe from './NachforderungListe';

describe('NachforderungListe — Leerzustand (LFH-331 · B3)', () => {
  /**
   * Leerzustand über das Leer-Primitiv; die Text-Zusicherung allein wäre auch mit antds
   * Leer-Element grün. Keine Primäraktion: das Anfordern liegt auf der Seite darüber.
   */
  it('zeigt den Leertext über das Leer-Primitiv, ohne antds Leer-Element', () => {
    const { container } = renderMitProviders(<NachforderungListe nachforderungen={[]} />);
    expect(screen.getByText('Keine Nachforderungen')).toBeInTheDocument();
    expect(container.querySelector('.ant-empty')).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
