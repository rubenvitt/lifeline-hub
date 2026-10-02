import type {
  AntragZielArt,
  AufbewahrungZustand,
  EtbTyp,
  VerbleibArt,
  VerbleibStatus,
} from '../api/types';

/**
 * Wörter der Archivakte, die es an keiner exportierten Stelle gibt. Exhaustiv über die
 * generierten Unions: eine neue Variante bricht den Typcheck.
 */

export const VERBLEIB_ART: Record<VerbleibArt, string> = {
  transport: 'Transport',
  notunterkunft: 'Notunterkunft',
  entlassung: 'entlassen',
  vor_ort: 'vor Ort',
  verstorben: 'verstorben',
};

/** Zielart eines Löschersuchens (LFH-751) — dieselben Wörter wie im ETB-Eintrag des Servers. */
export const ZIEL_ART: Record<AntragZielArt, string> = {
  einsatz: 'Einsatz',
  betroffene: 'Betroffene Person',
  externe_kraft: 'Externe Kraft',
  infotelefon_anruf: 'Anruf am Informationstelefon',
  medienkontakt: 'Medienkontakt',
};

export const VERBLEIB_STATUS: Record<VerbleibStatus, string> = {
  angemeldet: 'angemeldet',
  abtransportiert: 'abtransportiert',
};

/**
 * Rang der Zustände entlang der Lebenslinie eines Einsatzes — ein exhaustiver Record: ein
 * neuer Zustand bricht den Typcheck, statt still in Auswahl und Sortierung zu fehlen.
 */
export const ZUSTAND_RANG: Record<AufbewahrungZustand, number> = {
  ohne_frist: 0,
  frist_laeuft: 1,
  faellig: 2,
  vorgemerkt: 3,
  schwaerzung_ausstehend: 4,
  // LFH-751: offener Einsatz-Antrag — der letzte Schritt vor „geschwärzt“.
  schwaerzung_beantragt: 5,
  geschwaerzt: 6,
  loeschung_ausstehend: 7,
  endgueltig_geloescht: 8,
};

/** Die Zustände in Rangfolge — abgeleitet, nicht handgepflegt. */
export const ZUSTAENDE: readonly AufbewahrungZustand[] = (
  Object.keys(ZUSTAND_RANG) as AufbewahrungZustand[]
).sort((a, b) => ZUSTAND_RANG[a] - ZUSTAND_RANG[b]);

/**
 * Reihenfolge der ETB-Typen im Filter des Archiv-ETB — exhaustiv über `EtbTyp`, damit ein
 * neuer Typ im Filter nicht still fehlt (Muster `ETB_TYP_ERLAUBT` in `routing/deeplinks.ts`).
 */
const ETB_TYP_RANG: Record<EtbTyp, number> = {
  meldung: 0,
  anordnung: 1,
  lage: 2,
  entscheidung: 3,
  berichtigung: 4,
  system: 5,
};

export const ETB_TYPEN: readonly EtbTyp[] = (Object.keys(ETB_TYP_RANG) as EtbTyp[]).sort(
  (a, b) => ETB_TYP_RANG[a] - ETB_TYP_RANG[b],
);

/**
 * Welche EINE Primäraktion die Akte im Kopf trägt. Nach Karenz-Ende und Schwärzung keine:
 * ein Knopf, der nur mit 409 abgelehnt werden kann, ist schlechter als keiner. Bei einem offenen
 * Einsatz-Antrag (LFH-751) auch keine: die Rücknahme steht am Antrag im Paneel „Löschersuchen“,
 * eine Frist änderte am bevorstehenden Vollzug nichts.
 */
type AktePrimaeraktion = 'frist' | 'wiederherstellen' | null;

export function primaeraktion(zustand: AufbewahrungZustand): AktePrimaeraktion {
  switch (zustand) {
    case 'ohne_frist':
    case 'frist_laeuft':
    case 'faellig':
      return 'frist';
    case 'vorgemerkt':
      return 'wiederherstellen';
    case 'schwaerzung_ausstehend':
    case 'schwaerzung_beantragt':
    case 'geschwaerzt':
    case 'loeschung_ausstehend':
    case 'endgueltig_geloescht':
      return null;
  }
}
