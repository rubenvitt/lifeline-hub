/**
 * Wann der Seitenkopf klebt (zjt7c073 D3, Spec `einsatztauglichkeit-layout`, „Der Rahmen bleibt
 * beim Rollen erreichbar“). jsdom rechnet kein Layout: Höhen kommen aus `offsetHeight`, das der
 * Test setzt; das gerenderte Kleben misst `e2e/rahmen-stehen-bleiben.spec.ts`.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  KLEBEN_HOECHSTENS,
  seitenkopfKlebtImFenster,
  useSeitenkopfKleben,
} from './seitenkopfKleben';
import { readKopfOben, readRahmenOben } from './rahmenOben';
import { setzeViewportBreite, setzeViewportZurueck } from '../test/viewport';

const fensterHoeheVorher = window.innerHeight;

function setzeFensterHoehe(hoehe: number) {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: hoehe });
}

function Seitenkopf({ hoehe, vorgabe }: { hoehe: number; vorgabe?: boolean }) {
  const { klebt, ref } = useSeitenkopfKleben<HTMLDivElement>(vorgabe);
  return (
    <div
      data-testid="kopf"
      data-klebt={klebt ? 'ja' : 'nein'}
      ref={(el) => {
        if (el) Object.defineProperty(el, 'offsetHeight', { configurable: true, value: hoehe });
        ref(el);
      }}
    />
  );
}

function klebt() {
  return screen.getByTestId('kopf').dataset.klebt === 'ja';
}

beforeEach(() => setzeFensterHoehe(900));
afterEach(() => {
  setzeViewportZurueck();
  setzeFensterHoehe(fensterHoeheVorher);
});

describe('seitenkopfKlebtImFenster', () => {
  it('klebt bis genau ein Drittel der Fensterhöhe, darüber nicht', () => {
    expect(KLEBEN_HOECHSTENS).toBeCloseTo(1 / 3);
    expect(seitenkopfKlebtImFenster({ kopf: 56, seitenkopf: 45, fenster: 900 })).toBe(true);
    expect(seitenkopfKlebtImFenster({ kopf: 100, seitenkopf: 200, fenster: 900 })).toBe(true);
    expect(seitenkopfKlebtImFenster({ kopf: 100, seitenkopf: 201, fenster: 900 })).toBe(false);
  });

  it('ohne gemessenes Fenster klebt nichts', () => {
    expect(seitenkopfKlebtImFenster({ kopf: 0, seitenkopf: 45, fenster: 0 })).toBe(false);
  });
});

describe('useSeitenkopfKleben', () => {
  it('ab md klebt ein passender Seitenkopf und zählt zum Rahmen, nicht zum Kopf', () => {
    render(<Seitenkopf hoehe={45} />);
    expect(klebt()).toBe(true);
    expect(readRahmenOben()).toBe(45);
    expect(readKopfOben()).toBe(0);
  });

  it('unter md klebt er nicht und meldet keine Höhe', () => {
    setzeViewportBreite(500);
    render(<Seitenkopf hoehe={45} />);
    expect(klebt()).toBe(false);
    expect(readRahmenOben()).toBe(0);
  });

  it('nimmt er mehr als ein Drittel der Fensterhöhe, rollt er mit', () => {
    setzeFensterHoehe(520);
    render(<Seitenkopf hoehe={180} />);
    expect(klebt()).toBe(false);
    expect(readRahmenOben()).toBe(0);
  });

  it('in einem eigenen Scrollbereich (Gerätehülle) klebt er nicht', () => {
    render(
      <main style={{ overflowY: 'auto' }}>
        <Seitenkopf hoehe={45} />
      </main>,
    );
    expect(klebt()).toBe(false);
  });

  it('eine Vorgabe von außen gilt in beide Richtungen (ETB)', () => {
    const { unmount } = render(<Seitenkopf hoehe={45} vorgabe={false} />);
    expect(klebt()).toBe(false);
    expect(readRahmenOben()).toBe(0);
    unmount();
    setzeFensterHoehe(300);
    render(<Seitenkopf hoehe={180} vorgabe />);
    expect(klebt()).toBe(true);
    expect(readRahmenOben()).toBe(180);
  });
});
