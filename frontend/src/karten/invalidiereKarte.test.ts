import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { invalidiereKarte } from './invalidiereKarte';

/**
 * CHARAKTERISIERUNGSTEST (LFH-307): pinnt das Invalidierungsverhalten von `invalidiereKarte`
 * gegen den Ist-Stand, BEVOR die Query-Keys auf die `globalKeys`-Registry migriert werden.
 *
 * Warum vorher: ein Test, der erst mit der Migration entsteht, belegt nur, dass neuer Code zu
 * sich selbst passt. Dieser hier lief gegen die alten Literale grün und muss gegen die
 * Accessoren grün bleiben — erst das ist ein Beweis, dass Verhalten ERHALTEN blieb.
 *
 * Die eigentliche Regressionsklasse dieser Migration (90 Call-Sites, verändertes
 * Invalidierungsverhalten) wäre e2e. Schritt 7 von `check-all.sh` überspringt e2e aber STILL,
 * wenn `target/debug/lifeline-hub` fehlt — worauf man sich als Netz also nicht verlassen kann.
 * Dieser Test plus der Byte-Pin in `queryKeys.test.ts` sind der Ersatz.
 *
 * DIE KEYS BLEIBEN HIER ABSICHTLICH LITERALE — bewusste Abweichung vom LFH-307-Plan, der sie
 * mit der Migration auf `globalKeys.*` umstellen wollte. Gemessen, warum das schlechter wäre:
 * baut man den `setQueryData`-Key MIT derselben Factory, die auch `invalidiereKarte` benutzt,
 * dann matchen beide Seiten auch dann noch, wenn die Factory einen falschen Prefix liefert —
 * der Test wäre tautologisch. Probe: `adminKarte()` auf `['admin-karte-FALSCH']` verbogen →
 * dieser Test (Literale) wird ROT; mit Accessoren gebaut wäre er grün geblieben. Die Literale
 * sind die unabhängige zweite Quelle, genau dafür ist ein Charakterisierungstest da.
 *
 * `new QueryClient()` statt `neuerQueryClient()` ist ABSICHT und gemessen: der App-Client setzt
 * `gcTime: 0`, was einen per `setQueryData` gesetzten, NICHT beobachteten Eintrag beim ersten
 * `await` wegräumt — die `isStale()`-Assertions unten wären dann trivial grün. Tests MIT
 * gerenderter Komponente (= mounted Observer) dürfen `neuerQueryClient()` nutzen.
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

    // Vorbedingung: frisch gesetzt ist nichts stale. Ohne diesen Anker könnte der Test auch
    // dann grün sein, wenn die Einträge nie existiert haben.
    for (const k of keys) {
      expect(qc.getQueryState(k)?.isInvalidated ?? true, `vorher nicht stale: ${JSON.stringify(k)}`).toBe(
        false,
      );
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
