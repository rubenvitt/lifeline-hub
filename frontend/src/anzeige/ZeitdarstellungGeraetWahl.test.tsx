import { afterEach, describe, expect, it } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import ZeitdarstellungGeraetWahl from './ZeitdarstellungGeraetWahl';
import { setzeZeitdarstellung, zeitdarstellungVergessenFuerTests } from './zeitDarstellungStore';

afterEach(() => {
  act(() => setzeZeitdarstellung(null));
  localStorage.clear();
  zeitdarstellungVergessenFuerTests();
});

describe('ZeitdarstellungGeraetWahl (LLH-1053)', () => {
  it('ohne Wahl steht „Vorgabe“; eine Wahl setzt die Darstellung dieses Geräts', async () => {
    const nutzer = userEvent.setup();
    renderMitProviders(<ZeitdarstellungGeraetWahl />);
    const gruppe = screen.getByRole('radiogroup', { name: 'Zeitdarstellung auf diesem Gerät' });
    expect(gruppe).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Vorgabe' })).toHaveAttribute('aria-checked', 'true');

    await nutzer.click(screen.getByRole('radio', { name: 'Datum und Uhrzeit' }));
    expect(localStorage.getItem('lifeline.zeitdarstellung')).toBe('datum_uhrzeit');
    expect(screen.getByRole('radio', { name: 'Datum und Uhrzeit' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await nutzer.click(screen.getByRole('radio', { name: 'Vorgabe' }));
    expect(localStorage.getItem('lifeline.zeitdarstellung')).toBeNull();
  });
});
