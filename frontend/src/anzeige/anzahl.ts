/**
 * „1 Mitglied“, „2 Mitglieder“: Zahl vor Wort, Einzahl bei genau einem (LFH-946). Eine
 * Hilfsfunktion statt fest gesetzter Mehrzahl, denn ein Einsatz mit einem Mitglied, einem Kanal
 * oder einem Bericht ist im Betrieb häufig.
 */
export function anzahl(n: number, einzahl: string, mehrzahl: string): string {
  return `${n} ${n === 1 ? einzahl : mehrzahl}`;
}
