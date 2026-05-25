import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
import ModulStub from './ModulStub';
import { modulRegistry } from './modulRegistry';

describe('ModulStub', () => {
  it('rendert Label und Beschreibung des Moduls mit WIP-Marker', () => {
    const stab = modulRegistry.find((m) => m.key === 'stab')!;
    renderMitProviders(<ModulStub modul={stab} />);
    expect(screen.getByText(/🚧 Stab/)).toBeInTheDocument();
    expect(screen.getByText(/🚧/)).toBeInTheDocument();
    expect(screen.getByText(stab.beschreibung!)).toBeInTheDocument();
  });
});
