import { IconChevronHoch, IconKreuz, IconPlus } from '../icons';
import { Alert, App, Breadcrumb, Button, Input, Modal, Spin } from 'antd';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeBetreuung } from '../api/betreuung';
import { ladeEinsatz, ladeModulFreigaben } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { einsatzKeys } from '../api/queryKeys';
import { istKonflikt } from '../api/client';
import {
  disponiereAdhoc,
  listEinsatzMaterial,
  listEntlassenesMaterial,
} from '../api/einsatzMaterial';
import {
  legeNachforderungAn,
  lehneNachforderungAb,
  listeNachforderungen,
  setzeNachforderungStatus,
} from '../api/nachforderungen';
import type {
  EinsatzMaterial,
  Nachforderung,
  NachforderungStatus,
  NeueNachforderung,
} from '../api/types';
import { NACHFORDERUNG_STATUS, istAbgeschlossen, prioRang } from '../kommunikation';
import { zeigeRueckgaengig } from '../kommunikation/rueckgaengig';
import NachforderungListe from '../nachforderungen/NachforderungListe';
import NachforderungFormular, {
  type NachforderungBezug,
} from '../nachforderungen/NachforderungFormular';
import type { StellenVerweis } from '../nachforderungen/NachforderungKarte';
import MaterialUebernahmeModal from '../nachforderungen/MaterialUebernahmeModal';
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
import {
  NACHFORDERUNG_BEZUG_PARAM,
  NACHFORDERUNG_VORBELEGUNG_PARAMS,
  betreuungsstellePfad,
  parseNachforderungBezug,
  parseNachforderungStelle,
  parseNachforderungVorbelegung,
  type NachforderungVorbelegung,
} from '../routing/deeplinks';
import { Filterhinweis, Paneel, Segmentleiste, useRollen } from '../components/instrument';
import { Select } from '../components/Select';

/** Schlüssel-Zeitstempel der Abgeschlossen-Ansicht: Eintreffen ODER Ablehnung. */
function abschlussZeit(n: Nachforderung): string {
  return n.eingetroffen_at ?? n.abgelehnt_at ?? n.angefordert_at;
}

export default function NachforderungenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { token } = useRollen();

  const [ansicht, setAnsicht] = useState<'offen' | 'abgeschlossen'>('offen');
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

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  // Offen/Abgeschlossen-Trennung clientseitig → alle Nachforderungen laden.
  const nfQuery = useQuery({
    queryKey: einsatzKeys.nachforderungen(einsatzId),
    queryFn: () => listeNachforderungen(einsatzId, {}),
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
    qc.invalidateQueries({ queryKey: einsatzKeys.nachforderungen(einsatzId) });
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
    onSuccess: invalidiere,
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
      invalidiere();
      if (!vorher) return;
      zeigeRueckgaengig(message, `Status: ${NACHFORDERUNG_STATUS[status]?.label ?? status}`, () =>
        ruecknahmeMutation.mutate({ nfId, status: vorher }),
      );
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
    onSuccess: () => {
      invalidiere();
      message.success('Nachforderung abgelehnt');
      setAblehnenId(null);
      setAblehnenGrund('');
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
  const {
    offene,
    abgeschlossene,
    offeneGefiltert,
    abgeschlosseneGefiltert,
    offeneSortiert,
    abgeschlosseneSortiert,
    stellenMitBezug,
  } = useMemo(() => {
    const alle = nfQuery.data ?? [];
    // Offen/Abgeschlossen clientseitig über die gemeinsame Phasen-Semantik (eingetroffen und
    // abgelehnt zählen als „abgeschlossen").
    const istAbg = (n: Nachforderung) =>
      istAbgeschlossen(NACHFORDERUNG_STATUS[n.status]?.phase ?? 'offen');
    const offene = alle.filter((n) => !istAbg(n));
    const abgeschlossene = alle.filter(istAbg);
    // Filter „für Stelle“ (LLH-1082): Liste und Ansichtszähler, nicht der Seitenkopf.
    const imFilter = (n: Nachforderung) =>
      stelleFilter == null || n.betreuungsstelle_id === stelleFilter;
    const offeneGefiltert = offene.filter(imFilter);
    const abgeschlosseneGefiltert = abgeschlossene.filter(imFilter);
    return {
      offene,
      abgeschlossene,
      offeneGefiltert,
      abgeschlosseneGefiltert,
      // Stellen, für die es Nachforderungen gibt — die Wahl des Filters.
      stellenMitBezug: [
        ...new Set(
          alle.flatMap((n) => (n.betreuungsstelle_id != null ? [n.betreuungsstelle_id] : [])),
        ),
      ],
      // Offen-Ansicht: nach Priorität (sofort→dringend→normal), dann angefordert_at absteigend.
      offeneSortiert: [...offeneGefiltert].sort((a, b) => {
        const rang = prioRang(a.prioritaet) - prioRang(b.prioritaet);
        return rang !== 0 ? rang : b.angefordert_at.localeCompare(a.angefordert_at);
      }),
      // Abgeschlossen-Ansicht: flach, neueste zuerst (nach Abschluss-Zeit).
      abgeschlosseneSortiert: [...abgeschlosseneGefiltert].sort((a, b) =>
        abschlussZeit(b).localeCompare(abschlussZeit(a)),
      ),
    };
  }, [nfQuery.data, stelleFilter]);
  const stand = useRef({ alle: nfQuery.data, statusMutation });
  useLayoutEffect(() => {
    stand.current = { alle: nfQuery.data, statusMutation };
  });
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

  /*
   * `?nachforderung=<id>` (D10, Sprung aus der Materialzeile): die Ansicht, in der sie steht, die
   * Karte hervorgehoben und einmal ins Bild gerollt; der Parameter wird geräumt
   * (`useQueryParamSelektion`). Eine unbekannte Kennung ändert nichts.
   */
  const [hervorgehobenId, setHervorgehobenId] = useState<number | null>(null);
  const [scrollZiel, setScrollZiel] = useState<number | null>(null);
  // Erst wenn auch der Einsatz da ist: vorher stehen statt der Karten nur der Ladekreis, und der
  // Bildlauf fände keine Karte, bis ein späterer Datenstand den Effekt erneut anstößt (Review).
  useQueryParamSelektion('nachforderung', nfQuery.isSuccess && einsatzQuery.isSuccess, (nfId) => {
    const n = nfQuery.data?.find((x) => x.id === nfId);
    if (!n) return;
    setAnsicht(
      istAbgeschlossen(NACHFORDERUNG_STATUS[n.status]?.phase ?? 'offen')
        ? 'abgeschlossen'
        : 'offen',
    );
    setHervorgehobenId(nfId);
    setScrollZiel(nfId);
  });
  useEffect(() => {
    if (scrollZiel == null) return;
    const karte = document.querySelector(`[data-nachforderung-id="${scrollZiel}"]`);
    if (!karte) return;
    karte.scrollIntoView?.({ block: 'center' });
    setScrollZiel(null);
  }, [scrollZiel, ansicht, nfQuery.data]);
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

  const ablehnenBestaetigen = () => {
    if (ablehnenId == null) return;
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
  const listenProps = {
    darfSchreiben,
    onStatus,
    onAblehnen,
    kartenFehler: kartenFehler.grund,
    materialJeId,
    materialGesperrt,
    onMaterialUebernehmen: freigabenBekannt ? onMaterialUebernehmen : undefined,
    hervorgehobenId,
    stellenJeId,
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
  /*
   * Nach einer Ablehnung lädt `onError` neu; die Karte kann dabei in die andere Ansicht wandern
   * (ein anderer Arbeitsplatz hat schon fortgeschaltet). Ihr Grund hätte dann keinen Ort mehr und
   * steht im Seitenhinweis, solange sie in der gezeigten Liste fehlt. Die Rücknahme geht vor.
   */
  const gezeigt = ansicht === 'offen' ? offeneSortiert : abgeschlosseneSortiert;
  const gewandertId = kartenFehler.gemeldet().find((nfId) => !gezeigt.some((n) => n.id === nfId));
  const gewandert = gewandertId != null ? kartenFehler.grund(gewandertId) : null;
  const gewandertName = nfQuery.data?.find((n) => n.id === gewandertId)?.bezeichnung;
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

      meta={`${offene.length} offen · ${abgeschlossene.length} abgeschlossen`}
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
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: token.marginSM,
          marginBottom: token.margin,
          alignItems: 'center',
        }}
      >
        <Segmentleiste
          beschriftung="Ansicht"
          wert={ansicht}
          onWechsel={setAnsicht}
          optionen={[
            { wert: 'offen', label: `Offen (${offeneGefiltert.length})` },
            {
              wert: 'abgeschlossen',
              label: `Abgeschlossen (${abgeschlosseneGefiltert.length})`,
            },
          ]}
        />
        {stellenOptionen.length > 0 && (
          <Select<number>
            aria-label="Für Stelle"
            allowClear
            placeholder="Für Stelle"
            style={{ minWidth: 200 }}
            value={stelleFilter ?? undefined}
            options={stellenOptionen}
            onChange={(id) => setzeStelleFilter(id ?? null)}
          />
        )}
      </div>
      {stelleFilter != null && (
        <div style={{ marginBottom: token.marginSM }}>
          <Filterhinweis
            merkmale={[filterName ? `Betreuungsstelle ${filterName}` : 'eine Betreuungsstelle']}
            onZuruecksetzen={() => setzeStelleFilter(null)}
          />
        </div>
      )}
      {ansicht === 'offen' ? (
        <NachforderungListe nachforderungen={offeneSortiert} ansicht="offen" {...listenProps} />
      ) : (
        <NachforderungListe
          nachforderungen={abgeschlosseneSortiert}
          ansicht="abgeschlossen"
          {...listenProps}
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
      <Modal
        open={ablehnenId != null}
        title="Nachforderung ablehnen"
        okText="Ablehnen"
        cancelText="Abbrechen"
        okButtonProps={{ danger: true }}
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
    </EinsatzSeite>
  );
}
