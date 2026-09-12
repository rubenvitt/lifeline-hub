/**
 * Lage-Dashboard — die Referenzseite der Gestaltungssprache (LFH-352 · A0).
 *
 * Diese Seite ist der Maßstab, gegen den jeder Band-C-Modulumbau geprüft wird.
 * Eine Gestaltungssprache, die nur im Dokument steht, wird nicht befolgt.
 *
 * Sie zeigt die fünf Signatur-Elemente an echten Daten: Akzentstrich als Marke,
 * Dreieck als Sektionsmarke (DV 102), Zahlen als Instrument (`tabular-nums`),
 * Instrumentenband, gesperrte Versalien als Metadaten-Stimme.
 *
 * DREI DATENZUSTÄNDE, DREI ERSCHEINUNGEN. Der Sweep-Befund lautete „Fehler sieht
 * aus wie leer": eine fehlgeschlagene Abfrage rendert denselben Leerzustand wie
 * „nichts vorhanden", und das Dashboard meldete während des Ladens „Kräfte
 * 0/0/0//0". Wer in dem Moment ans Funkgerät geht, meldet eine falsche Lage.
 * Deshalb hängt jede Kachel an ihren eigenen Queries und unterscheidet
 * `lädt` / `Fehler` / `leer` sichtbar.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { Alert, Breadcrumb } from 'antd';
import { einsatzKeys } from '../../api/queryKeys';
import { auftraegePfad, einsatzModulPfad, meldungenPfad } from '../../routing/deeplinks';
import { abonniereLiveStatus, leseLiveStatus } from '../../live/liveStatusStore';
import type { LiveVerbindungsStatus } from '../../live/useEinsatzLiveStream';
import { ladeEinsatz } from '../../api/einsaetze';
import { listePersonen } from '../../api/einsatzPerson';
import { listeTiere } from '../../api/einsatzTier';
import { listeUhs } from '../../api/einsatzUhs';
import { listeSchaeden } from '../../api/einsatzSchaden';
import { ladeGefahrengebiete } from '../../api/gefahren';
import { listeZonen } from '../../api/lagezonen';
import { listeLageberichte } from '../../api/lageberichte';
import { listeAuftraege } from '../../api/auftraege';
import { listeMeldungen } from '../../api/meldungen';
import { listeEinheiten } from '../../api/einheiten';
import { listeEinsatzPersonal } from '../../api/einsatzPersonal';
import { listeEinsatzFahrzeuge } from '../../api/einsatzFahrzeuge';
import { listeEinsatzMaterial } from '../../api/einsatzMaterial';
import { listeAbschnitte } from '../../api/einsatzabschnitte';
import {
  baueLagebild,
  DRINGLICHKEIT_ZEICHEN,
  dtgJetzt,
  type Datenzustand,
  type Dringlichkeit,
} from './lagebild';
import ZeitAnzeige from '../../anzeige/ZeitAnzeige';
import '../../theme/sprache.css';

/** Verdichtet mehrere Queries auf den Zustand, den ihre Kachel zeigen muss.
 *  Fehler schlägt Laden: eine halb geladene Kachel mit einem toten Teil darf
 *  nicht so aussehen, als wäre sie vollständig. */
function zustandVon(...queries: UseQueryResult<unknown>[]): Datenzustand {
  if (queries.some((q) => q.isError)) return 'fehler';
  if (queries.some((q) => q.isLoading)) return 'laden';
  return 'daten';
}

/**
 * Der Wortlaut des Ladezustands — an EINER Stelle, weil er im Band und in der
 * Kennzahlenleiste dasselbe bedeuten muss (LFH-331 · B3).
 *
 * Er ersetzt den Gedankenstrich im Band: der stand dort während des Abrufs und
 * bedeutet anderswo „kein Wert" — genau die Verwechslung von „lädt" und „ist
 * nichts", gegen die dieses Ticket antritt.
 */
const LADETEXT = 'wird abgerufen';

/**
 * Wortlaut je Verbindungszustand.
 *
 * `Record` über die volle {@link LiveVerbindungsStatus}-Union, damit eine fünfte
 * Variante hier den Build bricht statt still auf einen Vorgabetext zu fallen.
 *
 * `idle` heißt „noch keine Meldung" und nicht „gestört" — vor dem ersten
 * Stream-Ereignis wäre eine Störungsmeldung eine Falschaussage in die andere
 * Richtung. Es trägt aber auch nicht den Wortlaut von `open`: `meldeStatus('open')`
 * feuert erst in dessen `onopen` (`useEinsatzLiveStream.ts`), auf dieser vom
 * Einsatz-Layout gemounteten Route kann `idle` also nur „noch nicht offen"
 * bedeuten — dauerhaft, wenn eine Verbindung hängt, ohne zu öffnen oder zu
 * erroren. „Live verbunden" wäre dort eine Zusage an eine Leitung, die noch
 * nichts überträgt. Alarmiert wird weiterhin nur bei `lost`.
 */
const VERBINDUNG_WORTLAUT: Record<LiveVerbindungsStatus, string> = {
  idle: 'Verbindung wird aufgebaut',
  open: 'Live verbunden',
  connecting: 'Verbindung wird aufgebaut',
  lost: 'Verbindung unterbrochen',
};

/**
 * Die sechs Kennzahl-Etiketten, in der Reihenfolge aus `lagebild.ts`.
 *
 * Sie stehen hier ein zweites Mal, weil vor dem ersten Einsatz-Abruf gar kein
 * Lagebild existiert und die Leiste ihre Plätze trotzdem stellen muss — sonst
 * bleibt sie leer und sechs Knöpfe springen später herein (Prüfliste Kriterium 12,
 * CLS ≤ 0,1). Die Doppelung ist gegen Drift abgesichert, nicht dem Zufall
 * überlassen: `LageDashboardPage.test.tsx` pinnt BEIDE Reihen gegen dieselben
 * handgeschriebenen Literale — die geladene Leiste und diese hier. Wandert eine
 * Kennzahl, wird eine der beiden Prüfungen rot.
 */
const KENNZAHL_ETIKETTEN = [
  'Kräfte F/UF/M//Σ',
  'Patienten SK I–IV',
  'Vermisst',
  'Höchste Warnstufe',
  'Schäden offen',
  'UHS aktiv',
] as const;

function Plakette({ stufe, children }: { stufe: Dringlichkeit; children: React.ReactNode }) {
  return <span className={`lfh-plakette lfh-plakette--${stufe}`}>{children}</span>;
}

/**
 * Der Dringlichkeitsmarker einer Kurzlisten-Zeile — mit zweitem Kanal (LFH-395).
 *
 * Die Form kommt aus {@link DRINGLICHKEIT_ZEICHEN}, die Farbe aus der
 * Stufenklasse; `sprache.css` hält beide Achsen getrennt.
 *
 * Er ist NICHT mehr `aria-hidden`: als einziger Träger der Dringlichkeit wäre
 * die Zeile sonst für Vorlesende stufenlos. Ein eigenes Vorleseziel wird er
 * dadurch nicht — er steht INNERHALB des Zeilen-Links, dessen Name sich aus
 * seinem Inhalt bildet, das Stufenwort fliesst also in den Linknamen ein. Genau
 * deshalb bleibt das Zeichen im Kachelkopf `aria-hidden`: dort ist es Deko und
 * hätte nichts zu sagen.
 */
function Zeichen({ stufe }: { stufe: Dringlichkeit }) {
  const { form, label } = DRINGLICHKEIT_ZEICHEN[stufe];
  return (
    <span
      className={`lfh-zeichen lfh-zeichen--${form} lfh-zeichen--${stufe}`}
      role="img"
      aria-label={label}
    />
  );
}

function Kachel(props: {
  titel: string;
  mehr: string;
  zustand: Datenzustand;
  leer?: boolean;
  leerText: string;
  leerAktion: string;
  aufMehr: () => void;
  aufNeuladen: () => void;
  breit?: boolean;
  children: React.ReactNode;
}) {
  const { titel, mehr, zustand, leer, leerText, leerAktion, aufMehr, aufNeuladen, breit } = props;
  return (
    <section className={`lfh-kachel${breit ? ' lfh-kachel--breit' : ''}`}>
      <header className="lfh-kachel__kopf">
        {/* Deko, kein Status: stufenlos und stumm (LFH-395). Die Formklasse ist
            trotzdem Pflicht — die Basis trägt seit LFH-395 keine Geometrie. */}
        <span className="lfh-zeichen lfh-zeichen--dreieck" aria-hidden="true" />
        <h2 className="lfh-kachel__titel">{titel}</h2>
        <button type="button" className="lfh-kachel__mehr lfh-knopf-blank" onClick={aufMehr}>
          {mehr}
        </button>
      </header>
      <div className="lfh-kachel__leib">
        {zustand === 'laden' && (
          <div className="lfh-skelett" aria-busy="true" aria-label={`${titel} wird geladen`}>
            <span className="lfh-skelett__balken lfh-skelett__balken--gross" />
            <span className="lfh-skelett__balken" />
            <span className="lfh-skelett__balken lfh-skelett__balken--kurz" />
          </div>
        )}
        {zustand === 'fehler' && (
          <div className="lfh-fehler" role="alert">
            <span className="lfh-fehler__zeichen" aria-hidden="true">
              !
            </span>
            <div>
              <b className="lfh-fehler__titel">Daten nicht abrufbar</b>
              <p className="lfh-fehler__text">
                Stand unbekannt — nicht als Lage melden. Letzter Abruf fehlgeschlagen.
              </p>
              <button type="button" className="lfh-knopf" onClick={aufNeuladen}>
                Erneut abrufen
              </button>
            </div>
          </div>
        )}
        {zustand === 'daten' && leer && (
          <div className="lfh-leer">
            <p className="lfh-leer__text">{leerText}</p>
            <button type="button" className="lfh-knopf" onClick={aufMehr}>
              {leerAktion}
            </button>
          </div>
        )}
        {zustand === 'daten' && !leer && props.children}
      </div>
    </section>
  );
}

export default function LageDashboardPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const navigate = useNavigate();
  const gehe = (route: string) => navigate(einsatzModulPfad(einsatzId, route));

  // Der Verbindungszustand kommt aus DERSELBEN Quelle wie die globale
  // Betriebszeile (LFH-336 · M3). Vorher stand hier eine Ableitung aus
  // Query-Fehlern — die meldete bei totem SSE weiter „Live verbunden", weil ein
  // abgerissener Stream keine Abfrage rot färbt: der Cache liefert brav die alten
  // Daten. Genau das ist der Zustand, in dem jemand eine veraltete Lage funkt.
  const liveStatus = useSyncExternalStore(abonniereLiveStatus, leseLiveStatus, leseLiveStatus);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const personenQuery = useQuery({
    queryKey: einsatzKeys.personen(einsatzId),
    queryFn: () => listePersonen(einsatzId),
  });
  const tiereQuery = useQuery({
    queryKey: einsatzKeys.tiere(einsatzId),
    queryFn: () => listeTiere(einsatzId),
  });
  const uhsQuery = useQuery({
    queryKey: einsatzKeys.uhs(einsatzId),
    queryFn: () => listeUhs(einsatzId),
  });
  const schaedenQuery = useQuery({
    queryKey: einsatzKeys.schaeden(einsatzId),
    queryFn: () => listeSchaeden(einsatzId),
  });
  const gefahrenQuery = useQuery({
    queryKey: einsatzKeys.gefahrengebiete(einsatzId),
    queryFn: () => ladeGefahrengebiete(einsatzId),
  });
  const zonenQuery = useQuery({
    queryKey: einsatzKeys.zonen(einsatzId),
    queryFn: () => listeZonen(einsatzId),
  });
  const lageberichteQuery = useQuery({
    queryKey: einsatzKeys.lageberichte(einsatzId),
    queryFn: () => listeLageberichte(einsatzId),
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
  });
  const personalQuery = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
  });
  const fahrzeugeQuery = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
  });
  const materialQuery = useQuery({
    queryKey: einsatzKeys.material(einsatzId),
    queryFn: () => listeEinsatzMaterial(einsatzId),
  });
  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
  });
  const auftraegeQuery = useQuery({
    queryKey: einsatzKeys.auftraege(einsatzId),
    queryFn: () => listeAuftraege(einsatzId),
  });
  const meldungenQuery = useQuery({
    queryKey: einsatzKeys.meldungen(einsatzId),
    queryFn: () => listeMeldungen(einsatzId),
  });

  const einsatz = einsatzQuery.data;

  const lagebild = useMemo(() => {
    if (!einsatz) return null;
    return baueLagebild({
      einsatz,
      personen: personenQuery.data ?? [],
      tiere: tiereQuery.data ?? [],
      uhs: uhsQuery.data ?? [],
      schaeden: schaedenQuery.data ?? [],
      gefahren: gefahrenQuery.data ?? [],
      zonen: zonenQuery.data ?? [],
      lageberichte: lageberichteQuery.data ?? [],
      einheiten: einheitenQuery.data ?? [],
      personal: personalQuery.data ?? [],
      fahrzeuge: fahrzeugeQuery.data ?? [],
      material: materialQuery.data ?? [],
      abschnitte: abschnitteQuery.data ?? [],
      auftraege: auftraegeQuery.data ?? [],
      meldungen: meldungenQuery.data ?? [],
    });
  }, [
    einsatz,
    personenQuery.data,
    tiereQuery.data,
    uhsQuery.data,
    schaedenQuery.data,
    gefahrenQuery.data,
    zonenQuery.data,
    lageberichteQuery.data,
    einheitenQuery.data,
    personalQuery.data,
    fahrzeugeQuery.data,
    materialQuery.data,
    abschnitteQuery.data,
    auftraegeQuery.data,
    meldungenQuery.data,
  ]);

  // Je Kachel der Zustand ihrer eigenen Quellen — nicht ein globaler.
  const zBetroffene = zustandVon(personenQuery);
  const zKraefte = zustandVon(
    abschnitteQuery,
    einheitenQuery,
    personalQuery,
    fahrzeugeQuery,
    materialQuery,
  );
  const zInfra = zustandVon(uhsQuery, schaedenQuery, tiereQuery, zonenQuery);
  const zBericht = zustandVon(lageberichteQuery);
  const zAuftraege = zustandVon(auftraegeQuery);
  const zMeldungen = zustandVon(meldungenQuery);
  // Je Kennzahl der Zustand IHRER Quelle, nicht ein Sammelzustand: fällt die
  // Gefahrenmatrix aus, darf das die Patientenzahl nicht mit unkenntlich machen.
  // Die Reihenfolge ist die aus `baueLagebild` — beide Listen stehen und fallen
  // gemeinsam, deshalb prüft ein Test sie gegeneinander.
  const kennzahlZustaende: Datenzustand[] = [
    zKraefte,
    zBetroffene,
    zBetroffene,
    zustandVon(gefahrenQuery),
    zustandVon(schaedenQuery),
    zustandVon(uhsQuery),
  ];

  if (einsatzQuery.isError || (!einsatzQuery.isLoading && !einsatz)) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }

  return (
    <>
      <Breadcrumb
        style={{ marginBottom: 8 }}
        items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: einsatz?.bezeichnung ?? '…' },
          { title: 'Lage-Dashboard' },
        ]}
      />

      <div className="lfh-flaeche">
        {/* Signatur 4 · Instrumentenband */}
        <header className="lfh-band">
          <div className="lfh-marke">
            <span className="lfh-marke__strich" aria-hidden="true" />
            <span className="lfh-marke__name">LIFELINE HUB</span>
          </div>
          <div className="lfh-band__wert">
            <span className="lfh-etikett">Einsatz</span>
            <b className="lfh-band__titel">{einsatz ? einsatz.bezeichnung : LADETEXT}</b>
          </div>
          <div className="lfh-band__wert">
            <span className="lfh-etikett">DTG</span>
            <b className="lfh-zahl">{dtgJetzt()}</b>
          </div>
          <div className="lfh-band__wert">
            <span className="lfh-etikett">Gesamtstärke</span>
            <b className="lfh-zahl">
              {zKraefte === 'daten' && lagebild ? lagebild.staerke : '—/—/—//—'}
            </b>
          </div>
          <div className="lfh-band__verbindung">
            <span
              className={`lfh-puls${liveStatus === 'lost' ? ' lfh-puls--alarm' : ''}`}
              aria-hidden="true"
            />
            <span className="lfh-etikett">{VERBINDUNG_WORTLAUT[liveStatus]}</span>
          </div>
        </header>

        {/* Kennzahlen — Wortlaut statt nackter Zähler.
            Vor dem ersten Einsatz-Abruf gibt es noch kein Lagebild und damit auch
            keine Kennzahlen; die Leiste stand deshalb leer, und die Weiche je
            Kennzahl darunter („····" / „?") konnte gar nicht greifen — sie hängt an
            Knöpfen, die es zu diesem Zeitpunkt nicht gab. Die sechs Plätze stellt
            die Leiste jetzt selbst, aus den festen Etiketten. */}
        <div className="lfh-kennzahlen">
          {lagebild == null &&
            KENNZAHL_ETIKETTEN.map((etikett) => (
              <div
                key={etikett}
                className="lfh-kz"
                aria-busy="true"
                // Der Platz ist kein Knopf: es gibt noch nichts, wohin er führen
                // könnte. `.lfh-kz` trägt seine Geometrie und den Zeigerwechsel in
                // einem — der wird hier zurückgenommen, damit der Platz nicht
                // anbietet, was er nicht kann.
                style={{ cursor: 'default' }}
              >
                <span className="lfh-etikett">{etikett}</span>
                <b className="lfh-zahl lfh-zahl--gross">····</b>
                <span className="lfh-zusatz">{LADETEXT}</span>
              </div>
            ))}
          {lagebild?.kennzahlen.map((k, i) => {
            const z = kennzahlZustaende[i] ?? 'daten';
            return (
              <button
                type="button"
                key={k.etikett}
                className={`lfh-kz${k.stufe && k.stufe !== 'normal' && z === 'daten' ? ` lfh-kz--${k.stufe}` : ''}`}
                onClick={() => gehe(k.route)}
              >
                <span className="lfh-etikett">{k.etikett}</span>
                {z === 'laden' ? (
                  <b className="lfh-zahl lfh-zahl--gross" aria-busy="true">
                    ····
                  </b>
                ) : z === 'fehler' ? (
                  <b className="lfh-zahl lfh-zahl--gross" title="Stand unbekannt">
                    ?
                  </b>
                ) : (
                  <b className="lfh-zahl lfh-zahl--gross">{k.wert}</b>
                )}
                <span className="lfh-zusatz">
                  {z === 'fehler' ? 'Stand unbekannt' : z === 'laden' ? 'wird abgerufen' : k.zusatz}
                </span>
              </button>
            );
          })}
        </div>

        <div className="lfh-raster">
          <Kachel
            titel="Betroffene"
            mehr="Personenliste"
            zustand={zBetroffene}
            leer={lagebild?.betroffeneGesamt === 0}
            leerText="Noch keine Personen erfasst."
            leerAktion="Person aufnehmen"
            aufMehr={() => gehe('personen')}
            aufNeuladen={() => void personenQuery.refetch()}
          >
            <div className="lfh-felder">
              {(lagebild?.sichtung ?? []).map((s) => (
                <div key={s.etikett} className={`lfh-feld lfh-feld--${s.stufe}`}>
                  <span className="lfh-etikett">{s.etikett}</span>
                  <b className="lfh-zahl lfh-zahl--mittel">{s.wert}</b>
                </div>
              ))}
            </div>
            <p className="lfh-fussnote">
              {lagebild?.betroffeneGesamt ?? 0} erfasst
              {(lagebild?.vermisst ?? 0) > 0 && (
                <>
                  {' · '}
                  <Plakette stufe="alarm">{lagebild?.vermisst} vermisst</Plakette>
                </>
              )}
            </p>
          </Kachel>

          <Kachel
            titel="Kräfte"
            mehr="Meldebild"
            zustand={zKraefte}
            leer={lagebild?.einheiten === 0 && lagebild?.abschnitte === 0}
            leerText="Noch keine Kräfte disponiert."
            leerAktion="Einheiten öffnen"
            aufMehr={() => gehe('kraefteuebersicht')}
            aufNeuladen={() => {
              void einheitenQuery.refetch();
              void personalQuery.refetch();
            }}
          >
            <b className="lfh-zahl lfh-staerke">{lagebild?.staerke}</b>
            <p className="lfh-fussnote">Führer / Unterführer / Mannschaft // Gesamt</p>
            <dl className="lfh-werte">
              <div>
                <dt className="lfh-etikett">Einheiten</dt>
                <dd className="lfh-zahl">{lagebild?.einheiten}</dd>
              </div>
              <div>
                <dt className="lfh-etikett">Abschnitte</dt>
                <dd className="lfh-zahl">{lagebild?.abschnitte}</dd>
              </div>
              <div>
                <dt className="lfh-etikett">Fahrzeuge gebunden</dt>
                <dd className="lfh-zahl">
                  {lagebild?.fahrzeugeGebunden}/{lagebild?.fahrzeugeGesamt}
                </dd>
              </div>
            </dl>
          </Kachel>

          <Kachel
            titel="Infrastruktur"
            mehr="Übersicht"
            zustand={zInfra}
            leer={
              lagebild?.uhsGesamt === 0 &&
              lagebild?.schaedenGesamt === 0 &&
              lagebild?.tiereAktiv === 0 &&
              lagebild?.zonen === 0
            }
            leerText="Noch keine Einrichtungen, Schäden oder Zonen erfasst."
            leerAktion="Unfallhilfsstellen öffnen"
            aufMehr={() => gehe('unfallhilfsstellen')}
            aufNeuladen={() => {
              void uhsQuery.refetch();
              void schaedenQuery.refetch();
            }}
          >
            <dl className="lfh-werte lfh-werte--liste">
              <div>
                <dt className="lfh-etikett">UHS aktiv</dt>
                <dd className="lfh-zahl">
                  {lagebild?.uhsAktiv}/{lagebild?.uhsGesamt}
                </dd>
              </div>
              <div>
                <dt className="lfh-etikett">Schäden offen</dt>
                <dd className="lfh-zahl">
                  {lagebild?.schaedenOffen}/{lagebild?.schaedenGesamt}
                </dd>
              </div>
              <div>
                <dt className="lfh-etikett">Tiere aktiv</dt>
                <dd className="lfh-zahl">{lagebild?.tiereAktiv}</dd>
              </div>
              <div>
                <dt className="lfh-etikett">Lagezonen</dt>
                <dd className="lfh-zahl">{lagebild?.zonen}</dd>
              </div>
            </dl>
          </Kachel>

          <Kachel
            titel="Aktueller Lagebericht"
            mehr="Berichte"
            // `leer` zieht aus `lagebild`, das erst nach dem Einsatz-Abruf existiert
            // (I2, LFH-336-Review) — `zustand` muss deshalb dieselbe Quelle spiegeln,
            // sonst gilt `zustand === 'daten'` UND `leer === true` gleichzeitig,
            // solange nur der Einsatz-Abruf noch hängt.
            zustand={lagebild ? zBericht : 'laden'}
            leer={!lagebild?.bericht}
            leerText="Noch kein Lagebericht erstellt."
            leerAktion="Lagebericht schreiben"
            aufMehr={() => gehe('lageberichte')}
            aufNeuladen={() => void lageberichteQuery.refetch()}
          >
            <b className="lfh-band__titel">{lagebild?.bericht?.titel}</b>
            <p className="lfh-fussnote">
              <Plakette stufe={lagebild?.bericht?.status === 'freigegeben' ? 'normal' : 'achtung'}>
                {lagebild?.bericht?.status}
              </Plakette>
              {' · Stand '}
              {/* `stand` ist `bericht.zeitstand`, ein UTC-Wirestring ohne Zonenkennung —
                  roh ausgegeben stand er um den Zonenversatz falsch (LFH-350 · H60). Die
                  Formatierung sitzt hier statt in `lagebild.ts`, weil die Zone am
                  Provider hängt und `baueLagebild` rein bleibt. */}
              <span className="lfh-zahl">
                <ZeitAnzeige wert={lagebild?.bericht?.stand} />
              </span>
            </p>
            <p className="lfh-fussnote">von {lagebild?.bericht?.von}</p>
            {lagebild?.bericht?.auszug && <p className="lfh-auszug">{lagebild.bericht.auszug}</p>}
          </Kachel>

          <Kachel
            titel="Aufträge / Befehle"
            mehr="Auftragsliste"
            // `leer` zieht aus `lagebild`, das erst nach dem Einsatz-Abruf existiert
            // (I2, LFH-336-Review) — `zustand` hing bisher NUR an `zAuftraege`
            // (Aufträge-Query). Löst die Aufträge-Query auf, während der Einsatz-Abruf
            // noch hängt, galt `zustand === 'daten'` UND `leer === true` gleichzeitig,
            // und die Kachel behauptete „Keine offenen Aufträge.“, obwohl welche
            // vorliegen.
            zustand={lagebild ? zAuftraege : 'laden'}
            // `leer` darf die Überfällig-Plakette nicht verdrängen (LFH-336-Review,
            // I1): Zählung (`ist_ueberfaellig`) und Zeilenfilter
            // (`bearbeitungsstatus`) laufen im Backend über unabhängige Kriterien
            // (src/auftrag/repo.rs:73-76) — ein vollzogener Auftrag mit
            // unquittiertem Empfänger und abgelaufener Frist ist trotzdem
            // überfällig. `Kachel` rendert `children` (und darin die Plakette) nur
            // bei `!leer`; deshalb koppelt `leer` hier zusätzlich an die
            // Alarmzählung, statt sie strukturell aus `children` herauszuziehen —
            // der kleinere Eingriff an einer Hülle, die nicht umgebaut werden soll.
            leer={
              (lagebild?.auftragszeilen ?? []).length === 0 &&
              (lagebild?.auftraegeUeberfaellig ?? 0) === 0
            }
            leerText="Keine offenen Aufträge."
            leerAktion="Auftrag erteilen"
            aufMehr={() => gehe('auftraege')}
            aufNeuladen={() => void auftraegeQuery.refetch()}
          >
            <b className="lfh-zahl lfh-zahl--gross">{lagebild?.auftraegeOffen}</b>
            <p className="lfh-fussnote">offen oder in Arbeit</p>
            {(lagebild?.auftraegeUeberfaellig ?? 0) > 0 && (
              <p className="lfh-fussnote">
                <Plakette stufe="alarm">{lagebild?.auftraegeUeberfaellig} überfällig</Plakette>
              </p>
            )}
            {/* Die drei fristnächsten — der Zähler sagt WIE VIELE, die Zeilen WAS.
                Jede springt auf die Selektion im Auftragsmodul (LFH-25). */}
            <ul className="lfh-zeilen">
              {(lagebild?.auftragszeilen ?? []).map((z) => (
                <li key={z.id}>
                  <Link className="lfh-zeile" to={auftraegePfad(einsatzId, { auftrag: z.id })}>
                    <Zeichen stufe={z.stufe} />
                    {z.lfdNr != null && <span className="lfh-zeile__nr">{z.lfdNr}</span>}
                    <span className="lfh-zeile__text">{z.text}</span>
                    {z.frist && <time className="lfh-zahl">{z.frist}</time>}
                  </Link>
                </li>
              ))}
            </ul>
          </Kachel>

          <Kachel
            titel="Meldungen (eingehend)"
            mehr="Meldebuch"
            // Spiegelt die Aufträge-Kachel (I2): `zustand` hing bisher NUR an
            // `zMeldungen`, `leer` an `lagebild` — siehe Kommentar dort.
            zustand={lagebild ? zMeldungen : 'laden'}
            // Spiegelt die Aufträge-Kachel (I1): `ist_ueberfaellig`
            // (bestaetigung_pflicht AND quittiert_at IS NULL AND frist <= jetzt,
            // src/meldung/repo.rs:42-43) ist von `ist_offen`/`status` unabhängig —
            // eine erledigte Meldung kann trotzdem überfällig sein.
            leer={
              (lagebild?.meldungszeilen ?? []).length === 0 &&
              (lagebild?.meldungenUeberfaellig ?? 0) === 0
            }
            leerText="Keine offenen Meldungen."
            leerAktion="Meldung erfassen"
            aufMehr={() => gehe('meldungen')}
            aufNeuladen={() => void meldungenQuery.refetch()}
            breit
          >
            <div className="lfh-werte">
              <div>
                <dt className="lfh-etikett">Offen</dt>
                <dd className="lfh-zahl lfh-zahl--mittel">{lagebild?.meldungenOffen}</dd>
              </div>
              <div>
                <dt className="lfh-etikett">Neu</dt>
                <dd className="lfh-zahl lfh-zahl--mittel">{lagebild?.meldungenNeu}</dd>
              </div>
              {(lagebild?.meldungenUeberfaellig ?? 0) > 0 && (
                <div>
                  <Plakette stufe="alarm">{lagebild?.meldungenUeberfaellig} überfällig</Plakette>
                </div>
              )}
            </div>
            <ul className="lfh-zeilen">
              {(lagebild?.meldungszeilen ?? []).map((z) => (
                <li key={z.id}>
                  <Link className="lfh-zeile" to={meldungenPfad(einsatzId, { meldung: z.id })}>
                    <Zeichen stufe={z.stufe} />
                    <span className="lfh-zeile__nr">{z.lfdNr}</span>
                    <time className="lfh-zahl">{z.zeit}</time>
                    <span className="lfh-zeile__text">{z.text}</span>
                    <span className="lfh-zeile__quelle">{z.absender}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Kachel>
        </div>
      </div>
    </>
  );
}
