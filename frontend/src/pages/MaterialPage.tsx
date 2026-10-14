import {
  Alert,
  App,
  Breadcrumb,
  Button,
  Collapse,
  Form,
  Input,
  Modal,
  Space,
  Tag,
  Typography,
} from 'antd';
import EinsatzSeite from '../components/EinsatzSeite';
import { Select } from '../components/Select';
import { BemerkungZelle } from '../components/BemerkungZelle';
import { ErfassungsModal } from '../components/Erfassung';
import { MengenFeld } from '../components/MengenFeld';
import Datensicht, { spaltenFuer, useSpalteAusgeblendet } from '../components/Datensicht';
import {
  nichtGefundenInhalt,
  SeitenFehler,
  SeitenSkeleton,
  SeitenStandVeraltet,
} from '../components/SeitenZustand';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { listeMaterial } from '../api/material';
import {
  updateDisposition,
  disponiereAdhoc,
  disponiereMaterial,
  gibMaterialFrei,
  listEinsatzMaterial,
  listEntlassenesMaterial,
  nimmAusDemEinsatz,
  ordneMaterialZu,
  reaktiviereDisposition,
  storniereDisposition,
  teileAuf,
  type MaterialAdhocEingabe,
  type MaterialPatch,
} from '../api/einsatzMaterial';
import { MATERIAL_ADHOC_TEXT_MAX, MATERIAL_BEMERKUNG_MAX } from '../api/eingabegrenzen';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { EinsatzMaterial, MaterialStatus } from '../api/types';
import { kraefteuebersichtPfad } from '../routing/deeplinks';
import MaterialVerdichtung from '../kraefte/MaterialVerdichtung';
import MaterialOrt, { ortFilter, ortSuchText, useMaterialOrtKontext } from '../kraefte/MaterialOrt';
import {
  AUFGEBRAUCHT,
  isAufgebraucht,
  materialDarstellung,
  materialStatusOptionen,
  mengeText,
  ortVon,
} from '../kraefte/materialPosten';
import MaterialAngabenModal from '../kraefte/MaterialAngabenModal';
import MaterialArtModal from '../kraefte/MaterialArtModal';
import MaterialAufteilenModal from '../kraefte/MaterialAufteilenModal';
import { InlineAngabe } from '../components/InlineAngabe';
import type { MenueEintrag } from '../components/MenueAusloeser';
import StatusWahl, { type StatusOption } from '../components/StatusWahl';
import { materialStatus } from '../theme/statusFarben';
import DemoMarke from '../components/DemoMarke';
import { demoGroupedOptions } from '../stammdaten/demoAuswahl';
import { useZeilenFehler } from '../components/useZeilenFehler';
import { useOptimistischesZeilenUpdate } from '../kraefte/useOptimistischesZeilenUpdate';
import { modulName } from '../einsatz/modulRegistry';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import { MenueAusloeser } from '../components/MenueAusloeser';
import { zeigeRueckgaengig } from '../kommunikation/rueckgaengig';
import EntlassenBlock from '../kraefte/EntlassenBlock';
import { useNewGesture } from './einsatzabschnitte/useNewGesture';

/**
 * Die Farbentscheidung für den Materialstatus liegt in `theme/statusFarben.ts` (`materialStatus`).
 * Diese Datei hält nur Reihenfolge und Filterwerte, abgeleitet aus der Vertragskarte — ein
 * Behandlungsweg für dieses Enum, gemeinsam mit `pages/uhs/MaterialTab.tsx`.
 */
const STATUS_REIHENFOLGE = Object.keys(materialStatus) as MaterialStatus[];

/**
 * Menüwerte mit `darstellung` — der Farbpunkt im Statusmenü kommt aus dem Vertrag. Je Art nur die
 * erlaubten Status (LLH-1224 D3): ein Verbrauchsgut kennt „verbraucht“ und „Desinfektion nötig“
 * nicht, es wird ausgegeben.
 */
function statusOptionen(em: EinsatzMaterial): StatusOption<MaterialStatus>[] {
  return materialStatusOptionen(em.art).map((s) => ({
    wert: s,
    label: materialStatus[s].label,
    darstellung: materialStatus[s],
  }));
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
function BezeichnungZelle({ em }: { em: EinsatzMaterial }) {
  const kategorieAusgeblendet = useSpalteAusgeblendet('kategorie');
  const marken = [
    em.ist_adhoc && <Tag key="adhoc">ad-hoc</Tag>,
    em.ist_demo && <DemoMarke key="demo" />,
  ];
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
      </>
    );
  }
  // `wrap`: die Marken rutschen unter die Bezeichnung, statt die Spalte zu verbreitern.
  return (
    <Space wrap>
      {em.bezeichnung}
      {marken}
    </Space>
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

/** Werte des Disponier-Dialogs für Stamm-Material. */
interface StammDisposition {
  material_id: number;
  menge: number;
}

export default function MaterialPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [adhocOffen, setAdhocOffen] = useState(false);
  const [form] = Form.useForm<MaterialAdhocEingabe & { menge: number }>();
  const [disponierenOffen, setDisponierenOffen] = useState(false);
  const [stammForm] = Form.useForm<StammDisposition>();
  /** Offene Rückfrage „Stornieren“ (LLH-1079): als `<Modal>` außerhalb der Zeilen-`map`. */
  const [stornoFuer, setStornoFuer] = useState<{ id: number; name: string } | null>(null);
  const isNewGestureStorno = useNewGesture(stornoFuer !== null);
  /** Offene Dialoge „Angaben ändern“ und „Aufteilen“ (LLH-1093), je mit der Disposition. */
  // Der Posten beim Öffnen, nicht nur seine ID: entfällt die Zeile live (anderer Platz storniert,
  // nimmt heraus), bleibt der Dialog offen und die Ablehnung steht an ihm (`frontend/AGENTS.md`,
  // „Rückwege und Fehler“). Solange die Zeile da ist, gilt ihr aktueller Stand.
  const [angabenFuer, setAngabenFuer] = useState<EinsatzMaterial | null>(null);
  const [aufteilenFuer, setAufteilenFuer] = useState<EinsatzMaterial | null>(null);
  /** Offener Dialog „Art ändern …“ eines Ad-hoc-Postens (LLH-1224 D10), Muster wie oben. */
  const [artFuer, setArtFuer] = useState<EinsatzMaterial | null>(null);

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
  // Einheiten und UHS für die Spalte „Ort“; ohne Schreibrecht nur zum Lesen der Namen. Das
  // Schreibrecht hängt am Einsatz, der hier noch laden kann: bis dahin bedient kein Teil.
  const { kontext: ortKontext } = useMaterialOrtKontext(
    einsatzId,
    einsatzQuery.data != null && darfImEinsatzSchreiben(einsatzQuery.data),
    emQuery.data,
  );

  const disponiereMutation = useMutation({
    mutationFn: (v: { materialId: number; menge: number }) =>
      disponiereMaterial(einsatzId, v.materialId, v.menge),
    // Schließen und Leeren gehören der Erfassungshülle (`onFertig`).
    onSuccess: () => {
      message.success('Material disponiert');
      invalidate();
    },
  });
  const adhocMutation = useMutation({
    mutationFn: (w: MaterialAdhocEingabe & { menge: number }) =>
      disponiereAdhoc(
        einsatzId,
        {
          bezeichnung: w.bezeichnung,
          kategorie: w.kategorie,
          bestandsnummer: w.bestandsnummer,
          traegerorganisation: w.traegerorganisation,
        },
        w.menge ?? 1,
      ),
    // Nur invalidieren und melden: geschlossen wird über `onFertig`, geleert von der
    // Erfassungshülle auf allen Wegen, auch beim Abbrechen.
    onSuccess: () => {
      invalidate();
      message.success('Ad-hoc-Material disponiert');
    },
  });
  // Menge und Ort stehen in einer `InlineAngabe`: deren Eingabe bleibt bei einer Ablehnung offen und
  // zeigt den Grund selbst (an der Zeile). Ein zweiter Eintrag in `zeilen` stünde doppelt.
  const mengeMutation = useMutation({
    mutationFn: (v: { emId: number; menge: number }) =>
      updateDisposition(einsatzId, v.emId, { menge: v.menge }),
    onSuccess: invalidate,
  });
  /*
   * Ort (LLH-1093 D1, LLH-1224 D6/D16): die Einheit über den Zuordnungsweg der Einheiten
   * (Umhängen in einer Anfrage, „keine Einheit“ gibt die alte frei), die UHS über den
   * Material-PATCH. Ein Posten hat einen Ort: setzt man den einen Teil, leert der Server den
   * anderen; die Listen beider ziehen deshalb mit.
   */
  const einheitMutation = useMutation({
    mutationFn: (v: { emId: number; neu: number | null; alt: number | null }) =>
      v.neu != null
        ? ordneMaterialZu(einsatzId, v.neu, v.emId)
        : v.alt != null
          ? gibMaterialFrei(einsatzId, v.alt, v.emId)
          : Promise.resolve(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.uhs(einsatzId) });
      return invalidate();
    },
  });
  const uhsMutation = useMutation({
    mutationFn: (v: { emId: number; uhsId: number | null }) =>
      updateDisposition(einsatzId, v.emId, { uhs_id: v.uhsId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: einsatzKeys.uhs(einsatzId) });
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
  const artMutation = useMutation({
    mutationFn: (v: { emId: number; patch: MaterialPatch }) =>
      updateDisposition(einsatzId, v.emId, v.patch),
    onSuccess: () => {
      message.success('Art gespeichert');
      // Die Einheit zeigt Art und Menge ihres Materials mit.
      void qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
      return invalidate();
    },
  });
  const aufteilenMutation = useMutation({
    mutationFn: (v: { emId: number; menge: number }) => teileAuf(einsatzId, v.emId, v.menge),
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
    mutationFn: (v) => updateDisposition(einsatzId, v.emId, { status: v.status }),
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
  /** Läuft für diese Zeile Herausnehmen, Aufteilen oder Stornieren? Dann keine zweite Handlung. */
  const isZeileBusy = (emId: number) =>
    (herausnehmenMutation.isPending && herausnehmenMutation.variables?.emId === emId) ||
    (aufteilenMutation.isPending && aufteilenMutation.variables?.emId === emId) ||
    (stornierenMutation.isPending && stornierenMutation.variables === emId);
  /**
   * Zeilenmenü (LLH-1093, design.md D11): „Angaben ändern“, beim Ad-hoc-Posten „Art ändern …“
   * (LLH-1224 D10) und „Aufteilen“, hinter dem Trenner rot
   * „Stornieren“. Gesperrte Einträge tragen ihren Grund im Etikett — ein Etikett ist nur Text, und
   * ein Tooltip erscheint am Touchschirm nicht.
   */
  const menueEintraege = (em: EinsatzMaterial): MenueEintrag[] => [
    em.ist_adhoc
      ? { key: 'angaben', label: 'Angaben ändern' }
      : { key: 'angaben', label: 'Angaben ändern · im Stamm pflegen', gesperrt: true },
    // Die Art eines Ad-hoc-Postens folgt beim Anlegen der Menge (Menge 1 → Gerät, D12); hier wird
    // sie korrigiert. Ein Stamm-Posten trägt die Art seines Stamms (D16) und bekommt den Eintrag
    // nicht.
    ...(em.ist_adhoc ? [{ key: 'art', label: 'Art ändern …' }] : []),
    // Aufteilen nur aus dem Rest eines Verbrauchsguts (LLH-1224 D14); ein Gerät steht je Stück.
    em.art === 'geraet'
      ? { key: 'aufteilen', label: 'Aufteilen · Gerät', gesperrt: true }
      : em.menge <= 1
        ? { key: 'aufteilen', label: 'Aufteilen · Menge 1', gesperrt: true }
        : em.ausgegeben >= em.menge
          ? { key: 'aufteilen', label: `Aufteilen · ${AUFGEBRAUCHT}`, gesperrt: true }
          : { key: 'aufteilen', label: 'Aufteilen' },
    // Der Server lehnt das Stornieren eines Postens mit Ort sicher ab (Spec `material-liste`,
    // „Zeilenaktionen“); Frist und frühere Herausnahme prüft weiter er.
    ortVon(em) != null
      ? { key: 'stornieren', label: 'Stornieren · zugeordnet', gefahr: true, gesperrt: true }
      : { key: 'stornieren', label: 'Stornieren', gefahr: true },
  ];
  const handleAktion = (key: string, em: EinsatzMaterial) => {
    if (key === 'angaben') {
      angabenMutation.reset();
      setAngabenFuer(em);
    } else if (key === 'art') {
      artMutation.reset();
      setArtFuer(em);
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
  const artPosten = artFuer ? (ems.find((em) => em.id === artFuer.id) ?? artFuer) : null;

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
  // disponiert werden (Mengen-Splitting auf Einheiten).
  // LFH-733: Demo-Stammdaten bleiben wählbar, stehen aber als Gruppe hinter den echten.
  const poolOptionen = demoGroupedOptions(
    poolQuery.data ?? [],
    (m) => `${m.bezeichnung}${m.kategorie ? ` (${m.kategorie})` : ''}`,
  );

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

  /**
   * Spaltenregister der Materialseite. `EinsatzMaterialAnzeige` hat kein `status_kategorie`;
   * gruppiert und gefiltert wird auf der eigenen Fünf-Werte-Achse (`MaterialStatus`), dieselbe
   * Grenze wie in `filtereKraefte`.
   *
   * ── Gemessen gegen den Fükw (LLH-1093, Prüfliste) ──
   *
   * Mit der Spalte „Ort“ wuchs die Tabelle inhaltsgetrieben auf 1326 px; am Fükw (1050 px Inhalt
   * bei 1366) lag „Aus dem Einsatz nehmen“ außerhalb des Bilds. Jetzt FLIESST der Ort
   * (`mindestBreite`, LFH-523): seine Teile Einheit und UHS brechen untereinander um. Alle übrigen
   * tragen eine Zahlbreite; die Aktionsspalte trägt Knopf, Abstand und Menü (226 px Inhalt in
   * `kompakt`). Die Kategorie weicht unter `xxl` (wie Typ, Kennzeichen und Träger der
   * Fahrzeugseite), sonst blieben dem Ort bei 1366 nur 125 px und die Namen brächen Silbe für
   * Silbe. Wer eine Breite ändert, misst neu.
   */
  const spalten = spaltenFuer<EinsatzMaterial>()([
    {
      title: 'Bezeichnung',
      key: 'bezeichnung',
      immerSichtbar: true,
      width: 170,
      sortWert: (m) => m.bezeichnung,
      suchText: (m) => m.bezeichnung,
      render: (_, em) => <BezeichnungZelle em={em} />,
    },
    {
      title: 'Kategorie',
      dataIndex: 'kategorie',
      key: 'kategorie',
      width: 100,
      // Lesend, darf weichen: unter `xxl` als zweite Zeile der Bezeichnung (`BezeichnungZelle`),
      // über den Spaltenschalter, im Zähler und in der Suche.
      abBreite: 'xxl',
      filter: kategorieFilter,
      suchText: (m) => m.kategorie,
      render: (t) => t ?? '—',
    },
    {
      // Ort auf der Doppelregel (LLH-1093, design.md D1–D3, D13): Einheit und UHS, je Teil mit
      // ausdrücklichem Speichern; Filter „ohne Ort“, je Einheit, je UHS.
      title: 'Ort',
      key: 'ort',
      mindestBreite: 170,
      filter: ortFilter(ems, ortKontext),
      sortWert: (m) => ortSuchText(m, ortKontext),
      suchText: (m) => ortSuchText(m, ortKontext),
      render: (_, em) => (
        <MaterialOrt
          kennung={em.bezeichnung}
          ort={ortVon(em)}
          kontext={ortKontext}
          darfSchreiben={darfSchreiben}
          onEinheit={(neu, alt) => einheitMutation.mutateAsync({ emId: em.id, neu, alt })}
          onUhs={(uhsId) => uhsMutation.mutateAsync({ emId: em.id, uhsId })}
        />
      ),
    },
    {
      // Die Menge ist ein Wert, der erst auf „bearbeiten“ zum Feld wird, und speichert nur mit Enter
      // oder „Speichern“ (LLH-1093, design.md D9): auf dem Tablet änderte ein Wisch sonst die Menge
      // und schrieb einen ETB-Eintrag. Ein Gerät steht je Stück im Einsatz: „1“ ohne Bearbeiten;
      // ein Verbrauchsgut zeigt mit Ausgabe den Rest („30 von 50 übrig“, LLH-1224 D15/D16).
      title: 'Menge',
      key: 'menge',
      width: 80,
      sortWert: (m) => m.menge,
      render: (_, em) =>
        em.art === 'geraet' ? (
          <span style={{ whiteSpace: 'nowrap' }}>{mengeText(em)}</span>
        ) : (
          <InlineAngabe<number | null>
            etikett="Menge"
            kennung={em.bezeichnung}
            wert={em.menge}
            // Eine Zahl bricht nicht um: im Kartenfeld (Breite nach Inhalt) stand „50“ sonst als „5“
            // über „0“, weil der Wertknopf seine Polsterung über den Rand hinausträgt.
            anzeige={<span style={{ whiteSpace: 'nowrap' }}>{mengeText(em)}</span>}
            leer={(w) => w == null}
            pflicht
            darfSchreiben={darfSchreiben}
            onSpeichern={(menge) => mengeMutation.mutateAsync({ emId: em.id, menge: menge ?? 1 })}
            eingabe={({ feld, value, onChange }) => (
              // Die Breite trägt eine zweistellige Menge, keine Trefffläche; die Höhe zieht mit der
              // Dichtestufe mit.
              <MengenFeld
                id={feld.id}
                autoFocus={feld.autoFocus}
                beschriftung={feld['aria-label']}
                style={{ width: 120 }}
                value={value}
                onChange={(v) => onChange(v ?? null)}
              />
            )}
          />
        ),
    },
    {
      title: 'Status',
      key: 'status',
      width: 120,
      filter: { werte: STATUS_FILTER_WERTE, trifft: (m, w) => statusGruppe(m) === w },
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
                    (aufteilenMutation.isPending && aufteilenMutation.variables?.emId === em.id)
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
        darfSchreiben && (
          <Space wrap style={{ minWidth: 0 }}>
            <Button type="primary" onClick={() => setDisponierenOffen(true)}>
              Material disponieren
            </Button>
            <Button onClick={() => setAdhocOffen(true)}>Ad-hoc-Material</Button>
          </Space>
        )
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
            standardSortierung={{ spalte: 'bezeichnung', richtung: 'auf' }}
            zeilenFehler={(em) => zeilen.grund(em.id)}
            gruppen={{
              schluessel: statusGruppe,
              etikett: gruppenEtikett,
              reihenfolge: GRUPPEN_REIHENFOLGE,
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
      <MaterialArtModal
        posten={artPosten}
        laeuft={artMutation.isPending}
        speicherung={artMutation}
        onSpeichern={(patch) => {
          if (!artPosten) return Promise.resolve();
          return artMutation.mutateAsync({ emId: artPosten.id, patch });
        }}
        onSchliessen={() => setArtFuer(null)}
      />
      <MaterialAufteilenModal
        posten={aufteilenPosten}
        laeuft={aufteilenMutation.isPending}
        speicherung={aufteilenMutation}
        onAufteilen={(menge) => {
          if (!aufteilenPosten) return Promise.resolve();
          return aufteilenMutation.mutateAsync({ emId: aufteilenPosten.id, menge });
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
          });
        }}
        onFertig={() => setDisponierenOffen(false)}
        onAbbrechen={() => setDisponierenOffen(false)}
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
      </ErfassungsModal>

      {/* Ad-hoc-Erfassung auf der Schnellerfassungs-Hülle.

          Serienmodus, weil Ad-hoc-Material stückweise nachkommt. Wertübernahme auf Kategorie
          und Trägerorganisation — sie bleiben über eine Anlieferung gleich und stehen deshalb
          hinten: was sich je Position ändert (Bezeichnung, Menge), kommt zuerst.

          Feldbudget: höchstens vier sichtbare Felder. Die Bestandsnummer ist das fünfte; bei
          Spenden und Fremdmaterial gibt es sie meist nicht. Sie liegt unter „Weitere Angaben".

          `forceRender` registriert das Feld ab dem ersten Bild im Formular statt erst beim
          Aufklappen. Den eingetippten Wert rettet es nicht — der überlebt das Zuklappen ohnehin
          (antd baut den Bereich nicht ab, `Form.Item` bewahrt per Vorgabe). */}
      <ErfassungsModal<MaterialAdhocEingabe & { menge: number }>
        offen={adhocOffen}
        titel="Ad-hoc-Material ohne Stammeintrag"
        form={form}
        erfassenText="Disponieren"
        serie
        uebernahme={['kategorie', 'traegerorganisation']}
        initialValues={{ menge: 1 }}
        laeuft={adhocMutation.isPending}
        speicherung={adhocMutation}
        speicherFehlerTitel="Nicht disponiert"
        speicherFehlerFallback="Disponieren fehlgeschlagen"
        // `mutateAsync`, nicht `mutate`: nur eine abgelehnte Zusage lässt die Hülle die Werte
        // stehen. Den Grund zeigt die Hülle über `speicherung`.
        onErfassen={async (w) => {
          await adhocMutation.mutateAsync(w);
        }}
        onFertig={() => setAdhocOffen(false)}
        onAbbrechen={() => setAdhocOffen(false)}
      >
        <Form.Item
          label="Bezeichnung"
          name="bezeichnung"
          rules={[{ required: true, whitespace: true }]}
        >
          <Input placeholder="z. B. Spende-Decken" maxLength={MATERIAL_ADHOC_TEXT_MAX} />
        </Form.Item>
        <Form.Item label="Menge" name="menge" rules={[{ required: true }]}>
          <MengenFeld beschriftung="Menge" style={{ width: 120 }} />
        </Form.Item>
        <Form.Item label="Kategorie" name="kategorie">
          <Input maxLength={MATERIAL_ADHOC_TEXT_MAX} />
        </Form.Item>
        <Form.Item label="Trägerorganisation" name="traegerorganisation">
          <Input placeholder="z. B. THW" maxLength={MATERIAL_ADHOC_TEXT_MAX} />
        </Form.Item>
        <Collapse
          ghost
          items={[
            {
              key: 'weitere',
              label: 'Weitere Angaben',
              forceRender: true,
              children: (
                <Form.Item label="Bestandsnummer" name="bestandsnummer" style={{ marginBottom: 0 }}>
                  <Input maxLength={MATERIAL_ADHOC_TEXT_MAX} />
                </Form.Item>
              ),
            },
          ]}
        />
      </ErfassungsModal>
    </EinsatzSeite>
  );
}
