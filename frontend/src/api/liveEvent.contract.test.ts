import { describe, expect, it } from 'vitest';
import { EINSATZ_STREAM_EVENTS } from './queryKeys';
import type { EinsatzStreamEvent } from './queryKeys';
import type { LiveEvent } from './types';

/**
 * LFH-298: Cross-Language-Kontrakt der SSE-Wire-Event-Namen. Das Rust-`LiveEvent`-Enum ist die
 * Wahrheitsquelle der Wire-Event-Namen (`src/live/mod.rs` → openapi.json → types.generated.ts).
 * Es MUSS exakt das decken, was das Frontend kennt: die {@link EINSATZ_STREAM_EVENTS}-Registry
 * ∪ {sofortmeldung, lagged}.
 *
 * `sofortmeldung` + `lagged` sind die zwei Wire-Events, die `useEinsatzLiveStream` zusätzlich
 * zur Registry behandelt (Ton/CustomEvent-Seiteneffekt bzw. serverseitiger Voll-Resync) und die
 * bewusst NICHT in EINSATZ_STREAM_EVENTS stehen (siehe queryKeys.ts / queryKeys.test.ts).
 *
 * Der eigentliche Drift-Schutz ist TYP-LEVEL (die `AssertEqual`-Zeile unten) und greift im
 * `pnpm typecheck`-Gate (scripts/check-typ-codegen.sh Schritt 4): ein neues Backend-Event ODER
 * ein toter FE-Key bricht `tsc`, weil die beiden Unions dann nicht mehr deckungsgleich sind. Die
 * `openapi-typescript`-Generierung liefert `LiveEvent` als reinen Typ (kein Laufzeitwert) — ein
 * schlichtes `expect(...).toEqual(...)` gegen die Union ist deshalb nicht möglich; die Laufzeit-
 * Tests pinnen nur die Registry-Ausnahmen sichtbar im Report.
 */

/** Wire-Events, die der Hook fest verdrahtet behandelt, ohne Registry-Eintrag. */
const NICHT_REGISTRY = ['sofortmeldung', 'lagged'] as const;

/** Alle Wire-Event-Namen, die das Frontend kennt: Registry-Keys ∪ {sofortmeldung, lagged}. */
type FeWireEvent = EinsatzStreamEvent | (typeof NICHT_REGISTRY)[number];

/** Bidirektionale Typ-Gleichheit: `true` nur wenn A ⊆ B UND B ⊆ A, sonst `never`. */
type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

// Bricht `tsc`, sobald `LiveEvent` (Backend) und `FeWireEvent` (Frontend) auseinanderdriften:
// fehlendes FE-Wiring eines neuen Backend-Events ODER ein FE-Key ohne Backend-Variante.
const _kontrakt: AssertEqual<LiveEvent, FeWireEvent> = true;
void _kontrakt;

describe('LiveEvent ↔ EINSATZ_STREAM_EVENTS (LFH-298 Cross-Language-Kontrakt)', () => {
  it('führt sofortmeldung und lagged NICHT als Registry-Einträge (Sonderbehandlung im Hook)', () => {
    for (const ev of NICHT_REGISTRY) {
      expect(EINSATZ_STREAM_EVENTS).not.toHaveProperty(ev);
    }
  });

  it('bildet die FE-Wire-Event-Menge duplikatfrei (Registry ∪ {sofortmeldung, lagged})', () => {
    const feWireEvents = [...Object.keys(EINSATZ_STREAM_EVENTS), ...NICHT_REGISTRY];
    expect(new Set(feWireEvents).size).toBe(feWireEvents.length);
  });
});
