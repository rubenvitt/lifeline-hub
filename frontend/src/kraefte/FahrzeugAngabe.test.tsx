import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { EinsatzFahrzeug } from '../api/types';
import { renderMitProviders } from '../test/utils';
import { oeffne, waehle } from '../test/auswahlListe';
import FahrzeugAngabe, { type FahrzeugAngabeProps } from './FahrzeugAngabe';

const FAHRZEUGE = [
  { id: 5, funkrufname: '83-1', fahrzeugtyp: 'RTW', einheit_id: 10 },
  { id: 6, funkrufname: '46-1', fahrzeugtyp: 'HLF', einheit_id: 20 },
  { id: 7, funkrufname: '19-1', fahrzeugtyp: null, einheit_id: null },
] as EinsatzFahrzeug[];
const EINHEITEN = [
  { id: 10, name: 'Rettungsstaffel' },
  { id: 20, name: 'Zug 1' },
];

function angabe(p: Partial<FahrzeugAngabeProps> = {}) {
  const onSpeichern = p.onSpeichern ?? vi.fn().mockResolvedValue(undefined);
  renderMitProviders(
    <FahrzeugAngabe
      kennung="Anna"
      wert={null}
      einheitId={10}
      fahrzeuge={FAHRZEUGE}
      einheiten={EINHEITEN}
      darfSchreiben
      {...p}
      onSpeichern={onSpeichern}
    />,
  );
  return onSpeichern;
}

const FELD = 'Fahrzeug zu Anna';

/** Gruppenköpfe und Optionen der offenen Liste in Bildschirmfolge. */
function listenFolge(): string[] {
  return [
    ...document.querySelectorAll<HTMLElement>(
      '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item',
    ),
  ].map((k) => k.textContent ?? '');
}

describe('FahrzeugAngabe (LLH-1060)', () => {
  it('bietet die Fahrzeuge der eigenen Einheit zuerst an', async () => {
    angabe();
    await userEvent.click(screen.getByRole('button', { name: 'Fahrzeug zu Anna eintragen' }));
    await oeffne(FELD);
    expect(listenFolge()).toEqual([
      'Einheit «Rettungsstaffel»',
      '83-1 (RTW)',
      'Weitere Fahrzeuge',
      '46-1 (HLF)',
      '19-1',
    ]);
  });

  it('speichert neuen und alten Wert erst auf „Speichern“', async () => {
    const onSpeichern = angabe({ wert: 7 });
    await userEvent.click(screen.getByRole('button', { name: 'Fahrzeug zu Anna bearbeiten' }));
    await waehle(FELD, '83-1 (RTW)');
    expect(onSpeichern).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Fahrzeug zu Anna speichern' }));
    await waitFor(() => expect(onSpeichern).toHaveBeenCalledWith(5, 7));
  });

  it('kennzeichnet ein Fahrzeug einer anderen Einheit, ohne Farbe', () => {
    angabe({ wert: 6, darfSchreiben: false });
    expect(screen.getByText('46-1')).toBeVisible();
    const marke = screen.getByText('andere Einheit');
    expect(marke.closest('.ant-tag')).not.toBeNull();
    expect(marke.closest('.ant-tag')!.className).not.toMatch(/ant-tag-(red|blue|green|orange)/);
  });

  it('ohne Marke auf einem Fahrzeug der eigenen Einheit oder ohne Einheit', () => {
    angabe({ wert: 5, darfSchreiben: false });
    expect(screen.queryByText('andere Einheit')).toBeNull();
  });

  it('ohne Schreibrecht und ohne Fahrzeug: „—“ ohne Knopf', () => {
    angabe({ darfSchreiben: false });
    expect(screen.getByText('—')).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
