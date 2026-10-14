import { describe, expect, it } from 'vitest';
import { EINSATZ_STREAM_EVENTS, ORG_STREAM_EVENTS } from './queryKeys';
import type { OrgStreamEvent } from './queryKeys';
import type { LiveEvent, OrgLiveEvent } from './types';

/**
 * Cross-Language-Kontrakt der Org-Ereignisse (LFH-734). Das Rust-`OrgLiveEvent` ist die
 * Wahrheitsquelle und MUSS exakt den Schlüsseln von {@link ORG_STREAM_EVENTS} entsprechen, dazu
 * `org_benachrichtigung` (LLH-1207): empfängergebunden, invalidiert keinen Cache und steht deshalb
 * nicht in der Registry.
 *
 * Beide Familien laufen auf derselben Verbindung (der Einsatz-Strom trägt die Org-Ereignisse
 * mit), ihre Wire-Namen müssen deshalb disjunkt sein. Beides prüft `tsc` (Typ-Ebene unten).
 */

/** Bidirektionale Typ-Gleichheit: `true` nur wenn A ⊆ B UND B ⊆ A, sonst `never`. */
type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
/** `true` nur, wenn A und B keinen gemeinsamen Wert haben. */
type AssertDisjunkt<A, B> = [Extract<A, B>] extends [never] ? true : never;

/** Org-Ereignisse, die der Client fest verdrahtet behandelt, ohne Registry-Eintrag. */
const ORG_NICHT_REGISTRY = ['org_benachrichtigung'] as const;

const _kontrakt: AssertEqual<OrgLiveEvent, OrgStreamEvent | (typeof ORG_NICHT_REGISTRY)[number]> =
  true;
const _disjunkt: AssertDisjunkt<OrgLiveEvent, LiveEvent> = true;
void _kontrakt;
void _disjunkt;

describe('OrgLiveEvent ↔ ORG_STREAM_EVENTS (LFH-734 Cross-Language-Kontrakt)', () => {
  it('teilt keinen Wire-Namen mit den Einsatz-Ereignissen', () => {
    for (const ev of [...Object.keys(ORG_STREAM_EVENTS), ...ORG_NICHT_REGISTRY]) {
      expect(EINSATZ_STREAM_EVENTS).not.toHaveProperty(ev);
      expect(['sofortmeldung', 'lagged', 'benachrichtigung']).not.toContain(ev);
    }
  });

  it('führt org_benachrichtigung NICHT als Registry-Eintrag', () => {
    for (const ev of ORG_NICHT_REGISTRY) {
      expect(ORG_STREAM_EVENTS).not.toHaveProperty(ev);
    }
  });
});
