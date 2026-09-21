import { screen } from '@testing-library/react';
import { Input } from 'antd';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import { dichten, farbenHell } from '../../theme/tokens';
import Schnellerfassungszeile, { schnellerfassungStil } from './Schnellerfassungszeile';

describe('Schnellerfassungszeile', () => {
  it('ist nur Hülle: kein eigenes Formular, das Feld des Aufrufers steht darin', () => {
    const { container } = renderMitProviders(
      <Schnellerfassungszeile
        praefix="/anordnung"
        hinweis="↵ eintragen"
        hinweiszeile="/meldung · /lage"
      >
        <Input aria-label="Eintrag" />
      </Schnellerfassungszeile>,
    );
    // Ein <form> hier wäre ein verschachteltes Formular im Formular des Konsumenten.
    expect(container.querySelector('form')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Eintrag' })).toBeInTheDocument();
    expect(screen.getByText('/anordnung')).toHaveStyle({ color: farbenHell.bedien });
    expect(screen.getByText('↵ eintragen')).toBeInTheDocument();
    expect(screen.getByText('/meldung · /lage')).toBeInTheDocument();
  });

  it('Rahmen bedien, Grund flaeche2, Höhe mindestens 40 und nie unter der Staffel', () => {
    const stil = (s: keyof typeof dichten) =>
      schnellerfassungStil(farbenHell, { controlHeight: dichten[s].zeilenhoehe });
    expect(stil('kompakt')).toMatchObject({
      border: `1px solid ${farbenHell.bedien}`,
      background: farbenHell.flaeche2,
      minHeight: 40,
    });
    expect(stil('komfortabel').minHeight).toBe(50);
    expect(stil('handschuh').minHeight).toBe(74);
  });

  it('ohne Präfix keine Präfix-Zelle', () => {
    const { container } = renderMitProviders(
      <Schnellerfassungszeile>
        <Input aria-label="Eintrag" />
      </Schnellerfassungszeile>,
    );
    expect(container.querySelector('[data-lfh="schnellerfassung-praefix"]')).toBeNull();
  });
});
