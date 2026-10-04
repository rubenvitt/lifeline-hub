import { useEffect, useMemo, useState } from 'react';
import type { SelectProps } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { einsatzKeys } from '../api/queryKeys';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinheiten } from '../api/einheiten';
import { listeEtb } from '../api/etb';
import type { Dokument, EtbEintragAnzeige } from '../api/types';
import { aktuelleBezugOption, bezugOptionen, type BezugOption } from './bezug';

/** So viele ETB-Einträge stehen ohne Suchbegriff als Bezug zur Wahl (die jüngsten). Was älter
 *  ist, findet die Suche am Server (LFH-655). */
export const ETB_BEZUG_DECKEL = 100;

/** Server-Treffer zu genau einem Suchbegriff; `eintraege` ist `null`, wenn die Suche scheiterte. */
export interface EtbSuchTreffer {
  begriff: string;
  eintraege: EtbEintragAnzeige[] | null;
}

/** Das Präfix „ETB“ trägt jede Option, im Volltext steht es nicht. */
const ohnePraefix = (suche: string) => suche.replace(/^etb(?=\s|\d|$)\s*/i, '').trim();

/** Die laufende Nummer, wenn der Begriff eine ist („412“ oder „ETB 412“), sonst `null`. */
function etbNummer(suche: string): number | null {
  const rest = ohnePraefix(suche);
  if (!/^\d+$/.test(rest)) return null;
  const nummer = Number(rest);
  // Über `Number.MAX_SAFE_INTEGER` liefe `nummer + 1` aus dem i64 des Servers und risse die
  // ganze Suche in den Fehlerzweig.
  return Number.isSafeInteger(nummer) && nummer > 0 ? nummer : null;
}

/**
 * Sucht ETB-Einträge für die Bezugswahl am Server (LFH-655), über den ganzen Einsatz:
 *
 * - die Volltextsuche (`q`, gedeckelt). Sie trifft nur GANZE Wörter (`fts_query` in
 *   `src/etb/repo.rs`); Wortanfänge deckt {@link waehleEtbEintraege} über das jüngste Fenster ab.
 * - bei einer laufenden Nummer den Eintrag mit genau dieser Nummer. Ihn holt der Cursor
 *   (`before_lfd_nr` = n + 1, `limit` 1) wie den Zahlenzweig der Sprungpalette
 *   (`etbNummerSchluessel` in `command-palette/datensatzAbfrage.ts`); ob die Antwort die gesuchte
 *   Nummer trägt, prüft auch hier der Aufrufer.
 */
export async function sucheEtbBezuege(
  einsatzId: number,
  suche: string,
): Promise<EtbEintragAnzeige[]> {
  const begriff = ohnePraefix(suche);
  const nummer = etbNummer(suche);
  const [volltext, perNummer] = await Promise.all([
    begriff ? listeEtb(einsatzId, { q: begriff, limit: ETB_BEZUG_DECKEL }) : Promise.resolve([]),
    nummer != null
      ? listeEtb(einsatzId, { before_lfd_nr: nummer + 1, limit: 1 })
      : Promise.resolve([]),
  ]);
  return [...perNummer.filter((e) => e.lfd_nr === nummer), ...volltext];
}

/**
 * Die ETB-Einträge, die die Bezugswahl zu einem getippten Begriff anbietet.
 *
 * Das jüngste Fenster filtert immer der Client am sichtbaren Text („ETB 412 · …“): so treffen
 * Wortanfänge und Teilnummern, und solange die Server-Antwort für GENAU diesen Begriff fehlt
 * (entprellt, unterwegs, gescheitert), steht nie ein Eintrag zur Wahl, der nicht passt — Enter
 * nähme sonst den ersten unpassenden. Gehören die Server-Treffer zum Begriff, kommen sie dazu:
 * der Eintrag mit genau der getippten Nummer vorn, sonst absteigend nach laufender Nummer.
 */
export function waehleEtbEintraege(
  fenster: EtbEintragAnzeige[],
  treffer: EtbSuchTreffer | null,
  suche: string,
): EtbEintragAnzeige[] {
  const begriff = suche.trim();
  if (!begriff) return fenster;
  const klein = begriff.toLowerCase();
  const lokal = fenster.filter((e) =>
    `etb ${e.lfd_nr} · ${e.inhalt}`.toLowerCase().includes(klein),
  );
  if (treffer?.begriff !== begriff || !treffer.eintraege) return lokal;

  const nummer = etbNummer(begriff);
  const alle = new Map<number, EtbEintragAnzeige>();
  for (const e of [...treffer.eintraege, ...lokal]) alle.set(e.id, e);
  return [...alle.values()].sort(
    (a, b) => Number(b.lfd_nr === nummer) - Number(a.lfd_nr === nummer) || b.lfd_nr - a.lfd_nr,
  );
}

/**
 * Hält einen Wert fest, solange eine Auswahlliste offen ist — „kein Sprung unter dem Cursor“
 * (WCAG 3.2.5, `frontend/AGENTS.md`, Layout und Live). Ein Live-Update, das bei offener Liste
 * eintrifft, schiebt nichts ein und verschiebt keine Gruppe; es erscheint beim nächsten Öffnen.
 *
 * `stand` benennt, WAS gerade geladen vorliegt (der Suchbegriff, zu dem die Daten gehören), und
 * ist `null`, solange noch geladen wird. Ein neuer Stand ist eine Handlung des Menschen (er hat
 * gesucht) und darf die Liste neu aufbauen; ein Nachladen desselben Standes nicht. Bevor der
 * erste Stand da ist, zeigt die Liste den Ladezustand wie bisher.
 */
export function useStandWaehrendOffen<T>(live: T, offen: boolean, stand: string | null): T {
  const [bild, setBild] = useState<{ stand: string | null; wert: T } | null>(null);
  if (!offen) {
    if (bild !== null) setBild(null);
    return live;
  }
  if (bild === null || (stand !== null && stand !== bild.stand)) {
    setBild({ stand, wert: live });
    return live;
  }
  // Ein Bild aus der Ladephase ist noch kein Stand: bis der erste ankommt, gilt der Live-Wert.
  return bild.stand === null ? live : bild.wert;
}

/** Frist, nach der ein getippter Bezug-Suchbegriff an den Server geht. */
const ENTPRELLUNG_MS = 300;

/** Was die Bezugswahl geladen hat — eingefroren wird dieser Stand, gefiltert erst danach. */
interface BezugDaten {
  abschnitte: readonly { id: number; name: string }[];
  einheiten: readonly { id: number; name: string }[];
  fenster: EtbEintragAnzeige[];
  treffer: EtbSuchTreffer | null;
}

/** Die Props, die die Bezugswahl dem `Select` des Bezugsfelds gibt. */
export type BezugSelectProps = Pick<
  SelectProps<string>,
  'loading' | 'options' | 'showSearch' | 'onOpenChange' | 'onChange' | 'labelRender'
>;

/**
 * Die Bezugswahl der Dokumentenablage (LFH-655), geteilt von Ablegen und Bearbeiten (LFH-886).
 *
 * Die offene Liste steht still (`useStandWaehrendOffen`) — ein neuer ETB-Eintrag oder Abschnitt
 * erscheint erst beim nächsten Öffnen. ETB-Einträge sucht zusätzlich der Server
 * (`sucheEtbBezuege`, auch per laufender Nummer, entprellt), zusammengeführt in
 * `waehleEtbEintraege`; Abschnitte und Einheiten filtert der Client (`bezugOptionen`).
 *
 * - `offen` schaltet Abschnitte und Einheiten, `etbLaden` die ETB-Einträge (der Ablege-Dialog
 *   lädt sie erst beim Aufklappen des Bezugs).
 * - `aktuell` ist beim Bearbeiten das Dokument: sein Bezug steht als Option, auch wenn er nicht
 *   geladen ist, und zeigt nie den Rohwert.
 *
 * `selectProps` gehört ungeteilt an das `Select`; `zuruecksetzen` gehört ins Schließen des Dialogs.
 */
export function useBezugswahl(
  einsatzId: number,
  { offen, etbLaden, aktuell }: { offen: boolean; etbLaden: boolean; aktuell?: Dokument | null },
) {
  const [listeOffen, setListeOffen] = useState(false);
  const [suche, setSuche] = useState('');
  const [etbSuche, setEtbSuche] = useState('');
  /** Der gewählte Bezug mit seinem Label: ein ETB-Treffer aus einer Suche steht nach dem Leeren
   *  der Suche nicht mehr unter den Optionen, und das Feld zeigte sonst den rohen Schlüssel
   *  `etb_eintrag:<id>`. Antds Label-Cache trägt das nicht — er füllt sich nur, wenn Wert und
   *  Option einmal gemeinsam gerendert wurden, und das Leeren wirkt im selben Takt wie die Wahl. */
  const [gewaehlt, setGewaehlt] = useState<BezugOption | null>(null);

  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
    enabled: offen,
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
    enabled: offen,
  });
  // Entprellt wird nur das Tippen; Leeren wirkt sofort (`leereSuche`), sonst zeigte ein schnelles
  // Wiederöffnen die alten Treffer und baute sich nach der Frist unter dem Cursor um.
  useEffect(() => {
    const begriff = suche.trim();
    if (!begriff || begriff === etbSuche) return;
    const frist = setTimeout(() => setEtbSuche(begriff), ENTPRELLUNG_MS);
    return () => clearTimeout(frist);
  }, [suche, etbSuche]);
  function leereSuche() {
    setSuche('');
    setEtbSuche('');
  }
  // Eigene Filter im Key, damit die Abfragen nicht das Cache-Fach der Infinite-Query von
  // `EtbPage` teilen; unter `einsatzKeys.etb` bleiben sie, damit Live-Updates sie erreichen.
  const fensterQuery = useQuery({
    queryKey: einsatzKeys.etbListe(einsatzId, { limit: ETB_BEZUG_DECKEL }),
    queryFn: () => listeEtb(einsatzId, { limit: ETB_BEZUG_DECKEL }),
    enabled: offen && etbLaden,
  });
  const sucheQuery = useQuery({
    queryKey: einsatzKeys.etbListe(einsatzId, { limit: ETB_BEZUG_DECKEL, bezug: etbSuche }),
    queryFn: () => sucheEtbBezuege(einsatzId, etbSuche),
    enabled: offen && etbLaden && etbSuche !== '',
  });

  const trefferDaten = sucheQuery.data;
  const trefferGescheitert = sucheQuery.isError;
  const liveDaten = useMemo<BezugDaten>(
    () => ({
      abschnitte: abschnitteQuery.data ?? [],
      einheiten: einheitenQuery.data ?? [],
      fenster: fensterQuery.data ?? [],
      treffer: !etbSuche
        ? null
        : trefferDaten
          ? { begriff: etbSuche, eintraege: trefferDaten }
          : trefferGescheitert
            ? { begriff: etbSuche, eintraege: null }
            : null,
    }),
    [
      abschnitteQuery.data,
      einheitenQuery.data,
      fensterQuery.data,
      etbSuche,
      trefferDaten,
      trefferGescheitert,
    ],
  );
  // „Geladen" heißt abgeschlossen, nicht erfolgreich: ohne Modulrecht antwortet eine Quelle mit
  // 403 und bliebe sonst für immer „unterwegs" — das Einfrieren wäre damit still abgeschaltet.
  const geladen =
    !abschnitteQuery.isPending &&
    !einheitenQuery.isPending &&
    !fensterQuery.isPending &&
    (etbSuche === '' || !sucheQuery.isPending);
  const daten = useStandWaehrendOffen(liveDaten, listeOffen, geladen ? etbSuche : null);

  // Gefiltert wird NACH dem Einfrieren: was der Mensch tippt, darf die Liste ändern.
  const optionen = bezugOptionen({
    abschnitte: daten.abschnitte,
    einheiten: daten.einheiten,
    etb: waehleEtbEintraege(daten.fenster, daten.treffer, suche),
    aktuell,
    suche,
  });
  const etbLaedt =
    etbLaden &&
    (fensterQuery.isLoading ||
      (suche.trim() !== '' && (suche.trim() !== etbSuche || sucheQuery.isLoading)));
  // Rückfall für den Bezug des Dokuments, falls das `Select` ihn ohne Option rendert.
  const zusatz = aktuelleBezugOption(aktuell);

  const selectProps: BezugSelectProps = {
    loading: etbLaedt,
    options: optionen,
    showSearch: {
      filterOption: false,
      onSearch: (wert) => (wert.trim() ? setSuche(wert) : leereSuche()),
    },
    onOpenChange: (auf) => {
      setListeOffen(auf);
      if (!auf) leereSuche();
    },
    onChange: (_wert, option) => {
      leereSuche();
      const o = Array.isArray(option) ? undefined : option;
      setGewaehlt(o && 'value' in o ? { value: String(o.value), label: String(o.label) } : null);
    },
    labelRender: ({ value, label }) => {
      if (value === gewaehlt?.value) return gewaehlt.label;
      if (value === zusatz?.value && (label == null || label === value)) return zusatz.label;
      return label;
    },
  };

  function zuruecksetzen() {
    setListeOffen(false);
    leereSuche();
    setGewaehlt(null);
  }

  return { selectProps, zuruecksetzen };
}
