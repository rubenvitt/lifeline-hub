import { Button, Card, Descriptions, Tag, Typography } from 'antd';
import type { FachebeneQuelle } from '../../api/fachebenen';
import { FACHEBENEN } from './fachebenen';
import { kategorieLabel } from './fachebenenLayer';

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

const ZUSTAND: Record<string, { label: string; color: string }> = {
  hoch: { label: 'Hoch', color: 'red' },
  normal: { label: 'Normal', color: 'green' },
  niedrig: { label: 'Niedrig', color: 'gold' },
};

function WarnungInhalt({ p }: { p: Record<string, unknown> }) {
  const schwere = pick(p, 'SEVERITY', 'schwere', 'severity');
  const sev = schwere ? SCHWERE[schwere] : undefined;
  const ereignis = pick(p, 'EVENT', 'typ', 'event');
  const dring = pick(p, 'URGENCY', 'dringlichkeit', 'urgency');
  const von = fmtZeit(pick(p, 'ONSET', 'EFFECTIVE', 'beginn'));
  const bis = fmtZeit(pick(p, 'EXPIRES'));
  const quelle = pick(p, 'SENDERNAME') ?? 'BBK / MoWaS';
  const beschreibung = pick(p, 'DESCRIPTION', 'description');
  const hinweis = pick(p, 'INSTRUCTION', 'instruction');

  return (
    <>
      {sev ? (
        <Tag color={sev.color} style={{ marginBottom: 8 }}>{sev.label}</Tag>
      ) : schwere ? (
        <Tag style={{ marginBottom: 8 }}>{schwere}</Tag>
      ) : null}
      <Descriptions column={1} size="small">
        {ereignis && <Descriptions.Item label="Ereignis">{ereignis}</Descriptions.Item>}
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
          {zust ? <Tag color={zust.color}>{zust.label}</Tag> : zustand ? <Tag>{zustand}</Tag> : null}
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
  const titel =
    pick(p, 'HEADLINE', 'titel', 'headline', 'EVENT', 'name') ?? FACHEBENEN[quelle].label;

  return (
    <Card
      size="small"
      title={titel}
      extra={<Button size="small" type="text" onClick={onSchliessen} aria-label="Schließen">×</Button>}
      style={{
        position: 'absolute', right: 12, top: 12, width: 300, zIndex: 5,
        maxHeight: 'calc(100vh - 160px)', overflowY: 'auto',
      }}
      styles={{ header: { borderLeft: `4px solid ${FACHEBENEN[quelle].farbe}` } }}
    >
      {istWarnung ? (
        <WarnungInhalt p={p} />
      ) : quelle === 'pegelonline' ? (
        <PegelInhalt p={p} />
      ) : (
        <KritisInhalt p={p} />
      )}
    </Card>
  );
}
