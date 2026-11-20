// Wertung der Bereitschaft (LLH-1820, Entwurf
// `docs/superpowers/specs/2026-11-19-efvk5rbs-verwaltung-uebersicht-mitglieder-design.md`).
// Die einzige Stelle, die bestimmt, was für einen Einsatz „fehlt“: der Server zählt nur
// (`GET /api/verwaltung/bereitschaft`), Demo-Zeilen zählen nicht zum Bestand.
import type { Bereitschaft } from '../api/types';

export type BestandKey =
  'benutzer' | 'fahrzeuge' | 'personal' | 'einheit_vorlagen' | 'einsatz_vorlagen';

/** `fehlt` = Pflicht für einen Einsatz, `empfohlen` = hilft, ist aber keine Bedingung. */
export type Zustand = 'fehlt' | 'empfohlen' | 'vorhanden';

export interface BestandZeile {
  key: BestandKey;
  label: string;
  zahl: number;
  /** Zeilen aus der Demo-Ausstattung, getrennt gezählt (0, wo es keine Demo-Marke gibt). */
  demo: number;
  zustand: Zustand;
}

export interface BereitschaftWertung {
  zeilen: BestandZeile[];
  /** Die fehlenden Pflichtpunkte im Wortlaut des Satzes, in Zeilenfolge. */
  fehlt: string[];
  satz: string;
}

export function bewerteBereitschaft(b: Bereitschaft): BereitschaftWertung {
  // Pflicht 1: mindestens eine weitere Person neben der anfragenden.
  const benutzerFehlt = b.benutzer < 2;
  // Pflicht 2: Fahrzeuge ODER Personal. Ist eines da, ist das andere nur eine Empfehlung.
  const kraefteFehlen = b.fahrzeuge + b.personal < 1;
  const kraft = (zahl: number): Zustand =>
    kraefteFehlen ? 'fehlt' : zahl > 0 ? 'vorhanden' : 'empfohlen';
  const empfehlung = (zahl: number): Zustand => (zahl > 0 ? 'vorhanden' : 'empfohlen');

  const zeilen: BestandZeile[] = [
    {
      key: 'benutzer',
      label: 'Benutzer',
      zahl: b.benutzer,
      demo: 0,
      zustand: benutzerFehlt ? 'fehlt' : 'vorhanden',
    },
    {
      key: 'fahrzeuge',
      label: 'Fahrzeuge',
      zahl: b.fahrzeuge,
      demo: b.fahrzeuge_demo,
      zustand: kraft(b.fahrzeuge),
    },
    {
      key: 'personal',
      label: 'Personal',
      zahl: b.personal,
      demo: b.personal_demo,
      zustand: kraft(b.personal),
    },
    {
      key: 'einheit_vorlagen',
      label: 'Einheiten-Vorlagen',
      zahl: b.einheit_vorlagen,
      demo: b.einheit_vorlagen_demo,
      zustand: empfehlung(b.einheit_vorlagen),
    },
    {
      key: 'einsatz_vorlagen',
      label: 'Einsatz-Vorlagen',
      zahl: b.einsatz_vorlagen,
      demo: 0,
      zustand: empfehlung(b.einsatz_vorlagen),
    },
  ];

  const fehlt = [
    ...(benutzerFehlt ? ['weitere Benutzer'] : []),
    ...(kraefteFehlen ? ['Fahrzeuge oder Personal'] : []),
  ];
  const satz =
    fehlt.length > 0
      ? `Für einen Einsatz fehlt: ${fehlt.join(', ')}.`
      : 'Bereit für einen Einsatz.';
  return { zeilen, fehlt, satz };
}
