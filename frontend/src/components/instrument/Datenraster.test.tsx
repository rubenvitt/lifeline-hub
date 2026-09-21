import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import { farbenHell } from '../../theme/tokens';
import Datenraster, { Datenfeld } from './Datenraster';
import { DATENRASTER_MINDESTBREITE, datenfeldStil, datenrasterStil } from './datenrasterStil';

const token = { paddingSM: 8, padding: 12, marginXXS: 2 };

describe('Datenraster', () => {
  it('ist eine Begriffsliste: Begriff als dt, Wert als dd', () => {
    renderMitProviders(
      <Datenraster beschriftung="Kopfdaten">
        <Datenfeld label="Funkrufname" mono>
          Florian 1/44-1
        </Datenfeld>
        <Datenfeld label="Beschreibung">Keller vollgelaufen</Datenfeld>
      </Datenraster>,
    );
    const liste = screen.getByLabelText('Kopfdaten');
    expect(liste.tagName).toBe('DL');
    expect(screen.getByText('Funkrufname').tagName).toBe('DT');
    expect(screen.getByText('Florian 1/44-1').tagName).toBe('DD');
  });

  it('setzt Mono nur, wo das Feld es verlangt', () => {
    renderMitProviders(
      <Datenraster>
        <Datenfeld label="Nr." mono>
          S-7
        </Datenfeld>
        <Datenfeld label="Ort">Hauptstr.</Datenfeld>
      </Datenraster>,
    );
    expect(screen.getByText('S-7').style.fontFamily).toContain('JetBrains Mono');
    expect(screen.getByText('Hauptstr.').style.fontFamily).toBe('');
  });

  it('Fugenraster auf linie, Spalten gedeckelt und mit Mindestbreite', () => {
    const stil = datenrasterStil(farbenHell, 4);
    expect(stil).toMatchObject({ gap: 1, background: farbenHell.linie });
    expect(String(stil.gridTemplateColumns)).toContain('calc((100% - 3px) / 4)');
    expect(String(stil.gridTemplateColumns)).toContain(`${DATENRASTER_MINDESTBREITE}px`);
    // Unsinnige Spaltenzahl fällt auf eine Spalte, statt eine kaputte Vorlage zu bauen.
    expect(String(datenrasterStil(farbenHell, 0).gridTemplateColumns)).toContain(
      'calc((100% - 0px) / 1)',
    );
  });

  it('Zelle auf flaeche; breit zieht über alle Spalten', () => {
    expect(datenfeldStil(farbenHell, token, false)).toMatchObject({
      background: farbenHell.flaeche,
      paddingBlock: 8,
      paddingInline: 12,
    });
    expect(datenfeldStil(farbenHell, token, false).gridColumn).toBeUndefined();
    expect(datenfeldStil(farbenHell, token, true).gridColumn).toBe('1 / -1');
  });
});
