import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Schrift from './Schrift';
import Feldetikett from './Feldetikett';
import { farbenDunkel } from '../../theme/tokens';
import { ConfigProvider, theme } from 'antd';

function dunkel(ui: React.ReactNode) {
  return render(
    <ConfigProvider
      theme={{ algorithm: theme.darkAlgorithm, token: { colorBgBase: farbenDunkel.grund } }}
    >
      {ui}
    </ConfigProvider>,
  );
}

describe('Schrift — Text in einer Rolle der Skala (LLH-1775)', () => {
  it('setzt Größe als Variable der Stufe, Familie und gleich breite Ziffern', () => {
    render(<Schrift rolle="meta">Stand 14:32</Schrift>);
    const el = screen.getByText('Stand 14:32');
    expect(el.tagName).toBe('SPAN');
    expect(el.style.fontSize).toBe('var(--lfh-groesse-klein)');
    expect(el.style.fontFamily).toMatch(/^"LFH Archivo"/);
    expect(el.style.fontVariantNumeric).toBe('tabular-nums');
  });

  it('nimmt Element und Ton', () => {
    dunkel(
      <Schrift rolle="text" als="p" ton="gedaempft">
        Lauftext
      </Schrift>,
    );
    const el = screen.getByText('Lauftext');
    expect(el.tagName).toBe('P');
    expect(el.style.margin).toBe('0px');
    expect(el.style.color).not.toBe('');
  });
});

describe('Feldetikett — gemischt geschrieben, Stufe klein, Ton gedaempft (LLH-1776)', () => {
  it('ohne Versalien und ohne Sperrung, in der Stufe klein', () => {
    dunkel(<Feldetikett>Einsatzort</Feldetikett>);
    const el = screen.getByText('Einsatzort');
    expect(el.style.textTransform).toBe('');
    expect(el.style.letterSpacing).toBe('');
    expect(el.style.fontSize).toBe('var(--lfh-groesse-klein)');
    expect(el.style.fontFamily).toMatch(/^"LFH Archivo"/);
    expect(el.getAttribute('data-lfh')).toBe('feldetikett');
  });

  it('trägt den Ton gedaempft, nicht schwach', () => {
    dunkel(<Feldetikett>Ort</Feldetikett>);
    const farbe = screen.getByText('Ort').style.color;
    const probe = document.createElement('span');
    probe.style.color = farbenDunkel.gedaempft;
    expect(farbe).toBe(probe.style.color);
  });

  it('als dt oder label mit htmlFor', () => {
    dunkel(
      <dl>
        <Feldetikett als="dt">Begriff</Feldetikett>
        <dd>Wert</dd>
      </dl>,
    );
    expect(screen.getByText('Begriff').tagName).toBe('DT');
    dunkel(
      <Feldetikett als="label" htmlFor="feld-1">
        Name
      </Feldetikett>,
    );
    const label = screen.getByText('Name');
    expect(label.tagName).toBe('LABEL');
    expect(label.getAttribute('for')).toBe('feld-1');
  });
});
