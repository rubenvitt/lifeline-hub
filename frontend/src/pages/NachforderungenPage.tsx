import { IconChevronHoch, IconKreuz, IconPlus } from '../icons';
import { Alert, App, Breadcrumb, Button, Input, Modal, Spin } from 'antd';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeBetreuung } from '../api/betreuung';
import { listeEinheiten, uebernehmeAusNachforderung } from '../api/einheiten';
import { listeEinheitTypen } from '../api/einheitTypen';
import { listeBr } from '../api/einsatzBereitstellungsraum';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { ladeEinsatz, ladeModulFreigaben } from '../api/einsaetze';
import { ladeModulZaehler } from '../api/modulZaehler';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import { istKonflikt } from '../api/client';
import {
  disponiereAdhoc,
  listEinsatzMaterial,
  listEntlassenesMaterial,
} from '../api/einsatzMaterial';
import {
  erfasseZusage,
  legeNachforderungAn,
  lehneNachforderungAb,
  listeNachforderungen,
  patcheNachforderung,
  setzeNachforderungStatus,
  zieheNachforderungZurueck,
} from '../api/nachforderungen';
import type {
  EinsatzMaterial,
  Nachforderung,
  NachforderungStatus,
  NachforderungZusageEingabe,
  NeueNachforderung,
  PatchNachforderung,
} from '../api/types';
import {
  NACHFORDERUNG_ABLEHNEN_GRUND_MAX,
  NACHFORDERUNG_ZURUECKZIEHEN_GRUND_MAX,
} from '../api/eingabegrenzen';
import { istZuLang, zeichenGrenze } from '../components/zeichenGrenze';
import { NACHFORDERUNG_STATUS } from '../kommunikation';
import { zeigeRueckgaengig } from '../kommunikation/rueckgaengig';
import NachforderungBoard, {
  sichtbareKarten,
  useBoardStand,
  type BoardAnsicht,
} from '../nachforderungen/NachforderungBoard';
import { boardGruppe, offenText, vorgabeStufe } from '../nachforderungen/nachforderungStufen';
import NachforderungFormular, {
  type NachforderungBezug,
} from '../nachforderungen/NachforderungFormular';
import type { KartenFormular, StellenVerweis } from '../nachforderungen/NachforderungKarte';
import MaterialUebernahmeModal from '../nachforderungen/MaterialUebernahmeModal';
import EinheitUebernahmeModal from '../nachforderungen/EinheitUebernahmeModal';
import {
  einheitenBody,
  einheitVorschlaege,
  type EinheitUebernahmeWerte,
} from '../nachforderungen/einheitUebernahme';
import {
  isErgaenzen,
  uebernahmeBody,
  type UebernahmeWerte,
} from '../nachforderungen/materialUebernahme';
import { istKeyFreigegeben, modulName } from '../einsatz/modulRegistry';
import { useQueryParamSelektion } from '../routing/useQueryParamSelektion';
import EinsatzSeite from '../components/EinsatzSeite';
import { SeitenHinweise, SpeicherFehler } from '../components/SpeicherHinweis';
import { useZeilenFehler } from '../components/useZeilenFehler';
import { useZuflussSteuerung } from '../components/useZuflussSchleuse';
import { useMinutenTakt } from '../components/useMinutenTakt';
import { useViewport } from '../components/useViewport';
import { fruehereArten } from '../nachforderungen/artVorschlaege';
import { nachforderungName } from '../nachforderungen/nachforderungName';
import type { ZielNamen } from '../nachforderungen/zielVorschlaege';
import {
  NACHFORDERUNG_BEZUG_PARAM,
  NACHFORDERUNG_VORBELEGUNG_PARAMS,
  betreuungsstellePfad,
  parseNachforderungBezug,
  parseNachforderungStelle,
  parseNachforderungVorbelegung,
  type NachforderungVorbelegung,
} from '../routing/deeplinks';
import { Filterhinweis, Paneel, useRollen } from '../components/instrument';
import { Select } from '../components/Select';

/** Stabile Leerlisten für den Dialog (`memo`, Muster der Karten). */
const KEINE_EINHEITEN: never[] = [];
const KEINE_TYPEN: never[] = [];

export default function NachforderungenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { token } = useRollen();

  const jetzt = useMinutenTakt();
  const schmal = !useViewport().abBreite('md');
  /*
   * Das Board (LLH-1078, Spec `nachforderungen-board`). Die Stufe zählt nur am Handy (Segment);
   * ohne Wahl steht dort die erste offene Stufe mit Karten. Abgelehnt und ältere Eingetroffene
   * sind eingeklappt, bis jemand sie aufklappt.
   */
  const [gewaehlteStufe, setGewaehlteStufe] = useState<NachforderungStatus | null>(null);
  const [abgelehntOffen, setAbgelehntOffen] = useState(false);
  const [zurueckgezogenOffen, setZurueckgezogenOffen] = useState(false);
  const [aeltereOffen, setAeltereOffen] = useState(false);
  const zufluss = useZuflussSteuerung<Nachforderung>();
  // Nach der eigenen Fortschaltung bekommt die gewanderte Karte den Fokus (der Knopf ist weg).
  const [fokusZiel, setFokusZiel] = useState<number | null>(null);
  // Inline-Erfassen-Formular: per Kopf-Knopf auf-/zugeklappt, kein Drawer.
  const [formOffen, setFormOffen] = useState(false);
  // Vorbelegung aus `?neu=1&art=…`. Lebt nur, solange die Erfassung offen ist: wer schließt und neu
  // öffnet, bekommt die leere Maske.
  const [vorbelegung, setVorbelegung] = useState<NachforderungVorbelegung | null>(null);
  // Stellenbezug aus `?neu=1&betreuungsstelle=<id>` (LLH-1082, design.md D7): gilt, solange die
  // Erfassung offen ist, auch über eine Serie; Schließen räumt ihn.
  const [bezugId, setBezugId] = useState<number | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  // Filter „für Stelle“ (`?stelle=<id>`): Zustand in der Adresse.
  const stelleFilter = parseNachforderungStelle(searchParams);
  const setzeStelleFilter = (stelleId: number | null) => {
    const naechste = new URLSearchParams(searchParams);
    if (stelleId == null) naechste.delete('stelle');
    else naechste.set('stelle', String(stelleId));
    setSearchParams(naechste, { replace: true });
  };
  const schliesseFormular = () => {
    setFormOffen(false);
    setVorbelegung(null);
    setBezugId(null);
  };
  // Grund einer abgelehnten Rücknahme aus dem Rückgängig-Toast: die Karte ist dann oft gewandert,
  // der Grund steht im Hinweis der Seite (LFH-1077).
  const [seitenFehler, setSeitenFehler] = useState<unknown>(null);
  // Ablehnen-Dialog: Grund (optional) wird erhoben, bevor abgelehnt wird.
  const [ablehnenId, setAblehnenId] = useState<number | null>(null);
  const [ablehnenGrund, setAblehnenGrund] = useState('');
  // Zurückziehen-Dialog (LLH-1097 D8): wie Ablehnen, Grund optional, kein Rückgängig.
  const [zurueckziehenId, setZurueckziehenId] = useState<number | null>(null);
  const [zurueckziehenGrund, setZurueckziehenGrund] = useState('');
  /*
   * Das Formular an einer Karte (LLH-1097 D10): „Zusage erfassen“ oder „Bearbeiten“, höchstens
   * eines je Seite. Solange es offen ist, hält das Board still.
   */
  const [formular, setFormular] = useState<{ id: number; art: KartenFormular } | null>(null);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  // Die Stufen trennt das Board clientseitig → alle Nachforderungen laden.
  const nfQuery = useQuery({
    queryKey: einsatzKeys.nachforderungen(einsatzId),
    queryFn: () => listeNachforderungen(einsatzId, {}),
  });
  // Die Kopfzahl zählt der Server (LFH-550, Modulzähler `nachforderungen`): derselbe Cache wie
  // Modulpanel, Überblick und Vorbereitung.
  const zaehlerQuery = useQuery({
    queryKey: einsatzKeys.modulZaehler(einsatzId),
    queryFn: () => ladeModulZaehler(einsatzId),
  });

  /*
   * Übernahme als Material (LLH-1226, design.md D10). Die Absicht „ergänzen“ steht beim Öffnen fest
   * und wechselt nur nach einer 409 (D3); der Stand der Nachforderung beim Öffnen hält den Dialog,
   * falls sie aus der Liste fällt.
   */
  const [uebernahme, setUebernahme] = useState<{ n: Nachforderung; ergaenzen: boolean } | null>(
    null,
  );
  const freigabenQuery = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
  });
  const freigaben = freigabenQuery.data;
  // Posten lesen nur bei bedienbarem Modul Material, erst wenn die Freigaben feststehen
  // (`istKeyFreigegeben` gibt Unbekanntes nicht frei, Muster `VerpflegungPage`); und nur, wenn eine
  // Karte Posten zeigt oder übernommen wird — sonst bliebe der Abruf ohne Leser.
  const materialFrei = istKeyFreigegeben('material', freigaben);
  /*
   * Knopf und Abruf hängen an derselben Bedingung (Review): bedienbar nur bei `materialFrei`. Sonst
   * stünde er etwa für einen Admin bei ausgeblendetem Modul (`sichtbar: false`, `zugriff: true`)
   * frei, öffnete aber einen Dialog ohne Posten und ohne Rest. Gesperrt mit demselben Grund wie
   * ohne Freigabe; solange die Freigaben noch nicht feststehen, steht er gar nicht.
   */
  const freigabenBekannt = !freigabenQuery.isPending;
  const materialGesperrt = freigabenBekannt && !materialFrei;
  const needsMaterial =
    uebernahme != null || (nfQuery.data ?? []).some((n) => n.material_ids.length > 0);
  // Derselbe Schlüssel und Abruf wie die Materialliste: ein Cache-Fach, live über `material`.
  const materialQuery = useQuery({
    queryKey: einsatzKeys.material(einsatzId),
    queryFn: () => listEinsatzMaterial(einsatzId),
    enabled: materialFrei && needsMaterial,
  });
  // Aus dem Einsatz genommene Posten zählen weiter (D3/D9) und stehen mit ihrem Zustand.
  const entlasseneQuery = useQuery({
    queryKey: einsatzKeys.materialEntlassene(einsatzId),
    queryFn: () => listEntlassenesMaterial(einsatzId),
    enabled: materialFrei && needsMaterial,
  });
  /*
   * Übernahme als Einheit (LLH-1383, design.md D9, D10): Knopf, Abruf und Vorschläge hängen an der
   * Freigabe Einheiten wie beim Material. Die Einheiten liest die Seite nur, wenn eine Karte
   * übernommene Einheiten zeigt, übernommen wird oder ein Formular „Wer“ anbietet; derselbe
   * Schlüssel wie die Einheitenliste, live über `einheit`.
   */
  const [einheitUebernahme, setEinheitUebernahme] = useState<Nachforderung | null>(null);
  const einheitenFrei = istKeyFreigegeben('einheiten', freigaben);
  const einheitGesperrt = freigabenBekannt && !einheitenFrei;
  const needsEinheiten =
    einheitUebernahme != null ||
    formular != null ||
    (nfQuery.data ?? []).some((n) => n.einheit_ids.length > 0);
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
    enabled: einheitenFrei && needsEinheiten,
  });
  const typenQuery = useQuery({
    queryKey: globalKeys.einheitTypen(),
    queryFn: listeEinheitTypen,
    enabled: einheitenFrei && einheitUebernahme != null,
  });
  // Nur, wenn die Seite sie braucht: liest ein anderer Teil der Seite (Ort eines Postens) dieselbe
  // Liste, zeichnete ihr Eintreffen sonst alle Karten neu (LFH-949).
  const einheitenListe = einheitenFrei && needsEinheiten ? einheitenQuery.data : undefined;
  // Gemerkt über den Datenstand (LFH-949): die Karten sind `memo`.
  const einheitenJeId = useMemo(
    () => (einheitenListe ? new Map(einheitenListe.map((e) => [e.id, e])) : null),
    [einheitenListe],
  );
  const werVorschlaege = useMemo(
    () => (einheitenListe ? einheitVorschlaege(einheitenListe) : undefined),
    [einheitenListe],
  );
  /*
   * Namen der Betreuungsstellen für Bezug, Kartenzeile und Filter (LLH-1082, design.md D4/D7): die
   * Nachforderung trägt nur die Kennung. Gelesen aus der Betreuungsübersicht (derselbe Cache wie
   * deren Seiten), nur mit Freigabe Betreuung und nur, wenn ein Bezug oder Filter sie braucht.
   */
  const betreuungFrei = istKeyFreigegeben('betreuung', freigaben);
  const needsStellen =
    bezugId != null ||
    stelleFilter != null ||
    (nfQuery.data ?? []).some((n) => n.betreuungsstelle_id != null);
  const betreuungQuery = useQuery({
    queryKey: einsatzKeys.betreuung(einsatzId),
    queryFn: () => ladeBetreuung(einsatzId),
    enabled: betreuungFrei && needsStellen,
  });
  // Gemerkt über den Datenstand (LFH-949): die Karten sind `memo`.
  const stellenJeId = useMemo<ReadonlyMap<number, StellenVerweis> | null>(
    () =>
      betreuungFrei && betreuungQuery.data
        ? new Map(
            betreuungQuery.data.stellen.map((st) => [
              st.id,
              { name: st.bezeichnung, pfad: betreuungsstellePfad(einsatzId, st.id) },
            ]),
          )
        : null,
    [betreuungFrei, betreuungQuery.data, einsatzId],
  );
  const bezug = useMemo<NachforderungBezug | null>(
    () =>
      bezugId == null
        ? null
        : {
            betreuungsstelleId: bezugId,
            name: stellenJeId?.get(bezugId)?.name,
            pfad: stellenJeId?.get(bezugId)?.pfad,
          },
    [bezugId, stellenJeId],
  );
  /*
   * Ziele (LLH-1089, design.md D5/D10): Räume und Abschnitte für „Wohin“ und die Zielzeile der
   * Karten. Nur mit Freigabe des Moduls (`istKeyFreigegeben`, wie Betreuung) und nur, wenn die
   * Erfassung offen ist oder eine Karte ein Ziel nennt.
   */
  const raeumeFrei = istKeyFreigegeben('bereitstellungsraeume', freigaben);
  // Bearbeiten an einer Karte braucht dieselben Listen für „Wohin“ (LLH-1097 D9).
  const bearbeitet = formular?.art === 'bearbeiten';
  const abschnitteFrei = istKeyFreigegeben('einsatzabschnitte', freigaben);
  const kartenMitRaum = (nfQuery.data ?? []).some((n) => n.ziel_br_id != null);
  const kartenMitAbschnitt = (nfQuery.data ?? []).some((n) => n.ziel_abschnitt_id != null);
  const raeumeQuery = useQuery({
    queryKey: einsatzKeys.br(einsatzId),
    queryFn: () => listeBr(einsatzId),
    enabled: raeumeFrei && (formOffen || bearbeitet || kartenMitRaum),
  });
  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
    enabled: abschnitteFrei && (formOffen || bearbeitet || kartenMitAbschnitt),
  });
  const raeume = raeumeFrei ? raeumeQuery.data : undefined;
  const abschnitte = abschnitteFrei ? abschnitteQuery.data : undefined;
  // Gemerkt über den Datenstand (LFH-949): die Karten sind `memo`. Nur die Listen, die eine Karte
  // braucht: ein Abruf aus einem anderen Teil der Seite (Ort eines Postens) zeichnete sonst alle
  // Karten neu.
  const kartenRaeume = kartenMitRaum ? raeume : undefined;
  const kartenAbschnitte = kartenMitAbschnitt ? abschnitte : undefined;
  const zielNamen = useMemo<ZielNamen | null>(
    () =>
      kartenRaeume || kartenAbschnitte
        ? {
            raeume: kartenRaeume ? new Map(kartenRaeume.map((r) => [r.id, r.bezeichnung])) : null,
            abschnitte: kartenAbschnitte
              ? new Map(kartenAbschnitte.map((a) => [a.id, a.name]))
              : null,
          }
        : null,
    [kartenRaeume, kartenAbschnitte],
  );
  // Schnellwahl und Vorschläge für „Was“: die Arten dieses Einsatzes, häufigste zuerst (D2–D4).
  const arten = useMemo(() => fruehereArten(nfQuery.data ?? []), [nfQuery.data]);
  const materialListe = useMemo<EinsatzMaterial[]>(
    () => [...(materialQuery.data ?? []), ...(entlasseneQuery.data ?? [])],
    [materialQuery.data, entlasseneQuery.data],
  );
  // Gemerkt über den Datenstand (LFH-949): die Karten sind `memo`.
  const materialJeId = useMemo(
    () =>
      materialFrei && materialQuery.isSuccess
        ? new Map(materialListe.map((em) => [em.id, em]))
        : null,
    [materialFrei, materialQuery.isSuccess, materialListe],
  );

  const invalidiere = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: einsatzKeys.nachforderungen(einsatzId) }),
      qc.invalidateQueries({ queryKey: einsatzKeys.modulZaehler(einsatzId) }),
    ]);
  /*
   * Die eigene Handlung ordnet das Board neu (Spec `datensicht-zufluss`): erst wenn der neue Stand
   * da ist, gibt die Schleuse ihn frei, dann wandert der Fokus mit der Karte. Ohne das hielte der
   * Fokus auf dem Knopf die Karte in der alten Spalte fest.
   */
  const zeigeEigeneHandlung = async (nfId: number) => {
    await invalidiere();
    zufluss.nachBenutzeraktion();
    setFokusZiel(nfId);
  };
  /*
   * Jede Handlung meldet ihre Ablehnung an ihrem Ort, kein Toast (LFH-1077, `frontend/AGENTS.md`,
   * „Rückwege und Fehler“): Anlegen am Formular, Fortschalten an der Karte, Rückgängig im
   * Seitenhinweis, Ablehnen im Dialog. Bei Fehler (insb. 422 aus der optimistischen Sperre)
   * zusätzlich invalidieren, damit ein veralteter View den echten Status nachlädt.
   */
  const kartenFehler = useZeilenFehler<number>();

  const anlegenMutation = useMutation({
    mutationFn: (d: NeueNachforderung) => legeNachforderungAn(einsatzId, d),
    // Das Inline-Formular bleibt nach dem Anlegen offen, damit die nächste Nachforderung ohne
    // Aufklappen folgt; ein Zuklappen unmountete es samt Serienzähler und Wertübernahme.
    onSuccess: () => {
      invalidiere();
      message.success('Nachforderung abgesetzt');
    },
    onError: invalidiere,
  });
  /**
   * Fortschaltung und Rücknahme sind getrennte Mutationen, weil ihr Fehler an verschiedenen Orten
   * steht: an der Karte und im Seitenhinweis. Die Rücknahme erzeugt keinen eigenen
   * Rückgängig-Toast, sonst schaukelte sich das Paar endlos auf. `vorher` ist der Stand vor dem
   * Klick und damit das Ziel des Rückwegs — übergeben statt abgeleitet, weil `NAECHSTER` rückwärts
   * mehrdeutig wäre, sobald die Kette einen Abzweig bekommt.
   */
  // Die nächste Rücknahme räumt den Grund der vorigen.
  const ruecknahmeMutation = useMutation({
    mutationFn: ({ nfId, status }: { nfId: number; status: NachforderungStatus }) =>
      setzeNachforderungStatus(einsatzId, nfId, status),
    onMutate: () => setSeitenFehler(null),
    onSuccess: (_daten, { nfId }) => zeigeEigeneHandlung(nfId),
    onError: (e) => {
      setSeitenFehler(e);
      invalidiere();
    },
  });
  const statusMutation = useMutation({
    mutationFn: ({
      nfId,
      status,
    }: {
      nfId: number;
      status: NachforderungStatus;
      vorher?: NachforderungStatus;
    }) => setzeNachforderungStatus(einsatzId, nfId, status),
    // Eine neue Fortschaltung an der Karte räumt deren alten Grund.
    onMutate: ({ nfId }) => kartenFehler.beginne(nfId),
    onSuccess: (_daten, { nfId, status, vorher }) => {
      if (vorher) {
        zeigeRueckgaengig(message, `Status: ${NACHFORDERUNG_STATUS[status]?.label ?? status}`, () =>
          ruecknahmeMutation.mutate({ nfId, status: vorher }),
        );
      }
      return zeigeEigeneHandlung(nfId);
    },
    onError: (e, { nfId }) => {
      kartenFehler.melde(nfId, e, 'Statuswechsel fehlgeschlagen');
      invalidiere();
    },
  });
  const ablehnenMutation = useMutation({
    mutationFn: ({ nfId, grund }: { nfId: number; grund?: string }) =>
      lehneNachforderungAb(einsatzId, nfId, grund),
    // Der Dialog schließt erst hier (design.md D3): bis zur Antwort bleibt der getippte Grund
    // stehen, eine Ablehnung steht im Dialog. Solange sie läuft, sind seine Auswege gesperrt.
    onSuccess: (_daten, { nfId }) => {
      message.success('Nachforderung abgelehnt');
      setAblehnenId(null);
      setAblehnenGrund('');
      return zeigeEigeneHandlung(nfId);
    },
    onError: invalidiere,
  });
  const zurueckziehenMutation = useMutation({
    mutationFn: ({ nfId, grund }: { nfId: number; grund?: string }) =>
      zieheNachforderungZurueck(einsatzId, nfId, grund),
    // Wie Ablehnen: der Dialog schließt erst nach der Antwort, eine Ablehnung steht im Dialog.
    onSuccess: (_daten, { nfId }) => {
      message.success('Nachforderung zurückgezogen');
      setZurueckziehenId(null);
      setZurueckziehenGrund('');
      return zeigeEigeneHandlung(nfId);
    },
    onError: invalidiere,
  });
  /*
   * Zusage über das Formular an der Karte (LLH-1097 D4/D10): danach der Rückgängig-Toast wie bei
   * der Fortschaltung; die Rücknahme leert die Zusage, eine Teilung bleibt (D6). Die Ablehnung
   * steht im Formular (`speicherung`).
   */
  const zusageMutation = useMutation({
    mutationFn: ({ nfId, zusage }: { nfId: number; zusage: NachforderungZusageEingabe }) =>
      erfasseZusage(einsatzId, nfId, zusage),
    onSuccess: (_daten, { nfId }) => {
      zeigeRueckgaengig(message, `Status: ${NACHFORDERUNG_STATUS.zugesagt.label}`, () =>
        ruecknahmeMutation.mutate({ nfId, status: 'angefordert' }),
      );
      return zeigeEigeneHandlung(nfId);
    },
    onError: invalidiere,
  });
  const bearbeitenMutation = useMutation({
    mutationFn: ({ nfId, aenderung }: { nfId: number; aenderung: PatchNachforderung }) =>
      patcheNachforderung(einsatzId, nfId, aenderung),
    onSuccess: (_daten, { nfId }) => {
      message.success('Änderung gespeichert');
      return zeigeEigeneHandlung(nfId);
    },
    onError: invalidiere,
  });
  const darfSchreibenRoh = darfImEinsatzSchreiben(einsatzQuery.data);

  /*
   * Übernehmen (D1): ein Material-POST mit Bezug. Ablehnungen stehen im Dialog (`speicherung`).
   * Eine 409 heißt „schon übernommen“ (D3): die Seite lädt Nachforderungen und Material neu und
   * schaltet den Dialog erst danach auf „Weiteren Posten übernehmen“, damit die Menge aus dem
   * frischen Stand gerechnet wird. Die Person entscheidet dann bewusst.
   */
  const uebernahmeMutation = useMutation({
    mutationFn: ({
      n,
      werte,
      ergaenzen,
    }: {
      n: Nachforderung;
      werte: UebernahmeWerte;
      ergaenzen: boolean;
    }) => {
      const k = uebernahmeBody(n, werte, ergaenzen);
      return disponiereAdhoc(einsatzId, k.adhoc, k.menge, k.optionen);
    },
    onSuccess: () => {
      message.success('Material übernommen');
      void qc.invalidateQueries({ queryKey: einsatzKeys.material(einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
      return invalidiere();
    },
    onError: async (e, { n }) => {
      if (!istKonflikt(e)) {
        void invalidiere();
        return;
      }
      await Promise.all([
        invalidiere(),
        qc.invalidateQueries({ queryKey: einsatzKeys.material(einsatzId) }),
        qc.invalidateQueries({ queryKey: einsatzKeys.materialEntlassene(einsatzId) }),
      ]);
      setUebernahme((u) => (u && u.n.id === n.id ? { ...u, ergaenzen: true } : u));
    },
  });

  /*
   * Als Einheit übernehmen (LLH-1383 D2): ein POST, der die Einheiten anlegt oder verknüpft und
   * im Raum bucht. Ablehnungen stehen im Dialog (`speicherung`); jede lädt Nachforderungen und
   * Einheiten neu, damit „wird verknüpft“ und der Rest aus dem frischen Stand kommen.
   */
  const einheitMutation = useMutation({
    mutationFn: ({ n, werte }: { n: Nachforderung; werte: EinheitUebernahmeWerte }) =>
      uebernehmeAusNachforderung(einsatzId, einheitenBody(n, werte, einheitenQuery.data ?? [])),
    onSuccess: (_d, { werte }) => {
      message.success(werte.einheiten.length > 1 ? 'Einheiten übernommen' : 'Einheit übernommen');
      void qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.br(einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
      return invalidiere();
    },
    onError: () =>
      Promise.all([
        invalidiere(),
        qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) }),
      ]),
  });

  /**
   * Erfassung per Deeplink: `?neu=1` öffnet sie, eine Vorbelegung
   * (`art`/`bezeichnung`/`anzahl`/`begruendung`) füllt sie. Apply-then-clean wie der
   * Platzier-Auftrag in `LagekartePage.tsx`: erst anwenden, dann räumen, `replace`, `searchParams`
   * kopiert statt mutiert. Ein stehengebliebener Auftrag öffnete das Formular bei jedem Neuladen.
   *
   * Der Lade-Riegel steht vor dem Räumen: `darfImEinsatzSchreiben` liefert für einen noch nicht
   * geladenen Einsatz `false`; ohne Riegel ginge der Deeplink bei F5 oder aus einem neuen Tab still
   * verloren.
   *
   * Eine unbrauchbare Vorbelegung wird ganz verworfen (`parseNachforderungVorbelegung`), die
   * Erfassung öffnet dann leer. Ohne Schreibrecht öffnet nichts — geräumt wird trotzdem.
   */
  useEffect(() => {
    const neu = searchParams.get('neu') === '1';
    const hatVorbelegung = NACHFORDERUNG_VORBELEGUNG_PARAMS.some((k) => searchParams.has(k));
    const hatBezug = searchParams.has(NACHFORDERUNG_BEZUG_PARAM);
    if (!neu && !hatVorbelegung && !hatBezug) return;
    if (einsatzQuery.isLoading) return;
    if (darfSchreibenRoh) {
      setVorbelegung(parseNachforderungVorbelegung(searchParams));
      setBezugId(parseNachforderungBezug(searchParams));
      setFormOffen(true);
    }
    const naechste = new URLSearchParams(searchParams);
    naechste.delete('neu');
    for (const k of NACHFORDERUNG_VORBELEGUNG_PARAMS) naechste.delete(k);
    naechste.delete(NACHFORDERUNG_BEZUG_PARAM);
    setSearchParams(naechste, { replace: true });
  }, [searchParams, setSearchParams, einsatzQuery.isLoading, darfSchreibenRoh]);

  /*
   * Gemerkt über den Datenstand, Handler über einen Ref-Bündel (LFH-949, D7): die Karten sind
   * `memo`, und je Render neue Listen oder Pfeile machten jede Karte neu. Steht vor den frühen
   * Rücksprüngen, wie jeder Hook.
   */
  const { gefiltert, stellenMitBezug } = useMemo(() => {
    const alle = nfQuery.data ?? [];
    // Filter „für Stelle“ (LLH-1082): Board und Spaltenzahlen, nicht der Seitenkopf.
    const gefiltert =
      stelleFilter == null ? alle : alle.filter((n) => n.betreuungsstelle_id === stelleFilter);
    return {
      gefiltert,
      // Stellen, für die es Nachforderungen gibt — die Wahl des Filters.
      stellenMitBezug: [
        ...new Set(
          alle.flatMap((n) => (n.betreuungsstelle_id != null ? [n.betreuungsstelle_id] : [])),
        ),
      ],
    };
  }, [nfQuery.data, stelleFilter]);
  const board = useBoardStand(gefiltert, jetzt, zufluss);
  // Die Vorgabe gilt einmal, beim ersten Datenstand: danach bleibt die Stufe, auch wenn ihre
  // letzte Karte weiterwandert (sonst spränge das Segment am Handy mit).
  const vorgabe = vorgabeStufe(board.spalten);
  useEffect(() => {
    if (gewaehlteStufe == null && nfQuery.isSuccess) setGewaehlteStufe(vorgabe);
  }, [gewaehlteStufe, nfQuery.isSuccess, vorgabe]);
  const ansicht: BoardAnsicht = {
    stufe: gewaehlteStufe ?? vorgabe,
    abgelehntOffen,
    zurueckgezogenOffen,
    aeltereOffen,
  };
  const setzeAnsicht = useCallback((a: BoardAnsicht) => {
    setGewaehlteStufe(a.stufe);
    setAbgelehntOffen(a.abgelehntOffen);
    setZurueckgezogenOffen(a.zurueckgezogenOffen);
    setAeltereOffen(a.aeltereOffen);
  }, []);
  const stand = useRef({ alle: nfQuery.data, statusMutation, zusageMutation, bearbeitenMutation });
  useLayoutEffect(() => {
    stand.current = { alle: nfQuery.data, statusMutation, zusageMutation, bearbeitenMutation };
  });
  // Öffnen ersetzt ein anderes offenes Formular; Schließen schließt nur das eigene.
  const onFormular = useCallback((nfId: number, art: KartenFormular | null) => {
    setFormular((f) => (art ? { id: nfId, art } : f?.id === nfId ? null : f));
  }, []);
  const onZusage = useCallback(
    (nfId: number, zusage: NachforderungZusageEingabe) =>
      stand.current.zusageMutation.mutateAsync({ nfId, zusage }),
    [],
  );
  const onBearbeiten = useCallback(
    (nfId: number, aenderung: PatchNachforderung) =>
      stand.current.bearbeitenMutation.mutateAsync({ nfId, aenderung }),
    [],
  );
  const onStatus = useCallback((nfId: number, status: NachforderungStatus) => {
    const vorher = stand.current.alle?.find((n) => n.id === nfId)?.status;
    stand.current.statusMutation.mutate({ nfId, status, vorher });
  }, []);
  // Öffnen räumt den Grund einer früheren Ablehnung; die Absicht steht ab hier fest (D3).
  const uebernahmeRef = useRef(uebernahmeMutation);
  uebernahmeRef.current = uebernahmeMutation;
  const onMaterialUebernehmen = useCallback((nfId: number) => {
    const n = stand.current.alle?.find((x) => x.id === nfId);
    if (!n) return;
    const m = uebernahmeRef.current;
    if (!m.isPending && m.error != null) m.reset();
    setUebernahme({ n, ergaenzen: isErgaenzen(n) });
  }, []);
  const einheitMutationRef = useRef(einheitMutation);
  einheitMutationRef.current = einheitMutation;
  const onEinheitUebernehmen = useCallback((nfId: number) => {
    const n = stand.current.alle?.find((x) => x.id === nfId);
    if (!n) return;
    const m = einheitMutationRef.current;
    if (!m.isPending && m.error != null) m.reset();
    setEinheitUebernahme(n);
  }, []);

  /*
   * `?nachforderung=<id>` (D10, Sprung aus der Materialzeile): ihre Stufe gewählt und aufgeklappt
   * (Abgelehnt, ältere Eingetroffene), die Karte hervorgehoben und einmal ins Bild gerollt; der
   * Parameter wird geräumt (`useQueryParamSelektion`). Eine unbekannte Kennung ändert nichts.
   */
  const [hervorgehobenId, setHervorgehobenId] = useState<number | null>(null);
  const [scrollZiel, setScrollZiel] = useState<number | null>(null);
  // Erst wenn auch der Einsatz da ist: vorher stehen statt der Karten nur der Ladekreis, und der
  // Bildlauf fände keine Karte, bis ein späterer Datenstand den Effekt erneut anstößt (Review).
  useQueryParamSelektion('nachforderung', nfQuery.isSuccess && einsatzQuery.isSuccess, (nfId) => {
    const n = nfQuery.data?.find((x) => x.id === nfId);
    if (!n) return;
    const gruppe = boardGruppe(n, jetzt);
    setGewaehlteStufe(gruppe === 'eingetroffen-aelter' ? 'eingetroffen' : gruppe);
    if (gruppe === 'abgelehnt') setAbgelehntOffen(true);
    if (gruppe === 'zurueckgezogen') setZurueckgezogenOffen(true);
    if (gruppe === 'eingetroffen-aelter') setAeltereOffen(true);
    setHervorgehobenId(nfId);
    setScrollZiel(nfId);
  });
  useEffect(() => {
    if (scrollZiel == null) return;
    const karte = document.querySelector(`[data-nachforderung-id="${scrollZiel}"]`);
    if (!karte) return;
    karte.scrollIntoView?.({ block: 'center' });
    setScrollZiel(null);
  }, [scrollZiel, gewaehlteStufe, abgelehntOffen, aeltereOffen, board.spalten]);
  useEffect(() => {
    if (fokusZiel == null) return;
    setFokusZiel(null);
    // Steht die Karte nicht mehr im Bild (am Handy in einer anderen Stufe), bleibt der Fokus im
    // Board, damit er nicht auf die Seite zurückfällt.
    const ziel =
      document.querySelector<HTMLElement>(`[data-nachforderung-id="${fokusZiel}"]`) ??
      document.querySelector<HTMLElement>('[data-lfh="nachforderung-board"]');
    ziel?.focus({ preventScroll: false });
  }, [fokusZiel]);
  // Öffnen und Abbrechen räumen den Grund einer früheren Ablehnung; eine laufende Mutation bleibt
  // unberührt, `reset()` hängte ihr Ergebnis ab.
  const ablehnenRef = useRef(ablehnenMutation);
  ablehnenRef.current = ablehnenMutation;
  const raeumeAblehnen = useCallback(() => {
    const m = ablehnenRef.current;
    if (!m.isPending && m.error != null) m.reset();
  }, []);
  const onAblehnen = useCallback(
    (nfId: number) => {
      raeumeAblehnen();
      setAblehnenId(nfId);
      setAblehnenGrund('');
    },
    [raeumeAblehnen],
  );

  // Zurückziehen wie Ablehnen: Öffnen und Abbrechen räumen den Grund einer früheren Ablehnung.
  const zurueckziehenRef = useRef(zurueckziehenMutation);
  zurueckziehenRef.current = zurueckziehenMutation;
  const raeumeZurueckziehen = useCallback(() => {
    const m = zurueckziehenRef.current;
    if (!m.isPending && m.error != null) m.reset();
  }, []);
  const onZurueckziehen = useCallback(
    (nfId: number) => {
      raeumeZurueckziehen();
      setZurueckziehenId(nfId);
      setZurueckziehenGrund('');
    },
    [raeumeZurueckziehen],
  );
  // Über der Grenze sperrt der Knopf; gekürzt wird nie (LFH-937, `components/zeichenGrenze.tsx`).
  const zurueckziehenZuLang = istZuLang(zurueckziehenGrund, NACHFORDERUNG_ZURUECKZIEHEN_GRUND_MAX);
  const zurueckziehenBestaetigen = () => {
    if (zurueckziehenId == null || zurueckziehenZuLang) return;
    zurueckziehenMutation.mutate({
      nfId: zurueckziehenId,
      grund: zurueckziehenGrund.trim() || undefined,
    });
  };
  const zieht = zurueckziehenMutation.isPending;

  const ablehnenZuLang = istZuLang(ablehnenGrund, NACHFORDERUNG_ABLEHNEN_GRUND_MAX);
  const ablehnenBestaetigen = () => {
    if (ablehnenId == null || ablehnenZuLang) return;
    ablehnenMutation.mutate({ nfId: ablehnenId, grund: ablehnenGrund.trim() || undefined });
  };
  // Solange abgelehnt wird, sind alle Auswege gesperrt: der Dialog bleibt bis zur Antwort offen.
  const lehntAb = ablehnenMutation.isPending;

  if (einsatzQuery.isLoading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz);
  /*
   * Das Formular gilt nur, solange seine Karte es tragen kann: offen und bei der Zusage noch
   * angefordert. Wandert sie durch einen anderen Arbeitsplatz weiter, ist es weg — sonst hielte
   * das Board für ein unsichtbares Formular still.
   */
  const formularN = formular ? nfQuery.data?.find((n) => n.id === formular.id) : undefined;
  const wirksamesFormular =
    formular &&
    formularN?.ist_offen &&
    (formular.art === 'bearbeiten' || formularN.status === 'angefordert')
      ? formular
      : null;
  const kartenProps = {
    darfSchreiben,
    onStatus,
    onAblehnen,
    onZurueckziehen,
    offenesFormular: wirksamesFormular,
    onFormular,
    onZusage,
    onBearbeiten,
    formularSpeicherung: wirksamesFormular?.art === 'zusage' ? zusageMutation : bearbeitenMutation,
    raeume,
    abschnitte,
    kartenFehler: kartenFehler.grund,
    materialJeId,
    materialGesperrt,
    onMaterialUebernehmen: freigabenBekannt ? onMaterialUebernehmen : undefined,
    einheitenJeId,
    einheitGesperrt,
    onEinheitUebernehmen: freigabenBekannt ? onEinheitUebernehmen : undefined,
    werVorschlaege,
    hervorgehobenId,
    laeuftId: statusMutation.isPending ? statusMutation.variables?.nfId : null,
    stellenJeId,
    zielNamen,
  };
  // Filterwahl nur mit Namen (Freigabe Betreuung) und sobald es Bezüge gibt (design.md D7).
  const stellenOptionen =
    stellenJeId != null
      ? stellenMitBezug.flatMap((id) => {
          const name = stellenJeId.get(id)?.name;
          return name ? [{ value: id, label: name }] : [];
        })
      : [];
  const filterName = stelleFilter != null ? stellenJeId?.get(stelleFilter)?.name : undefined;
  // Der Dialog liest die Nachforderung im aktuellen Stand (Posten, Rest der Anzahl).
  const uebernahmeN = uebernahme
    ? (nfQuery.data?.find((n) => n.id === uebernahme.n.id) ?? uebernahme.n)
    : null;
  const einheitN = einheitUebernahme
    ? (nfQuery.data?.find((n) => n.id === einheitUebernahme.id) ?? einheitUebernahme)
    : null;
  const einheitRaumName =
    einheitN?.ziel_br_id != null
      ? raeume?.find((r) => r.id === einheitN.ziel_br_id)?.bezeichnung
      : undefined;
  /*
   * Nach einer Ablehnung lädt `onError` neu; die Karte kann dabei in die andere Ansicht wandern
   * (ein anderer Arbeitsplatz hat schon fortgeschaltet) oder in einer Stufe stehen, die gerade
   * nicht zu sehen ist. Ihr Grund hätte dann keinen Ort mehr und steht im Seitenhinweis, solange
   * sie im gezeigten Board fehlt. Die Rücknahme geht vor.
   */
  const gezeigt = sichtbareKarten(board.spalten, ansicht, schmal);
  const gewandertId = kartenFehler.gemeldet().find((nfId) => !gezeigt.some((n) => n.id === nfId));
  const gewandert = gewandertId != null ? kartenFehler.grund(gewandertId) : null;
  const gewandertN = nfQuery.data?.find((n) => n.id === gewandertId);
  const gewandertName = gewandertN ? nachforderungName(gewandertN) : undefined;
  const seitenGrund =
    seitenFehler != null
      ? {
          fehler: seitenFehler,
          titel: 'Nicht zurückgenommen',
          fallback: 'Rücknahme fehlgeschlagen',
        }
      : gewandert != null
        ? {
            fehler: gewandert.fehler,
            titel: gewandertName
              ? `Status von „${gewandertName}“ nicht geändert`
              : 'Status nicht geändert',
            fallback: gewandert.fallback,
          }
        : null;

  return (
    <EinsatzSeite
      titel={modulName('nachforderungen')}
      // Ohne Server-Zahl keine Zahl: „0 offen“ wäre falsch (Fehlt ≠ 0).
      meta={
        zaehlerQuery.data?.nachforderungen
          ? offenText(zaehlerQuery.data.nachforderungen)
          : undefined
      }
      dataUpdatedAt={nfQuery.dataUpdatedAt}
      // Nur mit Inhalt gesetzt: ein leerer Slot rendert in `EinsatzSeite` trotzdem seinen Rahmen.
      hinweis={
        seitenGrund != null && (
          <SeitenHinweise
            fehler={seitenGrund.fehler}
            fehlerTitel={seitenGrund.titel}
            fehlerFallback={seitenGrund.fallback}
          />
        )
      }
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: modulName('nachforderungen') },
          ]}
        />
      }
      aktionen={
        darfSchreiben && (
          // Solange eine Nachforderung unterwegs ist, bleibt das Formular offen: die Antwort braucht
          // ihren Ort (design.md D3).
          <Button
            type="primary"
            icon={formOffen ? <IconChevronHoch /> : <IconPlus />}
            disabled={formOffen && anlegenMutation.isPending}
            onClick={() => (formOffen ? schliesseFormular() : setFormOffen(true))}
          >
            {formOffen ? 'Formular schließen' : 'Nachforderung anlegen'}
          </Button>
        )
      }
    >
      {darfSchreiben && formOffen && (
        <Paneel
          titel="Neue Nachforderung"
          koerperPolster
          style={{ marginBottom: token.margin }}
          aktion={
            <Button
              type="text"
              icon={<IconKreuz />}
              disabled={anlegenMutation.isPending}
              onClick={schliesseFormular}
              aria-label="Formular schließen"
            />
          }
        >
          <NachforderungFormular
            card={false}
            vorbelegung={vorbelegung}
            bezug={bezug}
            fruehereArten={arten}
            raeume={raeume}
            abschnitte={abschnitte}
            senden={anlegenMutation.isPending}
            // mutateAsync: die Erfassungshülle darf die Felder nur leeren, wenn die Nachforderung
            // angekommen ist.
            onAnlegen={(d) => anlegenMutation.mutateAsync(d)}
            // Grund einer Ablehnung im Formular, bis zum nächsten Absetzen; Einhängen räumt ihn.
            speicherung={anlegenMutation}
          />
        </Paneel>
      )}

      {nfQuery.isError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: token.marginSM }}
          title="Nachforderungen konnten nicht geladen werden"
        />
      )}
      {stellenOptionen.length > 0 && (
        <div style={{ marginBottom: token.margin }}>
          <Select<number>
            aria-label="Für Stelle"
            allowClear
            placeholder="Für Stelle"
            style={{ minWidth: 200 }}
            value={stelleFilter ?? undefined}
            options={stellenOptionen}
            onChange={(id) => setzeStelleFilter(id ?? null)}
          />
        </div>
      )}
      {stelleFilter != null && (
        <div style={{ marginBottom: token.marginSM }}>
          <Filterhinweis
            merkmale={[filterName ? `Betreuungsstelle ${filterName}` : 'eine Betreuungsstelle']}
            onZuruecksetzen={() => setzeStelleFilter(null)}
          />
        </div>
      )}
      {nfQuery.isSuccess && (
        <NachforderungBoard
          stand={board}
          jetzt={jetzt}
          zufluss={zufluss}
          // Ein Dialog der Seite liegt im Portal: Fokus und Zeiger zählen dort nicht.
          // Ebenso ein Formular an einer Karte (LLH-1097 D10).
          halten={
            ablehnenId != null ||
            zurueckziehenId != null ||
            uebernahme != null ||
            einheitUebernahme != null ||
            wirksamesFormular != null
          }
          ansicht={ansicht}
          onAnsicht={setzeAnsicht}
          karten={kartenProps}
        />
      )}
      {/* Außerhalb der Karten-`map` (LFH-683): ein Dialog für alle Karten. */}
      <MaterialUebernahmeModal
        einsatzId={einsatzId}
        nachforderung={darfSchreiben ? uebernahmeN : null}
        ergaenzen={uebernahme?.ergaenzen ?? false}
        material={materialListe}
        laeuft={uebernahmeMutation.isPending}
        speicherung={uebernahmeMutation}
        onUebernehmen={(werte) => {
          if (!uebernahmeN || !uebernahme) return Promise.resolve();
          return uebernahmeMutation.mutateAsync({
            n: uebernahmeN,
            werte,
            ergaenzen: uebernahme.ergaenzen,
          });
        }}
        onSchliessen={() => setUebernahme(null)}
      />
      <EinheitUebernahmeModal
        nachforderung={darfSchreiben && einheitenFrei ? einheitN : null}
        einheiten={einheitenListe ?? KEINE_EINHEITEN}
        typen={typenQuery.data ?? KEINE_TYPEN}
        raumName={einheitRaumName}
        raumGesperrt={!raeumeFrei}
        laeuft={einheitMutation.isPending}
        speicherung={einheitMutation}
        onUebernehmen={(werte) => {
          if (!einheitN) return Promise.resolve();
          return einheitMutation.mutateAsync({ n: einheitN, werte });
        }}
        onSchliessen={() => setEinheitUebernahme(null)}
      />
      <Modal
        open={ablehnenId != null}
        title="Nachforderung ablehnen"
        okText="Ablehnen"
        cancelText="Abbrechen"
        okButtonProps={{ danger: true, disabled: ablehnenZuLang }}
        confirmLoading={lehntAb}
        cancelButtonProps={{ disabled: lehntAb }}
        closable={lehntAb ? { disabled: true } : true}
        mask={{ closable: !lehntAb }}
        keyboard={!lehntAb}
        onOk={ablehnenBestaetigen}
        onCancel={() => {
          raeumeAblehnen();
          setAblehnenId(null);
          setAblehnenGrund('');
        }}
      >
        <Input.TextArea
          aria-label="Ablehnungsgrund"
          value={ablehnenGrund}
          onChange={(e) => setAblehnenGrund(e.target.value)}
          placeholder="Grund (optional), z. B. keine Reserven verfügbar"
          count={zeichenGrenze(NACHFORDERUNG_ABLEHNEN_GRUND_MAX)}
          rows={3}
        />
        {ablehnenMutation.error != null && (
          <div style={{ marginTop: token.marginSM }}>
            <SpeicherFehler
              fehler={ablehnenMutation.error}
              titel="Nicht abgelehnt"
              fallback="Ablehnen fehlgeschlagen"
            />
          </div>
        )}
      </Modal>
      <Modal
        open={zurueckziehenId != null}
        title="Nachforderung zurückziehen"
        okText="Zurückziehen"
        cancelText="Abbrechen"
        okButtonProps={{ danger: true, disabled: zurueckziehenZuLang }}
        confirmLoading={zieht}
        cancelButtonProps={{ disabled: zieht }}
        closable={zieht ? { disabled: true } : true}
        mask={{ closable: !zieht }}
        keyboard={!zieht}
        onOk={zurueckziehenBestaetigen}
        onCancel={() => {
          raeumeZurueckziehen();
          setZurueckziehenId(null);
          setZurueckziehenGrund('');
        }}
      >
        <Input.TextArea
          aria-label="Grund des Zurückziehens"
          value={zurueckziehenGrund}
          onChange={(e) => setZurueckziehenGrund(e.target.value)}
          placeholder="Grund (optional), z. B. nicht mehr benötigt"
          count={zeichenGrenze(NACHFORDERUNG_ZURUECKZIEHEN_GRUND_MAX)}
          rows={3}
        />
        {zurueckziehenMutation.error != null && (
          <div style={{ marginTop: token.marginSM }}>
            <SpeicherFehler
              fehler={zurueckziehenMutation.error}
              titel="Nicht zurückgezogen"
              fallback="Zurückziehen fehlgeschlagen"
            />
          </div>
        )}
      </Modal>
    </EinsatzSeite>
  );
}
