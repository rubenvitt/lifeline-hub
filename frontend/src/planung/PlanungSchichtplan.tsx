import {
  DndContext,
  DragOverlay,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { App, Button, Flex } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useMemo, useRef, useState } from 'react';
import { listePersonal } from '../api/personal';
import {
  aenderePlanungBlock,
  erzeugePlanungSchichten,
  legePlanungBlockAn,
  loadPlanungMappe,
  loeschePlanungBlock,
} from '../api/planungen';
import { listeQualifikationen } from '../api/qualifikationen';
import { globalKeys } from '../api/queryKeys';
import type {
  Planung,
  SchichtplanBlock,
  SchichtplanBlockAendernBody,
  SchichtplanBlockBody,
  SchichtplanErzeugenBody,
} from '../api/types';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { datum, tagUndUhrzeit, uhrzeit } from '../anzeige/zeitDarstellung';
import { alsBackendZeit } from '../anzeige/zeitEingabe';
import { Segmentleiste, useRollen } from '../components/instrument';
import { Select } from '../components/Select';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { useViewport } from '../components/useViewport';
import { ZugPointerSensor } from '../components/zugPointerSensor';
import type { ZugStand } from '../abloesung/schichtplan/raster';
import { AusgabeKnoepfe } from '../abloesung/schichtplan/ausgabe/SchichtplanAusgabeKnoepfe';
import { mappeDateiname } from '../abloesung/schichtplan/ausgabe/mappeDateiname';
import SchichtenErzeugenDialog from '../abloesung/schichtplan/SchichtenErzeugenDialog';
import SchichtplanBlockDialog, {
  type BlockSpeichern,
} from '../abloesung/schichtplan/SchichtplanBlockDialog';
import { useBlockMenue } from '../abloesung/schichtplan/blockMenue';
import SchichtplanListe from '../abloesung/schichtplan/SchichtplanListe';
import SchichtplanPersonen, {
  type PersonZugDaten,
} from '../abloesung/schichtplan/SchichtplanPersonen';
import SchichtplanRaster, { type BlockZielDaten } from '../abloesung/schichtplan/SchichtplanRaster';
import SchichtplanSchleuse from '../abloesung/schichtplan/SchichtplanSchleuse';
import {
  kopieBody,
  mitPerson,
  naechsterBlockBody,
  postenEingabe,
  postenSchluessel,
} from '../abloesung/schichtplan/schichtplanZeilen';
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
  rasterBloeckeVon,
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
 */

type Dialog = { art: 'anlegen' } | { art: 'block'; blockId: number } | { art: 'erzeugen' };

/** Bis zu so vielen Tagen stehen die Tage als Segmente. */
const TAGE_ALS_SEGMENTE = 3;

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
  const { message } = App.useApp();
  const { token, rollen } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const { istSchmal, abBreite } = useViewport();
  const jetzt = useUhr().valueOf();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const dialogJetzt = useRef(dialog);
  useEffect(() => {
    dialogJetzt.current = dialog;
  }, [dialog]);
  const [gezogen, setGezogen] = useState<PersonZugDaten | null>(null);
  const [zugLaeuft, setZugLaeuft] = useState(false);
  // Ein offenes Kontextmenü eines Blocks hält wie ein Zug (LLH-1600, Spec `datensatz-aktionsmenue`).
  const [menueOffen, setMenueOffen] = useState(false);
  // Die Zeilenschleuse hält auch ohne Fokus und Zeiger (LLH-1604, `SchichtplanSchleuse`).
  const schleuseHalten = zugLaeuft || menueOffen || gezogen != null || dialog != null;

  const stammQuery = useQuery({
    queryKey: globalKeys.personalListe('im-dienst'),
    queryFn: () => listePersonal(true),
  });
  const qualiQuery = useQuery({
    queryKey: globalKeys.qualifikationen(),
    queryFn: listeQualifikationen,
  });

  const sbloecke = useMemo(() => schichtplanBloecke(planung), [planung]);
  const bloecke = useMemo(() => rasterBloeckeVon(sbloecke), [sbloecke]);
  const zeilen = useMemo(() => planungZeilen(planung.posten), [planung.posten]);
  const personen = useMemo(
    () => (stammQuery.data ? planungPersonen(stammQuery.data, planung.helfer) : null),
    [stammQuery.data, planung.helfer],
  );
  const qualiNamen = useMemo(
    () => new Map((qualiQuery.data ?? []).map((q) => [q.id, q.label])),
    [qualiQuery.data],
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

  // ── Schreiben ── Jede Antwort ist die ganze Planung; sie ersetzt den Cache, ein Abruf folgt.
  const setzePlanung = (p: Planung) => uebernimmPlanung(qc, p);
  const anlegenMut = useMutation({
    mutationFn: (body: SchichtplanBlockBody) => legePlanungBlockAn(planungId, blockBody(body)),
    onSuccess: setzePlanung,
  });
  const aendernMut = useMutation({
    mutationFn: (v: { blockId: number; body: SchichtplanBlockAendernBody }) =>
      aenderePlanungBlock(planungId, v.blockId, blockAendernBody(v.body)),
    onSuccess: setzePlanung,
  });
  const kopierenMut = useMutation({
    mutationFn: (body: SchichtplanBlockBody) => legePlanungBlockAn(planungId, blockBody(body)),
    onSuccess: setzePlanung,
  });
  const erzeugenMut = useMutation({
    mutationFn: (body: SchichtplanErzeugenBody) =>
      erzeugePlanungSchichten(planungId, erzeugenBody(body)),
    onSuccess: (p) => {
      const vorher = new Set(
        qc.getQueryData<Planung>(globalKeys.planung(planungId))?.bloecke.map((b) => b.id),
      );
      setzePlanung(p);
      const neu = p.bloecke.filter((b) => !vorher.has(b.id)).length;
      message.success(neu === 1 ? '1 Schicht erzeugt' : `${neu} Schichten erzeugt`);
    },
  });
  const loeschenMut = useMutation({
    mutationFn: (b: SchichtplanBlock) => loeschePlanungBlock(planungId, b.id, b.version),
    onSuccess: () => {
      setDialog(null);
      void qc.invalidateQueries({ queryKey: globalKeys.planung(planungId) });
    },
  });
  const [zugFehler, setZugFehler] = useState<unknown>(null);
  const zugSchreiben = (p: Promise<unknown>) => {
    setZugFehler(null);
    p.catch((e: unknown) => setZugFehler(e));
  };

  const blockVon = (id: number) => sbloecke.find((b) => b.id === id) ?? null;
  const zeitText = (ms: number) => uhrzeit(dayjs(ms), konventionen);
  const markeText = (ms: number) => {
    const u = uhrzeit(dayjs(ms), konventionen);
    return /^00:?00$/.test(u) ? datum(dayjs(ms), konventionen) : u;
  };
  // Die Liste fürs Handy nennt den Tag: eine Planung reicht über mehrere.
  const listenZeit = (ms: number) => tagUndUhrzeit(dayjs(ms), konventionen);

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
          true,
        ),
      ),
    );
  };
  const kopiereAlsNaechsten = (block: SchichtplanBlock) => {
    const body = naechsterBlockBody(block);
    if (!body) return;
    const vorher = new Set(sbloecke.map((b) => b.id));
    kopierenMut.mutate(body, {
      onSuccess: (p) => {
        const neu = schichtplanBloecke(p).find(
          (b) =>
            !vorher.has(b.id) &&
            postenSchluessel(b.posten) === postenSchluessel(block.posten) &&
            b.von === body.von,
        );
        const d = dialogJetzt.current;
        if (!neu || d?.art !== 'block' || d.blockId !== block.id) return;
        aendernMut.reset();
        loeschenMut.reset();
        kopierenMut.reset();
        setDialog({ art: 'block', blockId: neu.id });
      },
    });
  };

  const sensoren = useSensors(
    useSensor(ZugPointerSensor, { activationConstraint: { distance: 5 } }),
  );
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
  // Kontextmenü eines Blocks (LLH-1600): „Als nächsten Block kopieren“ ohne Dialog, die Kopie
  // erscheint im Raster; ein Fehler steht über dem Raster wie bei einem Zug.
  const kopiereStill = (block: SchichtplanBlock) => {
    const body = naechsterBlockBody(block);
    if (!body) return;
    zugSchreiben(
      kopierenMut.mutateAsync(body).then(() => {
        message.success('Block kopiert');
      }),
    );
  };
  // Die Vorplanung kennt keinen Wechsel aus dem Plan.
  const blockMenue = useBlockMenue({
    blockVon,
    onBearbeiten: oeffneBlock,
    onKopieren: kopiereStill,
    onLoeschen: (b) => zugSchreiben(loeschenMut.mutateAsync(b)),
    laeuft: kopierenMut.isPending || loeschenMut.isPending,
  });
  const mitSeitenleiste = !istSchmal && !readOnly;
  const ohnePosten = planung.posten.length === 0;

  return (
    <div data-lfh="planung-plan">
      <Flex
        gap={token.marginSM}
        align="center"
        wrap
        data-lfh="schichtplan-werkzeugzeile"
        style={{ marginBottom: token.margin }}
      >
        {!istSchmal &&
          (tage.length <= TAGE_ALS_SEGMENTE ? (
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
          ))}
        {!readOnly && (
          <>
            <Button onClick={oeffneAnlegen}>Block anlegen</Button>
            <Button onClick={oeffneErzeugen} disabled={ohnePosten}>
              Schichten erzeugen
            </Button>
          </>
        )}
        {/* Ausgabe wie im Einsatz (LLH-1593): Aushang und Zettel, Excel-Mappe. Wer die Planung
            lesen darf, sieht auch das Personal; „Excel“ ist deshalb nie gesperrt. */}
        <AusgabeKnoepfe
          druckPfad={planungDruckPfad(planungId)}
          schluessel={`planung-${planungId}`}
          ladeMappe={() => loadPlanungMappe(planungId)}
          dateiname={() => mappeDateiname(planung.kopf.bezeichnung, `planung-${planungId}`)}
          personalFrei
        />
      </Flex>
      {zugFehler != null && (
        <div style={{ marginBottom: token.marginSM }}>
          <SpeicherFehler fehler={zugFehler} titel="Planung nicht geändert" />
        </div>
      )}
      {istSchmal ? (
        <SchichtplanSchleuse zeilen={zeilen} halten={schleuseHalten} schmal>
          {(z) => (
            <SchichtplanListe
              zeilen={z}
              bloecke={bloecke}
              jetzt={jetzt}
              formatZeit={listenZeit}
              onOeffnen={oeffneBlock}
              alleBloecke
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
                  darfSchreiben={!readOnly}
                  zone={konventionen.zeitzone}
                  formatMarke={markeText}
                  formatZeit={zeitText}
                  onAnlegen={onAnlegen}
                  onAendern={onAendern}
                  onKopieren={onKopieren}
                  onOeffnen={oeffneBlock}
                  personenZiel={mitSeitenleiste}
                  beschriftung="Planung"
                  onZug={setZugLaeuft}
                  blockMenue={readOnly ? undefined : blockMenue}
                  onMenue={setMenueOffen}
                />
              )}
            </SchichtplanSchleuse>
            {mitSeitenleiste && <SchichtplanPersonen optionen={personen} />}
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
          schichtmodell={null}
          laengeVorgabe={laengeVorgabe}
          darfSchreiben={!readOnly}
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
          zeilen={zeilen}
          personen={personen}
          sollVorgabe={sollVorgabe}
          qualiVorgabe={qualiVorgabe}
          qualiNamen={qualiNamen}
          darfSchreiben={!readOnly}
          laeuft={anlegenMut.isPending || aendernMut.isPending}
          speicherung={dialog.art === 'anlegen' ? anlegenMut : aendernMut}
          loeschenLaeuft={loeschenMut.isPending}
          loeschFehler={loeschenMut.error}
          onSpeichern={speichern}
          onLoeschen={(b) => loeschenMut.mutate(b)}
          onKopieren={kopiereAlsNaechsten}
          kopierenLaeuft={kopierenMut.isPending}
          kopierFehler={kopierenMut.error}
          onSchliessen={() => setDialog(null)}
        />
      )}
    </div>
  );
}
