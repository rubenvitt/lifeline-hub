import type { LageberichtVorlageKey } from '../api/types';
import { MEDIENLAGE_QUELLE } from '../stab/medienlageUebernahme';
import { EIGENE_LAGE_QUELLE } from './eigeneLageUebernahme';
import type { UebernahmeQuelle } from './uebernahmeQuelle';

/**
 * Zuordnung Abschnitt → Quelle für die Übernahme in einen Lagevortrag (LFH-870, Spec
 * `lagevortrag-uebernahme`). Ein Baustein je Abschnitt der bestehenden Vorlage, kein
 * Vortragsschema als Datenmodell (LFH-46 §2.3). Der Lagevortrag zur Entscheidung bleibt von Hand
 * (LFH-869); eine neue Quelle (LFH-871 bis 873) ist ein Eintrag hier.
 */
export const UEBERNAHMEN: Partial<Record<LageberichtVorlageKey, Record<string, UebernahmeQuelle>>> =
  {
    lagebericht: {
      eigene_lage: EIGENE_LAGE_QUELLE,
      medienlage: MEDIENLAGE_QUELLE,
    },
  };

export function uebernahmeFuer(
  vorlage: LageberichtVorlageKey,
  schluessel: string,
): UebernahmeQuelle | undefined {
  const abschnitte = UEBERNAHMEN[vorlage];
  // Eigene Eigenschaft: ein Schlüssel wie „constructor“ fände sonst den Prototyp.
  return abschnitte && Object.prototype.hasOwnProperty.call(abschnitte, schluessel)
    ? abschnitte[schluessel]
    : undefined;
}
