import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { Breadcrumb, Button } from 'antd';
import { TbFileText, TbPlus } from 'react-icons/tb';
import dayjs, { type Dayjs } from 'dayjs';
import EinsatzSeite from '../../components/EinsatzSeite';
import { RechteHinweis } from '../../components/SpeicherHinweis';
import { useAuth } from '../../auth/AuthContext';
import { darfImEinsatzSchreiben } from '../../einsatz/schreibrecht';
import {
  Augenbraue,
  Kennzahl,
  Kennzahlenband,
  Paneel,
  StatusZelle,
  Zeitachseneintrag,
  monoStil,
  useRollen,
  type KennzahlZustand,
} from '../../components/instrument';
import { einsatzKeys } from '../../api/queryKeys';
import { verfasserText } from '../../etb/verfasser';
import { ladeEinsatz } from '../../api/einsaetze';
import { listePersonen } from '../../api/einsatzPerson';
import { listeEinsatzPersonal } from '../../api/einsatzPersonal';
import { listeEinsatzFahrzeuge } from '../../api/einsatzFahrzeuge';
import { listeEinsatzMaterial } from '../../api/einsatzMaterial';
import { listeEinheiten } from '../../api/einheiten';
import { listeAbschnitte } from '../../api/einsatzabschnitte';
import { ladeGefahrengebiete } from '../../api/gefahren';
import { listeAuftraege } from '../../api/auftraege';
import { listeErinnerungen } from '../../api/erinnerungen';
import { listeEtb } from '../../api/etb';
import { pegelAbfrage } from '../../api/pegel';
import { PEGEL_STAND_UNBEKANNT, pegelNotizKurz } from '../../pegel/pegelKennzahl';
import {
  auftraegePfad,
  einheitenPfad,
  einsaetzePfad,
  einsatzabschnittePfad,
  einsatzEinstellungenPfad,
  erinnerungenPfad,
  etbPfad,
  gefahrenPfad,
  kraefteuebersichtPfad,
  lageberichtePfad,
  personenPfad,
  stabPfad,
} from '../../routing/deeplinks';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { formatUhrzeit, formatUhrzeitMitTag } from '../../anzeige/format';
import { abschnittLagezustand, etbTyp, rollenFarbe } from '../../theme/statusFarben';
import StatusTag from '../../components/StatusTag';
import { useViewport } from '../../components/useViewport';
import {
  abschnittNamen,
  abschnittZeilen,
  auftraegeKennzahl,
  betroffeneKennzahl,
  empfaengerText,
  entscheidungenAuswahl,
  folgeText,
  kraefteKennzahl,
  naechsteMarken,
  offeneAuftraege,
  warnstufeKennzahlVon,
  warnstufeNotiz,
  ueberblickRechteText,
  type AbschnittZeile,
  type Marke,
} from './ueberblickDaten';
import { MARKEN_BREITE, rasterStil, zeilenzielStil } from './ueberblickStil';

/**
 * Führung · Überblick — die Startseite eines Einsatzes (Neuentwurf „Instrumententafel",
 * Screen S2, Entscheidung 3 des Auftraggebers). Die Bedeutung jeder Zahl steht in
 * `ueberblickDaten.ts`; hier wird nur verdrahtet und angeordnet.
 *
 * DATENZUSTÄNDE JE BLOCK, nicht einer für die Seite (Muster Lage-Dashboard, LFH-331 · B3):
 * jede Kennzahl und jedes Paneel hängt an SEINEN Queries und unterscheidet lädt / Fehler /
 * leer sichtbar. Fällt die Gefahrenmatrix aus, bleibt die Betroffenenzahl lesbar.
 *
 * LIVE: alle Queries laufen über `einsatzKeys` und werden vom Einsatz-Stream invalidiert
 * (`EINSATZ_STREAM_EVENTS`). Die Reihenfolgen sind vollständig bestimmt (Tiebreak über
 * id), ein Refetch ordnet also nichts um, was sich nicht geändert hat.
 *
 * PEGEL-NOTIZ AN DER WARNSTUFE (LFH-606, Entscheidung 4 des Auftraggebers vom 22.09.2026):
 * seit es die maßgeblichen Pegel des Einsatzes gibt, trägt die Warnstufen-Kennzahl wieder
 * „Pegel 6,84 m steigend" — aus derselben Ableitung wie das Lage-Dashboard
 * (`pegel/pegelKennzahl.ts`). Ohne festgelegten Pegel keine Pegel-Notiz, bei Ausfall oder
 * gescheitertem Abruf „Pegel: Stand unbekannt". Der Pegel-Abruf bestimmt NICHT den Zustand
 * der Kennzahl: sie gehört der Warnstufe, ein toter Pegel-Abruf macht die Warnstufe nicht
 * unlesbar.
 *
 * PEGEL-PROGNOSE ALS MARKE (LFH-628): ein offener erwarteter Höchststand steht unter den
 * nächsten Marken („Erwarteter Höchststand Pegel Weser: 7,10 m") und führt zur
 * Einstellungssektion, wo er gepflegt wird. Verstrichen fällt er heraus (`naechsteMarken`).
 * Auch hier bestimmt der Pegel-Abruf NICHT den Zustand des Paneels: ein gescheiterter
 * Abruf nimmt nur die Prognose-Marke weg, die Fristen der übrigen Quellen bleiben lesbar.
 *
 * BEWUSST WEGGELASSEN (keine erfundenen Daten, Entscheidung 4): letzte Rückmeldung je
 * Abschnitt (LFH-610). Das Raster bereit · gebunden · Ausfall zählt seit LFH-609 die
 * Einheiten nach ihrem Status; Lagezustand, Kürzel, fester Auftrag und Fortschritt je
 * Abschnitt kommen seit LFH-608 aus dem Abschnitt selbst — und bleiben weg, solange sie
 * dort nicht gepflegt sind.
 */

/** Der Entscheidungsabruf: nur Typ „Entscheidung", ein Deckel, der die letzte Stunde
 *  eines Großeinsatzes sicher trägt. Konstante, damit der Query-Key stabil bleibt. */
const ETB_ENTSCHEIDUNGEN = { typ: 'entscheidung' as const, limit: 50 };
/** Wie viele offene Aufträge das Paneel zeigt; der Rest steht im Modul. */
const AUFTRAEGE_MAX = 8;

type Zustand = KennzahlZustand;

/** Fehler schlägt Laden (Lage-Dashboard): eine halb geladene Fläche mit totem Teil darf
 *  nicht vollständig aussehen. */
function zustandVon(...queries: UseQueryResult<unknown>[]): Zustand {
  if (queries.some((q) => q.isError)) return 'fehler';
  if (queries.some((q) => q.isLoading)) return 'laden';
  return 'daten';
}

/** Die Uhr der Seite — tickt alle 30 s, damit „in 60 min" und Fristfarben mitlaufen. */
function useJetzt(intervallMs = 30_000): Dayjs {
  const [jetzt, setJetzt] = useState(() => dayjs());
  useEffect(() => {
    const t = window.setInterval(() => setJetzt(dayjs()), intervallMs);
    return () => window.clearInterval(t);
  }, [intervallMs]);
  return jetzt;
}

/** Ikone mit `aria-hidden`-Hülle (Bedien-Leitlinie: der Name kommt aus dem Text). */
function Ikone({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden="true" style={{ display: 'inline-flex' }}>
      {children}
    </span>
  );
}

/**
 * Lade-, Fehler- und Leerzustand eines Paneels — drei verschiedene Erscheinungen.
 * `leer` ist nur im Zustand `daten` gemeint: „nichts vorhanden" ist ein Befund, „lädt"
 * und „Stand unbekannt" sind keiner.
 */
function Zustandsfeld({
  zustand,
  leer,
  leerText,
  leerAktion,
  onNeuladen,
  children,
}: {
  zustand: Zustand;
  leer: boolean;
  leerText: string;
  leerAktion?: { text: string; ziel: string };
  onNeuladen: () => void;
  children: ReactNode;
}) {
  const { token, rollen } = useRollen();
  const navigate = useNavigate();
  const polster = { padding: token.padding } as const;
  if (zustand === 'laden') {
    return (
      <div aria-busy="true" style={{ ...polster, fontSize: 12, color: rollen.gedaempft }}>
        wird abgerufen
      </div>
    );
  }
  if (zustand === 'fehler') {
    return (
      <div role="alert" style={{ ...polster, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 12, color: rollen.text2 }}>
          Stand unbekannt — Daten nicht abrufbar. Nicht als Lage melden.
        </span>
        <span>
          <Button onClick={onNeuladen}>Erneut abrufen</Button>
        </span>
      </div>
    );
  }
  if (leer) {
    return (
      <div style={{ ...polster, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 12, color: rollen.gedaempft }}>{leerText}</span>
        {leerAktion && (
          <span>
            <Button onClick={() => navigate(leerAktion.ziel)}>{leerAktion.text}</Button>
          </span>
        )}
      </div>
    );
  }
  return <>{children}</>;
}

export default function UeberblickPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const navigate = useNavigate();
  const { token, rollen } = useRollen();
  const { abBreite } = useViewport();
  const breit = abBreite('lg');
  const { konventionen } = useAnzeigeKonventionen();
  const jetzt = useJetzt();
  const { benutzer } = useAuth();

  const einsatzQ = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const personenQ = useQuery({
    queryKey: einsatzKeys.personen(einsatzId),
    queryFn: () => listePersonen(einsatzId),
  });
  const personalQ = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
  });
  const fahrzeugeQ = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
  });
  const materialQ = useQuery({
    queryKey: einsatzKeys.material(einsatzId),
    queryFn: () => listeEinsatzMaterial(einsatzId),
  });
  const einheitenQ = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
  });
  const abschnitteQ = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
  });
  const gefahrenQ = useQuery({
    queryKey: einsatzKeys.gefahrengebiete(einsatzId),
    queryFn: () => ladeGefahrengebiete(einsatzId),
  });
  const auftraegeQ = useQuery({
    queryKey: einsatzKeys.auftraege(einsatzId),
    queryFn: () => listeAuftraege(einsatzId),
  });
  const erinnerungenQ = useQuery({
    queryKey: einsatzKeys.erinnerungen(einsatzId),
    queryFn: () => listeErinnerungen(einsatzId, false),
  });
  const etbQ = useQuery({
    queryKey: einsatzKeys.etbListe(einsatzId, ETB_ENTSCHEIDUNGEN),
    queryFn: () => listeEtb(einsatzId, ETB_ENTSCHEIDUNGEN),
  });
  const pegelQ = useQuery(pegelAbfrage(einsatzId));

  const einsatz = einsatzQ.data;
  /*
   * Die Schreibwege der Seite (Eintrag, Leer-Aktionen) hängen am Einsatz-Schreibrecht wie
   * auf den Nachbarseiten. Solange der Einsatz lädt, ist das Recht unbekannt — gesperrt,
   * aber ohne Hinweis: ein Grund, der beim Laden aufblitzt, wäre eine falsche Aussage.
   */
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);
  const personen = personenQ.data;
  const personal = personalQ.data;
  const fahrzeuge = fahrzeugeQ.data;
  const material = materialQ.data;
  const einheiten = einheitenQ.data;
  const abschnitte = abschnitteQ.data;
  const gefahren = gefahrenQ.data;
  const auftraege = auftraegeQ.data;
  const erinnerungen = erinnerungenQ.data;
  const etb = etbQ.data;

  const betroffene = useMemo(() => betroffeneKennzahl(personen ?? [], jetzt), [personen, jetzt]);
  const kraefte = useMemo(
    () => kraefteKennzahl(personal ?? [], fahrzeuge ?? [], material ?? []),
    [personal, fahrzeuge, material],
  );
  const warnstufe = useMemo(() => warnstufeKennzahlVon(gefahren ?? []), [gefahren]);
  const pegel = pegelQ.data;
  const pegelNotiz = useMemo(
    () =>
      pegelQ.isError
        ? `Pegel: ${PEGEL_STAND_UNBEKANNT}`
        : pegel
          ? pegelNotizKurz(pegel, jetzt.valueOf())
          : null,
    [pegelQ.isError, pegel, jetzt],
  );
  const auftragszahl = useMemo(() => auftraegeKennzahl(auftraege ?? []), [auftraege]);
  const offene = useMemo(() => offeneAuftraege(auftraege ?? []), [auftraege]);
  const zeilen = useMemo(
    () =>
      abschnittZeilen({
        abschnitte: abschnitte ?? [],
        einheiten: einheiten ?? [],
        personal: personal ?? [],
        fahrzeuge: fahrzeuge ?? [],
        material: material ?? [],
        auftraege: auftraege ?? [],
      }),
    [abschnitte, einheiten, personal, fahrzeuge, material, auftraege],
  );
  const entscheidungen = useMemo(() => entscheidungenAuswahl(etb ?? [], jetzt), [etb, jetzt]);
  const marken = useMemo(
    () =>
      naechsteMarken(
        auftraege ?? [],
        erinnerungen ?? [],
        einsatz?.naechste_lagebesprechung_at,
        jetzt,
        pegel ?? [],
      ),
    [auftraege, erinnerungen, einsatz?.naechste_lagebesprechung_at, jetzt, pegel],
  );

  const zBetroffene = zustandVon(personenQ);
  const zKraefte = zustandVon(personalQ, fahrzeugeQ, materialQ);
  const zWarnstufe = zustandVon(gefahrenQ);
  const zAuftraege = zustandVon(auftraegeQ);
  const zAbschnitteZahl = zustandVon(abschnitteQ);
  const zAbschnitte = zustandVon(abschnitteQ, einheitenQ, personalQ, fahrzeugeQ, materialQ);
  const zEntscheidungen = zustandVon(etbQ);
  const zMarken = zustandVon(einsatzQ, auftraegeQ, erinnerungenQ);

  const zeile = zeilenzielStil(rollen, token);
  const uhrzeit = (s: string | null | undefined) => formatUhrzeit(s, konventionen);
  const frist = (s: string | null | undefined) => formatUhrzeitMitTag(s, konventionen);
  const auftraegeFehlen = auftraegeQ.isError;

  const markenZiel = (m: Marke): string =>
    m.art === 'auftrag'
      ? auftraegePfad(einsatzId, { auftrag: m.id ?? undefined })
      : m.art === 'erinnerung'
        ? erinnerungenPfad(einsatzId)
        : m.art === 'pegelprognose'
          ? einsatzEinstellungenPfad(einsatzId, 'pegel')
          : stabPfad(einsatzId);
  const markenFarbe = (m: Marke) =>
    m.ton === 'alarm' ? rollen.alarmText : m.ton === 'achtung' ? rollen.achtungText : rollen.text;

  const ueberfaelligMeta =
    zAuftraege === 'daten' ? (
      <span
        style={{
          color: auftragszahl.ueberfaellig > 0 ? rollen.achtungText : rollen.schwach,
        }}
      >
        {auftragszahl.ueberfaellig > 0
          ? `${auftragszahl.ueberfaellig} überfällig`
          : 'keine überfällig'}
      </span>
    ) : undefined;

  const entscheidungTitel =
    entscheidungen.modus === 'stunde'
      ? 'Entscheidungen der letzten Stunde'
      : 'Letzte Entscheidungen';

  return (
    <EinsatzSeite
      titel="Überblick"
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to={einsaetzePfad()}>Einsätze</Link> },
            { title: einsatz?.bezeichnung ?? '…' },
            { title: 'Überblick' },
          ]}
        />
      }
      dataUpdatedAt={einsatzQ.dataUpdatedAt}
      // Bedingt übergeben (Muster `StabPage`): ein JSX-Element ist immer truthy und
      // hinterließe mit Schreibrecht ein leeres `div` mit Außenabstand.
      hinweis={
        einsatz != null &&
        !darfSchreiben && <RechteHinweis sichtbar text={ueberblickRechteText(einsatz.status)} />
      }
      aktionen={
        <>
          <Button
            icon={
              <Ikone>
                <TbFileText size={14} />
              </Ikone>
            }
            onClick={() => navigate(lageberichtePfad(einsatzId))}
          >
            Lagebericht
          </Button>
          {/* Gesperrt statt versteckt (C10/M16): der Hinweis darüber nennt den Grund. */}
          <Button
            type="primary"
            disabled={!darfSchreiben}
            icon={
              <Ikone>
                <TbPlus size={14} />
              </Ikone>
            }
            onClick={() => navigate(etbPfad(einsatzId, { neu: true }))}
          >
            Eintrag
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginLG }}>
        <Kennzahlenband beschriftung="Lage in Zahlen">
          <Kennzahl
            titel="Betroffene"
            groesse="gross"
            zustand={zBetroffene}
            wert={betroffene.anzahl}
            einheit="Pers."
            notiz={`+${betroffene.neu} in 60 min`}
            ziel={personenPfad(einsatzId)}
          />
          <Kennzahl
            titel="Kräfte im Einsatz"
            groesse="gross"
            zustand={zKraefte}
            wert={kraefte.gesamt}
            einheit="Ges."
            notiz={`F/UF/M//Σ ${kraefte.text}`}
            ziel={kraefteuebersichtPfad(einsatzId)}
          />
          <Kennzahl
            titel="Warnstufe"
            groesse="gross"
            zustand={zWarnstufe}
            ton={warnstufe.ton}
            wert={warnstufe.wort}
            notiz={warnstufeNotiz(warnstufe.anzahlAktiv, pegelNotiz)}
            ziel={gefahrenPfad(einsatzId)}
          />
          <Kennzahl
            titel="Offene Aufträge"
            groesse="gross"
            zustand={zAuftraege}
            ton={auftragszahl.ton}
            wert={auftragszahl.offen}
            einheit={
              auftragszahl.ueberfaellig > 0 ? `davon ${auftragszahl.ueberfaellig} ü.` : undefined
            }
            notiz={
              auftragszahl.ueberfaellig > 0
                ? `${auftragszahl.inArbeit} in Arbeit`
                : `keine über Frist · ${auftragszahl.inArbeit} in Arbeit`
            }
            ziel={auftraegePfad(einsatzId)}
          />
          <Kennzahl
            titel="Einsatzabschnitte"
            groesse="gross"
            zustand={zAbschnitteZahl}
            wert={abschnitte?.length ?? 0}
            notiz={
              abschnitte && abschnitte.length > 0
                ? abschnittNamen(abschnitte)
                : 'noch keine angelegt'
            }
            ziel={einsatzabschnittePfad(einsatzId)}
          />
        </Kennzahlenband>

        <div style={rasterStil(breit, token.marginLG)}>
          <Paneel
            titel="Einsatzabschnitte"
            meta={
              zAbschnitte === 'daten'
                ? `${abschnitte?.length ?? 0} Abschnitte · ${einheiten?.length ?? 0} Einheiten`
                : undefined
            }
            fuss={
              zAbschnitte === 'daten' && zeilen.length > 0 ? (
                <span style={{ ...monoStil(10), color: rollen.schwach }}>
                  Einheiten nach Status: bereit · gebunden · Ausfall
                  {auftraegeFehlen && ' — Aufträge nicht abrufbar, Auftragstexte fehlen'}
                </span>
              ) : undefined
            }
          >
            <Zustandsfeld
              zustand={zAbschnitte}
              leer={zeilen.length === 0}
              leerText="Noch keine Abschnitte und keine Kräfte erfasst."
              leerAktion={
                darfSchreiben
                  ? { text: 'Abschnitt anlegen', ziel: einsatzabschnittePfad(einsatzId) }
                  : undefined
              }
              onNeuladen={() => {
                void abschnitteQ.refetch();
                void einheitenQ.refetch();
                void personalQ.refetch();
                void fahrzeugeQ.refetch();
                void materialQ.refetch();
              }}
            >
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {zeilen.map((z) => (
                  <li key={z.key}>
                    <AbschnittEintrag
                      zeile={z}
                      ziel={
                        z.abschnittId != null
                          ? einsatzabschnittePfad(einsatzId, { abschnitt: z.abschnittId })
                          : einheitenPfad(einsatzId)
                      }
                    />
                  </li>
                ))}
              </ul>
            </Zustandsfeld>
          </Paneel>

          <Paneel titel="Offene Aufträge" meta={ueberfaelligMeta}>
            <Zustandsfeld
              zustand={zAuftraege}
              leer={offene.length === 0}
              leerText="Keine offenen Aufträge."
              leerAktion={{ text: 'Zu den Aufträgen', ziel: auftraegePfad(einsatzId) }}
              onNeuladen={() => void auftraegeQ.refetch()}
            >
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {offene.slice(0, AUFTRAEGE_MAX).map((a) => {
                  const farbe = a.ist_ueberfaellig ? rollen.alarmText : rollen.gedaempft;
                  return (
                    <li key={a.id}>
                      <Link
                        to={auftraegePfad(einsatzId, { auftrag: a.id })}
                        data-lfh="ueberblick-auftrag"
                        style={zeile}
                      >
                        <span style={{ ...monoStil(11), color: farbe, flex: '0 0 40px' }}>
                          {uhrzeit(a.erteilt_at)}
                        </span>
                        <span
                          style={{
                            flex: '1 1 auto',
                            minWidth: 0,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 4,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 12,
                              lineHeight: 1.45,
                              color: rollen.text2,
                              overflowWrap: 'anywhere',
                            }}
                          >
                            {a.auftrag_text}
                          </span>
                          <span style={{ ...monoStil(10), color: rollen.schwach }}>
                            {[
                              empfaengerText(a) ? `an ${empfaengerText(a)}` : 'ohne Empfänger',
                              a.frist_at ? `Frist ${frist(a.frist_at)}` : 'ohne Frist',
                            ].join(' · ')}
                          </span>
                        </span>
                        <span
                          style={{
                            ...monoStil(10),
                            letterSpacing: '0.06em',
                            color: farbe,
                            flex: '0 0 auto',
                          }}
                        >
                          {a.ist_ueberfaellig ? 'überfällig' : 'läuft'}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              {offene.length > AUFTRAEGE_MAX && (
                <Link
                  to={auftraegePfad(einsatzId)}
                  style={{ ...zeile, ...monoStil(11), color: rollen.bedien, borderBlockEnd: 0 }}
                >
                  alle {offene.length} offenen Aufträge ↗
                </Link>
              )}
            </Zustandsfeld>
          </Paneel>

          <div
            style={{
              gridColumn: '1 / -1',
              display: 'flex',
              flexDirection: breit ? 'row' : 'column',
              minWidth: 0,
            }}
          >
            <Paneel
              titel={entscheidungTitel}
              style={{ flex: '1 1 auto' }}
              meta={
                zEntscheidungen === 'daten' &&
                entscheidungen.modus === 'zuletzt' &&
                entscheidungen.eintraege.length > 0
                  ? 'keine in der letzten Stunde'
                  : undefined
              }
              aktion={
                <Link
                  to={etbPfad(einsatzId, { typ: 'entscheidung' })}
                  aria-label="Entscheidungen im Einsatztagebuch öffnen"
                  style={{
                    ...monoStil(11),
                    color: rollen.bedien,
                    display: 'inline-flex',
                    alignItems: 'center',
                    minHeight: token.controlHeight,
                    paddingInline: token.paddingXS,
                  }}
                >
                  ETB ↗
                </Link>
              }
            >
              <Zustandsfeld
                zustand={zEntscheidungen}
                leer={entscheidungen.eintraege.length === 0}
                leerText="Noch keine Entscheidung im Einsatztagebuch."
                leerAktion={
                  darfSchreiben
                    ? { text: 'Eintrag erfassen', ziel: etbPfad(einsatzId, { neu: true }) }
                    : undefined
                }
                onNeuladen={() => void etbQ.refetch()}
              >
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {entscheidungen.eintraege.map((e) => {
                    // Aus dem ETB-Eintrag selbst (LFH-636), nicht aus der Auftragsliste —
                    // die bekommt nicht, wer das Aufträge-Modul gesperrt hat.
                    const folgeWort = folgeText(e.folgeauftraege.length);
                    return (
                      <Zeitachseneintrag
                        key={e.id}
                        als="li"
                        typ="entscheidung"
                        typwort={etbTyp.entscheidung.label}
                        zeit={uhrzeit(e.ereigniszeit)}
                        nr={`Nr. ${e.lfd_nr}`}
                        meta={verfasserText(e)}
                        aktionen={
                          folgeWort ? (
                            <span
                              data-lfh="entscheidung-folge"
                              style={{
                                ...monoStil(10),
                                letterSpacing: '0.06em',
                                color: rollen.bedien,
                              }}
                            >
                              {folgeWort}
                            </span>
                          ) : undefined
                        }
                      >
                        {e.inhalt}
                      </Zeitachseneintrag>
                    );
                  })}
                </ul>
              </Zustandsfeld>
            </Paneel>

            <Paneel
              titel="Nächste Marken"
              style={
                breit
                  ? { flex: `0 0 ${MARKEN_BREITE}px`, width: MARKEN_BREITE, borderInlineStart: 0 }
                  : { borderBlockStart: 0 }
              }
              meta={
                zMarken === 'daten' && marken.weitere > 0 ? `+${marken.weitere} weitere` : undefined
              }
            >
              <Zustandsfeld
                zustand={zMarken}
                leer={marken.marken.length === 0}
                leerText="Keine anstehenden Fristen."
                onNeuladen={() => {
                  void einsatzQ.refetch();
                  void auftraegeQ.refetch();
                  void erinnerungenQ.refetch();
                }}
              >
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {marken.marken.map((m) => (
                    <li key={m.key}>
                      <Link
                        to={markenZiel(m)}
                        data-lfh="ueberblick-marke"
                        data-ton={m.ton}
                        style={{ ...zeile, alignItems: 'baseline', borderBlockEnd: 0 }}
                      >
                        <span
                          style={{
                            flex: '0 0 auto',
                            display: 'flex',
                            flexDirection: 'column',
                            minWidth: 52,
                          }}
                        >
                          <span style={{ ...monoStil(13), color: markenFarbe(m) }}>
                            {frist(m.zeit)}
                          </span>
                          <span style={{ ...monoStil(10), color: markenFarbe(m) }}>{m.wort}</span>
                        </span>
                        <span
                          style={{
                            flex: '1 1 auto',
                            minWidth: 0,
                            fontSize: 12,
                            lineHeight: 1.4,
                            color: rollen.gedaempft,
                            overflowWrap: 'anywhere',
                          }}
                        >
                          {m.text}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Zustandsfeld>
            </Paneel>
          </div>
        </div>
      </div>
    </EinsatzSeite>
  );
}

/** Eine Abschnittszeile: Lagekante · Name/Kürzel/Leiter/Einheiten/Lagezustand · fester
 *  Auftrag mit Fortschritt (sonst jüngster offener Auftrag) · Stärke und Einheiten je
 *  Statuskategorie (LFH-609). Die ganze Zeile ist der Link auf den Abschnitt. */
function AbschnittEintrag({ zeile, ziel }: { zeile: AbschnittZeile; ziel: string }) {
  const { token, rollen } = useRollen();
  const [juengster, ...weitere] = zeile.auftraege;
  const { auftragsbilanz } = zeile;
  const verteilung = zeile.einheitenStatus;
  const lage = zeile.lagezustand ? abschnittLagezustand[zeile.lagezustand] : null;
  const leitung = [zeile.kurzbezeichnung, zeile.leiter].filter(Boolean).join(' · ');
  // Unterzeile: die Zählung, und wenn der feste Auftrag den Platz hat, der offene
  // Einzelauftrag dahinter — er wird kleiner, nicht unsichtbar.
  const unterzeile = [
    auftragsbilanz.gesamt > 0
      ? `${auftragsbilanz.erledigt}/${auftragsbilanz.gesamt} Aufträge erledigt`
      : null,
    zeile.abschnittsauftrag && juengster
      ? `${zeile.auftraege.length} offen · ${juengster.auftrag_text}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Link
      to={ziel}
      data-lfh="ueberblick-abschnitt"
      style={{ ...zeilenzielStil(rollen, token), flexWrap: 'wrap', paddingBlock: token.padding }}
    >
      {/* Die Lagekante: Farbe NUR als Rand (Bedien-Leitlinie), das Stufenwort steht im
          StatusTag daneben. Ohne Beurteilung bleibt sie durchsichtig — eine graue Kante
          sähe aus wie eine Stufe „neutral", die es nicht gibt. */}
      <span
        aria-hidden
        data-lfh="abschnitt-lagekante"
        data-rolle={lage?.rolle}
        style={{
          flex: '0 0 3px',
          alignSelf: 'stretch',
          background: lage ? rollenFarbe(lage.rolle, token) : 'transparent',
        }}
      />
      <span
        style={{ flex: '0 0 158px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}
      >
        <span style={{ fontSize: 14, fontWeight: 500, overflowWrap: 'anywhere' }}>
          {zeile.name}
        </span>
        {leitung && <span style={{ ...monoStil(11), color: rollen.schwach }}>{leitung}</span>}
        <span style={{ ...monoStil(11), color: rollen.gedaempft }}>
          {zeile.einheiten === 1 ? '1 Einheit' : `${zeile.einheiten} Einheiten`}
          {zeile.unterabschnitte > 0 && ` · ${zeile.unterabschnitte} UA`}
        </span>
        {(lage || zeile.unterLage) && (
          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            {lage && <StatusTag darstellung={lage} darstellungsart="rand" />}
            {/* Ein schlechter beurteilter Unterabschnitt bekommt DIESELBE Form wie der
                eigene Zustand (Rollenrand + Wort), nicht bloß gedämpften Text — sonst stünde
                „UA kritisch“ leiser da als ein grünes „planmäßig“ (LFH-608, Review). */}
            {zeile.unterLage && (
              <StatusTag
                darstellung={{
                  ...abschnittLagezustand[zeile.unterLage],
                  label: `UA ${abschnittLagezustand[zeile.unterLage].label}`,
                }}
                darstellungsart="rand"
              />
            )}
          </span>
        )}
      </span>
      <span
        style={{
          flex: '1 1 160px',
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 7,
          fontSize: 12,
          lineHeight: 1.45,
          color: rollen.gedaempft,
          overflowWrap: 'anywhere',
        }}
      >
        {zeile.abschnittsauftrag ? (
          <span>{zeile.abschnittsauftrag}</span>
        ) : juengster ? (
          <span>
            {juengster.auftrag_text}
            {weitere.length > 0 && (
              <span style={{ ...monoStil(10), color: rollen.schwach }}>
                {' '}
                · +{weitere.length} weitere offen
              </span>
            )}
          </span>
        ) : null}
        {zeile.fortschritt != null && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            {/* Der Balken ist Beiwerk, die Zahl daneben die Aussage — deshalb aria-hidden. */}
            <span
              aria-hidden
              style={{ flex: 1, height: 4, background: rollen.linie, display: 'flex' }}
            >
              <span
                data-lfh="abschnitt-fortschritt"
                style={{
                  width: `${zeile.fortschritt}%`,
                  background: lage ? rollenFarbe(lage.rolle, token) : rollen.gedaempft,
                }}
              />
            </span>
            <span style={{ ...monoStil(11), color: rollen.schwach }}>{zeile.fortschritt} %</span>
          </span>
        )}
        {unterzeile && <span style={{ ...monoStil(10), color: rollen.schwach }}>{unterzeile}</span>}
      </span>
      <span
        style={{
          flex: '0 0 132px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 6,
        }}
      >
        <span style={monoStil(15)}>{zeile.staerkeText}</span>
        <Augenbraue>F/UF/M//Ges</Augenbraue>
        {/* Kein `aria-label` am Raster: im Link bildet sich der Name aus dem Inhalt, und ein
            Label ersetzte die Wörter der Zellen („1 bereit …") — der zweite Kanal ginge verloren. */}
        <span
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 1,
            background: rollen.linie,
            width: '100%',
          }}
        >
          <StatusZelle ton="normal" hoehe={24} wert={verteilung.bereit} wort="bereit" />
          <StatusZelle ton="bedien" hoehe={24} wert={verteilung.gebunden} wort="gebunden" />
          <StatusZelle
            ton={verteilung.ausfall > 0 ? 'alarm' : 'neutral'}
            hoehe={24}
            wert={verteilung.ausfall}
            wort="Ausfall"
          />
        </span>
        {verteilung.ohne > 0 && (
          <span style={{ ...monoStil(10), color: rollen.schwach }}>
            +{verteilung.ohne} ohne Status
          </span>
        )}
      </span>
    </Link>
  );
}
