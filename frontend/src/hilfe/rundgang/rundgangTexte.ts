import type { RundgangTeil } from './rundgangSchluessel';

/**
 * Texte und Ziele des Rundgangs für Erstnutzer (LLH-1990).
 *
 * Diese Datei ist die EINE Ausnahme von „Text erklärt nie die Bedienung“ (LFH-1078,
 * `frontend/AGENTS.md`, Bedien-Leitlinie): der Rundgang darf zeigen, wo was liegt und wie es geht.
 * Der Erklärtext-Wächter nimmt nur sie aus; die Anrede-Regel (LLH-1830) gilt auch hier.
 */

/** Ein Ziel (CSS-Selektor) mit dem Text, der dazu passt. */
export interface RundgangVariante {
  anker: string;
  text: string;
}

/** Ein Schritt: die erste sichtbare Variante gewinnt, ohne sichtbare entfällt der Schritt. */
export interface RundgangSchritt {
  id: string;
  titel: string;
  varianten: readonly RundgangVariante[];
}

const SUCHE: RundgangSchritt = {
  id: 'suche',
  titel: 'Suche',
  varianten: [
    {
      anker: '[data-lfh="suche-ausloeser"]',
      text: 'Die Suche findet jedes Modul, jeden Einsatz und viele Einträge. Mit Strg + K oder ⌘ K geht sie auch über die Tastatur auf.',
    },
  ],
};

const HILFE: RundgangSchritt = {
  id: 'hilfe',
  titel: 'Hilfe zur Seite',
  varianten: [
    {
      anker: '[data-lfh="hilfe-knopf"]',
      text: 'Das Fragezeichen öffnet die Hilfe zur Seite, die gerade offen ist. Die Taste ? tut dasselbe. Dort steht auch, wie dieser Rundgang wieder beginnt.',
    },
  ],
};

export const RUNDGANG_SCHRITTE: Record<RundgangTeil, readonly RundgangSchritt[]> = {
  liste: [
    {
      id: 'kachel',
      titel: 'Einsätze',
      varianten: [
        {
          anker: '[data-lfh="einsatzkachel"]',
          text: 'Jede Kachel ist ein Einsatz. Ein Klick auf die Kachel öffnet ihn. Die Kachel nennt Status, eigene Rolle und Einsatzleiter.',
        },
      ],
    },
    SUCHE,
    HILFE,
    {
      id: 'menue',
      titel: 'Benutzermenü',
      varianten: [
        {
          anker: '[data-lfh="benutzermenue"]',
          text: 'Im Benutzermenü stehen Profil, Darstellung (hell oder dunkel), Bediendichte und Abmelden.',
        },
      ],
    },
  ],
  einsatz: [
    {
      id: 'kopf',
      titel: 'Kopfzeile',
      varianten: [
        {
          anker: '[data-lfh="kopf-einsatzname"]',
          text: 'Oben stehen Name und Status des Einsatzes. Ein Klick auf den Namen wechselt in einen anderen Einsatz oder zurück zur Einsatzliste.',
        },
      ],
    },
    {
      id: 'kategorien',
      titel: 'Kategorien',
      varianten: [
        {
          anker: '[data-lfh="rail-spalte"]',
          text: 'Links stehen die Kategorien, etwa Lage, Kräfte und Führung. Ein Klick auf eine Kategorie zeigt ihre Module.',
        },
        {
          anker: '[data-lfh="navigation-oeffnen"]',
          text: 'Dieser Knopf öffnet die Navigation mit den Kategorien und ihren Modulen.',
        },
      ],
    },
    {
      id: 'module',
      titel: 'Module',
      varianten: [
        {
          anker: '[data-lfh="modul-panel"]',
          text: 'Hier stehen die Module der gewählten Kategorie, etwa Einsatztagebuch oder Lagekarte. Ein Klick öffnet das Modul rechts daneben.',
        },
        {
          anker: '[data-lfh="rail-spalte"]',
          text: 'Ein Klick auf eine Kategorie öffnet die Liste ihrer Module. Ein Klick auf ein Modul öffnet seine Seite.',
        },
        {
          anker: '[data-lfh="navigation-oeffnen"]',
          text: 'In der Navigation stehen unter jeder Kategorie ihre Module. Ein Klick auf ein Modul öffnet seine Seite.',
        },
      ],
    },
    SUCHE,
    HILFE,
  ],
};
