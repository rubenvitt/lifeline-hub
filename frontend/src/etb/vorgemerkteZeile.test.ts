import { describe, expect, it } from 'vitest';
import { vorgemerkteZeile } from './vorgemerkteZeile';

function wurzel(...zeilen: string[]): HTMLElement {
  const el = document.createElement('ol');
  for (const z of zeilen) {
    const li = document.createElement('li');
    li.dataset.zeile = z;
    el.append(li);
  }
  return el;
}

describe('vorgemerkteZeile', () => {
  it('nimmt die erste abgelehnte, auch wenn eine ausstehende davor steht (Review S10)', () => {
    const w = wurzel('eintrag-3', 'ausstehend-a', 'abgelehnt-b', 'abgelehnt-c');
    expect(vorgemerkteZeile(w)?.dataset.zeile).toBe('abgelehnt-b');
  });

  it('ohne abgelehnte die erste ausstehende', () => {
    const w = wurzel('eintrag-3', 'ausstehend-a', 'ausstehend-b');
    expect(vorgemerkteZeile(w)?.dataset.zeile).toBe('ausstehend-a');
  });

  it('ohne vorgemerkte nichts', () => {
    expect(vorgemerkteZeile(wurzel('eintrag-1'))).toBeNull();
  });
});
