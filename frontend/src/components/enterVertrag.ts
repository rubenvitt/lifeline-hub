/**
 * Ein Enter-Vertrag für alle Erfassungen, nach Feldart (LLH-1766, Regel: `frontend/AGENTS.md`,
 * „Erfassungs-Norm“, R3 der Spec
 * `docs/superpowers/specs/2026-11-20-bn81riye-erfassung-verb-enter-design.md`):
 *
 * - einzeilig: Enter sendet auf jeder Zeigerart;
 * - mehrzeilig im Dialog: Enter bricht um;
 * - mehrzeilig in der Zeile: Enter sendet nur mit feinem Zeiger, mit grobem bricht es um;
 * - Strg/⌘+Enter sendet überall, Umschalt+Enter nie.
 *
 * Enter bei offener Vorschlagsliste wählt nur aus; das prüft der Aufrufer vorher (`StammdatenFeld`,
 * `Mentions`). Die ETB-Leiste verschärft die Zeile (`frontend/src/etb/AGENTS.md`).
 */

export type EnterKontext = { mehrzeilig: boolean; inZeile: boolean; istBeruehrung: boolean };

export type EnterTaste = Pick<
  KeyboardEvent,
  'key' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey' | 'repeat'
> & { isComposing?: boolean };

/** Ob dieser Tastendruck in einem Feld der Art `k` sendet. */
export function isSendeTaste(e: EnterTaste, k: EnterKontext): boolean {
  if (e.key !== 'Enter' || e.repeat || e.altKey || e.isComposing) return false;
  if (e.ctrlKey || e.metaKey) return true;
  if (e.shiftKey) return false;
  if (!k.mehrzeilig) return true;
  return k.inZeile && !k.istBeruehrung;
}

/** Der Tastaturknopf der Bildschirmtastatur: „send“, wo ein bloßes Enter sendet. */
export function enterKeyHintFuer(k: EnterKontext): 'send' | 'enter' {
  const bloss: EnterTaste = {
    key: 'Enter',
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    repeat: false,
  };
  return isSendeTaste(bloss, k) ? 'send' : 'enter';
}
