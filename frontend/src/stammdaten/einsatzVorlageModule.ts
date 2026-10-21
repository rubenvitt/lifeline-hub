import type { EinsatzVorlage } from '../api/types';
import { istModulAusblendbar, modulRegistry } from '../einsatz/modulRegistry';

/**
 * Module einer Einsatz-Vorlage (LLH-1375, design.md D2): gespeichert werden die AUSGEBLENDETEN
 * Module, die Oberfläche zeigt „sichtbar“-Häkchen. Ein neu hinzukommendes Modul ist so in jeder
 * Vorlage sichtbar, wie ohne Vorlage auch. Die Gesamtzahl kommt aus der Registry, nicht als
 * feste Zahl.
 */

/** Alle Module der Navigation, Spiegel von `MODUL_KEYS`. */
export const MODUL_ANZAHL = modulRegistry.length;

/** Sichtbare Module einer Vorlage in Registry-Reihenfolge: alle außer den ausgeblendeten. */
export function sichtbarAus(ausgeblendet: readonly string[]): string[] {
  const aus = new Set(ausgeblendet);
  return modulRegistry
    .map((m) => m.key)
    .filter((key) => !istModulAusblendbar(key) || !aus.has(key));
}

/**
 * Das Komplement der Häkchen, in Registry-Reihenfolge: jedes ausblendbare Modul ohne Häkchen.
 * Ein nicht ausblendbares Modul geht nie hinaus (der Server lehnte es mit 400 ab).
 */
export function ausgeblendetAus(sichtbar: readonly string[]): string[] {
  const an = new Set(sichtbar);
  return modulRegistry.map((m) => m.key).filter((key) => istModulAusblendbar(key) && !an.has(key));
}

/** Zahl der sichtbaren Module; unbekannte Schlüssel zählen nicht. */
export function sichtbarAnzahl(ausgeblendet: readonly string[]): number {
  return sichtbarAus(ausgeblendet).length;
}

/** „27 von 34 Modulen“. */
export function moduleText(ausgeblendet: readonly string[]): string {
  return `${sichtbarAnzahl(ausgeblendet)} von ${MODUL_ANZAHL} Modulen`;
}

/**
 * Wert des Eintrags ohne Vorlage („keine“, „Alle Module“) in einer Auswahl: antd duldet `null`
 * nicht als Optionswert, und `undefined` machte die Auswahl unkontrolliert. Vorlagen-IDs beginnen
 * bei 1.
 */
const OHNE_VORLAGE_WERT = 0;

/** Optionen einer Vorlagen-Auswahl, der Eintrag ohne Vorlage zuerst. */
export function vorlagenOptionen(vorlagen: readonly EinsatzVorlage[], ohne: string) {
  return [
    { value: OHNE_VORLAGE_WERT, label: ohne },
    ...vorlagen.map((v) => ({ value: v.id, label: v.bezeichnung })),
  ];
}

/** Auswahlwert einer Vorlage (`null` = ohne). */
export function auswahlWert(vorlageId: number | null | undefined): number {
  return vorlageId ?? OHNE_VORLAGE_WERT;
}

/** Vorlage eines Auswahlwerts. */
export function vorlageAusWert(wert: number | undefined): number | null {
  return wert == null || wert === OHNE_VORLAGE_WERT ? null : wert;
}
