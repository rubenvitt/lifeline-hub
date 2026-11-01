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
  /**
   * Transport festlegen, Maßnahme erfassen, Verletzung markieren und aufheben (Change
   * `y18v58dt-pat-kern`): wie die Sichtung nur die UHS-Geräte (Routenlisten `UHS_TABLET`,
   * `UHS_LAPTOP`; Betreuungsstelle und Lagemonitor 403, `tests/geraet_kopplung.rs`).
   */
  | 'person-behandlung'
  /** Druckansicht einer Person (LLH-1120): nur am Arbeitsplatz, die Route steht in keiner Liste. */
  | 'person-druck'
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
  /**
   * Material des eigenen Raums lesen (LLH-1252, Entscheidung 22.10.2026): nur lesen, der Server
   * schneidet die Materialliste auf den Raum. Zuordnen und Lösen bleiben der Führungsstelle;
   * kämen sie dazu, als eigene Fähigkeit mit eigenem Eintrag in der Routenliste.
   */
  | 'br-material'
  /**
   * Kräfte aus dem Raum abrufen und einen Abruf zurücknehmen (LLH-1085): eine Entscheidung der
   * Führung, kein Gerät (Routenliste ohne `…/abruf`). Das Ausrücken bucht das Gerät als Austritt.
   */
  | 'br-abrufen'
  /**
   * Eine bereitgestellte Kraft in einen anderen Raum verlegen (LLH-1315): wie der Abruf eine
   * Entscheidung der Führung. Ein Wechsel hinaus wäre für das Gerät ohnehin 404 (`{bid}` ist der
   * Zielraum, `fordere_stelle`).
   */
  | 'br-verlegen'
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
    case 'person-behandlung':
      return geraet.ansicht === 'uhs-tablet' || geraet.ansicht === 'uhs-laptop';
    case 'br-eintreffen':
    case 'br-material':
      return geraet.ansicht === 'bereitstellungsraum';
    case 'uhs-verwalten':
    case 'br-verwalten':
    case 'br-abrufen':
    case 'br-verlegen':
    case 'verpflegung-planen':
    case 'person-status':
    case 'person-zuordnungen':
    case 'person-anhaenge':
    case 'person-druck':
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
