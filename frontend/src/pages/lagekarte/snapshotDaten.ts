import type {
  Betreuungsstelle,
  BrListenEintrag,
  EinsatzAnzeige,
  Evakuierungsbezirk,
  Uhs,
  Schaden,
  Einheit,
  EinsatzFahrzeug,
  FuehrungskraftKarte,
  Einsatzabschnitt,
  LageZone,
  FreiesZeichen,
  Gefahrengebiet,
  LageMeldungStand,
  KartenAnsicht,
} from '../../api/types';
import type { Hintergrundbild } from '../../api/kartenbilder';
import type { TierKartenEintrag } from './tierMarker';

/**
 * Woraus die Lagekarte ihre Objekte zieht: der Live-Zustand oder ein eingefrorener Snapshot
 * (Historien-Modus, schreibgeschützt).
 */
export type Standquelle = { typ: 'live' } | { typ: 'snapshot'; id: number };

/**
 * FE-lokale, getypte Sicht auf das eingefrorene `daten`-Dokument eines Lage-Snapshots. Das Backend
 * legt rohe `*Anzeige`-DTO-Listen ab (`schema_version = 1`); im generierten Typ ist `daten`
 * `unknown`, deshalb dieser Cast-Anker. Die Felder spiegeln `SnapshotDaten` in
 * `src/lage_snapshot/repo.rs`. `org_default` und `gefahrengebiete[].hoechste_warnstufe` sind mit
 * eingefroren — im Snapshot-Modus müssen sie von hier kommen, nicht aus Live-Queries.
 */
export interface SnapshotDaten {
  version: number;
  stand_at: string;
  org_default?: string | null;
  einsatz: EinsatzAnzeige;
  ansichten: KartenAnsicht[];
  uhs: Uhs[];
  schaeden: Schaden[];
  einheiten: Einheit[];
  fahrzeuge: EinsatzFahrzeug[];
  fuehrungskraefte: FuehrungskraftKarte[];
  abschnitte: Einsatzabschnitt[];
  zonen: LageZone[];
  freie_zeichen: FreiesZeichen[];
  gefahrengebiete: Gefahrengebiet[];
  /** Ältere Stände tragen die Form von vor LLH-1031 (siehe `LageMeldungStand`). */
  lagemeldungen: LageMeldungStand[];
  bilder: Hintergrundbild[];
  /**
   * Betreuungsstellen. Optional: ältere Snapshots tragen das Feld nicht, und der Server lässt es
   * für Personen ohne Modul „Betreuung" weg — beides heißt „keine", nicht Fehler.
   */
  betreuungsstellen?: Betreuungsstelle[];
  /**
   * Evakuierungsbezirke für Beschriftung und Inspector der Bezirksflächen — optional wie
   * `betreuungsstellen`.
   */
  evakuierungsbezirke?: Evakuierungsbezirk[];
  /**
   * Bereitstellungsräume mit Status, Koordinate und Belegung (LLH-1107). Optional wie
   * `betreuungsstellen`: ältere Stände tragen das Feld nicht, und ohne Modul
   * „Bereitstellungsräume" lässt der Server es weg.
   */
  bereitstellungsraeume?: BrListenEintrag[];
  /**
   * Offene und vermisste Tiere mit Fundort-Koordinate (LLH-1123), schmal ohne Halter und Notiz
   * (`TierKarte` in `src/tier/mod.rs`). Optional wie `bereitstellungsraeume`.
   */
  tiere?: TierKartenEintrag[];
}
