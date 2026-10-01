import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderMitProviders } from '../../test/utils';
import type { Einsatzabschnitt } from '../../api/types';
import { OrganigrammBild } from './Organigramm';
import { baueFuehrungsorganisation } from './fuehrungsorganisation';

// Eigene Datei, weil das Modul für ALLE Tests darin ersetzt wird: hier ist kein Zeichen
// darstellbar (Spec „Taktische Zeichen als Zierde“: entfällt ohne Platzhalter).
vi.mock('../../zeichen/fachobjektZeichen', () => ({ fachobjektZeichen: () => null }));

describe('OrganigrammBild — ohne darstellbares Zeichen', () => {
  it('lässt den Zeichenplatz ganz weg', () => {
    const org = baueFuehrungsorganisation(
      [
        {
          id: 1,
          einsatz_id: 1,
          name: 'EA Nord',
          sortier: 1,
          sprechgruppen: [],
        } as Einsatzabschnitt,
      ],
      [],
    );
    const { container } = renderMitProviders(
      <OrganigrammBild
        einsatzId={1}
        org={org}
        stab={{ zustand: 'aus' }}
        zugeklappt={new Set()}
        onUmschalten={vi.fn()}
      />,
    );
    expect(screen.getByRole('link', { name: 'EA Nord' })).toBeInTheDocument();
    expect(container.querySelector('[data-lfh="org-zeichen"]')).toBeNull();
  });
});
