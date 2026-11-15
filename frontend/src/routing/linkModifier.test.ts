import { describe, expect, it, vi } from 'vitest';
import { handleLinkKlick, hasLinkModifier } from './linkModifier';

const klick = (over: Partial<Parameters<typeof hasLinkModifier>[0]> = {}) => ({
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  button: 0,
  ...over,
});

describe('hasLinkModifier', () => {
  it('lässt den einfachen Linksklick der App', () => {
    expect(hasLinkModifier(klick())).toBe(false);
  });

  it('überlässt Strg, ⌘, Umschalt und jede andere Taste dem Browser', () => {
    expect(hasLinkModifier(klick({ ctrlKey: true }))).toBe(true);
    expect(hasLinkModifier(klick({ metaKey: true }))).toBe(true);
    expect(hasLinkModifier(klick({ shiftKey: true }))).toBe(true);
    expect(hasLinkModifier(klick({ button: 1 }))).toBe(true);
  });
});

describe('handleLinkKlick', () => {
  it('führt den einfachen Klick selbst aus und verhindert den des Browsers', () => {
    const aktion = vi.fn();
    const e = { ...klick(), preventDefault: vi.fn() };
    handleLinkKlick(e, aktion);
    expect(aktion).toHaveBeenCalledOnce();
    expect(e.preventDefault).toHaveBeenCalledOnce();
  });

  it('tut beim Strg-Klick nichts, damit der Browser den Tab öffnet', () => {
    const aktion = vi.fn();
    const e = { ...klick({ ctrlKey: true }), preventDefault: vi.fn() };
    handleLinkKlick(e, aktion);
    expect(aktion).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
});
