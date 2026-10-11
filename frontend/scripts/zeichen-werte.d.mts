// Typen für `zeichen-werte.mjs` (LFH-836): der Wächter `src/zeichen/zeichenWerte.guard.test.ts`
// importiert den Erzeuger aus TypeScript.

/** Pfad der erzeugten Werteliste `src/freies_zeichen/zeichen_werte.json`. */
export declare const ZIEL: string;

/** Inhalt der Werteliste aus der installierten Bibliothek, formatiert wie Prettier im Frontend. */
export declare function erzeugeZeichenWerte(): Promise<string>;
