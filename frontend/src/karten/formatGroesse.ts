/** Formatiert eine Byte-Größe menschenlesbar (B/KB/MB/GB). `null` → „—". */
export function formatGroesse(bytes: number | null | undefined): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const einheiten = ['KB', 'MB', 'GB', 'TB'];
  let wert = bytes / 1024;
  let i = 0;
  while (wert >= 1024 && i < einheiten.length - 1) {
    wert /= 1024;
    i += 1;
  }
  return `${wert.toFixed(1)} ${einheiten[i]}`;
}
