/**
 * Lädt die App an `pfad` vollständig neu (LFH-387). Eigene Datei, damit Tests den Ruf ersetzen
 * können — jsdom kennt kein `location.replace`.
 */
export function seiteNeuLaden(pfad: string): void {
  window.location.replace(pfad);
}
