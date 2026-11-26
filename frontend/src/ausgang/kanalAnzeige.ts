import type { KanalArt } from '../api/types';

/** Reihenfolge, in der Kanäle in einer Aufzählung stehen. */
export const KANAL_REIHENFOLGE: readonly KanalArt[] = ['email', 'matrix', 'fax', 'threema'];

/** Kurzwort des Kanals, als kleines Zeichen vor einer Adresse. */
export function kanalKurz(kanal: KanalArt): string {
  switch (kanal) {
    case 'email':
      return 'Mail';
    case 'matrix':
      return 'Matrix';
    case 'fax':
      return 'Fax';
    case 'threema':
      return 'Threema';
  }
}

/** Länge des Raum-ID-Anfangs, der in der Anzeige stehen bleibt. */
const RAUM_ID_ANFANG = 8;

/**
 * Wie eine Adresse in der Versandliste steht: ein Matrix-Alias (`#…`) ganz, eine Raum-ID (`!…`)
 * gekürzt auf den Anfang des lokalen Teils und den Server; alles andere unverändert.
 */
export function adresseAnzeige(kanal: KanalArt, adresse: string): string {
  if (kanal !== 'matrix' || !adresse.startsWith('!')) return adresse;
  const doppelpunkt = adresse.indexOf(':');
  if (doppelpunkt < 0) return adresse;
  const lokal = adresse.slice(1, doppelpunkt);
  if (lokal.length <= RAUM_ID_ANFANG) return adresse;
  return `!${lokal.slice(0, RAUM_ID_ANFANG)}…${adresse.slice(doppelpunkt)}`;
}
