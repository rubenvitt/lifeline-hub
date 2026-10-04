import { useAuth } from '../auth/AuthContext';
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
  /** Tiere und Schäden einer Person. */
  | 'person-zuordnungen'
  /** Fotos und Dateien einer Person. */
  | 'person-anhaenge'
  /** Sprünge in Module außerhalb der Ansicht (Lagekarte, Tiere, Schäden, Einsatzübersicht). */
  | 'fremde-module';

export function geraetDarf(geraet: GeraetAnzeige | null, faehigkeit: GeraetFaehigkeit): boolean {
  if (!geraet) return true;
  // Der UHS-Laptop (Subtask LFH-1025) erweitert diese Liste; bis dahin gilt die Matrix des Tablets.
  switch (faehigkeit) {
    case 'grundriss-bearbeiten':
    case 'uhs-verwalten':
    case 'uhs-material':
    case 'uhs-anhaenge':
    case 'person-status':
    case 'person-zuordnungen':
    case 'person-anhaenge':
    case 'fremde-module':
      return false;
  }
}

/** {@link geraetDarf} für die Sitzung dieses Tabs. */
export function useGeraetDarf(): (faehigkeit: GeraetFaehigkeit) => boolean {
  const { geraet } = useAuth();
  return (faehigkeit) => geraetDarf(geraet, faehigkeit);
}
