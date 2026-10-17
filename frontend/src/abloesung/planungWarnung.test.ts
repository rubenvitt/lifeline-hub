import { describe, expect, it } from 'vitest';
import { planungWarnungText } from './planungWarnung';

const konv = { zeitzone: 'Europe/Berlin' };

describe('planungWarnungText (LLH-1131)', () => {
  it('nennt die Schicht, für die die Einheit schon geplant ist', () => {
    expect(
      planungWarnungText(
        {
          art: 'schon_geplant',
          einheit_id: 3,
          einheit_name: '2. Rettungsstaffel',
          abloesung_id: 7,
          abloesung_einheit_name: 'Florian 1',
        },
        konv,
      ),
    ).toBe('2. Rettungsstaffel schon für Schicht Florian 1 geplant');
  });

  it('nennt, seit wann die Einheit selbst im Einsatz steht, in der Anzeigezone', () => {
    expect(
      planungWarnungText(
        {
          art: 'im_einsatz',
          einheit_id: 3,
          einheit_name: '2. Rettungsstaffel',
          seit_at: '2026-01-05 12:40:00',
        },
        konv,
      ),
    ).toBe('2. Rettungsstaffel steht selbst im Einsatz seit 051340');
  });
});
