import { describe, expect, it } from 'vitest';
import { ausgelassenSatz } from './ruecknahmeSatz';

describe('ausgelassenSatz', () => {
  it('nennt jeden ausgelassenen Teil mit seinem Grund', () => {
    expect(
      ausgelassenSatz('Anna Müller', {
        ausgelassen: [
          { bezeichnung: 'Führung von «Zug 1»', grund: 'inzwischen anders besetzt' },
          { bezeichnung: 'Einsatzleitung', grund: 'inzwischen ausgetragen' },
        ],
      }),
    ).toBe(
      'Anna Müller zurück, ohne: Führung von «Zug 1» (inzwischen anders besetzt), Einsatzleitung (inzwischen ausgetragen)',
    );
  });
});
