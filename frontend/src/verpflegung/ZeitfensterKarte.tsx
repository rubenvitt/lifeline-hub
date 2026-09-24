import { MoreOutlined } from '@ant-design/icons';
import { Button, Dropdown, Flex, Typography } from 'antd';
import type { MenuProps } from 'antd';
import type { Dayjs } from 'dayjs';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import type { VerpflegungAusgabe, VerpflegungZeitfenster } from '../api/types';
import StatusTag from '../components/StatusTag';
import {
  Augenbraue,
  Kennzahl,
  Kennzahlenband,
  Zeitachseneintrag,
  monoStil,
  useRollen,
  type KennzahlTon,
} from '../components/instrument';
import { rollenFarbe, verpflegungDeckung, type VerpflegungDeckung } from '../theme/statusFarben';
import { deckungEinstufung } from './deckung';
import {
  KOSTFORM_LABEL,
  belegteKostformen,
  nachforderungsAnzahl,
  sonderkostText,
  uhrzeit,
  zeitfensterKennung,
  zeitraumText,
} from './verpflegungText';

const { Text } = Typography;

/** Ton der Fehlmenge — er folgt der Einstufung, nicht bloß „fehlt etwas?" (Spec: offen ohne Alarm). */
const FEHLT_TON: Record<VerpflegungDeckung, KennzahlTon> = {
  gedeckt: 'normal',
  offen: 'neutral',
  unterdeckung: 'alarm',
};

export interface ZeitfensterKarteProps {
  zeitfenster: VerpflegungZeitfenster;
  jetzt: Dayjs;
  darfSchreiben: boolean;
  /**
   * Modul Nachforderungen für die Person bedienbar (und die Overrides bekannt). Ohne: kein
   * „Nachfordern" und am Verweis nur „Nachforderung #n" (D4 — keine Angaben eines Moduls, das
   * die Person nicht sieht).
   */
  nachforderungenFrei: boolean;
  /** Aufgelöster Name einer Nachforderung — nur bei freiem Modul befragt. */
  nachforderungName?: (id: number) => string | undefined;
  onAusgabeErfassen?: (zf: VerpflegungZeitfenster) => void;
  onBearbeiten?: (zf: VerpflegungZeitfenster) => void;
  onNachfordern?: (zf: VerpflegungZeitfenster) => void;
  onLoeschen?: (zf: VerpflegungZeitfenster) => void;
  onZuruecknehmen?: (ausgabe: VerpflegungAusgabe, zf: VerpflegungZeitfenster) => void;
}

type Aktionsschluessel = 'bearbeiten' | 'nachfordern' | 'loeschen';

interface Aktion {
  key: Aktionsschluessel;
  label: string;
  danger?: boolean;
}

/**
 * Ein Verpflegungszeitfenster (LFH-634, design.md D7).
 *
 * EINSTUFUNG mit zwei Kanälen (WCAG 1.4.1): das Wort im `StatusTag` und die Farbe am linken
 * Rand — EINE Farbe, bei Unterdeckung `alarm` (Regel aus LFH-343 · C8). Die Fehlmenge steht
 * IMMER als Zahl da, auch bei „offen"; ihr Ton folgt der Einstufung, der Text läuft bei
 * Unterdeckung über `alarmText` (LFH-618, Regel 1). Nichts blinkt.
 *
 * SONDERKOST: nur belegte Kostformen. Fehlt eine Kostform, nennt die Zeile sie ausdrücklich
 * („fehlt 3 vegan") — sonst stünde „Unterdeckung" an einem Zeitfenster, dessen Gesamtzahl
 * gedeckt aussieht (Risiko in design.md).
 *
 * AKTIONEN (LFH-365): „Ausgabe erfassen" ist die sichtbare Kartenaktion. Sind es nach der
 * Rechteprüfung drei oder mehr, liegen die übrigen im Dreipunkt-Menü, „Löschen" rot hinter dem
 * Trenner. Ohne Schreibrecht fällt die Aktionszeile ganz weg, ebenso „Zurücknehmen" an den
 * Ausgaben (C11). Jeder zugängliche Name trägt die Zeilenkennung (Bezeichnung + Zeitraum).
 */
export default function ZeitfensterKarte({
  zeitfenster: zf,
  jetzt,
  darfSchreiben,
  nachforderungenFrei,
  nachforderungName,
  onAusgabeErfassen,
  onBearbeiten,
  onNachfordern,
  onLoeschen,
  onZuruecknehmen,
}: ZeitfensterKarteProps) {
  const { token, rollen } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const stufe = deckungEinstufung(zf, jetzt);
  const darstellung = verpflegungDeckung[stufe];
  const kante = stufe === 'offen' ? rollen.linie : rollenFarbe(darstellung.rolle, token);
  const kennung = zeitfensterKennung(zf, konventionen);
  const kostformen = belegteKostformen(zf.bedarf.sonderkost, zf.ausgegeben.sonderkost);

  // ── Aktionen, gezählt NACH der Rechteprüfung ──────────────────────────────────────────
  const hatGueltigeAusgabe = zf.ausgaben.some((a) => a.zurueckgenommen_at == null);
  const weitere: Aktion[] = darfSchreiben
    ? ([
        onBearbeiten && { key: 'bearbeiten', label: 'Bedarf bearbeiten' },
        onNachfordern &&
          nachforderungenFrei &&
          nachforderungsAnzahl(zf) > 0 && { key: 'nachfordern', label: 'Nachfordern' },
        onLoeschen && !hatGueltigeAusgabe && { key: 'loeschen', label: 'Löschen', danger: true },
      ].filter(Boolean) as Aktion[])
    : [];
  const erfassen = darfSchreiben && onAusgabeErfassen != null;
  const gebuendelt = (erfassen ? 1 : 0) + weitere.length >= 3;
  const fuehreAus = (key: Aktionsschluessel) => {
    if (key === 'bearbeiten') onBearbeiten?.(zf);
    if (key === 'nachfordern') onNachfordern?.(zf);
    if (key === 'loeschen') onLoeschen?.(zf);
  };
  const menuItems: MenuProps['items'] = weitere.flatMap((a): NonNullable<MenuProps['items']> =>
    a.danger
      ? [{ type: 'divider' }, { key: a.key, label: a.label, danger: true }]
      : [{ key: a.key, label: a.label }],
  );

  return (
    <article
      data-lfh="verpflegung-karte"
      data-einstufung={stufe}
      data-alarm={stufe === 'unterdeckung' ? 'true' : undefined}
      aria-label={`Zeitfenster ${kennung}`}
      style={{
        minWidth: 0,
        marginBottom: token.marginXS,
        background: rollen.paneel,
        border: `1px solid ${rollen.linie}`,
        borderInlineStart: `3px solid ${kante}`,
        color: rollen.text,
      }}
    >
      <Flex
        justify="space-between"
        align="center"
        gap={token.marginXS}
        wrap
        style={{ paddingBlock: token.paddingSM, paddingInline: token.padding }}
      >
        <Flex align="baseline" gap={token.marginSM} wrap style={{ minWidth: 0 }}>
          <Text strong style={{ fontSize: 15, overflowWrap: 'anywhere' }}>
            {zf.bezeichnung}
          </Text>
          <span data-lfh="verpflegung-zeitraum" style={{ ...monoStil(12), color: rollen.text2 }}>
            {zeitraumText(zf, konventionen)}
          </span>
        </Flex>
        <StatusTag darstellung={darstellung} />
      </Flex>

      <Kennzahlenband beschriftung={`Deckung ${kennung}`}>
        <Kennzahl
          titel="Bedarf"
          wert={zf.bedarf.gesamt}
          einheit="EP"
          groesse="klein"
          aufgliederung={{
            titel: 'Bedarf nach Personengruppe',
            segmente: [
              { label: 'Kräfte', wert: zf.bedarf.kraefte, farbe: rollen.text2 },
              { label: 'Betreute', wert: zf.bedarf.betreute, farbe: rollen.gedaempft },
              { label: 'weitere', wert: zf.bedarf.weitere, farbe: rollen.linieStark },
            ],
          }}
        />
        <Kennzahl titel="ausgegeben" wert={zf.ausgegeben.gesamt} einheit="EP" groesse="klein" />
        <Kennzahl
          titel="fehlt"
          wert={zf.fehlmenge.gesamt}
          einheit="EP"
          groesse="klein"
          ton={FEHLT_TON[stufe]}
        />
      </Kennzahlenband>

      {kostformen.length > 0 && (
        <div
          data-lfh="verpflegung-sonderkost"
          style={{ paddingBlock: token.paddingSM, paddingInline: token.padding }}
        >
          <Augenbraue>Sonderkost</Augenbraue>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {kostformen.map((k) => {
              const fehlt = zf.fehlmenge.sonderkost[k];
              return (
                <li
                  key={k}
                  data-kostform={k}
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    columnGap: token.marginSM,
                    alignItems: 'baseline',
                    paddingBlock: 2,
                  }}
                >
                  <span style={{ minWidth: '12ch' }}>{KOSTFORM_LABEL[k]}</span>
                  <span style={{ ...monoStil(12), color: rollen.text2 }}>
                    Bedarf {zf.bedarf.sonderkost[k]} · ausgegeben {zf.ausgegeben.sonderkost[k]}
                  </span>
                  <span
                    data-lfh="sonderkost-fehlt"
                    style={{
                      ...monoStil(12, fehlt > 0 ? 500 : 400),
                      color:
                        fehlt > 0 && stufe === 'unterdeckung' ? rollen.alarmText : rollen.text2,
                    }}
                  >
                    {fehlt > 0 ? `fehlt ${fehlt} ${KOSTFORM_LABEL[k]}` : 'gedeckt'}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {zf.ausgaben.length > 0 && (
        <ul
          aria-label={`Ausgaben zu ${kennung}`}
          data-lfh="verpflegung-ausgaben"
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            borderBlockStart: `1px solid ${rollen.flaeche2}`,
          }}
        >
          {zf.ausgaben.map((a) => {
            const zurueck = a.zurueckgenommen_at != null;
            const uhr = uhrzeit(a.zeitpunkt_at, konventionen);
            const sk = sonderkostText(a.sonderkost);
            const nfId = a.nachforderung_id;
            const nfName =
              nfId != null && nachforderungenFrei ? nachforderungName?.(nfId) : undefined;
            const verweis =
              nfId == null ? null : nfName ? `Nachforderung: ${nfName}` : `Nachforderung #${nfId}`;
            return (
              <Zeitachseneintrag
                key={a.id}
                als="li"
                data-lfh="verpflegung-ausgabe"
                data-zurueckgenommen={zurueck ? 'true' : undefined}
                zeit={uhr}
                typwort={zurueck ? 'zurückgenommen' : 'Ausgabe'}
                hinweis={a.bemerkung ?? undefined}
                aktionen={
                  darfSchreiben && !zurueck && onZuruecknehmen ? (
                    <Button
                      aria-label={`Zurücknehmen: Ausgabe ${a.menge} EP um ${uhr} zu ${kennung}`}
                      onClick={() => onZuruecknehmen(a, zf)}
                    >
                      Zurücknehmen
                    </Button>
                  ) : undefined
                }
              >
                <span style={{ textDecoration: zurueck ? 'line-through' : undefined }}>
                  <span style={monoStil(13, 500)}>{a.menge} EP</span>
                  {a.ort ? ` · ${a.ort}` : ''}
                  {sk ? ` · ${sk}` : ''}
                  {verweis != null && (
                    <>
                      {' · '}
                      <span data-lfh="ausgabe-nachforderung">{verweis}</span>
                    </>
                  )}
                </span>
              </Zeitachseneintrag>
            );
          })}
        </ul>
      )}

      {(erfassen || weitere.length > 0) && (
        // `marginSM` = 7 / 11 / 16 px: im Handschuh-Betrieb der Abstand ≥ 16 px zwischen zwei
        // Zielen (Prüfliste Kriterium 2), wie an der Ablösungskarte.
        <Flex
          justify="flex-end"
          wrap
          gap={token.marginSM}
          data-lfh="verpflegung-aktionen"
          style={{ paddingBlock: token.paddingSM, paddingInline: token.padding }}
        >
          {erfassen && (
            // Kein `type="primary"`: die EINE Primäraktion der Seite steht im Kopf.
            <Button
              aria-label={`Ausgabe erfassen zu ${kennung}`}
              onClick={() => onAusgabeErfassen?.(zf)}
            >
              Ausgabe erfassen
            </Button>
          )}
          {gebuendelt ? (
            <Dropdown
              trigger={['click']}
              autoFocus
              menu={{ items: menuItems, onClick: ({ key }) => fuehreAus(key as Aktionsschluessel) }}
            >
              <Button
                type="text"
                aria-label={`Aktionen zu Zeitfenster ${kennung}`}
                icon={<MoreOutlined />}
              />
            </Dropdown>
          ) : (
            weitere.map((a) => (
              <Button
                key={a.key}
                danger={a.danger}
                aria-label={`${a.label} zu ${kennung}`}
                onClick={() => fuehreAus(a.key)}
              >
                {a.label}
              </Button>
            ))
          )}
        </Flex>
      )}
    </article>
  );
}
