import type {
  EinsatzAnzeige,
  Uhs,
  Schaden,
  Einheit,
  EinsatzFahrzeug,
  FuehrungskraftKarte,
  Einsatzabschnitt,
  LageZone,
  FreiesZeichen,
  Gefahrengebiet,
  LageMeldung,
  KartenAnsicht,
} from '../../api/types';
import type { Hintergrundbild } from '../../api/kartenbilder';

/** Woraus die Lagekarte ihre Objekte zieht (LFH-321, Inkrement C): der Live-Zustand oder ein
 *  eingefrorener Snapshot (Historien-Modus, schreibgeschützt). */
export type Standquelle = { typ: 'live' } | { typ: 'snapshot'; id: number };

/** FE-lokale, getypte Sicht auf das eingefrorene `daten`-Dokument eines Lage-Snapshots.
 *  Das Backend legt rohe `*Anzeige`-DTO-Listen ab (`schema_version = 1`); im generierten Typ ist
 *  `daten` `unknown`, deshalb dieser Cast-Anker. Felder spiegeln `src/lage_snapshot/repo.rs`
 *  (`SnapshotDaten`). `org_default`/`gefahrengebiete[].hoechste_warnstufe` sind mit-eingefroren —
 *  im Snapshot-Modus MÜSSEN sie von hier gespeist werden, nicht aus Live-Queries. */
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
  lagemeldungen: LageMeldung[];
  bilder: Hintergrundbild[];
}
