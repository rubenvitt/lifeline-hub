import { Alert, Breadcrumb, Button, Flex, Form, Spin } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useUhr } from '../abloesung/useUhr';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { ladeEinsatz, ladeModulFreigaben } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';
import type { Kostform, VerpflegungAusgabe, VerpflegungZeitfenster } from '../api/types';
import { ladeVerpflegung, nimmAusgabeZurueck } from '../api/verpflegung';
import { useAuth } from '../auth/AuthContext';
import EinsatzSeite from '../components/EinsatzSeite';
import { ErfassungsModal } from '../components/Erfassung';
import { MengenFeld } from '../components/MengenFeld';
import { MenueAusloeser } from '../components/MenueAusloeser';
import { SeitenFehler, SeitenLeer } from '../components/SeitenZustand';
import { SeitenHinweise, SpeicherFehler } from '../components/SpeicherHinweis';
import { SprungKnopf } from '../components/Sprung';
import StatusTag from '../components/StatusTag';
import { FOKUSABSTAND_ZAEHLTASTEN, useFokusabstandUnten } from '../components/fokusabstandUnten';
import { REST_UNTEN_VAR, useRestHoehe } from '../components/restHoehe';
import {
  Augenbraue,
  Aufgliederung,
  Kennzahl,
  Kennzahlenband,
  Zeitachseneintrag,
  monoStil,
  useRollen,
} from '../components/instrument';
import { einsatzRechteGrund } from '../components/nurAnsicht';
import { useViewport } from '../components/useViewport';
import { modulName } from '../einsatz/modulRegistry';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useGeraetDarf } from '../geraet/geraetSicht';
import { useOnline } from '../offline/useOnline';
import { useVorgemerkteAusgaben } from '../offline/useVorgemerkteAusgaben';
import { useEinsatzPfade } from '../routing/EinsatzPfade';
import { parseVerpflegungStelle } from '../routing/deeplinks';
import { Select } from '../components/Select';
import { useDichte } from '../theme/ThemeModeProvider';
import type { Dichte } from '../theme/tokens';
import { rollenFarbe, verpflegungDeckung } from '../theme/statusFarben';
import { AusgabeDialog, RuecknahmeDialog } from './VerpflegungDialoge';
import type { Buendel } from './ausgabeSammlung';
import EmpfaengerStand from './EmpfaengerStand';
import {
  LEERE_EMPFAENGER,
  OHNE_EMPFAENGER,
  empfaengerOptionen,
  empfaengerSchluessel,
  empfaengerText,
  hatWaehlbareEmpfaenger,
  isEmpfaengerWaehlbar,
  parseEmpfaengerSchluessel,
  staerkeVorgabe,
  type EmpfaengerWahl,
} from './empfaengerKern';
import { FEHLT_TON, deckungEinstufung, istVergangen } from './deckung';
import { useAusgabeNachtragen } from './useAusgabeNachtragen';
import { loadGemerkteStelle, saveGemerkteStelle } from './stellenGedaechtnis';
import { eigeneStelle, stellenName, stellenWahl } from './stellenKern';
import { useAusgabeSammlung } from './useAusgabeSammlung';
import { useNachforderungWahl } from './useNachforderungWahl';
import {
  KOSTFORMEN,
  KOSTFORM_LABEL,
  sonderkostText,
  sonderkostVoll,
  uhrzeit,
  zeitraumText,
  zitat,
} from './verpflegungText';
import { zaehltasteStil, zaehltastenAbstand } from './zaehltasteStil';

/** So viele Buchungen stehen unter „Letzte Buchungen“; ältere führt ein Link zur Karte (D6). */
const LETZTE = 10;

/** Kurzgrund an „−1“ und „Buchen“, solange nichts gesammelt ist (AK 4). */
const KEINE_SAMMLUNG = 'keine Sammlung';
/** Kurzgrund an allen Zähltasten eines vergangenen Zeitfensters (D7). */
const ZEITFENSTER_VORBEI = 'Zeitfenster vorbei';

/** Eine Zeile, die nie umbricht und sich mit „…“ kürzt: ein Tipp ändert so keine Höhe (D3). */
const einzeilig = {
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
} as const;

/** „ · an 2. Gruppe“; leer ohne Text. */
function mitPunkt(text: string): string {
  return text ? ` · ${text}` : '';
}

/** „ (davon 2 vegetarisch)“ zu einem Bündel, leer ohne Sonderkost. */
function davon(b: Buendel): string {
  const sk = sonderkostText(sonderkostVoll(b.sonderkost));
  return sk ? ` (${sk})` : '';
}

/**
 * Ausgabeansicht eines Zeitfensters (LLH-1032, design.md D1–D10; Spec `kraefte-verpflegung`,
 * „Ausgabe zählen“): Portionen an der Ausgabe zählen statt ein Formular je Ausgabe.
 *
 * Gezählt wird in eine Sammlung (`useAusgabeSammlung`), die als EINE Ausgabe gebucht wird: nach
 * 3 s ohne Tipp, spätestens 15 s nach dem ersten, ab 50 Portionen, über „Buchen“ und wenn das
 * Zeitfenster vergangen wird. Beim Verlassen, beim Wechsel des Zeitfensters und beim Verbergen
 * geht sie ohne Hinweis in die Warteschlange (D5).
 *
 * Kopf (D3): Soll, ausgegeben und fehlt sind die Zahlen des Servers. „Sammlung“ und „ausstehend“
 * stehen daneben und zählen nie in „fehlt“ und die Einstufung; nur die Aufgliederung zeigt sie als
 * Länge. Die Sammelzeile, das Band „Offline vorgemerkt“, die Fehlerzeile und die Grundzeile des
 * Tastenfelds haben feste Plätze: ein Tipp, ein Netzwechsel oder eine Ablehnung verschiebt keine
 * Taste unter dem Finger.
 *
 * Tasten (D9): „+1“ ist die einzige Primärtaste, in jeder Dichtestufe mindestens 72 px, am
 * unteren Rand im klebenden Tastenfeld; alle übrigen folgen der Staffel (`zaehltasteStil`).
 * Gesperrte Tasten nennen ihren Grund sichtbar in der Grundzeile und per `aria-describedby`
 * (LFH-966). Ohne Schreibrecht bleibt alles gesperrt sichtbar (M16); der Grund steht zusätzlich
 * im Seitenhinweis.
 *
 * Stab und Gerät teilen die Seite; Pfade über `useEinsatzPfade` (D1).
 *
 * Stelle (LLH-1040, design.md D13 Punkt 7): Am Platz `ausgabe-stelle` im Kopf steht die Wahl der
 * Verpflegungsstelle, die zugeordneten zuerst, ohne aufgelöste, daneben das Ist der gewählten
 * Stelle aus `je_stelle`. Vorgewählt wird in dieser Folge: `?stelle=` aus der Karte, am Desktop die
 * gemerkte Wahl des Einsatzes (`stellenGedaechtnis`), sonst die einzige zugeordnete Stelle. Eine
 * Hand-Wahl gilt bis zum Verlassen und wird am Desktop gemerkt, am Gerät nicht (LLH-1048). Ein
 * Wechsel bucht das offene Bündel an der alten Stelle (`useAusgabeSammlung`). Ein an eine
 * Verpflegungsstelle gebundenes Gerät (LLH-1048 Teil II, `eigeneStelle`) wählt nicht: seine Stelle
 * steht fest als Text mit ihrem Ist, und jedes Bündel und jeder Nachtrag trägt sie.
 *
 * Empfänger (LLH-1055 Teil II, Entscheidung LLH-1024 F3): Am Platz `ausgabe-empfaenger` steht die
 * Wahl „ohne Empfänger“ (Vorgabe, das Zählen bleibt so schnell wie ohne), eine Einheit (Abholung)
 * oder ein Abschnitt (Zuführung), alles aus der Projektion `empfaenger` in `GET …/verpflegung`.
 * Mit einer Einheit steht daneben die Taste „+n“: sie zählt die Ist-Stärke ihres Teilbaums in die
 * Sammlung, „−1“ und „Menge …“ (vorbelegt mit derselben Zahl) überschreiben. Gemerkt wird die Wahl
 * nirgends; sie gilt bis zum Wechsel des Zeitfensters. Ein Wechsel bucht das offene Bündel beim
 * alten Empfänger. Unter den Tasten zeigt `EmpfaengerStand`, wer noch nicht verpflegt ist; „Wählen“
 * an einer Zeile setzt die Einheit als Empfänger (Handschuh: die Zeile statt der Auswahlliste).
 */
/**
 * Mindestbreite einer Kennzahl im Kopf je Dichte: was „1840 EP“ samt Innenabstand braucht,
 * gemessen bei 320 bis 390 px (kompakt 110, komfortabel 122, Handschuh über 126), mit etwas Luft.
 * Kompakt stehen so bei 390 px alle drei in einer Zeile.
 */
const KENNZAHL_ZELLE_MIN: Record<Dichte, number> = {
  kompakt: 112,
  komfortabel: 124,
  handschuh: 160,
};

export default function AusgabeAnsicht() {
  const { id, zeitfensterId } = useParams();
  const einsatzId = Number(id);
  const zfId = Number(zeitfensterId);
  const { benutzer, geraet } = useAuth();
  const [suchParameter] = useSearchParams();
  const darf = useGeraetDarf();
  const pfade = useEinsatzPfade();
  const jetzt = useUhr();
  const online = useOnline();
  const { istSchmal } = useViewport();
  const { token, rollen } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const qc = useQueryClient();
  const grundId = useId();
  const tastenRef = useFokusabstandUnten(token.marginSM, FOKUSABSTAND_ZAEHLTASTEN);
  const restHoehe = useRestHoehe<HTMLDivElement>();
  const { dichte } = useDichte();

  const [dialog, setDialog] = useState<
    | { art: 'nachtragen' }
    | { art: 'menge' }
    | { art: 'ruecknahme'; ausgabe: VerpflegungAusgabe }
    | null
  >(null);
  const [mengeForm] = Form.useForm<{ menge: number }>();

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const verpflegungQuery = useQuery({
    queryKey: einsatzKeys.verpflegung(einsatzId),
    queryFn: () => ladeVerpflegung(einsatzId),
  });
  const freigabenQuery = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
  });
  const nachforderung = useNachforderungWahl(einsatzId, freigabenQuery.data);
  const nachtrag = useAusgabeNachtragen(einsatzId);

  const zf = verpflegungQuery.data?.zeitfenster.find((z) => z.id === zfId) ?? null;

  // ── Stellenwahl (LLH-1040) ─────────────────────────────────────────────────────────────
  const stellen = verpflegungQuery.data?.stellen ?? [];
  const amDesktop = geraet == null;
  // Gebundenes Gerät (LLH-1048): die Stelle steht fest, keine Wahl, keine Vorwahl.
  const feste = eigeneStelle(geraet, stellen);
  const wahl = stellenWahl(stellen, zf);
  const waehlbar = [...wahl.zugeordnet, ...wahl.weitere];
  const isWaehlbar = (sid: number | null): sid is number =>
    sid != null && waehlbar.some((s) => s.id === sid);
  const gemerkt = useMemo(
    () => (amDesktop ? loadGemerkteStelle(einsatzId) : null),
    [amDesktop, einsatzId],
  );
  const ausKarte = parseVerpflegungStelle(suchParameter);
  const vorwahl = isWaehlbar(ausKarte)
    ? ausKarte
    : isWaehlbar(gemerkt)
      ? gemerkt
      : wahl.zugeordnet.length === 1
        ? wahl.zugeordnet[0].id
        : null;
  // Die Vorwahl gilt beim Öffnen (D13 Punkt 7): einmal festgehalten, sobald Zeitfenster und
  // Anmeldung (Gerät oder Desktop) geladen sind. Danach ändert nur eine Handlung die Wahl, keine
  // Live-Änderung der Zuordnung; sonst wechselte die Stelle mitten im Zählen und
  // `useAusgabeSammlung` buchte das Bündel ungefragt.
  const wahlSchluessel = `${zfId}:${ausKarte ?? ''}`;
  const [festeWahl, setFesteWahl] = useState<{ schluessel: string; stelle: number | null }>();
  if (zf != null && benutzer != null && festeWahl?.schluessel !== wahlSchluessel) {
    setFesteWahl({ schluessel: wahlSchluessel, stelle: vorwahl });
  }
  const festgehalten = festeWahl?.schluessel === wahlSchluessel ? festeWahl.stelle : null;
  // Eine inzwischen aufgelöste Stelle fällt aus der Wahl. Am gebundenen Gerät gilt die eigene,
  // auch aufgelöst: dann lehnt der Server eine neue Ausgabe ab (409), eine vorher gezählte nicht.
  const gewaehlteStelle = feste ? feste.id : isWaehlbar(festgehalten) ? festgehalten : null;
  const selectStelle = (sid: number | null) => {
    setFesteWahl({ schluessel: wahlSchluessel, stelle: sid });
    if (amDesktop) saveGemerkteStelle(einsatzId, sid);
  };
  // ── Empfänger (LLH-1055 Teil II) ─────────────────────────────────────────────────────────
  const empfaengerListe = verpflegungQuery.data?.empfaenger ?? LEERE_EMPFAENGER;
  const hatEmpfaenger = hatWaehlbareEmpfaenger(empfaengerListe);
  // Die Wahl gilt je Zeitfenster; eine inzwischen aufgelöste Einheit oder geschlossene oder
  // stornierte Betreuungsstelle (LLH-1295) fällt aus ihr.
  const [empfaengerWahl, setEmpfaengerWahl] = useState<{
    zeitfenster: number;
    wahl: EmpfaengerWahl | null;
  }>({ zeitfenster: zfId, wahl: null });
  const roheWahl = empfaengerWahl.zeitfenster === zfId ? empfaengerWahl.wahl : null;
  const gewaehlterEmpfaenger = isEmpfaengerWaehlbar(roheWahl, empfaengerListe) ? roheWahl : null;
  const empfaengerEinheit =
    gewaehlterEmpfaenger?.art === 'einheit'
      ? empfaengerListe.einheiten.find((e) => e.id === gewaehlterEmpfaenger.id)
      : undefined;
  const staerke = empfaengerEinheit ? staerkeVorgabe(empfaengerEinheit) : null;
  const selectEmpfaenger = (wahl: EmpfaengerWahl | null) =>
    setEmpfaengerWahl({ zeitfenster: zfId, wahl });

  const darfSchreiben = darfImEinsatzSchreiben(einsatzQuery.data);
  const vergangen = zf != null && istVergangen(zf, jetzt);

  const vorgemerkt = useVorgemerkteAusgaben(benutzer?.id, einsatzId);
  const ausstehend = useMemo(
    () =>
      vorgemerkt
        .filter((v) => v.aktion.zeitfenster_id === zfId)
        .sort((a, b) =>
          (b.aktion.daten.zeitpunkt_at ?? '').localeCompare(a.aktion.daten.zeitpunkt_at ?? ''),
        ),
    [vorgemerkt, zfId],
  );
  const ausstehendMenge = ausstehend.reduce((n, v) => n + v.aktion.daten.menge, 0);

  const sammlung = useAusgabeSammlung({
    benutzerId: benutzer?.id,
    einsatzId,
    zeitfenster: zf ? { id: zf.id, bezeichnung: zf.bezeichnung } : null,
    vergangen,
    stelleId: gewaehlteStelle,
    empfaenger: gewaehlterEmpfaenger,
    onGebucht: (ausgabeId, b) =>
      nachtrag.zeigeGebucht(
        `Gebucht: ${b.menge} EP zu ${zitat(zf?.bezeichnung ?? '')}${davon(b)}`,
        ausgabeId,
      ),
    onVorgemerkt: (b) =>
      nachtrag.zeigeVorgemerkt(
        `Offline vorgemerkt: ${b.menge} EP zu ${zitat(zf?.bezeichnung ?? '')}`,
      ),
  });

  // Rücknahme aus der Liste: endgültig, mit Rückfrage; der Fehler steht im Dialog.
  const ruecknahmeMut = useMutation({
    mutationFn: (ausgabeId: number) => nimmAusgabeZurueck(einsatzId, ausgabeId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: einsatzKeys.verpflegung(einsatzId) });
      setDialog(null);
    },
  });

  // Kaltstart ohne Netz: die Abfragen warten angehalten, es gibt nichts zu zählen (Risiken).
  const angehalten = (q: { isPending: boolean; fetchStatus: string }) =>
    q.isPending && q.fetchStatus === 'paused';
  if (angehalten(einsatzQuery)) {
    return (
      <EinsatzSeite titel="Ausgabe">
        <SeitenFehler text="Zeitfenster nicht geladen" />
      </EinsatzSeite>
    );
  }
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
  const rechteText = einsatzRechteGrund(einsatz.status);
  const verpflegungPfad = pfade.verpflegung(einsatzId);

  const ortspfad = (titel: string) =>
    darf('fremde-module') && (
      <Breadcrumb
        items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: einsatz.bezeichnung },
          { title: <Link to={verpflegungPfad}>{modulName('verpflegung')}</Link> },
          { title: titel },
        ]}
      />
    );

  const nichtGeladen = verpflegungQuery.isError || angehalten(verpflegungQuery);
  if (zf == null) {
    return (
      <EinsatzSeite titel="Ausgabe" breadcrumb={ortspfad('Ausgabe')}>
        {nichtGeladen ? (
          <SeitenFehler
            text="Zeitfenster nicht geladen"
            ursache={verpflegungQuery.error}
            onWiederholen={() => void verpflegungQuery.refetch()}
          />
        ) : verpflegungQuery.isPending ? (
          <Spin />
        ) : (
          <SeitenLeer
            titel="Dieses Zeitfenster gibt es nicht (mehr)"
            aktion={{ label: 'Zur Verpflegung', pfad: verpflegungPfad }}
          />
        )}
      </EinsatzSeite>
    );
  }

  const stufe = deckungEinstufung(zf, jetzt);
  const darstellung = verpflegungDeckung[stufe];
  const ausgegebenFarbe = stufe === 'offen' ? rollen.text2 : rollenFarbe(darstellung.rolle, token);
  const rest = Math.max(
    0,
    zf.bedarf.gesamt - zf.ausgegeben.gesamt - sammlung.menge - ausstehendMenge,
  );

  // Gründe der Sperren; einer gilt für alle Zähltasten, „keine Sammlung“ nur für „−1“ und „Buchen“.
  const tastenGrund = !darfSchreiben ? rechteText : vergangen ? ZEITFENSTER_VORBEI : null;
  const tastenGesperrt = tastenGrund != null;
  const zuruckGesperrt = tastenGesperrt || !sammlung.offen;
  const grundText = tastenGrund ?? (sammlung.offen ? '' : KEINE_SAMMLUNG);
  const beschrieben = (gesperrt: boolean) => (gesperrt ? grundId : undefined);

  const mitBedarf = KOSTFORMEN.filter((k) => zf.bedarf.sonderkost[k] > 0);
  const ohneBedarf = KOSTFORMEN.filter((k) => zf.bedarf.sonderkost[k] === 0);

  const serverAusgaben = [...zf.ausgaben].sort((a, b) =>
    b.zeitpunkt_at.localeCompare(a.zeitpunkt_at),
  );
  const zeilenAusstehend = ausstehend.slice(0, LETZTE);
  const zeilenServer = serverAusgaben.slice(0, Math.max(0, LETZTE - zeilenAusstehend.length));
  const aeltere = ausstehend.length + serverAusgaben.length - LETZTE;

  const sammelSonderkost = sonderkostText(sammlung.sonderkost);

  const uebrige = zaehltasteStil(token, 'uebrige');
  const abstand = zaehltastenAbstand(token);

  const oeffneNachtragen = () => {
    nachtrag.zuruecksetzen();
    setDialog({ art: 'nachtragen' });
  };

  return (
    <EinsatzSeite
      titel={zf.bezeichnung}
      meta={zeitraumText(zf, konventionen)}
      dataUpdatedAt={verpflegungQuery.dataUpdatedAt}
      breadcrumb={ortspfad(zf.bezeichnung)}
      weitere={{
        name: `Weitere Aktionen zur Ausgabe ${zitat(zf.bezeichnung)}`,
        eintraege: [
          darfSchreiben
            ? { key: 'nachtragen', label: 'Ausgabe nachtragen', onWahl: oeffneNachtragen }
            : {
                key: 'nachtragen',
                label: `Ausgabe nachtragen (${rechteText})`,
                onWahl: () => {},
                gesperrt: true,
              },
        ],
      }}
      // Nur der Rechtehinweis: er steht ab dem ersten Bild. Der Grund einer abgelehnten Rücknahme
      // käme erst später und schöbe hier alle Tasten nach unten; er steht unter den
      // Sonderkost-Tasten (Spec: eine Ablehnung verschiebt keine Zähltaste).
      hinweis={!darfSchreiben && <SeitenHinweise rechteFehlt rechteText={rechteText} />}
    >
      <div
        ref={restHoehe}
        data-lfh="ausgabe-ansicht"
        // Mindestens bis zur Unterkante des Bildlaufs: das klebende Tastenfeld steht so immer am
        // unteren Rand, auch bei kurzer Liste (D9, Daumenreichweite). Gemessen statt `100dvh`, sonst
        // rollte die Seite um Kopfleiste und Gerätenavigation, und der Kopf ginge aus dem Bild
        // (LLH-1294).
        style={{ display: 'flex', flexDirection: 'column', gap: token.margin }}
      >
        {/* ── Kopf: Deckung ─────────────────────────────────────────────────────────── */}
        <section
          aria-label={`Deckung ${zf.bezeichnung}`}
          data-lfh="ausgabe-kopf"
          data-einstufung={stufe}
          style={{
            minWidth: 0,
            background: rollen.paneel,
            border: `1px solid ${rollen.linie}`,
            borderInlineStart: `3px solid ${stufe === 'offen' ? rollen.linie : ausgegebenFarbe}`,
          }}
        >
          <Flex
            justify="space-between"
            align="center"
            gap={token.marginSM}
            wrap
            style={{ paddingBlock: token.paddingSM, paddingInline: token.padding }}
          >
            <StatusTag darstellung={darstellung} />
            {/* Fester Platz: das Band erscheint ohne Netz, ohne die Zeile wachsen zu lassen. */}
            <span
              role="status"
              data-lfh="ausgabe-offline"
              style={{ ...monoStil(12, 500), color: rollen.text2, minHeight: 22 }}
            >
              {online ? '' : 'Offline vorgemerkt'}
            </span>
          </Flex>
          <Kennzahlenband
            beschriftung={`Deckung ${zf.bezeichnung}`}
            // Soll, ausgegeben und fehlt möglichst in einer Zeile: zwei Zeilen kosteten bei
            // 390 × 700 so viel Höhe, dass die Ansicht rollen müsste und der Kopf aus dem Bild
            // ginge (LLH-1294). Wo die Zelle für eine vierstellige Zahl zu schmal wird, bricht das
            // Band um, statt überzulaufen.
            style={{
              gridTemplateColumns: `repeat(auto-fit, minmax(min(${KENNZAHL_ZELLE_MIN[dichte]}px, 100%), 1fr))`,
            }}
          >
            <Kennzahl titel="Soll" wert={zf.bedarf.gesamt} einheit="EP" />
            <Kennzahl titel="ausgegeben" wert={zf.ausgegeben.gesamt} einheit="EP" />
            <Kennzahl
              titel="fehlt"
              wert={zf.fehlmenge.gesamt}
              einheit="EP"
              ton={FEHLT_TON[stufe]}
            />
          </Kennzahlenband>
          <div style={{ paddingBlock: token.paddingSM, paddingInline: token.padding }}>
            <Aufgliederung
              titel="Ausgabe"
              hoehe={8}
              segmente={[
                { label: 'ausgegeben', wert: zf.ausgegeben.gesamt, farbe: ausgegebenFarbe },
                { label: 'Sammlung', wert: sammlung.menge, farbe: rollen.gedaempft },
                { label: 'ausstehend', wert: ausstehendMenge, farbe: rollen.linieStark },
                { label: 'Rest', wert: rest, farbe: rollen.flaeche3 },
              ]}
              legende={
                // Feste Zeilenzahl: schmal zwei Zeilen, sonst eine; jede bricht nie um. Eine
                // Stelle mehr bei Sammlung oder Rest ändert so nie die Höhe des Kopfs.
                <>
                  <span style={{ ...einzeilig, display: istSchmal ? 'block' : 'inline' }}>
                    ausgegeben {zf.ausgegeben.gesamt} · Sammlung {sammlung.menge}
                  </span>
                  {istSchmal ? null : ' · '}
                  <span style={{ ...einzeilig, display: istSchmal ? 'block' : 'inline' }}>
                    ausstehend {ausstehendMenge} · Rest {rest}
                  </span>
                </>
              }
            />
          </div>
          {/* Die Sammelzeile steht immer, auch leer: „Sammlung 0“, „Buchen“ gesperrt (D3). Sie
              bricht nie um: links zwei feste, einzeilige Zeilen (Menge und ausstehend; Sonderkost
              der Sammlung, leer mit reservierter Höhe), rechts „Buchen“ an festem Platz. Ein
              wachsender Text kürzt sich, statt Tasten zu schieben. */}
          <Flex
            data-lfh="ausgabe-sammlung"
            align="center"
            gap={token.marginSM}
            style={{
              paddingBlock: token.paddingSM,
              paddingInline: token.padding,
              borderBlockStart: `1px solid ${rollen.flaeche2}`,
            }}
          >
            <div style={{ flex: '1 1 0', minWidth: 0 }}>
              <div style={einzeilig}>
                Sammlung{' '}
                <span data-lfh="sammlung-menge" style={monoStil(15, 500)}>
                  {sammlung.menge}
                </span>{' '}
                <span
                  data-lfh="ausgabe-ausstehend"
                  style={{
                    ...monoStil(12),
                    color: rollen.text2,
                    marginInlineStart: token.marginXS,
                  }}
                >
                  + {ausstehendMenge} ausstehend
                </span>
              </div>
              <div
                data-lfh="sammlung-sonderkost"
                title={sammelSonderkost || undefined}
                style={{ ...einzeilig, ...monoStil(12), color: rollen.text2 }}
              >
                {/* Leer ein geschütztes Leerzeichen: die Zeile behält ihre Höhe. */}
                {sammelSonderkost || '\u00a0'}
              </div>
            </div>
            <Button
              style={{ ...uebrige, flex: 'none' }}
              disabled={zuruckGesperrt}
              aria-describedby={beschrieben(zuruckGesperrt)}
              onClick={sammlung.buchen}
            >
              Buchen
            </Button>
          </Flex>
          {/* Stellenwahl (LLH-1040); ohne wählbare Stelle bleibt der Platz leer. Die Zeile bricht
              nicht um: die Wahl nimmt den Rest, das Ist steht fest daneben. Am gebundenen Gerät
              (LLH-1048) steht statt der Wahl die eigene Stelle als Text. */}
          <div data-lfh="ausgabe-stelle">
            {(feste != null || waehlbar.length > 0) && (
              <Flex
                align="center"
                gap={token.marginSM}
                style={{
                  paddingBlock: token.paddingSM,
                  paddingInline: token.padding,
                  borderBlockStart: `1px solid ${rollen.flaeche2}`,
                }}
              >
                {feste ? (
                  <span
                    data-lfh="ausgabe-stelle-fest"
                    title={feste.bezeichnung}
                    style={{ ...einzeilig, flex: '1 1 0', minWidth: 0 }}
                  >
                    <span style={{ color: rollen.text2 }}>Stelle </span>
                    <strong>{feste.bezeichnung}</strong>
                  </span>
                ) : (
                  <Select<number | 'ohne'>
                    aria-label="Stelle"
                    value={gewaehlteStelle ?? 'ohne'}
                    disabled={tastenGesperrt}
                    onChange={(v) => selectStelle(v === 'ohne' ? null : v)}
                    options={[
                      { value: 'ohne', label: 'ohne Stelle' },
                      ...waehlbar.map((st) => ({ value: st.id, label: st.bezeichnung })),
                    ]}
                    style={{ flex: '1 1 0', minWidth: 0 }}
                  />
                )}
                {gewaehlteStelle != null && (
                  <span
                    data-lfh="ausgabe-stelle-ist"
                    style={{ ...einzeilig, flex: 'none', color: rollen.text2 }}
                  >
                    an der Stelle{' '}
                    <span style={{ ...monoStil(13, 500), color: rollen.text }}>
                      {zf.je_stelle.find((e) => e.stelle_id === gewaehlteStelle)?.ausgegeben
                        .gesamt ?? 0}{' '}
                      EP
                    </span>
                  </span>
                )}
              </Flex>
            )}
          </div>
          {/* Empfänger (LLH-1055, LLH-1295); ohne Einheiten, Abschnitte und offene
              Betreuungsstellen bleibt der Platz leer. Die Wahl
              nimmt den Rest der Zeile, „+n“ steht fest daneben. */}
          <div data-lfh="ausgabe-empfaenger">
            {hatEmpfaenger && (
              <Flex
                align="center"
                gap={token.marginSM}
                style={{
                  paddingBlock: token.paddingSM,
                  paddingInline: token.padding,
                  borderBlockStart: `1px solid ${rollen.flaeche2}`,
                }}
              >
                <Select<string>
                  aria-label="Empfänger"
                  value={empfaengerSchluessel(gewaehlterEmpfaenger)}
                  disabled={tastenGesperrt}
                  onChange={(v) => selectEmpfaenger(parseEmpfaengerSchluessel(v))}
                  options={[
                    { value: OHNE_EMPFAENGER, label: 'ohne Empfänger' },
                    ...empfaengerOptionen(empfaengerListe, { aufgeloeste: false }),
                  ]}
                  style={{ flex: '1 1 0', minWidth: 0 }}
                />
                {empfaengerEinheit && staerke != null && (
                  <Button
                    data-lfh="zaehltaste-staerke"
                    style={{ ...uebrige, flex: 'none' }}
                    aria-label={`Stärke zählen: ${staerke} EP an ${empfaengerEinheit.name}`}
                    disabled={tastenGesperrt}
                    aria-describedby={beschrieben(tastenGesperrt)}
                    onClick={() => sammlung.tippe(staerke)}
                  >
                    +{staerke}
                  </Button>
                )}
              </Flex>
            )}
          </div>
        </section>

        {/* ── Sonderkost ───────────────────────────────────────────────────────────── */}
        <section aria-label="Sonderkost" data-lfh="ausgabe-sonderkost">
          <Flex wrap gap={abstand} align="center">
            {mitBedarf.map((k) => {
              const n = sammlung.sonderkost[k];
              const fehlt = zf.fehlmenge.sonderkost[k];
              return (
                <Button
                  key={k}
                  data-kostform={k}
                  // Der Name in einem Zug: Ist/Soll, Fehlmenge und Sammlung der Kostform.
                  aria-label={[
                    `${KOSTFORM_LABEL[k]} ${zf.ausgegeben.sonderkost[k]}/${zf.bedarf.sonderkost[k]}`,
                    fehlt > 0 ? `fehlt ${fehlt}` : null,
                    n > 0 ? `+ ${n}` : null,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={{ ...uebrige, height: 'auto' }}
                  disabled={tastenGesperrt}
                  aria-describedby={beschrieben(tastenGesperrt)}
                  onClick={() => sammlung.tippe(1, k)}
                >
                  <span>{KOSTFORM_LABEL[k]}</span>{' '}
                  <span style={monoStil(13)}>
                    {zf.ausgegeben.sonderkost[k]}/{zf.bedarf.sonderkost[k]}
                  </span>
                  {fehlt > 0 && <span style={monoStil(12, 500)}> fehlt {fehlt}</span>}
                  {/* Fester Platz für „+ n“: ein Tipp verbreitert die Taste nicht. */}
                  <span
                    data-lfh="sonderkost-sammlung"
                    style={{ ...monoStil(12, 500), display: 'inline-block', minWidth: '5ch' }}
                  >
                    {n > 0 ? ` + ${n}` : ''}
                  </span>
                </Button>
              );
            })}
            <MenueAusloeser<Kostform>
              eintraege={ohneBedarf.map((k) => ({ key: k, label: KOSTFORM_LABEL[k] }))}
              zugaenglicherName="Weitere Kostform …"
              gesperrt={tastenGesperrt}
              onWahl={(k) => sammlung.tippe(1, k)}
            />
          </Flex>
        </section>

        {/* ── Ablehnungen: unter den Sonderkost-Tasten, damit sie keine Taste verschieben (D6):
             die eines Bündels bis zum nächsten Abschluss, die einer Rücknahme aus dem Hinweis
             „Rückgängig“ bis zur nächsten Rücknahme. ─────────────────────────────────────── */}
        <div data-lfh="ausgabe-ablehnung">
          <SpeicherFehler
            fehler={nachtrag.ruecknahmeFehler}
            titel="Nicht zurückgenommen"
            fallback="Rücknahme fehlgeschlagen"
          />
          {sammlung.ablehnung && (
            <SpeicherFehler
              fehler={sammlung.ablehnung.fehler}
              titel={`Nicht gebucht: ${sammlung.ablehnung.buendel.menge} EP${davon(sammlung.ablehnung.buendel)}`}
              fallback="Buchung fehlgeschlagen"
            />
          )}
        </div>

        {/* ── Noch nicht verpflegt (LLH-1055) ─────────────────────────────────────────── */}
        <EmpfaengerStand
          zeitfenster={zf}
          empfaenger={empfaengerListe}
          ausstehend={ausstehend.map((v) => v.aktion.daten)}
          ueberschrift="h2"
          onWaehlen={selectEmpfaenger}
          gewaehlt={gewaehlterEmpfaenger}
          gesperrt={tastenGesperrt}
          grundId={grundId}
        />

        {/* ── Letzte Buchungen (D6) ───────────────────────────────────────────────── */}
        <section aria-labelledby={`${grundId}-letzte`} style={{ flex: '1 0 auto' }}>
          <Augenbraue als="h2" id={`${grundId}-letzte`}>
            Letzte Buchungen
          </Augenbraue>
          <ul data-lfh="ausgabe-letzte" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {zeilenAusstehend.map((v) => {
              const d = v.aktion.daten;
              const sk = sonderkostText(sonderkostVoll(d.sonderkost));
              return (
                <Zeitachseneintrag
                  key={`ausstehend-${v.id ?? d.client_id}`}
                  als="li"
                  data-lfh="ausgabe-zeile-ausstehend"
                  zeit={d.zeitpunkt_at ? uhrzeit(d.zeitpunkt_at, konventionen) : ''}
                  typwort="ausstehend"
                >
                  <span style={{ color: rollen.text2 }}>
                    <span style={monoStil(13, 500)}>{d.menge} EP</span>
                    {d.verpflegungsstelle_id != null
                      ? ` · ${stellenName(d.verpflegungsstelle_id, stellen)}`
                      : ''}
                    {mitPunkt(empfaengerText(d, empfaengerListe))}
                    {sk ? ` · ${sk}` : ''}
                  </span>
                </Zeitachseneintrag>
              );
            })}
            {zeilenServer.map((a) => {
              const zurueck = a.zurueckgenommen_at != null;
              const uhr = uhrzeit(a.zeitpunkt_at, konventionen);
              const sk = sonderkostText(a.sonderkost);
              return (
                <Zeitachseneintrag
                  key={a.id}
                  als="li"
                  data-lfh="ausgabe-zeile"
                  data-zurueckgenommen={zurueck ? 'true' : undefined}
                  zeit={uhr}
                  typwort={zurueck ? 'zurückgenommen' : 'Ausgabe'}
                  aktionen={
                    darfSchreiben && !zurueck ? (
                      <Button
                        aria-label={`Zurücknehmen: Ausgabe ${a.menge} EP um ${uhr}`}
                        onClick={() => {
                          ruecknahmeMut.reset();
                          setDialog({ art: 'ruecknahme', ausgabe: a });
                        }}
                      >
                        Zurücknehmen
                      </Button>
                    ) : undefined
                  }
                >
                  <span style={{ textDecoration: zurueck ? 'line-through' : undefined }}>
                    <span style={monoStil(13, 500)}>{a.menge} EP</span>
                    {a.verpflegungsstelle_id != null
                      ? ` · ${stellenName(a.verpflegungsstelle_id, stellen)}`
                      : ''}
                    {mitPunkt(empfaengerText(a, empfaengerListe))}
                    {sk ? ` · ${sk}` : ''}
                  </span>
                </Zeitachseneintrag>
              );
            })}
          </ul>
          {aeltere > 0 && (
            <div style={{ paddingBlock: token.paddingSM }}>
              <SprungKnopf to={verpflegungPfad}>
                {aeltere === 1 ? '1 ältere Ausgabe' : `${aeltere} ältere Ausgaben`}
              </SprungKnopf>
            </div>
          )}
        </section>

        {/* ── Tastenfeld am unteren Rand (D9, D10) ─────────────────────────────────── */}
        <div
          ref={tastenRef}
          data-lfh="zaehltasten"
          style={{
            position: 'sticky',
            bottom: 0,
            zIndex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: token.marginXS,
            paddingBlockStart: token.paddingSM,
            // Am Stab reicht die Ansicht über die Seitenpolsterung bis an die Fensterkante
            // (`useRestHoehe`); die Polsterung kommt hier zurück, die Tasten stehen nicht an der Kante.
            paddingBlockEnd: `calc(${token.paddingSM}px + var(${REST_UNTEN_VAR}, 0px))`,
            background: rollen.paneel,
            borderBlockStart: `1px solid ${rollen.linie}`,
          }}
        >
          {/* Der Grund gesperrter Tasten, sichtbar und als Beschreibung (LFH-966); fester Platz. */}
          <div
            id={grundId}
            data-lfh="zaehltasten-grund"
            style={{ ...monoStil(12), color: rollen.text2, minHeight: 18 }}
          >
            {grundText}
          </div>
          <Flex wrap gap={abstand} justify="flex-end" align="flex-end">
            <Flex wrap gap={abstand} style={istSchmal ? { width: '100%' } : undefined}>
              <Button
                style={uebrige}
                disabled={zuruckGesperrt}
                aria-describedby={beschrieben(zuruckGesperrt)}
                onClick={sammlung.nimmZurueck}
              >
                −1
              </Button>
              <Button
                style={uebrige}
                disabled={tastenGesperrt}
                aria-describedby={beschrieben(tastenGesperrt)}
                onClick={() => {
                  // Vorbelegt mit der Stärke der gewählten Einheit, überschreibbar (LLH-1055).
                  mengeForm.setFieldsValue({
                    menge: staerke != null && staerke <= sammlung.platz ? staerke : undefined,
                  });
                  setDialog({ art: 'menge' });
                }}
              >
                Menge …
              </Button>
              <Button
                style={uebrige}
                disabled={tastenGesperrt}
                aria-describedby={beschrieben(tastenGesperrt)}
                onClick={() => sammlung.tippe(5)}
              >
                +5
              </Button>
              <Button
                style={uebrige}
                disabled={tastenGesperrt}
                aria-describedby={beschrieben(tastenGesperrt)}
                onClick={() => sammlung.tippe(10)}
              >
                +10
              </Button>
            </Flex>
            <Button
              type="primary"
              data-lfh="zaehltaste-plus1"
              style={{
                ...zaehltasteStil(token, 'plus1'),
                ...(istSchmal ? { width: '100%' } : {}),
                fontSize: 22,
              }}
              disabled={tastenGesperrt}
              aria-describedby={beschrieben(tastenGesperrt)}
              onClick={() => sammlung.tippe(1)}
            >
              +1
            </Button>
          </Flex>
        </div>
      </div>

      {dialog?.art === 'menge' && (
        <ErfassungsModal<{ menge: number }>
          offen
          titel="Menge zählen"
          form={mengeForm}
          erfassenText="Zählen"
          onErfassen={(w) => {
            sammlung.tippe(w.menge);
            return Promise.resolve();
          }}
          onFertig={() => setDialog(null)}
          onAbbrechen={() => setDialog(null)}
        >
          <Form.Item<{ menge: number }>
            name="menge"
            label="Menge (EP)"
            rules={[
              { required: true, message: 'Bitte eine Menge angeben' },
              {
                type: 'number',
                max: sammlung.platz,
                message: `Höchstens ${sammlung.platz} EP`,
              },
            ]}
          >
            <MengenFeld beschriftung="Menge (EP)" style={{ width: '100%' }} />
          </Form.Item>
        </ErfassungsModal>
      )}
      {dialog?.art === 'nachtragen' && (
        <AusgabeDialog
          einsatzId={einsatzId}
          zeitfenster={zf}
          nachforderungen={nachforderung.optionen}
          stellen={stellen}
          festeStelle={feste}
          empfaenger={empfaengerListe}
          laeuft={nachtrag.laeuft}
          fehler={nachtrag.fehler}
          onErfassen={(body) => nachtrag.nachtragen(zf as VerpflegungZeitfenster, body)}
          onSchliessen={() => setDialog(null)}
        />
      )}
      {dialog?.art === 'ruecknahme' && (
        <RuecknahmeDialog
          ausgabe={dialog.ausgabe}
          zeitfenster={zf}
          laeuft={ruecknahmeMut.isPending}
          fehler={ruecknahmeMut.error}
          onBestaetigen={() => ruecknahmeMut.mutate(dialog.ausgabe.id)}
          onSchliessen={() => setDialog(null)}
        />
      )}
    </EinsatzSeite>
  );
}
