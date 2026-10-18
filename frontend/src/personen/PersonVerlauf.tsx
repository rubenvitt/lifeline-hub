import SichtungsTag from '../components/SichtungsTag';
import { Tag, Typography, theme } from 'antd';
import type { ReactNode } from 'react';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import type { PersonDetail } from '../api/types';
import { nummeriere, regionName } from './koerperschema/koerperschemaKern';
import {
  MASSNAHME_WORT,
  VERLETZUNG_ART_WORT,
  VERLETZUNG_SCHWERE_WORT,
  istNachgetragen,
  kurzVerbleib,
  transportText,
} from './personMeta';

const { useToken } = theme;

/** Namentliche Bestätigung am Gerät (LFH-1046) als Zusatz einer Verlaufszeile. */
function Bestaetigt({ name }: { name?: string | null }) {
  if (!name) return null;
  return <Typography.Text type="secondary"> · bestätigt: {name}</Typography.Text>;
}

/** Ein nachgereichter Eintrag (Spec `personen-verlauf`): angekommen nach seiner Erfassungszeit. */
function Nachgetragen({ erfassung, eingang }: { erfassung: string; eingang?: string | null }) {
  if (!istNachgetragen(erfassung, eingang)) return null;
  return (
    <Typography.Text type="secondary" data-lfh="nachgetragen">
      {' '}
      · nachgetragen <ZeitAnzeige wert={eingang} format="dtg" />
    </Typography.Text>
  );
}

/** Aufgehoben (Maßnahme, Verletzung): die Zeile bleibt, mit Zeitpunkt des Aufhebens. */
function Aufgehoben({ am }: { am?: string | null }) {
  if (!am) return null;
  return (
    <Typography.Text type="secondary" data-lfh="aufgehoben">
      {' '}
      · aufgehoben <ZeitAnzeige wert={am} format="dtgVoll" />
    </Typography.Text>
  );
}

/**
 * Chronologischer Verlauf einer Person (neueste zuerst) — Sichtungen, Verlaufsnotizen, Verbleib,
 * Transport, Maßnahmen und Verletzungen in einer Spur, für Drawer und Detailseite. Aufgehobene
 * Maßnahmen und Verletzungen bleiben stehen und sind als solche gekennzeichnet; ein nachgereichter
 * Eintrag steht zu seiner Erfassungszeit und trägt „nachgetragen“ (Change `y18v58dt-pat-kern`).
 * Die Überschrift bleibt beim Aufrufer. Zeitstempel über `ZeitAnzeige`, nie als roher Wire-String.
 */
export default function PersonVerlauf({ person }: { person: PersonDetail }) {
  const { token } = useToken();

  const eintraege: Array<{ key: string; at: string; node: ReactNode }> = [
    ...(person.sichtungen ?? []).map((s) => ({
      key: `s-${s.id}`,
      at: s.gesichtet_at,
      node: (
        <span>
          <SichtungsTag kategorie={s.kategorie} />
          {s.notiz && <Typography.Text type="secondary"> — {s.notiz}</Typography.Text>}
          <Bestaetigt name={s.bestaetigt_name} />
          <Nachgetragen erfassung={s.gesichtet_at} eingang={s.eingegangen_at} />
        </span>
      ),
    })),
    ...(person.notizen ?? []).map((n) => ({
      key: `n-${n.id}`,
      at: n.erfasst_at,
      node: (
        <span>
          <Tag>Notiz</Tag> {n.text}
          <Nachgetragen erfassung={n.erfasst_at} eingang={n.eingegangen_at} />
        </span>
      ),
    })),
    ...(person.verbleib ?? []).map((v) => ({
      key: `v-${v.id}`,
      at: v.zeitpunkt_at,
      node: (
        <span>
          <Tag>Verbleib</Tag> {kurzVerbleib(v)}
          <Bestaetigt name={v.bestaetigt_name} />
          <Nachgetragen erfassung={v.zeitpunkt_at} eingang={v.eingegangen_at} />
        </span>
      ),
    })),
    ...(person.transporte ?? []).map((t) => ({
      key: `t-${t.id}`,
      at: t.zeitpunkt_at,
      node: (
        <span>
          <Tag>Transport</Tag>{' '}
          {transportText({
            transport_prioritaet: t.prioritaet,
            transport_art: t.art,
            transport_fachrichtung: t.fachrichtung,
          }) ?? 'aufgehoben'}
          <Bestaetigt name={t.bestaetigt_name} />
          <Nachgetragen erfassung={t.zeitpunkt_at} eingang={t.erfasst_at} />
        </span>
      ),
    })),
    ...(person.massnahmen ?? []).map((m) => ({
      key: `m-${m.id}`,
      at: m.zeitpunkt_at,
      node: (
        <span data-aufgehoben={m.aufgehoben_at ? '' : undefined}>
          <Tag>Maßnahme</Tag> {MASSNAHME_WORT[m.art]}
          <Bestaetigt name={m.bestaetigt_name} />
          <Aufgehoben am={m.aufgehoben_at} />
          <Nachgetragen erfassung={m.zeitpunkt_at} eingang={m.erfasst_at} />
        </span>
      ),
    })),
    ...nummeriere(person.verletzungen ?? []).map(({ nummer, verletzung: v }) => ({
      key: `l-${v.id}`,
      at: v.zeitpunkt_at,
      node: (
        <span data-aufgehoben={v.aufgehoben_at ? '' : undefined}>
          <Tag>Verletzung</Tag> {nummer} {regionName(v.ansicht, v.region)} ·{' '}
          {VERLETZUNG_ART_WORT[v.art]}
          {v.schwere && ` · ${VERLETZUNG_SCHWERE_WORT[v.schwere]}`}
          {v.notiz && <Typography.Text type="secondary"> — {v.notiz}</Typography.Text>}
          <Bestaetigt name={v.bestaetigt_name} />
          <Aufgehoben am={v.aufgehoben_at} />
          <Nachgetragen erfassung={v.zeitpunkt_at} eingang={v.erfasst_at} />
        </span>
      ),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  if (eintraege.length === 0) {
    return <Typography.Text type="secondary">noch kein Verlauf</Typography.Text>;
  }

  return (
    <ul style={{ listStyle: 'none', paddingLeft: 0, margin: 0 }}>
      {eintraege.map((e) => (
        <li
          key={e.key}
          style={{
            padding: `${token.paddingXXS}px 0`,
            borderBottom: `1px solid ${token.colorSplit}`,
          }}
        >
          <Typography.Text
            type="secondary"
            style={{ fontSize: token.fontSizeSM, marginRight: token.marginXS }}
          >
            <ZeitAnzeige wert={e.at} format="dtgVoll" />
          </Typography.Text>
          {e.node}
        </li>
      ))}
    </ul>
  );
}
