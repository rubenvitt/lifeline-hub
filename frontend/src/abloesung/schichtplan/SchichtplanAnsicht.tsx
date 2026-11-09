import {
  DndContext,
  DragOverlay,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { Alert, App, Button, Flex, Spin } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fetchEinsatzSchichtmodell } from '../../api/abloesungen';
import { listeEinheiten } from '../../api/einheiten';
import { listeEinsatzPersonal } from '../../api/einsatzPersonal';
import { listeUhs } from '../../api/einsatzUhs';
import { listePersonal } from '../../api/personal';
import { listeQualifikationen } from '../../api/qualifikationen';
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
  SchichtplanBlockAendernBody,
  SchichtplanBlockBody,
  SchichtplanErzeugenBody,
} from '../../api/types';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { datum, uhrzeit } from '../../anzeige/zeitDarstellung';
import { alsBackendZeit, alsZeitpunkt } from '../../anzeige/zeitEingabe';
import { Segmentleiste, useRollen } from '../../components/instrument';
import { MODUL_PERSONAL_GESPERRT } from '../../components/nurAnsicht';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import { useViewport } from '../../components/useViewport';
import { ZugPointerSensor } from '../../components/zugPointerSensor';
import { istKeyFreigegeben } from '../../einsatz/modulRegistry';
import { useModulFreigaben } from '../../einsatz/useSprungSperre';
import { formatRegelKurz } from '../schichtmodellText';
import { useUhr } from '../useUhr';
import { spanneAus, type SpannenWahl, type ZugStand } from './raster';
import SchichtenErzeugenDialog from './SchichtenErzeugenDialog';
import SchichtplanBlockDialog, { type BlockSpeichern } from './SchichtplanBlockDialog';
import SchichtplanListe from './SchichtplanListe';
import SchichtplanPersonen, { type PersonZugDaten } from './SchichtplanPersonen';
import SchichtplanRaster, { type BlockZielDaten } from './SchichtplanRaster';
import SchichtplanSchleuse from './SchichtplanSchleuse';
import SchichtplanWechselDialog from './SchichtplanWechselDialog';
import {
  baueZeilen,
  kopieBody,
  mitPerson,
  naechsterBlockBody,
  personenOptionen,
  postenEingabe,
  postenSchluessel,
  rasterBloecke,
} from './schichtplanZeilen';

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
 * LLH-1584: Strg/Alt beim Verschieben kopiert den Block (mit Personen, ohne Notiz), der Blockdialog
 * kopiert ihn als nächsten Block (ohne Personen) und öffnet die Kopie, „Schichten erzeugen“ füllt
 * einen Zeitraum am Posten (`SchichtenErzeugenDialog`).
 */

interface SchichtplanAnsichtProps {
  einsatzId: number;
  /** Beginn des Einsatzes (Wire) für die Spanne „Einsatz“. */
  einsatzBeginn: string;
  darfSchreiben: boolean;
  /** Abschnitte in der Reihenfolge der Gliederung (Vorgaben der Ablösung). */
  abschnitte: readonly AbloesungVorgabe[];
  /** Weitere Werkzeuge rechts neben „Block anlegen“ (etwa „Schichtplan einlesen“, LLH-1556). */
  werkzeuge?: ReactNode;
}

type Dialog =
  | { art: 'anlegen'; vorbelegt?: { zeile?: string; von?: number; bis?: number } }
  | { art: 'block'; blockId: number }
  | { art: 'wechsel'; blockId: number }
  | { art: 'erzeugen' };

const SPANNEN: { wert: SpannenWahl; label: string }[] = [
  { wert: '6h', label: '6 h' },
  { wert: '12h', label: '12 h' },
  { wert: 'einsatz', label: 'Einsatz' },
];

/** Ansagen an Hilfstechnik beim Ziehen einer Person (deutsch statt dnd-kits Vorgabe). */
const personName = (d: unknown) => (d as PersonZugDaten | undefined)?.option.name ?? 'Person';
const zielName = (d: unknown) => (d as BlockZielDaten | undefined)?.name;
const ANSAGEN: Announcements = {
  onDragStart: ({ active }) => `${personName(active.data.current)} gefasst.`,
  onDragOver: ({ active, over }) => {
    const z = zielName(over?.data.current);
    return z
      ? `${personName(active.data.current)} über Block ${z}.`
      : `${personName(active.data.current)} über keinem Block.`;
  },
  onDragEnd: ({ active, over }) => {
    const z = zielName(over?.data.current);
    return z
      ? `${personName(active.data.current)} in Block ${z} eingeteilt.`
      : `${personName(active.data.current)} losgelassen, nichts geändert.`;
  },
  onDragCancel: ({ active }) => `Ziehen von ${personName(active.data.current)} abgebrochen.`,
};

export default function SchichtplanAnsicht({
  einsatzId,
  einsatzBeginn,
  darfSchreiben,
  abschnitte,
  werkzeuge,
}: SchichtplanAnsichtProps) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { token, rollen } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const { istSchmal, abBreite } = useViewport();
  const jetzt = useUhr().valueOf();
  const [spannenWahl, setSpannenWahl] = useState<SpannenWahl>('12h');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // Für Antworten, die nach einem Dialogwechsel eintreffen (Kopie als nächsten Block).
  const dialogJetzt = useRef(dialog);
  useEffect(() => {
    dialogJetzt.current = dialog;
  }, [dialog]);
  const [gezogen, setGezogen] = useState<PersonZugDaten | null>(null);
  const [zugLaeuft, setZugLaeuft] = useState(false);
  // Die Zeilenschleuse hält auch ohne Fokus und Zeiger (LLH-1604, `SchichtplanSchleuse`).
  const schleuseHalten = zugLaeuft || gezogen != null || dialog != null;

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
  const qualiQuery = useQuery({
    queryKey: globalKeys.qualifikationen(),
    queryFn: listeQualifikationen,
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
  const personen = useMemo(
    () =>
      personenGesperrt || !darfSchreiben
        ? null
        : einsatzPersonalQuery.data && stammQuery.data
          ? personenOptionen(einsatzPersonalQuery.data, stammQuery.data, plan?.helfer)
          : null,
    [personenGesperrt, darfSchreiben, einsatzPersonalQuery.data, stammQuery.data, plan],
  );
  const qualiNamen = useMemo(
    () => new Map((qualiQuery.data ?? []).map((q) => [q.id, q.label])),
    [qualiQuery.data],
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

  // ── Schreiben ── Jede Antwort ist der ganze Plan; er ersetzt den Cache.
  const setzePlan = (p: Schichtplan) => qc.setQueryData(einsatzKeys.schichtplan(einsatzId), p);
  const anlegenMut = useMutation({
    mutationFn: (body: SchichtplanBlockBody) => legeSchichtplanBlockAn(einsatzId, body),
    onSuccess: setzePlan,
  });
  const aendernMut = useMutation({
    mutationFn: (v: { blockId: number; body: SchichtplanBlockAendernBody }) =>
      aendereSchichtplanBlock(einsatzId, v.blockId, v.body),
    onSuccess: setzePlan,
  });
  // Eigene Mutation für die Kopie aus dem Dialog: ihr Fehler steht dort, nicht beim Speichern.
  const kopierenMut = useMutation({
    mutationFn: (body: SchichtplanBlockBody) => legeSchichtplanBlockAn(einsatzId, body),
    onSuccess: setzePlan,
  });
  const erzeugenMut = useMutation({
    mutationFn: (body: SchichtplanErzeugenBody) => erzeugeSchichten(einsatzId, body),
    onSuccess: (p) => {
      // Neu ist, was vorher nicht im Plan stand.
      const vorher = new Set(
        qc.getQueryData<Schichtplan>(einsatzKeys.schichtplan(einsatzId))?.bloecke.map((b) => b.id),
      );
      setzePlan(p);
      const neu = p.bloecke.filter((b) => !vorher.has(b.id)).length;
      message.success(neu === 1 ? '1 Schicht erzeugt' : `${neu} Schichten erzeugt`);
    },
  });
  const loeschenMut = useMutation({
    mutationFn: (b: SchichtplanBlock) => loescheSchichtplanBlock(einsatzId, b.id, b.version),
    onSuccess: () => {
      setDialog(null);
      void qc.invalidateQueries({ queryKey: einsatzKeys.schichtplan(einsatzId) });
    },
  });
  // Fehler eines Zugs im Raster (ohne offenen Dialog) stehen über dem Raster.
  const [zugFehler, setZugFehler] = useState<unknown>(null);
  const zugSchreiben = (p: Promise<unknown>) => {
    setZugFehler(null);
    p.catch((e: unknown) => setZugFehler(e));
  };

  const blockVon = (id: number) => plan?.bloecke.find((b) => b.id === id) ?? null;
  const zeitText = (ms: number) => uhrzeit(dayjs(ms), konventionen);
  const markeText = (ms: number) => {
    const u = uhrzeit(dayjs(ms), konventionen);
    return /^00:?00$/.test(u) ? datum(dayjs(ms), konventionen) : u;
  };

  const onAnlegen = (zeile: string, von: number, bis: number) => {
    const posten = postenEingabe(zeile);
    if (!posten) return;
    zugSchreiben(
      anlegenMut.mutateAsync({
        posten,
        von: alsBackendZeit(dayjs(von)),
        bis: alsBackendZeit(dayjs(bis)),
      }),
    );
  };
  const onAendern = (blockId: number, stand: ZugStand) => {
    const block = blockVon(blockId);
    const posten = postenEingabe(stand.zeile);
    if (!block || !posten) return;
    const body: SchichtplanBlockAendernBody = { version: block.version };
    if (stand.zeile !== postenSchluessel(block.posten)) body.posten = posten;
    const von = alsBackendZeit(dayjs(stand.von));
    const bis = alsBackendZeit(dayjs(stand.bis));
    if (von !== block.von) body.von = von;
    if (bis !== block.bis) body.bis = bis;
    zugSchreiben(aendernMut.mutateAsync({ blockId, body }));
  };

  const sensoren = useSensors(
    useSensor(ZugPointerSensor, { activationConstraint: { distance: 5 } }),
  );
  // Strg/Alt-Zug: Kopie an Zeile und Zeit des Schattens, mit Personen (die Notiz bleibt).
  const onKopieren = (blockId: number, stand: ZugStand) => {
    const block = blockVon(blockId);
    const posten = postenEingabe(stand.zeile);
    if (!block || !posten) return;
    zugSchreiben(
      anlegenMut.mutateAsync(
        kopieBody(
          block,
          {
            posten,
            von: alsBackendZeit(dayjs(stand.von)),
            bis: alsBackendZeit(dayjs(stand.bis)),
          },
          !personenGesperrt,
        ),
      ),
    );
  };
  // „Als nächsten Block kopieren“: danach zeigt der Dialog die Kopie.
  const kopiereAlsNaechsten = (block: SchichtplanBlock) => {
    const body = naechsterBlockBody(block);
    if (!body) return;
    // Die Kopie ist der neue Block; an der Pause kann schon einer mit gleichem Beginn stehen.
    const vorher = new Set(plan?.bloecke.map((b) => b.id));
    kopierenMut.mutate(body, {
      onSuccess: (p) => {
        const neu = p.bloecke.find(
          (b) =>
            !vorher.has(b.id) &&
            postenSchluessel(b.posten) === postenSchluessel(block.posten) &&
            b.von === body.von,
        );
        // Nur wenn der Dialog noch den Ausgangsblock zeigt; geschlossen oder gewechselt bleibt er.
        const d = dialogJetzt.current;
        if (!neu || d?.art !== 'block' || d.blockId !== block.id) return;
        aendernMut.reset();
        loeschenMut.reset();
        kopierenMut.reset();
        setDialog({ art: 'block', blockId: neu.id });
      },
    });
  };

  const onDragStart = (e: DragStartEvent) => {
    setGezogen((e.active.data.current as PersonZugDaten | undefined) ?? null);
  };
  const onDragEnd = (e: DragEndEvent) => {
    setGezogen(null);
    const person = e.active.data.current as PersonZugDaten | undefined;
    const ziel = e.over?.data.current as BlockZielDaten | undefined;
    if (!person || !ziel) return;
    const block = blockVon(ziel.blockId);
    if (!block) return;
    const personenNeu = mitPerson(block, person.option.eingabe);
    if (!personenNeu) return;
    zugSchreiben(
      aendernMut.mutateAsync({
        blockId: block.id,
        body: { version: block.version, personen: personenNeu },
      }),
    );
  };

  const speichern = (s: BlockSpeichern) =>
    s.art === 'anlegen'
      ? anlegenMut.mutateAsync(s.body)
      : aendernMut.mutateAsync({ blockId: s.blockId, body: s.body });

  const oeffneAnlegen = () => {
    anlegenMut.reset();
    setDialog({ art: 'anlegen' });
  };
  const oeffneBlock = (blockId: number) => {
    aendernMut.reset();
    loeschenMut.reset();
    kopierenMut.reset();
    setDialog({ art: 'block', blockId });
  };
  const oeffneErzeugen = () => {
    erzeugenMut.reset();
    setDialog({ art: 'erzeugen' });
  };
  const dialogBlock = dialog?.art === 'block' ? blockVon(dialog.blockId) : null;
  // Wechsel aus dem Plan (LLH-1555): an der UHS mit Unfallhilfsstellen, immer mit Personal.
  const wechselMoeglich = (b: SchichtplanBlock) =>
    darfSchreiben &&
    personalFrei &&
    !b.posten.aufgeloest &&
    (b.posten.art === 'pause' || (b.posten.art === 'uhs' && uhsFrei));
  const mitSeitenleiste = !istSchmal && darfSchreiben;

  return (
    <div data-lfh="schichtplan-ansicht">
      <Flex
        gap={token.marginSM}
        align="center"
        wrap
        data-lfh="schichtplan-werkzeugzeile"
        style={{ marginBottom: token.margin }}
      >
        {!istSchmal && (
          <Segmentleiste
            beschriftung="Zeitspanne"
            wert={spannenWahl}
            onWechsel={setSpannenWahl}
            optionen={SPANNEN}
            style={{ flex: 'none' }}
          />
        )}
        {darfSchreiben && <Button onClick={oeffneAnlegen}>Block anlegen</Button>}
        {darfSchreiben && (
          // Erst mit geladenem Plan: die Meldung zählt nur, was vorher nicht darin stand.
          <Button onClick={oeffneErzeugen} disabled={!plan}>
            Schichten erzeugen
          </Button>
        )}
        {werkzeuge}
      </Flex>
      {planQuery.isError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: token.marginSM }}
          title="Schichtplan konnte nicht geladen werden"
          action={<Button onClick={() => void planQuery.refetch()}>Erneut abrufen</Button>}
        />
      )}
      {zugFehler != null && (
        <div style={{ marginBottom: token.marginSM }}>
          <SpeicherFehler fehler={zugFehler} titel="Schichtplan nicht geändert" />
        </div>
      )}
      {planQuery.isLoading ? (
        <Spin />
      ) : istSchmal ? (
        <SchichtplanSchleuse zeilen={zeilen} halten={schleuseHalten} schmal>
          {(z) => (
            <SchichtplanListe
              zeilen={z}
              bloecke={bloecke}
              jetzt={jetzt}
              formatZeit={zeitText}
              onOeffnen={oeffneBlock}
            />
          )}
        </SchichtplanSchleuse>
      ) : (
        <DndContext
          sensors={sensoren}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setGezogen(null)}
          accessibility={{ announcements: ANSAGEN }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                mitSeitenleiste && abBreite('lg') ? 'minmax(0, 1fr) 240px' : 'minmax(0, 1fr)',
              gap: token.marginSM,
              alignItems: 'start',
            }}
          >
            <SchichtplanSchleuse zeilen={zeilen} halten={schleuseHalten}>
              {(z) => (
                <SchichtplanRaster
                  zeilen={z}
                  bloecke={bloecke}
                  spanne={spanne}
                  jetzt={jetzt}
                  darfSchreiben={darfSchreiben}
                  zone={konventionen.zeitzone}
                  formatMarke={markeText}
                  formatZeit={zeitText}
                  onAnlegen={onAnlegen}
                  onAendern={onAendern}
                  onKopieren={onKopieren}
                  onOeffnen={oeffneBlock}
                  personenZiel={mitSeitenleiste && !personenGesperrt}
                  beschriftung="Schichtplan"
                  onZug={setZugLaeuft}
                />
              )}
            </SchichtplanSchleuse>
            {mitSeitenleiste && (
              <SchichtplanPersonen optionen={personen} gesperrt={personenGesperrt} />
            )}
          </div>
          <DragOverlay>
            {gezogen ? (
              <div
                style={{
                  padding: token.paddingXS,
                  background: rollen.auswahlFlaeche,
                  border: `1px solid ${rollen.bedien}`,
                  color: rollen.text,
                  whiteSpace: 'nowrap',
                }}
              >
                {gezogen.option.name}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
      {dialog?.art === 'erzeugen' && (
        <SchichtenErzeugenDialog
          zeilen={zeilen}
          schichtmodell={schichtmodellKurz}
          darfSchreiben={darfSchreiben}
          laeuft={erzeugenMut.isPending}
          speicherung={erzeugenMut}
          onErzeugen={(body) => erzeugenMut.mutateAsync(body)}
          onSchliessen={() => setDialog(null)}
        />
      )}
      {dialog && (dialog.art === 'anlegen' || dialogBlock) && (
        <SchichtplanBlockDialog
          key={dialog.art === 'block' ? `b-${dialog.blockId}` : 'neu'}
          block={dialogBlock}
          vorbelegt={dialog.art === 'anlegen' ? dialog.vorbelegt : undefined}
          zeilen={zeilen}
          personen={personen}
          personenGesperrt={personenGesperrt}
          sollVorgabe={sollVorgabe}
          qualiVorgabe={qualiVorgabe}
          qualiNamen={qualiNamen}
          darfSchreiben={darfSchreiben}
          laeuft={anlegenMut.isPending || aendernMut.isPending}
          speicherung={dialog.art === 'anlegen' ? anlegenMut : aendernMut}
          loeschenLaeuft={loeschenMut.isPending}
          loeschFehler={loeschenMut.error}
          onSpeichern={speichern}
          onLoeschen={(b) => loeschenMut.mutate(b)}
          onKopieren={kopiereAlsNaechsten}
          kopierenLaeuft={kopierenMut.isPending}
          kopierFehler={kopierenMut.error}
          onWechsel={
            dialogBlock && wechselMoeglich(dialogBlock)
              ? (b) => setDialog({ art: 'wechsel', blockId: b.id })
              : undefined
          }
          onSchliessen={() => setDialog(null)}
        />
      )}
      {dialog?.art === 'wechsel' && (
        <SchichtplanWechselDialog
          key={`w-${dialog.blockId}`}
          einsatzId={einsatzId}
          blockId={dialog.blockId}
          onSchliessen={() => setDialog(null)}
        />
      )}
    </div>
  );
}
