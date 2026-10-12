/**
 * „1 Mitglied“, „2 Mitglieder“: Zahl vor Wort, Einzahl bei genau einem (LFH-946). Eine
 * Hilfsfunktion statt fest gesetzter Mehrzahl, denn ein Einsatz mit einem Mitglied, einem Kanal
 * oder einem Bericht ist im Betrieb häufig.
 */
export function anzahl(n: number, einzahl: string, mehrzahl: string): string {
  return `${n} ${n === 1 ? einzahl : mehrzahl}`;
}

/**
 * „Offen (3)“ als Beschriftung eines Segments; „Offen“, solange die Menge unbekannt ist (vor der
 * ersten Lieferung wäre „Offen (0)“ eine falsche Aussage über die Lage).
 */
export function segmentLabel(label: string, zahl: number | null): string {
  return zahl == null ? label : `${label} (${zahl})`;
}
