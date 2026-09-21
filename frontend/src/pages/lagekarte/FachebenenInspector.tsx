import { useState } from 'react';
import { Button, Descriptions, Tag, Typography, theme } from 'antd';
import { taktischeDtgVoll } from '../../anzeige/format';
import type { FachebeneQuelle } from '../../api/fachebenen';
import GeoKennzahlen from '../../components/GeoKennzahlen';
import StatusTag from '../../components/StatusTag';
import { rollenFarbe } from '../../theme/statusFarben';
import { FACHEBENEN } from './fachebenen';
import { kategorieLabel } from './fachebenenLayer';
import { geoKennzahlen } from './geo';
import { hochwasserDarstellung } from './hochwasserStil';
import { luftqualitaetDarstellung } from './luftqualitaetStil';
import { odlDarstellung } from './odlStil';
import KartenDetailCard from './KartenDetailCard';

export interface FachebenenInspectorProps {
  quelle: FachebeneQuelle;
  properties: Record<string, unknown>;
  /** Volle (un-geclippte) Geometrie des angeklickten Features → Fläche/Umfang/Länge (LFH-146). */
  geometrie?: { type: string; coordinates: unknown } | null;
  onSchliessen: () => void;
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

// PEGELONLINE stateMnwMhw ist englisch; nur die aussagekräftigen Werte als Tag zeigen
// (unknown/commented/out-dated → kein Tag).
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

function PegelInhalt({ p }: { p: Record<string, unknown> }) {
  const { token } = theme.useToken();
  const wert = s(p.wert);
  const einheit = s(p.einheit);
  const zustand = s(p.zustand);
  const zust = zustand ? ZUSTAND[zustand] : undefined;
  const km = s(p.km);
  return (
    <>
      {wert ? (
        // WEDER `EinsatzSeite` NOCH `SektionHeader` (LFH-328/A2, Norm §7.1): das hier war
        // nie eine Überschrift, sondern ein MESSWERT („320 cm" + Zustand). Der Inspektor ist
        // ein Panel in der Lagekarten-Leiste, hat also gar kein Seitenlayout, und ein
        // `<h3>Pegelstand 320 cm</h3>` wäre für einen Screenreader eine Gliederungsebene, die
        // es nicht gibt. Die Rolle fällt deshalb weg, das visuelle Gewicht bleibt: `Text` in
        // Kennzahlen-Stimme mit `fontSizeHeading3` aus dem Theme statt einer eigenen Zahl.
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
 * LHP-Pegel (LFH-77). Trägt genau das, was `get_lagepegel.php` liefert: Name, Nummer und
 * Meldeklasse. Der Wasserstand in Zentimetern steht bewusst NICHT hier — er käme aus
 * `get_infospegel.php`, einem Einzelabruf je Pegel gegen einen Token-gesicherten Endpunkt
 * (siehe `docs/fachebenen-quellen.md`). Wer die Zahl braucht, schaltet die
 * PEGELONLINE-Ebene daneben ein; genau diese Arbeitsteilung ist der Zweck der Ebene.
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
 * ODL-Sonde des BfS (LFH-78): Stufe als Wort, Messwert, Messende, Betriebsstatus — und der
 * Satz, dass die Stufe eine Einteilung des Lifeline Hub ist. Der Satz ist KEIN Kleingedrucktes
 * zum Weglassen: das BfS veröffentlicht keinen absoluten Schwellenwert, und ohne den Hinweis
 * läse sich „über natürlichem Bereich" wie eine amtliche Bewertung (Spec, Anforderung
 * „Die Einteilung gibt sich als Projekt-Einteilung zu erkennen").
 *
 * Eine Sonde ohne Messwert zeigt „kein Messwert" statt einer Zahl, und das Messende fehlt
 * dann ganz — die Quelle liefert für defekte Sonden keins. Das Messende steht auch bei
 * aktuellen Werten: gemessen hängt ein Teil der Sonden Stunden hinter dem Stundenwert, und
 * eine eigene Stufe „veraltet" gibt es bewusst nicht (design.md, Entscheidung 6).
 */
function OdlInhalt({ p }: { p: Record<string, unknown> }) {
  const { token } = theme.useToken();
  const wert = typeof p.wert === 'number' && Number.isFinite(p.wert) ? p.wert : null;
  const messende = fmtZeit(s(p.messende));
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
        {s(p.betrieb) && <Descriptions.Item label="Sonde">{s(p.betrieb)}</Descriptions.Item>}
        {/* Ortsnamen sind nicht eindeutig; die Kennung ist der Schlüssel für ODL-Info. */}
        {s(p.kennung) && <Descriptions.Item label="Kennung">{s(p.kennung)}</Descriptions.Item>}
      </Descriptions>
      <Typography.Paragraph
        type="secondary"
        style={{ fontSize: token.fontSizeSM, marginTop: token.marginXS, marginBottom: 0 }}
      >
        Einteilung des Lifeline Hub nach dem vom BfS genannten natürlichen Bereich (0,05–0,2 µSv/h)
        — kein amtlicher Schwellenwert. Regen kann Werte kurzzeitig bis zum Dreifachen anheben.
      </Typography.Paragraph>
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
 * UBA-Luftmessstation (LFH-79). Die Stufe steht als WORT (zweiter Kanal zur Farbe auf der
 * Karte), der Messzeitpunkt immer — die Quelle hinkt rund zwei Stunden hinterher, und ein
 * Wert ohne Zeit läse sich als „jetzt". Die unvollständige Datenbasis ist ein Hinweis, keine
 * Farbe: der Index ist die amtliche Einstufung, nur aus weniger Komponenten gebildet.
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
 * Standbild einer BAB-Webcam. Eigene Komponente, damit der Aufrufer sie über `key={bild}`
 * strukturell zurücksetzen kann: der Fehlerzustand gehört zu GENAU DIESEM Bild, nicht zum
 * Panel. Ein Merker im Panel überlebte den Wechsel auf eine andere Kamera — und ein Merker,
 * der nur die zuletzt gescheiterte URL vergleicht, überlebte den Weg A → B → **A**: bei der
 * Rückkehr stünde weiter „nicht abrufbar", ohne es noch einmal zu versuchen, obwohl die
 * Verbindung inzwischen wieder da sein kann. Mit dem `key` stellt sich die Frage nicht.
 *
 * Das Bild kommt NICHT über den Backend-Proxy, sondern direkt vom Betreiber (die Quelle
 * liefert nur die URL). Ohne Internet am Gerät — der Normalfall, für den die Lagekarte
 * offline-fähig ist — lädt es also nicht. Ein kaputtes Bildsymbol wäre in einer
 * Führungsoberfläche die schlechteste Antwort: es sagt nicht, WAS fehlt.
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
    /* Bewusst ohne feste Höhe — die Betreiber liefern verschiedene Seitenverhältnisse, ein
       erzwungenes Maß schnitte den Fahrbahnrand ab. */
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
      {/* Das Standbild IST der Zweck der Webcam-Kategorie (LFH-80): visuelle Lagebestätigung
          an der BAB. Der `key` bindet den Fehlerzustand an die URL — ein Wechsel der Kamera
          (auch hin und zurück) beginnt mit einem frischen Versuch. */}
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
      {/* Die Quelle liefert `description` als Zeilen-Array; der Normalisierer fügt sie mit
          \n zusammen. `pre-line` hält diese Gliederung — ohne sie steht „Länge: 1.36 km
          Max. 80 km/h Maximale Durchfahrtsbreite: 3.25 m" in einem Zug. */}
      {beschreibung && (
        <Typography.Paragraph
          style={{ marginTop: 8, marginBottom: 0, fontSize: 13, whiteSpace: 'pre-line' }}
        >
          {beschreibung}
        </Typography.Paragraph>
      )}
      {/* Eigenständige AKTION, nicht ein Anker im Fließtext — und damit ein Bedienziel, das
          die Dichtestaffel halten muss (30/48/72). Bewusst ein antd-`Button type="link"`
          statt eines nackten `<a>` mit handgesetzter `minHeight`: so erbt es `controlHeight`
          vom `ConfigProvider` und schuldet nicht die zwei Angaben aus LFH-365. Dieselbe
          Begründung wie beim Platzhalter in `BemerkungZelle` (LFH-369). Die
          `telefon`/`website`-Anker im KRITIS-Zweig bleiben nackt: die stehen als WERT in einer
          `Descriptions`-Zeile, nicht als Aktion auf eigener Zeile. */}
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
}: FachebenenInspectorProps) {
  const { token } = theme.useToken();
  const p = properties;
  const istWarnung = quelle === 'nina' || quelle === 'dwd';
  // Fläche/Umfang/Länge rein clientseitig aus der (auch Multi-*) Geometrie (LFH-146).
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
        // Die Luftqualitätsebene färbt je Station nach ihrer Stufe; der Akzent folgt dem, sonst
        // stünde neben einem Alarm-Tag die Ebenenfarbe — eine Farbe mit zwei Bedeutungen.
        quelle === 'luftqualitaet'
          ? rollenFarbe(luftqualitaetDarstellung(p.klasse).rolle, token)
          : FACHEBENEN[quelle].farbe
      }
      onSchliessen={onSchliessen}
    >
      {istWarnung ? (
        <WarnungInhalt p={p} />
      ) : quelle === 'pegelonline' ? (
        <PegelInhalt p={p} />
      ) : quelle === 'hochwasser' ? (
        <HochwasserInhalt p={p} />
      ) : quelle === 'odl' ? (
        <OdlInhalt p={p} />
      ) : quelle === 'autobahn' ? (
        <AutobahnInhalt p={p} />
      ) : quelle === 'luftqualitaet' ? (
        <LuftqualitaetInhalt p={p} />
      ) : (
        <KritisInhalt p={p} />
      )}
      {/* Abstand am Aufrufer, nicht im Primitiv: `GeoKennzahlen` rendert ohne Kennzahlen
          nichts, ein Wrapper mit `marginTop` hinterließe sonst eine leere Lücke. */}
      {kennzahlen && (
        <div style={{ marginTop: token.marginSM }}>
          <GeoKennzahlen kennzahlen={kennzahlen} />
        </div>
      )}
    </KartenDetailCard>
  );
}
