import { useAuthOptional } from '../auth/AuthContext';
import type { GeraetAnzeige } from '../api/types';

/**
 * Was ein gekoppeltes Gerät auf den geteilten Seiten bedienen darf (LFH-892, Spec
 * `funktionsansichten`, Scope-Matrix). Die Schranke steht beim Server; hier geht es nur darum,
 * dass die Oberfläche keine Bedienung und keinen Sprung anbietet, die der Server ablehnt.
 * Für eine Person ist alles `true`: es gelten die bisherigen Rechte der Seite.
 */
export type GeraetFaehigkeit =
  /** Plätze anlegen, verschieben, löschen. */
  | 'grundriss-bearbeiten'
  /** UHS anlegen, Status wechseln, stornieren; der Umschalter zwischen Hilfsstellen. */
  | 'uhs-verwalten'
  /** Material der UHS lesen. */
  | 'uhs-material'
  /** Dateien der UHS. */
  | 'uhs-anhaenge'
  /** Personenstatus und Storno. */
  | 'person-status'
  /** Sichten und Re-Sichten; an der Betreuungsstelle nicht (LFH-1041). */
  | 'person-sichtung'
  /** Tiere und Schäden einer Person. */
  | 'person-zuordnungen'
  /** Fotos und Dateien einer Person. */
  | 'person-anhaenge'
  /** Bereitstellungsraum wechseln, anlegen, bearbeiten, auflösen, stornieren (LFH-1042, LFH-1147). */
  | 'br-verwalten'
  /**
   * Eintreffen am eigenen Raum buchen, auch eine unangemeldete Kraft anlegen (LLH-1075). Die
   * einzige Änderung an Einheiten und Fahrzeugen am Gerät; Übernehmen und Abweisen nie.
   */
  | 'br-eintreffen'
  /** Verpflegungszeitfenster anlegen, Bedarf ändern, löschen (LFH-1044); Verpflegungsstellen
   *  anlegen, bearbeiten, in Betrieb nehmen, auflösen, stornieren und Zeitfenstern zuordnen
   *  (LLH-1040). Das Gerät liest die Stellen und wählt sie beim Buchen. */
  | 'verpflegung-planen'
  /** Sprünge in Module außerhalb der Ansicht (Lagekarte, Tiere, Schäden, Einsatzübersicht). */
  | 'fremde-module';

export function geraetDarf(geraet: GeraetAnzeige | null, faehigkeit: GeraetFaehigkeit): boolean {
  if (!geraet) return true;
  switch (faehigkeit) {
    // Der UHS-Laptop pflegt Grundriss und Dateien seiner UHS und liest ihr Material (LFH-1025).
    case 'grundriss-bearbeiten':
    case 'uhs-material':
    case 'uhs-anhaenge':
      return geraet.ansicht === 'uhs-laptop';
    case 'person-sichtung':
      return geraet.ansicht === 'uhs-tablet' || geraet.ansicht === 'uhs-laptop';
    case 'br-eintreffen':
      return geraet.ansicht === 'bereitstellungsraum';
    case 'uhs-verwalten':
    case 'br-verwalten':
    case 'verpflegung-planen':
    case 'person-status':
    case 'person-zuordnungen':
    case 'person-anhaenge':
    case 'fremde-module':
      return false;
  }
}

/** {@link geraetDarf} für die Sitzung dieses Tabs. Ohne `AuthProvider` (Komponententests einer
 *  geteilten Fläche) gibt es kein Gerät. */
export function useGeraetDarf(): (faehigkeit: GeraetFaehigkeit) => boolean {
  const geraet = useAuthOptional()?.geraet ?? null;
  return (faehigkeit) => geraetDarf(geraet, faehigkeit);
}
