import { describe, expect, it } from 'vitest';
import { enterKeyHintFuer, isSendeTaste, type EnterKontext, type EnterTaste } from './enterVertrag';

// Tabelle R3 der Spec `docs/superpowers/specs/2026-11-20-bn81riye-erfassung-verb-enter-design.md`.
const enter: EnterTaste = {
  key: 'Enter',
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  repeat: false,
};
const k = (mehrzeilig: boolean, inZeile: boolean, istBeruehrung: boolean): EnterKontext => ({
  mehrzeilig,
  inZeile,
  istBeruehrung,
});

describe('isSendeTaste (Enter-Vertrag nach Feldart, LLH-1766)', () => {
  it('einzeilig sendet Enter auf jeder Zeigerart', () => {
    expect(isSendeTaste(enter, k(false, true, false))).toBe(true);
    expect(isSendeTaste(enter, k(false, true, true))).toBe(true);
    expect(isSendeTaste(enter, k(false, false, true))).toBe(true);
  });

  it('mehrzeilig im Dialog bricht Enter um', () => {
    expect(isSendeTaste(enter, k(true, false, false))).toBe(false);
    expect(isSendeTaste(enter, k(true, false, true))).toBe(false);
  });

  it('mehrzeilig in der Zeile sendet Enter nur mit feinem Zeiger', () => {
    expect(isSendeTaste(enter, k(true, true, false))).toBe(true);
    expect(isSendeTaste(enter, k(true, true, true))).toBe(false);
  });

  it('Strg/⌘+Enter sendet überall', () => {
    for (const kontext of [k(true, true, true), k(true, false, false), k(false, true, true)]) {
      expect(isSendeTaste({ ...enter, ctrlKey: true }, kontext)).toBe(true);
      expect(isSendeTaste({ ...enter, metaKey: true }, kontext)).toBe(true);
    }
  });

  it('Umschalt+Enter sendet in einem mehrzeiligen Feld nie', () => {
    expect(isSendeTaste({ ...enter, shiftKey: true }, k(true, true, false))).toBe(false);
  });

  it('wiederholtes, Alt- oder komponierendes Enter und andere Tasten senden nicht', () => {
    expect(isSendeTaste({ ...enter, repeat: true }, k(false, true, false))).toBe(false);
    expect(isSendeTaste({ ...enter, altKey: true }, k(false, true, false))).toBe(false);
    expect(isSendeTaste({ ...enter, isComposing: true }, k(false, true, false))).toBe(false);
    expect(isSendeTaste({ ...enter, key: 'a' }, k(false, true, false))).toBe(false);
  });
});

describe('enterKeyHintFuer', () => {
  it('nennt „send“, wo Enter sendet, sonst „enter“', () => {
    expect(enterKeyHintFuer(k(false, true, true))).toBe('send');
    expect(enterKeyHintFuer(k(true, true, false))).toBe('send');
    expect(enterKeyHintFuer(k(true, true, true))).toBe('enter');
    expect(enterKeyHintFuer(k(true, false, false))).toBe('enter');
  });
});
