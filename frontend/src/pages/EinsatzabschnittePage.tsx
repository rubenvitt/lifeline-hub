import {
  App,
  Breadcrumb,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Tag,
  Tree,
  TreeSelect,
  type TreeDataNode,
} from 'antd';
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { Select } from '../components/Select';
import { Link, useParams, useSearchParams } from 'react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { einsatzKeys } from '../api/queryKeys';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { listeEinheiten, patcheEinheit } from '../api/einheiten';
import {
  aktualisiereAbschnitt,
  legeAbschnittAn,
  listeAbschnitte,
  loeseAbschnittAuf,
  patcheAbschnitt,
  type AbschnittEingabe,
} from '../api/einsatzabschnitte';
import type { AbschnittLagezustand, Einheit, Einsatzabschnitt } from '../api/types';
import StaerkeAnzeige from '../anzeige/StaerkeAnzeige';
import { KOMMUNIKATIONSMITTEL_OPTIONEN } from '../components/FunkErreichbarkeit';
import { Liste, ListenEintrag } from '../components/Liste';
import {
  SeitenFehler,
  SeitenLeer,
  SeitenSkeleton,
  SeitenStandVeraltet,
} from '../components/SeitenZustand';
import SprechgruppenPicker from '../components/SprechgruppenPicker';
import { useQueryParamSelektion } from '../routing/useQueryParamSelektion';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import EinsatzSeite from '../components/EinsatzSeite';
import { Augenbraue, Paneel, Segmentleiste, monoStil, useRollen } from '../components/instrument';
import { useViewport } from '../components/useViewport';
import { abschnittStaerken, nachfahrenInkl } from './einsatzabschnitte/abschnittStaerke';
import AbschnittKnoten from './einsatzabschnitte/AbschnittKnoten';
import AbschnittDaten from './einsatzabschnitte/AbschnittDaten';
import { abschnittLagezustand } from '../theme/statusFarben';
import { abrufZustand } from '../api/abrufZustand';
import {
  einheitenPfad,
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
  DRAG_ANLEITUNG,
  DRAG_ANSAGEN,
  DropKnoten,
  DragHandle,
  DragMarke,
  useActiveDrag,
  type DropDaten,
  type DragDaten,
} from './einsatzabschnitte/GliederungDrag';
import VerschiebenDialog from './einsatzabschnitte/VerschiebenDialog';

/** Auswahl des Lagezustands in Stufenfolge — Wortlaut aus dem Farbvertrag, nicht doppelt. */
const LAGEZUSTAND_OPTIONEN = (['planmaessig', 'angespannt', 'kritisch'] as const).map((l) => ({
  value: l,
  label: abschnittLagezustand[l].label,
}));

/**
 * Zwei Ansichten derselben Daten (LFH-626): die Gliederung bearbeitet, das Organigramm liest,
 * druckt und übernimmt. Kein Nutzerschalter Tabelle ↔ Karte — das hier sind zwei Fragen.
 */
const ANSICHT_OPTIONEN = [
  { wert: 'gliederung', label: 'Gliederung' },
  { wert: 'organigramm', label: 'Organigramm' },
] as const satisfies readonly { wert: AbschnitteAnsicht; label: string }[];

/** Vergleichsform der Kurzbezeichnung wie SQLite `NOCASE`: getrimmt, nur A–Z gefaltet. */
const nocase = (s: string) => s.trim().replace(/[A-Z]/g, (c) => c.toLowerCase());

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
  art: DragDaten['art'];
  id: number;
  name: string;
  von: number | null;
  nach: number | null;
  quelle: 'zug' | 'menue' | 'rueckgaengig';
}

/** Was am Zeiger hängt, solange gezogen wird. */
function ActiveDragMarke() {
  const zug = useActiveDrag();
  return zug ? <DragMarke zug={zug} /> : null;
}

interface AbschnittWerte {
  name: string;
  ueber_abschnitt_id?: number | null;
  leiter_id?: number | null;
  bemerkung?: string;
  sprechgruppe_ids?: number[];
  kommunikationsmittel?: string;
  erreichbarkeit?: string;
  kurzbezeichnung?: string;
  lagezustand?: AbschnittLagezustand | null;
  abschnittsauftrag?: string;
  fortschritt?: number | null;
}

export default function EinsatzabschnittePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [gewaehlt, setGewaehlt] = useState<number | null>(null);
  const [bearbeiten, setBearbeiten] = useState(false);
  const [entwurf, setEntwurf] = useState(false);
  const [form] = Form.useForm<AbschnittWerte>();
  /** Offener Dialog „Verschieben unter …“ (Abschnitts-ID) und offene Rückfrage „Auflösen“. */
  const [verschiebenFuer, setVerschiebenFuer] = useState<number | null>(null);
  const [aufloesenFrage, setAufloesenFrage] = useState(false);
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

  // Cross-Modul-Deeplink: ?abschnitt=<id> selektiert den Abschnitt, sofern vorhanden. Spiegelt
  // `Tree onSelect`: ein danach feuernder Deeplink darf einen offenen Entwurf nicht überleben
  // lassen, sonst nähme `speichern` wegen `!entwurf === false` fälschlich den POST-Zweig.
  useQueryParamSelektion('abschnitt', abschnitteQuery.isSuccess, (zid) => {
    if ((abschnitteQuery.data ?? []).some((a) => a.id === zid)) {
      setEntwurf(false);
      setGewaehlt(zid);
      // Aus dem Organigramm: das Detail steht in der Gliederung (LFH-626, D7).
      setAnsichtNachEinsatz((alt) => ({ ...alt, [einsatzId]: 'gliederung' }));
    }
  });

  // Schnellaktion: ?neu=1 öffnet den Entwurf eines neuen Abschnitts (Sprungpalette, LFH-506) —
  // dieselben Schritte wie `entwurfOeffnen`, hier ausgeschrieben, weil die Funktion je Render neu
  // entsteht. Warten bis der Einsatz geladen ist; Param immer löschen, Entwurf nur bei
  // Schreibrecht.
  const [searchParams, setSearchParams] = useSearchParams();
  const darfSchreibenRoh = darfImEinsatzSchreiben(einsatzQuery.data);
  useEffect(() => {
    if (searchParams.get('neu') !== '1') return;
    if (einsatzQuery.isLoading) return;
    if (darfSchreibenRoh) {
      setGewaehlt(null);
      setBearbeiten(false);
      form.resetFields();
      setEntwurf(true);
      // Der Entwurf steht in der Gliederung; aus dem Organigramm sähe ihn sonst niemand.
      setAnsichtNachEinsatz((alt) => ({ ...alt, [einsatzId]: 'gliederung' }));
    }
    const naechste = new URLSearchParams(searchParams);
    naechste.delete('neu');
    setSearchParams(naechste, { replace: true });
  }, [searchParams, setSearchParams, einsatzQuery.isLoading, darfSchreibenRoh, form, einsatzId]);

  // Sichtvorgabe ?ansicht= (LFH-626), apply-then-clean wie auf der Fahrzeugseite. Geräumt wird
  // auch ein unbrauchbarer Wert, sonst stünde er beim Teilen des Links wieder im Auftrag.
  useEffect(() => {
    if (!searchParams.has('ansicht')) return;
    // `?neu=1` gewinnt: ein Entwurf braucht die Gliederung (Review LFH-626).
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
   * Aufforderung „Wähle einen Abschnitt im Baum“ zeigt die Seite gleich einen. Ein offener Entwurf
   * hat keinen. `gewaehlt` bleibt die Wahl der Person; die Vorwahl ist nur ihr Rückfall.
   */
  const aktuell = entwurf
    ? null
    : gewaehlt != null
      ? (abschnitte.find((a) => a.id === gewaehlt) ?? null)
      : (abschnitte.find((a) => a.ueber_abschnitt_id == null) ?? null);

  const speichern = useMutation({
    mutationFn: (werte: AbschnittWerte) => {
      const daten: AbschnittEingabe = {
        name: werte.name.trim(),
        ueber_abschnitt_id: werte.ueber_abschnitt_id ?? null,
        leiter_id: werte.leiter_id ?? null,
        bemerkung: werte.bemerkung?.trim() || null,
        sprechgruppe_ids: werte.sprechgruppe_ids ?? [],
        kommunikationsmittel: werte.kommunikationsmittel || null,
        erreichbarkeit: werte.erreichbarkeit?.trim() || null,
        kurzbezeichnung: werte.kurzbezeichnung?.trim() || null,
        lagezustand: werte.lagezustand ?? null,
        abschnittsauftrag: werte.abschnittsauftrag?.trim() || null,
        fortschritt: werte.fortschritt ?? null,
      };
      return aktuell && !entwurf
        ? aktualisiereAbschnitt(einsatzId, aktuell.id, daten)
        : legeAbschnittAn(einsatzId, daten);
    },
    onSuccess: (a) => {
      invalidate();
      setEntwurf(false);
      setGewaehlt(a.id);
      setBearbeiten(false);
      message.success('Gespeichert');
    },
  });
  const aufloesen = useMutation({
    mutationFn: (aid: number) => loeseAbschnittAuf(einsatzId, aid),
    onSuccess: () => {
      invalidate();
      setGewaehlt(null);
      setBearbeiten(false);
    },
  });

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
        await patcheAbschnitt(einsatzId, v.id, { ueber_abschnitt_id: v.nach });
      else await patcheEinheit(einsatzId, v.id, { abschnitt_id: v.nach });
    },
    onMutate: () => {
      setDragFehler(null);
      setDialogFehler(null);
      setRueckFehler(null);
    },
    onSuccess: (_antwort, v) => {
      if (v.art === 'abschnitt') {
        const neu = (
          qc.getQueryData<Einsatzabschnitt[]>(einsatzKeys.abschnitte(einsatzId)) ?? []
        ).map((a) => (a.id === v.id ? { ...a, ueber_abschnitt_id: v.nach } : a));
        qc.setQueryData(einsatzKeys.abschnitte(einsatzId), neu);
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
        qc.setQueryData<Einheit[]>(einsatzKeys.einheiten(einsatzId), (alt) =>
          alt?.map((e) => (e.id === v.id ? { ...e, abschnitt_id: v.nach } : e)),
        );
      }
      invalidate();
      setVerschiebenFuer(null);
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
      if (v.quelle === 'zug') setDragFehler(fehler);
      else if (v.quelle === 'menue') setDialogFehler(fehler);
      else setRueckFehler(fehler);
    },
  });

  function handleDragStart() {
    setDragFehler(null);
    zufluss.halteZug(true);
  }

  function handleDragEnd(e: DragEndEvent) {
    zufluss.halteZug(false);
    const zug = e.active.data.current as DragDaten | undefined;
    const ziel = e.over?.data.current as DropDaten | undefined;
    // Gesperrte Ziele sind `disabled` und melden sich nie als `over`.
    if (!zug || !ziel) return;
    const von =
      zug.art === 'abschnitt'
        ? (abschnitte.find((a) => a.id === zug.id)?.ueber_abschnitt_id ?? null)
        : zug.abschnittId;
    verschieben.mutate({
      art: zug.art,
      id: zug.id,
      name: zug.name,
      von,
      nach: ziel.zielId,
      quelle: 'zug',
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
  const warOffen = useRef(false);
  useEffect(() => {
    if (warOffen.current && verschiebenFuer === null) focusAbschnitt();
    warOffen.current = verschiebenFuer !== null;
  }, [verschiebenFuer, focusAbschnitt]);

  function openVerschieben(aid: number) {
    setDialogFehler(null);
    setVerschiebenFuer(aid);
  }

  /*
   * Speichern und Auflösen melden ihre Ablehnung im Detailpaneel, kein Toast (LFH-1077,
   * `frontend/AGENTS.md`, „Rückwege und Fehler“). Der Grund gehört zum gezeigten Abschnitt: jede
   * neue Handlung, Abbrechen, Bearbeiten und der Wechsel des Abschnitts räumen ihn. Eine laufende
   * Mutation bleibt unberührt, `reset()` hängte ihr Ergebnis ab. Ref, damit der Effekt beim
   * Wechsel die AKTUELLEN Mutationen räumt, ohne je Render neu zu laufen.
   */
  const detailFehler = speichern.error ?? aufloesen.error;
  const detailRef = useRef([speichern, aufloesen]);
  detailRef.current = [speichern, aufloesen];
  const raeumeDetail = useCallback(() => {
    for (const m of detailRef.current) if (!m.isPending && m.error != null) m.reset();
  }, []);

  // Beim Wechsel des angezeigten Abschnitts zurück in die Lese-Ansicht — auch wenn die Vorwahl
  // wechselt, weil ein anderer Arbeitsplatz den Abschnitt aufgelöst hat; sonst füllte das Formular
  // still den nächsten und Speichern träfe ihn.
  const aktuellId = aktuell?.id;
  useEffect(() => {
    setBearbeiten(false);
    raeumeDetail();
  }, [aktuellId, raeumeDetail]);

  // Formular mit den Werten des aktuellen Abschnitts vorbelegen, sobald der Edit-Modus öffnet.
  useEffect(() => {
    if (aktuell && bearbeiten && !entwurf) {
      form.setFieldsValue({
        name: aktuell.name,
        ueber_abschnitt_id: aktuell.ueber_abschnitt_id ?? undefined,
        leiter_id: aktuell.leiter_id ?? undefined,
        bemerkung: aktuell.bemerkung ?? undefined,
        sprechgruppe_ids: aktuell.sprechgruppen?.map((s) => s.id) ?? [],
        kommunikationsmittel: aktuell.kommunikationsmittel ?? undefined,
        erreichbarkeit: aktuell.erreichbarkeit ?? undefined,
        kurzbezeichnung: aktuell.kurzbezeichnung ?? undefined,
        lagezustand: aktuell.lagezustand ?? undefined,
        abschnittsauftrag: aktuell.abschnittsauftrag ?? undefined,
        fortschritt: aktuell.fortschritt ?? undefined,
      });
    }
  }, [aktuell, bearbeiten, entwurf, form]);

  /**
   * Lokaler Entwurf statt Server-Datensatz: der POST — und damit der ETB-Eintrag — entsteht erst
   * beim Speichern. Abbrechen hinterlässt nichts.
   */
  function entwurfOeffnen() {
    raeumeDetail();
    setGewaehlt(null);
    setBearbeiten(false);
    form.resetFields();
    setEntwurf(true);
    setzeAnsicht('gliederung');
  }

  const baumDaten = useMemo(() => {
    const knoten = buildBaum(
      gezeigterBaum,
      abschnitte,
      einheitenQuery.data ?? [],
      darfSchreibenRoh,
    );
    return entwurf
      ? [
          ...knoten,
          { key: 'entwurf', title: <i>Neuer Abschnitt (ungespeichert)</i>, selectable: false },
        ]
      : knoten;
  }, [gezeigterBaum, abschnitte, einheitenQuery.data, entwurf, darfSchreibenRoh]);
  const aufgeklappt = useMemo(
    () => elternKeys(gezeigterBaum).filter((k) => !zugeklappt.has(k)),
    [gezeigterBaum, zugeklappt],
  );
  const verschiebenAbschnitt =
    verschiebenFuer != null ? (abschnitte.find((a) => a.id === verschiebenFuer) ?? null) : null;
  const verboten = aktuell ? nachfahrenInkl(abschnitte, aktuell.id) : new Set<number>();
  const parentOptionen = abschnitte
    .filter((a) => !verboten.has(a.id))
    .map((a) => ({ value: a.id, title: a.name }));
  const personalOptionen = (personalQuery.data ?? []).map((p) => ({ value: p.id, label: p.name }));
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
            <Button type="primary" onClick={entwurfOeffnen}>
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
              darfSchreiben ? { label: 'Abschnitt anlegen', onClick: entwurfOeffnen } : undefined
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
          accessibility={{ announcements: DRAG_ANSAGEN, screenReaderInstructions: DRAG_ANLEITUNG }}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => zufluss.halteZug(false)}
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
                ) : abschnitte.length === 0 && !entwurf ? (
                  <SeitenLeer
                    titel="Noch keine Abschnitte"
                    /* Derselbe Wortlaut wie der Kopfknopf. Ohne Schreibrecht keine Aktion — ein
                   Knopf, der nur eine Fehlermeldung auslöst, ist kein Weg aus dem Leerzustand. */
                    aktion={
                      darfSchreiben
                        ? { label: 'Abschnitt anlegen', onClick: entwurfOeffnen }
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
                        data-lfh="gliederung-stand"
                        style={{
                          height: token.controlHeight + 2 * token.paddingXS + 2,
                          marginBottom: token.marginXS,
                          display: 'flex',
                        }}
                      >
                        {wartet !== null ? (
                          <Sammelbanner
                            aktion={{ label: 'anzeigen', onKlick: () => zufluss.uebernehmen() }}
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
                        selectedKeys={entwurf ? ['entwurf'] : aktuell ? [aktuell.id] : []}
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
                        onSelect={(keys) => {
                          setEntwurf(false);
                          setGewaehlt(keys.length ? Number(keys[0]) : null);
                        }}
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
              titel={
                entwurf
                  ? 'Neuer Abschnitt'
                  : aktuell
                    ? `Abschnitt: ${aktuell.name}`
                    : 'Kein Abschnitt gewählt'
              }
            >
              {/* Ohne Abschnitt (leere Gliederung, Ladefehler) trägt der Titel den Zustand; den
                Weg hinaus zeigt der Leerzustand der Gliederung. */}
              {!aktuell && !entwurf ? null : entwurf || bearbeiten ? (
                <Form<AbschnittWerte>
                  form={form}
                  layout="vertical"
                  onFinish={(w) => {
                    raeumeDetail();
                    speichern.mutate(w);
                  }}
                >
                  <Form.Item
                    label="Name"
                    name="name"
                    rules={[{ required: true, whitespace: true }]}
                  >
                    <Input autoFocus />
                  </Form.Item>
                  {/* Eindeutig je Einsatz ohne Groß-/Kleinschreibung wie der Index
                    `einsatzabschnitt_kurzbezeichnung_eindeutig` (NOCASE): als Prüfung am Feld,
                    nicht als Satz (LFH-1078). Der Server bleibt die Wahrheit. */}
                  <Form.Item
                    label="Kurzbezeichnung"
                    name="kurzbezeichnung"
                    rules={[
                      {
                        validator: (_, wert?: string) => {
                          const kurz = wert ? nocase(wert) : undefined;
                          const belegt = kurz
                            ? abschnitte.find(
                                (a) =>
                                  a.id !== aktuell?.id &&
                                  a.kurzbezeichnung != null &&
                                  nocase(a.kurzbezeichnung) === kurz,
                              )
                            : undefined;
                          return belegt
                            ? Promise.reject(new Error(`Schon vergeben (${belegt.name})`))
                            : Promise.resolve();
                        },
                      },
                    ]}
                  >
                    <Input maxLength={20} allowClear placeholder="z. B. EA-N" />
                  </Form.Item>
                  <Form.Item label="Über-Abschnitt" name="ueber_abschnitt_id">
                    <TreeSelect
                      allowClear
                      placeholder="Übergeordneter Abschnitt"
                      treeData={parentOptionen}
                    />
                  </Form.Item>
                  <Form.Item label="Abschnittsleiter" name="leiter_id">
                    <Select
                      allowClear
                      placeholder="Disponierte Person"
                      options={personalOptionen}
                    />
                  </Form.Item>

                  <Augenbraue
                    als="h3"
                    style={{
                      display: 'block',
                      marginTop: token.marginXS,
                      marginBottom: token.marginSM,
                    }}
                  >
                    Lage
                  </Augenbraue>
                  <Form.Item label="Lagezustand" name="lagezustand">
                    <Select
                      allowClear
                      placeholder="nicht beurteilt"
                      options={LAGEZUSTAND_OPTIONEN}
                    />
                  </Form.Item>
                  <Form.Item label="Abschnittsauftrag" name="abschnittsauftrag">
                    <Input.TextArea rows={2} placeholder="Fester Auftrag des Abschnitts" />
                  </Form.Item>
                  <Form.Item label="Fortschritt" name="fortschritt">
                    <InputNumber
                      min={0}
                      max={100}
                      precision={0}
                      suffix="%"
                      placeholder="nicht eingeschätzt"
                    />
                  </Form.Item>

                  <Augenbraue
                    als="h3"
                    style={{
                      display: 'block',
                      marginTop: token.marginXS,
                      marginBottom: token.marginSM,
                    }}
                  >
                    Funk / Kommunikation
                  </Augenbraue>
                  <Form.Item label="Sprechgruppen" name="sprechgruppe_ids">
                    <SprechgruppenPicker einsatzId={einsatzId} />
                  </Form.Item>
                  <Form.Item label="Kommunikationsmittel" name="kommunikationsmittel">
                    <Select
                      allowClear
                      placeholder="Digitalfunk / Mobil / Festnetz"
                      options={KOMMUNIKATIONSMITTEL_OPTIONEN}
                    />
                  </Form.Item>
                  <Form.Item label="Erreichbarkeit / Nummer" name="erreichbarkeit">
                    <Input placeholder="z. B. 0151 23456" allowClear />
                  </Form.Item>

                  <Form.Item label="Bemerkung" name="bemerkung">
                    <Input.TextArea rows={2} />
                  </Form.Item>
                  <DetailFehler speicherFehler={speichern.error} fehler={detailFehler} />
                  <Space size="middle">
                    <Button type="primary" htmlType="submit" loading={speichern.isPending}>
                      Speichern
                    </Button>
                    <Button
                      onClick={() => {
                        raeumeDetail();
                        setEntwurf(false);
                        setBearbeiten(false);
                      }}
                    >
                      Abbrechen
                    </Button>
                    {!entwurf && aktuell && (
                      <Popconfirm
                        title="Abschnitt auflösen?"
                        description={
                          'Unter-Abschnitte rücken hoch, zugeordnete Einheiten werden „nicht zugeordnet“.'
                        }
                        okText="Abschnitt auflösen"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => {
                          raeumeDetail();
                          aufloesen.mutate(aktuell.id);
                        }}
                      >
                        <Button danger>Auflösen</Button>
                      </Popconfirm>
                    )}
                  </Space>
                </Form>
              ) : aktuell ? (
                <>
                  <AbschnittDaten abschnitt={aktuell} staerken={staerken} />

                  {darfSchreiben && (
                    <div style={{ marginTop: 12 }}>
                      <DetailFehler speicherFehler={speichern.error} fehler={detailFehler} />
                      <Space size="middle">
                        <Button
                          type="primary"
                          onClick={() => {
                            raeumeDetail();
                            setBearbeiten(true);
                          }}
                        >
                          Bearbeiten
                        </Button>
                        {/* Drei Handlungen: die übrigen hinter EINEM Auslöser (LFH-365/LFH-683).
                          „Verschieben unter …“ ist der Weg ohne Ziehen (LFH-1212). */}
                        <span ref={weitereRef} style={{ display: 'inline-flex' }}>
                          <MenueAusloeser
                            eintraege={[
                              { key: 'verschieben', label: 'Verschieben unter …' },
                              { key: 'aufloesen', label: 'Auflösen', gefahr: true },
                            ]}
                            zugaenglicherName={`Weitere Aktionen zu Abschnitt ${aktuell.name}`}
                            onWahl={(key) => {
                              raeumeDetail();
                              if (key === 'verschieben') openVerschieben(aktuell.id);
                              else setAufloesenFrage(true);
                            }}
                          />
                        </span>
                      </Space>
                    </div>
                  )}

                  {einheitenListe}
                </>
              ) : null}
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
      {/* Die Rückfrage vor dem Unumkehrbaren steht als `<Modal>`, nicht im Menü (LFH-683). */}
      <Modal
        open={aufloesenFrage && aktuell != null}
        title="Abschnitt auflösen?"
        onCancel={() => setAufloesenFrage(false)}
        destroyOnHidden
        footer={
          <Space size="middle">
            <Button onClick={() => setAufloesenFrage(false)}>Abbrechen</Button>
            <Button
              danger
              onClick={() => {
                setAufloesenFrage(false);
                if (!aktuell) return;
                raeumeDetail();
                aufloesen.mutate(aktuell.id);
              }}
            >
              Abschnitt auflösen
            </Button>
          </Space>
        }
      >
        Unter-Abschnitte rücken hoch, zugeordnete Einheiten werden „nicht zugeordnet“.
      </Modal>
    </EinsatzSeite>
  );
}

/**
 * Grund einer abgelehnten Handlung im Detailpaneel, über ihren Knöpfen. `speicherFehler` wählt den
 * Wortlaut: ohne ihn stammt der Fehler vom Auflösen.
 */
function DetailFehler({ speicherFehler, fehler }: { speicherFehler: unknown; fehler: unknown }) {
  const { token } = useRollen();
  if (fehler == null) return null;
  const vomAufloesen = speicherFehler == null;
  return (
    <div style={{ marginBottom: token.marginSM }}>
      <SpeicherFehler
        fehler={fehler}
        titel={vomAufloesen ? 'Nicht aufgelöst' : undefined}
        fallback={vomAufloesen ? 'Auflösen fehlgeschlagen' : undefined}
      />
    </div>
  );
}
