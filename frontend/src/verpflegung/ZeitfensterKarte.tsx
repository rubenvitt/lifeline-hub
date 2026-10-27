import { Button, Collapse, Flex, Tag, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import { useId, useMemo, useRef, useState, type RefObject } from 'react';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import type {
  ModulFreigaben,
  VerpflegungAusgabe,
  VerpflegungEmpfaenger,
  Verpflegungsstelle,
  VerpflegungZeitfenster,
  ZeitfensterPatch,
} from '../api/types';
import { MenueAusloeser } from '../components/MenueAusloeser';
import { useOffeneBearbeitungGrund } from '../components/offeneBearbeitung';
import { SprungKnopf } from '../components/Sprung';
import StatusTag from '../components/StatusTag';
import {
  Augenbraue,
  Kennzahl,
  Kennzahlenband,
  Zeitachseneintrag,
  monoStil,
  useRollen,
} from '../components/instrument';
import { useViewport } from '../components/useViewport';
import type { VorgemerkteAusgabe } from '../offline/useVorgemerkteAusgaben';
import { useEinsatzPfade } from '../routing/EinsatzPfade';
import { rollenFarbe, verpflegungDeckung } from '../theme/statusFarben';
import EmpfaengerStand from './EmpfaengerStand';
import ZeitfensterBearbeiten from './ZeitfensterBearbeiten';
import { FEHLT_TON, deckungEinstufung, istVergangen } from './deckung';
import { LEERE_EMPFAENGER, empfaengerText, verpflegungsstand } from './empfaengerKern';
import { stellenName, zeilenJeStelle } from './stellenKern';
import {
  KOSTFORM_LABEL,
  belegteKostformen,
  nachforderungsAnzahl,
  sonderkostText,
  sonderkostVoll,
  uhrzeit,
  VERPFLEGUNGSART_LABEL,
  zeitfensterKennung,
  zeitraumText,
} from './verpflegungText';

const { Text } = Typography;

export interface ZeitfensterKarteProps {
  zeitfenster: VerpflegungZeitfenster;
  jetzt: Dayjs;
  darfSchreiben: boolean;
  /**
   * Modul Nachforderungen für die Person bedienbar (und Freigaben bekannt). Ohne: kein
   * „Nachfordern" und am Verweis nur „Nachforderung #n".
   */
  nachforderungenFrei: boolean;
  /** Aufgelöster Name einer Nachforderung — nur bei freiem Modul befragt. */
  nachforderungName?: (id: number) => string | undefined;
  /** „Ausgabe nachtragen“: das Formular mit Zeitpunkt, Ort und Bemerkung (LLH-1032, D8). */
  onAusgabeNachtragen?: (zf: VerpflegungZeitfenster) => void;
  /**
   * „Bedarf bearbeiten“ an der Karte (LLH-1139): schaltet die Karte in den Bearbeiten-Zustand und
   * speichert nur die geänderten Felder. Lehnt bei Ablehnung ab (`mutateAsync`), der Grund steht
   * an der Karte. Ohne: keine Aktion „Bedarf bearbeiten“ (Gerät, ohne Planungsrecht). `basis` ist
   * der Stand beim Öffnen (LLH-1414), `undefined` nach „Meine Änderung übernehmen“.
   */
  onBedarfSpeichern?: (
    zf: VerpflegungZeitfenster,
    patch: ZeitfensterPatch,
    basis: string | undefined,
  ) => Promise<unknown>;
  /** „Verwerfen und neu laden“ nach einem 409 beim Speichern des Bedarfs. */
  onBedarfNeuLaden?: () => void;
  /** `freigabenQuery.data` für die Bedarfsvorschläge beim Bearbeiten. */
  freigaben?: ModulFreigaben;
  onNachfordern?: (zf: VerpflegungZeitfenster) => void;
  /**
   * Weg des Nachschubs bei Fehlmenge: „Nachfordern" (Vorgabe, braucht das Modul Nachforderungen)
   * oder „Fehlmenge melden" an die Einsatzleitung, wie beim Verpflegungsgerät (LFH-1044).
   * Beides ruft `onNachfordern`.
   */
  nachschub?: 'nachfordern' | 'melden';
  onLoeschen?: (zf: VerpflegungZeitfenster) => void;
  onZuruecknehmen?: (ausgabe: VerpflegungAusgabe, zf: VerpflegungZeitfenster) => void;
  /**
   * Auf diesem Gerät vorgemerkte, vom Server noch nicht bestätigte Ausgaben (LFH-688). Sie
   * stehen als „ausstehend“ in der Liste und zählen NICHT in Ausgegeben, Fehlmenge und
   * Einstufung — die kommen allein vom Server (design.md D8).
   */
  ausstehend?: readonly VorgemerkteAusgabe[];
  /**
   * Die Verpflegungsstellen des Einsatzes (LLH-1040), für Namen und Kennzeichen der Aufstellung
   * je Stelle und der Ausgaben. Gerechnet wird nichts: das Ist je Stelle steht in `je_stelle`.
   */
  stellen?: readonly Verpflegungsstelle[];
  /**
   * Die Empfängerliste (LLH-1055) für den Empfänger an jeder Ausgabe und die Klappe „Einheiten“
   * mit „Noch nicht verpflegt“. Ohne Einheiten im Einsatz gibt es die Klappe nicht.
   */
  empfaenger?: VerpflegungEmpfaenger;
}

type Aktionsschluessel = 'nachtragen' | 'bearbeiten' | 'nachfordern' | 'loeschen';

interface Aktion {
  key: Aktionsschluessel;
  label: string;
  danger?: boolean;
  /** Kurzgrund, warum die Aktion gerade nicht geht (eine andere Bearbeitung ist offen). */
  gesperrt?: string;
}

/**
 * Ein Verpflegungszeitfenster.
 *
 * Einstufung mit zwei Kanälen: Wort im `StatusTag` und EINE Randfarbe (`alarm` bei
 * Unterdeckung). Die Fehlmenge steht IMMER als Zahl da; bei Unterdeckung über `alarmText`.
 * Nichts blinkt.
 *
 * Sonderkost: nur belegte Kostformen. Eine fehlende Kostform wird ausdrücklich genannt
 * („fehlt 3 vegan"), sonst sähe eine Unterdeckung bei gedeckter Gesamtzahl gedeckt aus.
 *
 * Aktionen (LLH-1032, design.md D8): Erfasst wird in der Ausgabeansicht; dorthin führt der Sprung
 * „Ausgabe öffnen“, nur bei laufendem oder anstehendem Zeitfenster und mit Schreibrecht. Als
 * Sprung (LFH-616) zählt er nicht zu den Aktionen und trägt die Steuerhöhe über `SprungKnopf`.
 * „Ausgabe nachtragen“, „Bedarf bearbeiten“, „Nachfordern“ bzw. „Fehlmenge melden“ und „Löschen“
 * sind gleichrangige Aktionen: ab drei nach der Rechteprüfung liegen ALLE im Dreipunkt-Menü,
 * „Löschen" rot hinter dem Trenner, daneben steht nur der Sprung. Ohne Schreibrecht fällt die
 * Aktionszeile weg. Jeder zugängliche Name trägt die Zeilenkennung (Bezeichnung + Zeitraum).
 *
 * Stellen (LLH-1040, design.md D13 Punkt 4): die Verpflegungsart als neutrale Marke neben der
 * Bezeichnung. Unter dem Kennzahlenband das Ist je Stelle aus `je_stelle`, NUR wenn es nicht leer
 * ist — der Bestand ohne Stelle sieht aus wie vorher. Kein Soll je Stelle: die einzige Fehlmenge
 * bleibt das Gesamt-„fehlt“. Je wählbarer Stelle (nicht aufgelöst) führt außerhalb des schmalen
 * Schirms ein Sprung „Ausgabe öffnen“ mit `?stelle=` in die Ausgabeansicht, unter denselben
 * Bedingungen wie der Sprung der Karte. Ausgaben an einer Stelle nennen die Stelle statt des Orts.
 *
 * Bearbeiten in der Ansicht (LLH-1139, `frontend/AGENTS.md`, „Bearbeiten in der Ansicht“): „Bedarf
 * bearbeiten“ öffnet kein Modal, die Karte selbst wird zur Eingabe (`ZeitfensterBearbeiten`): der
 * Kopf bleibt, Kennzahlen, Ausgaben und Aktionen weichen den Feldern mit Speichern/Abbrechen
 * darunter. Höchstens eine Karte der Seite ist offen (Merker der Seite); an den übrigen steht
 * „Bedarf bearbeiten“ gesperrt mit Grund.
 *
 * Empfänger (LLH-1055 Teil II): jede Ausgabe nennt ihren Empfänger („an 2. Gruppe“, „Zuführung
 * Deich“). Die Klappe „Einheiten“ nennt im Kopf, wie viele noch nicht verpflegt, ohne Eintreffen
 * und verpflegt sind, und zeigt aufgeklappt `EmpfaengerStand` ohne Wahlknöpfe (gewählt wird in
 * der Ausgabeansicht). Eingeklappt, weil die Karte sonst je Einheit eine Zeile länger würde.
 */
export default function ZeitfensterKarte({
  zeitfenster: zf,
  jetzt,
  darfSchreiben,
  nachforderungenFrei,
  nachforderungName,
  onAusgabeNachtragen,
  onBedarfSpeichern,
  onBedarfNeuLaden,
  freigaben,
  onNachfordern,
  nachschub = 'nachfordern',
  onLoeschen,
  onZuruecknehmen,
  ausstehend = [],
  stellen = [],
  empfaenger = LEERE_EMPFAENGER,
}: ZeitfensterKarteProps) {
  const { token, rollen } = useRollen();
  const { istSchmal } = useViewport();
  const { konventionen } = useAnzeigeKonventionen();
  const pfade = useEinsatzPfade();
  const stufe = deckungEinstufung(zf, jetzt);
  const darstellung = verpflegungDeckung[stufe];
  const kante = stufe === 'offen' ? rollen.linie : rollenFarbe(darstellung.rolle, token);
  const kennung = zeitfensterKennung(zf, konventionen);
  const kostformen = belegteKostformen(zf.bedarf.sonderkost, zf.ausgegeben.sonderkost);
  const [bearbeiten, setBearbeiten] = useState(false);
  // Grund, solange eine ANDERE Bearbeitung der Seite offen ist (die eigene blendet die Aktionen aus).
  const bearbeitenGesperrt = useOffeneBearbeitungGrund();
  const sperrGrundId = useId();
  const aktionenRef = useRef<HTMLDivElement>(null);
  // Ziel der Fokusrückgabe: „Bedarf bearbeiten“ oder, gebündelt, der Menüauslöser — erst nach dem
  // Schließen wieder im Baum, deshalb beim Lesen gesucht.
  const ausloeserRef = useMemo<RefObject<HTMLElement | null>>(
    () => ({
      get current() {
        return (
          aktionenRef.current?.querySelector<HTMLElement>(
            '[data-aktion="bearbeiten"], [aria-label^="Aktionen zu"]',
          ) ?? null
        );
      },
    }),
    [],
  );

  // ── Aktionen, gezählt NACH der Rechteprüfung ──────────────────────────────────────────
  const hatGueltigeAusgabe = zf.ausgaben.some((a) => a.zurueckgenommen_at == null);
  const aktionen: Aktion[] = darfSchreiben
    ? ([
        onAusgabeNachtragen && { key: 'nachtragen', label: 'Ausgabe nachtragen' },
        onBedarfSpeichern && {
          key: 'bearbeiten',
          label: 'Bedarf bearbeiten',
          gesperrt: bearbeitenGesperrt,
        },
        onNachfordern &&
          (nachschub === 'melden' || nachforderungenFrei) &&
          nachforderungsAnzahl(zf) > 0 && {
            key: 'nachfordern',
            label: nachschub === 'melden' ? 'Fehlmenge melden' : 'Nachfordern',
          },
        onLoeschen && !hatGueltigeAusgabe && { key: 'loeschen', label: 'Löschen', danger: true },
      ].filter(Boolean) as Aktion[])
    : [];
  const sprung = darfSchreiben && !istVergangen(zf, jetzt);
  const jeStelle = zeilenJeStelle(zf, stellen);
  const sprungJeStelle = sprung && !istSchmal;
  /** Stelle statt Ort: eine Ausgabe an einer Stelle nennt die Stelle, ohne den Ort. */
  const woText = (stelleId: number | null | undefined, ort: string | null | undefined) =>
    stelleId != null ? ` · ${stellenName(stelleId, stellen)}` : ort ? ` · ${ort}` : '';
  /** „ · an 2. Gruppe“; leer ohne Empfänger. */
  const anText = (a: Pick<VerpflegungAusgabe, 'einheit_id' | 'abschnitt_id'>) => {
    const t = empfaengerText(a, empfaenger);
    return t ? ` · ${t}` : '';
  };
  const vorgemerkt = ausstehend.map((v) => v.aktion.daten);
  const stand = verpflegungsstand(zf, empfaenger, vorgemerkt);
  const hatEinheiten = empfaenger.einheiten.length > 0;
  const einheitenKopf = [
    'Einheiten',
    `${stand.offen.length} noch nicht verpflegt`,
    stand.ohneEintreffen.length > 0 ? `${stand.ohneEintreffen.length} ohne Eintreffen` : null,
    `${stand.verpflegt.length} verpflegt`,
  ]
    .filter(Boolean)
    .join(' · ');
  const gebuendelt = aktionen.length >= 3;
  const fuehreAus = (key: Aktionsschluessel) => {
    if (key === 'nachtragen') onAusgabeNachtragen?.(zf);
    if (key === 'bearbeiten') setBearbeiten(true);
    if (key === 'nachfordern') onNachfordern?.(zf);
    if (key === 'loeschen') onLoeschen?.(zf);
  };

  return (
    <article
      data-lfh="verpflegung-karte"
      data-einstufung={stufe}
      data-alarm={stufe === 'unterdeckung' ? 'true' : undefined}
      aria-label={`Zeitfenster ${kennung}`}
      style={{
        minWidth: 0,
        marginBottom: token.marginXS,
        background: rollen.paneel,
        border: `1px solid ${rollen.linie}`,
        borderInlineStart: `3px solid ${kante}`,
        color: rollen.text,
      }}
    >
      <Flex
        justify="space-between"
        align="center"
        gap={token.marginXS}
        wrap
        style={{ paddingBlock: token.paddingSM, paddingInline: token.padding }}
      >
        <Flex align="baseline" gap={token.marginSM} wrap style={{ minWidth: 0 }}>
          <Text strong style={{ fontSize: 15, overflowWrap: 'anywhere' }}>
            {zf.bezeichnung}
          </Text>
          <span data-lfh="verpflegung-zeitraum" style={{ ...monoStil(12), color: rollen.text2 }}>
            {zeitraumText(zf, konventionen)}
          </span>
          {zf.verpflegungsart && (
            // Neutrale Marke ohne `color`: kein Status, der Text trägt die Bedeutung.
            <Tag data-lfh="verpflegungsart" style={{ marginInlineEnd: 0 }}>
              {VERPFLEGUNGSART_LABEL[zf.verpflegungsart]}
            </Tag>
          )}
        </Flex>
        <StatusTag darstellung={darstellung} />
      </Flex>

      {bearbeiten && onBedarfSpeichern ? (
        <div
          data-lfh="verpflegung-bearbeiten"
          style={{ paddingInline: token.padding, borderBlockStart: `1px solid ${rollen.flaeche2}` }}
        >
          <ZeitfensterBearbeiten
            zeitfenster={zf}
            freigaben={freigaben}
            jetzt={jetzt}
            stellen={stellen}
            onSpeichern={(patch, basis) => onBedarfSpeichern(zf, patch, basis)}
            onNeuLaden={onBedarfNeuLaden}
            onSchliessen={() => setBearbeiten(false)}
            ausloeserRef={ausloeserRef}
          />
        </div>
      ) : (
        <>
          <Kennzahlenband beschriftung={`Deckung ${kennung}`}>
            <Kennzahl
              titel="Bedarf"
              wert={zf.bedarf.gesamt}
              einheit="EP"
              groesse="klein"
              aufgliederung={{
                titel: 'Bedarf nach Personengruppe',
                segmente: [
                  { label: 'Kräfte', wert: zf.bedarf.kraefte, farbe: rollen.text2 },
                  { label: 'Betreute', wert: zf.bedarf.betreute, farbe: rollen.gedaempft },
                  { label: 'weitere', wert: zf.bedarf.weitere, farbe: rollen.linieStark },
                ],
              }}
            />
            <Kennzahl titel="ausgegeben" wert={zf.ausgegeben.gesamt} einheit="EP" groesse="klein" />
            <Kennzahl
              titel="fehlt"
              wert={zf.fehlmenge.gesamt}
              einheit="EP"
              groesse="klein"
              ton={FEHLT_TON[stufe]}
            />
          </Kennzahlenband>

          {jeStelle.length > 0 && (
            <ul
              aria-label={`Ausgegeben je Stelle zu ${kennung}`}
              data-lfh="verpflegung-je-stelle"
              style={{
                listStyle: 'none',
                margin: 0,
                paddingBlock: token.paddingXS,
                paddingInline: token.padding,
              }}
            >
              {jeStelle.map((z) => {
                const waehlbar =
                  z.stelleId != null &&
                  stellen.some((s) => s.id === z.stelleId && s.status !== 'aufgeloest');
                return (
                  <li
                    key={z.stelleId ?? 'ohne'}
                    data-stelle={z.stelleId ?? undefined}
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      columnGap: token.marginSM,
                      rowGap: token.marginXXS,
                      paddingBlock: 2,
                    }}
                  >
                    <span
                      data-lfh="je-stelle-text"
                      style={{ minWidth: 0, overflowWrap: 'anywhere' }}
                    >
                      {z.bezeichnung}
                      {z.kennzeichen.map((k) => (
                        <span key={k} style={{ color: rollen.text2 }}>
                          {' · '}
                          {k}
                        </span>
                      ))}
                      {' · '}
                      <span style={monoStil(13, 500)}>{z.ausgegeben} EP</span>
                    </span>
                    {sprungJeStelle && waehlbar && (
                      <SprungKnopf
                        to={pfade.verpflegungAusgabe(zf.einsatz_id, zf.id, { stelle: z.stelleId! })}
                        zugaenglicherName={`Ausgabe öffnen an ${z.bezeichnung} zu ${kennung}`}
                      >
                        Ausgabe öffnen
                      </SprungKnopf>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {kostformen.length > 0 && (
            <div
              data-lfh="verpflegung-sonderkost"
              style={{ paddingBlock: token.paddingSM, paddingInline: token.padding }}
            >
              <Augenbraue>Sonderkost</Augenbraue>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {kostformen.map((k) => {
                  const fehlt = zf.fehlmenge.sonderkost[k];
                  return (
                    <li
                      key={k}
                      data-kostform={k}
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        columnGap: token.marginSM,
                        alignItems: 'baseline',
                        paddingBlock: 2,
                      }}
                    >
                      <span style={{ minWidth: '12ch' }}>{KOSTFORM_LABEL[k]}</span>
                      <span style={{ ...monoStil(12), color: rollen.text2 }}>
                        Bedarf {zf.bedarf.sonderkost[k]} · ausgegeben {zf.ausgegeben.sonderkost[k]}
                      </span>
                      <span
                        data-lfh="sonderkost-fehlt"
                        style={{
                          ...monoStil(12, fehlt > 0 ? 500 : 400),
                          color:
                            fehlt > 0 && stufe === 'unterdeckung' ? rollen.alarmText : rollen.text2,
                        }}
                      >
                        {fehlt > 0 ? `fehlt ${fehlt} ${KOSTFORM_LABEL[k]}` : 'gedeckt'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {(zf.ausgaben.length > 0 || ausstehend.length > 0) && (
            <ul
              aria-label={`Ausgaben zu ${kennung}`}
              data-lfh="verpflegung-ausgaben"
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                borderBlockStart: `1px solid ${rollen.flaeche2}`,
              }}
            >
              {zf.ausgaben.map((a) => {
                const zurueck = a.zurueckgenommen_at != null;
                const uhr = uhrzeit(a.zeitpunkt_at, konventionen);
                const sk = sonderkostText(a.sonderkost);
                const nfId = a.nachforderung_id;
                const nfName =
                  nfId != null && nachforderungenFrei ? nachforderungName?.(nfId) : undefined;
                const verweis =
                  nfId == null
                    ? null
                    : nfName
                      ? `Nachforderung: ${nfName}`
                      : `Nachforderung #${nfId}`;
                return (
                  <Zeitachseneintrag
                    key={a.id}
                    als="li"
                    data-lfh="verpflegung-ausgabe"
                    data-zurueckgenommen={zurueck ? 'true' : undefined}
                    zeit={uhr}
                    typwort={zurueck ? 'zurückgenommen' : 'Ausgabe'}
                    hinweis={a.bemerkung ?? undefined}
                    aktionen={
                      darfSchreiben && !zurueck && onZuruecknehmen ? (
                        <Button
                          aria-label={`Zurücknehmen: Ausgabe ${a.menge} EP um ${uhr} zu ${kennung}`}
                          onClick={() => onZuruecknehmen(a, zf)}
                        >
                          Zurücknehmen
                        </Button>
                      ) : undefined
                    }
                  >
                    <span style={{ textDecoration: zurueck ? 'line-through' : undefined }}>
                      <span style={monoStil(13, 500)}>{a.menge} EP</span>
                      {anText(a)}
                      {woText(a.verpflegungsstelle_id, a.ort)}
                      {sk ? ` · ${sk}` : ''}
                      {verweis != null && (
                        <>
                          {' · '}
                          <span data-lfh="ausgabe-nachforderung">{verweis}</span>
                        </>
                      )}
                    </span>
                  </Zeitachseneintrag>
                );
              })}
              {ausstehend.map((v) => {
                const d = v.aktion.daten;
                const sk = sonderkostText(sonderkostVoll(d.sonderkost));
                return (
                  <Zeitachseneintrag
                    key={`ausstehend-${v.id ?? d.client_id}`}
                    als="li"
                    data-lfh="verpflegung-ausgabe-ausstehend"
                    zeit={d.zeitpunkt_at ? uhrzeit(d.zeitpunkt_at, konventionen) : ''}
                    typwort="ausstehend"
                    hinweis="Offline vorgemerkt"
                  >
                    <span style={{ color: rollen.text2 }}>
                      <span style={monoStil(13, 500)}>{d.menge} EP</span>
                      {anText(d)}
                      {woText(d.verpflegungsstelle_id, d.ort)}
                      {sk ? ` · ${sk}` : ''}
                    </span>
                  </Zeitachseneintrag>
                );
              })}
            </ul>
          )}

          {hatEinheiten && (
            <Collapse
              ghost
              data-lfh="verpflegung-einheiten"
              style={{ borderBlockStart: `1px solid ${rollen.flaeche2}` }}
              items={[
                {
                  key: 'einheiten',
                  label: einheitenKopf,
                  children: (
                    <EmpfaengerStand
                      zeitfenster={zf}
                      empfaenger={empfaenger}
                      ausstehend={vorgemerkt}
                      ueberschrift="h2"
                    />
                  ),
                },
              ]}
            />
          )}

          {(sprung || aktionen.length > 0) && (
            // `marginSM` = 7 / 11 / 16 px: im Handschuh-Betrieb ≥ 16 px zwischen zwei Zielen.
            <Flex
              justify="flex-end"
              wrap
              gap={token.marginSM}
              data-lfh="verpflegung-aktionen"
              ref={aktionenRef}
              style={{ paddingBlock: token.paddingSM, paddingInline: token.padding }}
            >
              {bearbeitenGesperrt && aktionen.some((a) => a.key === 'bearbeiten') && (
                // Der Grund steht sichtbar am Element, nie nur im Tooltip (Touch, LFH-1078).
                <span
                  id={sperrGrundId}
                  data-lfh="verpflegung-sperrgrund"
                  style={{ alignSelf: 'center', color: rollen.gedaempft, marginInlineEnd: 'auto' }}
                >
                  {bearbeitenGesperrt}
                </span>
              )}
              {sprung && (
                // Kein `type="primary"`: die EINE Primäraktion der Seite steht im Kopf.
                <SprungKnopf
                  to={pfade.verpflegungAusgabe(zf.einsatz_id, zf.id)}
                  zugaenglicherName={`Ausgabe öffnen zu ${kennung}`}
                >
                  Ausgabe öffnen
                </SprungKnopf>
              )}
              {gebuendelt ? (
                <MenueAusloeser
                  eintraege={aktionen.map((a) => ({
                    key: a.key,
                    label: a.label,
                    ...(a.danger ? { gefahr: true as const } : {}),
                    ...(a.gesperrt ? { gesperrt: true as const } : {}),
                  }))}
                  zugaenglicherName={`Aktionen zu Zeitfenster ${kennung}`}
                  onWahl={fuehreAus}
                />
              ) : (
                aktionen.map((a) => (
                  <Button
                    key={a.key}
                    danger={a.danger}
                    data-aktion={a.key}
                    disabled={a.gesperrt != null}
                    aria-describedby={a.gesperrt != null ? sperrGrundId : undefined}
                    aria-label={`${a.label} zu ${kennung}`}
                    onClick={() => fuehreAus(a.key)}
                  >
                    {a.label}
                  </Button>
                ))
              )}
            </Flex>
          )}
        </>
      )}
    </article>
  );
}
