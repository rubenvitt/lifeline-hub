import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type { EtbTyp, MeldeWeg } from '../../api/types';
import type { MetadatenWerte } from '../schnellerfassungModell';

dayjs.extend(utc);

/** Serialisierbarer Entwurf, wie er in IndexedDB liegt. `ereigniszeit` ist ISO-String. */
export interface EtbEntwurf {
  id: string;
  /** Wer den Entwurf geschrieben hat (LFH-767): nur diese Person sieht ihn. */
  benutzer_id: number;
  einsatz_id: number;
  inhalt: string;
  typ: EtbTyp;
  von?: string;
  an?: string;
  meldeweg?: MeldeWeg;
  veranlassung?: string;
  ereigniszeit?: string;
  /**
   * „Nur protokollieren“ (LLH-1037): der Eintrag geht nicht in den Meldungseingang. Optional,
   * fehlt im Bestand von vor LLH-1037 (= aus); kein Versionssprung (`offline/AGENTS.md`).
   */
  nur_protokollieren?: boolean;
  erstellt_at: string;
  geaendert_at: string;
}

/** Compose-Werte, wie die Schnellerfassung sie intern hält (mit dayjs). */
export interface EntwurfWerte {
  inhalt: string;
  typ: EtbTyp;
  metadaten: MetadatenWerte;
  /** „Nur protokollieren“ (LLH-1037); fehlt = aus. Kein Inhalt: zählt nicht für {@link istLeer}. */
  nurProtokollieren?: boolean;
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
    nurProtokollieren: e.nur_protokollieren ?? false,
  };
}

type EntwurfPatch = Pick<
  EtbEntwurf,
  | 'inhalt'
  | 'typ'
  | 'von'
  | 'an'
  | 'meldeweg'
  | 'veranlassung'
  | 'ereigniszeit'
  | 'nur_protokollieren'
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
    nur_protokollieren: w.nurProtokollieren || undefined,
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
