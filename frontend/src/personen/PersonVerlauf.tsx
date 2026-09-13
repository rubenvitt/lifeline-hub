import SichtungsTag from '../components/SichtungsTag';
import { Tag, Typography, theme } from 'antd';
import type { ReactNode } from 'react';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import type { PersonDetail } from '../api/types';
import { kurzVerbleib } from './personMeta';

const { useToken } = theme;

/**
 * Chronologischer Verlauf einer Person (neueste zuerst) — Sichtungen, Verlaufsnotizen
 * und Verbleib in einer Spur (LFH-328). Einzige Quelle für diese Darstellung; genutzt
 * vom schlanken `PersonDetailDrawer` und von der vollen `PersonenDetailPage`.
 *
 * Die Überschrift bleibt beim Aufrufer — Drawer und Detailseite benennen die Sektion
 * fachlich unterschiedlich („Medizinischer Verlauf" vs. „Chronologischer Verlauf").
 *
 * Zeitstempel laufen über `ZeitAnzeige` (taktische DTG, zeitzonen-bewusst), nie als
 * roher Wire-String; die Trennlinie kommt aus `token.colorSplit` (dark-safe).
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
        </span>
      ),
    })),
    ...(person.notizen ?? []).map((n) => ({
      key: `n-${n.id}`,
      at: n.erfasst_at,
      node: (
        <span>
          <Tag>Notiz</Tag> {n.text}
        </span>
      ),
    })),
    ...(person.verbleib ?? []).map((v) => ({
      key: `v-${v.id}`,
      at: v.zeitpunkt_at,
      node: (
        <span>
          <Tag color="purple">Verbleib</Tag> {kurzVerbleib(v)}
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
