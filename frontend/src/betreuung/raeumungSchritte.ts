import type { Raeumungszustand } from '../api/types';

/**
 * Räumungsschritte der Detailseite eines Evakuierungsbezirks (LLH-1076, design.md D3), rein und
 * exportiert. Statt eines Auswahldialogs mit vier Zuständen nennt jeder Schritt die HANDLUNG, die
 * aus dem aktuellen Zustand heraus führt (`frontend/AGENTS.md`: Knopftext ist die Handlung, nie
 * das Statuswort).
 *
 * Der Server kennt keine Übergangsregel, jeder Wechsel ist erlaubt; die Rückwege stehen deshalb
 * vollständig im Menü. Sichtbar steht höchstens EIN Vorwärtsschritt neben „Stand melden“, damit
 * der Kopf bei 390 px nicht dreizeilig umbricht. „Anordnung aufheben“ ist eine Entscheidung im
 * ETB und nimmt den Bezirk aus jeder Kennzahl: rot abgesetzt und mit Rückfrage (`rueckfrage`).
 */

export interface RaeumungSchritt {
  /** Menü- und Knopfschlüssel, eindeutig je Plan. */
  key: string;
  label: string;
  ziel: Raeumungszustand;
  /** Rot abgesetzt (Menü `gefahr`) und erst nach Rückfrage gesendet. */
  rueckfrage?: true;
}

export interface RaeumungPlan {
  /** Der eine sichtbare Schritt neben „Stand melden“; `null` ohne naheliegenden Vorwärtsschritt. */
  knopf: RaeumungSchritt | null;
  /** Weitere Schritte (auch Rückwege) fürs Menü, in Ablaufreihenfolge. */
  menue: RaeumungSchritt[];
  /** „Anordnung aufheben“, rot abgesetzt am Ende des Menüs; `null`, wenn schon aufgehoben. */
  aufheben: RaeumungSchritt | null;
}

const schritt = (ziel: Raeumungszustand, label: string): RaeumungSchritt => ({
  key: `raeumung:${ziel}`,
  label,
  ziel,
});

const AUFHEBEN: RaeumungSchritt = {
  ...schritt('aufgehoben', 'Anordnung aufheben'),
  rueckfrage: true,
};

export function raeumungPlan(zustand: Raeumungszustand): RaeumungPlan {
  switch (zustand) {
    case 'angeordnet':
      return {
        knopf: schritt('laeuft', 'Räumung beginnen'),
        menue: [schritt('geraeumt', 'Als geräumt melden')],
        aufheben: AUFHEBEN,
      };
    case 'laeuft':
      return {
        knopf: schritt('geraeumt', 'Als geräumt melden'),
        menue: [schritt('angeordnet', 'Zurück auf angeordnet')],
        aufheben: AUFHEBEN,
      };
    case 'geraeumt':
      return {
        knopf: null,
        menue: [
          schritt('laeuft', 'Räumung wieder aufnehmen'),
          schritt('angeordnet', 'Zurück auf angeordnet'),
        ],
        aufheben: AUFHEBEN,
      };
    case 'aufgehoben':
      return { knopf: schritt('angeordnet', 'Erneut anordnen'), menue: [], aufheben: null };
  }
}
