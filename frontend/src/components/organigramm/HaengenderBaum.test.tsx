import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../../test/utils';
import { dichten } from '../../theme/tokens';
import HaengenderBaum, {
  SPALTE_MIN_PX,
  baumZielStil,
  klappbareSchluessel,
  type BaumKnoten,
} from './HaengenderBaum';

interface K extends BaumKnoten<K> {
  name: string;
  gruppe?: boolean;
}

const k = (key: string, kinder: K[] = [], p: Partial<K> = {}): K => ({
  key,
  name: key.toUpperCase(),
  kinder,
  ...p,
});

/** Eine Kette von sechs Ebenen unter der ersten Spalte, daneben eine zweite Spalte und ein Blatt. */
const tief = k('t1', [k('t2', [k('t3', [k('t4', [k('t5', [k('t6')])])])])]);
const WURZELN = [k('a', [k('a1'), tief]), k('b'), k('s', [k('s1')], { gruppe: true })];

function baum(zugeklappt: ReadonlySet<string> = new Set(), onUmschalten = vi.fn()) {
  const utils = renderMitProviders(
    <HaengenderBaum<K>
      bezeichnung="Testbaum"
      kopf={<div data-testid="kopf">Wurzel</div>}
      wurzeln={WURZELN}
      zugeklappt={zugeklappt}
      onUmschalten={onUmschalten}
      knotenName={(x) => x.name}
      gruppe={(x) => (x.gruppe ? 'Sammel' : null)}
      inhalt={(x, tiefe) => <span data-testid={`inhalt-${x.key}`}>{`${x.name}@${tiefe}`}</span>}
    />,
  );
  return { ...utils, onUmschalten };
}

describe('HaengenderBaum — Aufbau', () => {
  it('zeigt Kopf und Inhalte, die Wurzeln als Spalten der ersten Ebene', () => {
    const { container } = baum();
    expect(screen.getByRole('region', { name: 'Testbaum' })).toBeInTheDocument();
    expect(screen.getByTestId('kopf')).toHaveTextContent('Wurzel');
    const ebene1 = container.querySelector('[data-lfh="org-ebene1"]') as HTMLElement;
    expect(ebene1.style.gridTemplateColumns).toContain(`${SPALTE_MIN_PX}px`);
    const spalten = ebene1.querySelectorAll(':scope > [data-lfh="org-spalte"]');
    expect(spalten).toHaveLength(3);
    expect(screen.getByTestId('inhalt-a')).toHaveTextContent('A@0');
    expect(screen.getByTestId('inhalt-a1')).toHaveTextContent('A1@1');
  });

  it('hängt Kinder senkrecht unter ihren Knoten', () => {
    baum();
    const spalteA = screen.getByTestId('inhalt-a').closest('[data-lfh="org-spalte"]')!;
    expect(within(spalteA as HTMLElement).getByTestId('inhalt-a1')).toBeInTheDocument();
    expect(within(spalteA as HTMLElement).queryByTestId('inhalt-b')).toBeNull();
  });

  it('gibt Blättern einen Platzhalter statt eines Klappziels', () => {
    baum();
    const blatt = screen.getByTestId('inhalt-b').closest('[data-lfh="org-knoten"]')!;
    expect(blatt.querySelector('[data-lfh="org-klappen-platz"]')).not.toBeNull();
    expect(blatt.querySelector('[data-lfh="org-klappen"]')).toBeNull();
  });

  it('rückt ab Tiefe 4 nicht weiter ein, die Linie bleibt', () => {
    baum();
    const liste = (key: string) => document.getElementById(`org-kinder-${key}`) as HTMLElement;
    expect(liste('t3').style.marginInlineStart).not.toBe('0px');
    expect(liste('t5').style.marginInlineStart).toBe('0px');
    expect(liste('t5').style.borderInlineStart).not.toBe('');
  });

  it('fasst einen Knoten als benannte Gruppe, wenn `gruppe` einen Namen liefert', () => {
    baum();
    const gruppe = screen.getByRole('group', { name: 'Sammel' });
    expect(within(gruppe).getByTestId('inhalt-s1')).toBeInTheDocument();
  });
});

describe('HaengenderBaum — Klappen', () => {
  it('trägt den Zustand am Bedienziel und meldet den Schlüssel', async () => {
    const { onUmschalten } = baum();
    const knopf = screen.getByRole('button', { name: 'Unterstellte von A' });
    expect(knopf).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(knopf.getAttribute('aria-controls')!)).not.toBeNull();
    await userEvent.click(knopf);
    expect(onUmschalten).toHaveBeenCalledWith('a');
  });

  it('nimmt zugeklappte Kinder aus dem DOM und verweist dann auf nichts', () => {
    baum(new Set(['a']));
    const knopf = screen.getByRole('button', { name: 'Unterstellte von A' });
    expect(knopf).toHaveAttribute('aria-expanded', 'false');
    expect(knopf).not.toHaveAttribute('aria-controls');
    expect(screen.getByTestId('inhalt-a')).toBeInTheDocument();
    expect(screen.queryByTestId('inhalt-a1')).toBeNull();
  });

  it('liefert alle Schlüssel mit Kindern in Baumfolge', () => {
    expect(klappbareSchluessel(WURZELN)).toEqual(['a', 't1', 't2', 't3', 't4', 't5', 's']);
    expect(klappbareSchluessel([])).toEqual([]);
  });
});

describe('baumZielStil', () => {
  const tokenFuer = (stufe: keyof typeof dichten) => ({
    controlHeight: dichten[stufe].zeilenhoehe,
  });

  it('trägt den Boden aus controlHeight — 30 / 48 / 72 px', () => {
    expect(baumZielStil(tokenFuer('kompakt')).minHeight).toBe(30);
    expect(baumZielStil(tokenFuer('komfortabel')).minHeight).toBe(48);
    expect(baumZielStil(tokenFuer('handschuh')).minHeight).toBe(72);
    expect(baumZielStil(tokenFuer('kompakt')).display).toBe('inline-flex');
  });
});
