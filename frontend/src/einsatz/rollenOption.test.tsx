import { render, screen, within } from '@testing-library/react';
import { Select } from '../components/Select';
import { describe, expect, it } from 'vitest';
import { listeVon, oeffne } from '../test/auswahlListe';
import { rollenOptionen, rollenOptionRender } from './rollenOption';
import { EINSATZ_ROLLE, MODUL_STUFE } from './rollenVokabular';

/** Angezeigter Wert des geschlossenen Felds (antd 6: `.ant-select-content`). */
function gewaehlt(feld: string): string | null {
  const eingabe = screen.getByRole('combobox', { name: feld });
  return eingabe.closest('.ant-select')!.querySelector('.ant-select-content')?.textContent ?? null;
}

describe('rollenOptionen und rollenOptionRender (LLH-1818)', () => {
  it('trägt Wert, Namen und Darf-Zeile in der Reihenfolge des Records', () => {
    expect(rollenOptionen(EINSATZ_ROLLE)).toEqual([
      {
        value: 'einsatzleitung',
        label: 'Einsatzleitung',
        darf: 'schreibt überall, verwaltet Zugriff und Geräte',
      },
      {
        value: 'fuehrungspersonal',
        label: 'Führungspersonal',
        darf: 'schreibt in Modulen, Kopfdaten und Einstellungen',
      },
      { value: 'beobachter', label: 'Beobachter', darf: 'liest nur' },
    ]);
  });

  it('nimmt eine eigene Reihenfolge an', () => {
    expect(rollenOptionen(MODUL_STUFE, ['frei', 'admin']).map((o) => o.value)).toEqual([
      'frei',
      'admin',
    ]);
  });

  it('zeigt geschlossen nur den Namen, aufgeklappt Name und Darf-Zeile', async () => {
    render(
      <Select
        aria-label="Rolle im Einsatz"
        value="beobachter"
        options={rollenOptionen(EINSATZ_ROLLE)}
        optionRender={rollenOptionRender}
      />,
    );
    expect(gewaehlt('Rolle im Einsatz')).toBe('Beobachter');

    await oeffne('Rolle im Einsatz');
    const liste = listeVon('Rolle im Einsatz')!;
    expect(within(liste).getByText('Führungspersonal')).toBeInTheDocument();
    expect(
      within(liste).getByText('schreibt in Modulen, Kopfdaten und Einstellungen'),
    ).toBeInTheDocument();
    expect(gewaehlt('Rolle im Einsatz')).toBe('Beobachter');
  });
});
