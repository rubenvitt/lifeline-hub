/**
 * Oberkante der stehenden Alarme (LFH-1112). jsdom rechnet kein Layout: die Unterkanten kommen
 * hier aus einem gesetzten `getBoundingClientRect`; die gerenderte Lage samt Rollen misst
 * `e2e/alarm-verdeckung.spec.ts`.
 */
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALARM_ABSTAND, ALARM_OBEN_VAR, alarmOben, useAlarmKante } from './alarmOben';

function Quelle({ unten }: { unten: number }) {
  const ref = useAlarmKante<HTMLDivElement>();
  return (
    <div
      ref={(el) => {
        if (el) el.getBoundingClientRect = () => ({ bottom: unten }) as DOMRect;
        ref(el);
      }}
    />
  );
}

function variable() {
  return document.documentElement.style.getPropertyValue(ALARM_OBEN_VAR);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('alarmOben', () => {
  it('nimmt die unterste Kante und hängt den Abstand an', () => {
    expect(alarmOben([52, 98], 52)).toBe(98 + ALARM_ABSTAND);
  });

  it('eine weggerollte Quelle zählt nicht, der klebende Rahmen trägt', () => {
    expect(alarmOben([52, -40], 52)).toBe(52 + ALARM_ABSTAND);
  });

  it('ohne Rahmen und mit weggerollten Quellen steht der Alarm am Fensterrand', () => {
    expect(alarmOben([-10, -60], 0)).toBe(ALARM_ABSTAND);
    expect(alarmOben([], 0)).toBe(ALARM_ABSTAND);
  });

  it('rundet Subpixel-Kanten', () => {
    expect(alarmOben([96.6], 0)).toBe(97 + ALARM_ABSTAND);
  });

  it('Quellen schreiben die Kante vor dem ersten Bild und räumen sie beim Aushängen', () => {
    const { rerender, unmount } = render(
      <>
        <Quelle unten={52} />
        <Quelle unten={104} />
      </>,
    );
    expect(variable()).toBe(`${104 + ALARM_ABSTAND}px`);

    rerender(<Quelle unten={52} />);
    act(() => {
      // Das Aushängen der zweiten Quelle plant die Rechnung fürs nächste Bild.
      window.dispatchEvent(new Event('scroll'));
    });
    return new Promise<void>((fertig) =>
      requestAnimationFrame(() => {
        expect(variable()).toBe(`${52 + ALARM_ABSTAND}px`);
        unmount();
        expect(variable()).toBe('');
        fertig();
      }),
    );
  });
});
