import { useState } from 'react';
import { App, Button, Descriptions, Tag, Typography, theme } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { taktischeDtgVoll } from '../../anzeige/format';
import { PEGEL_MAX, fuegePegelHinzu, pegelAbfrage, pegelSchreibScope } from '../../api/pegel';
import { einsatzKeys } from '../../api/queryKeys';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import { einsatzEinstellungenPfad } from '../../routing/deeplinks';
import type { EnergieAnlagenart, FachebeneQuelle } from '../../api/fachebenen';
import GeoKennzahlen from '../../components/GeoKennzahlen';
import StatusTag from '../../components/StatusTag';
import { rollenFarbe } from '../../theme/statusFarben';
import { FACHEBENEN } from './fachebenen';
import { kategorieLabel } from './fachebenenLayer';
import { geoKennzahlen } from './geo';
import { hochwasserDarstellung } from './hochwasserStil';
import { luftqualitaetDarstellung } from './luftqualitaetStil';
import { odlDarstellung, odlGrundlage } from './odlStil';
import KartenDetailCard from './KartenDetailCard';

interface FachebenenInspectorProps {
  quelle: FachebeneQuelle;
  properties: Record<string, unknown>;
  /** Volle (ungeclippte) Geometrie des angeklickten Features → Fläche/Umfang/Länge. */
  geometrie?: { type: string; coordinates: unknown } | null;
  onSchliessen: () => void;
  /**
   * Einsatzbezug für den Schnellweg „Als maßgeblichen Pegel festlegen" an einem PEGELONLINE-Punkt.
   * Als Prop statt Context: der Inspektor bleibt ohne Einsatz montierbar. `darfSchreiben` ist das
   * Einsatz-Schreibrecht der Lagekarte (im Snapshot-Modus `false`).
   */
  pegelBezug?: { einsatzId: number; darfSchreiben: boolean };
}

/** Wert als getrimmter String oder null (akzeptiert auch Zahlen). */
function s(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  return null;
}

/** Erstes nicht-leeres Feld aus mehreren möglichen Property-Namen. */
function pick(p: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = s(p[k]);
    if (v) return v;
  }
  return null;
}

/** Nur http(s) zulassen. Die Werte kommen aus fremden Quellen (OSM-Tags, Autobahn-API);
 *  ein `javascript:`-URI in `href`/`src` wäre XSS. */
function nurWeb(v: string | null): string | null {
  return v && /^https?:\/\//i.test(v) ? v : null;
}

/** ISO-Zeit hübsch (de-DE), Fallback auf Rohwert. */
function fmtZeit(v: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : taktischeDtgVoll(v);
}

/** „DAUERREGEN" / „STARKES GEWITTER" → „Dauerregen" / „Starkes Gewitter". */
function titelCase(v: string): string {
  return v
    .toLocaleLowerCase('de-DE')
    .replace(/(^|\s|-)([\p{L}])/gu, (_, sep, ch) => sep + ch.toLocaleUpperCase('de-DE'));
}

/** Emoji-Icon zum Wetter-Ereignis (DWD EC_GROUP / EVENT). */
function wetterIcon(group: string | null, event: string | null): string {
  const t = `${group ?? ''} ${event ?? ''}`.toUpperCase();
  if (/GEWITTER|THUNDER/.test(t)) return '⛈️';
  if (/REGEN|RAIN/.test(t)) return '🌧️';
  if (/STURM|ORKAN|WIND|BÖ/.test(t)) return '💨';
  if (/SCHNEE|SNOW|GLATT|GLÄTTE|EIS|GLAZE|ICE|FROST|TAUWETTER|THAW/.test(t)) return '❄️';
  if (/NEBEL|FOG/.test(t)) return '🌫️';
  if (/HITZE|HEAT/.test(t)) return '🌡️';
  if (/UV/.test(t)) return '☀️';
  return '⚠️';
}

const SCHWERE: Record<string, { label: string; color: string }> = {
  Extreme: { label: 'Extrem', color: 'red' },
  Severe: { label: 'Schwer', color: 'volcano' },
  Moderate: { label: 'Mäßig', color: 'gold' },
  Minor: { label: 'Gering', color: 'blue' },
};

const DRINGLICHKEIT: Record<string, string> = {
  Immediate: 'Sofort',
  Expected: 'Erwartet',
  Future: 'Zukünftig',
  Past: 'Vergangen',
  Unknown: 'Unbekannt',
};

// PEGELONLINE `stateMnwMhw` ist englisch; nur aussagekräftige Werte werden ein Tag.
const ZUSTAND: Record<string, { label: string; color: string }> = {
  high: { label: 'Hoch', color: 'red' },
  normal: { label: 'Normal', color: 'green' },
  low: { label: 'Niedrig', color: 'gold' },
};

function WarnungInhalt({ p }: { p: Record<string, unknown> }) {
  const headline = pick(p, 'HEADLINE', 'titel', 'headline');
  const schwere = pick(p, 'SEVERITY', 'schwere', 'severity');
  const sev = schwere ? SCHWERE[schwere] : undefined;
  const dring = pick(p, 'URGENCY', 'dringlichkeit', 'urgency');
  const von = fmtZeit(pick(p, 'ONSET', 'EFFECTIVE', 'beginn'));
  const bis = fmtZeit(pick(p, 'EXPIRES'));
  const quelle = pick(p, 'SENDERNAME') ?? 'BBK / MoWaS';
  const beschreibung = pick(p, 'DESCRIPTION', 'description');
  const hinweis = pick(p, 'INSTRUCTION', 'instruction');

  return (
    <>
      {headline && (
        <Typography.Paragraph strong style={{ marginBottom: 8 }}>
          {headline}
        </Typography.Paragraph>
      )}
      {sev ? (
        <Tag color={sev.color} style={{ marginBottom: 8 }}>
          {sev.label}
        </Tag>
      ) : schwere ? (
        <Tag style={{ marginBottom: 8 }}>{schwere}</Tag>
      ) : null}
      <Descriptions column={1}>
        {dring && (
          <Descriptions.Item label="Dringlichkeit">
            {DRINGLICHKEIT[dring] ?? dring}
          </Descriptions.Item>
        )}
        {(von || bis) && (
          <Descriptions.Item label="Gültig">
            {von ?? '?'}
            {bis ? ` – ${bis}` : ''}
          </Descriptions.Item>
        )}
        <Descriptions.Item label="Quelle">{quelle}</Descriptions.Item>
      </Descriptions>
      {beschreibung && (
        <Typography.Paragraph style={{ marginTop: 8, marginBottom: hinweis ? 8 : 0, fontSize: 13 }}>
          {beschreibung}
        </Typography.Paragraph>
      )}
      {hinweis && (
        <>
          <Typography.Text strong style={{ fontSize: 12 }}>
            Handlungsempfehlung
          </Typography.Text>
          <Typography.Paragraph style={{ marginTop: 2, marginBottom: 0, fontSize: 13 }}>
            {hinweis}
          </Typography.Paragraph>
        </>
      )}
    </>
  );
}

/**
 * Schnellweg „Als maßgeblichen Pegel festlegen".
 *
 * Ist die Station schon maßgeblich, steht das als Marke statt des Knopfs, auch ohne Schreibrecht.
 * Der Knopf braucht Schreibrecht und eine `uuid`; ohne `uuid` entfällt der Block.
 *
 * Bei fünf festgelegten Pegeln steht der Knopf gesperrt mit Grund und Weg in die Einstellungen,
 * statt zu verschwinden (der Server lehnte einen sechsten mit 422 ab). Gespeichert wird per POST
 * (hinten anfügen, idempotent); die Antwort ist die volle Liste und landet per `setQueryData` im
 * gemeinsamen Cache von Dashboard, Überblick und Einstellungen.
 */
function PegelFestlegen({
  einsatzId,
  darfSchreiben,
  uuid,
  name,
  gewaesser,
}: {
  einsatzId: number;
  darfSchreiben: boolean;
  uuid: string;
  name: string;
  gewaesser: string | null;
}) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const pegelQ = useQuery(pegelAbfrage(einsatzId));
  // Kein `onError`-Toast: der Fehler bleibt im Panel stehen.
  const festlegen = useMutation({
    // Derselbe Scope wie die Einstellungssektion: Schreibwege auf die Liste laufen nacheinander.
    scope: pegelSchreibScope(einsatzId),
    mutationFn: () => fuegePegelHinzu(einsatzId, { station_uuid: uuid, name, gewaesser }),
    onSuccess: (liste) => {
      qc.setQueryData(einsatzKeys.pegel(einsatzId), liste);
      // Auslöser der Lagekennzahl am Einsatz — siehe `EinsatzPegel`.
      void qc.invalidateQueries({ queryKey: einsatzKeys.einsatz(einsatzId) });
      message.success('Als maßgeblicher Pegel festgelegt');
    },
  });

  const liste = pegelQ.data;
  const index = liste?.findIndex((e) => e.station_uuid.toLowerCase() === uuid) ?? -1;
  const abstand = { marginTop: token.marginSM };

  if (index >= 0) {
    return (
      <div style={abstand} data-lfh="pegel-massgeblich">
        <Tag>{index === 0 ? 'maßgeblicher Pegel · Leitpegel' : 'maßgeblicher Pegel'}</Tag>
      </div>
    );
  }
  if (!darfSchreiben) return null;

  const voll = (liste?.length ?? 0) >= PEGEL_MAX;
  return (
    <div style={{ ...abstand, display: 'flex', flexDirection: 'column', gap: token.marginXS }}>
      <SpeicherFehler fehler={festlegen.error} />
      <Button
        // Solange die Liste lädt, ist weder „schon maßgeblich" noch „voll" bekannt.
        disabled={pegelQ.isLoading || voll}
        loading={festlegen.isPending}
        onClick={() => festlegen.mutate()}
      >
        Als maßgeblichen Pegel festlegen
      </Button>
      {voll && (
        <Typography.Text type="secondary" data-lfh="pegel-grenze">
          {`Schon ${PEGEL_MAX} maßgebliche Pegel festgelegt — zuerst einen in den `}
          <Link to={einsatzEinstellungenPfad(einsatzId, 'pegel')}>Einstellungen</Link>
          {' entfernen.'}
        </Typography.Text>
      )}
    </div>
  );
}

function PegelInhalt({
  p,
  pegelBezug,
}: {
  p: Record<string, unknown>;
  pegelBezug?: FachebenenInspectorProps['pegelBezug'];
}) {
  const { token } = theme.useToken();
  const wert = s(p.wert);
  const einheit = s(p.einheit);
  const zustand = s(p.zustand);
  const zust = zustand ? ZUSTAND[zustand] : undefined;
  const km = s(p.km);
  return (
    <>
      {wert ? (
        // Keine Überschrift, sondern ein Messwert („320 cm" + Zustand): ein `<h3>` wäre eine
        // Gliederungsebene, die es nicht gibt. Das visuelle Gewicht kommt aus `fontSizeHeading3`.
        <Typography.Text
          strong
          style={{
            display: 'block',
            fontSize: token.fontSizeHeading3,
            marginBottom: token.marginXS,
          }}
        >
          {wert}
          {einheit ? ` ${einheit}` : ''} {zust ? <Tag color={zust.color}>{zust.label}</Tag> : null}
        </Typography.Text>
      ) : (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          Kein aktueller Messwert
        </Typography.Paragraph>
      )}
      <Descriptions column={1}>
        {s(p.gewaesser) && <Descriptions.Item label="Gewässer">{s(p.gewaesser)}</Descriptions.Item>}
        {km && <Descriptions.Item label="Stations-km">{km}</Descriptions.Item>}
        {fmtZeit(s(p.zeitpunkt)) && (
          <Descriptions.Item label="Stand">{fmtZeit(s(p.zeitpunkt))}</Descriptions.Item>
        )}
      </Descriptions>
      {pegelBezug && s(p.uuid) && (
        <PegelFestlegen
          // `key` aus der Station: ein anderer Punkt hängt einen frischen Block ein, sonst trüge
          // Station B Fehler und Ladezustand der Mutation von A.
          key={s(p.uuid)!.toLowerCase()}
          einsatzId={pegelBezug.einsatzId}
          darfSchreiben={pegelBezug.darfSchreiben}
          uuid={s(p.uuid)!.toLowerCase()}
          name={pick(p, 'titel', 'name') ?? 'Pegel'}
          gewaesser={s(p.gewaesser)}
        />
      )}
    </>
  );
}

function KritisInhalt({ p }: { p: Record<string, unknown> }) {
  const kategorie = s(p.kategorie);
  const telefon = s(p.telefon);
  const websiteRoh = s(p.website);
  const website = nurWeb(websiteRoh);
  const notaufnahme = s(p.notaufnahme);
  return (
    <>
      {kategorie && (
        <Tag color="purple" style={{ marginBottom: 8 }}>
          {kategorieLabel(kategorie)}
        </Tag>
      )}
      <Descriptions column={1}>
        {s(p.adresse) && <Descriptions.Item label="Adresse">{s(p.adresse)}</Descriptions.Item>}
        {s(p.betreiber) && (
          <Descriptions.Item label="Betreiber">{s(p.betreiber)}</Descriptions.Item>
        )}
        {telefon && (
          <Descriptions.Item label="Telefon">
            <a href={`tel:${telefon.replace(/\s/g, '')}`}>{telefon}</a>
          </Descriptions.Item>
        )}
        {websiteRoh && (
          <Descriptions.Item label="Web">
            {website ? (
              <a href={website} target="_blank" rel="noreferrer noopener">
                {website}
              </a>
            ) : (
              websiteRoh
            )}
          </Descriptions.Item>
        )}
        {notaufnahme && <Descriptions.Item label="Notaufnahme">{notaufnahme}</Descriptions.Item>}
      </Descriptions>
    </>
  );
}

/**
 * LHP-Pegel: Name, Nummer und Meldeklasse, wie `get_lagepegel.php` sie liefert. Der Wasserstand
 * fehlt bewusst — er käme aus einem Token-gesicherten Einzelabruf je Pegel
 * (`docs/fachebenen-quellen.md`); dafür gibt es die PEGELONLINE-Ebene.
 */
function HochwasserInhalt({ p }: { p: Record<string, unknown> }) {
  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <StatusTag darstellung={hochwasserDarstellung(p.klasse)} />
      </div>
      <Descriptions column={1}>
        {s(p.pgnr) && <Descriptions.Item label="Pegelnummer">{s(p.pgnr)}</Descriptions.Item>}
      </Descriptions>
    </>
  );
}

/** Drei Nachkommastellen im deutschen Format — so führt auch ODL-Info die Werte. */
const ODL_ZAHL = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

/**
 * Faktor mit zwei Nachkommastellen: mit einer stünde „1,5 ×" neben „unauffällig" (1,48) wie neben
 * „erhöht" (1,52).
 */
const ODL_FAKTOR = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * ODL-Sonde des BfS: Stufe als Wort, Messwert, Messende, Betriebsstatus — und der Maßstab der
 * Stufe: der Standort-Grundpegel der Sonde (Faktor-Schwellen 1,5 × / 3 ×) oder, ohne ihn, die
 * absoluten Bänder am natürlichen Bereich. Die Stufen-Labels nennen keinen Maßstab, deshalb steht
 * er hier.
 *
 * Der Hinweissatz ist Pflicht: das BfS veröffentlicht keinen Schwellenwert für „erhöht", ohne ihn
 * läse sich die Stufe wie eine amtliche Bewertung. Ohne Messwert „kein Messwert" und kein Messende.
 * Das Messende steht auch bei aktuellen Werten, weil manche Sonden Stunden hinterher hängen und es
 * keine Stufe „veraltet" gibt.
 */
function OdlInhalt({ p }: { p: Record<string, unknown> }) {
  const { token } = theme.useToken();
  const wert = typeof p.wert === 'number' && Number.isFinite(p.wert) ? p.wert : null;
  const messende = fmtZeit(s(p.messende));
  const grundlage = odlGrundlage(p);
  const hinweisStil = { fontSize: token.fontSizeSM, marginTop: token.marginXS, marginBottom: 0 };
  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <StatusTag darstellung={odlDarstellung(p.stufe)} />
      </div>
      <Descriptions column={1}>
        <Descriptions.Item label="Ortsdosisleistung">
          {wert === null ? 'kein Messwert' : `${ODL_ZAHL.format(wert)} ${s(p.einheit) ?? 'µSv/h'}`}
        </Descriptions.Item>
        {messende && <Descriptions.Item label="Messende">{messende}</Descriptions.Item>}
        {grundlage.art === 'standort' && (
          <>
            <Descriptions.Item label="Grundpegel">
              {`${ODL_ZAHL.format(grundlage.grundpegel)} µSv/h`}
              {grundlage.stand && ` (Stand ${fmtZeit(grundlage.stand)})`}
            </Descriptions.Item>
            <Descriptions.Item label="Faktor">{`${ODL_FAKTOR.format(grundlage.faktor)} ×`}</Descriptions.Item>
          </>
        )}
        {s(p.betrieb) && <Descriptions.Item label="Sonde">{s(p.betrieb)}</Descriptions.Item>}
        {/* Ortsnamen sind nicht eindeutig; die Kennung ist der Schlüssel für ODL-Info. */}
        {s(p.kennung) && <Descriptions.Item label="Kennung">{s(p.kennung)}</Descriptions.Item>}
      </Descriptions>
      {grundlage.art === 'standort' ? (
        <Typography.Paragraph type="secondary" style={hinweisStil}>
          Einteilung des Lifeline Hub nach dem Grundpegel dieser Sonde (unteres Quartil der letzten
          sieben Tage): über 1,5 × erhöht, über 3 × stark erhöht — den Faktor 3 nennt das BfS als
          Anlass zur Besorgnis. Kein amtlicher Schwellenwert. Regen kann Werte kurzzeitig bis zum
          Dreifachen anheben.
        </Typography.Paragraph>
      ) : (
        <Typography.Paragraph type="secondary" style={hinweisStil}>
          {/* Nur mit Messwert in µSv/h — unter fremder Einheit wird nicht bewertet. */}
          {wert !== null &&
            (s(p.einheit) ?? 'µSv/h') === 'µSv/h' &&
            'Für diese Sonde liegt noch kein Grundpegel vor. '}
          Einteilung des Lifeline Hub nach dem vom BfS genannten natürlichen Bereich (0,05–0,2
          µSv/h) — kein amtlicher Schwellenwert. Regen kann Werte kurzzeitig bis zum Dreifachen
          anheben.
        </Typography.Paragraph>
      )}
    </>
  );
}

/**
 * Komponenten der Luftqualitätsebene in Anzeigereihenfolge. Die Schlüssel stammen aus dem
 * Normalisierer (`karte::luftqualitaet::komponenten_etikett`, Property `wert_<schluessel>`);
 * unbekannte Komponenten kommen dort als `wert_k<id>` und werden unten angehängt.
 */
const LUFT_KOMPONENTEN: [string, string][] = [
  ['no2', 'NO₂'],
  ['o3', 'O₃'],
  ['pm10', 'PM10'],
  ['pm25', 'PM2,5'],
  ['so2', 'SO₂'],
  ['co', 'CO'],
];

/**
 * UBA-Luftmessstation. Die Stufe steht als Wort (zweiter Kanal), der Messzeitpunkt immer — die
 * Quelle hinkt rund zwei Stunden hinterher. Die unvollständige Datenbasis ist ein Hinweis, keine
 * Farbe: der Index bleibt die amtliche Einstufung.
 */
function LuftqualitaetInhalt({ p }: { p: Record<string, unknown> }) {
  const unbekannt = Object.keys(p)
    .filter((k) => /^wert_k\d+$/.test(k))
    .sort()
    .map((k): [string, string] => [k.slice(5), `Komponente ${k.slice(6)}`]);
  const werte = [...LUFT_KOMPONENTEN, ...unbekannt]
    .map(([schluessel, name]) => {
      const wert = s(p[`wert_${schluessel}`]);
      const einheit = s(p[`einheit_${schluessel}`]);
      return wert ? { name, text: einheit ? `${wert} ${einheit}` : wert } : null;
    })
    .filter((w): w is { name: string; text: string } => w !== null);
  const art = [s(p.stationstyp), s(p.umgebung)].filter(Boolean).join(' · ');
  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <StatusTag darstellung={luftqualitaetDarstellung(p.klasse)} />
      </div>
      <Descriptions column={1}>
        {s(p.leitschadstoff) && (
          <Descriptions.Item label="Leitschadstoff">{s(p.leitschadstoff)}</Descriptions.Item>
        )}
        {werte.map((w) => (
          <Descriptions.Item key={w.name} label={w.name}>
            {w.text}
          </Descriptions.Item>
        ))}
        {fmtZeit(s(p.zeitpunkt)) && (
          <Descriptions.Item label="Messzeitpunkt">{fmtZeit(s(p.zeitpunkt))}</Descriptions.Item>
        )}
        {s(p.ort) && <Descriptions.Item label="Ort">{s(p.ort)}</Descriptions.Item>}
        {art && <Descriptions.Item label="Station">{art}</Descriptions.Item>}
        {s(p.code) && <Descriptions.Item label="Stationscode">{s(p.code)}</Descriptions.Item>}
      </Descriptions>
      {p.unvollstaendig === true && (
        <Typography.Text type="secondary">
          Unvollständige Datenbasis — der Index ist aus weniger Komponenten gebildet.
        </Typography.Text>
      )}
    </>
  );
}

/**
 * Standbild einer BAB-Webcam. Eigene Komponente, damit der Aufrufer sie per `key={bild}`
 * zurücksetzt: der Fehlerzustand gehört zu genau diesem Bild — auch auf dem Weg A → B → A beginnt
 * jeder Wechsel mit einem frischen Versuch.
 *
 * Das Bild kommt direkt vom Betreiber, nicht über den Backend-Proxy, und lädt ohne Internet am
 * Gerät nicht. Statt eines kaputten Bildsymbols steht dann der Grund.
 */
function WebcamStandbild({ bild, titel }: { bild: string; titel: string | null }) {
  const { token } = theme.useToken();
  const [fehler, setFehler] = useState(false);
  if (fehler) {
    return (
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
        Standbild nicht abrufbar — es kommt direkt vom Kamera-Betreiber und braucht eine
        Internetverbindung am Gerät.
      </Typography.Paragraph>
    );
  }
  return (
    /* Ohne feste Höhe — die Betreiber liefern verschiedene Seitenverhältnisse. */
    <img
      src={bild}
      alt={titel ? `Webcam-Standbild: ${titel}` : 'Webcam-Standbild'}
      onError={() => setFehler(true)}
      style={{
        width: '100%',
        display: 'block',
        marginBottom: token.marginXS,
        borderRadius: token.borderRadius,
      }}
    />
  );
}

const ANLAGENART: Record<EnergieAnlagenart, string> = {
  kohle: 'Kohle',
  gas: 'Gas',
  oel: 'Öl',
  kern: 'Kernenergie',
  abfall: 'Abfall',
  wasser: 'Wasser',
  wind: 'Wind',
  solar: 'Solar',
  biomasse: 'Biomasse',
  speicher: 'Speicher',
  sonstige: 'Sonstige',
};

const HERKUNFT: Record<string, string> = {
  osm: 'OpenStreetMap',
  mastr: 'Marktstammdatenregister',
  'osm+mastr': 'OpenStreetMap + Marktstammdatenregister',
};

const MW = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

/**
 * Energieanlage. Die Properties tragen `null` für Unbekanntes, MapLibre liefert sie beim Klick aber
 * als fehlend — beide Fälle laufen denselben Weg.
 */
function EnergieInhalt({ p }: { p: Record<string, unknown> }) {
  const artRoh = s(p.anlagenart);
  const art = artRoh ? (ANLAGENART[artRoh as EnergieAnlagenart] ?? artRoh) : null;
  // Nur eine echte Zahl ist ein Messwert; sonst ist „unbekannt" die ehrliche Antwort.
  const mw =
    typeof p.leistung_mw === 'number' && Number.isFinite(p.leistung_mw) ? p.leistung_mw : null;
  const herkunftRoh = s(p.herkunft);
  const herkunft = herkunftRoh ? (HERKUNFT[herkunftRoh] ?? herkunftRoh) : null;
  const ausMastr = herkunftRoh === 'mastr' || herkunftRoh === 'osm+mastr';
  const mastrNummer = ausMastr ? s(p.mastr_nummer) : null;
  // Die ID geht in einen URL-Pfad — nur eine positive Ganzzahl wird ein Link.
  const mastrId =
    typeof p.mastr_id === 'number' && Number.isInteger(p.mastr_id) && p.mastr_id > 0
      ? p.mastr_id
      : null;
  const einheiten =
    ausMastr && typeof p.mastr_einheiten === 'number' && p.mastr_einheiten > 1
      ? p.mastr_einheiten
      : null;
  return (
    <Descriptions column={1}>
      {art && <Descriptions.Item label="Anlagenart">{art}</Descriptions.Item>}
      <Descriptions.Item label="Leistung">
        {mw != null ? `${MW.format(mw)} MW` : 'unbekannt'}
      </Descriptions.Item>
      {s(p.betreiber) && <Descriptions.Item label="Betreiber">{s(p.betreiber)}</Descriptions.Item>}
      {s(p.betriebsstatus) && (
        <Descriptions.Item label="Betriebsstatus">{s(p.betriebsstatus)}</Descriptions.Item>
      )}
      {herkunft && <Descriptions.Item label="Herkunft">{herkunft}</Descriptions.Item>}
      {mastrNummer && (
        <Descriptions.Item label="MaStR-Nummer">
          {mastrId != null ? (
            <a
              href={`https://www.marktstammdatenregister.de/MaStR/Einheit/Detail/IndexOeffentlich/${mastrId}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              {mastrNummer}
            </a>
          ) : (
            mastrNummer
          )}
        </Descriptions.Item>
      )}
      {/* Mehrere Einheiten summieren ihre Leistung; die Nummer ist die der größten Einheit. Die
          Zahl sagt, dass Leistung und Nummer nicht dieselbe Einheit beschreiben. */}
      {einheiten != null && (
        <Descriptions.Item label="MaStR-Einheiten">{einheiten}</Descriptions.Item>
      )}
      {/* Die Lizenz verlangt die Nennung samt Verweis auf den Lizenztext; die Attributionszeile
          der Karte kann keinen Link tragen. */}
      {ausMastr && (
        <Descriptions.Item label="Lizenz">
          <a href="https://www.govdata.de/dl-de/by-2-0" target="_blank" rel="noopener noreferrer">
            Datenlizenz Deutschland – Namensnennung – Version 2.0
          </a>
        </Descriptions.Item>
      )}
    </Descriptions>
  );
}

function AutobahnInhalt({ p }: { p: Record<string, unknown> }) {
  const kategorie = s(p.kategorie);
  const bild = nurWeb(s(p.bild));
  const link = nurWeb(s(p.link));
  const beschreibung = s(p.beschreibung);
  const titel = s(p.titel);
  return (
    <>
      {kategorie && (
        <Tag color="magenta" style={{ marginBottom: 8 }}>
          {kategorieLabel(kategorie)}
        </Tag>
      )}
      {/* Der `key` bindet den Fehlerzustand an die URL — jeder Kamerawechsel beginnt frisch. */}
      {bild && <WebcamStandbild key={bild} bild={bild} titel={titel} />}
      <Descriptions column={1}>
        {s(p.strasse) && <Descriptions.Item label="Autobahn">{s(p.strasse)}</Descriptions.Item>}
        {s(p.richtung) && <Descriptions.Item label="Richtung">{s(p.richtung)}</Descriptions.Item>}
        {fmtZeit(s(p.beginn)) && (
          <Descriptions.Item label="Beginn">{fmtZeit(s(p.beginn))}</Descriptions.Item>
        )}
        {s(p.betreiber) && (
          <Descriptions.Item label="Betreiber">{s(p.betreiber)}</Descriptions.Item>
        )}
      </Descriptions>
      {/* Der Normalisierer fügt die Zeilen von `description` mit \n zusammen; `pre-line` hält
          die Gliederung. */}
      {beschreibung && (
        <Typography.Paragraph
          style={{ marginTop: 8, marginBottom: 0, fontSize: 13, whiteSpace: 'pre-line' }}
        >
          {beschreibung}
        </Typography.Paragraph>
      )}
      {/* Eigenständige Aktion und damit Bedienziel: ein antd-`Button type="link"` erbt
          `controlHeight`, ein nackter `<a>` nicht. Die `telefon`/`website`-Anker im KRITIS-Zweig
          bleiben nackt — sie stehen als Wert in einer `Descriptions`-Zeile. */}
      {link && (
        <div style={{ marginTop: 8 }}>
          <Button
            type="link"
            href={link}
            target="_blank"
            rel="noreferrer noopener"
            style={{ paddingInline: 0 }}
          >
            Livebild beim Betreiber öffnen
          </Button>
        </div>
      )}
    </>
  );
}

/** Detailpanel für ein angeklicktes Fachebenen-Objekt (read-only externe Daten). */
export default function FachebenenInspector({
  quelle,
  properties,
  geometrie,
  onSchliessen,
  pegelBezug,
}: FachebenenInspectorProps) {
  const { token } = theme.useToken();
  const p = properties;
  const istWarnung = quelle === 'nina' || quelle === 'dwd';
  // Fläche/Umfang/Länge rein clientseitig aus der (auch Multi-*) Geometrie.
  const kennzahlen = geometrie ? geoKennzahlen(geometrie) : null;

  let titel: string;
  if (istWarnung) {
    const event = pick(p, 'EVENT', 'event');
    if (quelle === 'dwd') {
      titel = `${wetterIcon(pick(p, 'EC_GROUP'), event)} ${event ? titelCase(event) : 'Wetterwarnung'}`;
    } else {
      titel = '⚠️ Amtliche Warnung';
    }
  } else {
    titel = pick(p, 'titel', 'name') ?? FACHEBENEN[quelle].label;
  }

  return (
    <KartenDetailCard
      titel={titel}
      akzentFarbe={
        // Die Luftqualitätsebene färbt je Station nach Stufe; der Akzent folgt dem, sonst hätte
        // eine Farbe zwei Bedeutungen.
        quelle === 'luftqualitaet'
          ? rollenFarbe(luftqualitaetDarstellung(p.klasse).rolle, token)
          : FACHEBENEN[quelle].farbe
      }
      onSchliessen={onSchliessen}
    >
      {istWarnung ? (
        <WarnungInhalt p={p} />
      ) : quelle === 'pegelonline' ? (
        <PegelInhalt p={p} pegelBezug={pegelBezug} />
      ) : quelle === 'hochwasser' ? (
        <HochwasserInhalt p={p} />
      ) : quelle === 'odl' ? (
        <OdlInhalt p={p} />
      ) : quelle === 'autobahn' ? (
        <AutobahnInhalt p={p} />
      ) : quelle === 'luftqualitaet' ? (
        <LuftqualitaetInhalt p={p} />
      ) : quelle === 'energie' ? (
        // Vor dem Rückfall: jede unbekannte Quelle fiele sonst still in den KRITIS-Inhalt.
        <EnergieInhalt p={p} />
      ) : (
        <KritisInhalt p={p} />
      )}
      {/* Abstand am Aufrufer: `GeoKennzahlen` rendert ohne Kennzahlen nichts, ein Wrapper mit
          `marginTop` hinterließe eine Lücke. */}
      {kennzahlen && (
        <div style={{ marginTop: token.marginSM }}>
          <GeoKennzahlen kennzahlen={kennzahlen} />
        </div>
      )}
    </KartenDetailCard>
  );
}
