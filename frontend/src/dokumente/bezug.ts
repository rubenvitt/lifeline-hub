import type { DokumentBezugTyp } from '../api/dokumente';
import type { Dokument } from '../api/types';

/**
 * Der optionale Bezug eines Dokuments als `Select`-Wert — geteilt von Ablegen und Bearbeiten
 * (LFH-656, D4). Der Wert ist `abschnitt:<id>` · `einheit:<id>` · `etb_eintrag:<id>`; getrennt
 * wird beim Absenden.
 */

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

export interface BezugOption {
  value: string;
  label: string;
}

interface Quellen {
  abschnitte: readonly { id: number; name: string }[];
  einheiten: readonly { id: number; name: string }[];
  etb: readonly { id: number; lfd_nr: number; inhalt: string }[];
  /** Beim Bearbeiten: sein Bezug muss als Option stehen, auch wenn er nicht geladen ist. */
  aktuell?: Dokument | null;
  /** Der getippte Begriff. Abschnitte, Einheiten und den ergänzten Bezug filtert er am Label;
   *  die ETB-Einträge kommen schon gewählt (`waehleEtbEintraege` in `bezugswahl.ts`). */
  suche?: string;
}

/** Ergänzt `fehlend`, wenn sein Wert noch nicht unter den Optionen steht. */
function mit(optionen: BezugOption[], fehlend: BezugOption | null): BezugOption[] {
  return fehlend && !optionen.some((o) => o.value === fehlend.value)
    ? [...optionen, fehlend]
    : optionen;
}

/** Die Option zum aktuellen Bezug eines Dokuments — Label aus dem Dokument selbst. */
export function aktuelleBezugOption(d: Dokument | null | undefined): BezugOption | null {
  if (d?.bezug_abschnitt_id != null)
    return {
      value: `abschnitt:${d.bezug_abschnitt_id}`,
      label: d.bezug_abschnitt_name ?? `Abschnitt #${d.bezug_abschnitt_id}`,
    };
  if (d?.bezug_einheit_id != null)
    return {
      value: `einheit:${d.bezug_einheit_id}`,
      label: d.bezug_einheit_name ?? `Einheit #${d.bezug_einheit_id}`,
    };
  if (d?.bezug_etb_eintrag_id != null)
    return {
      value: `etb_eintrag:${d.bezug_etb_eintrag_id}`,
      label:
        d.bezug_etb_lfd_nr != null
          ? `ETB ${d.bezug_etb_lfd_nr}`
          : `ETB-Eintrag #${d.bezug_etb_eintrag_id}`,
    };
  return null;
}

/**
 * Gruppierte Optionen für das Bezug-`Select`; leere Gruppen fallen weg. Steht der aktuelle Bezug
 * nicht in den geladenen Listen (ETB-Eintrag älter als die jüngsten `ETB_BEZUG_DECKEL`, oder die
 * Liste lädt noch), kommt er aus dem Dokument selbst dazu — sonst zeigte das `Select` den Rohwert
 * `etb_eintrag:123`. Ein Suchbegriff, zu dem er nicht passt, blendet ihn aus wie jede Option.
 */
export function bezugOptionen({ abschnitte, einheiten, etb, aktuell, suche = '' }: Quellen) {
  const begriff = suche.trim().toLowerCase();
  const passt = (o: BezugOption) => !begriff || o.label.toLowerCase().includes(begriff);
  const zusatz = aktuelleBezugOption(aktuell);
  const ergaenzt = (praefix: string) =>
    zusatz?.value.startsWith(`${praefix}:`) && passt(zusatz) ? zusatz : null;
  return [
    {
      label: 'Abschnitte',
      options: mit(
        abschnitte.map((a) => ({ value: `abschnitt:${a.id}`, label: a.name })).filter(passt),
        ergaenzt('abschnitt'),
      ),
    },
    {
      label: 'Einheiten',
      options: mit(
        einheiten.map((e) => ({ value: `einheit:${e.id}`, label: e.name })).filter(passt),
        ergaenzt('einheit'),
      ),
    },
    {
      label: 'ETB-Einträge',
      options: mit(
        etb.map((e) => ({
          value: `etb_eintrag:${e.id}`,
          label: `ETB ${e.lfd_nr} · ${kuerze(e.inhalt, 60)}`,
        })),
        ergaenzt('etb_eintrag'),
      ),
    },
  ].filter((g) => g.options.length > 0);
}
