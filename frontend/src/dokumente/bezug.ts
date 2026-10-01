import { useQuery } from '@tanstack/react-query';
import { einsatzKeys } from '../api/queryKeys';
import type { DokumentBezugTyp } from '../api/dokumente';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinheiten } from '../api/einheiten';
import { listeEtb } from '../api/etb';
import type { Dokument } from '../api/types';

/**
 * Der optionale Bezug eines Dokuments als `Select`-Wert — geteilt von Ablegen und Bearbeiten
 * (LFH-656, D4). Der Wert ist `abschnitt:<id>` · `einheit:<id>` · `etb_eintrag:<id>`; getrennt
 * wird beim Absenden.
 */

/** So viele ETB-Einträge stehen als Bezug zur Wahl (die jüngsten). Eigener Filter im Key, damit
 *  die Abfrage nicht das Cache-Fach der Infinite-Query von `EtbPage` teilt. */
export const ETB_BEZUG_DECKEL = 100;
const BEZUG_TYPEN: readonly DokumentBezugTyp[] = ['abschnitt', 'einheit', 'etb_eintrag'];
const kuerze = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** Der Bezug eines Dokuments als `Select`-Wert; ohne Bezug `undefined`. */
export function bezugWert(d: Dokument): string | undefined {
  if (d.bezug_abschnitt_id != null) return `abschnitt:${d.bezug_abschnitt_id}`;
  if (d.bezug_einheit_id != null) return `einheit:${d.bezug_einheit_id}`;
  if (d.bezug_etb_eintrag_id != null) return `etb_eintrag:${d.bezug_etb_eintrag_id}`;
  return undefined;
}

/** `Select`-Wert → Bezug. Ein unbekannter Präfix oder eine kaputte id fällt weg, statt einen
 *  halben Bezug zu senden. */
export function bezugAusWert(
  wert: string | undefined,
): { typ: DokumentBezugTyp; id: number } | undefined {
  if (!wert) return undefined;
  const trenner = wert.lastIndexOf(':');
  const typ = wert.slice(0, trenner) as DokumentBezugTyp;
  const id = Number(wert.slice(trenner + 1));
  return BEZUG_TYPEN.includes(typ) && Number.isInteger(id) && id > 0 ? { typ, id } : undefined;
}

interface Option {
  value: string;
  label: string;
}

interface Quellen {
  abschnitte: readonly { id: number; name: string }[];
  einheiten: readonly { id: number; name: string }[];
  etb: readonly { id: number; lfd_nr: number; inhalt: string }[];
  /** Beim Bearbeiten: sein Bezug muss als Option stehen, auch wenn er nicht geladen ist. */
  aktuell?: Dokument | null;
}

/** Ergänzt `fehlend`, wenn sein Wert noch nicht unter den Optionen steht. */
function mit(optionen: Option[], fehlend: Option | null): Option[] {
  return fehlend && !optionen.some((o) => o.value === fehlend.value)
    ? [...optionen, fehlend]
    : optionen;
}

/**
 * Gruppierte Optionen für das Bezug-`Select`. Steht der aktuelle Bezug nicht in den geladenen
 * Listen (ETB-Eintrag älter als die jüngsten {@link ETB_BEZUG_DECKEL}, oder die Liste lädt noch),
 * kommt er aus dem Dokument selbst dazu — sonst zeigte das `Select` den Rohwert `etb_eintrag:123`.
 */
export function bezugOptionen({ abschnitte, einheiten, etb, aktuell }: Quellen) {
  const d = aktuell ?? null;
  return [
    {
      label: 'Abschnitte',
      options: mit(
        abschnitte.map((a) => ({ value: `abschnitt:${a.id}`, label: a.name })),
        d?.bezug_abschnitt_id != null
          ? {
              value: `abschnitt:${d.bezug_abschnitt_id}`,
              label: d.bezug_abschnitt_name ?? `Abschnitt #${d.bezug_abschnitt_id}`,
            }
          : null,
      ),
    },
    {
      label: 'Einheiten',
      options: mit(
        einheiten.map((e) => ({ value: `einheit:${e.id}`, label: e.name })),
        d?.bezug_einheit_id != null
          ? {
              value: `einheit:${d.bezug_einheit_id}`,
              label: d.bezug_einheit_name ?? `Einheit #${d.bezug_einheit_id}`,
            }
          : null,
      ),
    },
    {
      label: 'ETB-Einträge',
      options: mit(
        etb.map((e) => ({
          value: `etb_eintrag:${e.id}`,
          label: `ETB ${e.lfd_nr} · ${kuerze(e.inhalt, 60)}`,
        })),
        d?.bezug_etb_eintrag_id != null
          ? {
              value: `etb_eintrag:${d.bezug_etb_eintrag_id}`,
              label:
                d.bezug_etb_lfd_nr != null
                  ? `ETB ${d.bezug_etb_lfd_nr}`
                  : `ETB-Eintrag #${d.bezug_etb_eintrag_id}`,
            }
          : null,
      ),
    },
  ];
}

/**
 * Lädt die Bezugsziele und baut die Optionen. `aktiv` schaltet Abschnitte und Einheiten,
 * `etbLaden` die ETB-Einträge (der Ablege-Dialog lädt sie erst beim Aufklappen des Bezugs).
 */
export function useBezugOptionen(
  einsatzId: number,
  { aktiv, etbLaden, aktuell }: { aktiv: boolean; etbLaden: boolean; aktuell?: Dokument | null },
) {
  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
    enabled: aktiv,
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
    enabled: aktiv,
  });
  const etbQuery = useQuery({
    queryKey: einsatzKeys.etbListe(einsatzId, { limit: ETB_BEZUG_DECKEL }),
    queryFn: () => listeEtb(einsatzId, { limit: ETB_BEZUG_DECKEL }),
    enabled: aktiv && etbLaden,
  });
  return {
    optionen: bezugOptionen({
      abschnitte: abschnitteQuery.data ?? [],
      einheiten: einheitenQuery.data ?? [],
      etb: etbQuery.data ?? [],
      aktuell,
    }),
    etbLaedt: etbLaden && etbQuery.isLoading,
  };
}
