import { Descriptions, Tag, Typography } from 'antd';
import type { FachebeneQuelle } from '../../api/fachebenen';
import { FACHEBENEN } from './fachebenen';
import { kategorieLabel } from './fachebenenLayer';
import KartenDetailCard from './KartenDetailCard';

export interface FachebenenInspectorProps {
  quelle: FachebeneQuelle;
  properties: Record<string, unknown>;
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

/** ISO-Zeit hübsch (de-DE), Fallback auf Rohwert. */
function fmtZeit(v: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? v
    : d.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
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
        <Typography.Paragraph strong style={{ marginBottom: 8 }}>{headline}</Typography.Paragraph>
      )}
      {sev ? (
        <Tag color={sev.color} style={{ marginBottom: 8 }}>{sev.label}</Tag>
      ) : schwere ? (
        <Tag style={{ marginBottom: 8 }}>{schwere}</Tag>
      ) : null}
      <Descriptions column={1} size="small">
        {dring && <Descriptions.Item label="Dringlichkeit">{DRINGLICHKEIT[dring] ?? dring}</Descriptions.Item>}
        {(von || bis) && (
          <Descriptions.Item label="Gültig">
            {von ?? '?'}{bis ? ` – ${bis}` : ''}
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
          <Typography.Text strong style={{ fontSize: 12 }}>Handlungsempfehlung</Typography.Text>
          <Typography.Paragraph style={{ marginTop: 2, marginBottom: 0, fontSize: 13 }}>
            {hinweis}
          </Typography.Paragraph>
        </>
      )}
    </>
  );
}

function PegelInhalt({ p }: { p: Record<string, unknown> }) {
  const wert = s(p.wert);
  const einheit = s(p.einheit);
  const zustand = s(p.zustand);
  const zust = zustand ? ZUSTAND[zustand] : undefined;
  const km = s(p.km);
  return (
    <>
      {wert ? (
        <Typography.Title level={3} style={{ margin: '0 0 8px' }}>
          {wert}{einheit ? ` ${einheit}` : ''}{' '}
          {zust ? <Tag color={zust.color}>{zust.label}</Tag> : null}
        </Typography.Title>
      ) : (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          Kein aktueller Messwert
        </Typography.Paragraph>
      )}
      <Descriptions column={1} size="small">
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
  // Nur http(s) als Link zulassen (OSM-Tag ist untrusted → javascript:-URI wäre XSS).
  const website = websiteRoh && /^https?:\/\//i.test(websiteRoh) ? websiteRoh : null;
  const notaufnahme = s(p.notaufnahme);
  return (
    <>
      {kategorie && <Tag color="purple" style={{ marginBottom: 8 }}>{kategorieLabel(kategorie)}</Tag>}
      <Descriptions column={1} size="small">
        {s(p.adresse) && <Descriptions.Item label="Adresse">{s(p.adresse)}</Descriptions.Item>}
        {s(p.betreiber) && <Descriptions.Item label="Betreiber">{s(p.betreiber)}</Descriptions.Item>}
        {telefon && (
          <Descriptions.Item label="Telefon">
            <a href={`tel:${telefon.replace(/\s/g, '')}`}>{telefon}</a>
          </Descriptions.Item>
        )}
        {websiteRoh && (
          <Descriptions.Item label="Web">
            {website ? (
              <a href={website} target="_blank" rel="noreferrer noopener">{website}</a>
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

/** Detailpanel für ein angeklicktes Fachebenen-Objekt (read-only externe Daten). */
export default function FachebenenInspector({ quelle, properties, onSchliessen }: FachebenenInspectorProps) {
  const p = properties;
  const istWarnung = quelle === 'nina' || quelle === 'dwd';

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
    <KartenDetailCard titel={titel} akzentFarbe={FACHEBENEN[quelle].farbe} onSchliessen={onSchliessen}>
      {istWarnung ? (
        <WarnungInhalt p={p} />
      ) : quelle === 'pegelonline' ? (
        <PegelInhalt p={p} />
      ) : (
        <KritisInhalt p={p} />
      )}
    </KartenDetailCard>
  );
}
