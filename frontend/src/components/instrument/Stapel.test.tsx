import { render, screen } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import { describe, expect, it } from 'vitest';
import { antdToken, dichten, farbenHell, type Dichte } from '../../theme/tokens';
import Stapel, { type Abstandsstufe } from './Stapel';

function mitDichte(dichte: Dichte, inhalt: React.ReactNode) {
  return render(
    <ConfigProvider theme={{ token: antdToken(farbenHell, dichte) }}>{inhalt}</ConfigProvider>,
  );
}

describe('Stapel (Spec `abstandsraster`, „Stapel nehmen nur Rasterstufen")', () => {
  it('reiht ohne Angabe senkrecht mit Abstand `sm`', () => {
    mitDichte(
      'kompakt',
      <Stapel>
        <span>a</span>
      </Stapel>,
    );
    const el = screen.getByText('a').parentElement!;
    expect(el).toHaveStyle({ display: 'flex', flexDirection: 'column', gap: '8px' });
    expect(el.style.minWidth).toBe('0px');
  });

  it.each<[Dichte, Abstandsstufe]>([
    ['kompakt', 'xxs'],
    ['kompakt', 'xs'],
    ['kompakt', 'sm'],
    ['kompakt', 'md'],
    ['kompakt', 'lg'],
    ['kompakt', 'xl'],
    ['komfortabel', 'md'],
    ['komfortabel', 'xl'],
    ['handschuh', 'sm'],
    ['handschuh', 'lg'],
  ])('liest in %s die Stufe %s aus dem Raster', (dichte, stufe) => {
    mitDichte(
      dichte,
      <Stapel abstand={stufe}>
        <span>b</span>
      </Stapel>,
    );
    expect(screen.getByText('b').parentElement!.style.gap).toBe(
      `${dichten[dichte].abstand[stufe]}px`,
    );
  });

  it('reiht mit `richtung="zeile"` waagerecht, mit Umbruch und Ausrichtung', () => {
    mitDichte(
      'kompakt',
      <Stapel richtung="zeile" umbruch ausrichten="baseline" verteilen="between">
        <span>c</span>
      </Stapel>,
    );
    expect(screen.getByText('c').parentElement).toHaveStyle({
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'baseline',
      justifyContent: 'space-between',
    });
  });

  it('wächst mit `wachsen` in seinen Elternstapel', () => {
    mitDichte(
      'kompakt',
      <Stapel wachsen>
        <span>d</span>
      </Stapel>,
    );
    expect(screen.getByText('d').parentElement).toHaveStyle({ flexGrow: '1', flexBasis: '0px' });
  });

  it('nimmt mit `als` ein anderes Element', () => {
    mitDichte(
      'kompakt',
      <Stapel als="ul" aria-label="Liste">
        <li>e</li>
      </Stapel>,
    );
    const liste = screen.getByRole('list', { name: 'Liste' });
    expect(liste.tagName).toBe('UL');
    expect(liste).toHaveStyle({ margin: '0px', padding: '0px', listStyle: 'none' });
  });

  it('nimmt keine Zahl als Abstand und keinen Stil an', () => {
    // @ts-expect-error — eine Zahl ist keine Rasterstufe
    void (<Stapel abstand={12}>x</Stapel>);
    // @ts-expect-error — kein `style`: der Abstand kommt nur aus dem Raster
    void (<Stapel style={{ gap: 12 }}>x</Stapel>);
  });
});
