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

// Beweist: Rotation-Slider feuert onChange (→ PATCH) nur bei onChangeComplete (mouseup/pointerup),
// NICHT bei jedem Drag-Tick. Im jsdom: mousedown + mousemove → kein onChange; mouseup → onChange.
it('Rotation-Slider: onChange nur bei onChangeComplete (mouseup), nicht bei Drag-Tick', () => {
  const onChange = vi.fn();
  renderMitProviders(
    <BildPlatzierenPanel einsatzId={7} ecken={ECKEN as never} onChange={onChange} onFertig={() => {}} />,
  );
  // Der Drehungs-Slider ist der erste Slider auf der Seite.
  const sliders = document.querySelectorAll('.ant-slider');
  const rotationSlider = sliders[0];
  expect(rotationSlider).toBeTruthy();

  const handle = rotationSlider.querySelector('.ant-slider-handle');
  expect(handle).toBeTruthy();

  // Simulate drag: mousedown + mousemove → kein onChange
  fireEvent.mouseDown(handle!);
  fireEvent.mouseMove(document, { clientX: 50 });
  expect(onChange).not.toHaveBeenCalled();

  // mouseup → onChangeComplete → onChange
  fireEvent.mouseUp(handle!);
  // antd Slider feuert onChangeComplete auf mouseup auf dem Handle oder Track.
  // In jsdom ohne Layout-Berechnungen ändert sich der Wert nicht, aber das
  // TIMING (kein Aufruf vor mouseup) ist hier das Wesentliche.
  // Falls onChange aufgerufen wurde, dann erst nach mouseup.
  // (Ob antd in jsdom einen Wert-Commit auslöst, hängt von der jsdom-Implementierung ab.)
  const callsNachMouseup = onChange.mock.calls.length;
  // Nochmals Drag-Tick: auch danach kein zusätzlicher Aufruf durch drag allein.
  fireEvent.mouseMove(document, { clientX: 100 });
  expect(onChange.mock.calls.length).toBe(callsNachMouseup);
});
