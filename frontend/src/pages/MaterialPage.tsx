import { Alert, App, Breadcrumb, Button, Form, Modal, Space, Tag, Typography } from 'antd';
import EinsatzSeite from '../components/EinsatzSeite';
import { Select } from '../components/Select';
import { BemerkungZelle } from '../components/BemerkungZelle';
import { ErfassungsModal } from '../components/Erfassung';
import { MengenFeld } from '../components/MengenFeld';
import Datensicht, {
  HERVORGEHOBEN,
  scrolleZurZeile,
  spaltenFuer,
  useSpalteAusgeblendet,
} from '../components/Datensicht';
import { useListenGedaechtnis, type GedaechtnisSpalte } from '../components/listenGedaechtnis';
import {
  nichtGefundenInhalt,
  SeitenFehler,
  SeitenSkeleton,
  SeitenStandVeraltet,
} from '../components/SeitenZustand';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ladeEinsatz, ladeModulFreigaben } from '../api/einsaetze';
import { listeNachforderungen } from '../api/nachforderungen';
import { KennungsLink } from '../components/kennungsLink';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { listeMaterial } from '../api/material';
import {
  updateDisposition,
  disponiereMaterial,
  listEinsatzMaterial,
  listEntlassenesMaterial,
  nimmAusDemEinsatz,
  reaktiviereDisposition,
  setzeMaterialStatus,
  storniereDisposition,
  type MaterialOrtPatch,
  type MaterialPatch,
} from '../api/einsatzMaterial';
import { MATERIAL_BEMERKUNG_MAX } from '../api/eingabegrenzen';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { EinsatzMaterial, MaterialArt, MaterialStatus } from '../api/types';
import { kraefteuebersichtPfad, nachforderungenPfad } from '../routing/deeplinks';
import { useQueryParamSelektion } from '../routing/useQueryParamSelektion';
import MaterialVerdichtung from '../kraefte/MaterialVerdichtung';
import MaterialOrtAngabe, {
  ortSuchText,
  useMaterialOrtKontext,
} from '../kraefte/MaterialOrtAngabe';
import { buildOrtGruppierung, buildOrtOptions, ortFilter } from '../kraefte/materialOrtWahl';
import { useMaterialOrt } from '../kraefte/useMaterialOrt';
import {
  AUFGEBRAUCHT,
  isAufgebraucht,
  materialDarstellung,
  materialStatusOptionen,
  materialStatusWahl,
  mengeText,
  OHNE_ORT_WERT,
  ortPostFields,
  ortText,
  ortVon,
  STUECK_IM_EINSATZ,
  stueckeImEinsatz,
  type MaterialOrtRef,
} from '../kraefte/materialPosten';
import MaterialAngabenModal from '../kraefte/MaterialAngabenModal';
import MaterialAufteilenModal from '../kraefte/MaterialAufteilenModal';
import MaterialAusgabeModal, { type AusgabeModus } from '../kraefte/MaterialAusgabeModal';
import MaterialMengeModal from '../kraefte/MaterialMengeModal';
import MaterialAdhocDialog from '../kraefte/MaterialAdhocDialog';
import { Segmentleiste } from '../components/instrument';
import type { MenueEintrag } from '../components/MenueAusloeser';
import StatusWahl, { type StatusOption } from '../components/StatusWahl';
import { materialStatus } from '../theme/statusFarben';
import DemoMarke from '../components/DemoMarke';
import { demoGroupedOptions, type AuswahlOption } from '../stammdaten/demoAuswahl';
import { useZeilenFehler } from '../components/useZeilenFehler';
import { useOptimistischesZeilenUpdate } from '../kraefte/useOptimistischesZeilenUpdate';
import { istKeyFreigegeben, modulName } from '../einsatz/modulRegistry';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import { MenueAusloeser } from '../components/MenueAusloeser';
import { zeigeRueckgaengig } from '../kommunikation/rueckgaengig';
import EntlassenBlock from '../kraefte/EntlassenBlock';
import { useNewGesture } from './einsatzabschnitte/useNewGesture';
import { nachforderungName } from '../nachforderungen/nachforderungName';

/**
 * Die Farbentscheidung für den Materialstatus liegt in `theme/statusFarben.ts` (`materialStatus`).
 * Diese Datei hält nur Reihenfolge und Filterwerte, abgeleitet aus der Vertragskarte — ein
 * Behandlungsweg für dieses Enum, gemeinsam mit `kraefte/MaterialAmOrt.tsx`.
 */
const STATUS_REIHENFOLGE = Object.keys(materialStatus) as MaterialStatus[];

/**
 * Menüwerte mit `darstellung` (`materialStatusWahl`, geteilt mit Material am Ort). Je Art nur die
 * erlaubten Status (LLH-1224 D3): ein Verbrauchsgut kennt „verbraucht“ und „Desinfektion nötig“
 * nicht, es wird ausgegeben.
 */
function statusOptionen(em: EinsatzMaterial): StatusOption<MaterialStatus>[] {
  return materialStatusWahl(em.art);
}

/** Gruppe und Filterwert eines Postens: aufgebraucht vor dem Status (LLH-1224 D15). */
type StatusGruppe = MaterialStatus | typeof AUFGEBRAUCHT;
function statusGruppe(em: EinsatzMaterial): StatusGruppe {
  return isAufgebraucht(em) ? AUFGEBRAUCHT : em.status;
}
const GRUPPEN_REIHENFOLGE: StatusGruppe[] = [...STATUS_REIHENFOLGE, AUFGEBRAUCHT];
function gruppenEtikett(w: string): string {
  return w === AUFGEBRAUCHT ? AUFGEBRAUCHT : (materialStatus[w as MaterialStatus]?.label ?? w);
}
/**
 * Bezeichnung mit Marken. Ist die Spalte „Kategorie“ ausgeblendet (unter `xxl` per Breite, oder von
 * Hand), steht die Kategorie gedämpft als zweite Zeile unter der Bezeichnung, damit sie auch am
 * Fükw zu lesen ist (LLH-1093); die Marken teilen diese Zeile, statt eine dritte zu öffnen. Im
 * Kartenzweig nicht: dort trägt nur die Suche sie (design.md D13).
 */
function BezeichnungZelle({
  em,
  herkunft,
}: {
  em: EinsatzMaterial;
  herkunft?: (nachforderungId: number) => ReactNode;
}) {
  const kategorieAusgeblendet = useSpalteAusgeblendet('kategorie');
  const marken = [
    em.ist_adhoc && <Tag key="adhoc">ad-hoc</Tag>,
    em.ist_demo && <DemoMarke key="demo" />,
  ];
  // Herkunft aus einer Nachforderung (LLH-1226 D11) als eigene Zeile darunter, auch im Kartenmodus.
  // Dort rendert der Kartentitel diese Zelle in einem fetten `<strong>` (einem Inline-Element):
  // deshalb ein Span als Block, im normalen Gewicht (Review).
  const bezug = em.nachforderung_id != null && herkunft && (
    <span data-lfh="material-herkunft" style={{ display: 'block', fontWeight: 'normal' }}>
      {herkunft(em.nachforderung_id)}
    </span>
  );
  if (kategorieAusgeblendet && em.kategorie) {
    return (
      <>
        <div>{em.bezeichnung}</div>
        <Space wrap>
          <Typography.Text type="secondary" style={{ overflowWrap: 'anywhere' }}>
            {em.kategorie}
          </Typography.Text>
          {marken}
        </Space>
        {bezug}
      </>
    );
  }
  // `wrap`: die Marken rutschen unter die Bezeichnung, statt die Spalte zu verbreitern.
  return (
    <>
      <Space wrap>
        {em.bezeichnung}
        {marken}
      </Space>
      {bezug}
    </>
  );
}

/**
 * Filterwerte auf der eigenen Materialachse (fünf Status und „aufgebraucht“), nicht auf der
 * Kräfte-Kategorie.
 */
const STATUS_FILTER_WERTE = GRUPPEN_REIHENFOLGE.map((s) => ({
  value: s,
  text: gruppenEtikett(s),
}));

type MaterialSpalteKey =
  'bezeichnung' | 'kategorie' | 'ort' | 'menge' | 'status' | 'traeger' | 'bemerkung' | 'aktionen';

/**
 * Was das Listengedächtnis beim Aufbau der Seite prüft (LLH-1096, Herleitung in `FahrzeugePage.tsx`):
 * feste Achsen mit ihren Werten; Kategorie, Ort und Träger nehmen ihre Werte aus den Zeilen und den
 * Namen der Orte (`ausDaten`). Muss zu `spalten` passen.
 */
const GEDAECHTNIS_SPALTEN: readonly GedaechtnisSpalte[] = [
  { key: 'bezeichnung', sortWert: true },
  { key: 'menge', sortWert: true },
  { key: 'status', sortWert: true, filter: { werte: STATUS_FILTER_WERTE } },
];
const GEDAECHTNIS_AUS_DATEN: readonly MaterialSpalteKey[] = ['kategorie', 'ort', 'traeger'];

/** Werte des Disponier-Dialogs für Stamm-Material. Der Ort steht außerhalb der Werte (D7). */
interface StammDisposition {
  material_id: number;
  menge: number;
}

/** Gruppierung der Liste (LLH-1225 D4): Vorgabe Ort, die Frage des Tickets ist „was ist wo“. */
type Gruppierung = 'ort' | 'status';
const GRUPPIERUNG_OPTIONEN = [
  { wert: 'ort', label: 'Nach Ort' },
  { wert: 'status', label: 'Nach Status' },
] as const satisfies readonly { wert: Gruppierung; label: string }[];

export default function MaterialPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  /**
   * Sortierung, Kopffilter und Suche stehen in der Adresse (LLH-1096, Muster der Schadenliste); der
   * Hook gehört der Seite und steht vor jedem frühen Ausstieg.
   */
  const gedaechtnis = useListenGedaechtnis<MaterialSpalteKey>('material', GEDAECHTNIS_SPALTEN, {
    vorgabe: { spalte: 'bezeichnung', richtung: 'auf' },
    einsatzId,
    ausDaten: GEDAECHTNIS_AUS_DATEN,
  });
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [adhocOffen, setAdhocOffen] = useState(false);
  const [disponierenOffen, setDisponierenOffen] = useState(false);
  const [stammForm] = Form.useForm<StammDisposition>();
  /**
   * Ort des Stamm-Dialogs (D7) außerhalb der Formularwerte: er bleibt im Serienlauf stehen, weil
   * eine Anlieferung an einen Ort geht, und fällt erst auf dem Weg hinaus (Fertig, Abbrechen).
   */
  const [stammOrt, setStammOrt] = useState<string>(OHNE_ORT_WERT);
  /** Gruppierung je Einsatz (D4): ein Einsatzwechsel nimmt die Wahl nicht mit. */
  const [gruppierungWahl, setGruppierungWahl] = useState<{ einsatzId: number; wert: Gruppierung }>({
    einsatzId,
    wert: 'ort',
  });
  const gruppierung = gruppierungWahl.einsatzId === einsatzId ? gruppierungWahl.wert : 'ort';
  /** Offene Rückfrage „Stornieren“ (LLH-1079): als `<Modal>` außerhalb der Zeilen-`map`. */
  const [stornoFuer, setStornoFuer] = useState<{ id: number; name: string } | null>(null);
  const isNewGestureStorno = useNewGesture(stornoFuer !== null);
  /** Offene Dialoge „Angaben ändern“ und „Aufteilen“ (LLH-1093), je mit der Disposition. */
  // Der Posten beim Öffnen, nicht nur seine ID: entfällt die Zeile live (anderer Platz storniert,
  // nimmt heraus), bleibt der Dialog offen und die Ablehnung steht an ihm (`frontend/AGENTS.md`,
  // „Rückwege und Fehler“). Solange die Zeile da ist, gilt ihr aktueller Stand.
  const [angabenFuer, setAngabenFuer] = useState<EinsatzMaterial | null>(null);
  const [aufteilenFuer, setAufteilenFuer] = useState<EinsatzMaterial | null>(null);
  /** Offene Dialoge „Ausgeben“/„Ausgabe zurücknehmen …“ und „Menge ändern …“ (LLH-1225 D5). */
  const [ausgabeFuer, setAusgabeFuer] = useState<{
    posten: EinsatzMaterial;
    modus: AusgabeModus;
  } | null>(null);
  const [mengeFuer, setMengeFuer] = useState<EinsatzMaterial | null>(null);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const emQuery = useQuery({
    queryKey: einsatzKeys.material(einsatzId),
    queryFn: () => listEinsatzMaterial(einsatzId),
  });
  // Aus dem Einsatz genommenes Material (LLH-1079 Teil II): getrennt geliefert, die Liste kennt es
  // nicht. Auf dem Draht heißt der Endzustand `entlassen`.
  const entlasseneQuery = useQuery({
    queryKey: einsatzKeys.materialEntlassene(einsatzId),
    queryFn: () => listEntlassenesMaterial(einsatzId),
  });
  const poolQuery = useQuery({
    queryKey: globalKeys.materialListe('im-dienst'),
    queryFn: () => listeMaterial(true),
  });
  /**
   * `?material=<id>` ist Zeilenmarke (LLH-1260, Sprung aus der Nachforderung): der Posten wird
   * hervorgehoben und ins Bild gerollt (best-effort). Die Gruppen der Liste klappen nicht zu, die
   * Zeile steht also immer da. Ein herausgenommener Posten steht nicht in der Liste und markiert
   * nichts.
   */
  const [highlightId, setHighlightId] = useState<number | null>(null);
  useQueryParamSelektion('material', emQuery.isSuccess, (mid) => {
    if ((emQuery.data ?? []).some((m) => m.id === mid)) setHighlightId(mid);
  });
  useEffect(() => {
    if (highlightId == null) return;
    scrolleZurZeile(highlightId);
  }, [highlightId]);
  /*
   * Herkunft aus einer Nachforderung (LLH-1226 D8/D11): der Posten trägt nur die Kennung, den Namen
   * löst die Liste der Nachforderungen auf — nur bei bedienbarem Modul (`istKeyFreigegeben` gibt
   * Unbekanntes nicht frei, Muster `VerpflegungPage`) und nur, wenn ein Posten eine trägt. Ein 403
   * bleibt still: dann „aus Nachforderung #4“ ohne Link.
   */
  const freigabenQuery = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
  });
  const nachforderungenFrei = istKeyFreigegeben('nachforderungen', freigabenQuery.data);
  const hasHerkunft = (emQuery.data ?? []).some((m) => m.nachforderung_id != null);
  const nachforderungenQuery = useQuery({
    // Derselbe Schlüssel und Abruf wie `NachforderungenPage` — ein Cache-Fach, live.
    queryKey: einsatzKeys.nachforderungen(einsatzId),
    queryFn: () => listeNachforderungen(einsatzId, {}),
    enabled: nachforderungenFrei && hasHerkunft,
  });
  const nachforderungNamen = useMemo(
    () =>
      nachforderungenFrei && !nachforderungenQuery.isError
        ? new Map((nachforderungenQuery.data ?? []).map((n) => [n.id, nachforderungName(n)]))
        : new Map<number, string>(),
    [nachforderungenFrei, nachforderungenQuery.isError, nachforderungenQuery.data],
  );
  /**
   * Der Verweis: mit lesbarer Nachforderung als Link, sonst die Kennung als Text (Muster
   * Verpflegung). Zwei Zeilen mit Auslassung (Muster `KraefteuebersichtPage`): die Spalte
   * „Bezeichnung“ steht fest und ist am Tablet gut 110 px schmal, ein langer Bedarf machte die Zeile
   * sonst sieben Zeilen hoch (Prüfliste LLH-1226). Der Volltext steht im `title`.
   */
  const herkunft = (nfId: number): ReactNode => {
    const name = nachforderungNamen.get(nfId);
    const text = `aus Nachforderung: ${name}`;
    return name != null ? (
      <KennungsLink to={nachforderungenPfad(einsatzId, { nachforderung: nfId })} title={text}>
        <span
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {text}
        </span>
      </KennungsLink>
    ) : (
      <Typography.Text type="secondary">aus Nachforderung #{nfId}</Typography.Text>
    );
  };
  // Ein Gerät steht je Stück im Einsatz (LLH-1224 D2): ist eines gewählt, steht die Menge fest
  // auf 1 und das Feld ist gesperrt; der Server lehnte jede andere Menge ab.
  const gewaehltesMaterial = Form.useWatch('material_id', stammForm);
  const isGeraetGewaehlt =
    poolQuery.data?.find((m) => m.id === gewaehltesMaterial)?.art === 'geraet';
  useEffect(() => {
    if (isGeraetGewaehlt) stammForm.setFieldValue('menge', 1);
  }, [isGeraetGewaehlt, stammForm]);

  /**
   * Liefert die Zusage des Listenabgleichs: eine `InlineAngabe` schließt erst, wenn der neue Wert im
   * Cache steht (`onSuccess` gibt sie an `mutateAsync` weiter).
   */
  function invalidate() {
    void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
    return qc.invalidateQueries({ queryKey: einsatzKeys.material(einsatzId) });
  }
  // Ablehnungen an der Zeile, je Disposition gemerkt; alle Zeilenaktionen teilen den Speicher, die
  // zuletzt begonnene zählt (`frontend/AGENTS.md`, „Rückwege und Fehler“, LFH-1077). Die Dialoge
  // zeigen ihren Fehler über `speicherung` selbst.
  const zeilen = useZeilenFehler<number>();
  // Die Orte für Spalte, Gruppierung und Dialoge; ohne Schreibrecht nur zum Lesen der Namen. Das
  // Schreibrecht hängt am Einsatz, der hier noch laden kann: bis dahin bedient keine Angabe.
  const { kontext: ortKontext, einheitFolge } = useMaterialOrtKontext(
    einsatzId,
    einsatzQuery.data != null && darfImEinsatzSchreiben(einsatzQuery.data),
    emQuery.data,
  );
  // Der eine Schreibweg eines Orts (D2): derselbe PATCH aus jeder Ansicht.
  const { setOrt, teileAufNach } = useMaterialOrt(einsatzId);

  const disponiereMutation = useMutation({
    mutationFn: (v: { materialId: number; menge: number; ort?: MaterialOrtPatch }) =>
      disponiereMaterial(einsatzId, v.materialId, v.menge, { ort: v.ort }),
    // Schließen und Leeren gehören der Erfassungshülle (`onFertig`).
    onSuccess: () => {
      message.success('Material disponiert');
      invalidate();
    },
  });
  // Menge und Ausgabe in ihren Dialogen (D5); die Einheit zeigt Menge und Rest ihres Materials mit.
  const mengeMutation = useMutation({
    mutationFn: (v: { emId: number; menge: number }) =>
      updateDisposition(einsatzId, v.emId, { menge: v.menge }),
    onSuccess: () => {
      message.success('Menge gespeichert');
      void qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
      return invalidate();
    },
  });
  const ausgabeMutation = useMutation({
    mutationFn: (v: {
      emId: number;
      name: string;
      ausgegeben: number;
      menge: number;
      modus: AusgabeModus;
    }) => updateDisposition(einsatzId, v.emId, { ausgegeben: v.ausgegeben }),
    onSuccess: (_, v) => {
      message.success(
        `${v.name}: ${v.menge} ${v.modus === 'ausgeben' ? 'ausgegeben' : 'zurückgenommen'}`,
      );
      void qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
      return invalidate();
    },
  });
  // Die Dialoge zeigen ihre Ablehnung über `speicherung` selbst.
  const angabenMutation = useMutation({
    mutationFn: (v: { emId: number; patch: MaterialPatch }) =>
      updateDisposition(einsatzId, v.emId, v.patch),
    onSuccess: (_, v) => {
      message.success('Angaben gespeichert');
      if (v.patch.bezeichnung !== undefined) {
        void qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
      }
      return invalidate();
    },
  });
  // Art wechseln (D6) ohne Rückfrage, umkehrbar; eine Ablehnung (422) steht an der Zeile.
  const artMutation = useMutation({
    mutationFn: (v: { emId: number; art: MaterialArt }) =>
      updateDisposition(einsatzId, v.emId, { art: v.art }),
    onMutate: (v) => zeilen.beginne(v.emId),
    onSuccess: () => {
      message.success('Art gespeichert');
      // Die Einheit zeigt Art und Menge ihres Materials mit.
      void qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
      return invalidate();
    },
    onError: (e, v) => zeilen.melde(v.emId, e, 'Art nicht geändert'),
  });
  // Aufteilen mit dem Ort des abgeteilten Teils über den einen Schreibweg (t1hvaqzu, design.md
  // D5): er gleicht Material, alten und neuen Ort ab.
  const aufteilenMutation = useMutation({
    mutationFn: (v: { em: EinsatzMaterial; menge: number; ziel: MaterialOrtRef | null }) =>
      teileAufNach(v.em, v.menge, v.ziel),
    onSuccess: () => {
      message.success('Aufgeteilt');
      return invalidate();
    },
  });
  const statusMutation = useOptimistischesZeilenUpdate<
    EinsatzMaterial,
    { emId: number; status: MaterialStatus }
  >({
    queryKey: einsatzKeys.material(einsatzId),
    mutationFn: (v) => setzeMaterialStatus(einsatzId, v.emId, v.status),
    zeilenId: (v) => v.emId,
    anwenden: (em, v) => ({ ...em, status: v.status }),
    nochOptimistisch: (em, v) => em.status === v.status,
    zuruecknehmen: (em, vorher) => ({ ...em, status: vorher.status }),
    onBeginn: (v) => zeilen.beginne(v.emId),
    onFehler: (e, v) => zeilen.melde(v.emId, e, 'Status nicht geändert'),
    onSettled: invalidate,
  });
  const bemerkungMutation = useMutation({
    mutationFn: (v: { emId: number; bemerkung: string }) =>
      updateDisposition(einsatzId, v.emId, { bemerkung: v.bemerkung }),
    onMutate: (v) => zeilen.beginne(v.emId),
    onSuccess: invalidate,
    onError: (e, v) => zeilen.melde(v.emId, e, 'Bemerkung nicht gespeichert'),
  });
  /*
   * Erneut disponieren (LLH-1079) hat zwei Wege mit je eigenem Fehlerort (`frontend/AGENTS.md`,
   * „Rückwege und Fehler“): die Aktion im Block meldet an ihrem Eintrag, Rückgängig aus dem Toast
   * im Seitenhinweis — die Zeile ist dann weg, der Block meist eingeklappt.
   */
  const reaktivierenMutation = useMutation({
    mutationFn: (emId: number) => reaktiviereDisposition(einsatzId, emId),
    onMutate: (emId) => zeilen.beginne(emId),
    onSuccess: () => void invalidate(),
    onError: (e, emId) => zeilen.melde(emId, e, 'Nicht erneut disponiert'),
  });
  const [rueckgaengigFehler, setRueckgaengigFehler] = useState<unknown>(null);
  // Die nächste Rücknahme aus dem Toast räumt den Grund der vorigen.
  const rueckgaengigMutation = useMutation({
    mutationFn: (emId: number) => reaktiviereDisposition(einsatzId, emId),
    onMutate: () => setRueckgaengigFehler(null),
    onSuccess: invalidate,
    onError: (e) => {
      setRueckgaengigFehler(e);
      invalidate();
    },
  });
  // Aus dem Einsatz nehmen ist umkehrbar: keine Rückfrage, sondern ein Rückgängig-Toast
  // (`frontend/AGENTS.md`, „Destruktiv ist nicht gleich destruktiv“, design.md D8). Rückgängig
  // setzt Einheit und UHS nicht wieder. Die Einheit verliert ein Mitglied: ihre Liste mit.
  const herausnehmenMutation = useMutation({
    mutationFn: (v: { emId: number; name: string }) => nimmAusDemEinsatz(einsatzId, v.emId),
    onMutate: (v) => zeilen.beginne(v.emId),
    onSuccess: (_, v) => {
      invalidate();
      qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
      zeigeRueckgaengig(message, `${v.name} aus dem Einsatz genommen`, () =>
        rueckgaengigMutation.mutate(v.emId),
      );
    },
    onError: (e, v) => zeilen.melde(v.emId, e, 'Nicht aus dem Einsatz genommen'),
  });
  // Stornieren ist unumkehrbar und nur kurz nach einer Fehldisposition möglich; der Server nennt
  // den Grund einer Ablehnung, er steht an der Zeile.
  const stornierenMutation = useMutation({
    mutationFn: (emId: number) => storniereDisposition(einsatzId, emId),
    onMutate: (emId) => zeilen.beginne(emId),
    onSuccess: invalidate,
    onError: (e, emId) => zeilen.melde(emId, e, 'Nicht storniert'),
  });

  // Seitenzustand: nur `einsatzQuery` — ohne sie tragen weder Breadcrumb noch
  // `darfImEinsatzSchreiben` etwas. Alles andere wird an Ort und Stelle entschieden, nie als
  // Frühausstieg.
  if (einsatzQuery.isLoading) {
    return <SeitenSkeleton />;
  }
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

  const ems = emQuery.data ?? [];
  const entlassene = entlasseneQuery.data ?? [];
  /** Läuft für diese Zeile eine Handlung aus Knopf oder Menü? Dann keine zweite. */
  const isZeileBusy = (emId: number) =>
    (herausnehmenMutation.isPending && herausnehmenMutation.variables?.emId === emId) ||
    (aufteilenMutation.isPending && aufteilenMutation.variables?.em.id === emId) ||
    (artMutation.isPending && artMutation.variables?.emId === emId) ||
    (stornierenMutation.isPending && stornierenMutation.variables === emId);
  /**
   * Zeilenmenü nach Art (LLH-1225 D6, Spec `material-liste`, „Zeilenaktionen“). Verbrauchsgut:
   * „Menge ändern …“, „Ausgabe zurücknehmen …“, „Aufteilen …“, „Als Gerät führen“, „Angaben
   * ändern …“; Gerät: „Als Verbrauchsgut führen“, „Angaben ändern …“; hinter dem Trenner rot
   * „Stornieren“. Was es für die Art nicht gibt, fehlt; was es gibt, aber gerade nicht geht, steht
   * gesperrt mit dem Grund im Etikett — ein Etikett ist nur Text, ein Tooltip erscheint am
   * Touchschirm nicht. Die Art wechseln nur Ad-hoc-Posten: ein Stamm-Posten trägt die Art seines
   * Stamms (LLH-1224, Nachtrag Review).
   */
  const menueEintraege = (em: EinsatzMaterial): MenueEintrag[] => {
    const eintraege: MenueEintrag[] = [];
    const rest = em.menge - em.ausgegeben;
    if (em.art === 'verbrauchsgut') {
      eintraege.push({ key: 'menge', label: 'Menge ändern …' });
      eintraege.push(
        em.ausgegeben > 0
          ? { key: 'zuruecknehmen', label: 'Ausgabe zurücknehmen …' }
          : {
              key: 'zuruecknehmen',
              label: 'Ausgabe zurücknehmen · nichts ausgegeben',
              gesperrt: true,
            },
      );
      // Abgeteilt wird nur aus dem Rest, die Ausgangszeile behält eins (LLH-1224 D14).
      eintraege.push(
        Math.min(em.menge - 1, rest) >= 1
          ? { key: 'aufteilen', label: 'Aufteilen …' }
          : rest <= 0
            ? { key: 'aufteilen', label: `Aufteilen · ${AUFGEBRAUCHT}`, gesperrt: true }
            : { key: 'aufteilen', label: 'Aufteilen · Rest 1', gesperrt: true },
      );
      // Zum Gerät nur mit Menge 1 ohne Ausgabe (LLH-1224 D2/D10, der Server prüft dasselbe).
      if (em.ist_adhoc) {
        eintraege.push(
          em.menge > 1
            ? { key: 'art', label: 'Als Gerät führen · Menge über 1', gesperrt: true }
            : em.ausgegeben > 0
              ? { key: 'art', label: 'Als Gerät führen · Ausgabe gebucht', gesperrt: true }
              : { key: 'art', label: 'Als Gerät führen' },
        );
      }
    } else if (em.ist_adhoc) {
      // Zum Verbrauchsgut nicht mit einem Status, den nur ein Gerät kennt (LLH-1224 D3).
      eintraege.push(
        materialStatusOptionen('verbrauchsgut').includes(em.status)
          ? { key: 'art', label: 'Als Verbrauchsgut führen' }
          : {
              key: 'art',
              label: `Als Verbrauchsgut führen · Status ${materialStatus[em.status].label}`,
              gesperrt: true,
            },
      );
    }
    eintraege.push(
      em.ist_adhoc
        ? { key: 'angaben', label: 'Angaben ändern …' }
        : { key: 'angaben', label: 'Angaben ändern · im Stamm pflegen', gesperrt: true },
    );
    // Der Server lehnt das Stornieren eines Postens mit Ort sicher ab (Spec `material-liste`,
    // „Zeilenaktionen“); Frist und frühere Herausnahme prüft weiter er.
    eintraege.push(
      ortVon(em) != null
        ? { key: 'stornieren', label: 'Stornieren · zugeordnet', gefahr: true, gesperrt: true }
        : { key: 'stornieren', label: 'Stornieren', gefahr: true },
    );
    return eintraege;
  };
  const openAusgabe = (em: EinsatzMaterial, modus: AusgabeModus) => {
    ausgabeMutation.reset();
    setAusgabeFuer({ posten: em, modus });
  };
  const handleAktion = (key: string, em: EinsatzMaterial) => {
    if (key === 'angaben') {
      angabenMutation.reset();
      setAngabenFuer(em);
    } else if (key === 'menge') {
      mengeMutation.reset();
      setMengeFuer(em);
    } else if (key === 'zuruecknehmen') {
      openAusgabe(em, 'zuruecknehmen');
    } else if (key === 'art') {
      artMutation.mutate({ emId: em.id, art: em.art === 'geraet' ? 'verbrauchsgut' : 'geraet' });
    } else if (key === 'aufteilen') {
      aufteilenMutation.reset();
      setAufteilenFuer(em);
    } else if (key === 'stornieren') setStornoFuer({ id: em.id, name: em.bezeichnung });
  };
  const angabenPosten = angabenFuer
    ? (ems.find((em) => em.id === angabenFuer.id) ?? angabenFuer)
    : null;
  const aufteilenPosten = aufteilenFuer
    ? (ems.find((em) => em.id === aufteilenFuer.id) ?? aufteilenFuer)
    : null;
  // Das Feld „Ort“ des Dialogs: dasselbe Angebot wie die Spalte, der Ort des Postens vorn.
  const aufteilenOrt = aufteilenPosten ? ortVon(aufteilenPosten) : null;
  const aufteilenOrtOptionen = buildOrtOptions(ortKontext.quellen, {
    ort: aufteilenOrt,
    text: ortText(aufteilenOrt, ortKontext.namen),
  });
  const ausgabePosten = ausgabeFuer
    ? (ems.find((em) => em.id === ausgabeFuer.posten.id) ?? ausgabeFuer.posten)
    : null;
  const mengePosten = mengeFuer ? (ems.find((em) => em.id === mengeFuer.id) ?? mengeFuer) : null;

  /**
   * Gemeinsamer Bedienweg für Tabellen- und Kartenzweig (Herleitung in `FahrzeugePage.tsx`). Ohne
   * `farbe`: `materialStatus` kennt keine Mandantenfarbe (nur `rolle` + `label`).
   */
  const statusBedienungVon = (em: EinsatzMaterial) => {
    const laeuft = statusMutation.isPending && statusMutation.variables?.emId === em.id;
    return {
      optionen: statusOptionen(em),
      aktuell: laeuft ? statusMutation.variables?.status : em.status,
      kennung: em.bezeichnung,
      laeuft,
      gesperrt: statusMutation.isPending,
      onWaehlen: (wert: string | number) => {
        if (!statusMutation.isPending) {
          statusMutation.mutate({ emId: em.id, status: wert as MaterialStatus });
        }
      },
    };
  };

  /**
   * Listenzustand — der Fehler allein reicht als Bedingung nicht. Ohne Zeilen im Zwischenspeicher
   * tritt der Fehler an die Stelle der Datensicht, sonst behauptete „Noch kein Material disponiert"
   * eine leere Disposition. Mit Zeilen bleiben sie stehen und bekommen ein Banner: echt, nur
   * womöglich alt.
   *
   * Gemessen an `ems`, der ungefilterten Menge: Suche und Filter leben im Primitiv; an ihrer
   * Restmenge gemessen kippte die Seite bei jedem engen Filter in den Fehlerzweig.
   */
  const listeGescheitert = emQuery.isError && ems.length === 0;
  const standVeraltet = emQuery.isError && ems.length > 0;

  // Kein Dedup wie bei Fahrzeugen: dieselbe Material-Art darf mehrfach als getrennte Position
  // disponiert werden (Mengen-Splitting auf Einheiten). Ausnahme ist ein Gerät mit Bestandsnummer,
  // ein bestimmtes Stück (LLH-1256): steht es schon aktiv im Einsatz, bleibt es sichtbar, ist aber
  // gesperrt und nennt den Grund — der Server lehnte es mit 409 ab.
  // LFH-733: Demo-Stammdaten bleiben wählbar, stehen aber als Gruppe hinter den echten.
  const imEinsatz = stueckeImEinsatz(poolQuery.data ?? [], ems);
  const sperre = (o: AuswahlOption) => (imEinsatz.has(o.value) ? { ...o, disabled: true } : o);
  const poolOptionen = demoGroupedOptions(
    poolQuery.data ?? [],
    (m) =>
      `${m.bezeichnung}${m.kategorie ? ` (${m.kategorie})` : ''}${
        imEinsatz.has(m.id) ? ` · ${STUECK_IM_EINSATZ}` : ''
      }`,
  ).map((e) => ('options' in e ? { ...e, options: e.options.map(sperre) } : sperre(e)));

  /**
   * Was ein leeres Auswahlfeld bedeutet, hängt daran, ob die Liste ankam. Scheitert der Abruf,
   * bleibt `poolOptionen` leer, und das Feld behauptete „Kein Material im Dienst". Ohne Fehler
   * bleibt der Bestandswortlaut.
   *
   * Kein `kein403`: die Material-Route ist org-lesbar ohne Admin-Schranke.
   */
  const poolInhalt =
    nichtGefundenInhalt(poolQuery, {
      allgemein: 'Materialliste konnte nicht geladen werden',
    }) ?? 'Kein Material im Dienst';

  /**
   * Kategoriefilter aus den eigenen Daten; `undefined` ohne Werte. Das Feld erscheint erst mit dem
   * ersten gepflegten Wert — ein dauerhaft leeres Filterfeld sieht wie ein Werkzeug aus und ist
   * keins.
   */
  const kategorieWerte = [...new Set(ems.map((m) => m.kategorie).filter((k): k is string => !!k))]
    .sort()
    .map((k) => ({ text: k, value: k }));
  const kategorieFilter =
    kategorieWerte.length > 0
      ? { werte: kategorieWerte, trifft: (m: EinsatzMaterial, w: string) => m.kategorie === w }
      : undefined;
  // Trägerfilter nach demselben Muster (LLH-1096): ohne gepflegten Träger kein Filterfeld.
  const traegerWerte = [
    ...new Set(ems.map((m) => m.traegerorganisation).filter((t): t is string => !!t)),
  ]
    .sort((a, b) => a.localeCompare(b, 'de', { numeric: true }))
    .map((t) => ({ text: t, value: t }));
  const traegerFilter =
    traegerWerte.length > 0
      ? {
          werte: traegerWerte,
          trifft: (m: EinsatzMaterial, w: string) => m.traegerorganisation === w,
        }
      : undefined;

  /**
   * Spaltenregister der Materialseite. `EinsatzMaterialAnzeige` hat kein `status_kategorie`;
   * gruppiert und gefiltert wird auf der eigenen Fünf-Werte-Achse (`MaterialStatus`), dieselbe
   * Grenze wie in `filtereKraefte`.
   *
   * ── Gemessen gegen den Fükw (LLH-1093, Prüfliste; LLH-1225) ──
   *
   * Mit der Spalte „Ort“ wuchs die Tabelle inhaltsgetrieben auf 1326 px; am Fükw (1050 px Inhalt
   * bei 1366) lag „Aus dem Einsatz nehmen“ außerhalb des Bilds. Jetzt FLIESST der Ort
   * (`mindestBreite`, LFH-523): sein Name bricht an Wortgrenzen um. Alle übrigen tragen eine
   * Zahlbreite; die Aktionsspalte trägt Knopf, Abstand und Menü (226 px Inhalt in `kompakt`). Die
   * Menge trägt „30 von 50 übrig“ und darunter „Ausgeben“ (LLH-1225 D5). Die Kategorie weicht
   * unter `xxl` (wie Typ, Kennzeichen und Träger der Fahrzeugseite), sonst blieben dem Ort bei
   * 1366 nur 125 px und die Namen brächen Silbe für Silbe. Wer eine Breite ändert, misst neu.
   */
  const spalten = spaltenFuer<EinsatzMaterial>()([
    {
      title: 'Bezeichnung',
      key: 'bezeichnung',
      immerSichtbar: true,
      width: 170,
      sortWert: (m) => m.bezeichnung,
      suchText: (m) => m.bezeichnung,
      render: (_, em) => <BezeichnungZelle em={em} herkunft={herkunft} />,
    },
    {
      title: 'Kategorie',
      dataIndex: 'kategorie',
      key: 'kategorie',
      width: 100,
      // Lesend, darf weichen: unter `xxl` als zweite Zeile der Bezeichnung (`BezeichnungZelle`),
      // über den Spaltenschalter, im Zähler und in der Suche.
      abBreite: 'xxl',
      sortWert: (m) => m.kategorie,
      filter: kategorieFilter,
      suchText: (m) => m.kategorie,
      render: (t) => t ?? '—',
    },
    {
      // Der EINE Ort (LLH-1225 D3): eine Angabe mit ausdrücklichem Speichern über den einen
      // Schreibweg (D2); Filter „ohne Ort“, je Einheit, je Fahrzeug, je UHS, je
      // Bereitstellungsraum (Spec `material-liste`). Kein eigener Abschnittsfilter (LLH-1096): ein
      // Abschnitt hieße nur an Einheit und Fahrzeug etwas, nicht an UHS, Bereitstellungsraum oder
      // „ohne Ort“; die Ortsachse ist die Frage dieser Liste („was ist wo“).
      title: 'Ort',
      key: 'ort',
      mindestBreite: 170,
      filter: ortFilter(ems, ortKontext.namen),
      sortWert: (m) => ortSuchText(m, ortKontext),
      suchText: (m) => ortSuchText(m, ortKontext),
      render: (_, em) => (
        <MaterialOrtAngabe
          kennung={em.bezeichnung}
          ort={ortVon(em)}
          kontext={ortKontext}
          darfSchreiben={darfSchreiben}
          onSpeichern={(ziel) => setOrt(em, ziel)}
        />
      ),
    },
    {
      // Die Menge ist ein Wert ohne Feld in der Zeile (LLH-1093 D9: ein Wisch auf dem Tablet
      // schriebe sonst die Menge); die Gesamtmenge ändert „Menge ändern …“ im Menü (LLH-1225 D5).
      // Ein Gerät steht je Stück: „1“ ohne Bedienung. Ein Verbrauchsgut zeigt den Rest („30 von 50
      // übrig“) und, solange einer bleibt, „Ausgeben“ — die häufigste Handlung am Verbrauchsgut,
      // auch auf der Karte (Sekundärfeld aus dieser Zelle).
      title: 'Menge',
      key: 'menge',
      width: 130,
      sortWert: (m) => m.menge,
      render: (_, em) => (
        <span
          style={{
            display: 'inline-flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            columnGap: 12,
            rowGap: 4,
          }}
        >
          {/* Eine Zahl bricht nicht um: im Kartenfeld stand „50“ sonst als „5“ über „0“. */}
          <span style={{ whiteSpace: 'nowrap' }}>{mengeText(em)}</span>
          {darfSchreiben && em.art === 'verbrauchsgut' && em.ausgegeben < em.menge && (
            <Button
              aria-label={`${em.bezeichnung} ausgeben`}
              disabled={isZeileBusy(em.id)}
              onClick={() => openAusgabe(em, 'ausgeben')}
            >
              Ausgeben
            </Button>
          )}
        </span>
      ),
    },
    {
      title: 'Status',
      key: 'status',
      width: 120,
      filter: { werte: STATUS_FILTER_WERTE, trifft: (m, w) => statusGruppe(m) === w },
      // In der Folge der Gruppen (Status, dann „aufgebraucht“), nicht nach dem Wort.
      sortWert: (m) => GRUPPEN_REIHENFOLGE.indexOf(statusGruppe(m)),
      // Kein `Select` mit Mindestbreite (die 390-px-Karte scheiterte daran). Deskriptor ganz
      // gespreizt — Herleitung in `FahrzeugePage.tsx`.
      render: (_, em) => (
        <StatusWahl
          darstellung={materialDarstellung(em)}
          darfSchreiben={darfSchreiben}
          {...statusBedienungVon(em)}
        />
      ),
    },
    {
      // Lesend und erst ab `xxl` wie die Kategorie (LLH-1096): am Fükw bliebe dem Ort sonst kein
      // Platz. Über den Spaltenschalter zurückzuholen, dann mit Filter.
      title: 'Träger',
      dataIndex: 'traegerorganisation',
      key: 'traeger',
      width: 140,
      abBreite: 'xxl',
      sortWert: (m) => m.traegerorganisation,
      filter: traegerFilter,
      render: (t) => t ?? '—',
    },
    {
      // Weder Sortierung noch Filter (LLH-1096): eine Notiz in Freitext ist kein Vergleichswert.
      title: 'Bemerkung',
      key: 'bemerkung',
      width: 160,
      render: (_, em) => (
        <BemerkungZelle
          wert={em.bemerkung}
          kennung={em.bezeichnung}
          darfSchreiben={darfSchreiben}
          max={MATERIAL_BEMERKUNG_MAX}
          // Die Zusage lässt die Zelle bis zur Antwort offen (`BemerkungZelle`, LFH-1077).
          onSpeichern={(val) => bemerkungMutation.mutateAsync({ emId: em.id, bemerkung: val })}
        />
      ),
    },
    ...(darfSchreiben
      ? [
          {
            title: 'Aktionen',
            key: 'aktionen' as const,
            width: 250,
            immerSichtbar: true,
            // Herausnehmen ist umkehrbar: `danger` mit Abstand, keine Rückfrage; Angaben ändern,
            // Aufteilen und Stornieren stehen im Zeilenmenü, Stornieren fragt nach (LLH-1079 D8,
            // LLH-1093 D11, wie die Fahrzeugseite).
            render: (_: unknown, em: EinsatzMaterial) => (
              <Space size="middle">
                <Button
                  danger
                  loading={
                    herausnehmenMutation.isPending && herausnehmenMutation.variables?.emId === em.id
                  }
                  disabled={isZeileBusy(em.id)}
                  aria-label={`${em.bezeichnung} aus dem Einsatz nehmen`}
                  onClick={() => herausnehmenMutation.mutate({ emId: em.id, name: em.bezeichnung })}
                >
                  Aus dem Einsatz nehmen
                </Button>
                <MenueAusloeser
                  eintraege={menueEintraege(em)}
                  zugaenglicherName={`Weitere Aktionen zu ${em.bezeichnung}`}
                  gesperrt={isZeileBusy(em.id)}
                  laeuft={
                    (stornierenMutation.isPending && stornierenMutation.variables === em.id) ||
                    (aufteilenMutation.isPending && aufteilenMutation.variables?.em.id === em.id) ||
                    (artMutation.isPending && artMutation.variables?.emId === em.id)
                  }
                  onWahl={(key) => handleAktion(key, em)}
                />
              </Space>
            ),
          },
        ]
      : []),
  ]);

  return (
    <EinsatzSeite
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: modulName('material') },
          ]}
        />
      }
      titel={modulName('material')}
      // Die Gesamtzahl steht einmal, hier; die Verdichtung über der Liste teilt sie auf (D10).
      meta={emQuery.isSuccess ? `${ems.length} Posten` : undefined}
      dataUpdatedAt={emQuery.dataUpdatedAt}
      hinweis={
        (!darfSchreiben && einsatz.status !== 'aktiv') || rueckgaengigFehler != null ? (
          <Space orientation="vertical" style={{ width: '100%' }}>
            {!darfSchreiben && einsatz.status !== 'aktiv' && (
              <Alert type="info" showIcon title="Einsatz ist abgeschlossen — nur Ansicht." />
            )}
            <SeitenHinweise
              fehler={rueckgaengigFehler}
              fehlerTitel="Nicht erneut disponiert"
              fehlerFallback="Rückgängig fehlgeschlagen"
            />
          </Space>
        ) : null
      }
      /**
       * Der Kopf ÖFFNET nur (LFH-983, `frontend/AGENTS.md`, Bedien-Leitlinie): disponiert wird im
       * Dialog mit Absende-Knopf im `<form>`. Vorher stand hier eine Maske, die direkt absendete.
       */
      aktionen={
        <Space wrap style={{ minWidth: 0 }}>
          {/* Gruppierung (LLH-1225 D4): eine Segmentleiste darf im Kopf stehen
              (`frontend/AGENTS.md`, „Nebenwege im Kopf“); je Einsatz im State, ohne Speicher. */}
          <Segmentleiste<Gruppierung>
            beschriftung="Material gruppieren"
            wert={gruppierung}
            onWechsel={(wert) => setGruppierungWahl({ einsatzId, wert })}
            optionen={GRUPPIERUNG_OPTIONEN}
          />
          {darfSchreiben && (
            <>
              <Button type="primary" onClick={() => setDisponierenOffen(true)}>
                Material disponieren
              </Button>
              <Button onClick={() => setAdhocOffen(true)}>Ad-hoc-Material</Button>
            </>
          )}
        </Space>
      }
    >
      {/* Der Status steht im `karte.status`-Slot mit der Vertragsrolle aus
          `theme/statusFarben.ts` (`materialStatus`), und `statusBedienung` macht das Etikett
          zum Auslöser — nur so ist der Statuswechsel auf der 390-px-Karte erreichbar.

          `titel` ohne `ziel`: Material hat keine Detailroute. */}

      {/* Kein Katalog-Banner: der Materialstatus ist das lokale Enum `MaterialStatus` (fünf
          Werte) und kann nicht ausfallen, anders als der Statuskatalog der Fahrzeug- und
          Personalseite.

          Der Listenfehler tauscht die Datensicht aus: `Datensicht` führt den Kartenzweig an
          `Liste`, und `ListeProps` kennt keinen Fehlerbegriff. */}
      {listeGescheitert ? (
        <SeitenFehler
          text="Disponiertes Material konnte nicht geladen werden"
          ursache={emQuery.error}
          onWiederholen={() => void emQuery.refetch()}
        />
      ) : (
        <>
          {standVeraltet && <SeitenStandVeraltet onWiederholen={() => void emQuery.refetch()} />}
          <MaterialVerdichtung
            einsatzId={einsatzId}
            material={emQuery.data}
            pfad={kraefteuebersichtPfad(einsatzId)}
          />
          <Datensicht
            bezeichnung="Material im Einsatz"
            spalten={spalten}
            daten={ems}
            zeilenSchluessel="id"
            ladend={emQuery.isLoading}
            leerText="Noch kein Material disponiert"
            suche={{ platzhalter: 'Bezeichnung, Kategorie, Ort' }}
            mehrzahl="Posten"
            gedaechtnis={gedaechtnis}
            zeilenFehler={(em) => zeilen.grund(em.id)}
            zeilenKlasse={(em) => (em.id === highlightId ? HERVORGEHOBEN : undefined)}
            gruppen={{
              ...(gruppierung === 'ort'
                ? buildOrtGruppierung(ems, ortKontext.namen, einheitFolge ?? [])
                : {
                    schluessel: statusGruppe,
                    etikett: gruppenEtikett,
                    reihenfolge: GRUPPEN_REIHENFOLGE,
                  }),
              // Die Gruppenköpfe stehen direkt unter dem Seitentitel (h1).
              unterEbene: 1,
            }}
            karte={{
              art: 'plan',
              titel: { spalte: 'bezeichnung' },
              status: (em) => materialDarstellung(em),
              statusBedienung: (em) => (darfSchreiben ? statusBedienungVon(em) : null),
              // Zwei Sekundärfelder: `status` steht im Slot darüber und stünde sonst doppelt. Die
              // Kategorie bleibt in der Suche (LLH-1093, design.md D13).
              sekundaer: ['ort', 'menge'],
              // „Aus dem Einsatz nehmen“ ließe dem Inhalt rechts daneben auf 390 px keinen Platz.
              gestapelt: true,
              aktion: darfSchreiben
                ? {
                    etikett: 'Aus dem Einsatz nehmen',
                    zugaenglicherName: (em) => `${em.bezeichnung} aus dem Einsatz nehmen`,
                    onKlick: (em) =>
                      herausnehmenMutation.mutate({ emId: em.id, name: em.bezeichnung }),
                  }
                : undefined,
              weitere: darfSchreiben
                ? {
                    eintraege: menueEintraege,
                    zugaenglicherName: (em) => `Weitere Aktionen zu ${em.bezeichnung}`,
                    laeuft: (em) => isZeileBusy(em.id),
                    onWahl: handleAktion,
                  }
                : undefined,
            }}
          />
          {/* Der Nachweis bleibt erreichbar (Spec `kraefte-entlassung`); Wortlaut LLH-1093. */}
          <EntlassenBlock
            titel="Aus dem Einsatz genommen"
            endeWort="aus dem Einsatz genommen"
            eintraege={entlassene.map((em) => ({
              id: em.id,
              name: em.bezeichnung,
              zusatz: `×${em.menge}`,
              beendetAt: em.beendet_at,
            }))}
            aktion={
              darfSchreiben
                ? {
                    etikett: 'Erneut disponieren',
                    onKlick: (emId) => reaktivierenMutation.mutate(emId),
                    laeuft: (emId) =>
                      reaktivierenMutation.isPending && reaktivierenMutation.variables === emId,
                  }
                : undefined
            }
            fehler={(emId) => zeilen.grund(emId)}
          />
        </>
      )}

      {/* Die Rückfrage vor dem Unumkehrbaren steht als `<Modal>`, nicht im Menü (LFH-683). Sie
          nennt ihre Position und schließt, wenn die Zeile entfällt. */}
      <Modal
        open={stornoFuer !== null && ems.some((em) => em.id === stornoFuer.id)}
        title={stornoFuer ? `${stornoFuer.name} stornieren?` : undefined}
        onCancel={() => {
          if (isNewGestureStorno()) setStornoFuer(null);
        }}
        destroyOnHidden
        footer={
          <Space size="middle">
            <Button
              onClick={() => {
                if (isNewGestureStorno()) setStornoFuer(null);
              }}
            >
              Abbrechen
            </Button>
            <Button
              danger
              onClick={() => {
                if (!stornoFuer || !isNewGestureStorno()) return;
                setStornoFuer(null);
                stornierenMutation.mutate(stornoFuer.id);
              }}
            >
              Stornieren
            </Button>
          </Space>
        }
      >
        Das Material erscheint danach in keiner Liste und keinem Nachweis.
      </Modal>

      {/* „Angaben ändern“ und „Aufteilen“ (LLH-1093, design.md D12) auf der Erfassungs-Hülle,
          außerhalb der Zeilen-`map`; entfällt die Zeile, bleiben sie offen und tragen die
          Ablehnung. */}
      <MaterialAngabenModal
        posten={angabenPosten}
        laeuft={angabenMutation.isPending}
        speicherung={angabenMutation}
        onSpeichern={(patch) => {
          if (!angabenPosten) return Promise.resolve();
          return angabenMutation.mutateAsync({ emId: angabenPosten.id, patch });
        }}
        onSchliessen={() => setAngabenFuer(null)}
      />
      <MaterialAusgabeModal
        posten={ausgabePosten}
        modus={ausgabeFuer?.modus ?? 'ausgeben'}
        laeuft={ausgabeMutation.isPending}
        speicherung={ausgabeMutation}
        onSpeichern={(ausgegeben, menge) => {
          if (!ausgabePosten || !ausgabeFuer) return Promise.resolve();
          return ausgabeMutation.mutateAsync({
            emId: ausgabePosten.id,
            name: ausgabePosten.bezeichnung,
            ausgegeben,
            menge,
            modus: ausgabeFuer.modus,
          });
        }}
        onSchliessen={() => setAusgabeFuer(null)}
      />
      <MaterialMengeModal
        posten={mengePosten}
        laeuft={mengeMutation.isPending}
        speicherung={mengeMutation}
        onSpeichern={(menge) => {
          if (!mengePosten) return Promise.resolve();
          return mengeMutation.mutateAsync({ emId: mengePosten.id, menge });
        }}
        onSchliessen={() => setMengeFuer(null)}
      />
      <MaterialAufteilenModal
        posten={aufteilenPosten}
        ortOptionen={aufteilenOrtOptionen}
        laeuft={aufteilenMutation.isPending}
        speicherung={aufteilenMutation}
        onAufteilen={(menge, ziel) => {
          if (!aufteilenPosten) return Promise.resolve();
          return aufteilenMutation.mutateAsync({ em: aufteilenPosten, menge, ziel });
        }}
        onSchliessen={() => setAufteilenFuer(null)}
      />

      {/* Stamm-Material disponieren. Serienmodus, weil eine Anlieferung mehrere Positionen bringt.
          Die Pflichtprüfung meldet ein fehlendes Material; der Knopf ist nie grau ohne Grund. */}
      <ErfassungsModal<StammDisposition>
        offen={disponierenOffen}
        titel="Material disponieren"
        form={stammForm}
        erfassenText="Disponieren"
        serie
        initialValues={{ menge: 1 }}
        laeuft={disponiereMutation.isPending}
        speicherung={disponiereMutation}
        speicherFehlerTitel="Nicht disponiert"
        speicherFehlerFallback="Disponieren fehlgeschlagen"
        onErfassen={async (w) => {
          const geraet = poolQuery.data?.find((m) => m.id === w.material_id)?.art === 'geraet';
          await disponiereMutation.mutateAsync({
            materialId: w.material_id,
            menge: geraet ? 1 : w.menge,
            ort: ortPostFields(stammOrt),
          });
        }}
        onFertig={() => {
          setStammOrt(OHNE_ORT_WERT);
          setDisponierenOffen(false);
        }}
        onAbbrechen={() => {
          setStammOrt(OHNE_ORT_WERT);
          setDisponierenOffen(false);
        }}
      >
        <Form.Item
          label="Material"
          name="material_id"
          rules={[{ required: true, message: 'Material wählen' }]}
        >
          <Select options={poolOptionen} notFoundContent={poolInhalt} />
        </Form.Item>
        <Form.Item
          label="Menge"
          name="menge"
          rules={[{ required: true }]}
          extra={isGeraetGewaehlt ? 'Ein Gerät steht je Stück im Einsatz' : undefined}
        >
          <MengenFeld beschriftung="Menge" style={{ width: 120 }} disabled={isGeraetGewaehlt} />
        </Form.Item>
        {/* Ort (LLH-1225 D7): dieselbe Auswahl wie die Spalte, ohne Formularnamen, damit er im
            Serienlauf stehen bleibt; der Weg hinaus setzt ihn zurück. */}
        <Form.Item label="Ort" htmlFor="material-disponieren-ort">
          <Select<string>
            id="material-disponieren-ort"
            value={stammOrt}
            onChange={(v) => setStammOrt(v ?? OHNE_ORT_WERT)}
            options={buildOrtOptions(ortKontext.quellen)}
          />
        </Form.Item>
      </ErfassungsModal>

      {/* Ad-hoc-Erfassung im geteilten Dialog (LLH-1133 D4); hier mit dem Feld „Ort“. */}
      <MaterialAdhocDialog
        einsatzId={einsatzId}
        offen={adhocOffen}
        onSchliessen={() => setAdhocOffen(false)}
        ortOptionen={buildOrtOptions(ortKontext.quellen)}
      />
    </EinsatzSeite>
  );
}
