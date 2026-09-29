/** Registriernummer in Anzeigeschreibweise wie im Backend: Person R-042, Tier T-042, Schaden S-007. */
export function registrierNummer(praefix: 'R' | 'T' | 'S', nr: number): string {
  return `${praefix}-${String(nr).padStart(3, '0')}`;
}
