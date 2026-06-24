import { it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderMitProviders } from '../../test/utils';
import BildPlatzierenPanel from './BildPlatzierenPanel';

const ECKEN = [[9,50],[9.1,50],[9.1,49.9],[9,49.9]] as const;

it('Center-Koordinateneingabe verschiebt alle Ecken', () => {
  const onChange = vi.fn();
  renderMitProviders(
    <BildPlatzierenPanel einsatzId={7} ecken={ECKEN as never} onChange={onChange} onFertig={() => {}} />,
  );
  const input = screen.getByPlaceholderText('Koordinate eingeben'); // KoordinatenEingabe (Center)
  fireEvent.change(input, { target: { value: '50.0, 9.5' } }); // WGS84 "lat, lon"
  fireEvent.blur(input);
  expect(onChange).toHaveBeenCalled();
  const neueEcken = onChange.mock.calls[onChange.mock.calls.length - 1][0];
  // center.lng verschob sich Richtung 9.5
  const cLng = (neueEcken[0][0] + neueEcken[1][0] + neueEcken[2][0] + neueEcken[3][0]) / 4;
  expect(cLng).toBeCloseTo(9.5, 3);
});
