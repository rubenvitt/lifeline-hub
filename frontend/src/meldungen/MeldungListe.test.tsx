import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
import MeldungListe from './MeldungListe';

describe('MeldungListe — Leerzustand (LFH-331 · B3)', () => {
  /**
   * Der Wortlaut bleibt byte-gleich; getauscht wird der Knoten. Deshalb steht die
   * Text-Zusicherung neben der Knoten-Zusicherung: allein wäre sie vor dem Umbau
   * genauso grün gewesen und belegte nichts.
   *
   * Keine Primäraktion: die Liste ist rein darstellend — die Erfassung liegt auf der
   * Seite darüber, nicht in dieser Komponente.
   */
  it('zeigt den Leertext über das Leer-Primitiv, ohne antds Leer-Element', () => {
    const { container } = renderMitProviders(<MeldungListe meldungen={[]} einsatzId={7} />);
    expect(screen.getByText('Keine Meldungen')).toBeInTheDocument();
    expect(container.querySelector('.ant-empty')).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
