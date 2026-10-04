import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
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

// ── Zufluss-Schleuse (LFH-867) ──────────────────────────────────────────────────────

let setzeStand: (wurzeln: K[], kopf?: ReactNode) => void = () => {};

/** Das Gerüst mit einem Stand, den der Test von außen „live“ ändert. */
function Buehne({ start }: { start: K[] }) {
  const [stand, setStand] = useState<{ wurzeln: K[]; kopf: ReactNode }>({
    wurzeln: start,
    kopf: <div data-testid="kopf">Stab 1</div>,
  });
  setzeStand = (wurzeln, kopf) => setStand((alt) => ({ wurzeln, kopf: kopf ?? alt.kopf }));
  return (
    <>
      <button type="button">draußen</button>
      <HaengenderBaum<K>
        bezeichnung="Testbaum"
        kopf={stand.kopf}
        wurzeln={stand.wurzeln}
        zugeklappt={new Set()}
        onUmschalten={() => {}}
        knotenName={(x) => x.name}
        inhalt={(x) => (
          <a href={`#${x.key}`} data-testid={`inhalt-${x.key}`}>
            {x.name}
          </a>
        )}
      />
    </>
  );
}

const START = [k('a', [k('a1')]), k('b')];
const live = (wurzeln: K[], kopf?: ReactNode) => act(() => setzeStand(wurzeln, kopf));
const bereich = () => screen.getByRole('region', { name: 'Testbaum' });
const stand = () => document.querySelector('[data-lfh="org-stand"]') as HTMLElement;
const banner = () => screen.queryByRole('status');

describe('HaengenderBaum — Zufluss-Schleuse', () => {
  it('ohne Zeiger und Fokus geht der frische Stand sofort durch', () => {
    renderMitProviders(<Buehne start={START} />);
    expect(stand()).toHaveTextContent('Live');
    live([...START, k('c')]);
    expect(screen.getByTestId('inhalt-c')).toBeInTheDocument();
    expect(banner()).toBeNull();
  });

  it('der Zeiger hält einen Zugang zurück, der Inhalt fließt, der Banner nennt ihn', () => {
    renderMitProviders(<Buehne start={START} />);
    fireEvent.pointerEnter(bereich(), { pointerType: 'mouse' });
    expect(stand()).toHaveTextContent('Live pausiert');
    live([k('a', [k('a1', [], { name: 'A1 neu' })]), k('b'), k('c')]);
    expect(screen.queryByTestId('inhalt-c')).toBeNull();
    expect(screen.getByTestId('inhalt-a1')).toHaveTextContent('A1 neu');
    expect(banner()).toHaveTextContent('1 neu');
    expect(within(stand()).getByRole('status')).toBe(banner());
  });

  it('ein umgehängter Knoten bleibt am alten Ort, bis der Zeiger geht', () => {
    renderMitProviders(<Buehne start={START} />);
    fireEvent.pointerEnter(bereich(), { pointerType: 'mouse' });
    live([k('a'), k('b', [k('a1')])]);
    const spalteA = screen
      .getByTestId('inhalt-a')
      .closest('[data-lfh="org-spalte"]') as HTMLElement;
    expect(within(spalteA).getByTestId('inhalt-a1')).toBeInTheDocument();
    expect(banner()).toHaveTextContent('1 umgehängt');
    fireEvent.pointerLeave(bereich(), { pointerType: 'mouse' });
    const spalteB = screen
      .getByTestId('inhalt-b')
      .closest('[data-lfh="org-spalte"]') as HTMLElement;
    expect(within(spalteB).getByTestId('inhalt-a1')).toBeInTheDocument();
    expect(banner()).toBeNull();
    expect(stand()).toHaveTextContent('Live');
  });

  it('Touch schließt nicht; die erste Bewegung holt ein verpasstes Betreten nach', () => {
    renderMitProviders(<Buehne start={START} />);
    fireEvent.pointerEnter(bereich(), { pointerType: 'touch' });
    fireEvent.pointerMove(bereich(), { pointerType: 'touch' });
    live([...START, k('c')]);
    expect(screen.getByTestId('inhalt-c')).toBeInTheDocument();
    fireEvent.pointerMove(bereich(), { pointerType: 'mouse' });
    live([...START, k('c'), k('d')]);
    expect(screen.queryByTestId('inhalt-d')).toBeNull();
  });

  it('der Fokus hält; ein Wechsel innerhalb nicht schadet, ein Ziel außerhalb öffnet', () => {
    renderMitProviders(<Buehne start={START} />);
    const a = screen.getByTestId('inhalt-a');
    act(() => a.focus());
    live([...START, k('c')]);
    expect(screen.queryByTestId('inhalt-c')).toBeNull();
    act(() => screen.getByTestId('inhalt-b').focus());
    expect(screen.queryByTestId('inhalt-c')).toBeNull();
    act(() => screen.getByRole('button', { name: 'draußen' }).focus());
    expect(screen.getByTestId('inhalt-c')).toBeInTheDocument();
  });

  it('„anzeigen“ übernimmt den Live-Stand und lässt den Fokus im Bereich', async () => {
    renderMitProviders(<Buehne start={START} />);
    fireEvent.pointerEnter(bereich(), { pointerType: 'mouse' });
    live([...START, k('c')]);
    await userEvent.click(within(stand()).getByRole('button', { name: 'anzeigen' }));
    expect(screen.getByTestId('inhalt-c')).toBeInTheDocument();
    expect(banner()).toBeNull();
    expect(stand()).toHaveFocus();
    // Gehalten wird ab jetzt der neue Stand.
    live([...START, k('c'), k('d')]);
    expect(screen.queryByTestId('inhalt-d')).toBeNull();
  });

  it('ein entfallener Knoten steht als Text ohne Link mit „entfallen“', () => {
    renderMitProviders(<Buehne start={START} />);
    fireEvent.pointerEnter(bereich(), { pointerType: 'mouse' });
    live([k('a', [k('a1')])]);
    expect(screen.queryByTestId('inhalt-b')).toBeNull();
    const platz = document.querySelector('[data-lfh="org-entfallen"]') as HTMLElement;
    expect(platz).toHaveTextContent('B');
    expect(platz).toHaveTextContent('entfallen');
    expect(within(platz).queryByRole('link')).toBeNull();
    expect(banner()).toHaveTextContent('1 entfallen');
  });

  it('der Kopf steht still, bis die Schleuse öffnet', () => {
    renderMitProviders(<Buehne start={START} />);
    fireEvent.pointerEnter(bereich(), { pointerType: 'mouse' });
    live(START, <div data-testid="kopf">Stab 2</div>);
    expect(screen.getByTestId('kopf')).toHaveTextContent('Stab 1');
    fireEvent.pointerLeave(bereich(), { pointerType: 'mouse' });
    expect(screen.getByTestId('kopf')).toHaveTextContent('Stab 2');
  });

  it('im Druck stehen Baum und Kopf frisch, danach hält die Schleuse wieder', () => {
    renderMitProviders(<Buehne start={START} />);
    fireEvent.pointerEnter(bereich(), { pointerType: 'mouse' });
    live([...START, k('c')], <div data-testid="kopf">Stab 2</div>);
    act(() => {
      window.dispatchEvent(new Event('beforeprint'));
    });
    expect(screen.getByTestId('inhalt-c')).toBeInTheDocument();
    expect(screen.getByTestId('kopf')).toHaveTextContent('Stab 2');
    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
    expect(screen.queryByTestId('inhalt-c')).toBeNull();
  });

  it('ein leerer Baum schließt nicht: der erste Zugang erscheint sofort', () => {
    renderMitProviders(<Buehne start={[]} />);
    fireEvent.pointerEnter(bereich(), { pointerType: 'mouse' });
    live([k('a')]);
    expect(screen.getByTestId('inhalt-a')).toBeInTheDocument();
    expect(banner()).toBeNull();
  });

  it('verschwindet der fokussierte Knoten ohne `focusout`, öffnet das Sicherheitsnetz', () => {
    renderMitProviders(<Buehne start={START} />);
    act(() => screen.getByTestId('inhalt-a').focus());
    live([...START, k('c')]);
    expect(screen.queryByTestId('inhalt-c')).toBeNull();
    // Wie WebKit: der fokussierte Knoten geht, ohne dass ein `focusout` ankommt.
    act(() => {
      const ziel = screen.getByTestId('inhalt-a');
      ziel.blur = () => {};
      ziel.remove();
    });
    live([...START, k('c'), k('d')]);
    expect(screen.getByTestId('inhalt-d')).toBeInTheDocument();
  });
});
