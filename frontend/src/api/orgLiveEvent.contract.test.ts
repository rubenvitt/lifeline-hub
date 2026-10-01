import { describe, expect, it } from 'vitest';
import { EINSATZ_STREAM_EVENTS, ORG_STREAM_EVENTS } from './queryKeys';
import type { OrgStreamEvent } from './queryKeys';
import type { LiveEvent, OrgLiveEvent } from './types';

/**
 * Cross-Language-Kontrakt der Org-Ereignisse (LFH-734). Das Rust-`OrgLiveEvent` ist die
 * Wahrheitsquelle und MUSS exakt den Schlüsseln von {@link ORG_STREAM_EVENTS} entsprechen.
 *
 * Beide Familien laufen auf derselben Verbindung (der Einsatz-Strom trägt die Org-Ereignisse
 * mit), ihre Wire-Namen müssen deshalb disjunkt sein. Beides prüft `tsc` (Typ-Ebene unten).
 */

/** Bidirektionale Typ-Gleichheit: `true` nur wenn A ⊆ B UND B ⊆ A, sonst `never`. */
type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
/** `true` nur, wenn A und B keinen gemeinsamen Wert haben. */
type AssertDisjunkt<A, B> = [Extract<A, B>] extends [never] ? true : never;

const _kontrakt: AssertEqual<OrgLiveEvent, OrgStreamEvent> = true;
const _disjunkt: AssertDisjunkt<OrgLiveEvent, LiveEvent> = true;
void _kontrakt;
void _disjunkt;

describe('OrgLiveEvent ↔ ORG_STREAM_EVENTS (LFH-734 Cross-Language-Kontrakt)', () => {
  it('teilt keinen Wire-Namen mit den Einsatz-Ereignissen', () => {
    for (const ev of Object.keys(ORG_STREAM_EVENTS)) {
      expect(EINSATZ_STREAM_EVENTS).not.toHaveProperty(ev);
      expect(['sofortmeldung', 'lagged']).not.toContain(ev);
    }
  });
});
