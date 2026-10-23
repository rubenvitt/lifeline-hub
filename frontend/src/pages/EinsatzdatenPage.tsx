import {
  App,
  AutoComplete,
  Breadcrumb,
  Button,
  Collapse,
  Input,
  InputNumber,
  Popconfirm,
  Space,
} from 'antd';
import { ZeitpunktEingabe } from '../anzeige/ZeitpunktEingabe';
import { alsBackendZeit, alsZeitpunkt } from '../anzeige/zeitEingabe';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { Select } from '../components/Select';
import EinsatzSeite, { type Nebenweg } from '../components/EinsatzSeite';
import {
  Augenbraue,
  Paneel,
  kennzahlenbandStil,
  monoStil,
  paneelZeileStil,
  useRollen,
} from '../components/instrument';
import { SeitenFehler, SeitenSkeleton } from '../components/SeitenZustand';
import KoordinatenAnzeige from '../anzeige/KoordinatenAnzeige';
import KoordinatenEingabe from '../anzeige/KoordinatenEingabe';
import {
  alsLatLon,
  istLatLon,
  istUngueltigeKoordinate,
  type KoordinatenWert,
} from '../anzeige/koordinatenWert';
import { Kartenausschnitt } from '../anzeige/Kartenausschnitt';
import { Ortsfeld, type OrtsfeldWert } from '../anzeige/Ortsfeld';
import { sucheOrtImEinsatz } from '../api/ortSuche';
import { Link, useNavigate, useParams } from 'react-router';
import { einsatzberichtPfad, einsatzEinstellungenPfad, lagekartePfad } from '../routing/deeplinks';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState, type ReactNode } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import {
  ladeEinsatz,
  ladeFuehrungsstelle,
  ladeModulFreigaben,
  patcheEinsatz,
  patcheFuehrungsstelle,
  schliesseEinsatzAb,
  type KopfdatenPatch,
} from '../api/einsaetze';
import { listeStichwortVorschlaege } from '../api/stichwortVorschlaege';
import { externeStellenOptions, useExterneStellen } from '../stammdaten/externeStellenVorschlaege';
import { teilwortSuche } from '../components/teilwortSuche';
import { MELDENDE_STELLE_MAX } from '../api/eingabegrenzen';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import { RechteHinweis, SpeicherFehler } from '../components/SpeicherHinweis';
import { NUR_LEITUNG_FUEHRUNG_ORG_ADMIN } from '../components/nurAnsicht';
import { InlineAngabe, type InlineEingabe } from '../components/InlineAngabe';
import { useViewport } from '../components/useViewport';
import { useAuth } from '../auth/AuthContext';
import { darfEinsatzLeiten, darfEinsatzVerwalten } from '../einsatz/schreibrecht';
import type {
  EinsatzAnzeige,
  Einsatzart,
  EinsatzFahrzeug,
  Fuehrungsstelle,
  FuehrungsstellenArt,
  FuehrungsstellePatch,
} from '../api/types';
import Segmentleiste from '../components/instrument/Segmentleiste';
import { mitVorgabe } from '../components/vorgabeText';
import { fuehrungsstelleErfasst } from '../stab/fuehrungsstelle';
import {
  FUEHRUNGSSTELLE_ADRESSE_MAX,
  FUEHRUNGSSTELLE_BEZEICHNUNG_MAX,
} from '../api/eingabegrenzen';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { listeFahrzeuge } from '../api/fahrzeuge';
import { abrufZustand, type AbrufZustand } from '../api/abrufZustand';
import { ZUSTAND_GRUND } from '../stab/funkplan';
import {
  rufnameFilter,
  rufnameOptions,
  rufnamePlaceholder,
  rufnameVorschlaege,
} from '../stab/rufnameVorschlaege';
import PaneelZustand from '../components/instrument/PaneelZustand';
import SprechgruppenPicker from '../components/SprechgruppenPicker';
import { mitBetriebsart, teileSprechgruppen } from '../components/kommunikationsmittel';
import { VerbindungenAngabe } from '../components/VerbindungenFeld';
import EinsatzleiterAngabe from './EinsatzleiterAngabe';
import { einsatzleiterDarstellung, einsatzleiterKurz } from '../stab/einsatzleiter';
import { leerZuNull } from '../api/patchTriState';
import { EINSATZART_LABELS, EINSATZART_OPTIONEN } from '../einsatz/einsatzart';
import { istKeyFreigegeben, modulName } from '../einsatz/modulRegistry';

// Idempotent (mehrfaches extend ist unschädlich) — robust bei isoliertem Import.
dayjs.extend(utc);

/**
 * Zeitpunkte gleich, wenn derselbe Instant (LFH-472, D5) — nicht dasselbe Objekt: jeder Render
 * baut über `alsZeitpunkt` ein frisches Dayjs, und ein Neuabruf zwischen Öffnen und Speichern
 * machte sonst aus „unverändert" einen PATCH.
 */
export function gleicherZeitpunkt(a: Dayjs | null, b: Dayjs | null): boolean {
  return a === null || b === null ? a === b : a.valueOf() === b.valueOf();
}

/** Leer ist ein Text, der nach dem Trimmen nichts übrig lässt — wie `leerZuNull` beim Senden. */
function leererText(w: string): boolean {
  return w.trim() === '';
}

/**
 * Speichert EIN Feld der Kopfdaten (LFH-472). `etikett` nennt die Angabe in der Erfolgsmeldung;
 * der Patch trägt genau einen Schlüssel.
 */
type FeldSpeichern = (etikett: string, patch: KopfdatenPatch) => Promise<EinsatzAnzeige>;

/** Eine freie Textangabe als Zeile (Stichwort und meldende Stelle ausgenommen: sie haben Vorschläge). */
function TextAngabe({
  etikett,
  wert,
  darfSchreiben,
  mono,
  mehrzeilig,
  pflicht,
  speichern,
  zuPatch,
}: {
  etikett: string;
  wert: string | null | undefined;
  darfSchreiben: boolean;
  mono?: boolean;
  mehrzeilig?: boolean;
  /** Leer abgelehnt: kein Senden, alter Wert, Hinweis an der Zeile (Bezeichnung, LFH-1170). */
  pflicht?: boolean;
  speichern: FeldSpeichern;
  zuPatch: (w: string | null) => KopfdatenPatch;
}) {
  const text = wert ?? '';
  return (
    <InlineAngabe<string>
      etikett={etikett}
      wert={text}
      anzeige={mono ? <span style={monoStil(13)}>{text}</span> : text}
      leer={leererText}
      gleich={(a, b) => a.trim() === b.trim()}
      darfSchreiben={darfSchreiben}
      mehrzeilig={mehrzeilig}
      pflicht={pflicht}
      onSpeichern={(w) => speichern(etikett, zuPatch(leerZuNull(w)))}
      eingabe={({ feld, value, onChange }) =>
        mehrzeilig ? (
          <Input.TextArea
            {...feld}
            rows={3}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <Input {...feld} value={value} onChange={(e) => onChange(e.target.value)} />
        )
      }
    />
  );
}

/**
 * Ein Zeitpunkt als Zeile. Hin über `alsZeitpunkt`, zurück über `alsBackendZeit`; das Feld zeigt
 * und liest die Anzeigezone, in der auch `ZeitAnzeige` daneben steht (LFH-692).
 */
function ZeitpunktAngabe({
  etikett,
  wire,
  pflicht,
  darfSchreiben,
  speichern,
  zuPatch,
}: {
  etikett: string;
  wire: string | null | undefined;
  pflicht?: boolean;
  darfSchreiben: boolean;
  speichern: FeldSpeichern;
  zuPatch: (wire: string | null) => KopfdatenPatch;
}) {
  return (
    <InlineAngabe<Dayjs | null>
      etikett={etikett}
      wert={alsZeitpunkt(wire) ?? null}
      anzeige={wire ? <ZeitAnzeige wert={wire} rolle="zeitpunkt" /> : null}
      leer={(d) => d === null}
      gleich={gleicherZeitpunkt}
      pflicht={pflicht}
      darfSchreiben={darfSchreiben}
      onSpeichern={(d) => speichern(etikett, zuPatch(d ? alsBackendZeit(d) : null))}
      eingabe={({ feld, popup, value, onChange }) => (
        <ZeitpunktEingabe
          art="ereignis"
          {...feld}
          {...popup}
          style={{ width: '100%' }}
          value={value}
          onChange={(d) => onChange(d ?? null)}
        />
      )}
    />
  );
}

/** Gleiche Koordinate: dasselbe Paar; eine unlesbare Eingabe ist nie gleich (sie soll prüfen). */
function isSameKoordinate(a: KoordinatenWert, b: KoordinatenWert): boolean {
  if (a === null || b === null) return a === b;
  return istLatLon(a) && istLatLon(b) && a.lat === b.lat && a.lon === b.lon;
}

/**
 * Die Koordinate als Zeile im Paneel „Einsatzort“ (LFH-1170, design.md D3; LFH-1175). Das Paar
 * geht in EINEM PATCH hinaus, geleert als zweimal `null`.
 *
 * Keine `KoordinatenFeld`-Hülle: die Zeile ist kein `Form.Item`. Die Eingabe meldet unlesbaren Text
 * als `ungueltig` und nennt den Grund selbst unter dem Feld; `isValid` sperrt damit das Senden
 * (Koordinaten-Guard, bewertete Stelle), die Zeile bleibt offen.
 */
function KoordinatenAngabe({
  einsatzId,
  lat,
  lon,
  darfSchreiben,
  speichern,
}: {
  einsatzId: number;
  lat: number | null | undefined;
  lon: number | null | undefined;
  darfSchreiben: boolean;
  speichern: FeldSpeichern;
}) {
  const wert: KoordinatenWert = lat != null && lon != null ? { lat, lon } : null;
  return (
    <InlineAngabe<KoordinatenWert>
      etikett="Koordinate"
      wert={wert}
      anzeige={
        wert && istLatLon(wert) ? (
          <KoordinatenAnzeige
            lat={wert.lat}
            lon={wert.lon}
            einsatzId={einsatzId}
            exclude={`einsatzort:${einsatzId}`}
          />
        ) : null
      }
      leer={(w) => w === null}
      gleich={isSameKoordinate}
      darfSchreiben={darfSchreiben}
      isValid={(w) => w === null || istLatLon(w)}
      onSpeichern={(w) =>
        speichern('Koordinate', {
          einsatzort_lat: istLatLon(w) ? w.lat : null,
          einsatzort_lon: istLatLon(w) ? w.lon : null,
        })
      }
      eingabe={({ feld, value, onChange }) => (
        <KoordinatenEingabe
          {...feld}
          einsatzId={einsatzId}
          exclude={`einsatzort:${einsatzId}`}
          value={value}
          onChange={onChange}
        />
      )}
    />
  );
}

/**
 * Mindestbreite einer Kopfangabe, dasselbe Maß wie `flaeche.kachelMinKlein` (220). Lokal statt als
 * weiterer Schlüssel in `flaeche`: das ist als geschlossene Menge gepinnt, und eine Kopfleiste ist
 * kein Nebenraster.
 *
 * `auto-fit` legt am Fükw vier Spalten nebeneinander, auf dem Handschirm eine.
 */
const KOPF_MIN_BREITE = 220;

/**
 * Eine Angabe der Kopfleiste: gedämpftes Etikett, darunter der Wert mit Gewicht. Vier Angaben sind
 * herausgestellt, weil sie im Fükw zuerst gebraucht werden — Stichwort, Alarmzeit, Einsatzort,
 * Einsatzleitung.
 *
 * Ein leerer Wert lässt den Platz stehen und zeigt „—": eine Kopfleiste mit wechselnder Spaltenzahl
 * wäre bei jedem Einsatz anders zu lesen.
 *
 * Nichts hier ist bedienbar, die Zwei-Angaben-Regel für handgebaute Bedienziele gilt nicht.
 */
/**
 * Eine Angabe als Zelle im Fugenraster (Augenbraue über dem Wert). Kein `Kennzahl`-Baustein: die
 * Werte sind Wörter — ein Stichwort in Datenwert-Mono läse sich wie ein Messwert.
 */
function KopfAngabe({ etikett, wert, mono }: { etikett: string; wert: ReactNode; mono?: boolean }) {
  const { token, rollen } = useRollen();
  return (
    <div
      role="group"
      aria-label={etikett}
      style={{
        background: rollen.flaeche,
        paddingBlock: token.paddingSM,
        paddingInline: token.padding,
        minWidth: 0,
      }}
    >
      <Augenbraue style={{ display: 'block', marginBottom: token.marginXXS }}>{etikett}</Augenbraue>
      <div
        style={{
          ...(mono ? monoStil(15, 500) : { fontSize: 15, fontWeight: 500 }),
          color: rollen.text,
          overflowWrap: 'anywhere',
        }}
      >
        {wert}
      </div>
    </div>
  );
}

/**
 * Beschriftete Angaben als Zeilen (`dl`) statt umrandeter `Descriptions`-Tabelle: Augenbraue links,
 * Wert rechts, Trenner `flaeche3`. Unter `md` steht die Augenbraue ÜBER dem Wert (Muster
 * `ModulEinstellungsListe`): die 140 px der Etikettspalte ließen dem Wert am Handy zu wenig, und
 * die Seite lief über (LFH-964).
 */
function Angaben({ zeilen }: { zeilen: { etikett: string; wert: ReactNode }[] }) {
  const { token, rollen } = useRollen();
  const { istSchmal } = useViewport();
  return (
    <dl style={{ margin: 0 }}>
      {zeilen.map(({ etikett, wert }) => (
        <div
          key={etikett}
          style={{
            ...paneelZeileStil(rollen, token),
            display: 'grid',
            gridTemplateColumns: istSchmal ? '1fr' : 'minmax(140px, 1fr) minmax(0, 2fr)',
            gap: istSchmal ? token.marginXXS : token.margin,
            alignItems: 'baseline',
          }}
        >
          <Augenbraue als="dt">{etikett}</Augenbraue>
          <dd style={{ margin: 0, color: rollen.text2, overflowWrap: 'anywhere' }}>{wert}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Sprechgruppen als eine Zeile: „TMO 311, 312 · DMO 505“ — dieselbe Teilung wie der Funkplan. */
function sprechgruppenText(fs: Pick<Fuehrungsstelle, 'sprechgruppen'>): string {
  const { tmo, dmo } = teileSprechgruppen(fs.sprechgruppen);
  return [
    tmo.length > 0 ? mitBetriebsart('TMO', tmo.map((s) => s.bezeichnung).join(', ')) : null,
    dmo.length > 0 ? mitBetriebsart('DMO', dmo.map((s) => s.bezeichnung).join(', ')) : null,
  ]
    .filter((t): t is string => t != null)
    .join(' · ');
}

/** Gleiche Auswahl (Sprechgruppen, Fahrzeuge) unabhängig von der Reihenfolge („unverändert → kein Senden“). */
function gleicheIds(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const menge = new Set(a);
  return b.every((id) => menge.has(id));
}

/** Ein Fahrzeug, wie die Zeile „Führungsfahrzeuge“ es nennt: „Florian 10/1 (ELW 2)“. */
function fahrzeugText(f: EinsatzFahrzeug): string {
  const typ = f.fahrzeugtyp?.trim();
  return typ ? `${f.funkrufname} (${typ})` : f.funkrufname;
}

/**
 * Die disponierten Fahrzeuge für die Zeile „Führungsfahrzeuge“ (LFH-1106). Die Führungsstelle liefert nur
 * IDs; Namen kommen aus dem Modul Fahrzeuge, abgerufen nur mit dessen Freigabe.
 */
function useFahrzeugeQuelle(einsatzId: number): {
  zustand: AbrufZustand;
  fahrzeuge: EinsatzFahrzeug[];
} {
  const freigabenQuery = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
  });
  const frei = freigabenQuery.data != null && istKeyFreigegeben('fahrzeuge', freigabenQuery.data);
  const fahrzeugeQuery = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
    enabled: frei,
  });
  const zustand: AbrufZustand = freigabenQuery.isError
    ? 'fehler'
    : freigabenQuery.data == null
      ? 'laden'
      : !frei
        ? 'gesperrt'
        : abrufZustand(fahrzeugeQuery);
  const fahrzeuge = zustand === 'daten' ? (fahrzeugeQuery.data ?? []) : [];
  return {
    zustand,
    fahrzeuge: [...fahrzeuge].sort((a, b) =>
      a.funkrufname.localeCompare(b.funkrufname, 'de', { numeric: true }),
    ),
  };
}

/** Gleicher Ort nach Werten: Text (getrimmt) und Koordinate. */
function gleicherOrt(a: OrtsfeldWert, b: OrtsfeldWert): boolean {
  return (
    a.text.trim() === b.text.trim() &&
    a.koordinate?.lat === b.koordinate?.lat &&
    a.koordinate?.lon === b.koordinate?.lon
  );
}

/**
 * Paneel „Einsatzort“ (LFH-1175, Spec `einsatzdaten-bearbeitung`, „Paneel Einsatzort mit
 * Kartenausschnitt“): Adresse über das Ortsfeld mit Suche, Koordinate in allen Formaten, darunter
 * der Kartenausschnitt und der Sprung zur Lagekarte. Ein gewählter Treffer, eine gezogene Nadel
 * oder ein auf der Karte gewählter Punkt (LLH-1108) schickt Adresse und Koordinate in EINEM PATCH;
 * nur geänderter Text schickt nur die Adresse.
 */
function EinsatzortPaneel({
  einsatz,
  darfSchreiben,
  speichern,
}: {
  einsatz: EinsatzAnzeige;
  darfSchreiben: boolean;
  speichern: FeldSpeichern;
}) {
  const { token } = useRollen();
  const navigate = useNavigate();
  const einsatzId = einsatz.id;
  const freigabenQuery = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
  });
  const lagekarteFrei =
    freigabenQuery.data != null && istKeyFreigegeben('lagekarte', freigabenQuery.data);
  const punkt =
    einsatz.einsatzort_lat != null && einsatz.einsatzort_lon != null
      ? { lat: einsatz.einsatzort_lat, lon: einsatz.einsatzort_lon }
      : null;
  const adresse = einsatz.einsatzort ?? '';

  return (
    <Paneel titel="Einsatzort">
      <Angaben
        zeilen={[
          {
            etikett: 'Adresse',
            wert: (
              <InlineAngabe<OrtsfeldWert>
                etikett="Adresse"
                // Die gespeicherte Koordinate steht mit in der Bearbeitung: die Vorschau zeigt
                // sie, die Nadel berichtigt sie. Als `karte` gelöst vom Text, damit eine reine
                // Textänderung den Punkt nicht leert (LLH-1108).
                wert={
                  punkt
                    ? { text: adresse, koordinate: punkt, quelle: 'karte' }
                    : { text: adresse, koordinate: null }
                }
                anzeige={adresse}
                leer={(w) => w.text.trim() === ''}
                // Nach Werten, nicht nach Identität: ein Treffer an anderer Stelle ist eine
                // Änderung, auch bei gleichem Text.
                gleich={gleicherOrt}
                darfSchreiben={darfSchreiben}
                onSpeichern={(w) =>
                  speichern(
                    'Adresse',
                    // Die Koordinate geht nur mit, wenn sie neu ist (Treffer, Nadel, getippt);
                    // reiner Text schickt nur die Adresse (Spec `einsatzdaten-bearbeitung`).
                    w.koordinate &&
                      (w.koordinate.lat !== punkt?.lat || w.koordinate.lon !== punkt?.lon)
                      ? {
                          einsatzort: leerZuNull(w.text),
                          einsatzort_lat: w.koordinate.lat,
                          einsatzort_lon: w.koordinate.lon,
                        }
                      : { einsatzort: leerZuNull(w.text) },
                  )
                }
                eingabe={({ feld, popup, value, onChange }) => (
                  <Ortsfeld
                    {...feld}
                    {...popup}
                    value={value}
                    onChange={onChange}
                    suchen={(begriff) => sucheOrtImEinsatz(einsatzId, begriff)}
                    suchSchluessel={(begriff) => einsatzKeys.einsatzortSuche(einsatzId, begriff)}
                    karte={{
                      etikett: 'Einsatzort',
                      einsatzId,
                      // Die Peilung zeigt nicht auf den Einsatzort selbst.
                      exclude: `einsatzort:${einsatzId}`,
                      umgebung: punkt,
                    }}
                  />
                )}
              />
            ),
          },
          {
            etikett: 'Koordinate',
            wert: (
              <KoordinatenAngabe
                einsatzId={einsatzId}
                lat={einsatz.einsatzort_lat}
                lon={einsatz.einsatzort_lon}
                darfSchreiben={darfSchreiben}
                speichern={speichern}
              />
            ),
          },
        ]}
      />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: token.marginXS,
          paddingBlock: token.paddingSM,
          paddingInline: token.padding,
        }}
      >
        <Kartenausschnitt punkt={punkt} etikett="Einsatzort" />
        {punkt && lagekarteFrei && (
          // Link in Knopfgestalt wie „Einsatzbericht drucken“: ein nacktes `<a>` erbt keine
          // Steuerhöhe (`frontend/AGENTS.md`, Handgebautes Bedienziel); Strg/⌘+Klick öffnet einen Tab.
          <div data-lfh="inspector-sprung">
            <Button
              type="link"
              href={lagekartePfad(einsatzId, { zentrum: punkt })}
              style={{ paddingInline: 0 }}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                navigate(lagekartePfad(einsatzId, { zentrum: punkt }));
              }}
            >
              Auf Lagekarte zeigen <span aria-hidden="true">↗</span>
            </Button>
          </div>
        )}
      </div>
    </Paneel>
  );
}

const ART_OPTIONEN: { wert: FuehrungsstellenArt; label: string }[] = [
  { wert: 'mobil', label: 'mobil' },
  { wert: 'ortsfest', label: 'ortsfest' },
];

/** Entwurf der Zeile „Standort“: Adresse und Koordinate gehen zusammen hinaus (LFH-1181, D4). */
interface StandortEntwurf {
  adresse: string;
  koord: KoordinatenWert;
}

function gleicherStandort(a: StandortEntwurf, b: StandortEntwurf): boolean {
  // Eine unlesbare Koordinate ist nie „unverändert“: sie geht bis `onSpeichern` und steht dort als
  // Fehler an der Zeile (`alsLatLon` würfe hier, vor dem Fehlerpfad der Zeile).
  if (istUngueltigeKoordinate(a.koord) || istUngueltigeKoordinate(b.koord)) return false;
  const la = alsLatLon(a.koord);
  const lb = alsLatLon(b.koord);
  return a.adresse.trim() === b.adresse.trim() && la?.lat === lb?.lat && la?.lon === lb?.lon;
}

/**
 * Eigene Führungsstelle des Einsatzes (LFH-849, Spec `einsatz-fuehrungsstelle`): die Gegenstelle
 * des Funkplans, seit LFH-1181 ein Ort mit Ausstattung. Zuerst der Einsatzleiter (LFH-1199),
 * dann Art, Bezeichnung und Standort vor den Funkangaben, denn wer die Führungsstelle sucht, braucht
 * den Ort vor dem Funk (LFH-1181, design.md D5). Jede Zeile schickt nur ihr Feld an
 * `…/fuehrungsstelle`, der Standort Adresse und Koordinate zusammen, mit dem Schreibrecht der
 * Kopfdaten. Der Funkplan verweist hierher und bearbeitet selbst nichts.
 */
function FuehrungsstellePaneel({
  einsatz,
  darfSchreiben,
}: {
  einsatz: EinsatzAnzeige;
  darfSchreiben: boolean;
}) {
  const einsatzId = einsatz.id;
  const qc = useQueryClient();
  const { message } = App.useApp();
  const query = useQuery({
    queryKey: einsatzKeys.fuehrungsstelle(einsatzId),
    queryFn: () => ladeFuehrungsstelle(einsatzId),
  });
  // Wie `feldMutation`: erst in den Cache, dann erfüllen — die Zeile schließt mit dem neuen Wert,
  // und die Fokusrückgabe trifft den frischen Wertknopf. Der Fehler steht an der Zeile.
  const mutation = useMutation({
    mutationFn: ({ patch }: { etikett: string; patch: FuehrungsstellePatch }) =>
      patcheFuehrungsstelle(einsatzId, patch),
    onSuccess: (neu, { etikett }) => {
      qc.setQueryData(einsatzKeys.fuehrungsstelle(einsatzId), neu);
      message.success(`${etikett} gespeichert`);
    },
  });
  const speichern = (etikett: string, patch: FuehrungsstellePatch) =>
    mutation.mutateAsync({ etikett, patch });
  const fahrzeugQuelle = useFahrzeugeQuelle(einsatzId);

  const fs = query.data;
  const text = (
    etikett: string,
    wert: string | null | undefined,
    schluessel: 'bezeichnung',
    maxLength?: number,
  ) => (
    <InlineAngabe<string>
      etikett={etikett}
      wert={wert ?? ''}
      anzeige={wert}
      leer={leererText}
      gleich={(a, b) => a.trim() === b.trim()}
      darfSchreiben={darfSchreiben}
      onSpeichern={(w) => speichern(etikett, { [schluessel]: leerZuNull(w) })}
      eingabe={({ feld, value, onChange }) => (
        <Input
          {...feld}
          value={value}
          maxLength={maxLength}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    />
  );

  return (
    // Kein Außenabstand: der Abstand kommt aus dem Paneel-Raster der Seite (LFH-1170).
    <Paneel titel="Eigene Führungsstelle">
      <PaneelZustand
        zustand={query.isPending ? 'laden' : query.isError ? 'fehler' : 'daten'}
        titel="Eigene Führungsstelle"
        leerText=""
        onNeuladen={() => void query.refetch()}
      >
        {fs && (
          <Angaben
            zeilen={[
              {
                etikett: 'Einsatzleiter',
                wert: (
                  <EinsatzleiterAngabe
                    einsatzId={einsatzId}
                    fs={fs}
                    darfSchreiben={darfSchreiben}
                    onSpeichern={(einsatzleiter) => speichern('Einsatzleiter', { einsatzleiter })}
                  />
                ),
              },
              {
                etikett: 'Art',
                wert: (
                  <ArtAngabe
                    art={fs.art}
                    erfasst={fuehrungsstelleErfasst(fs)}
                    darfSchreiben={darfSchreiben}
                    onSpeichern={(art) => speichern('Art', { art })}
                  />
                ),
              },
              {
                etikett: 'Bezeichnung',
                wert: text(
                  'Bezeichnung',
                  fs.bezeichnung,
                  'bezeichnung',
                  FUEHRUNGSSTELLE_BEZEICHNUNG_MAX,
                ),
              },
              {
                etikett: 'Standort',
                wert: (
                  <StandortAngabe
                    fs={fs}
                    einsatz={einsatz}
                    darfSchreiben={darfSchreiben}
                    onSpeichern={(patch) => speichern('Standort', patch)}
                  />
                ),
              },
              {
                etikett: 'Rufname',
                wert: (
                  <RufnameAngabe
                    rufname={fs.rufname}
                    fahrzeugIds={fs.fahrzeug_ids}
                    quelle={fahrzeugQuelle}
                    darfSchreiben={darfSchreiben}
                    onSpeichern={(w) => speichern('Rufname', { rufname: leerZuNull(w) })}
                  />
                ),
              },
              {
                etikett: 'Sprechgruppen',
                wert: (
                  <InlineAngabe<number[]>
                    etikett="Sprechgruppen"
                    wert={fs.sprechgruppen.map((s) => s.id)}
                    anzeige={<span style={monoStil(13)}>{sprechgruppenText(fs)}</span>}
                    leer={(ids) => ids.length === 0}
                    gleich={gleicheIds}
                    darfSchreiben={darfSchreiben}
                    onSpeichern={(ids) => speichern('Sprechgruppen', { sprechgruppe_ids: ids })}
                    eingabe={({ feld, popup, value, onChange }) => (
                      <SprechgruppenPicker
                        einsatzId={einsatzId}
                        value={value}
                        onChange={onChange}
                        auswahl={{ ...feld, ...popup }}
                      />
                    )}
                  />
                ),
              },
              {
                // Funk (Rufname, Sprechgruppen) und Telefon getrennt (LLH-1134).
                etikett: 'Telefon und weitere Verbindungen',
                wert: (
                  <VerbindungenAngabe
                    etikett="Telefon und weitere Verbindungen"
                    verbindungen={fs.verbindungen}
                    darfSchreiben={darfSchreiben}
                    onSpeichern={(liste) =>
                      speichern('Telefon und weitere Verbindungen', { verbindungen: liste })
                    }
                  />
                ),
              },
              {
                etikett: 'Führungsfahrzeuge',
                wert: (
                  <FuehrungsfahrzeugeZeile
                    art={fs.art}
                    ids={fs.fahrzeug_ids}
                    quelle={fahrzeugQuelle}
                    darfSchreiben={darfSchreiben}
                    onSpeichern={(ids) => speichern('Führungsfahrzeuge', { fahrzeug_ids: ids })}
                  />
                ),
              },
            ]}
          />
        )}
      </PaneelZustand>
    </Paneel>
  );
}

/**
 * Zeile „Art“ (LFH-1181, D1/D5): mit Schreibrecht eine Segmentleiste, deren Wahl sofort nur die Art
 * schickt; ohne Schreibrecht der Wert. Die Art ist nie leer; solange sonst nichts erfasst ist,
 * gilt `mobil` als Vorgabe und heißt so.
 */
function ArtAngabe({
  art,
  erfasst,
  darfSchreiben,
  onSpeichern,
}: {
  art: FuehrungsstellenArt;
  erfasst: boolean;
  darfSchreiben: boolean;
  onSpeichern: (art: FuehrungsstellenArt) => Promise<unknown>;
}) {
  const [fehler, setFehler] = useState<unknown>(null);
  // Die zuletzt gewählte Art steht sofort, bis ihre Antwort da ist; eine frühere Antwort setzt sie
  // nicht zurück (zwei schnelle Wechsel: es gilt der letzte).
  const [gewaehlt, setGewaehlt] = useState<FuehrungsstellenArt | null>(null);
  const letzte = useRef(0);
  if (!darfSchreiben) {
    // „Vorgabe“ heißt nur der Wert, der ohne Wahl gilt (`components/vorgabeText.ts`).
    return <>{art === 'mobil' && !erfasst ? mitVorgabe(art) : art}</>;
  }
  const wert = gewaehlt ?? art;
  return (
    <>
      <Segmentleiste<FuehrungsstellenArt>
        optionen={ART_OPTIONEN}
        wert={wert}
        beschriftung="Art"
        onWechsel={(neu) => {
          if (neu === wert) return;
          const nr = ++letzte.current;
          setFehler(null);
          setGewaehlt(neu);
          onSpeichern(neu).then(
            () => {
              if (nr === letzte.current) setGewaehlt(null);
            },
            (e: unknown) => {
              if (nr !== letzte.current) return;
              setGewaehlt(null);
              setFehler(e);
            },
          );
        }}
      />
      <SpeicherFehler fehler={fehler} />
    </>
  );
}

/**
 * Zeile „Standort“ (LFH-1181, D3/D4): Adresse als Text und Koordinate über die Koordinateneingabe
 * mit Ortsvorschau. „wie Einsatzort“ übernimmt beides einmalig in den Entwurf; gespeichert wird erst
 * mit der Zeile. Das Ortsfeld mit Suche und Karte kommt mit dem Ausrollen (LLH-1114).
 */
function StandortAngabe({
  fs,
  einsatz,
  darfSchreiben,
  onSpeichern,
}: {
  fs: Fuehrungsstelle;
  einsatz: EinsatzAnzeige;
  darfSchreiben: boolean;
  onSpeichern: (patch: FuehrungsstellePatch) => Promise<unknown>;
}) {
  const { token } = useRollen();
  const koord =
    fs.standort_lat != null && fs.standort_lon != null
      ? { lat: fs.standort_lat, lon: fs.standort_lon }
      : null;
  const ortKoord =
    einsatz.einsatzort_lat != null && einsatz.einsatzort_lon != null
      ? { lat: einsatz.einsatzort_lat, lon: einsatz.einsatzort_lon }
      : null;
  const hatEinsatzort = !!einsatz.einsatzort?.trim() || ortKoord != null;
  const exclude = `fuehrungsstelle:${einsatz.id}`;
  const koordId = useId();
  return (
    <InlineAngabe<StandortEntwurf>
      etikett="Standort"
      wert={{ adresse: fs.standort_adresse ?? '', koord }}
      anzeige={
        <span>
          {fs.standort_adresse && <span style={{ display: 'block' }}>{fs.standort_adresse}</span>}
          {koord && (
            <KoordinatenAnzeige
              lat={koord.lat}
              lon={koord.lon}
              einsatzId={einsatz.id}
              exclude={exclude}
            />
          )}
        </span>
      }
      leer={(w) => w.adresse.trim() === '' && w.koord == null}
      gleich={gleicherStandort}
      darfSchreiben={darfSchreiben}
      onSpeichern={(w) => {
        if (istUngueltigeKoordinate(w.koord)) {
          return Promise.reject(new Error('Koordinate nicht lesbar'));
        }
        const ll = alsLatLon(w.koord);
        return onSpeichern({
          standort_adresse: leerZuNull(w.adresse),
          standort_lat: ll?.lat ?? null,
          standort_lon: ll?.lon ?? null,
        });
      }}
      eingabe={({ feld, value, onChange }) => (
        <Space orientation="vertical" style={{ width: '100%' }} size={token.marginXS}>
          <Input
            {...feld}
            aria-label="Adresse des Standorts"
            value={value.adresse}
            maxLength={FUEHRUNGSSTELLE_ADRESSE_MAX}
            onChange={(e) => onChange({ ...value, adresse: e.target.value })}
          />
          <label htmlFor={koordId}>Koordinate</label>
          <KoordinatenEingabe
            id={koordId}
            value={value.koord}
            onChange={(k) => onChange({ ...value, koord: k })}
            einsatzId={einsatz.id}
            exclude={exclude}
          />
          {hatEinsatzort && (
            <Button
              onClick={() => onChange({ adresse: einsatz.einsatzort ?? '', koord: ortKoord })}
            >
              wie Einsatzort
            </Button>
          )}
        </Space>
      )}
    />
  );
}

/**
 * Zeile „Führungsfahrzeuge“ (LFH-1181, D5): bei `mobil` offen, bei `ortsfest` eingeklappt mit der
 * Anzahl im Kopf. Keine Art verlangt ein Fahrzeug; die Zuordnung bleibt beim Einklappen erhalten.
 */
function FuehrungsfahrzeugeZeile({
  art,
  ...props
}: { art: FuehrungsstellenArt } & Parameters<typeof FahrzeugeAngabe>[0]) {
  if (art !== 'ortsfest') return <FahrzeugeAngabe {...props} />;
  const n = props.ids.length;
  const kopf =
    n === 0 ? 'kein Führungsfahrzeug' : n === 1 ? '1 Führungsfahrzeug' : `${n} Führungsfahrzeuge`;
  return (
    <Collapse
      ghost
      items={[{ key: 'fahrzeuge', label: kopf, children: <FahrzeugeAngabe {...props} /> }]}
    />
  );
}

/**
 * Zeile „Rufname“ der Führungsstelle mit Vorschlägen aus den Stammdaten (LFH-1187,
 * `stab/rufnameVorschlaege.tsx`): Funkrufnamen der Führungsfahrzeuge, Freitext bleibt erlaubt.
 */
function RufnameAngabe({
  rufname,
  fahrzeugIds,
  quelle,
  darfSchreiben,
  onSpeichern,
}: {
  rufname: string | null | undefined;
  fahrzeugIds: readonly number[];
  quelle: ReturnType<typeof useFahrzeugeQuelle>;
  darfSchreiben: boolean;
  onSpeichern: (wert: string) => Promise<unknown>;
}) {
  return (
    <InlineAngabe<string>
      etikett="Rufname"
      wert={rufname ?? ''}
      anzeige={<span style={monoStil(13)}>{rufname}</span>}
      leer={leererText}
      gleich={(a, b) => a.trim() === b.trim()}
      darfSchreiben={darfSchreiben}
      onSpeichern={onSpeichern}
      eingabe={(eingabe) => (
        <RufnameInput
          eingabe={eingabe}
          fahrzeugIds={fahrzeugIds}
          disponiert={quelle.zustand === 'daten' ? quelle.fahrzeuge : null}
        />
      )}
    />
  );
}

/**
 * Das Eingabefeld des Rufnamens. Die Fahrzeuge der Organisation lädt es erst beim Bearbeiten,
 * aus demselben Cache wie der Pool der Fahrzeugseite; ein Fehler dort lässt nur ihre Gruppe weg.
 *
 * **Enter übernimmt nur eine angesteuerte Option.** rc-select macht beim Tippen still die erste
 * Option aktiv, deren Wert mit dem Getippten beginnt, und Enter übernähme sie: „Kater 1“ würde zu
 * „Kater 11“. Ohne Pfeiltaste seit der letzten Eingabe hält die Capture-Phase Enter deshalb von
 * rc-select fern, und das `<form>` von `InlineAngabe` sendet den getippten Text. Bei
 * geschlossenem Popup lässt rc-select Enter ohnehin durch.
 */
function RufnameInput({
  eingabe: { feld, popup, value, onChange },
  fahrzeugIds,
  disponiert,
}: {
  eingabe: InlineEingabe<string>;
  fahrzeugIds: readonly number[];
  disponiert: readonly EinsatzFahrzeug[] | null;
}) {
  const stammQuery = useQuery({
    queryKey: globalKeys.fahrzeugeListe('im-dienst'),
    queryFn: () => listeFahrzeuge(true),
  });
  const navigated = useRef(false);
  const options = rufnameOptions(
    rufnameVorschlaege({ fahrzeugIds, disponiert, stamm: stammQuery.data ?? null }),
  );
  return (
    <div
      onKeyDownCapture={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') navigated.current = true;
        else if (e.key === 'Enter' && !navigated.current) e.stopPropagation();
      }}
    >
      <AutoComplete
        {...feld}
        {...popup}
        options={options}
        filterOption={rufnameFilter}
        placeholder={rufnamePlaceholder(fahrzeugIds, disponiert)}
        value={value}
        onChange={(v?: string) => {
          navigated.current = false;
          onChange(v ?? '');
        }}
        style={{ width: '100%' }}
      />
    </div>
  );
}

/**
 * Zeile „Führungsfahrzeuge“ der Führungsstelle (LFH-1106): welche disponierten Fahrzeuge sie
 * tragen. Ohne Freigabe für Fahrzeuge gesperrt, mit dem Grund statt eines leeren Werts.
 */
function FahrzeugeAngabe({
  ids,
  quelle,
  darfSchreiben,
  onSpeichern,
}: {
  ids: readonly number[];
  quelle: ReturnType<typeof useFahrzeugeQuelle>;
  darfSchreiben: boolean;
  onSpeichern: (ids: number[]) => Promise<unknown>;
}) {
  if (quelle.zustand !== 'daten') return <>{ZUSTAND_GRUND[quelle.zustand]}</>;
  // Eine ID ohne disponiertes Fahrzeug (inzwischen entlassen) fällt still weg.
  const gewaehlt = quelle.fahrzeuge.filter((f) => ids.includes(f.id));
  return (
    <InlineAngabe<number[]>
      etikett="Führungsfahrzeuge"
      wert={gewaehlt.map((f) => f.id)}
      anzeige={gewaehlt.map(fahrzeugText).join(', ')}
      leer={(w) => w.length === 0}
      gleich={gleicheIds}
      darfSchreiben={darfSchreiben}
      onSpeichern={onSpeichern}
      eingabe={({ feld, popup, value, onChange }) => (
        <Select<number[]>
          {...feld}
          {...popup}
          mode="multiple"
          allowClear
          options={quelle.fahrzeuge.map((f) => ({ value: f.id, label: fahrzeugText(f) }))}
          value={value}
          onChange={(w) => onChange(w ?? [])}
          style={{ width: '100%' }}
        />
      )}
    />
  );
}

/**
 * Kennungen des Seitenkopfs (LFH-1170): Einsatznummer · Leitstellen-Nr., ohne Leere. Die
 * Aktenzeichen, mit denen Leitstelle, Rückfragen und Einsatzbericht arbeiten, stehen damit ohne
 * Aufklappen da. `null`, wenn der Einsatz keine trägt: dann kein Meta.
 */
export function einsatzKennungen(
  einsatz: Pick<EinsatzAnzeige, 'einsatznummer_intern' | 'leitstellen_nr'>,
): string | null {
  const teile = [einsatz.einsatznummer_intern, einsatz.leitstellen_nr]
    .map((k) => k?.trim())
    .filter((k): k is string => !!k);
  return teile.length > 0 ? teile.join(' · ') : null;
}

export default function EinsatzdatenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const navigate = useNavigate();
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { token, rollen } = useRollen();
  const { abBreite } = useViewport();

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  // Der Einsatzleiter der Kopfleiste kommt aus der Führungsstelle (LFH-1199), derselbe Key wie das
  // Paneel; live über `einsatz`.
  const fuehrungsstelleQuery = useQuery({
    queryKey: einsatzKeys.fuehrungsstelle(einsatzId),
    queryFn: () => ladeFuehrungsstelle(einsatzId),
  });
  const vorschlaegeQuery = useQuery({
    queryKey: globalKeys.stichwortVorschlaege(),
    queryFn: listeStichwortVorschlaege,
  });
  // Katalog „Externe Stellen“ (LFH-1194): Vorschläge für die meldende Stelle, Freitext bleibt.
  const stellenQuery = useExterneStellen();

  // Der einzige Bearbeitungsweg (LFH-472, LFH-1170): EIN Feld je PATCH, die Koordinate als Paar.
  // Der Fehler geht an die Zeile (`mutateAsync` lehnt ab, `InlineAngabe` zeigt ihn), deshalb kein
  // `onError`-Toast.
  const feldMutation = useMutation({
    mutationFn: ({ patch }: { etikett: string; patch: KopfdatenPatch }) =>
      patcheEinsatz(einsatzId, patch),
    onSuccess: (aktualisiert, { etikett }) => {
      // Erst in den Cache, dann erfüllen: die Zeile zeigt den neuen Wert in derselben Runde, in der
      // sie die Eingabe schließt, und die Fokusrückgabe trifft den frischen Wertknopf.
      qc.setQueryData(einsatzKeys.einsatz(einsatzId), aktualisiert);
      qc.invalidateQueries({ queryKey: einsatzKeys.einsatz(einsatzId) });
      qc.invalidateQueries({ queryKey: globalKeys.einsaetze() });
      message.success(`${etikett} gespeichert`);
    },
  });
  const feldSpeichern: FeldSpeichern = (etikett, patch) =>
    feldMutation.mutateAsync({ etikett, patch });

  if (einsatzQuery.isLoading) {
    return <SeitenSkeleton />;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Einsatz nicht gefunden oder kein Zugriff"
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }
  const einsatz = einsatzQuery.data;

  // Kopfdaten und Führungsstelle laufen über die Verwaltungsrouten: der Admin nur der Einsatz-Org
  // (LFH-1066, wie der Server).
  const darfBearbeiten = darfEinsatzVerwalten(einsatz, benutzer);

  const einsatzleiter = einsatzleiterDarstellung({
    zustand: abrufZustand(fuehrungsstelleQuery),
    daten: fuehrungsstelleQuery.data ?? null,
  });

  // Aktiver Einsatz und Einsatzleitung, ohne Admin-Zweig (wie der Server): Abschluss und Zugriff.
  const darfLeiten = darfEinsatzLeiten(einsatz);

  const stichwortOptionen = (vorschlaegeQuery.data ?? []).map((v) => ({ value: v.text }));
  const stellenOptionen = externeStellenOptions(stellenQuery.data ?? []);
  const kennungen = einsatzKennungen(einsatz);

  // Nebenwege im Kopf (LFH-963, LFH-1170): nichts davon muss am Handy ohne Menü sichtbar sein.
  // Der Einsatzbericht auch für Beobachter (die Rechte prüft der Bericht je Quelle), der Sprung zum
  // Zugriff nur für die, die ihn dort bedienen.
  const berichtZiel = einsatzberichtPfad(einsatzId);
  const zugriffZiel = einsatzEinstellungenPfad(einsatzId, 'zugriff');
  const nebenwege: Nebenweg[] = [
    {
      key: 'einsatzbericht',
      label: 'Einsatzbericht drucken',
      ziel: berichtZiel,
      onWahl: () => navigate(berichtZiel),
    },
    ...(darfLeiten
      ? [
          {
            key: 'zugriff',
            label: 'Zugriff verwalten',
            ziel: zugriffZiel,
            sprung: true as const,
            onWahl: () => navigate(zugriffZiel),
          },
        ]
      : []),
  ];

  // Ab `xl` zwei Spalten (Fükw), darunter eine; der Fluss läuft zeilenweise, DOM- und
  // Lesereihenfolge bleiben Einsatz → Einsatzort → Erstmeldung → Eigene Führungsstelle.
  const hasTwoColumns = abBreite('xl');

  return (
    <EinsatzSeite
      // Volle Breite wie die übrigen Führungsseiten (LFH-1170); die schmale Lesebreite trug das
      // entfallene Formular.
      breite="voll"
      // Die Seite nennt sich (LFH-954): der Einsatzname steht im Pfad, der Status im Seitenkopf.
      titel={modulName('einsatzdaten')}
      meta={kennungen ? <span data-lfh="einsatz-kennungen">{kennungen}</span> : undefined}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: modulName('einsatzdaten') },
          ]}
        />
      }
      dataUpdatedAt={einsatzQuery.dataUpdatedAt}
      weitere={{ name: 'Weitere Aktionen zu den Einsatzdaten', eintraege: nebenwege }}
      // Am aktiven Einsatz ohne Verwaltungsrecht der Grund; bedingt übergeben, sonst bliebe ein
      // leerer Slot mit Außenabstand (wie `StabPage`).
      hinweis={
        einsatz.status === 'aktiv' &&
        !darfBearbeiten && <RechteHinweis sichtbar text={NUR_LEITUNG_FUEHRUNG_ORG_ADMIN} />
      }
    >
      {/* Kopfleiste — die vier Angaben, die im Fükw zuerst gebraucht werden. Sie stehen
          nicht zusätzlich in einem Paneel darunter (jede Angabe genau einmal). */}
      <div
        data-fugenraster=""
        style={{
          ...kennzahlenbandStil(rollen),
          gridTemplateColumns: `repeat(auto-fit, minmax(min(${KOPF_MIN_BREITE}px, 100%), 1fr))`,
          marginBottom: token.margin,
        }}
      >
        <KopfAngabe
          etikett="Einsatzstichwort"
          wert={
            <InlineAngabe<string>
              etikett="Einsatzstichwort"
              wert={einsatz.stichwort ?? ''}
              anzeige={einsatz.stichwort}
              leer={leererText}
              gleich={(a, b) => a.trim() === b.trim()}
              darfSchreiben={darfBearbeiten}
              onSpeichern={(w) => feldSpeichern('Einsatzstichwort', { stichwort: leerZuNull(w) })}
              eingabe={({ feld, popup, value, onChange }) => (
                <AutoComplete
                  {...feld}
                  {...popup}
                  options={stichwortOptionen}
                  allowClear
                  placeholder="z. B. H1, MANV …"
                  value={value}
                  onChange={(v?: string) => onChange(v ?? '')}
                />
              )}
            />
          }
        />
        <KopfAngabe
          etikett="Alarmzeit"
          mono
          wert={
            <ZeitpunktAngabe
              etikett="Alarmzeit"
              wire={einsatz.begonnen_at}
              pflicht
              darfSchreiben={darfBearbeiten}
              speichern={feldSpeichern}
              // Pflicht: `null` erreicht `zuPatch` nie, `InlineAngabe` lehnt leer vorher ab.
              zuPatch={(wire) => ({ begonnen_at: wire ?? einsatz.begonnen_at })}
            />
          }
        />
        {/* Nur Anzeige: bearbeitet wird im Paneel „Einsatzort“ (LFH-1175), ein Wert, eine
            Bearbeitungsstelle. */}
        <KopfAngabe etikett="Einsatzort" wert={einsatz.einsatzort || '—'} />
        {/* Der Einsatzleiter der Führungsstelle, nie die App-Rolle `einsatzleitung`: sie ist
            ein Rechtebündel, kein Einsatzleiter nach FwDV 100 (LFH-1199, Regel „Keine
            erfundenen Daten“). Gepflegt wird er im Paneel „Eigene Führungsstelle“. */}
        <KopfAngabe
          etikett="Einsatzleitung"
          wert={
            einsatzleiter.art === 'erfasst' ? (
              einsatzleiterKurz(einsatzleiter)
            ) : (
              <span style={{ color: rollen.gedaempft }}>{einsatzleiterKurz(einsatzleiter)}</span>
            )
          }
        />
      </div>

      <div
        data-lfh="einsatzdaten-paneele"
        style={{
          display: 'grid',
          gridTemplateColumns: hasTwoColumns ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)',
          gap: token.margin,
          alignItems: 'start',
        }}
      >
        <Paneel titel="Einsatz">
          <Angaben
            zeilen={[
              {
                etikett: 'Bezeichnung',
                wert: (
                  <TextAngabe
                    etikett="Bezeichnung"
                    wert={einsatz.bezeichnung}
                    pflicht
                    darfSchreiben={darfBearbeiten}
                    speichern={feldSpeichern}
                    // Pflicht: `null` erreicht `zuPatch` nie, `InlineAngabe` lehnt leer vorher ab.
                    zuPatch={(w) => ({ bezeichnung: w ?? einsatz.bezeichnung })}
                  />
                ),
              },
              {
                etikett: 'Einsatzart',
                wert: (
                  <InlineAngabe<Einsatzart>
                    etikett="Einsatzart"
                    wert={einsatz.einsatzart}
                    anzeige={EINSATZART_LABELS[einsatz.einsatzart]}
                    // Pflicht, aber ein `Select` ohne `allowClear` kann nicht leer werden.
                    leer={() => false}
                    darfSchreiben={darfBearbeiten}
                    onSpeichern={(art) => feldSpeichern('Einsatzart', { einsatzart: art })}
                    eingabe={({ feld, popup, value, onChange }) => (
                      <Select<Einsatzart>
                        {...feld}
                        {...popup}
                        options={EINSATZART_OPTIONEN}
                        value={value}
                        onChange={onChange}
                      />
                    )}
                  />
                ),
              },
              {
                etikett: 'Einsatznummer',
                wert: <span style={monoStil(13)}>{einsatz.einsatznummer_intern ?? '—'}</span>,
              },
              {
                etikett: 'Leitstellen-Nr.',
                wert: (
                  <TextAngabe
                    etikett="Leitstellen-Nr."
                    wert={einsatz.leitstellen_nr}
                    mono
                    darfSchreiben={darfBearbeiten}
                    speichern={feldSpeichern}
                    zuPatch={(w) => ({ leitstellen_nr: w })}
                  />
                ),
              },
              {
                etikett: 'Angelegt',
                wert: (
                  <span style={monoStil(13)}>
                    <ZeitAnzeige wert={einsatz.angelegt_at} rolle="zeitpunkt" />
                  </span>
                ),
              },
            ]}
          />
        </Paneel>

        <EinsatzortPaneel
          einsatz={einsatz}
          darfSchreiben={darfBearbeiten}
          speichern={feldSpeichern}
        />

        <Paneel titel="Erstmeldung">
          <Angaben
            zeilen={[
              {
                etikett: 'Meldende Stelle',
                // Vorschläge aus dem Katalog „Externe Stellen“ (LFH-1194); gespeichert wird nur
                // der Text (Speicherform A), Freitext bleibt.
                wert: (
                  <InlineAngabe<string>
                    etikett="Meldende Stelle"
                    wert={einsatz.meldende_stelle ?? ''}
                    anzeige={einsatz.meldende_stelle}
                    leer={leererText}
                    gleich={(a, b) => a.trim() === b.trim()}
                    darfSchreiben={darfBearbeiten}
                    onSpeichern={(w) =>
                      feldSpeichern('Meldende Stelle', { meldende_stelle: leerZuNull(w) })
                    }
                    eingabe={({ feld, popup, value, onChange }) => (
                      <AutoComplete
                        {...feld}
                        {...popup}
                        options={stellenOptionen}
                        showSearch={teilwortSuche}
                        allowClear
                        maxLength={MELDENDE_STELLE_MAX}
                        placeholder="z. B. ILS Musterkreis"
                        value={value}
                        onChange={(v?: string) => onChange(v ?? '')}
                      />
                    )}
                  />
                ),
              },
              {
                etikett: 'Sachverhalt / Meldebild',
                wert: (
                  <TextAngabe
                    etikett="Sachverhalt / Meldebild"
                    wert={einsatz.sachverhalt}
                    mehrzeilig
                    darfSchreiben={darfBearbeiten}
                    speichern={feldSpeichern}
                    zuPatch={(w) => ({ sachverhalt: w })}
                  />
                ),
              },
              {
                etikett: 'Anzahl Betroffene (initial)',
                wert: (
                  <InlineAngabe<number | null>
                    etikett="Anzahl Betroffene (initial)"
                    wert={einsatz.anzahl_betroffene_initial ?? null}
                    anzeige={<span style={monoStil(13)}>{einsatz.anzahl_betroffene_initial}</span>}
                    leer={(n) => n === null}
                    darfSchreiben={darfBearbeiten}
                    onSpeichern={(n) =>
                      feldSpeichern('Anzahl Betroffene (initial)', {
                        anzahl_betroffene_initial: n,
                      })
                    }
                    eingabe={({ feld, value, onChange }) => (
                      <InputNumber<number>
                        {...feld}
                        min={0}
                        precision={0}
                        style={{ width: 180 }}
                        value={value}
                        onChange={(n) => onChange(n ?? null)}
                      />
                    )}
                  />
                ),
              },
            ]}
          />
        </Paneel>

        <FuehrungsstellePaneel einsatz={einsatz} darfSchreiben={darfBearbeiten} />
      </div>

      {/* Zuletzt und nicht im Kopf (LFH-960): Unumkehrbares für den ganzen Einsatz steht nicht im
          Kopf einer Arbeitsseite (`frontend/AGENTS.md`, „Destruktiv ist nicht gleich destruktiv“). */}
      {/* `key`: ein Einsatzwechsel räumt den Grund, eine spätere Antwort meldet nicht hier. */}
      {darfLeiten && <EinsatzAbschluss key={einsatzId} einsatzId={einsatzId} />}
    </EinsatzSeite>
  );
}

/** Folge des Abschlusses — steht in der Rückfrage, nicht als Satz neben dem Knopf. */
const ABSCHLIESSEN_FOLGE = 'Danach sind keine neuen Einträge oder Berichtigungen mehr möglich.';

/**
 * Einsatzabschluss (LFH-960, Spec `bedien-wortlaut`): aktiv → abgeschlossen, ohne Rückweg im
 * Frontend. Rückfrage als `Popconfirm`, deren roter Knopf die Handlung nennt. Eine Ablehnung steht
 * am Paneel bis zum nächsten Abschließen, kein Toast (LFH-1077).
 */
function EinsatzAbschluss({ einsatzId }: { einsatzId: number }) {
  const { token } = useRollen();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => schliesseEinsatzAb(einsatzId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: einsatzKeys.einsatz(einsatzId) });
      qc.invalidateQueries({ queryKey: globalKeys.einsaetze() });
      message.success('Einsatz abgeschlossen');
    },
  });
  return (
    <Paneel titel="Einsatzabschluss" koerperPolster style={{ marginTop: token.marginLG }}>
      <Popconfirm
        title="Einsatz abschließen?"
        description={ABSCHLIESSEN_FOLGE}
        okText="Einsatz endgültig abschließen"
        cancelText="Abbrechen"
        okButtonProps={{ danger: true }}
        onConfirm={() => mutation.mutate()}
      >
        <Button danger loading={mutation.isPending}>
          Einsatz abschließen
        </Button>
      </Popconfirm>
      {mutation.error != null && (
        <div style={{ marginTop: token.marginSM }}>
          <SpeicherFehler
            fehler={mutation.error}
            titel="Nicht abgeschlossen"
            fallback="Abschließen fehlgeschlagen"
          />
        </div>
      )}
    </Paneel>
  );
}
