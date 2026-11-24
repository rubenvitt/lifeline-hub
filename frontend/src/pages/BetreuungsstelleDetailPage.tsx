import { App, Breadcrumb, Button, Form, Input, Space, Typography } from 'antd';
import { EinsatzOrtsfeld } from '../anzeige/EinsatzOrtsfeld';
import { ortsfeldAusGespeichert } from '../anzeige/ortsfeldFormular';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { FormRule } from 'antd';
import { Link, useNavigate, useParams } from 'react-router';
import {
  aendereStelle,
  ladeBetreuung,
  loadBetreuungsstelleStand,
  meldeBelegung,
  nimmBelegungZurueck,
  storniereStelle,
} from '../api/betreuung';
import { ladeEinsatz } from '../api/incidents';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import {
  BETREUUNG_KONTAKTWEG_MAX,
  BETREUUNG_LEITUNG_MAX,
  BETREUUNG_STELLE_BEZEICHNUNG_MAX,
  BETREUUNG_STELLE_NOTIZ_MAX,
  BETREUUNG_STELLE_STANDORT_MAX,
} from '../api/eingabegrenzen';
import { einsatzKeys } from '../api/queryKeys';
import type {
  BelegungsmeldungEingabe,
  Belegungsart,
  Betreuungsstelle,
  BetreuungsstellePatch,
  BetreuungsstelleStatus,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import {
  ART_OPTIONEN,
  BelegungMeldenDialog,
  StelleSchliessenDialog,
  StornierenDialog,
  hoechstensRegel,
  stellePatchDreiseitig,
  type StelleWerte,
} from '../betreuung/BetreuungDialoge';
import MeldeVerlauf from '../betreuung/MeldeVerlauf';
import StelleBedarf from '../betreuung/StelleBedarf';
import StelleBelegung from '../betreuung/StelleBelegung';
import StelleBelegungslinie from '../betreuung/StelleBelegungslinie';
import StelleBetroffene from '../betreuung/StelleBetroffene';
import StelleUnterkunft from '../betreuung/StelleUnterkunft';
import { verlaufRuecknahme } from '../betreuung/StellenBlock';
import {
  ART_LABEL,
  BELEGUNGSART_LABEL,
  NAMENTLICH_SPERRE,
  inBetreuung,
  personenZahl,
} from '../betreuung/betreuungText';
import RegistrierungPaneel from '../betreuung/registrierung/RegistrierungPaneel';
import { STATUS_HANDLUNG, schliessenBrauchtLeermeldung } from '../betreuung/stelleStatus';
import EinsatzSeite from '../components/EinsatzSeite';
import { ausschnitt, ausschnittLeer, ausschnittText } from '../components/feldVermerk';
import { OFFEN_LASSEN } from '../components/InlineAngabe';
import { useFeldKonflikt, VERWORFEN } from '../components/useFeldKonflikt';
import {
  Datenfeld,
  DatenfeldEingabe,
  Datenraster,
  Paneel,
  PaneelLink,
  Stapel,
  monoStil,
} from '../components/instrument';
import { MenueAusloeser, type MenueEintrag } from '../components/MenueAusloeser';
import { einsatzRechteGrund } from '../components/nurAnsicht';
import { Select } from '../components/Select';
import { SeitenFehler, SeitenStandVeraltet } from '../components/SeitenZustand';
import StelleNichtGefunden from '../betreuung/StelleNichtGefunden';
import { SeitenHinweise, SpeicherFehler } from '../components/SpeicherHinweis';
import { StornoBanner, entwurfNurLesen } from '../components/StornoBanner';
import VerlassenRueckfrage from '../components/VerlassenRueckfrage';
import { useFormularVerlassenSchutz } from '../components/useFormularVerlassenSchutz';
import { useSpeicherLeiste } from '../components/speicherLeiste';
import SpeicherKnopf from '../components/SpeicherKnopf';
import { AenderungsstandProvider, EnterOhneAenderung } from '../components/aenderungsstand';
import { ortZeichenRegel, zeichenGrenze, zeichenRegel } from '../components/zeichenGrenze';
import { KEINE_BERECHTIGUNG, modulName } from '../einsatz/modulRegistry';
import { darfBeantragen, darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useModulFreigaben, useSprungSperre } from '../einsatz/useSprungSperre';
import { zeigeRueckgaengig } from '../kommunikation/rueckgaengig';
import { erfasseBelegungOfflineFaehig } from '../offline/schreiben';
import { betreuungPfad, lagekartePfad, parseRouteId, verpflegungPfad } from '../routing/deeplinks';
import { betreuungsstelleStatus } from '../theme/statusFarben';
import { Status } from '../components/instrument/Status';
import { Marke } from '../components/instrument/Marke';
import { ListenRueckweg } from '../components/ListenRueckweg';
import { ZahlFeld } from '../components/ZahlFeld';
import { pflicht } from '../components/pflichtRegel';
import { vorgemerktDauer, vorgemerktText } from '../offline/vorgemerktText';
import { ModulGerippeSeite } from '../einsatz/ModulWechselGerippe';

type KopfMenue = 'karte' | 'verorten' | 'stornieren';

/** Ein Dialog zur Zeit; jeder frisch montiert. */
type Dialog = 'belegung' | 'schliessen' | 'stornieren';

/** Ein Statusübergang mit dem Status davor, für das Rückgängig nach dem Schließen. */
interface StatusSchritt {
  id: number;
  ziel: BetreuungsstelleStatus;
  vorher: BetreuungsstelleStatus;
}

/** Die offene Bearbeiten-Sitzung: der Stand beim Öffnen (dreiseitiger PATCH) und die Werte. */
interface Sitzung {
  beimOeffnen: Betreuungsstelle;
  werte: StelleWerte;
}

const leer = <Typography.Text type="secondary">—</Typography.Text>;

/** Name je Angabe für die Rückfrage „Zwischenzeitlich geändert“; die Koordinate ist eine. */
const ANGABE_NAME: Record<Exclude<keyof BetreuungsstellePatch, 'status' | 'lon'>, string> = {
  bezeichnung: 'Bezeichnung',
  art: 'Art',
  belegungsart: 'Belegungsart',
  kapazitaet_personen: 'Kapazität',
  abschnitt_id: 'Einsatzabschnitt',
  standort: 'Standort',
  lat: 'Koordinate',
  leitung: 'Leitung',
  kontaktweg: 'Kontakt',
  notiz: 'Notiz',
};

/** Die Angaben eines Patches, wie die Rückfrage sie nennt. */
function angabenName(patch: BetreuungsstellePatch): string {
  return (Object.keys(ANGABE_NAME) as (keyof typeof ANGABE_NAME)[])
    .filter((k) => k in patch)
    .map((k) => ANGABE_NAME[k])
    .join(', ');
}

/**
 * Der aktuelle Stand der Angaben eines Patches lesbar für die Rückfrage: Bezeichnungen statt
 * Codes und Kennungen, die Koordinate als ein Wert.
 */
function angabenAnzeige(s: Betreuungsstelle, patch: BetreuungsstellePatch): string {
  const werte: (string | null)[] = (Object.keys(ANGABE_NAME) as (keyof typeof ANGABE_NAME)[])
    .filter((k) => k in patch)
    .map((k) => {
      switch (k) {
        case 'art':
          return ART_LABEL[s.art];
        case 'belegungsart':
          return BELEGUNGSART_LABEL[s.belegungsart];
        case 'abschnitt_id':
          return s.abschnitt_name ?? null;
        case 'lat':
          return s.lat != null && s.lon != null ? `${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}` : null;
        default:
          return s[k] != null && s[k] !== '' ? String(s[k]) : null;
      }
    });
  return werte.filter((w) => w != null).join(', ');
}

const BELEGUNGSART_OPTIONEN = (Object.keys(BELEGUNGSART_LABEL) as Belegungsart[]).map((a) => ({
  value: a,
  label: BELEGUNGSART_LABEL[a],
}));

/** Pflicht, nicht nur Leerzeichen — wie im Anlegen-Dialog. */
const bezeichnungRegel: FormRule = pflicht('Bezeichnung', { whitespace: true });

function sitzungsWerte(s: Betreuungsstelle): StelleWerte {
  return {
    bezeichnung: s.bezeichnung,
    art: s.art,
    kapazitaet_personen: s.kapazitaet_personen ?? undefined,
    abschnitt_id: s.abschnitt_id ?? undefined,
    // Eine gespeicherte Koordinate steht als Kartenpunkt im Feld: eine Textkorrektur behält sie
    // (LLH-1121, design.md D3).
    standort: ortsfeldAusGespeichert(s.standort, s.lat, s.lon),
    leitung: s.leitung ?? undefined,
    kontaktweg: s.kontaktweg ?? undefined,
    notiz: s.notiz ?? undefined,
    belegungsart: s.belegungsart,
  };
}

/**
 * Detailseite einer Betreuungsstelle (LLH-1044, Spec `betreuung-evakuierung`): Belegung in
 * Zahlen, Bedarf (LLH-1082), Unterkunft (LLH-1520), Stammdaten, Meldeverlauf, Betroffene hier und Verpflegung auf einer
 * Seite.
 *
 * Die Stelle kommt aus `GET …/care` (derselbe Cache wie Übersicht und Gerät, live über das
 * `betreuung`-Ereignis); es gibt keinen Einzel-Endpunkt. Eine unbekannte, fremde oder stornierte
 * Stelle zeigt nach dem Laden „Diese Betreuungsstelle gibt es nicht (mehr)“, ebenso eine unlesbare
 * Kennung; die Adresse bleibt stehen (LLH-1827, `betreuung/StelleNichtGefunden.tsx`).
 *
 * Kopf: „Belegung melden" als Primäraktion, der Statuswechsel als Handlungsknopf
 * (`betreuung/stelleStatus.ts`), Karte und Stornieren im Menü. Bearbeiten steht am Paneel
 * „Stelle" — es betrifft nur dessen Felder — und geschieht in der Ansicht (LLH-1101).
 */
export default function BetreuungsstelleDetailPage() {
  const { id, stelleId: stelleParam } = useParams();
  const einsatzId = Number(id);
  const stelleId = parseRouteId(stelleParam);
  if (stelleId == null) return <StelleNichtGefunden einsatzId={einsatzId} />;
  return <StelleInhalt einsatzId={einsatzId} stelleId={stelleId} />;
}

function StelleInhalt({ einsatzId, stelleId }: { einsatzId: number; stelleId: number }) {
  const navigate = useNavigate();
  const { benutzer } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const gesperrt = useSprungSperre(einsatzId);
  const freigaben = useModulFreigaben(einsatzId);
  const [form] = Form.useForm<StelleWerte>();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const meldenGrundId = useId();
  const [sitzung, setSitzung] = useState<Sitzung | null>(null);
  const bearbeiten = sitzung != null;
  const speicherLeiste = useSpeicherLeiste({ hasAbbrechen: true });
  const schliessen = useCallback(() => setDialog(null), []);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const betreuungQuery = useQuery({
    queryKey: einsatzKeys.betreuung(einsatzId),
    queryFn: () => ladeBetreuung(einsatzId),
  });
  const darfSchreibenImEinsatz = einsatzQuery.data
    ? darfImEinsatzSchreiben(einsatzQuery.data)
    : false;
  // Belegung melden, Registrieren und Abmelden: am Spiegel ein Antrag (LLH-1492, D13).
  const darfErfassenImEinsatz = darfBeantragen(einsatzQuery.data);
  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
    enabled: darfSchreibenImEinsatz,
  });
  const abschnitte = useMemo(
    () => (abschnitteQuery.data ?? []).map((a) => ({ value: a.id, label: a.name })),
    [abschnitteQuery.data],
  );

  const stellen = useMemo(() => betreuungQuery.data?.stellen ?? [], [betreuungQuery.data]);
  const gefuehrt = stellen.find((s) => s.id === stelleId);
  /**
   * Storno-Sperre (LLH-1832, Spec `storno-sperre`): die Übersicht lässt stornierte Stellen weg.
   * Fällt die hier gesehene Stelle heraus, fragt die Seite ihren Stand ab; ist sie storniert,
   * bleibt ihr letzter Stand gesperrt mit Banner stehen, sonst (fremd, Bindung) wie bisher das
   * Muster „gibt es nicht (mehr)“. Ein Direktaufruf hat keinen gesehenen Stand und fragt nicht.
   */
  const [gesehen, setGesehen] = useState<Betreuungsstelle | null>(null);
  if (gefuehrt && gefuehrt !== gesehen) setGesehen(gefuehrt);
  const zuletzt = gesehen?.id === stelleId ? gesehen : null;
  const verschwunden = !gefuehrt && zuletzt != null && betreuungQuery.isSuccess;
  const standQuery = useQuery({
    queryKey: einsatzKeys.betreuungsstelleStand(einsatzId, stelleId),
    queryFn: () => loadBetreuungsstelleStand(einsatzId, stelleId),
    enabled: verschwunden,
  });
  const storniertStand = verschwunden && standQuery.data?.storniert_at ? standQuery.data : null;
  const stelle = gefuehrt ?? (verschwunden ? zuletzt : undefined);
  // Gesperrt, sobald sie herausfiel: bis der Stand da ist, schreibt hier niemand mehr.
  const storniert = verschwunden;
  const darfSchreiben = darfSchreibenImEinsatz && !storniert;
  const darfErfassen = darfErfassenImEinsatz && !storniert;
  // Verlassen-Schutz nur bei offener Sitzung; der Schlüssel hängt an der Stelle. Nach einem Storno
  // ist nichts mehr zu speichern, also auch nichts zu verlieren (LLH-1832).
  const schutz = useFormularVerlassenSchutz({
    aktiv: bearbeiten && !storniert,
    schluessel: bearbeiten ? stelleId : null,
  });
  // Storno während der Bearbeitung: eine unberührte Sitzung schließt, ein Entwurf bleibt
  // schreibgeschützt stehen, bis „Schließen“ (LLH-1832).
  useEffect(() => {
    if (storniert && bearbeiten && !form.isFieldsTouched()) setSitzung(null);
  }, [storniert, bearbeiten, form]);
  // Offene Dialoge sind Schreibaktionen: der Storno schließt sie (Spec `storno-sperre`).
  useEffect(() => {
    if (storniert) setDialog(null);
  }, [storniert]);
  // Ohne Personenrecht liefert die Übersicht kein `namentlich`: Zahl und Paneel entfallen.
  const namentlichListe = betreuungQuery.data?.namentlich;
  const personenFrei = namentlichListe != null;
  const namentlich = personenFrei
    ? (namentlichListe.find((n) => n.stelle_id === stelleId)?.anzahl ?? 0)
    : undefined;

  const invalidiere = useCallback(() => {
    void qc.invalidateQueries({ queryKey: einsatzKeys.betreuung(einsatzId) });
    void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }, [qc, einsatzId]);

  const belegungZurueckMut = useMutation({
    mutationFn: (meldungId: number) => nimmBelegungZurueck(einsatzId, meldungId),
    onSuccess: (r) => {
      invalidiere();
      message.success(`Meldung zu ${r.stelle.bezeichnung} zurückgenommen`);
    },
    onError: invalidiere,
  });
  const { reset: resetBelegungZurueck, mutate: belegungZuruecknehmen } = belegungZurueckMut;
  const belegungMut = useMutation({
    // Die Funktion merkt ohne Netz selbst vor (LFH-705).
    networkMode: 'always',
    mutationFn: ({ ziel, body }: { ziel: Betreuungsstelle; body: BelegungsmeldungEingabe }) => {
      if (!benutzer) throw new Error('Nicht angemeldet');
      return erfasseBelegungOfflineFaehig(benutzer.id, einsatzId, ziel, body);
    },
    onMutate: () => resetBelegungZurueck(),
    onSuccess: (ergebnis, { ziel, body }) => {
      if (ergebnis.zustand === 'vorgemerkt') {
        message.warning(
          vorgemerktText(ergebnis.grund, `Belegungsmeldung ${ziel.bezeichnung}`),
          vorgemerktDauer(ergebnis.grund),
        );
        return;
      }
      if (ergebnis.zustand === 'beantragt') {
        message.info(`Beantragt: Belegungsmeldung ${ziel.bezeichnung}`);
        return;
      }
      const r = ergebnis.daten;
      invalidiere();
      zeigeRueckgaengig(
        message,
        `Belegung ${r.stelle.bezeichnung} gemeldet: ${personenZahl(body.belegt)} untergebracht`,
        () => belegungZuruecknehmen(r.meldung_id),
      );
    },
  });
  // Die Variablen tragen Stelle und Status davor, damit ein Rückgängig genau diese Stelle in
  // genau diesen Status zurücksetzt, auch wenn inzwischen eine andere Stelle angezeigt wird.
  const statusMut = useMutation({
    mutationFn: ({ id, ziel }: StatusSchritt) => aendereStelle(einsatzId, id, { status: ziel }),
    onSuccess: (s, { id, vorher }) => {
      invalidiere();
      const text = `Betreuungsstelle ${s.bezeichnung}: ${betreuungsstelleStatus[s.status].label}`;
      // „Schließen“ einer leeren Stelle ist umkehrbar (LLH-1722, `frontend/AGENTS.md`, „Beenden:
      // Verb, Ort und Sicherung je Art“): der Rückweg ist der Statusübergang zurück in den Status
      // davor, „vorbereitet“ oder „in Betrieb“. Eine belegte Stelle schließt über die
      // Leermeldung (`schliessenMut`), ohne Rückweg.
      if (s.status === 'geschlossen' && vorher !== 'geschlossen') {
        zeigeRueckgaengig(message, text, () =>
          statusMut.mutate({ id, ziel: vorher, vorher: 'geschlossen' }),
        );
      } else {
        message.success(text);
      }
    },
  });
  // Die Leermeldung vor dem Schließen: ohne Rückgängig-Toast — ein Rückweg auf die alte Zahl
  // ließe eine geschlossene, belegte Stelle zu (der Server lehnt das mit 422 ab).
  const leermeldungMut = useMutation({
    mutationFn: () => meldeBelegung(einsatzId, stelleId, { belegt: 0 }),
    onSuccess: invalidiere,
  });
  const schliessenMut = useMutation({
    mutationFn: (patch: BetreuungsstellePatch) => aendereStelle(einsatzId, stelleId, patch),
    onSuccess: (s) => {
      invalidiere();
      message.success(`Betreuungsstelle ${s.bezeichnung}: geschlossen`);
    },
  });
  /*
   * Feld-CAS mit dem einen Konfliktablauf (LLH-1945, `components/useFeldKonflikt`): die Schlüssel
   * des Patches gehen mit ihrem Wert beim Öffnen als `erwartet` mit (die Koordinate als Paar);
   * nach einem 409 vergleicht die Seite mit dem frisch geladenen Stand derselben Angaben. Die
   * Mutation umfasst den ganzen Ablauf: ihr Fehler (`speichernMut.error`, Grund am Formular) ist
   * erst der endgültige, nicht der 409, den die Rückfrage gerade klärt.
   */
  const konflikt = useFeldKonflikt();
  const loadStelleFrisch = async () => {
    const frisch = await qc.fetchQuery({
      queryKey: einsatzKeys.betreuung(einsatzId),
      queryFn: () => ladeBetreuung(einsatzId),
      staleTime: 0,
    });
    return frisch.stellen.find((x) => x.id === stelleId);
  };
  const speichernMut = useMutation({
    mutationFn: async (v: { beimOeffnen: Betreuungsstelle; patch: BetreuungsstellePatch }) => {
      let gespeichert: Betreuungsstelle | undefined;
      const ergebnis = await konflikt({
        etikett: angabenName(v.patch),
        erwartet: ausschnitt(v.beimOeffnen, v.patch),
        speichern: async (erwartet) => {
          gespeichert = await aendereStelle(einsatzId, stelleId, v.patch, erwartet);
        },
        ladeFrisch: loadStelleFrisch,
        // Eine inzwischen stornierte Stelle fehlt in der Übersicht: dann kein Feldkonflikt, der
        // Grund des Servers steht am Formular.
        aktuell: (frisch) =>
          frisch && { wert: ausschnitt(frisch, v.patch), anzeige: angabenAnzeige(frisch, v.patch) },
        text: ausschnittText,
        leer: ausschnittLeer,
      });
      return { ergebnis, gespeichert };
    },
    onSuccess: ({ gespeichert }) => {
      invalidiere();
      if (gespeichert) message.success(`Betreuungsstelle ${gespeichert.bezeichnung} gespeichert`);
    },
  });
  const saveMitAltwert = async (beimOeffnen: Betreuungsstelle, patch: BetreuungsstellePatch) =>
    (await speichernMut.mutateAsync({ beimOeffnen, patch })).ergebnis;
  const stornoMut = useMutation({
    mutationFn: () => storniereStelle(einsatzId, stelleId),
    onSuccess: (s) => {
      invalidiere();
      message.success(`Betreuungsstelle ${s.bezeichnung} storniert`);
      navigate(betreuungPfad(einsatzId));
    },
  });

  // Die Route hat keinen `key`: der Wechsel zu einer anderen Stelle beendet Sitzung, Dialoge und
  // Gründe der vorigen.
  const { reset: resetStatus } = statusMut;
  const { reset: resetSpeichern } = speichernMut;
  useEffect(() => {
    resetStatus();
    resetSpeichern();
    resetBelegungZurueck();
    setSitzung(null);
    setDialog(null);
  }, [stelleId, resetStatus, resetSpeichern, resetBelegungZurueck]);

  if (einsatzQuery.isLoading || betreuungQuery.isLoading)
    return <ModulGerippeSeite modulKey="betreuung" />;
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Einsatz nicht gefunden oder kein Zugriff"
        ursache={einsatzQuery.error}
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }
  if (betreuungQuery.data == null) {
    return (
      <SeitenFehler
        text="Betreuungsstelle konnte nicht geladen werden"
        ursache={betreuungQuery.error}
        onWiederholen={() => void betreuungQuery.refetch()}
      />
    );
  }
  // Unbekannt, fremd oder storniert: die Übersicht trägt sie nicht. Eine gesehene, die
  // herausfiel und nicht storniert ist, zeigt dasselbe Muster (LLH-1832).
  if (
    !stelle ||
    (verschwunden && (standQuery.isError || (standQuery.isSuccess && !storniertStand)))
  )
    return <StelleNichtGefunden einsatzId={einsatzId} />;

  const einsatz = einsatzQuery.data;
  const s = stelle;
  const geschlossen = s.status === 'geschlossen';
  // Namentlich geführt (LLH-1612, design.md D5): die Belegung meldet der Server aus der
  // Registrierung; Handmeldung, Leermeldung und Rücknahme lehnt er mit 409 ab.
  const namentlichGefuehrt = s.belegungsart === 'namentlich';
  const verortet = s.lat != null && s.lon != null;
  const karteGesperrt = gesperrt('lagekarte');
  const handlung = STATUS_HANDLUNG[s.status];
  const veraltet = betreuungQuery.isError;

  function setzeStatus(ziel: BetreuungsstelleStatus) {
    statusMut.mutate({ id: s.id, ziel, vorher: s.status });
  }

  function statusWechsel() {
    resetStatus();
    if (!namentlichGefuehrt && schliessenBrauchtLeermeldung(handlung.ziel, s.belegung?.belegt)) {
      leermeldungMut.reset();
      schliessenMut.reset();
      setDialog('schliessen');
      return;
    }
    setzeStatus(handlung.ziel);
  }

  function starteBearbeiten() {
    resetSpeichern();
    setSitzung({ beimOeffnen: s, werte: sitzungsWerte(s) });
  }

  const menue: MenueEintrag<KopfMenue>[] = [
    verortet
      ? karteGesperrt
        ? { key: 'karte', label: `Auf Karte zeigen (${KEINE_BERECHTIGUNG})`, gesperrt: true }
        : { key: 'karte', label: 'Auf Karte zeigen' }
      : karteGesperrt
        ? { key: 'verorten', label: `Auf Karte verorten (${KEINE_BERECHTIGUNG})`, gesperrt: true }
        : { key: 'verorten', label: 'Auf Karte verorten' },
    { key: 'stornieren', label: 'Stornieren', gefahr: true },
  ];
  function menueWahl(key: KopfMenue) {
    if (key === 'karte' && verortet) {
      navigate(lagekartePfad(einsatzId, { zentrum: { lat: s.lat!, lon: s.lon! } }));
    } else if (key === 'verorten') {
      // Platziermodus der Lagekarte; „Zurück zu …“ führt danach hierher (LLH-1125).
      navigate(
        lagekartePfad(einsatzId, {
          platzieren: { typ: 'betreuungsstelle', id: s.id, zurueck: true },
        }),
      );
    } else if (key === 'stornieren') {
      stornoMut.reset();
      setDialog('stornieren');
    }
  }

  const kopfAktionen = darfErfassen && !bearbeiten && (
    <Space wrap size="middle">
      <Button
        type="primary"
        disabled={geschlossen || namentlichGefuehrt}
        aria-describedby={geschlossen || namentlichGefuehrt ? meldenGrundId : undefined}
        onClick={() => {
          belegungMut.reset();
          setDialog('belegung');
        }}
      >
        Belegung melden
      </Button>
      {/* Der Grund steht sichtbar daneben, nicht nur im Tooltip (LFH-1078). */}
      {(geschlossen || namentlichGefuehrt) && (
        <Typography.Text id={meldenGrundId} type="secondary">
          {geschlossen ? 'Stelle geschlossen' : NAMENTLICH_SPERRE}
        </Typography.Text>
      )}
      {darfSchreiben && (
        <>
          <Button loading={statusMut.isPending} onClick={statusWechsel}>
            {handlung.text}
          </Button>
          <MenueAusloeser
            eintraege={menue}
            zugaenglicherName={`Weitere Aktionen zu Stelle ${s.bezeichnung}`}
            onWahl={menueWahl}
          />
        </>
      )}
    </Space>
  );

  // Eine Zelle: in der Sitzung eine benannte Eingabe mit Prüffehler darunter, sonst die Anzeige.
  const zelle = (
    name: keyof StelleWerte,
    label: string,
    eingabe: ReactElement<{ id?: string }>,
    anzeige: ReactNode,
    {
      breit = false,
      mono = false,
      rules,
    }: { breit?: boolean; mono?: boolean; rules?: FormRule[] } = {},
  ) =>
    bearbeiten ? (
      <DatenfeldEingabe label={label} name={name} rules={rules} breit={breit}>
        {storniert ? entwurfNurLesen(eingabe) : eingabe}
      </DatenfeldEingabe>
    ) : (
      <Datenfeld label={label} mono={mono} breit={breit}>
        {anzeige}
      </Datenfeld>
    );

  const stammdaten = (
    <Datenraster spalten={3} beschriftung="Stammdaten der Stelle">
      {zelle(
        'bezeichnung',
        'Bezeichnung',
        <Input count={zeichenGrenze(BETREUUNG_STELLE_BEZEICHNUNG_MAX)} />,
        s.bezeichnung,
        {
          rules: [bezeichnungRegel, zeichenRegel(BETREUUNG_STELLE_BEZEICHNUNG_MAX, 'Bezeichnung')],
        },
      )}
      {zelle('art', 'Art', <Select options={ART_OPTIONEN} />, ART_LABEL[s.art], {
        rules: [pflicht('Art')],
      })}
      {zelle(
        'belegungsart',
        'Belegungsart',
        <Select options={BELEGUNGSART_OPTIONEN} />,
        BELEGUNGSART_LABEL[s.belegungsart],
        { rules: [pflicht('Belegungsart')] },
      )}
      {zelle(
        'kapazitaet_personen',
        'Kapazität (Personen)',
        <ZahlFeld min={1} ganz placeholder="keine Angabe" />,
        s.kapazitaet_personen != null ? personenZahl(s.kapazitaet_personen) : leer,
        { mono: true, rules: [hoechstensRegel] },
      )}
      {zelle(
        'abschnitt_id',
        'Einsatzabschnitt',
        <Select
          allowClear
          placeholder="ohne Abschnitt"
          options={abschnitte}
          notFoundContent="Keine Einsatzabschnitte angelegt"
        />,
        s.abschnitt_name ?? leer,
      )}
      {/* Ortsfeld mit Vorschau (LLH-1121): ein Treffer, eine getippte Koordinate oder ein Punkt auf
          der Karte verortet die Stelle; beim Bearbeiten zeigt die Vorschau den Punkt. */}
      {zelle(
        'standort',
        'Standort',
        <EinsatzOrtsfeld
          einsatzId={einsatzId}
          etikett="Standort"
          exclude={`betreuungsstelle:${s.id}`}
          count={zeichenGrenze(BETREUUNG_STELLE_STANDORT_MAX)}
        />,
        s.standort ?? leer,
        {
          breit: bearbeiten,
          rules: [ortZeichenRegel(BETREUUNG_STELLE_STANDORT_MAX, 'Standort')],
        },
      )}
      {!bearbeiten && (
        <Datenfeld label="Koordinate">
          {verortet ? (
            <Stapel richtung="zeile" umbruch abstand="xs" ausrichten="mitte">
              <span style={monoStil('monoGross')}>
                {s.lat!.toFixed(5)}, {s.lon!.toFixed(5)}
              </span>
              {!karteGesperrt && (
                <Link to={lagekartePfad(einsatzId, { zentrum: { lat: s.lat!, lon: s.lon! } })}>
                  Auf Karte zeigen
                </Link>
              )}
            </Stapel>
          ) : (
            <Typography.Text type="secondary">nicht verortet</Typography.Text>
          )}
        </Datenfeld>
      )}
      {zelle(
        'leitung',
        'Leitung',
        <Input count={zeichenGrenze(BETREUUNG_LEITUNG_MAX)} />,
        s.leitung ?? leer,
        { rules: [zeichenRegel(BETREUUNG_LEITUNG_MAX, 'Leitung')] },
      )}
      {zelle(
        'kontaktweg',
        'Kontakt',
        <Input count={zeichenGrenze(BETREUUNG_KONTAKTWEG_MAX)} />,
        s.kontaktweg ?? leer,
        { mono: true, rules: [zeichenRegel(BETREUUNG_KONTAKTWEG_MAX, 'Kontakt')] },
      )}
      {zelle(
        'notiz',
        'Notiz',
        <Input.TextArea
          autoSize={{ minRows: 2 }}
          count={zeichenGrenze(BETREUUNG_STELLE_NOTIZ_MAX)}
        />,
        s.notiz ?? leer,
        { breit: true, rules: [zeichenRegel(BETREUUNG_STELLE_NOTIZ_MAX, 'Notiz')] },
      )}
    </Datenraster>
  );

  const gesamt = inBetreuung(stellen);
  const verpflegungGesperrt = gesperrt('verpflegung');

  const fehlerHinweis =
    statusMut.error != null
      ? { fehler: statusMut.error, titel: 'Status nicht geändert' }
      : { fehler: belegungZurueckMut.error, titel: 'Meldung konnte nicht zurückgenommen werden' };

  return (
    <EinsatzSeite
      titel={
        <Stapel richtung="zeile" umbruch abstand="sm" ausrichten="mitte">
          <span>Betreuungsstelle {s.bezeichnung}</span>
          <Marke>{ART_LABEL[s.art]}</Marke>
          <Status darstellung={betreuungsstelleStatus[s.status]} />
        </Stapel>
      }
      dataUpdatedAt={betreuungQuery.dataUpdatedAt}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            {
              title: (
                <ListenRueckweg to={betreuungPfad(einsatzId)}>
                  {modulName('betreuung')}
                </ListenRueckweg>
              ),
            },
            { title: s.bezeichnung },
          ]}
        />
      }
      aktionen={kopfAktionen || undefined}
      hinweis={
        storniertStand ? (
          <StornoBanner stand={storniertStand} />
        ) : (
          <SeitenHinweise
            rechteFehlt={!darfSchreibenImEinsatz}
            rechteText={einsatzRechteGrund(einsatz)}
            fehler={fehlerHinweis.fehler}
            fehlerTitel={fehlerHinweis.titel}
          />
        )
      }
    >
      <VerlassenRueckfrage ungespeichert={schutz.ungespeichert} />
      <Stapel abstand="lg">
        {veraltet && <SeitenStandVeraltet onWiederholen={() => void betreuungQuery.refetch()} />}
        <StelleBelegung stelle={s} namentlich={namentlich} />
        {/* Was die Stelle braucht, direkt unter dem, was sie hat (LLH-1082). */}
        <StelleBedarf
          einsatzId={einsatzId}
          stelleId={s.id}
          freigaben={freigaben}
          darfSchreiben={darfSchreiben}
        />
        <StelleUnterkunft
          einsatzId={einsatzId}
          stelleId={s.id}
          kapazitaet={s.kapazitaet_personen ?? null}
          planbar={!storniert}
        />
        <RegistrierungPaneel
          einsatzId={einsatzId}
          stelle={s}
          personenFrei={personenFrei}
          darfSchreiben={darfErfassen}
          rechteGrund={storniert ? 'Stelle storniert' : einsatzRechteGrund(einsatz)}
        />

        <Paneel
          titel="Stelle"
          koerperPolster
          aktion={
            darfSchreiben && !bearbeiten ? (
              <Button onClick={starteBearbeiten}>Bearbeiten</Button>
            ) : undefined
          }
        >
          {sitzung ? (
            <Form<StelleWerte>
              form={form}
              layout="vertical"
              initialValues={sitzung.werte}
              // Ohne `preserve` überlebten die Werte einer abgebrochenen Sitzung im Formularspeicher
              // und gingen beim nächsten „Bearbeiten“ den `initialValues` vor.
              preserve={false}
              onValuesChange={schutz.geaendert}
              // Nach gescheiterter Prüfung steht der Fokus im ersten Feld mit Meldung (LLH-1101).
              scrollToFirstError={{ focus: true }}
              onFinish={(werte) => {
                if (storniert) return;
                // Dreiseitig: nur, was hier geändert wurde UND vom aktuellen Stand abweicht.
                const patch = stellePatchDreiseitig(sitzung.beimOeffnen, s, werte);
                if (Object.keys(patch).length === 0) {
                  setSitzung(null);
                  return;
                }
                const fassung = schutz.fassung();
                saveMitAltwert(sitzung.beimOeffnen, patch).then(
                  (ergebnis) => {
                    // Escape oder Schließen der Rückfrage: die Sitzung bleibt offen, ohne Fehler.
                    if (ergebnis === OFFEN_LASSEN) {
                      resetSpeichern();
                      return;
                    }
                    // Verworfen: nichts gespeichert, die Ansicht zeigt den frischen Stand.
                    if (ergebnis === VERWORFEN) resetSpeichern();
                    schutz.gespeichert(fassung);
                    setSitzung(null);
                  },
                  // Der Grund steht am Formular (`speichernMut.error`).
                  () => undefined,
                );
              }}
            >
              <AenderungsstandProvider ausgangswerte={sitzung.werte}>
                <EnterOhneAenderung onSchliessen={() => setSitzung(null)}>
                  {stammdaten}
                  {speichernMut.error != null && (
                    <div style={{ marginTop: 'var(--lfh-luft-4)' }}>
                      <SpeicherFehler
                        fehler={speichernMut.error}
                        titel="Betreuungsstelle konnte nicht gespeichert werden"
                      />
                    </div>
                  )}
                  <div
                    {...speicherLeiste}
                    style={{ ...speicherLeiste.style, marginTop: 'var(--lfh-luft-4)' }}
                  >
                    {storniert ? (
                      // Storniert (LLH-1832): nichts mehr zu speichern, der Entwurf bleibt lesbar.
                      <Button onClick={() => setSitzung(null)}>Schließen</Button>
                    ) : (
                      <>
                        <SpeicherKnopf loading={speichernMut.isPending} />
                        {/* Bis zur Antwort gesperrt: ihre Ablehnung braucht das Formular als Ort. */}
                        <Button disabled={speichernMut.isPending} onClick={() => setSitzung(null)}>
                          Abbrechen
                        </Button>
                      </>
                    )}
                  </div>
                </EnterOhneAenderung>
              </AenderungsstandProvider>
            </Form>
          ) : (
            stammdaten
          )}
        </Paneel>

        <Paneel titel="Meldeverlauf" koerperPolster>
          <StelleBelegungslinie
            einsatzId={einsatzId}
            stelleId={s.id}
            kapazitaet={s.kapazitaet_personen ?? null}
          />
          <MeldeVerlauf
            einsatzId={einsatzId}
            art="stelle"
            objektId={s.id}
            {...verlaufRuecknahme(s, darfSchreiben)}
          />
        </Paneel>

        {personenFrei ? (
          <Paneel
            titel="Betroffene hier"
            meta={namentlich ? `namentlich ${personenZahl(namentlich)}` : undefined}
          >
            <StelleBetroffene einsatzId={einsatzId} stelleId={s.id} />
          </Paneel>
        ) : (
          // Benannt statt stumm (M16): das Paneel fehlt, die Zeile sagt warum.
          <Typography.Text type="secondary" data-lfh="betroffene-ohne-recht">
            Betroffene hier · {KEINE_BERECHTIGUNG}
          </Typography.Text>
        )}

        <Paneel
          titel="Verpflegung"
          koerperPolster
          aktion={
            verpflegungGesperrt ? undefined : (
              <PaneelLink
                label={`Zur ${modulName('verpflegung')}`}
                onKlick={() => navigate(verpflegungPfad(einsatzId))}
              />
            )
          }
        >
          {s.belegung == null ? (
            <Typography.Text type="secondary">keine Meldung</Typography.Text>
          ) : (
            <Typography.Text>
              Belegt <span style={monoStil('monoGross')}>{personenZahl(s.belegung.belegt)}</span>{' '}
              von{' '}
              <span style={monoStil('monoGross')}>{personenZahl(gesamt ?? s.belegung.belegt)}</span>{' '}
              in Betreuung
            </Typography.Text>
          )}
        </Paneel>
      </Stapel>

      {dialog === 'belegung' && (
        <BelegungMeldenDialog
          stelle={s}
          laeuft={belegungMut.isPending}
          fehler={belegungMut.error}
          onErfassen={(body) => belegungMut.mutateAsync({ ziel: s, body })}
          onSchliessen={schliessen}
        />
      )}
      {dialog === 'schliessen' && (
        <StelleSchliessenDialog
          stelle={s}
          laeuft={schliessenMut.isPending || leermeldungMut.isPending}
          fehler={leermeldungMut.error ?? schliessenMut.error}
          onLeermeldung={() => leermeldungMut.mutateAsync()}
          onErfassen={(patch) => schliessenMut.mutateAsync(patch)}
          onSchliessen={schliessen}
        />
      )}
      {dialog === 'stornieren' && (
        <StornierenDialog
          titel={`Betreuungsstelle ${s.bezeichnung} stornieren?`}
          text="Nur für Fehlanlagen. Nicht umkehrbar; der ETB-Nachweis bleibt."
          stattdessen={
            geschlossen
              ? undefined
              : {
                  text: 'Stattdessen schließen',
                  onKlick: () => {
                    setDialog(null);
                    if (
                      !namentlichGefuehrt &&
                      schliessenBrauchtLeermeldung('geschlossen', s.belegung?.belegt)
                    ) {
                      leermeldungMut.reset();
                      schliessenMut.reset();
                      setDialog('schliessen');
                    } else {
                      resetStatus();
                      setzeStatus('geschlossen');
                    }
                  },
                }
          }
          laeuft={stornoMut.isPending}
          fehler={stornoMut.error}
          onBestaetigen={() => stornoMut.mutate()}
          onSchliessen={schliessen}
        />
      )}
    </EinsatzSeite>
  );
}
