import { Alert, Button } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { fetchEinsatzSchichtmodell } from '../../api/abloesungen';
import { listeEinheiten } from '../../api/einheiten';
import { listeEinsatzPersonal } from '../../api/einsatzPersonal';
import { listeUhs } from '../../api/einsatzUhs';
import { listePersonal } from '../../api/personal';
import { einsatzKeys, globalKeys } from '../../api/queryKeys';
import {
  aendereSchichtplanBlock,
  erzeugeSchichten,
  fetchSchichtplan,
  legeSchichtplanBlockAn,
  loescheSchichtplanBlock,
} from '../../api/schichtplan';
import type {
  AbloesungVorgabe,
  QualiSollEintrag,
  Schichtplan,
  SchichtplanBlock,
} from '../../api/types';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { datum, uhrzeit } from '../../anzeige/zeitDarstellung';
import { alsZeitpunkt } from '../../anzeige/zeitEingabe';
import { Segmentleiste, useRollen } from '../../components/instrument';
import { MODUL_PERSONAL_GESPERRT } from '../../components/nurAnsicht';
import { istKeyFreigegeben } from '../../einsatz/modulRegistry';
import { useModulFreigaben } from '../../einsatz/useSprungSperre';
import { formatRegelKurz } from '../schichtmodellText';
import { useUhr } from '../useUhr';
import GrenzwerteZeile from './GrenzwerteZeile';
import { spanneAus, type SpannenWahl } from './raster';
import SchichtplanEditor, { type SchichtplanEditorAdapter } from './SchichtplanEditor';
import SchichtplanWechselDialog from './SchichtplanWechselDialog';
import SchichtplanWechselLeiste from './SchichtplanWechselLeiste';
import { baueZeilen, personenOptionen, postenSchluessel, rasterBloecke } from './schichtplanZeilen';

/**
 * Ansicht „Schichtplan“ der Ablösung (`?ansicht=plan`, LLH-1554, Konzept LLH-1523 Abschnitt 6):
 * Raster mit Posten als Zeilen und der Zeit als Spalten, Personen zum Ziehen in der Seitenleiste,
 * der Blockdialog als Weg ohne Ziehen. Auf dem Handschirm eine Liste je Posten.
 *
 * Kein eigener Rechenweg: Lücke, Befunde und Soll-Kopie liefert der Server
 * (`frontend/src/kraefte/AGENTS.md`, „Schichtplan“), jeder Schreibweg antwortet mit dem ganzen
 * Plan, der den Cache ersetzt. Live kommt der Plan über `abloesung`. Uhrabhängige Befunde
 * (`abweichung`) fragt die Ansicht zu `naechste_pruefung_at` neu ab.
 *
 * Zeilen brauchen Einheiten (Modul Einheiten) und UHS (Modul Unfallhilfsstellen); ohne Freigabe
 * fehlen nur deren Posten ohne Blöcke. Personen brauchen das Modul Personal: ohne steht die
 * Seitenleiste gesperrt mit Grund, der Blockdialog ebenso (Server: 403).
 *
 * LLH-1555 Welle 3: über dem Raster die Wechsel-Leiste (`SchichtplanWechselLeiste`), je Zeitpunkt
 * die Wechsel laut Plan mit ihrem Griff; ein gebündelter Hinweis springt mit `?wechsel=` hinein.
 *
 * LLH-1603: Unter der Werkzeugzeile nennt `GrenzwerteZeile` Höchstdienst und Mindestruhe; bedient
 * werden sie nur in Einstellungen › Ablösung.
 *
 * LLH-1584: Strg/Alt beim Verschieben kopiert den Block (mit Personen, ohne Notiz), der Blockdialog
 * kopiert ihn als nächsten Block (ohne Personen) und öffnet die Kopie, „Schichten erzeugen“ füllt
 * einen Zeitraum am Posten (`SchichtenErzeugenDialog`).
 *
 * Hülle des gemeinsamen `SchichtplanEditor` (Change `y106s29r-blockplan-kern`, D6): hier stehen
 * nur Laden, Zeilen, Personen, Vorgaben, Zeitspanne, Grenzwerte, Wechsel-Teil und die Aufrufe der
 * API des Einsatzes; Mutationen, Zug und Ablage und die Dialoge trägt der Editor.
 */

interface SchichtplanAnsichtProps {
  einsatzId: number;
  /** Beginn des Einsatzes (Wire) für die Spanne „Einsatz“. */
  einsatzBeginn: string;
  darfSchreiben: boolean;
  /** Abschnitte in der Reihenfolge der Gliederung (Vorgaben der Ablösung). */
  abschnitte: readonly AbloesungVorgabe[];
  /**
   * Die Abschnitte sind geladen (oder gescheitert). Vorher friert die Zeilenschleuse nicht ein
   * (LLH-1604, `SchichtplanSchleuse`, `bereit`). Vorgabe `true`.
   */
  abschnitteBereit?: boolean;
  /** Weitere Werkzeuge rechts neben „Block anlegen“ (etwa „Schichtplan einlesen“, LLH-1556). */
  werkzeuge?: ReactNode;
  /** Sprung `?wechsel=<minute>` (LLH-1555): dieser Zeitpunkt steht in der Wechsel-Leiste gewählt. */
  wechselSprung?: number;
  /** Kennung des Sprungs (`location.key`): derselbe Sprung noch einmal wählt erneut. */
  wechselSprungKennung?: string;
  /** Vollzug einer Schicht aus der Wechsel-Leiste; die Seite öffnet ihren Vollzug-Dialog. */
  onVollziehen?: (abloesungId: number) => void;
}

const SPANNEN: { wert: SpannenWahl; label: string }[] = [
  { wert: '6h', label: '6 h' },
  { wert: '12h', label: '12 h' },
  { wert: 'einsatz', label: 'Einsatz' },
];

export default function SchichtplanAnsicht({
  einsatzId,
  einsatzBeginn,
  darfSchreiben,
  abschnitte,
  abschnitteBereit = true,
  werkzeuge,
  wechselSprung,
  wechselSprungKennung,
  onVollziehen,
}: SchichtplanAnsichtProps) {
  const qc = useQueryClient();
  const { token } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const jetzt = useUhr().valueOf();
  const [spannenWahl, setSpannenWahl] = useState<SpannenWahl>('12h');
  // Gewählter Zeitpunkt der Wechsel-Leiste; ein neuer Sprung wählt seinen.
  const [wechselGewaehlt, setWechselGewaehlt] = useState<number | null>(wechselSprung ?? null);
  useEffect(() => {
    if (wechselSprung != null) setWechselGewaehlt(wechselSprung);
  }, [wechselSprung, wechselSprungKennung]);

  const freigaben = useModulFreigaben(einsatzId);
  const einheitenFrei = istKeyFreigegeben('einheiten', freigaben);
  const uhsFrei = istKeyFreigegeben('unfallhilfsstellen', freigaben);
  const personalFrei = istKeyFreigegeben('personal', freigaben);
  const personenGesperrt = freigaben != null && !personalFrei ? MODUL_PERSONAL_GESPERRT : undefined;

  const planQuery = useQuery({
    queryKey: einsatzKeys.schichtplan(einsatzId),
    queryFn: () => fetchSchichtplan(einsatzId),
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
    enabled: einheitenFrei,
  });
  const uhsQuery = useQuery({
    queryKey: einsatzKeys.uhs(einsatzId),
    queryFn: () => listeUhs(einsatzId),
    enabled: uhsFrei,
  });
  const einsatzPersonalQuery = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
    enabled: personalFrei && darfSchreiben,
  });
  const stammQuery = useQuery({
    queryKey: globalKeys.personalListe('im-dienst'),
    queryFn: () => listePersonal(true),
    enabled: personalFrei && darfSchreiben,
  });
  // Schichtmodell des Einsatzes: teilt „Schichten erzeugen“ ohne eigene Länge (LLH-1584).
  const einsatzVorgabeQuery = useQuery({
    queryKey: einsatzKeys.abloesungEinsatzVorgabe(einsatzId),
    queryFn: () => fetchEinsatzSchichtmodell(einsatzId),
    enabled: darfSchreiben,
  });
  const einsatzModell = einsatzVorgabeQuery.data?.schichtmodell ?? null;
  const schichtmodellKurz = einsatzModell ? formatRegelKurz(einsatzModell, konventionen) : null;

  // Uhrabhängige Befunde (Plan gegen Ist ab Blockbeginn + 10 min) ändern sich ohne Ereignis.
  const naechstePruefung = planQuery.data?.naechste_pruefung_at ?? null;
  useEffect(() => {
    if (!naechstePruefung) return;
    const bis = (alsZeitpunkt(naechstePruefung)?.valueOf() ?? 0) - Date.now();
    const t = window.setTimeout(
      () => void qc.invalidateQueries({ queryKey: einsatzKeys.schichtplan(einsatzId) }),
      Math.max(1_000, Math.min(bis + 1_000, 2_147_000_000)),
    );
    return () => window.clearTimeout(t);
  }, [naechstePruefung, qc, einsatzId]);

  const plan = planQuery.data;
  const bloecke = useMemo(() => rasterBloecke(plan), [plan]);
  const zeilen = useMemo(
    () =>
      baueZeilen({
        einheiten: einheitenFrei ? einheitenQuery.data : undefined,
        uhs: uhsFrei ? uhsQuery.data : undefined,
        abschnitte,
        bloecke: plan?.bloecke ?? [],
      }),
    [einheitenFrei, einheitenQuery.data, uhsFrei, uhsQuery.data, abschnitte, plan],
  );
  // Die Zeilen kommen aus vier Quellen; die Pause steht sofort da. Erst wenn alle geantwortet
  // haben, darf die Zeilenschleuse einfrieren (LLH-1604). Eine abgeschaltete Abfrage bleibt in
  // TanStack `isPending`, deshalb zählt sie nur mit Freigabe.
  const zeilenBereit =
    freigaben != null &&
    (!einheitenFrei || !einheitenQuery.isPending) &&
    (!uhsFrei || !uhsQuery.isPending) &&
    abschnitteBereit;
  const personen = useMemo(
    () =>
      personenGesperrt || !darfSchreiben
        ? null
        : einsatzPersonalQuery.data && stammQuery.data
          ? personenOptionen(einsatzPersonalQuery.data, stammQuery.data, plan?.helfer)
          : null,
    [personenGesperrt, darfSchreiben, einsatzPersonalQuery.data, stammQuery.data, plan],
  );
  const sollVorgabe = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const e of einheitenQuery.data ?? [])
      m.set(
        postenSchluessel({ art: 'einheit', einheit_id: e.id }),
        e.soll ? e.soll.fuehrer + e.soll.unterfuehrer + e.soll.mannschaft : null,
      );
    for (const u of uhsQuery.data ?? [])
      m.set(postenSchluessel({ art: 'uhs', uhs_id: u.id }), u.soll_anzahl ?? null);
    return m;
  }, [einheitenQuery.data, uhsQuery.data]);
  // Wirksames Qualifikationssoll je Posten (Einheit, sonst ihr Typ; UHS), wie der Server kopiert.
  const qualiVorgabe = useMemo(() => {
    const m = new Map<string, readonly QualiSollEintrag[] | null>();
    for (const e of einheitenQuery.data ?? [])
      m.set(postenSchluessel({ art: 'einheit', einheit_id: e.id }), e.quali_soll ?? null);
    for (const u of uhsQuery.data ?? [])
      m.set(postenSchluessel({ art: 'uhs', uhs_id: u.id }), u.quali_soll ?? null);
    return m;
  }, [einheitenQuery.data, uhsQuery.data]);

  const beginn = alsZeitpunkt(einsatzBeginn)?.valueOf() ?? jetzt;
  const spanne = useMemo(
    () => spanneAus(spannenWahl, jetzt, beginn, bloecke),
    [spannenWahl, jetzt, beginn, bloecke],
  );

  // ── Adapter des Editors ── Jede Antwort ist der ganze Plan; er ersetzt den Cache.
  // Die Leiste reicht 36 h: ein Zeitpunkt an einem anderen Tag nennt sein Datum.
  const zeitpunktText = (ms: number) => {
    const u = uhrzeit(dayjs(ms), konventionen);
    const tag = datum(dayjs(ms), konventionen);
    return tag === datum(dayjs(jetzt), konventionen) ? u : `${tag} ${u}`;
  };
  // Wechsel aus dem Plan (LLH-1555): an der UHS mit Unfallhilfsstellen, immer mit Personal.
  const wechselMoeglich = (b: SchichtplanBlock) =>
    darfSchreiben &&
    personalFrei &&
    !b.posten.aufgeloest &&
    (b.posten.art === 'pause' || (b.posten.art === 'uhs' && uhsFrei));

  const adapter: SchichtplanEditorAdapter<Schichtplan> = {
    dataLfh: 'schichtplan-ansicht',
    bloecke: plan?.bloecke ?? [],
    rasterBloecke: bloecke,
    getBloecke: (p) => p.bloecke,
    zeilen,
    zeilenBereit,
    personen,
    personenGesperrt,
    sollVorgabe,
    qualiVorgabe,
    schichtmodell: schichtmodellKurz,
    jetzt,
    spanne,
    spanneSelect: (
      <Segmentleiste
        beschriftung="Zeitspanne"
        wert={spannenWahl}
        onWechsel={setSpannenWahl}
        optionen={SPANNEN}
        style={{ flex: 'none' }}
      />
    ),
    canWrite: darfSchreiben,
    // Erst mit geladenem Plan: die Meldung zählt nur, was vorher nicht darin stand.
    isErzeugenDisabled: !plan,
    beschriftung: 'Schichtplan',
    fehlerTitel: 'Schichtplan nicht geändert',
    tools: werkzeuge,
    header: (
      <>
        {plan && (
          <GrenzwerteZeile
            einsatzId={einsatzId}
            grenzwerte={plan.grenzwerte}
            canWrite={darfSchreiben}
          />
        )}
        {planQuery.isError && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: token.marginSM }}
            title="Schichtplan konnte nicht geladen werden"
            action={<Button onClick={() => void planQuery.refetch()}>Erneut abrufen</Button>}
          />
        )}
      </>
    ),
    isLoading: planQuery.isLoading,
    api: {
      create: (body) => legeSchichtplanBlockAn(einsatzId, body),
      update: (blockId, body) => aendereSchichtplanBlock(einsatzId, blockId, body),
      delete: (b) => loescheSchichtplanBlock(einsatzId, b.id, b.version),
      erzeugen: (body) => erzeugeSchichten(einsatzId, body),
    },
    cache: {
      get: () => qc.getQueryData<Schichtplan>(einsatzKeys.schichtplan(einsatzId)),
      set: (p) => qc.setQueryData(einsatzKeys.schichtplan(einsatzId), p),
      invalidate: () => void qc.invalidateQueries({ queryKey: einsatzKeys.schichtplan(einsatzId) }),
    },
    wechsel: {
      canWechsel: wechselMoeglich,
      renderLeiste: (griff) =>
        plan && (
          <SchichtplanWechselLeiste
            wechsel={plan.wechsel}
            bloecke={plan.bloecke}
            jetzt={jetzt}
            formatZeit={zeitpunktText}
            gewaehlt={wechselGewaehlt}
            onWaehlen={setWechselGewaehlt}
            wechselGriff={griff}
            onVollziehen={darfSchreiben ? onVollziehen : undefined}
          />
        ),
      renderDialog: (blockId, onSchliessen) => (
        <SchichtplanWechselDialog
          key={`w-${blockId}`}
          einsatzId={einsatzId}
          blockId={blockId}
          onSchliessen={onSchliessen}
        />
      ),
    },
  };

  return <SchichtplanEditor adapter={adapter} />;
}
