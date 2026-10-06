import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderMitProviders } from '../test/utils';
import VollzugMeldenModal from './VollzugMeldenModal';

describe('VollzugMeldenModal — Eingabegrenze (LFH-937)', () => {
  it('nimmt höchstens 20 000 Zeichen an, wie der ETB-Inhalt', () => {
    renderMitProviders(<VollzugMeldenModal offen onAbbrechen={vi.fn()} onBestaetigen={vi.fn()} />);
    expect(screen.getByPlaceholderText('Rückmeldung zur Erledigung')).toHaveAttribute(
      'maxlength',
      '20000',
    );
  });
});
