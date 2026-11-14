import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import { listePersonal } from '../api/personal';
import {
  aenderePlanungBlock,
  erzeugePlanungSchichten,
  legePlanungBlockAn,
  loadPlanungMappe,
  loeschePlanungBlock,
} from '../api/planungen';
import { globalKeys } from '../api/queryKeys';
import type { Planung } from '../api/types';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { datum, tagUndUhrzeit } from '../anzeige/zeitDarstellung';
import { Segmentleiste } from '../components/instrument';
import { Select } from '../components/Select';
import { AusgabeKnoepfe } from '../abloesung/schichtplan/ausgabe/SchichtplanAusgabeKnoepfe';
import { mappeDateiname } from '../abloesung/schichtplan/ausgabe/mappeDateiname';
import SchichtplanEditor, {
  type SchichtplanEditorAdapter,
} from '../abloesung/schichtplan/SchichtplanEditor';
import { alsRasterBlock } from '../abloesung/schichtplan/schichtplanZeilen';
import { useUhr } from '../abloesung/useUhr';
import { planungDruckPfad } from '../routing/deeplinks';
import {
  blockAendernBody,
  blockBody,
  erzeugenBody,
  GANZE_PLANUNG,
  laengenVorgaben,
  planungPersonen,
  planungSpanne,
  planungTage,
  planungZeilen,
  qualiVorgaben,
  schichtplanBloecke,
  sollVorgaben,
} from './planungZeilen';
import { uebernimmPlanung } from './planungCache';

/**
 * Reiter „Plan“ einer Planung (LLH-1586, Spec `vorplanung`): dasselbe Raster wie der
 * Schichtplan im Einsatz (`abloesung/schichtplan`), mit den Posten der Planung als Zeilen, der
 * Seitenleiste mit Stamm-Personal und Helfern, Blockdialog und „Schichten erzeugen“. Auf dem
 * Handschirm die Liste mit allen Blöcken je Posten.
 *
 * Die Zeitspanne ist die ganze Planung oder ein Tag; vorgewählt ist der erste Tag. Bis drei Tage
 * stehen als Segmente, mehr als Auswahl (Abstimmung 08.11.2026).
 *
 * Kein eigener Rechenweg: jeder Schreibweg antwortet mit der ganzen Planung, die den Cache
 * ersetzt; live kommt sie über `planung`. Der Adapter (`planungZeilen.ts`) übersetzt Blöcke und
 * Bodies zwischen Planung und den Bausteinen des Einsatzes.
 *
 * Hülle des gemeinsamen `SchichtplanEditor` (Change `y106s29r-blockplan-kern`, D6): hier stehen
 * nur Zeilen, Personen, Vorgaben, Zeitspanne, Ausgabe und die Aufrufe der API der Planung samt
 * Übersetzung der Bodies; Mutationen, Zug und Ablage und die Dialoge trägt der Editor.
 */

/** Bis zu so vielen Tagen stehen die Tage als Segmente. */
const TAGE_ALS_SEGMENTE = 3;

export default function PlanungSchichtplan({
  planung,
  readOnly = false,
}: {
  planung: Planung;
  /** Übernommen (LLH-1587): Raster und Blöcke nur zum Ansehen, ohne Anlegen und Ziehen. */
  readOnly?: boolean;
}) {
  const planungId = planung.kopf.id;
  const qc = useQueryClient();
  const { konventionen } = useAnzeigeKonventionen();
  const jetzt = useUhr().valueOf();

  const stammQuery = useQuery({
    queryKey: globalKeys.personalListe('im-dienst'),
    queryFn: () => listePersonal(true),
  });

  const sbloecke = useMemo(() => schichtplanBloecke(planung), [planung]);
  const bloecke = useMemo(() => sbloecke.map(alsRasterBlock), [sbloecke]);
  const zeilen = useMemo(() => planungZeilen(planung.posten), [planung.posten]);
  const personen = useMemo(
    () => (stammQuery.data ? planungPersonen(stammQuery.data, planung.helfer) : null),
    [stammQuery.data, planung.helfer],
  );
  const sollVorgabe = useMemo(() => sollVorgaben(planung.posten), [planung.posten]);
  const qualiVorgabe = useMemo(() => qualiVorgaben(planung.posten), [planung.posten]);
  const laengeVorgabe = useMemo(() => laengenVorgaben(planung.posten), [planung.posten]);

  // ── Zeitspanne: ganze Planung oder ein Tag, vorgewählt der erste.
  const tage = useMemo(
    () => planungTage(planung.kopf, konventionen.zeitzone),
    [planung.kopf, konventionen.zeitzone],
  );
  const [wahlRoh, setWahl] = useState<string | null>(null);
  // Ändert sich der Zeitraum, kann der gewählte Tag fehlen: dann der erste.
  const wahl =
    wahlRoh === GANZE_PLANUNG || tage.some((t) => t.schluessel === wahlRoh)
      ? (wahlRoh as string)
      : (tage[0]?.schluessel ?? GANZE_PLANUNG);
  const spanne = useMemo(
    () => planungSpanne(wahl, planung.kopf, tage, bloecke),
    [wahl, planung.kopf, tage, bloecke],
  );
  const spannenOptionen = [
    { wert: GANZE_PLANUNG, label: 'Ganze Planung' },
    ...tage.map((t) => ({ wert: t.schluessel, label: datum(dayjs(t.von), konventionen) })),
  ];

  // ── Adapter des Editors ── Jede Antwort ist die ganze Planung; sie ersetzt den Cache, ein
  // Abruf folgt.
  const adapter: SchichtplanEditorAdapter<Planung> = {
    dataLfh: 'planung-plan',
    bloecke: sbloecke,
    rasterBloecke: bloecke,
    getBloecke: schichtplanBloecke,
    zeilen,
    personen,
    sollVorgabe,
    qualiVorgabe,
    laengeVorgabe,
    schichtmodell: null,
    jetzt,
    spanne,
    spanneSelect:
      tage.length <= TAGE_ALS_SEGMENTE ? (
        <Segmentleiste
          beschriftung="Zeitspanne"
          wert={wahl}
          onWechsel={setWahl}
          optionen={spannenOptionen}
          style={{ flex: 'none' }}
        />
      ) : (
        <Select<string>
          aria-label="Zeitspanne"
          value={wahl}
          onChange={setWahl}
          options={spannenOptionen.map((o) => ({ value: o.wert, label: o.label }))}
          style={{ minWidth: 160 }}
        />
      ),
    canWrite: !readOnly,
    isErzeugenDisabled: planung.posten.length === 0,
    beschriftung: 'Planung',
    fehlerTitel: 'Planung nicht geändert',
    // Ausgabe wie im Einsatz (LLH-1593): Aushang und Zettel, Excel-Mappe. Wer die Planung lesen
    // darf, sieht auch das Personal; „Excel“ ist deshalb nie gesperrt.
    tools: (
      <AusgabeKnoepfe
        druckPfad={planungDruckPfad(planungId)}
        schluessel={`planung-${planungId}`}
        ladeMappe={() => loadPlanungMappe(planungId)}
        dateiname={() => mappeDateiname(planung.kopf.bezeichnung, `planung-${planungId}`)}
        personalFrei
      />
    ),
    // Die Liste fürs Handy nennt den Tag: eine Planung reicht über mehrere.
    liste: { formatZeit: (ms) => tagUndUhrzeit(dayjs(ms), konventionen), alleBloecke: true },
    api: {
      create: (body) => legePlanungBlockAn(planungId, blockBody(body)),
      update: (blockId, body) => aenderePlanungBlock(planungId, blockId, blockAendernBody(body)),
      delete: (b) => loeschePlanungBlock(planungId, b.id, b.version),
      erzeugen: (body) => erzeugePlanungSchichten(planungId, erzeugenBody(body)),
    },
    cache: {
      get: () => qc.getQueryData<Planung>(globalKeys.planung(planungId)),
      set: (p) => uebernimmPlanung(qc, p),
      invalidate: () => void qc.invalidateQueries({ queryKey: globalKeys.planung(planungId) }),
    },
    // Die Vorplanung kennt keinen Wechsel aus dem Plan.
  };

  return <SchichtplanEditor adapter={adapter} />;
}
