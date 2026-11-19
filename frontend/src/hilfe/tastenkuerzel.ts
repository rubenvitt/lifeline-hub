/**
 * Tastenkürzel für den Reiter „Tastenkürzel“ der Hilfe-Seitenleiste (LLH-1824). Die globalen
 * Mutationskürzel kommen aus `TASTATUR_AKTIONEN`, damit Übersicht und Tastenweg nicht auseinander
 * laufen; die übrigen stehen hier und nennen nur Kürzel, die der Code wirklich auswertet.
 *
 * Ohne Kapiteltexte (Haupt-Chunk, `hauptChunk.guard.test.ts`).
 */

import { TASTATUR_AKTIONEN, TASTATUR_AKTION_REIHENFOLGE } from '../command-palette/befehle';

export interface KuerzelEintrag {
  /** Gleichwertige Tastenwege, je eine Marke („⌘ S“, „⌘ ↵“). */
  tasten: string[];
  wirkung: string;
}

export interface KuerzelGruppe {
  titel: string;
  /** Modul, dem die Gruppe gehört; sie steht oben, wenn man auf seiner Seite ist. */
  modulKey?: string;
  eintraege: KuerzelEintrag[];
}

const primaer = (apple: boolean, taste: string) => (apple ? `⌘ ${taste}` : `Strg + ${taste}`);

function ueberall(apple: boolean): KuerzelGruppe {
  const aktionen: KuerzelEintrag[] = [];
  for (const id of TASTATUR_AKTION_REIHENFOLGE) {
    const kuerzel = TASTATUR_AKTIONEN[id].kuerzel(apple);
    if (kuerzel !== null)
      aktionen.push({ tasten: kuerzel.split(' / '), wirkung: TASTATUR_AKTIONEN[id].label });
  }
  return {
    titel: 'Überall',
    eintraege: [
      { tasten: [primaer(apple, 'K')], wirkung: 'Sprungpalette öffnen' },
      { tasten: ['?', 'F1'], wirkung: 'Hilfe zu dieser Seite' },
      ...aktionen,
    ],
  };
}

function inDerPalette(apple: boolean): KuerzelGruppe {
  return {
    titel: 'In der Sprungpalette',
    eintraege: [
      { tasten: ['↵'], wirkung: 'Treffer öffnen' },
      { tasten: [primaer(apple, '↵')], wirkung: 'Im neuen Tab öffnen' },
      { tasten: ['→'], wirkung: 'Vorschau zeigen' },
      { tasten: ['Esc'], wirkung: 'Zurück oder schließen' },
    ],
  };
}

const IN_LISTEN: KuerzelGruppe = {
  titel: 'In Listen',
  eintraege: [{ tasten: ['/'], wirkung: 'Ins Suchfeld springen' }],
};

function module(apple: boolean): KuerzelGruppe[] {
  return [
    {
      titel: 'ETB',
      modulKey: 'etb',
      eintraege: [
        { tasten: ['↵'], wirkung: 'Einzeiligen Eintrag erfassen (nicht am Touch-Gerät)' },
        { tasten: [primaer(apple, '↵')], wirkung: 'Eintrag erfassen' },
        { tasten: ['/'], wirkung: 'Felder und Bausteine, am Zeilenanfang auch der Typ' },
        { tasten: ['@'], wirkung: 'Funkrufname für Von oder An' },
      ],
    },
    {
      titel: 'Lagekarte',
      modulKey: 'lagekarte',
      eintraege: [{ tasten: ['Esc'], wirkung: 'Zeichnen, Messen oder Fokus beenden' }],
    },
  ];
}

/**
 * Gruppen für die Übersicht. Die Gruppe des aktuellen Moduls steht vorn, dann „Überall“, die
 * Sprungpalette, Listen und die übrigen Module.
 */
export function kuerzelGruppen(apple: boolean, aktuellerModulKey: string | null): KuerzelGruppe[] {
  const alleModule = module(apple);
  const eigene = alleModule.filter((g) => g.modulKey === aktuellerModulKey);
  const andere = alleModule.filter((g) => g.modulKey !== aktuellerModulKey);
  return [...eigene, ueberall(apple), inDerPalette(apple), IN_LISTEN, ...andere];
}
