import { App, Breadcrumb, Button, Modal, Space, Tag, Tree, type TreeDataNode } from 'antd';
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { Link, useParams, useSearchParams } from 'react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { einsatzKeys } from '../api/queryKeys';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { listeEinheiten, patcheEinheit } from '../api/einheiten';
import {
  listeAbschnitte,
  loeseAbschnittAuf,
  patcheAbschnitt,
  type AbschnittPatch,
} from '../api/einsatzabschnitte';
import type { Einheit, Einsatzabschnitt } from '../api/types';
import StaerkeAnzeige from '../anzeige/StaerkeAnzeige';
import { Liste, ListenEintrag } from '../components/Liste';
import {
  SeitenFehler,
  SeitenLeer,
  SeitenSkeleton,
  SeitenStandVeraltet,
} from '../components/SeitenZustand';
import { useQueryParamSelektion } from '../routing/useQueryParamSelektion';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import EinsatzSeite from '../components/EinsatzSeite';
import { Augenbraue, Paneel, Segmentleiste, monoStil, useRollen } from '../components/instrument';
import { useViewport } from '../components/useViewport';
import { abschnittStaerken } from './einsatzabschnitte/abschnittStaerke';
import AbschnittKnoten from './einsatzabschnitte/AbschnittKnoten';
import AbschnittDetail, { type AbschnittPatchHandler } from './einsatzabschnitte/AbschnittDetail';
import AbschnittAnlegenModal from './einsatzabschnitte/AbschnittAnlegenModal';
import { abrufZustand } from '../api/abrufZustand';
import {
  einheitenPfad,
  lagekartePfad,
  parseAbschnitteAnsicht,
  type AbschnitteAnsicht,
} from '../routing/deeplinks';
import { SeitenHinweise, SpeicherFehler } from '../components/SpeicherHinweis';
import { einsatzRechteGrund } from '../components/nurAnsicht';
import { SprungKnopf } from '../components/Sprung';
import { useSprungSperre } from '../einsatz/useSprungSperre';
import type { Quelle } from '../stab/luecken';
import Organigramm from './einsatzabschnitte/Organigramm';
import { modulName } from '../einsatz/modulRegistry';
import { ZugPointerSensor } from '../components/zugPointerSensor';
import { MenueAusloeser } from '../components/MenueAusloeser';
import { Sammelbanner } from '../components/instrument';
import { zeigeRueckgaengig } from '../kommunikation/rueckgaengig';
import { useGehaltenerBaum } from '../components/organigramm/useGehaltenerBaum';
import { wartendText } from '../components/organigramm/baumSchleuse';
import {
  einheitVerschiebeText,
  elternKeys,
  buildGliederungKnoten,
  removeEntfallenes,
  verschiebeText,
  type GliederungKnoten,
} from './einsatzabschnitte/gliederungDragKern';
import {
  ObersteEbeneDropZone,
  DRAG_ANSAGEN,
  DropKnoten,
  DragHandle,
  DragMarke,
  useActiveDrag,
  type DropDaten,
  type DragDaten,
} from './einsatzabschnitte/GliederungDrag';
import VerschiebenDialog from './einsatzabschnitte/VerschiebenDialog';
import { useNewGesture } from './einsatzabschnitte/useNewGesture';

/**
 * Zwei Ansichten derselben Daten (LFH-626): die Gliederung bearbeitet, das Organigramm liest,
 * druckt und übernimmt. Kein Nutzerschalter Tabelle ↔ Karte — das hier sind zwei Fragen.
 */
const ANSICHT_OPTIONEN = [
  { wert: 'gliederung', label: 'Gliederung' },
  { wert: 'organigramm', label: 'Organigramm' },
] as const satisfies readonly { wert: AbschnitteAnsicht; label: string }[];

/**
 * Der gezeigte Stand der Gliederung als antd-Baum. Die Struktur kommt aus der Schleuse
 * (`gezeigt`), Stärke und Einheitenzahl aus den frischen Listen: der Inhalt fließt.
 */
function buildBaum(
  gezeigt: readonly GliederungKnoten[],
  abschnitte: Einsatzabschnitt[],
  einheiten: Einheit[],
  ziehbar: boolean,
): TreeDataNode[] {
  return gezeigt.map(({ abschnitt: a, kinder }) => {
    const inhalt = (
      <AbschnittKnoten
        abschnitt={a}
        staerke={abschnittStaerken(abschnitte, einheiten, a.id).inklUnter}
        anzahlEinheiten={einheiten.filter((e) => e.abschnitt_id === a.id).length}
      />
    );
    return {
      key: a.id,
      title: ziehbar ? (
        <DropKnoten abschnitt={a} abschnitte={abschnitte}>
          <DragHandle daten={{ art: 'abschnitt', id: a.id, name: a.name }} />
          {inhalt}
        </DropKnoten>
      ) : (
        inhalt
      ),
      children: buildBaum(kinder, abschnitte, einheiten, ziehbar),
    };
  });
}

/**
 * Ein Umhang (LFH-1212): ein Abschnitt unter einen anderen (`nach` = `null`: oberste Ebene) oder
 * eine Einheit in einen Abschnitt. `quelle` sagt, wo der Grund einer Ablehnung steht: am Baum, im
 * Dialog oder — für das Rückgängig aus dem Toast — im Seitenhinweis.
 */
interface Verschiebung {
  /** Der Einsatz beim Auslösen: ein Rückgängig nach einem Einsatzwechsel trifft den alten. */
  einsatzId: number;
  art: DragDaten['art'];
  id: number;
  name: string;
  von: number | null;
  nach: number | null;
  quelle: 'drag' | 'menue' | 'rueckgaengig';
}

/** Was am Zeiger hängt, solange gezogen wird. */
function ActiveDragMarke() {
  const drag = useActiveDrag();
  return drag ? <DragMarke drag={drag} /> : null;
}

export default function EinsatzabschnittePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [gewaehlt, setGewaehlt] = useState<number | null>(null);
  // „Abschnitt anlegen“ ist eine Erfassung (LFH-1208, design.md D6): kein lokaler Entwurf mehr in
  // der Gliederung, den Datensatz gibt es erst nach dem Absenden.
  const [isAnlegenOpen, setIsAnlegenOpen] = useState(false);
  /**
   * Offener Dialog „Verschieben unter …“ (Abschnitts-ID) und offene Rückfrage „Auflösen“. Beide
   * halten IHREN Abschnitt fest: wechselt das Detail darunter (die Vorwahl nach einem fremden
   * Umhang), träfe die Bestätigung sonst einen anderen.
   */
  const [verschiebenFuer, setVerschiebenFuer] = useState<number | null>(null);
  const [aufloesenFuer, setAufloesenFuer] = useState<{ id: number; name: string } | null>(null);
  /** Gründe abgelehnter Umhänge, je Ort (LFH-1077): Baum, Dialog, Seitenhinweis. */
  const [dragFehler, setDragFehler] = useState<unknown>(null);
  const [dialogFehler, setDialogFehler] = useState<unknown>(null);
  const [rueckFehler, setRueckFehler] = useState<unknown>(null);
  /** Zugeklappte Abschnitte; alles andere steht offen, auch ein Abschnitt, der eben Kinder bekam. */
  const [zugeklappt, setZugeklappt] = useState<ReadonlySet<number>>(() => new Set());
  const weitereRef = useRef<HTMLSpanElement>(null);
  const { abBreite } = useViewport();
  const breit = abBreite('md');
  const { token, rollen } = useRollen();
  // Je Einsatz, damit ein Einsatzwechsel in derselben Instanz nicht die Ansicht des vorigen
  // mitnimmt (Muster `FahrzeugePage`).
  const [ansichtNachEinsatz, setAnsichtNachEinsatz] = useState<Record<number, AbschnitteAnsicht>>(
    {},
  );
  const ansicht = ansichtNachEinsatz[einsatzId] ?? 'gliederung';
  const setzeAnsicht = (a: AbschnitteAnsicht) =>
    setAnsichtNachEinsatz((alt) => ({ ...alt, [einsatzId]: a }));

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
  });
  const personalQuery = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
  });

  // Cross-Modul-Deeplink: ?abschnitt=<id> selektiert den Abschnitt, sofern vorhanden.
  useQueryParamSelektion('abschnitt', abschnitteQuery.isSuccess, (zid) => {
    if ((abschnitteQuery.data ?? []).some((a) => a.id === zid)) {
      setGewaehlt(zid);
      // Aus dem Organigramm: das Detail steht in der Gliederung (LFH-626, D7).
      setAnsichtNachEinsatz((alt) => ({ ...alt, [einsatzId]: 'gliederung' }));
    }
  });

  // Schnellaktion: ?neu=1 öffnet die Erfassung eines neuen Abschnitts (Sprungpalette, LFH-506) —
  // dieselben Schritte wie `openAnlegen`, hier ausgeschrieben, weil die Funktion je Render neu
  // entsteht. Warten bis der Einsatz geladen ist; Param immer löschen, Erfassung nur bei
  // Schreibrecht.
  const [searchParams, setSearchParams] = useSearchParams();
  const darfSchreibenRoh = darfImEinsatzSchreiben(einsatzQuery.data);
  useEffect(() => {
    if (searchParams.get('neu') !== '1') return;
    if (einsatzQuery.isLoading) return;
    if (darfSchreibenRoh) {
      setIsAnlegenOpen(true);
      // Der neue Abschnitt steht danach gewählt in der Gliederung, nicht im Organigramm.
      setAnsichtNachEinsatz((alt) => ({ ...alt, [einsatzId]: 'gliederung' }));
    }
    const naechste = new URLSearchParams(searchParams);
    naechste.delete('neu');
    setSearchParams(naechste, { replace: true });
  }, [searchParams, setSearchParams, einsatzQuery.isLoading, darfSchreibenRoh, einsatzId]);

  // Sichtvorgabe ?ansicht= (LFH-626), apply-then-clean wie auf der Fahrzeugseite. Geräumt wird
  // auch ein unbrauchbarer Wert, sonst stünde er beim Teilen des Links wieder im Auftrag.
  useEffect(() => {
    if (!searchParams.has('ansicht')) return;
    // `?neu=1` gewinnt: der neue Abschnitt steht danach in der Gliederung (Review LFH-626).
    const vorgabe =
      searchParams.get('neu') === '1' ? undefined : parseAbschnitteAnsicht(searchParams);
    if (vorgabe) setAnsichtNachEinsatz((alt) => ({ ...alt, [einsatzId]: vorgabe }));
    const rest = new URLSearchParams(searchParams);
    rest.delete('ansicht');
    setSearchParams(rest, { replace: true });
  }, [searchParams, setSearchParams, einsatzId]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.abschnitte(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }

  const abschnitte = useMemo(() => abschnitteQuery.data ?? [], [abschnitteQuery.data]);
  /**
   * Live-Zufluss der Gliederung über die Schleuse (LFH-1212, `frontend/AGENTS.md`, „Zufluss der
   * `Datensicht`“): Zeiger, Fokus oder ein Zug in der Gliederung halten Menge, Ort und Folge der
   * Abschnitte; was ein anderer Arbeitsplatz umhängt, wartet im Sammelbanner. Entfallenes fällt
   * sofort weg (`removeEntfallenes`).
   */
  const frischerBaum = useMemo(() => buildGliederungKnoten(abschnitte), [abschnitte]);
  const zufluss = useGehaltenerBaum(frischerBaum);
  const gezeigterBaum = useMemo(
    () => removeEntfallenes(zufluss.stand.gezeigt, zufluss.stand.entfallen),
    [zufluss.stand],
  );
  const wartet = wartendText({ ...zufluss.stand.wartend, entfallen: 0 });
  const sensoren = useSensors(
    // 5 px Weg, sonst begänne jeder Klick auf den Griff einen Zug (Muster UHS-Grundriss).
    useSensor(ZugPointerSensor, { activationConstraint: { distance: 5 } }),
  );
  const istGesperrt = useSprungSperre(einsatzId);
  // Für das Organigramm: eine fehlende Liste ist kein leerer Bestand (Stärke „—“ mit Grund).
  const einheitenZustand =
    einheitenQuery.data != null ? ('daten' as const) : abrufZustand(einheitenQuery);
  const einheitenQuelle: Quelle<Einheit> = useMemo(
    () => ({ zustand: einheitenZustand, daten: einheitenQuery.data ?? [] }),
    [einheitenZustand, einheitenQuery.data],
  );
  /**
   * Ohne Wahl steht der erste Abschnitt der Gliederung im Detail (LFH-1078): statt einer
   * Aufforderung „Wähle einen Abschnitt im Baum“ zeigt die Seite gleich einen. `gewaehlt` bleibt
   * die Wahl der Person; die Vorwahl ist nur ihr Rückfall.
   */
  const aktuell =
    gewaehlt != null
      ? (abschnitte.find((a) => a.id === gewaehlt) ?? null)
      : (abschnitte.find((a) => a.ueber_abschnitt_id == null) ?? null);

  // Zeilenweg (LFH-1208, design.md D2): EIN Feld je PATCH, nie der Stand vom Öffnen — so
  // überschreibt keine Zeile, was ein anderer Arbeitsplatz inzwischen geändert hat. Der Fehler
  // geht an die Zeile (`mutateAsync` lehnt ab), deshalb kein `onError`-Toast.
  const patch = useMutation({
    mutationFn: ({ aid, patch: p }: { aid: number; etikett: string; patch: AbschnittPatch }) =>
      patcheAbschnitt(einsatzId, aid, p),
    onSuccess: (aktualisiert, { etikett }) => {
      // Erst in den Cache, dann erfüllen: die Zeile zeigt den neuen Wert in derselben Runde, in der
      // sie die Eingabe schließt (Muster Einsatzdaten).
      qc.setQueryData<Einsatzabschnitt[]>(einsatzKeys.abschnitte(einsatzId), (alt) =>
        alt?.map((a) => (a.id === aktualisiert.id ? aktualisiert : a)),
      );
      invalidate();
      message.success(`${etikett} gespeichert`);
    },
  });
  const patchHandler =
    (aid: number): AbschnittPatchHandler =>
    (etikett, p) =>
      patch.mutateAsync({ aid, etikett, patch: p });
  const aufloesen = useMutation({
    mutationFn: (aid: number) => loeseAbschnittAuf(einsatzId, aid),
    onSuccess: (_, aid) => {
      // Sofort aus der Liste: bis zum Neuabruf stünde der aufgelöste Abschnitt sonst als Vorwahl
      // mit bearbeitbaren Zeilen im Detail, und ein Speichern liefe ins Leere. Unterabschnitte
      // rücken serverseitig hoch; das bringt der Neuabruf.
      qc.setQueryData<Einsatzabschnitt[]>(einsatzKeys.abschnitte(einsatzId), (alt) =>
        alt?.filter((a) => a.id !== aid),
      );
      invalidate();
      setGewaehlt(null);
    },
  });

  const einsatzRef = useRef(einsatzId);
  einsatzRef.current = einsatzId;
  const setzeFehler = (quelle: Verschiebung['quelle'], fehler: unknown) =>
    (quelle === 'drag' ? setDragFehler : quelle === 'menue' ? setDialogFehler : setRueckFehler)(
      fehler,
    );
  // Ein Einsatzwechsel in derselben Instanz räumt die Gründe: ihr Ort ist ein anderer Einsatz.
  useEffect(() => {
    setDragFehler(null);
    setDialogFehler(null);
    setRueckFehler(null);
    setVerschiebenFuer(null);
    setAufloesenFuer(null);
  }, [einsatzId]);

  /**
   * Umhängen per Zug oder Menü (LFH-1212): genau EIN Feld geht hinaus (`patcheAbschnitt` bzw.
   * `patcheEinheit`, Tri-State), ein mitgeschickter Name aus älterem Stand überschriebe sonst eine
   * gleichzeitige Umbenennung. Der Rückweg ist serverseitig derselbe PATCH, deshalb Rückgängig im
   * Toast statt Rückfrage (LFH-343). Der Zwischenspeicher zieht sofort nach, und die Schleuse
   * übernimmt das Ergebnis: die eigene Handlung wartet nicht hinter dem Banner.
   */
  const verschieben = useMutation({
    mutationFn: async (v: Verschiebung): Promise<void> => {
      if (v.art === 'abschnitt')
        await patcheAbschnitt(v.einsatzId, v.id, { ueber_abschnitt_id: v.nach });
      else await patcheEinheit(v.einsatzId, v.id, { abschnitt_id: v.nach });
    },
    // Jede Quelle räumt nur ihren eigenen Grund: ein Rückgängig aus dem Toast nimmt dem offenen
    // Dialog seinen nicht.
    onMutate: (v) => setzeFehler(v.quelle, null),
    onSuccess: (_antwort, v) => {
      // Nach einem Einsatzwechsel gehört die Antwort nicht mehr zu dieser Ansicht.
      if (v.einsatzId !== einsatzRef.current) return;
      if (v.art === 'abschnitt') {
        const neu = (
          qc.getQueryData<Einsatzabschnitt[]>(einsatzKeys.abschnitte(v.einsatzId)) ?? []
        ).map((a) => (a.id === v.id ? { ...a, ueber_abschnitt_id: v.nach } : a));
        qc.setQueryData(einsatzKeys.abschnitte(v.einsatzId), neu);
        zufluss.uebernehmen(buildGliederungKnoten(neu));
        // Der neue Über-Abschnitt steht offen, sonst verschwände der Abschnitt im Zuklappen.
        if (v.nach !== null) {
          const nach = v.nach;
          setZugeklappt((alt) => {
            if (!alt.has(nach)) return alt;
            const rest = new Set(alt);
            rest.delete(nach);
            return rest;
          });
        }
      } else {
        qc.setQueryData<Einheit[]>(einsatzKeys.einheiten(v.einsatzId), (alt) =>
          alt?.map((e) => (e.id === v.id ? { ...e, abschnitt_id: v.nach } : e)),
        );
      }
      invalidate();
      // Nur der eigene Weg schließt den Dialog; ein Zug oder Rückgängig daneben lässt ihn offen.
      if (v.quelle === 'menue') setVerschiebenFuer(null);
      if (v.quelle === 'rueckgaengig') return;
      const ziel = v.nach === null ? null : (abschnitte.find((a) => a.id === v.nach)?.name ?? '');
      zeigeRueckgaengig(
        message,
        v.art === 'abschnitt'
          ? verschiebeText(v.name, ziel)
          : einheitVerschiebeText(v.name, ziel ?? ''),
        () => verschieben.mutate({ ...v, von: v.nach, nach: v.von, quelle: 'rueckgaengig' }),
      );
    },
    onError: (fehler, v) => {
      if (v.einsatzId === einsatzRef.current) setzeFehler(v.quelle, fehler);
    },
  });

  function handleDragStart() {
    setDragFehler(null);
    zufluss.holdDrag(true);
  }

  function handleDragEnd(e: DragEndEvent) {
    zufluss.holdDrag(false);
    const drag = e.active.data.current as DragDaten | undefined;
    const ziel = e.over?.data.current as DropDaten | undefined;
    // Gesperrte Ziele sind `disabled` und melden sich nie als `over`.
    if (!drag || !ziel) return;
    const von =
      drag.art === 'abschnitt'
        ? (abschnitte.find((a) => a.id === drag.id)?.ueber_abschnitt_id ?? null)
        : drag.abschnittId;
    verschieben.mutate({
      einsatzId,
      art: drag.art,
      id: drag.id,
      name: drag.name,
      von,
      nach: ziel.zielId,
      quelle: 'drag',
    });
  }

  /**
   * Der Fokus kehrt nach dem Dialog zum Abschnitt zurück, an „Weitere Aktionen“ (LFH-1212). Sofort
   * beim Schließen; `nachDemSchliessen` holt ihn im Browser nach der Animation ein zweites Mal
   * (Muster `betreuung/MeldeVerlauf.tsx`).
   */
  const focusAbschnitt = useCallback(
    () => weitereRef.current?.querySelector('button')?.focus(),
    [],
  );
  const dialogOffen = verschiebenFuer !== null || aufloesenFuer !== null;
  const warOffen = useRef(false);
  useEffect(() => {
    if (warOffen.current && !dialogOffen) focusAbschnitt();
    warOffen.current = dialogOffen;
  }, [dialogOffen, focusAbschnitt]);
  // Erst eine neue Geste handelt im Dialog (`useNewGesture`): nicht das Enter aus dem Menü.
  const isNewGestureAufloesen = useNewGesture(aufloesenFuer !== null);

  function openVerschieben(aid: number) {
    setDialogFehler(null);
    setVerschiebenFuer(aid);
  }

  /*
   * Auflösen meldet seine Ablehnung im Detailpaneel, kein Toast (LFH-1077, `frontend/AGENTS.md`,
   * „Rückwege und Fehler“); die Zeilen melden ihre selbst. Der Grund gehört zum gezeigten
   * Abschnitt: ein neuer Versuch und der Wechsel des Abschnitts räumen ihn. Eine laufende Mutation
   * bleibt unberührt, `reset()` hängte ihr Ergebnis ab. Ref, damit der Effekt beim Wechsel die
   * AKTUELLE Mutation räumt, ohne je Render neu zu laufen.
   */
  const aufloesenMutationRef = useRef(aufloesen);
  aufloesenMutationRef.current = aufloesen;
  const clearDetailError = useCallback(() => {
    const m = aufloesenMutationRef.current;
    if (!m.isPending && m.error != null) m.reset();
  }, []);

  // Beim Wechsel des angezeigten Abschnitts räumen — auch wenn die Vorwahl wechselt, weil ein
  // anderer Arbeitsplatz den Abschnitt aufgelöst hat. Offene Zeilen räumt `key` am Detail.
  const aktuellId = aktuell?.id;
  useEffect(() => {
    clearDetailError();
  }, [aktuellId, clearDetailError]);

  function openAnlegen() {
    clearDetailError();
    setIsAnlegenOpen(true);
    setzeAnsicht('gliederung');
  }

  const baumDaten = useMemo(
    () => buildBaum(gezeigterBaum, abschnitte, einheitenQuery.data ?? [], darfSchreibenRoh),
    [gezeigterBaum, abschnitte, einheitenQuery.data, darfSchreibenRoh],
  );
  const aufgeklappt = useMemo(
    () => elternKeys(gezeigterBaum).filter((k) => !zugeklappt.has(k)),
    [gezeigterBaum, zugeklappt],
  );
  const verschiebenAbschnitt =
    verschiebenFuer != null ? (abschnitte.find((a) => a.id === verschiebenFuer) ?? null) : null;
  const personal = personalQuery.data ?? [];
  const zugeordneteEinheiten = (einheitenQuery.data ?? []).filter(
    (e) => e.abschnitt_id === aktuell?.id,
  );

  // Zwei Werte, getrennt beschriftet: „eigene" (Bedeutung der Bestandszeile) und „inkl.
  // Unterabschnitte".
  const staerken = aktuell
    ? abschnittStaerken(abschnitte, einheitenQuery.data ?? [], aktuell.id)
    : { eigene: null, inklUnter: null };

  // Zwei Ebenen, getrennt gehalten:
  //
  // Seitenzustand — nur `einsatzQuery`. Ohne sie rendern weder Breadcrumb noch
  // `darfImEinsatzSchreiben(...)`; nur diese Query rechtfertigt einen Frühausstieg.
  //
  // Listenzustand — `abschnitteQuery` und alles Weitere entscheidet an der Stelle der Daten, nie
  // als Frühausstieg: sonst risse ein gescheiterter Nebenabruf die ganze Seite weg.
  if (einsatzQuery.isLoading) return <SeitenSkeleton />;
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Einsatz nicht gefunden oder kein Zugriff"
        ursache={einsatzQuery.error}
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz);

  /**
   * Listenzustand der Gliederungs-Karte — der Fehler allein reicht als Bedingung nicht. Ohne
   * Abschnitte im Zwischenspeicher tritt der Fehler an die Stelle des Baums; mit Abschnitten bleibt
   * der Baum stehen und bekommt ein Banner: er ist echt, nur womöglich alt.
   *
   * Gemessen an der ungefilterten Menge (Muster aus `TierePage`/`SchaedenPage`).
   */
  const listeGescheitert = abschnitteQuery.isError && abschnitte.length === 0;
  const standVeraltet = abschnitteQuery.isError && abschnitte.length > 0;

  const einheitenListe = (
    <>
      <Augenbraue
        als="h3"
        style={{ display: 'block', marginTop: token.marginLG, marginBottom: token.marginXS }}
      >
        Zugeordnete Einheiten
      </Augenbraue>
      <Liste
        size="small"
        emptyText="Keine Einheiten zugeordnet"
        dataSource={zugeordneteEinheiten}
        renderItem={(e) => (
          <ListenEintrag>
            <Space>
              {darfSchreiben && (
                <DragHandle
                  daten={{
                    art: 'einheit',
                    id: e.id,
                    name: e.name,
                    abschnittId: e.abschnitt_id ?? null,
                  }}
                />
              )}
              <span>{e.name}</span>
              {e.typ_label && <Tag>{e.typ_label}</Tag>}
              <span style={{ ...monoStil(12), color: rollen.gedaempft }}>
                kumuliert <StaerkeAnzeige wert={e.ist_kumuliert} />
              </span>
            </Space>
          </ListenEintrag>
        )}
      />
      {/* Die Zuordnung setzt die Einheit (Feld „Abschnitt“ ihrer Detailseite): ein Sprung
          dorthin statt eines Satzes (LFH-1078). */}
      <div style={{ marginTop: token.marginXS }}>
        <SprungKnopf to={einheitenPfad(einsatzId)} gesperrt={istGesperrt('einheiten')}>
          Zu den Einheiten
        </SprungKnopf>
      </div>
    </>
  );

  return (
    <EinsatzSeite
      titel={modulName('einsatzabschnitte')}

      meta={abschnitteQuery.isSuccess ? `${abschnitte.length} Abschnitte` : undefined}
      dataUpdatedAt={gemeinsamerDatenstand(
        abschnitteQuery.dataUpdatedAt,
        einheitenQuery.dataUpdatedAt,
        personalQuery.dataUpdatedAt,
      )}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: modulName('einsatzabschnitte') },
          ]}
        />
      }
      aktionen={
        <Space wrap style={{ minWidth: 0 }}>
          {/* Der Umschalter steht auch ohne Schreibrecht: lesen kann jeder beide Ansichten. */}
          <Segmentleiste<AbschnitteAnsicht>
            beschriftung="Ansicht"
            optionen={ANSICHT_OPTIONEN}
            wert={ansicht}
            onWechsel={setzeAnsicht}
          />
          {darfSchreiben && (
            <Button type="primary" onClick={openAnlegen}>
              Abschnitt anlegen
            </Button>
          )}
        </Space>
      }
      hinweis={
        // Nur gesetzt, wenn er Inhalt hat: ein leerer Slot hielte Abstand frei. Das Rückgängig aus
        // dem Toast meldet seine Ablehnung hier: sein Ort ist kein Teil der Seite (LFH-1077).
        darfSchreiben && rueckFehler == null ? undefined : (
          <SeitenHinweise
            rechteFehlt={!darfSchreiben}
            rechteText={einsatzRechteGrund(einsatz.status)}
            fehler={rueckFehler}
            fehlerTitel="Nicht zurückgenommen"
            fehlerFallback="Rückgängig fehlgeschlagen"
          />
        )
      }
    >
      {ansicht === 'organigramm' ? (
        abschnitteQuery.isLoading ? (
          <SeitenSkeleton />
        ) : listeGescheitert ? (
          <SeitenFehler
            text="Abschnitte konnten nicht geladen werden"
            ursache={abschnitteQuery.error}
            onWiederholen={() => void abschnitteQuery.refetch()}
          />
        ) : abschnitte.length === 0 &&
          einheitenQuelle.zustand === 'daten' &&
          einheitenQuelle.daten.length === 0 ? (
          // Leer nur, wenn BEIDE Quellen da sind: ohne Einheiten wäre „keine Abschnitte“ eine
          // Aussage über eine Lage, die niemand geprüft hat.
          <SeitenLeer
            titel="Noch keine Abschnitte"
            aktion={
              darfSchreiben ? { label: 'Abschnitt anlegen', onClick: openAnlegen } : undefined
            }
          />
        ) : (
          <>
            {standVeraltet && (
              <SeitenStandVeraltet onWiederholen={() => void abschnitteQuery.refetch()} />
            )}
            <Organigramm
              einsatz={einsatz}
              abschnitte={abschnitte}
              einheiten={einheitenQuelle}
              datenstand={gemeinsamerDatenstand(
                abschnitteQuery.dataUpdatedAt,
                einheitenQuery.dataUpdatedAt,
              )}
            />
          </>
        )
      ) : (
        /* Unter `md` stapeln statt einer 360-px-Spalte neben dem Detail. Kein Collapse:
          gestapelt trägt die Gliederung dieselbe Bedienung wie breit. Der Zugkontext umfasst
          beide Spalten: eine Einheit wird aus dem Detail in den Baum gezogen. */
        <DndContext
          sensors={sensoren}
          collisionDetection={pointerWithin}
          // Die Griffe sind keine Tastaturziele: keine Anleitung, nur deutsche Ansagen beim Ziehen.
          accessibility={{
            announcements: DRAG_ANSAGEN,
            screenReaderInstructions: { draggable: '' },
          }}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => zufluss.holdDrag(false)}
        >
          <div
            data-testid="abschnitte-rahmen"
            style={{
              display: 'flex',
              flexDirection: breit ? 'row' : 'column',
              gap: token.margin,
              alignItems: breit ? 'flex-start' : 'stretch',
            }}
          >
            <div
              data-testid="abschnitte-gliederung"
              style={breit ? { flex: '0 0 360px', minWidth: 0 } : { width: '100%' }}
            >
              <Paneel
                titel="Gliederung"
                meta={abschnitteQuery.isSuccess ? String(abschnitte.length) : undefined}
                koerperPolster
              >
                {/* Drei Zustände in dieser Reihenfolge: eine Weiche auf die Länge der Liste wäre
                auch beim Laden und im Fehlerfall wahr. Solange geladen wird, wird über die
                Menge nichts behauptet.

                Der Fehlerzweig trägt zusätzlich die Mengenbedingung (`listeGescheitert`): er
                verdrängt den Baum nur, wenn es keinen gibt. */}
                {abschnitteQuery.isLoading ? (
                  <SeitenSkeleton />
                ) : listeGescheitert ? (
                  <SeitenFehler
                    text="Abschnitte konnten nicht geladen werden"
                    ursache={abschnitteQuery.error}
                    onWiederholen={() => void abschnitteQuery.refetch()}
                  />
                ) : abschnitte.length === 0 ? (
                  <SeitenLeer
                    titel="Noch keine Abschnitte"
                    /* Derselbe Wortlaut wie der Kopfknopf. Ohne Schreibrecht keine Aktion — ein
                   Knopf, der nur eine Fehlermeldung auslöst, ist kein Weg aus dem Leerzustand. */
                    aktion={
                      darfSchreiben
                        ? { label: 'Abschnitt anlegen', onClick: openAnlegen }
                        : undefined
                    }
                  />
                ) : (
                  <>
                    {standVeraltet && (
                      <SeitenStandVeraltet onWiederholen={() => void abschnitteQuery.refetch()} />
                    )}
                    {/* Der Bereich der Schleuse: Standzeile, Baum und Wurzelzone. Der Weg zum
                      Banner taut nicht auf. */}
                    <div data-lfh="gliederung-bereich" {...zufluss.bereich}>
                      {/* Feste Höhe wie im Gerüst des Organigramms: der Wechsel zwischen „Live“,
                        „Live pausiert“ und dem Banner verschiebt den Baum nicht. */}
                      <div
                        ref={zufluss.standRef}
                        tabIndex={-1}
                        data-lfh="gliederung-stand"
                        style={{
                          height: token.controlHeight + 2 * token.paddingXS + 2,
                          marginBottom: token.marginXS,
                          display: 'flex',
                        }}
                      >
                        {wartet !== null ? (
                          <Sammelbanner
                            aktion={{ label: 'anzeigen', onKlick: zufluss.anzeigen }}
                            style={{
                              flex: '1 1 auto',
                              minWidth: 0,
                              flexWrap: 'nowrap',
                              boxSizing: 'border-box',
                            }}
                          >
                            {wartet}
                          </Sammelbanner>
                        ) : (
                          <span
                            style={{
                              alignSelf: 'center',
                              fontSize: token.fontSizeSM,
                              color: rollen.gedaempft,
                            }}
                          >
                            {zufluss.offen ? 'Live' : 'Live pausiert'}
                          </span>
                        )}
                      </div>
                      {dragFehler != null && (
                        <div style={{ marginBottom: token.marginSM }}>
                          <SpeicherFehler
                            fehler={dragFehler}
                            titel="Nicht verschoben"
                            fallback="Verschieben fehlgeschlagen"
                          />
                        </div>
                      )}
                      <Tree
                        treeData={baumDaten}
                        selectedKeys={aktuell ? [aktuell.id] : []}
                        expandedKeys={aufgeklappt}
                        onExpand={(_keys, { node, expanded }) => {
                          const key = Number(node.key);
                          setZugeklappt((alt) => {
                            const neu = new Set(alt);
                            if (expanded) neu.delete(key);
                            else neu.add(key);
                            return neu;
                          });
                        }}
                        onSelect={(keys) => setGewaehlt(keys.length ? Number(keys[0]) : null)}
                      />
                      {darfSchreiben && <ObersteEbeneDropZone abschnitte={abschnitte} />}
                    </div>
                  </>
                )}
              </Paneel>
            </div>

            <Paneel
              style={{ flex: 1, width: breit ? undefined : '100%' }}
              koerperPolster
              titel={aktuell ? `Abschnitt: ${aktuell.name}` : 'Kein Abschnitt gewählt'}
              // Sprung in die Lagekarte mit Fokus auf diesen Abschnitt (LLH-1349): kein Eintrag im
              // Menü der Handlungen (LFH-616), steht auch ohne Schreibrecht; ohne Freigabe der
              // Lagekarte gesperrt mit Grund (LFH-888). Die Karte fokussiert und räumt `?abschnitt=`.
              aktion={
                aktuell ? (
                  <SprungKnopf
                    to={lagekartePfad(einsatzId, { abschnitt: aktuell.id })}
                    gesperrt={istGesperrt('lagekarte')}
                  >
                    Auf Karte zeigen
                  </SprungKnopf>
                ) : undefined
              }
            >
              {/* Ohne Abschnitt (leere Gliederung, Ladefehler) trägt der Titel den Zustand; den
                Weg hinaus zeigt der Leerzustand der Gliederung. */}
              {aktuell && (
                <>
                  {/* `key`: ein Wechsel des Abschnitts schließt jede offene Zeile, sonst
                      speicherte ihr Entwurf in den nächsten. Den Über-Abschnitt ändert das
                      Umhängen (Ziehen, „Verschieben unter …“, LFH-1212), keine Zeile. */}
                  <AbschnittDetail
                    key={aktuell.id}
                    abschnitt={aktuell}
                    abschnitte={abschnitte}
                    personal={personal}
                    einsatzId={einsatzId}
                    staerken={staerken}
                    darfSchreiben={darfSchreiben}
                    onPatch={patchHandler(aktuell.id)}
                  />

                  {darfSchreiben && (
                    <div style={{ marginTop: token.marginLG }}>
                      <DetailError error={aufloesen.error} />
                      {/* „Verschieben unter …“ ist der Weg ohne Ziehen (LFH-1212); „Auflösen“
                          steht rot im Menü und fragt nach (LFH-683). */}
                      <span ref={weitereRef} style={{ display: 'inline-flex' }}>
                        <MenueAusloeser
                          eintraege={[
                            { key: 'verschieben', label: 'Verschieben unter …' },
                            { key: 'aufloesen', label: 'Auflösen', gefahr: true },
                          ]}
                          zugaenglicherName={`Weitere Aktionen zu Abschnitt ${aktuell.name}`}
                          onWahl={(key) => {
                            clearDetailError();
                            if (key === 'verschieben') openVerschieben(aktuell.id);
                            else setAufloesenFuer({ id: aktuell.id, name: aktuell.name });
                          }}
                        />
                      </span>
                    </div>
                  )}

                  {einheitenListe}
                </>
              )}
            </Paneel>
          </div>
          <DragOverlay dropAnimation={null}>
            <ActiveDragMarke />
          </DragOverlay>
        </DndContext>
      )}
      <VerschiebenDialog
        abschnitt={verschiebenAbschnitt}
        abschnitte={abschnitte}
        laeuft={verschieben.isPending && verschieben.variables?.quelle === 'menue'}
        fehler={dialogFehler}
        onWahl={(nach) => {
          if (!verschiebenAbschnitt) return;
          verschieben.mutate({
            einsatzId,
            art: 'abschnitt',
            id: verschiebenAbschnitt.id,
            name: verschiebenAbschnitt.name,
            von: verschiebenAbschnitt.ueber_abschnitt_id ?? null,
            nach,
            quelle: 'menue',
          });
        }}
        onAbbrechen={() => setVerschiebenFuer(null)}
        nachDemSchliessen={focusAbschnitt}
      />
      {/* Die Rückfrage vor dem Unumkehrbaren steht als `<Modal>`, nicht im Menü (LFH-683). Sie
          nennt ihren Abschnitt und schließt, wenn er entfällt. */}
      <Modal
        open={aufloesenFuer !== null && abschnitte.some((a) => a.id === aufloesenFuer.id)}
        title={aufloesenFuer ? `Abschnitt „${aufloesenFuer.name}“ auflösen?` : undefined}
        onCancel={() => {
          if (isNewGestureAufloesen()) setAufloesenFuer(null);
        }}
        focusable={{ focusTriggerAfterClose: false }}
        afterClose={focusAbschnitt}
        destroyOnHidden
        footer={
          <Space size="middle">
            <Button
              onClick={() => {
                if (isNewGestureAufloesen()) setAufloesenFuer(null);
              }}
            >
              Abbrechen
            </Button>
            <Button
              danger
              onClick={() => {
                if (!aufloesenFuer || !isNewGestureAufloesen()) return;
                setAufloesenFuer(null);
                clearDetailError();
                aufloesen.mutate(aufloesenFuer.id);
              }}
            >
              Abschnitt auflösen
            </Button>
          </Space>
        }
      >
        Unter-Abschnitte rücken hoch, zugeordnete Einheiten werden „nicht zugeordnet“.
      </Modal>
      {darfSchreiben && (
        <AbschnittAnlegenModal
          open={isAnlegenOpen}
          einsatzId={einsatzId}
          abschnitte={abschnitte}
          onAngelegt={(neuId) => {
            // Die eigene Handlung wartet nicht hinter dem Banner der Schleuse (LFH-1212).
            zufluss.uebernehmen(
              buildGliederungKnoten(
                qc.getQueryData<Einsatzabschnitt[]>(einsatzKeys.abschnitte(einsatzId)) ?? [],
              ),
            );
            setGewaehlt(neuId);
            setzeAnsicht('gliederung');
          }}
          onClose={() => setIsAnlegenOpen(false)}
        />
      )}
    </EinsatzSeite>
  );
}

/** Grund eines abgelehnten Auflösens im Detailpaneel, über dem Menü (LFH-1077). */
function DetailError({ error }: { error: unknown }) {
  const { token } = useRollen();
  if (error == null) return null;
  return (
    <div style={{ marginBottom: token.marginSM }}>
      <SpeicherFehler fehler={error} titel="Nicht aufgelöst" fallback="Auflösen fehlgeschlagen" />
    </div>
  );
}
