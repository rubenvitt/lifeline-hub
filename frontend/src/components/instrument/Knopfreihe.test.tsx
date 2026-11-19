import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { Button, ConfigProvider } from 'antd';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { antdToken, dichten, farbenHell, type Dichte } from '../../theme/tokens';
import Knopfreihe from './Knopfreihe';

const viewport = vi.hoisted(() => ({ istSchmal: false }));
vi.mock('../useViewport', () => ({ useViewport: () => viewport }));

function mitDichte(dichte: Dichte, inhalt: React.ReactNode) {
  return render(
    <ConfigProvider theme={{ token: antdToken(farbenHell, dichte) }}>{inhalt}</ConfigProvider>,
  );
}

function reihe(): HTMLElement {
  return screen.getByRole('button', { name: 'A' }).parentElement!;
}

describe('Knopfreihe (LLH-1973, ein Abstand `md`)', () => {
  beforeEach(() => {
    viewport.istSchmal = false;
  });

  it.each<Dichte>(['kompakt', 'komfortabel', 'handschuh'])(
    'setzt in %s den Abstand md der aktiven Dichte',
    (dichte) => {
      mitDichte(
        dichte,
        <Knopfreihe>
          <Button>A</Button>
          <Button>B</Button>
        </Knopfreihe>,
      );
      expect(reihe().style.gap).toBe(`${dichten[dichte].abstand.md}px`);
    },
  );

  it('reiht waagerecht, bricht um und darf schrumpfen', () => {
    mitDichte(
      'kompakt',
      <Knopfreihe>
        <Button>A</Button>
      </Knopfreihe>,
    );
    expect(reihe()).toHaveStyle({
      display: 'flex',
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
    });
    expect(reihe().style.minWidth).toBe('0px');
    expect(reihe().style.justifyContent).toBe('');
  });

  it('behält die Reihenfolge der Kinder', () => {
    mitDichte(
      'kompakt',
      <Knopfreihe>
        <Button>A</Button>
        <Button type="primary">B</Button>
        <Button>C</Button>
      </Knopfreihe>,
    );
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['A', 'B', 'C']);
  });

  it('steht als Fuß ab md rechtsbündig in einer Zeile', () => {
    mitDichte(
      'kompakt',
      <Knopfreihe fuss>
        <Button>A</Button>
        <Button type="primary">B</Button>
      </Knopfreihe>,
    );
    expect(reihe()).toHaveStyle({ flexDirection: 'row', justifyContent: 'flex-end' });
  });

  it('stapelt den Fuß unter md in voller Breite, Primär bleibt zuletzt', () => {
    viewport.istSchmal = true;
    mitDichte(
      'handschuh',
      <Knopfreihe fuss>
        <Button>A</Button>
        <Button>Serie</Button>
        <Button type="primary">B</Button>
      </Knopfreihe>,
    );
    expect(reihe()).toHaveStyle({ flexDirection: 'column', alignItems: 'stretch' });
    expect(reihe().style.gap).toBe(`${dichten.handschuh.abstand.md}px`);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['A', 'Serie', 'B']);
  });

  it('stapelt eine Reihe ohne `fuss` auch unter md nicht', () => {
    viewport.istSchmal = true;
    mitDichte(
      'kompakt',
      <Knopfreihe>
        <Button>A</Button>
      </Knopfreihe>,
    );
    expect(reihe()).toHaveStyle({ flexDirection: 'row' });
  });

  it('lässt false und null ohne Lücke weg', () => {
    mitDichte(
      'kompakt',
      <Knopfreihe>
        {false}
        <Button>A</Button>
        {null}
      </Knopfreihe>,
    );
    expect(reihe().children).toHaveLength(1);
  });

  it('reicht data-lfh, className, aria-label und ref durch', () => {
    const ref = createRef<HTMLDivElement>();
    mitDichte(
      'kompakt',
      <Knopfreihe ref={ref} data-lfh="seitenkopf-aktionen" className="x" aria-label="Aktionen">
        <Button>A</Button>
      </Knopfreihe>,
    );
    expect(ref.current).toBe(reihe());
    expect(reihe()).toHaveAttribute('data-lfh', 'seitenkopf-aktionen');
    expect(reihe()).toHaveClass('x');
    expect(reihe()).toHaveAttribute('aria-label', 'Aktionen');
  });

  it('nimmt weder style noch einen Abstand an (Typ)', () => {
    const ohneStil = (
      // @ts-expect-error Knopfreihe hat kein `style`
      <Knopfreihe style={{ gap: 4 }}>
        <Button>A</Button>
      </Knopfreihe>
    );
    const ohneAbstand = (
      // @ts-expect-error Knopfreihe hat keinen eigenen Abstand
      <Knopfreihe abstand="sm">
        <Button>A</Button>
      </Knopfreihe>
    );
    expect([ohneStil, ohneAbstand]).toHaveLength(2);
  });
});
