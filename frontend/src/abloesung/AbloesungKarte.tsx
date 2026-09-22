import { MoreOutlined } from '@ant-design/icons';
import { Button, Dropdown, Flex, Space, Typography } from 'antd';
import type { MenuProps } from 'antd';
import type { Dayjs } from 'dayjs';
import type { Abloesung } from '../api/types';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import StatusTag from '../components/StatusTag';
import { monoStil, useRollen } from '../components/instrument';
import { dauerText } from '../stab/lagebesprechungZustand';
import { abloesungEinstufung, rollenFarbe } from '../theme/statusFarben';
import { abloesungZeit, einstufungVon, rhythmusText } from './einstufung';

const { Text } = Typography;

export interface AbloesungKarteProps {
  schicht: Abloesung;
  jetzt: Dayjs;
  darfSchreiben: boolean;
  onVollziehen?: (schicht: Abloesung) => void;
  onAbloeserPlanen?: (schicht: Abloesung) => void;
  onRhythmusAendern?: (schicht: Abloesung) => void;
  onZuruecknehmen?: (schicht: Abloesung) => void;
}

/** „in 23 min" · „seit 12 min überfällig" — das Wort neben der Uhrzeit. */
export function abstandText(faelligAt: string, jetzt: Dayjs): string {
  const f = abloesungZeit(faelligAt);
  if (!f) return '';
  const minuten = Math.floor((f.valueOf() - jetzt.valueOf()) / 60_000);
  if (minuten < 0) return `seit ${dauerText(-minuten)}`;
  if (minuten === 0) return 'in < 1 min';
  return `in ${dauerText(minuten)}`;
}

/**
 * Eine Schicht (LFH-635). Der linke Rand trägt die Einstufung — EINE Farbe, Gefahr gewinnt
 * (Regel aus LFH-343 · C8): überfällig rot, Vorwarnung gelb, sonst die Linienfarbe. Der zweite
 * Kanal ist das Wort im Etikett (WCAG 1.4.1), die Uhrzeit steht immer daneben. Nichts blinkt.
 *
 * Aktionen: „Ablösung vollziehen" ist die eine sichtbare Kartenaktion. „Ablösende Einheit
 * planen" und „Rhythmus ändern" liegen im Dreipunkt-Menü — mit der Kartenaktion sind es drei,
 * und ab drei wird gebündelt (LFH-365). Ohne Schreibrecht fällt die Aktionszeile ganz weg
 * (C11: n Karten × gesperrte Knöpfe kosten Platz für null Handlungsmöglichkeit; der Grund
 * steht einmal im Seitenkopf).
 */
export default function AbloesungKarte({
  schicht: s,
  jetzt,
  darfSchreiben,
  onVollziehen,
  onAbloeserPlanen,
  onRhythmusAendern,
  onZuruecknehmen,
}: AbloesungKarteProps) {
  const { token, rollen } = useRollen();
  const laufend = s.status === 'laufend';
  const stufe = laufend ? einstufungVon(s.faellig_at, jetzt) : null;
  const darstellung = stufe ? abloesungEinstufung[stufe] : null;
  const kante =
    darstellung && darstellung.rolle !== 'neutral'
      ? rollenFarbe(darstellung.rolle, token)
      : rollen.linie;

  const menuItems: MenuProps['items'] = [
    onAbloeserPlanen && { key: 'abloeser', label: 'Ablösende Einheit planen' },
    onRhythmusAendern && { key: 'rhythmus', label: 'Rhythmus ändern' },
  ].filter(Boolean) as MenuProps['items'];

  return (
    <article
      data-lfh="abloesung-karte"
      data-einstufung={stufe ?? undefined}
      data-alarm={stufe === 'ueberfaellig' ? 'true' : undefined}
      aria-label={`Schicht ${s.einheit_name}`}
      style={{
        display: 'flex',
        alignItems: 'stretch',
        minWidth: 0,
        marginBottom: token.marginXS,
        background: stufe === 'ueberfaellig' ? rollen.alarmFlaeche : rollen.paneel,
        border: `1px solid ${rollen.linie}`,
        borderInlineStart: `3px solid ${kante}`,
        color: rollen.text,
      }}
    >
      {/* Zeitspalte: die Fälligkeit bzw. der Vollzug führt, in Mono. */}
      <div
        style={{
          flex: '0 0 auto',
          minWidth: 64,
          paddingBlock: token.paddingSM,
          paddingInline: token.padding,
          borderInlineEnd: `1px solid ${rollen.flaeche3}`,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <span style={{ ...monoStil(13, 500) }} data-lfh="abloesung-zeit">
          <ZeitAnzeige wert={laufend ? s.faellig_at : s.vollzogen_at} format="kurz" />
        </span>
        <span style={{ ...monoStil(10), color: rollen.schwach }}>
          {laufend ? 'fällig' : 'abgelöst'}
        </span>
      </div>
      <div style={{ flex: 1, minWidth: 0, padding: token.paddingSM }}>
        <Flex justify="space-between" align="center" gap={token.marginXS} wrap>
          <Text strong style={{ fontSize: 15 }}>
            {s.einheit_name}
          </Text>
          {darstellung && <StatusTag darstellung={darstellung} />}
        </Flex>
        <Space orientation="vertical" size={2} style={{ width: '100%', marginTop: 4 }}>
          {laufend && <Text data-lfh="abloesung-abstand">{abstandText(s.faellig_at, jetzt)}</Text>}
          <Text type="secondary">
            {s.abschnitt_name ? `${s.abschnitt_name} · ` : ''}
            im Einsatz seit <ZeitAnzeige wert={s.beginn_at} format="kurz" /> · Rhythmus{' '}
            {rhythmusText(s.rhythmus_minuten)} (
            {s.rhythmus_quelle === 'abschnitt' ? 'Vorgabe des Abschnitts' : 'eigener Wert'})
          </Text>
          {s.abloesende_einheit_name && (
            <Text type="secondary">
              {laufend ? 'Ablösung geplant durch ' : 'Abgelöst durch '}
              {s.abloesende_einheit_name}
            </Text>
          )}
        </Space>
        {darfSchreiben && laufend && (
          <Flex justify="flex-end" gap={token.marginXS} style={{ marginTop: token.marginXS }}>
            {onVollziehen && (
              // Kein `type="primary"`: die EINE Primäraktion der Seite steht im Kopf
              // („Schicht beginnen", LFH-340 · C5); n blaue Kartenknöpfe gleichen Gewichts
              // nähmen der Einstufung am Rand die Aufmerksamkeit.
              <Button onClick={() => onVollziehen(s)}>Ablösung vollziehen</Button>
            )}
            {menuItems && menuItems.length > 0 && (
              <Dropdown
                trigger={['click']}
                autoFocus
                menu={{
                  items: menuItems,
                  onClick: ({ key }) => {
                    if (key === 'abloeser') onAbloeserPlanen?.(s);
                    if (key === 'rhythmus') onRhythmusAendern?.(s);
                  },
                }}
              >
                <Button
                  type="text"
                  aria-label={`Aktionen zu ${s.einheit_name}`}
                  icon={<MoreOutlined />}
                />
              </Dropdown>
            )}
          </Flex>
        )}
        {darfSchreiben && !laufend && s.ruecknehmbar && onZuruecknehmen && (
          <Flex justify="flex-end" style={{ marginTop: token.marginXS }}>
            <Button onClick={() => onZuruecknehmen(s)}>Vollzug zurücknehmen</Button>
          </Flex>
        )}
      </div>
    </article>
  );
}
