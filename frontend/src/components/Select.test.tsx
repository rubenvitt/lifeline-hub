import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import { Select } from './Select';

// value ≠ label, damit Label- von Wert-Filterung unterscheidbar ist.
const OPTIONEN = [
  { value: '1', label: 'Apfel' },
  { value: '2', label: 'Banane' },
];

describe('Select (projektweiter Combobox-Wrapper, LFH-288)', () => {
  it('filtert ohne eigenes showSearch standardmäßig per Tippen nach dem sichtbaren Label', async () => {
    renderMitProviders(<Select options={OPTIONEN} style={{ width: 200 }} />);
    const box = screen.getByRole('combobox');
    await userEvent.click(box);
    expect(await screen.findByText('Apfel')).toBeInTheDocument();
    expect(screen.getByText('Banane')).toBeInTheDocument();

    // 'ban' matcht nur das Label 'Banane'. Würde (antd-Default) nach value gefiltert, träfe
    // 'ban' keinen der Werte '1'/'2' → nichts sichtbar. Beweist optionFilterProp:'label'.
    await userEvent.type(box, 'ban');
    expect(await screen.findByText('Banane')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Apfel')).not.toBeInTheDocument());
  });

  it('lässt die Suche aus, wenn der Aufrufer showSearch={false} setzt (Opt-out überlebt)', async () => {
    renderMitProviders(<Select showSearch={false} options={OPTIONEN} style={{ width: 200 }} />);
    const box = screen.getByRole('combobox');
    await userEvent.click(box);
    expect(await screen.findByText('Apfel')).toBeInTheDocument();

    // Tippen darf NICHT filtern (Single-Select ohne Suche → input read-only) → beide bleiben.
    await userEvent.type(box, 'ban');
    expect(screen.getByText('Apfel')).toBeInTheDocument();
    expect(screen.getByText('Banane')).toBeInTheDocument();
  });

  it('ersetzt den Default vollständig durch die eigene showSearch-Config (kein Merge)', async () => {
    // Leeres Objekt: Suche AN (isObject), optionFilterProp fällt auf antd-Default 'value'.
    // Würde der Label-Default hineingemischt, filterte 'apf' nach Label → nichts sichtbar. Bei
    // reiner Ersetzung filtert 'apf' nach value → 'apfel' matcht → 'Frucht Eins' bleibt.
    const wertOptionen = [
      { value: 'apfel', label: 'Frucht Eins' },
      { value: 'banane', label: 'Frucht Zwei' },
    ];
    renderMitProviders(<Select showSearch={{}} options={wertOptionen} style={{ width: 200 }} />);
    const box = screen.getByRole('combobox');
    await userEvent.click(box);
    await userEvent.type(box, 'apf');
    expect(await screen.findByText('Frucht Eins')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Frucht Zwei')).not.toBeInTheDocument());
  });
});
