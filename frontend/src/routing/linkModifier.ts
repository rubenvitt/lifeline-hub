/**
 * Ob der Browser einen Link-Klick selbst behandeln soll (LLH-1732): Strg/⌘ und Umschalt öffnen
 * einen neuen Tab oder ein neues Fenster, jede andere Taste als die linke ebenso. Dann ruft der
 * Klick-Handler weder `preventDefault` noch die eigene Navigation, sonst ginge der neue Tab
 * verloren und der alte wechselte die Seite.
 *
 * Die Mittelklick-Prüfung bleibt, obwohl moderne Browser dafür `auxclick` statt `click` senden:
 * ältere WebViews senden `click`.
 */
export function hasLinkModifier(e: {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  button: number;
}): boolean {
  return e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0;
}

/**
 * Klick-Handler eines `<a href>`, das die App selbst bedient: der einfache Klick läuft über
 * `aktion` (Navigation samt Nebenwirkungen des Aufrufers), alles mit {@link hasLinkModifier}
 * bleibt beim Browser.
 */
export function handleLinkKlick(
  e: Parameters<typeof hasLinkModifier>[0] & { preventDefault: () => void },
  aktion: () => void,
): void {
  if (hasLinkModifier(e)) return;
  e.preventDefault();
  aktion();
}
