import {
  DndContext,
  DragOverlay,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { App, Button, Flex, Spin } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { listeQualifikationen } from '../../api/qualifikationen';
import { globalKeys } from '../../api/queryKeys';
import type {
  QualiSollEintrag,
  SchichtplanBlock,
  SchichtplanBlockAendernBody,
  SchichtplanBlockBody,
  SchichtplanErzeugenBody,
} from '../../api/types';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { datum, uhrzeit } from '../../anzeige/zeitDarstellung';
import { alsBackendZeit } from '../../anzeige/zeitEingabe';
import { useRollen } from '../../components/instrument';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import { useViewport } from '../../components/useViewport';
import { ZugPointerSensor } from '../../components/zugPointerSensor';
import type { RasterBlock, RasterZeile, Spanne, ZugStand } from './raster';
import SchichtenErzeugenDialog from './SchichtenErzeugenDialog';
import { useBlockMenue } from './blockMenue';
import SchichtplanBlockDialog, { type BlockSpeichern } from './SchichtplanBlockDialog';
import SchichtplanListe from './SchichtplanListe';
import SchichtplanPersonen, { type PersonZugDaten } from './SchichtplanPersonen';
import SchichtplanRaster, { type BlockZielDaten } from './SchichtplanRaster';
import SchichtplanSchleuse from './SchichtplanSchleuse';
import {
  kopieBody,
  mitPerson,
  naechsterBlockBody,
  postenEingabe,
  postenSchluessel,
  type PersonOption,
} from './schichtplanZeilen';

/**
 * Gemeinsamer Plan-Editor (Change `y106s29r-blockplan-kern`, design.md D6) für den Schichtplan im
 * Einsatz (`SchichtplanAnsicht`) und den Plan einer Vorplanung (`planung/PlanungSchichtplan`).
 * Er trägt Dialog-Zustand, Mutationen (anlegen, ändern, kopieren, erzeugen, löschen, Block-Menü),
 * Zug und Ablage einer Person, die Ansagen, Raster oder Liste und die Dialoge.
 *
 * Die Hülle baut den {@link SchichtplanEditorAdapter}: Daten, Zeilen, Personen, Vorgaben, die
 * Aufrufe der API samt Übersetzung der Bodies, die Übernahme in den Cache, die Zeitspanne, Texte
 * und Werkzeuge, im Einsatz zusätzlich den Wechsel aus dem Plan. Was beide Pläne verschieden
 * machen, steht dort als Feld, nie als Fallunterscheidung hier.
 *
 * Kein eigener Rechenweg: jeder Schreibweg antwortet mit dem ganzen Plan (`P`), den
 * `cache.set` übernimmt.
 */

export interface SchichtplanEditorApi<P> {
  create: (body: SchichtplanBlockBody) => Promise<P>;
  update: (blockId: number, body: SchichtplanBlockAendernBody) => Promise<P>;
  delete: (block: SchichtplanBlock) => Promise<unknown>;
  erzeugen: (body: SchichtplanErzeugenBody) => Promise<P>;
}

export interface SchichtplanEditorCache<P> {
  /** Der Plan im Cache, wie er gerade steht (für „neu ist, was vorher nicht darin stand“). */
  get: () => P | undefined;
  /** Übernimmt die Antwort eines Schreibwegs. */
  set: (plan: P) => void;
  /** Nach dem Löschen: neu laden. */
  invalidate: () => void;
}

/** Wechsel aus dem Plan (LLH-1555, nur im Einsatz). */
export interface SchichtplanEditorWechsel {
  canWechsel: (block: SchichtplanBlock) => boolean;
  /** Die Wechsel-Leiste über dem Raster; `griff` öffnet den Wechsel eines Blocks, falls möglich. */
  renderLeiste: (griff: (blockId: number) => (() => void) | undefined) => ReactNode;
  renderDialog: (blockId: number, onSchliessen: () => void) => ReactNode;
}

export interface SchichtplanEditorAdapter<P> {
  /** `data-lfh` der Wurzel, je Hülle („schichtplan-ansicht“, „planung-plan“). */
  dataLfh: string;
  /** Blöcke des Plans in der Form des Einsatzes (leer, solange er lädt). */
  bloecke: readonly SchichtplanBlock[];
  rasterBloecke: RasterBlock[];
  /** Blöcke einer Schreibantwort in der Form des Einsatzes. */
  getBloecke: (plan: P) => readonly SchichtplanBlock[];
  zeilen: RasterZeile[];
  /** Die Quellen der Zeilen haben geantwortet (`SchichtplanSchleuse`, `bereit`). */
  zeilenBereit?: boolean;
  personen: readonly PersonOption[] | null;
  /** Grund, warum Personen gesperrt sind (Modul Personal); sonst `undefined`. */
  personenGesperrt?: string;
  sollVorgabe: ReadonlyMap<string, number | null>;
  qualiVorgabe: ReadonlyMap<string, readonly QualiSollEintrag[] | null>;
  /** Schichtlänge je Posten für „Schichten erzeugen“ (Vorplanung). */
  laengeVorgabe?: ReadonlyMap<string, string>;
  /** Kurztext des Schichtmodells für „Schichten erzeugen“, sonst `null`. */
  schichtmodell: string | null;
  jetzt: number;
  spanne: Spanne;
  /** Wahl der Zeitspanne vorn in der Werkzeugzeile (nicht auf dem Handschirm). */
  spanneSelect: ReactNode;
  canWrite: boolean;
  isErzeugenDisabled: boolean;
  /** Name des Rasters. */
  beschriftung: string;
  /** Titel eines Fehlers über dem Raster. */
  fehlerTitel: string;
  /** Weitere Werkzeuge hinter „Schichten erzeugen“. */
  tools?: ReactNode;
  /** Zeilen zwischen Werkzeugzeile und Zugfehler (Grenzwerte, Ladefehler). */
  header?: ReactNode;
  /** Der Plan lädt noch: statt Raster oder Liste ein Spinner. */
  isLoading?: boolean;
  /** Liste auf dem Handschirm: Zeitformat (Vorgabe Uhrzeit) und alle Blöcke statt der nächsten. */
  liste?: { formatZeit?: (ms: number) => string; alleBloecke?: boolean };
  api: SchichtplanEditorApi<P>;
  cache: SchichtplanEditorCache<P>;
  wechsel?: SchichtplanEditorWechsel;
}

type Dialog =
  | { art: 'anlegen'; vorbelegt?: { zeile?: string; von?: number; bis?: number } }
  | { art: 'block'; blockId: number }
  | { art: 'wechsel'; blockId: number }
  | { art: 'erzeugen' };

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

export default function SchichtplanEditor<P>({
  adapter,
}: {
  adapter: SchichtplanEditorAdapter<P>;
}) {
  const {
    bloecke,
    zeilen,
    personen,
    personenGesperrt,
    canWrite,
    jetzt,
    api,
    cache,
    getBloecke,
    wechsel,
  } = adapter;
  const { message } = App.useApp();
  const { token, rollen } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const { istSchmal, abBreite } = useViewport();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // Für Antworten, die nach einem Dialogwechsel eintreffen (Kopie als nächsten Block).
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

  const qualiQuery = useQuery({
    queryKey: globalKeys.qualifikationen(),
    queryFn: listeQualifikationen,
  });
  const qualiNamen = useMemo(
    () => new Map((qualiQuery.data ?? []).map((q) => [q.id, q.label])),
    [qualiQuery.data],
  );

  // ── Schreiben ── Jede Antwort ist der ganze Plan; `cache.set` übernimmt ihn.
  const anlegenMut = useMutation({
    mutationFn: (body: SchichtplanBlockBody) => api.create(body),
    onSuccess: cache.set,
  });
  const aendernMut = useMutation({
    mutationFn: (v: { blockId: number; body: SchichtplanBlockAendernBody }) =>
      api.update(v.blockId, v.body),
    onSuccess: cache.set,
  });
  // Eigene Mutation für die Kopie aus dem Dialog: ihr Fehler steht dort, nicht beim Speichern.
  const kopierenMut = useMutation({
    mutationFn: (body: SchichtplanBlockBody) => api.create(body),
    onSuccess: cache.set,
  });
  const erzeugenMut = useMutation({
    mutationFn: (body: SchichtplanErzeugenBody) => api.erzeugen(body),
    onSuccess: (p) => {
      // Neu ist, was vorher nicht im Plan stand.
      const imCache = cache.get();
      const vorher = new Set(imCache === undefined ? [] : getBloecke(imCache).map((b) => b.id));
      cache.set(p);
      const neu = getBloecke(p).filter((b) => !vorher.has(b.id)).length;
      message.success(neu === 1 ? '1 Schicht erzeugt' : `${neu} Schichten erzeugt`);
    },
  });
  // Nur der Dialog des gelöschten Blocks schließt: ein Löschen aus dem Kontextmenü (LLH-1600)
  // kehrt womöglich erst zurück, wenn schon der Dialog eines anderen Blocks offen ist.
  const nachLoeschen = (_antwort: unknown, b: SchichtplanBlock) => {
    setDialog((d) => (d != null && 'blockId' in d && d.blockId === b.id ? null : d));
    cache.invalidate();
  };
  const loeschenMut = useMutation({
    mutationFn: (b: SchichtplanBlock) => api.delete(b),
    onSuccess: nachLoeschen,
  });
  // Kontextmenü (LLH-1600): eigene Mutationen, damit Lauf und Fehler eines stillen Kopierens oder
  // Löschens nie im Dialog eines anderen Blocks stehen und `reset()` beim Öffnen eines Blocks die
  // Sperre des Menüs nicht aufhebt. Fehler stehen über dem Raster (`zugSchreiben`).
  const menueKopierenMut = useMutation({
    mutationFn: (body: SchichtplanBlockBody) => api.create(body),
    onSuccess: cache.set,
  });
  const menueLoeschenMut = useMutation({
    mutationFn: (b: SchichtplanBlock) => api.delete(b),
    onSuccess: nachLoeschen,
  });
  // Fehler eines Zugs im Raster (ohne offenen Dialog) stehen über dem Raster.
  const [zugFehler, setZugFehler] = useState<unknown>(null);
  const zugSchreiben = (p: Promise<unknown>) => {
    setZugFehler(null);
    p.catch((e: unknown) => setZugFehler(e));
  };

  const blockVon = (id: number) => bloecke.find((b) => b.id === id) ?? null;
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
  // Strg/Alt-Zug: Kopie an Zeile und Zeit des Schattens, mit Personen, solange sie nicht gesperrt
  // sind (die Notiz bleibt).
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
    const vorher = new Set(bloecke.map((b) => b.id));
    kopierenMut.mutate(body, {
      onSuccess: (p) => {
        const neu = getBloecke(p).find(
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
  const oeffneWechsel = (b: SchichtplanBlock) => setDialog({ art: 'wechsel', blockId: b.id });
  const dialogBlock = dialog?.art === 'block' ? blockVon(dialog.blockId) : null;
  // Kontextmenü eines Blocks (LLH-1600): „Als nächsten Block kopieren“ ohne Dialog, die Kopie
  // erscheint im Raster; ein Fehler steht über dem Raster wie bei einem Zug.
  const kopiereStill = (block: SchichtplanBlock) => {
    const body = naechsterBlockBody(block);
    if (!body) return;
    zugSchreiben(
      menueKopierenMut.mutateAsync(body).then(() => {
        message.success('Block kopiert');
      }),
    );
  };
  // Ohne Wechsel-Teil (Vorplanung) gibt es keinen Wechsel aus dem Plan.
  const blockMenue = useBlockMenue({
    blockVon,
    onBearbeiten: oeffneBlock,
    onKopieren: kopiereStill,
    onLoeschen: (b) => zugSchreiben(menueLoeschenMut.mutateAsync(b)),
    ...(wechsel ? { onWechsel: oeffneWechsel, wechselMoeglich: wechsel.canWechsel } : {}),
    laeuft: menueKopierenMut.isPending || menueLoeschenMut.isPending,
  });
  const mitSeitenleiste = !istSchmal && canWrite;

  return (
    <div data-lfh={adapter.dataLfh}>
      <Flex
        gap={token.marginSM}
        align="center"
        wrap
        data-lfh="schichtplan-werkzeugzeile"
        style={{ marginBottom: token.margin }}
      >
        {!istSchmal && adapter.spanneSelect}
        {canWrite && <Button onClick={oeffneAnlegen}>Block anlegen</Button>}
        {canWrite && (
          <Button onClick={oeffneErzeugen} disabled={adapter.isErzeugenDisabled}>
            Schichten erzeugen
          </Button>
        )}
        {adapter.tools}
      </Flex>
      {adapter.header}
      {zugFehler != null && (
        <div style={{ marginBottom: token.marginSM }}>
          <SpeicherFehler fehler={zugFehler} titel={adapter.fehlerTitel} />
        </div>
      )}
      {wechsel?.renderLeiste((blockId) => {
        const b = blockVon(blockId);
        return b && wechsel.canWechsel(b) ? () => oeffneWechsel(b) : undefined;
      })}
      {adapter.isLoading ? (
        <Spin />
      ) : istSchmal ? (
        <SchichtplanSchleuse
          zeilen={zeilen}
          halten={schleuseHalten}
          bereit={adapter.zeilenBereit}
          schmal
        >
          {(z) => (
            <SchichtplanListe
              zeilen={z}
              bloecke={adapter.rasterBloecke}
              jetzt={jetzt}
              formatZeit={adapter.liste?.formatZeit ?? zeitText}
              onOeffnen={oeffneBlock}
              alleBloecke={adapter.liste?.alleBloecke}
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
            <SchichtplanSchleuse
              zeilen={zeilen}
              halten={schleuseHalten}
              bereit={adapter.zeilenBereit}
            >
              {(z) => (
                <SchichtplanRaster
                  zeilen={z}
                  bloecke={adapter.rasterBloecke}
                  spanne={adapter.spanne}
                  jetzt={jetzt}
                  darfSchreiben={canWrite}
                  zone={konventionen.zeitzone}
                  formatMarke={markeText}
                  formatZeit={zeitText}
                  onAnlegen={onAnlegen}
                  onAendern={onAendern}
                  onKopieren={onKopieren}
                  onOeffnen={oeffneBlock}
                  personenZiel={mitSeitenleiste && !personenGesperrt}
                  beschriftung={adapter.beschriftung}
                  onZug={setZugLaeuft}
                  blockMenue={canWrite ? blockMenue : undefined}
                  onMenue={setMenueOffen}
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
          schichtmodell={adapter.schichtmodell}
          laengeVorgabe={adapter.laengeVorgabe}
          darfSchreiben={canWrite}
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
          sollVorgabe={adapter.sollVorgabe}
          qualiVorgabe={adapter.qualiVorgabe}
          qualiNamen={qualiNamen}
          darfSchreiben={canWrite}
          laeuft={anlegenMut.isPending || aendernMut.isPending}
          speicherung={dialog.art === 'anlegen' ? anlegenMut : aendernMut}
          loeschenLaeuft={loeschenMut.isPending}
          loeschFehler={loeschenMut.error}
          onSpeichern={speichern}
          onLoeschen={(b) => loeschenMut.mutate(b)}
          onKopieren={kopiereAlsNaechsten}
          kopierenLaeuft={kopierenMut.isPending}
          kopierFehler={kopierenMut.error}
          onWechsel={dialogBlock && wechsel?.canWechsel(dialogBlock) ? oeffneWechsel : undefined}
          onSchliessen={() => setDialog(null)}
        />
      )}
      {dialog?.art === 'wechsel' && wechsel?.renderDialog(dialog.blockId, () => setDialog(null))}
    </div>
  );
}
