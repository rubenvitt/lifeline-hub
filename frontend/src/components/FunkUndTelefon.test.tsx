import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { KommunikationsVerbindung, Sprechgruppe } from '../api/types';
import { renderMitProviders } from '../test/utils';
import { Datenraster } from './instrument';
import FunkUndTelefon from './FunkUndTelefon';

const sg = (id: number, bezeichnung: string, betriebsart: 'TMO' | 'DMO'): Sprechgruppe => ({
  id,
  einsatz_id: 1,
  einsatz_lokal: false,
  bezeichnung,
  betriebsart,
  hinweis: null,
  aktiv: true,
  sortier: id,
});
const vb = (
  id: number,
  mittel: KommunikationsVerbindung['mittel'],
  wert: string,
  hinweis: string | null = null,
): KommunikationsVerbindung => ({ id, mittel, wert, hinweis });

function zeige(p: Parameters<typeof FunkUndTelefon>[0]) {
  return renderMitProviders(
    <Datenraster spalten={1} beschriftung="Angaben">
      <FunkUndTelefon {...p} />
    </Datenraster>,
  );
}

/** Die Zelle eines Datenfelds (`dd`) zu seinem Etikett (`dt`). */
function feld(label: string): HTMLElement {
  const dt = screen.getByText(label, { selector: 'dt' });
  return dt.closest('[data-lfh="datenfeld"]') as HTMLElement;
}

describe('FunkUndTelefon (LLH-1134)', () => {
  it('Funk und Telefon stehen getrennt: Rufname und Sprechgruppen unter „Funk“, Nummern unter „Telefon“', () => {
    zeige({
      rufname: 'Rotkreuz Musterstadt 1/10-1',
      sprechgruppen: [sg(1, '412_F_DRK', 'TMO'), sg(2, 'DMO 31', 'DMO')],
      verbindungen: [vb(1, 'mobil', '0170 1234567', 'nur tagsüber'), vb(2, 'festnetz', '0511 22')],
    });
    const funk = feld('Funk');
    expect(funk).toHaveTextContent('Rotkreuz Musterstadt 1/10-1');
    expect(funk).toHaveTextContent('TMO 412_F_DRK');
    expect(funk).toHaveTextContent('DMO 31');
    expect(funk).not.toHaveTextContent('0170');

    const telefon = feld('Telefon');
    expect(within(telefon).getByRole('link', { name: '0170 1234567' })).toHaveAttribute(
      'href',
      'tel:01701234567',
    );
    expect(telefon).toHaveTextContent('Mobil');
    expect(telefon).toHaveTextContent('nur tagsüber');
    expect(telefon).toHaveTextContent('Festnetz');
    expect(telefon).not.toHaveTextContent('412_F_DRK');
  });

  it('andere Verbindungen stehen unter „Weitere Verbindungen“, nie unter „Telefon“', () => {
    zeige({
      sprechgruppen: [],
      verbindungen: [vb(1, 'email', 'elw@example.org'), vb(2, 'melder', '4711')],
    });
    expect(within(feld('Weitere Verbindungen')).getByRole('link')).toHaveAttribute(
      'href',
      'mailto:elw@example.org',
    );
    expect(feld('Weitere Verbindungen')).toHaveTextContent('Melder');
    expect(feld('Telefon')).toHaveTextContent('—');
  });

  it('leer: „—“ in beiden Zeilen, keine Zeile „Weitere Verbindungen“', () => {
    zeige({ sprechgruppen: [], verbindungen: [] });
    expect(feld('Funk')).toHaveTextContent('—');
    expect(feld('Telefon')).toHaveTextContent('—');
    expect(screen.queryByText('Weitere Verbindungen')).not.toBeInTheDocument();
  });

  it('nurGefuellt: leere Zeilen entfallen', () => {
    zeige({ sprechgruppen: [], verbindungen: [vb(1, 'mobil', '0170 1')], nurGefuellt: true });
    expect(screen.queryByText('Funk', { selector: 'dt' })).not.toBeInTheDocument();
    expect(feld('Telefon')).toHaveTextContent('0170 1');
  });

  it('kein Wort „Erreichbarkeit“', () => {
    const { container } = zeige({
      rufname: 'Florian 1',
      sprechgruppen: [sg(1, '311', 'TMO')],
      verbindungen: [vb(1, 'mobil', '0170 1')],
    });
    expect(container.textContent).not.toMatch(/erreichbar/i);
  });
});
