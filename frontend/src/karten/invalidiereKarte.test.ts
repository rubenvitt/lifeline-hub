import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { invalidiereKarte } from './invalidiereKarte';

/**
 * Charakterisierungstest des Invalidierungsverhaltens von `invalidiereKarte`.
 *
 * DIE KEYS SIND ABSICHTLICH LITERALE: mit derselben Factory gebaut, die auch
 * `invalidiereKarte` benutzt, matchten beide Seiten auch bei falschem Prefix — der Test wäre
 * tautologisch. Die Literale sind die unabhängige zweite Quelle.
 *
 * `new QueryClient()` statt `neuerQueryClient()`: dessen `gcTime: 0` räumt einen per
 * `setQueryData` gesetzten, unbeobachteten Eintrag beim ersten `await` weg — die
 * `isStale()`-Assertions wären dann trivial grün.
 */

/** Die sieben Bereiche, die heute unter dem `admin-karte`-Prefix hängen. */
const ADMIN_KARTE_BEREICHE = [
  'katalog',
  'bau-status',
  'offline-karten',
  'baubare-regionen',
  'offline-katalog',
  'offline-vorhandene',
  'online-quellen',
] as const;

describe('invalidiereKarte: Charakterisierung des Ist-Verhaltens (LFH-307)', () => {
  it('invalidiert ALLE admin-karte-Bereiche und die karte-config in einem Rutsch', () => {
    const qc = new QueryClient();
    const keys: unknown[][] = [
      ...ADMIN_KARTE_BEREICHE.map((b) => ['admin-karte', b]),
      ['karte-config'],
    ];
    for (const k of keys) qc.setQueryData(k, { wert: 1 });

    // Vorbedingung: frisch gesetzt ist nichts stale — sonst könnte der Test grün sein, wenn die
    // Einträge nie existierten.
    for (const k of keys) {
      expect(
        qc.getQueryState(k)?.isInvalidated ?? true,
        `vorher nicht stale: ${JSON.stringify(k)}`,
      ).toBe(false);
    }

    invalidiereKarte(qc);

    for (const k of keys) {
      expect(qc.getQueryState(k)?.isInvalidated, `nachher stale: ${JSON.stringify(k)}`).toBe(true);
    }
  });

  it('fasst fremde Keys NICHT an (Negativ-Anker gegen einen zu breiten Prefix)', () => {
    const qc = new QueryClient();
    qc.setQueryData(['personal', 'alle'], { wert: 1 });
    qc.setQueryData(['admin-karte', 'katalog'], { wert: 1 });

    invalidiereKarte(qc);

    expect(qc.getQueryState(['personal', 'alle'])?.isInvalidated).toBe(false);
    expect(qc.getQueryState(['admin-karte', 'katalog'])?.isInvalidated).toBe(true);
  });
});
