import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { farbenHell } from '../theme/tokens';
import EinsatzZeichen, { ZEICHEN_UNTERLAGE } from './EinsatzZeichen';

describe('EinsatzZeichen', () => {
  it('rendert für ein darstellbares Fachobjekt genau ein svg in der verlangten Größe', () => {
    const { container } = render(
      <EinsatzZeichen
        tz={{ grundzeichen: 'taktische-formation', organisation: 'thw' }}
        size={22}
      />,
    );
    const svgs = container.querySelectorAll('svg');
    expect(svgs).toHaveLength(1);
    expect(svgs[0].getAttribute('width')).toBe('22');
  });

  it('rendert nichts, wenn nicht einmal der Körper darstellbar ist', () => {
    const { container } = render(
      <EinsatzZeichen tz={{ grundzeichen: 'gibt-es-nicht' as 'person' }} size={22} />,
    );
    expect(container.querySelector('svg')).toBeNull();
  });

  it('vergibt in einer Liste keine id doppelt', () => {
    const tz = { grundzeichen: 'taktische-formation', organisation: 'feuerwehr' } as const;
    const { container } = render(
      <>
        <EinsatzZeichen tz={tz} size={22} />
        <EinsatzZeichen tz={tz} size={22} />
      </>,
    );
    const ids = [...container.querySelectorAll('[id]')].map((e) => e.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // LFH-1120: Zeichen ohne Organisation zeichnet die Bibliothek mit schwarzem Umriss ohne Fläche;
  // die Unterlage hebt sie im Nachtbetrieb vom Grund ab (Messung im e2e „Zeichenkontrast“).
  it('legt auf Wunsch die helle Unterlage unter das Zeichen, ohne die Größe zu ändern', () => {
    const { container } = render(
      <EinsatzZeichen tz={{ grundzeichen: 'taktische-formation' }} size={22} unterlage />,
    );
    const svg = container.querySelector('svg')!;
    expect(ZEICHEN_UNTERLAGE).toBe(farbenHell.flaeche);
    expect(svg).toHaveStyle({ backgroundColor: farbenHell.flaeche });
    expect(svg.getAttribute('width')).toBe('22');
  });

  it('trägt ohne Wunsch keine Unterlage', () => {
    const { container } = render(
      <EinsatzZeichen tz={{ grundzeichen: 'taktische-formation' }} size={22} />,
    );
    const svg = container.querySelector('svg')!;
    expect(svg.style.backgroundColor).toBe('');
  });
});
