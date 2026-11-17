import { describe, expect, it } from 'vitest';
import { ausgelassenSatz } from './ruecknahme';

describe('ausgelassenSatz (LLH-1722, LLH-1923)', () => {
  it('nennt jeden ausgelassenen Teil mit Grund', () => {
    expect(
      ausgelassenSatz('83-1', [
        { bezeichnung: 'Anna Müller', grund: 'inzwischen auf einem anderen Fahrzeug' },
        { bezeichnung: 'Einheit «Zug 1»', grund: 'inzwischen aufgelöst' },
      ]),
    ).toBe(
      '83-1 zurück, ohne: Anna Müller (inzwischen auf einem anderen Fahrzeug), Einheit «Zug 1» (inzwischen aufgelöst)',
    );
  });
});
