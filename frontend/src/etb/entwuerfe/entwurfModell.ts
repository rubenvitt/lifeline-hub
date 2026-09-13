import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type { EtbTyp, MeldeWeg } from '../../api/types';
import type { MetadatenWerte } from '../schnellerfassungModell';

dayjs.extend(utc);

/** Serialisierbarer Entwurf, wie er in IndexedDB liegt. `ereigniszeit` ist ISO-String. */
export interface EtbEntwurf {
  id: string;
  einsatz_id: number;
  inhalt: string;
  typ: EtbTyp;
  von?: string;
  an?: string;
  /** LFH-461: An-Default wurde bereits berücksichtigt. Ein danach bewusst leerer
   * Entwurf muss Remount/Reload überleben, sonst würde An erneut vorbelegt. */
  an_vorbelegung_geprueft?: true;
  meldeweg?: MeldeWeg;
  veranlassung?: string;
  ereigniszeit?: string;
  erstellt_at: string;
  geaendert_at: string;
}

/** Compose-Werte, wie die Schnellerfassung sie intern hält (mit dayjs). */
export interface EntwurfWerte {
  inhalt: string;
  typ: EtbTyp;
  metadaten: MetadatenWerte;
}

export function zuWerte(e: EtbEntwurf): EntwurfWerte {
  return {
    inhalt: e.inhalt,
    typ: e.typ,
    metadaten: {
      von: e.von,
      an: e.an,
      meldeweg: e.meldeweg,
      veranlassung: e.veranlassung,
      ereigniszeit: e.ereigniszeit ? dayjs.utc(e.ereigniszeit) : undefined,
    },
  };
}

export type EntwurfPatch = Pick<
  EtbEntwurf,
  'inhalt' | 'typ' | 'von' | 'an' | 'meldeweg' | 'veranlassung' | 'ereigniszeit'
>;

export function werteZuPatch(w: EntwurfWerte): EntwurfPatch {
  const m = w.metadaten;
  return {
    inhalt: w.inhalt,
    typ: w.typ,
    von: m.von || undefined,
    an: m.an || undefined,
    meldeweg: m.meldeweg || undefined,
    veranlassung: m.veranlassung || undefined,
    ereigniszeit: m.ereigniszeit ? m.ereigniszeit.utc().toISOString() : undefined,
  };
}

const LABEL_MAX = 30;

export function entwurfLabel(e: EtbEntwurf): string {
  const ersteZeile = e.inhalt
    .split('\n')
    .map((z) => z.trim())
    .find((z) => z.length > 0);
  if (!ersteZeile) return 'Neuer Eintrag';
  return ersteZeile.length > LABEL_MAX ? `${ersteZeile.slice(0, LABEL_MAX)} …` : ersteZeile;
}

export function istLeer(w: EntwurfWerte): boolean {
  const m = w.metadaten;
  const hatMeta = Boolean(m.von || m.an || m.meldeweg || m.veranlassung || m.ereigniszeit);
  return w.inhalt.trim() === '' && !hatMeta;
}
