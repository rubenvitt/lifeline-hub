/** Lädt die Seite neu; eigenes Modul, weil jsdom `location.reload` nicht ersetzen lässt (Tests). */
export function seiteNeuLaden(): void {
  window.location.reload();
}
