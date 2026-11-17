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
  Paneel,
  kennzahlenbandStil,
  paneelZeileStil,
  useRollen,
  schriftGroesse,
  zahlStil,
  Feldetikett,
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
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { einsatzberichtPfad, einsatzEinstellungenPfad, lagekartePfad } from '../routing/deeplinks';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SPIEGEL_KOPF_ABRUF_MS } from '../einsatz/spiegel/spiegelText';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import {
  ladeEinsatz,
  ladeFuehrungsstelle,
  ladeModulFreigaben,
  patcheEinsatz,
  patcheFuehrungsstelle,
  loeseFuehrungsstelleSprechgruppe,
  ordneFuehrungsstelleSprechgruppeZu,
  schliesseEinsatzAb,
  type KopfdatenPatch,
} from '../api/einsaetze';
import { listeStichwortVorschlaege } from '../api/stichwortVorschlaege';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { useFeldKonflikt } from '../components/useFeldKonflikt';
import {
  ausschnitt,
  ausschnittLeer,
  ausschnittText,
  juengsterVermerk,
  vermerkFuer,
} from '../components/feldVermerk';
import { PaneelVermerk, VermerkZeile } from '../components/FeldVermerkAnzeige';
import {
  alsEingabe as alsVerbindungsEingabe,
  bereinigeVerbindungen,
} from '../components/verbindungen';
import { externeStellenOptions, useExterneStellen } from '../stammdaten/externeStellenVorschlaege';
import { teilwortSuche } from '../components/teilwortSuche';
import { MELDENDE_STELLE_MAX } from '../api/eingabegrenzen';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import { RechteHinweis, SpeicherFehler } from '../components/SpeicherHinweis';
import { NUR_LEITUNG_FUEHRUNG_ORG_ADMIN, spiegelGrund } from '../components/nurAnsicht';
import { InlineAngabe, type InlineEingabe } from '../components/InlineAngabe';
import { useViewport } from '../components/useViewport';
import { useAuth } from '../auth/AuthContext';
import {
  darfEinsatzLeiten,
  darfEinsatzVerwalten,
  darfFuehrungBedienen,
  darfFuehrungUnterschreiben,
} from '../einsatz/schreibrecht';
import FuehrungPaneel from '../instanz/FuehrungPaneel';
import { loadFuehrung } from '../api/fuehrung';
import type {
  EinsatzAnzeige,
  Einsatzart,
  EinsatzFahrzeug,
  FeldVermerk,
  Fuehrungsstelle,
  FuehrungsstellenArt,
  FuehrungsstellePatch,
} from '../api/types';
import Segmentleiste from '../components/instrument/Segmentleiste';
import { mitVorgabe } from '../components/vorgabeText';
import { fuehrungsstelleErfasst } from '../einsatz/fuehrungsstelle';
import {
  FUEHRUNGSSTELLE_ADRESSE_MAX,
  FUEHRUNGSSTELLE_BEZEICHNUNG_MAX,
} from '../api/eingabegrenzen';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { listeFahrzeuge } from '../api/fahrzeuge';
import { abrufZustand, type AbrufZustand } from '../api/abrufZustand';
import { ZUSTAND_GRUND } from '../api/abrufZustand';
import {
  rufnameFilter,
  rufnameOptions,
  rufnamePlaceholder,
  rufnameVorschlaege,
} from '../fernmeldewesen/rufnameVorschlaege';
import PaneelZustand from '../components/instrument/PaneelZustand';
import SprechgruppenAngabe, {
  schreibeSprechgruppen,
  type SprechgruppenAenderung,
  type SprechgruppenSchritt,
} from '../components/SprechgruppenAngabe';
import { VerbindungenAngabe } from '../components/VerbindungenFeld';
import EinsatzleiterAngabe from './EinsatzleiterAngabe';
import { einsatzleiterDarstellung, einsatzleiterKurz } from '../einsatz/einsatzleiter';
import { leerZuNull } from '../api/patchTriState';
import { EINSATZART_LABELS, EINSATZART_OPTIONEN } from '../einsatz/einsatzart';
import { istKeyFreigegeben, modulName } from '../einsatz/modulRegistry';
import AblaufPaneel from '../programmpunkt/AblaufPaneel';

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
/**
 * Speichert eine Zeile der Kopfdaten. `alt` = der Wert der Zeile beim Öffnen in Wire-Form; daraus
 * gehen die Schlüssel des Patches als `erwartet` mit (Feld-CAS, LLH-1831). Erfüllt mit
 * `OFFEN_LASSEN`, wenn die Rückfrage ohne Entscheidung schloss.
 */
type FeldSpeichern = (
  etikett: string,
  patch: KopfdatenPatch,
  alt?: KopfdatenPatch,
) => Promise<unknown>;

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
  vermerk,
}: {
  /** Wer zuletzt geändert hat (LLH-1834), für den Hinweis im offenen Feld. */
  vermerk?: FeldVermerk;
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
      vermerk={vermerk}
      etikett={etikett}
      wert={text}
      anzeige={mono ? <span style={zahlStil('text')}>{text}</span> : text}
      leer={leererText}
      gleich={(a, b) => a.trim() === b.trim()}
      darfSchreiben={darfSchreiben}
      mehrzeilig={mehrzeilig}
      pflicht={pflicht}
      onSpeichern={(w, { beimOeffnen }) =>
        speichern(etikett, zuPatch(leerZuNull(w)), zuPatch(leerZuNull(beimOeffnen)))
      }
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
  vermerk,
}: {
  /** Wer zuletzt geändert hat (LLH-1834), für den Hinweis im offenen Feld. */
  vermerk?: FeldVermerk;
  etikett: string;
  wire: string | null | undefined;
  pflicht?: boolean;
  darfSchreiben: boolean;
  speichern: FeldSpeichern;
  zuPatch: (wire: string | null) => KopfdatenPatch;
}) {
  return (
    <InlineAngabe<Dayjs | null>
      vermerk={vermerk}
      etikett={etikett}
      wert={alsZeitpunkt(wire) ?? null}
      anzeige={wire ? <ZeitAnzeige wert={wire} rolle="zeitpunkt" /> : null}
      leer={(d) => d === null}
      gleich={gleicherZeitpunkt}
      pflicht={pflicht}
      darfSchreiben={darfSchreiben}
      onSpeichern={(d, { beimOeffnen }) =>
        speichern(
          etikett,
          zuPatch(d ? alsBackendZeit(d) : null),
          zuPatch(beimOeffnen ? alsBackendZeit(beimOeffnen) : null),
        )
      }
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
  vermerk,
}: {
  /** Wer zuletzt geändert hat (LLH-1834), für den Hinweis im offenen Feld. */
  vermerk?: FeldVermerk;
  einsatzId: number;
  lat: number | null | undefined;
  lon: number | null | undefined;
  darfSchreiben: boolean;
  speichern: FeldSpeichern;
}) {
  const wert: KoordinatenWert = lat != null && lon != null ? { lat, lon } : null;
  return (
    <InlineAngabe<KoordinatenWert>
      vermerk={vermerk}
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
      onSpeichern={(w, { beimOeffnen }) =>
        speichern(
          'Koordinate',
          {
            einsatzort_lat: istLatLon(w) ? w.lat : null,
            einsatzort_lon: istLatLon(w) ? w.lon : null,
          },
          {
            einsatzort_lat: istLatLon(beimOeffnen) ? beimOeffnen.lat : null,
            einsatzort_lon: istLatLon(beimOeffnen) ? beimOeffnen.lon : null,
          },
        )
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
 * Eine Angabe als Zelle im Fugenraster (Feldetikett über dem Wert). Kein `Kennzahl`-Baustein: die
 * Werte sind Wörter — ein Stichwort in Datenwert-Mono läse sich wie ein Messwert.
 */
function KopfAngabe({
  etikett,
  wert,
  mono,
  vermerk,
}: {
  etikett: string;
  wert: ReactNode;
  mono?: boolean;
  /** Wer die Angabe zuletzt geändert hat (LLH-1834), leise unter dem Wert. */
  vermerk?: FeldVermerk;
}) {
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
      <Feldetikett style={{ display: 'block', marginBottom: token.marginXXS }}>
        {etikett}
      </Feldetikett>
      <div
        style={{
          ...(mono ? zahlStil('text', 500) : { fontSize: schriftGroesse('text'), fontWeight: 500 }),
          color: rollen.text,
          overflowWrap: 'anywhere',
        }}
      >
        {wert}
      </div>
      <VermerkZeile vermerk={vermerk} />
    </div>
  );
}

/**
 * Beschriftete Angaben als Zeilen (`dl`) statt umrandeter `Descriptions`-Tabelle: Augenbraue links,
 * Wert rechts, Trenner `flaeche3`. Unter `md` steht die Augenbraue ÜBER dem Wert (Muster
 * `ModulEinstellungsListe`): die 140 px der Etikettspalte ließen dem Wert am Handy zu wenig, und
 * die Seite lief über (LFH-964).
 */
function Angaben({
  zeilen,
}: {
  /** `vermerk`: wer die Angabe zuletzt geändert hat (LLH-1834), leise unter dem Wert. */
  zeilen: { etikett: string; wert: ReactNode; vermerk?: FeldVermerk }[];
}) {
  const { token, rollen } = useRollen();
  const { istSchmal } = useViewport();
  return (
    <dl style={{ margin: 0 }}>
      {zeilen.map(({ etikett, wert, vermerk }) => (
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
          <Feldetikett als="dt">{etikett}</Feldetikett>
          <dd style={{ margin: 0, color: rollen.text2, overflowWrap: 'anywhere' }}>
            {wert}
            <VermerkZeile vermerk={vermerk} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Die Führungsstelle in der Wire-Form des PATCH (LLH-1831): Vergleichswert des Feld-CAS nach einem
 * 409. Der Einsatzleiter ohne „seit“, die Verbindungen ohne Kennung, wie die Zeilen sie senden.
 */
function fuehrungsstelleWire(fs: Fuehrungsstelle): Record<string, unknown> {
  const e = fs.einsatzleiter;
  return {
    art: fs.art,
    bezeichnung: fs.bezeichnung ?? null,
    standort_adresse: fs.standort_adresse ?? null,
    standort_lat: fs.standort_lat ?? null,
    standort_lon: fs.standort_lon ?? null,
    rufname: fs.rufname ?? null,
    verbindungen: bereinigeVerbindungen(alsVerbindungsEingabe(fs.verbindungen)),
    // Als Menge: der Server vergleicht ohne Reihenfolge, die Zeile sortiert nach Funkrufname.
    fahrzeug_ids: [...fs.fahrzeug_ids].sort((a, b) => a - b),
    einsatzleiter: !e
      ? null
      : e.art === 'extern'
        ? { art: 'extern', name: e.name ?? '' }
        : e.personal_id != null
          ? { art: 'personal', personal_id: e.personal_id }
          : { art: 'personal' },
  };
}

type Konventionen = ReturnType<typeof useAnzeigeKonventionen>;

/**
 * Der aktuelle Wert einer Kopfangabe lesbar für die Rückfrage (Review LLH-1831): Zeit in der
 * Anzeigezone, Einsatzart als Bezeichnung, Ort als Text oder Koordinate; sonst die Wire-Werte.
 */
function kopfAnzeige(
  e: EinsatzAnzeige,
  patch: KopfdatenPatch,
  k: Konventionen,
): string | undefined {
  if ('begonnen_at' in patch) return e.begonnen_at ? k.zeitpunkt(e.begonnen_at) : undefined;
  if ('einsatzart' in patch) return EINSATZART_LABELS[e.einsatzart];
  if ('einsatzort' in patch && e.einsatzort) return e.einsatzort;
  if ('einsatzort_lat' in patch && e.einsatzort_lat != null && e.einsatzort_lon != null) {
    return k.formatKoordinate(e.einsatzort_lat, e.einsatzort_lon);
  }
  return undefined;
}

/** Der aktuelle Wert einer Angabe der Führungsstelle lesbar für die Rückfrage (Review LLH-1831). */
function fuehrungsstelleAnzeige(
  fs: Fuehrungsstelle,
  patch: FuehrungsstellePatch,
  k: Konventionen,
): string | undefined {
  if ('einsatzleiter' in patch) {
    return einsatzleiterKurz(einsatzleiterDarstellung({ zustand: 'daten', daten: fs }));
  }
  if ('verbindungen' in patch) return fs.verbindungen.map((v) => v.wert).join(', ');
  if ('fahrzeug_ids' in patch) {
    const n = fs.fahrzeug_ids.length;
    return n === 1 ? '1 Führungsfahrzeug' : `${n} Führungsfahrzeuge`;
  }
  if ('standort_adresse' in patch && fs.standort_adresse) return fs.standort_adresse;
  if ('standort_lat' in patch && fs.standort_lat != null && fs.standort_lon != null) {
    return k.formatKoordinate(fs.standort_lat, fs.standort_lon);
  }
  return undefined;
}

/** Die Angaben der Führungsstelle mit Vermerk, für den Paneelkopf (LLH-1834). */
const FUEHRUNGSSTELLE_FELDER = [
  'einsatzleiter',
  'art',
  'bezeichnung',
  'standort_adresse',
  'standort_koordinate',
  'rufname',
  'verbindungen',
  'fahrzeug_ids',
] as const;

/** Gleiche Auswahl (Fahrzeuge) unabhängig von der Reihenfolge („unverändert → kein Senden“). */
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
    <Paneel
      titel="Einsatzort"
      meta={
        <PaneelVermerk
          vermerk={juengsterVermerk(einsatz.vermerke, ['einsatzort', 'einsatzort_koordinate'])}
        />
      }
    >
      <Angaben
        zeilen={[
          {
            etikett: 'Adresse',
            vermerk: einsatz.vermerke?.einsatzort,
            wert: (
              <InlineAngabe<OrtsfeldWert>
                vermerk={einsatz.vermerke?.einsatzort}
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
                onSpeichern={(w, { beimOeffnen }) =>
                  speichern(
                    'Adresse',
                    // Die Koordinate geht nur mit, wenn sie neu ist (Treffer, Nadel, getippt);
                    // reiner Text schickt nur die Adresse (Spec `einsatzdaten-bearbeitung`).
                    // Hat das Feld den gespeicherten Punkt verloren (geleerter Text, LLH-1534),
                    // geht er als `null` mit: sonst bliebe ein Punkt, den die Maske nicht zeigte.
                    // „Neu“ und „verloren“ gegenüber dem Stand beim Öffnen, nicht dem Live-Punkt:
                    // sonst schriebe eine reine Textänderung eine inzwischen fremd verschobene
                    // Koordinate zurück (Review LLH-1831).
                    w.koordinate &&
                      (w.koordinate.lat !== beimOeffnen.koordinate?.lat ||
                        w.koordinate.lon !== beimOeffnen.koordinate?.lon)
                      ? {
                          einsatzort: leerZuNull(w.text),
                          einsatzort_lat: w.koordinate.lat,
                          einsatzort_lon: w.koordinate.lon,
                        }
                      : !w.koordinate && beimOeffnen.koordinate
                        ? {
                            einsatzort: leerZuNull(w.text),
                            einsatzort_lat: null,
                            einsatzort_lon: null,
                          }
                        : { einsatzort: leerZuNull(w.text) },
                    // Der Altwert in voller Form; es gehen nur die Schlüssel des Patches mit.
                    {
                      einsatzort: leerZuNull(beimOeffnen.text),
                      einsatzort_lat: beimOeffnen.koordinate?.lat ?? null,
                      einsatzort_lon: beimOeffnen.koordinate?.lon ?? null,
                    },
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
            vermerk: einsatz.vermerke?.einsatzort_koordinate,
            wert: (
              <KoordinatenAngabe
                vermerk={einsatz.vermerke?.einsatzort_koordinate}
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
    mutationFn: ({
      patch,
      erwartet,
    }: {
      etikett: string;
      patch: FuehrungsstellePatch;
      erwartet?: Record<string, unknown>;
    }) => patcheFuehrungsstelle(einsatzId, patch, erwartet),
    onSuccess: (neu, { etikett }) => {
      qc.setQueryData(einsatzKeys.fuehrungsstelle(einsatzId), neu);
      message.success(`${etikett} gespeichert`);
    },
  });
  // Feld-CAS mit dem einen Konfliktablauf (LLH-1831): `alt` ist der Wert der Zeile beim Öffnen in
  // Wire-Form; verglichen wird mit der Wire-Form des frisch geladenen Stands.
  const konflikt = useFeldKonflikt();
  const fsKonv = useAnzeigeKonventionen();
  const speichern = (etikett: string, patch: FuehrungsstellePatch, alt?: Record<string, unknown>) =>
    konflikt({
      etikett,
      erwartet: alt ? ausschnitt(alt, patch) : undefined,
      speichern: async (erwartet) => {
        await mutation.mutateAsync({ etikett, patch, erwartet });
      },
      ladeFrisch: () =>
        qc.fetchQuery({
          queryKey: einsatzKeys.fuehrungsstelle(einsatzId),
          queryFn: () => ladeFuehrungsstelle(einsatzId),
          staleTime: 0,
        }),
      aktuell: (frisch) => ({
        wert: ausschnitt(fuehrungsstelleWire(frisch), patch),
        vermerk: vermerkFuer(frisch.vermerke, patch),
        anzeige: fuehrungsstelleAnzeige(frisch, patch, fsKonv),
      }),
      text: ausschnittText,
      leer: (w) => w === undefined || ausschnittLeer(w),
    });
  /*
   * Sprechgruppen über die Einzelwege (LLH-1456, D1/D5): erst lösen, dann zuordnen; die erste
   * Ablehnung hält an und steht an der Zeile. Die Wege antworten ohne Körper, deshalb wartet das
   * Paneel in jedem Fall auf den neu geladenen Stand. Jede wirksame Änderung schreibt der Server ins
   * Tagebuch, deshalb auch `etb`.
   */
  const sprechgruppen = useMutation({
    mutationFn: (v: {
      aenderung: SprechgruppenAenderung;
      onSchritt: (schritt: SprechgruppenSchritt) => void;
    }) =>
      schreibeSprechgruppen({
        ...v,
        loesen: (id) => loeseFuehrungsstelleSprechgruppe(einsatzId, id),
        zuordnen: (id) => ordneFuehrungsstelleSprechgruppeZu(einsatzId, id),
        nachladen: () => {
          qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
          return qc.invalidateQueries({ queryKey: einsatzKeys.fuehrungsstelle(einsatzId) });
        },
      }),
    onSuccess: () => message.success('Sprechgruppen gespeichert'),
  });
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
      vermerk={fs?.vermerke?.[schluessel]}
      wert={wert ?? ''}
      anzeige={wert}
      leer={leererText}
      gleich={(a, b) => a.trim() === b.trim()}
      darfSchreiben={darfSchreiben}
      onSpeichern={(w, { beimOeffnen }) =>
        speichern(
          etikett,
          { [schluessel]: leerZuNull(w) },
          { [schluessel]: leerZuNull(beimOeffnen) },
        )
      }
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
    <Paneel
      titel="Eigene Führungsstelle"
      meta={<PaneelVermerk vermerk={juengsterVermerk(fs?.vermerke, FUEHRUNGSSTELLE_FELDER)} />}
    >
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
                vermerk: fs.vermerke?.einsatzleiter,
                wert: (
                  <EinsatzleiterAngabe
                    vermerk={fs.vermerke?.einsatzleiter}
                    einsatzId={einsatzId}
                    fs={fs}
                    darfSchreiben={darfSchreiben}
                    onSpeichern={(einsatzleiter, alt) =>
                      speichern('Einsatzleiter', { einsatzleiter }, { einsatzleiter: alt })
                    }
                  />
                ),
              },
              {
                etikett: 'Art',
                vermerk: fs.vermerke?.art,
                wert: (
                  <ArtAngabe
                    art={fs.art}
                    erfasst={fuehrungsstelleErfasst(fs)}
                    darfSchreiben={darfSchreiben}
                    // Ohne Öffnen (Umschalter): der Altwert ist die gezeigte Art.
                    onSpeichern={(art) => speichern('Art', { art }, { art: fs.art })}
                  />
                ),
              },
              {
                etikett: 'Bezeichnung',
                vermerk: fs.vermerke?.bezeichnung,
                wert: text(
                  'Bezeichnung',
                  fs.bezeichnung,
                  'bezeichnung',
                  FUEHRUNGSSTELLE_BEZEICHNUNG_MAX,
                ),
              },
              {
                etikett: 'Standort',
                vermerk: juengsterVermerk(fs.vermerke, ['standort_adresse', 'standort_koordinate']),
                wert: (
                  <StandortAngabe
                    vermerk={juengsterVermerk(fs.vermerke, [
                      'standort_adresse',
                      'standort_koordinate',
                    ])}
                    fs={fs}
                    einsatz={einsatz}
                    darfSchreiben={darfSchreiben}
                    onSpeichern={(patch, alt) => speichern('Standort', patch, alt)}
                  />
                ),
              },
              {
                etikett: 'Rufname',
                vermerk: fs.vermerke?.rufname,
                wert: (
                  <RufnameAngabe
                    vermerk={fs.vermerke?.rufname}
                    rufname={fs.rufname}
                    fahrzeugIds={fs.fahrzeug_ids}
                    quelle={fahrzeugQuelle}
                    darfSchreiben={darfSchreiben}
                    onSpeichern={(w, { beimOeffnen }) =>
                      speichern(
                        'Rufname',
                        { rufname: leerZuNull(w) },
                        { rufname: leerZuNull(beimOeffnen) },
                      )
                    }
                  />
                ),
              },
              {
                etikett: 'Sprechgruppen',
                wert: (
                  <SprechgruppenAngabe
                    sprechgruppen={fs.sprechgruppen}
                    einsatzId={einsatzId}
                    darfSchreiben={darfSchreiben}
                    onSpeichern={(aenderung, onSchritt) =>
                      sprechgruppen.mutateAsync({ aenderung, onSchritt })
                    }
                  />
                ),
              },
              {
                // Funk (Rufname, Sprechgruppen) und Telefon getrennt (LLH-1134).
                etikett: 'Telefon und weitere Verbindungen',
                vermerk: fs.vermerke?.verbindungen,
                wert: (
                  <VerbindungenAngabe
                    vermerk={fs.vermerke?.verbindungen}
                    etikett="Telefon und weitere Verbindungen"
                    verbindungen={fs.verbindungen}
                    darfSchreiben={darfSchreiben}
                    onSpeichern={(liste, alt) =>
                      speichern(
                        'Telefon und weitere Verbindungen',
                        { verbindungen: liste },
                        { verbindungen: alt },
                      )
                    }
                  />
                ),
              },
              {
                etikett: 'Führungsfahrzeuge',
                vermerk: fs.vermerke?.fahrzeug_ids,
                wert: (
                  <FuehrungsfahrzeugeZeile
                    vermerk={fs.vermerke?.fahrzeug_ids}
                    art={fs.art}
                    ids={fs.fahrzeug_ids}
                    quelle={fahrzeugQuelle}
                    darfSchreiben={darfSchreiben}
                    onSpeichern={(ids, { beimOeffnen }) =>
                      speichern(
                        'Führungsfahrzeuge',
                        { fahrzeug_ids: ids },
                        { fahrzeug_ids: [...beimOeffnen].sort((a, b) => a - b) },
                      )
                    }
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
  vermerk,
}: {
  /** Wer zuletzt geändert hat (LLH-1834), für den Hinweis im offenen Feld. */
  vermerk?: FeldVermerk;
  fs: Fuehrungsstelle;
  einsatz: EinsatzAnzeige;
  darfSchreiben: boolean;
  /** `alt`: Adresse und Koordinate beim Öffnen in Wire-Form (Feld-CAS, LLH-1831). */
  onSpeichern: (patch: FuehrungsstellePatch, alt: Record<string, unknown>) => Promise<unknown>;
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
      vermerk={vermerk}
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
      onSpeichern={(w, { beimOeffnen }) => {
        if (istUngueltigeKoordinate(w.koord)) {
          return Promise.reject(new Error('Koordinate nicht lesbar'));
        }
        const ll = alsLatLon(w.koord);
        const alt = alsLatLon(beimOeffnen.koord);
        return onSpeichern(
          {
            standort_adresse: leerZuNull(w.adresse),
            standort_lat: ll?.lat ?? null,
            standort_lon: ll?.lon ?? null,
          },
          {
            standort_adresse: leerZuNull(beimOeffnen.adresse),
            standort_lat: alt?.lat ?? null,
            standort_lon: alt?.lon ?? null,
          },
        );
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
 * `fernmeldewesen/rufnameVorschlaege.tsx`): Funkrufnamen der Führungsfahrzeuge, Freitext bleibt erlaubt.
 */
function RufnameAngabe({
  rufname,
  fahrzeugIds,
  quelle,
  darfSchreiben,
  onSpeichern,
  vermerk,
}: {
  /** Wer zuletzt geändert hat (LLH-1834), für den Hinweis im offenen Feld. */
  vermerk?: FeldVermerk;
  rufname: string | null | undefined;
  fahrzeugIds: readonly number[];
  quelle: ReturnType<typeof useFahrzeugeQuelle>;
  darfSchreiben: boolean;
  onSpeichern: (wert: string, kontext: { beimOeffnen: string }) => Promise<unknown>;
}) {
  return (
    <InlineAngabe<string>
      vermerk={vermerk}
      etikett="Rufname"
      wert={rufname ?? ''}
      anzeige={
        <span data-schrift="kennung" style={zahlStil('text')}>
          {rufname}
        </span>
      }
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
  vermerk,
}: {
  /** Wer zuletzt geändert hat (LLH-1834), für den Hinweis im offenen Feld. */
  vermerk?: FeldVermerk;
  ids: readonly number[];
  quelle: ReturnType<typeof useFahrzeugeQuelle>;
  darfSchreiben: boolean;
  onSpeichern: (ids: number[], kontext: { beimOeffnen: number[] }) => Promise<unknown>;
}) {
  if (quelle.zustand !== 'daten') return <>{ZUSTAND_GRUND[quelle.zustand]}</>;
  // Eine ID ohne disponiertes Fahrzeug (inzwischen entlassen) fällt still weg.
  const gewaehlt = quelle.fahrzeuge.filter((f) => ids.includes(f.id));
  return (
    <InlineAngabe<number[]>
      vermerk={vermerk}
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
    mutationFn: ({
      patch,
      erwartet,
    }: {
      etikett: string;
      patch: KopfdatenPatch;
      erwartet?: Partial<KopfdatenPatch>;
    }) => patcheEinsatz(einsatzId, patch, erwartet),
    onSuccess: (aktualisiert, { etikett }) => {
      // Erst in den Cache, dann erfüllen: die Zeile zeigt den neuen Wert in derselben Runde, in der
      // sie die Eingabe schließt, und die Fokusrückgabe trifft den frischen Wertknopf.
      qc.setQueryData(einsatzKeys.einsatz(einsatzId), aktualisiert);
      qc.invalidateQueries({ queryKey: einsatzKeys.einsatz(einsatzId) });
      qc.invalidateQueries({ queryKey: globalKeys.einsaetze() });
      message.success(`${etikett} gespeichert`);
    },
  });
  // Feld-CAS mit dem einen Konfliktablauf (LLH-1831, `components/useFeldKonflikt`): die Schlüssel
  // des Patches gehen mit ihrem Wert beim Öffnen als `erwartet` mit.
  const konflikt = useFeldKonflikt();
  const konv = useAnzeigeKonventionen();
  const feldSpeichern: FeldSpeichern = (etikett, patch, alt) =>
    konflikt({
      etikett,
      erwartet: alt ? ausschnitt(alt, patch) : undefined,
      speichern: async (erwartet) => {
        await feldMutation.mutateAsync({ etikett, patch, erwartet });
      },
      ladeFrisch: () =>
        qc.fetchQuery({
          queryKey: einsatzKeys.einsatz(einsatzId),
          queryFn: () => ladeEinsatz(einsatzId),
          staleTime: 0,
        }),
      aktuell: (frisch) => ({
        wert: ausschnitt(frisch, patch),
        vermerk: vermerkFuer(frisch.vermerke, patch),
        anzeige: kopfAnzeige(frisch, patch, konv),
      }),
      text: ausschnittText,
      leer: (w) => w === undefined || ausschnittLeer(w),
    });

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
      // Am aktiven Einsatz ohne Verwaltungsrecht der Grund (am Spiegel die führende Instanz,
      // LLH-1641); bedingt übergeben, sonst bliebe ein leerer Slot mit Außenabstand (wie `StabPage`).
      hinweis={
        einsatz.status === 'aktiv' &&
        !darfBearbeiten && (
          <RechteHinweis
            sichtbar
            text={einsatz.spiegel ? spiegelGrund(einsatz.spiegel) : NUR_LEITUNG_FUEHRUNG_ORG_ADMIN}
          />
        )
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
          vermerk={einsatz.vermerke?.stichwort}
          wert={
            <InlineAngabe<string>
              etikett="Einsatzstichwort"
              vermerk={einsatz.vermerke?.stichwort}
              wert={einsatz.stichwort ?? ''}
              anzeige={einsatz.stichwort}
              leer={leererText}
              gleich={(a, b) => a.trim() === b.trim()}
              darfSchreiben={darfBearbeiten}
              onSpeichern={(w, { beimOeffnen }) =>
                feldSpeichern(
                  'Einsatzstichwort',
                  { stichwort: leerZuNull(w) },
                  { stichwort: leerZuNull(beimOeffnen) },
                )
              }
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
          vermerk={einsatz.vermerke?.begonnen_at}
          mono
          wert={
            <ZeitpunktAngabe
              etikett="Alarmzeit"
              vermerk={einsatz.vermerke?.begonnen_at}
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
        <Paneel
          titel="Einsatz"
          meta={
            <PaneelVermerk
              vermerk={juengsterVermerk(einsatz.vermerke, [
                'bezeichnung',
                'einsatzart',
                'leitstellen_nr',
              ])}
            />
          }
        >
          <Angaben
            zeilen={[
              {
                etikett: 'Bezeichnung',
                vermerk: einsatz.vermerke?.bezeichnung,
                wert: (
                  <TextAngabe
                    etikett="Bezeichnung"
                    vermerk={einsatz.vermerke?.bezeichnung}
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
                vermerk: einsatz.vermerke?.einsatzart,
                wert: (
                  <InlineAngabe<Einsatzart>
                    etikett="Einsatzart"
                    vermerk={einsatz.vermerke?.einsatzart}
                    wert={einsatz.einsatzart}
                    anzeige={EINSATZART_LABELS[einsatz.einsatzart]}
                    // Pflicht, aber ein `Select` ohne `allowClear` kann nicht leer werden.
                    leer={() => false}
                    darfSchreiben={darfBearbeiten}
                    onSpeichern={(art, { beimOeffnen }) =>
                      feldSpeichern('Einsatzart', { einsatzart: art }, { einsatzart: beimOeffnen })
                    }
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
                wert: <span style={zahlStil('text')}>{einsatz.einsatznummer_intern ?? '—'}</span>,
              },
              {
                etikett: 'Leitstellen-Nr.',
                vermerk: einsatz.vermerke?.leitstellen_nr,
                wert: (
                  <TextAngabe
                    etikett="Leitstellen-Nr."
                    vermerk={einsatz.vermerke?.leitstellen_nr}
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
                  <span style={zahlStil('text')}>
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

        {/* Programmpunkte der Veranstaltung (LLH-1570): Marken im Überblick und auf dem Monitor. */}
        <AblaufPaneel einsatzId={einsatzId} darfSchreiben={darfBearbeiten} />

        <Paneel
          titel="Erstmeldung"
          meta={
            <PaneelVermerk
              vermerk={juengsterVermerk(einsatz.vermerke, [
                'meldende_stelle',
                'sachverhalt',
                'anzahl_betroffene_initial',
              ])}
            />
          }
        >
          <Angaben
            zeilen={[
              {
                etikett: 'Meldende Stelle',
                vermerk: einsatz.vermerke?.meldende_stelle,
                // Vorschläge aus dem Katalog „Externe Stellen“ (LFH-1194); gespeichert wird nur
                // der Text (Speicherform A), Freitext bleibt.
                wert: (
                  <InlineAngabe<string>
                    etikett="Meldende Stelle"
                    vermerk={einsatz.vermerke?.meldende_stelle}
                    wert={einsatz.meldende_stelle ?? ''}
                    anzeige={einsatz.meldende_stelle}
                    leer={leererText}
                    gleich={(a, b) => a.trim() === b.trim()}
                    darfSchreiben={darfBearbeiten}
                    onSpeichern={(w, { beimOeffnen }) =>
                      feldSpeichern(
                        'Meldende Stelle',
                        { meldende_stelle: leerZuNull(w) },
                        { meldende_stelle: leerZuNull(beimOeffnen) },
                      )
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
                vermerk: einsatz.vermerke?.sachverhalt,
                wert: (
                  <TextAngabe
                    etikett="Sachverhalt / Meldebild"
                    vermerk={einsatz.vermerke?.sachverhalt}
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
                vermerk: einsatz.vermerke?.anzahl_betroffene_initial,
                wert: (
                  <InlineAngabe<number | null>
                    etikett="Anzahl Betroffene (initial)"
                    vermerk={einsatz.vermerke?.anzahl_betroffene_initial}
                    wert={einsatz.anzahl_betroffene_initial ?? null}
                    anzeige={
                      <span style={zahlStil('text')}>{einsatz.anzahl_betroffene_initial}</span>
                    }
                    leer={(n) => n === null}
                    darfSchreiben={darfBearbeiten}
                    onSpeichern={(n, { beimOeffnen }) =>
                      feldSpeichern(
                        'Anzahl Betroffene (initial)',
                        { anzahl_betroffene_initial: n },
                        { anzahl_betroffene_initial: beimOeffnen },
                      )
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

      {/* Führung je Einsatz (LLH-1491): vor dem Abschluss, weil eine Übergabe wie der Abschluss den
          ganzen Einsatz betrifft. Nur mit Akte (gekoppelte Org, Schalter an). */}
      {einsatz.fuehrung && (
        <FuehrungAbschnitt
          einsatzId={einsatzId}
          darfBedienen={darfFuehrungBedienen(einsatz, benutzer)}
          darfUnterschreiben={darfFuehrungUnterschreiben(einsatz, benutzer)}
        />
      )}

      {/* Zuletzt und nicht im Kopf (LFH-960): Unumkehrbares für den ganzen Einsatz steht nicht im
          Kopf einer Arbeitsseite (`frontend/AGENTS.md`, „Destruktiv ist nicht gleich destruktiv“). */}
      {/* `key`: ein Einsatzwechsel räumt den Grund, eine spätere Antwort meldet nicht hier. */}
      {darfLeiten && <EinsatzAbschluss key={einsatzId} einsatzId={einsatzId} />}
    </EinsatzSeite>
  );
}

/** Paneel „Führung“ mit eigener Abfrage (Akte und Verlauf, live über `einsatz`). */
function FuehrungAbschnitt({
  einsatzId,
  darfBedienen,
  darfUnterschreiben,
}: {
  einsatzId: number;
  darfBedienen: boolean;
  darfUnterschreiben: boolean;
}) {
  const { token } = useRollen();
  const q = useQuery({
    queryKey: einsatzKeys.fuehrung(einsatzId),
    queryFn: () => loadFuehrung(einsatzId),
    // Solange die Kopplung zur Führung beendet ist, im Takt des Hinweisbands (LLH-1850): Eine
    // neue Kopplung meldet keinen Kopf, und das Paneel böte sonst weiter das Zurückholen an.
    refetchInterval: (query) =>
      query.state.data?.fuehrer_beendet_at ? SPIEGEL_KOPF_ABRUF_MS : false,
  });
  // `?paneel=fuehrung` (Hinweisband „Führung zurückholen“, LLH-1850): einmal zum Paneel rollen,
  // sobald es steht (auch als Fehlerzustand), dann den Auftrag aus der Adresse nehmen
  // (apply-then-clean).
  const [params, setParams] = useSearchParams();
  const targetRef = useRef<HTMLDivElement>(null);
  const isPending = q.isPending;
  useEffect(() => {
    if (isPending || params.get('paneel') !== 'fuehrung') return;
    targetRef.current?.scrollIntoView?.({ block: 'start' });
    const rest = new URLSearchParams(params);
    rest.delete('paneel');
    setParams(rest, { replace: true });
  }, [isPending, params, setParams]);
  return (
    <div ref={targetRef} data-lfh="fuehrung-abschnitt">
      {q.data ? (
        <FuehrungPaneel
          fuehrung={q.data}
          darfBedienen={darfBedienen}
          darfUnterschreiben={darfUnterschreiben}
          style={{ marginTop: token.marginLG }}
        />
      ) : (
        // Ein gescheiterter Abruf steht am Platz des Paneels, mit „Erneut laden“ (PaneelZustand).
        <Paneel titel="Führung" style={{ marginTop: token.marginLG }}>
          <PaneelZustand
            zustand={q.isError ? 'fehler' : 'laden'}
            titel="Führung"
            leerText=""
            onNeuladen={() => void q.refetch()}
          >
            {null}
          </PaneelZustand>
        </Paneel>
      )}
    </div>
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
