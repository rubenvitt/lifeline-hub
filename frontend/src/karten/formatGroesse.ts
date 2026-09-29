/**
 * Formatiert eine Byte-Größe menschenlesbar (B/KB/MB/GB). `null` → „—".
 * `kbStellen` gilt nur für die KB-Stufe (der Chat zeigt dort ganze Zahlen).
 */
export function formatGroesse(bytes: number | null | undefined, kbStellen = 1): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(kbStellen)} KB`;
  const einheiten = ['KB', 'MB', 'GB', 'TB'];
  let wert = bytes / 1024;
  let i = 0;
  while (wert >= 1024 && i < einheiten.length - 1) {
    wert /= 1024;
    i += 1;
  }
  return `${wert.toFixed(1)} ${einheiten[i]}`;
}
