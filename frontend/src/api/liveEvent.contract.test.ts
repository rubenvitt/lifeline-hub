import { describe, expect, it } from 'vitest';
import { EINSATZ_STREAM_EVENTS } from './queryKeys';
import type { EinsatzStreamEvent } from './queryKeys';
import type { LiveEvent } from './types';

/**
 * Cross-Language-Kontrakt der SSE-Wire-Event-Namen. Das Rust-`LiveEvent`-Enum ist die
 * Wahrheitsquelle und MUSS exakt decken, was das Frontend kennt: {@link EINSATZ_STREAM_EVENTS}
 * ∪ {sofortmeldung, lagged, benachrichtigung} (die behandelt der Client außerhalb der Registry;
 * `benachrichtigung` ist empfängergebunden und invalidiert keinen Cache, LLH-1207).
 *
 * Der Drift-Schutz ist TYP-LEVEL (`AssertEqual` unten, greift in `tsc`): ein neues Backend-Event
 * oder ein toter FE-Key bricht den Typcheck. `LiveEvent` ist ein reiner Typ, deshalb pinnen die
 * Laufzeit-Tests nur die Registry-Ausnahmen.
 */

/** Wire-Events, die der Client fest verdrahtet behandelt, ohne Registry-Eintrag. */
const NICHT_REGISTRY = ['sofortmeldung', 'lagged', 'benachrichtigung'] as const;

/** Alle Wire-Event-Namen, die das Frontend kennt: Registry-Keys ∪ {@link NICHT_REGISTRY}. */
type FeWireEvent = EinsatzStreamEvent | (typeof NICHT_REGISTRY)[number];

/** Bidirektionale Typ-Gleichheit: `true` nur wenn A ⊆ B UND B ⊆ A, sonst `never`. */
type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

// Bricht `tsc`, sobald `LiveEvent` (Backend) und `FeWireEvent` (Frontend) auseinanderdriften:
// fehlendes FE-Wiring eines neuen Backend-Events ODER ein FE-Key ohne Backend-Variante.
const _kontrakt: AssertEqual<LiveEvent, FeWireEvent> = true;
void _kontrakt;

describe('LiveEvent ↔ EINSATZ_STREAM_EVENTS (LFH-298 Cross-Language-Kontrakt)', () => {
  it('führt die Sonderfälle NICHT als Registry-Einträge (Sonderbehandlung außerhalb)', () => {
    for (const ev of NICHT_REGISTRY) {
      expect(EINSATZ_STREAM_EVENTS).not.toHaveProperty(ev);
    }
  });

  it('bildet die FE-Wire-Event-Menge duplikatfrei (Registry ∪ NICHT_REGISTRY)', () => {
    const feWireEvents = [...Object.keys(EINSATZ_STREAM_EVENTS), ...NICHT_REGISTRY];
    expect(new Set(feWireEvents).size).toBe(feWireEvents.length);
  });
});
