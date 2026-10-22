import { zahlText } from '../anzeige/zahl';

/**
 * Formatiert eine Byte-Größe menschenlesbar (B/KB/MB/GB) mit Dezimalkomma. `null` → „—".
 * `kbStellen` gilt nur für die KB-Stufe (der Chat zeigt dort ganze Zahlen).
 */
export function formatGroesse(bytes: number | null | undefined, kbStellen = 1): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${zahlText(bytes)} B`;
  if (bytes < 1024 * 1024) return `${zahlText(bytes / 1024, { stellen: kbStellen })} KB`;
  const einheiten = ['KB', 'MB', 'GB', 'TB'];
  let wert = bytes / 1024;
  let i = 0;
  while (wert >= 1024 && i < einheiten.length - 1) {
    wert /= 1024;
    i += 1;
  }
  return `${zahlText(wert, { stellen: 1 })} ${einheiten[i]}`;
}
