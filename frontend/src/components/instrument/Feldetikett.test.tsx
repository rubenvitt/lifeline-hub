import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import { farbenHell } from '../../theme/tokens';
import Feldetikett, { feldetikettStil } from './Feldetikett';

describe('Feldetikett (LLH-2045)', () => {
  it('benennt ein Feld: 12 px, gemischt geschrieben, ohne Sperrung, gedämpft', () => {
    renderMitProviders(<Feldetikett>Einsatzort</Feldetikett>);
    const el = screen.getByText('Einsatzort');
    expect(el.tagName).toBe('SPAN');
    expect(el).toHaveAttribute('data-lfh', 'feldetikett');
    expect(el.style.fontSize).toBe('12px');
    expect(el.style.textTransform).toBe('');
    expect(el.style.letterSpacing).toBe('');
    expect(el).toHaveStyle({ color: farbenHell.gedaempft });
    expect(feldetikettStil({ gedaempft: 'grau' }).color).toBe('grau');
  });

  it('als label benennt es die Eingabe über htmlFor', () => {
    renderMitProviders(
      <>
        <Feldetikett als="label" htmlFor="feld-ort">
          Einsatzort
        </Feldetikett>
        <input id="feld-ort" />
      </>,
    );
    expect(screen.getByLabelText('Einsatzort').tagName).toBe('INPUT');
  });

  it('als dt steht es im Datenraster', () => {
    renderMitProviders(
      <dl>
        <Feldetikett als="dt">Stichwort</Feldetikett>
        <dd>Brand</dd>
      </dl>,
    );
    expect(screen.getByText('Stichwort').tagName).toBe('DT');
  });
});
