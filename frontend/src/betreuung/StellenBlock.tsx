import { Button, Dropdown, Space, Typography, theme } from 'antd';
import { MoreOutlined } from '@ant-design/icons';
import { useMemo } from 'react';
import type { Betreuungsstelle, BetreuungsstelleArt, BetreuungsstelleStatus } from '../api/types';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import Datensicht, {
  HERVORGEHOBEN,
  menueEintraege,
  spaltenFuer,
  type Kartenplan,
  type MenueEintrag,
} from '../components/Datensicht';
import StatusTag from '../components/StatusTag';
import Bereichskopf from '../kommunikation/Bereichskopf';
import { auslastung, betreuungsstelleStatus } from '../theme/statusFarben';
import { ART_LABEL, freiePlaetze, personenZahl } from './betreuungText';

/**
 * Block „Betreuungsstellen" der Betreuungsseite (LFH-639, design.md D7).
 *
 * FORM: Tabelle (`form="tabelle"`) in JEDER Breite — hier wird VERGLICHEN („welche Stelle hat
 * noch Platz?"). Fixierte Kennung ist die Bezeichnung, nie die DB-`id`. Den Spaltenschalter mit
 * Zähler bringt das Primitiv.
 *
 * „frei" steht nur bei gesetzter Kapazität (Spec: ohne Kapazität keine Zahl freier Plätze).
 * Die Auslastung („fast voll", „voll", „überbelegt") erscheint als `StatusTag` neben der
 * Belegung — Farbe nur am Rand, das Wort ist der zweite Kanal (D8, WCAG 1.4.1). Unter 90 % gibt
 * es kein Wort und deshalb auch keine Farbe.
 *
 * Zeilenaktionen: „Belegung melden" direkt, „Bearbeiten" und „Stornieren" gebündelt im Menü
 * (LFH-365). Die Menge bleibt auch an einer geschlossenen Stelle ein Menü, obwohl dort „Belegung
 * melden" entfällt (der Server nimmt keine Meldung an, 422): die Regel „unter drei kein Menü"
 * zählt NACH der Rechteprüfung, nicht nach dem Zustand der Zeile — sonst wechselte die Form der
 * Aktionsspalte mit jedem Statuswechsel. Ohne Schreibrecht entfällt die Spalte ganz.
 */

export type StelleAktion = 'bearbeiten' | 'stornieren';

const MENUE: readonly (MenueEintrag & { key: StelleAktion })[] = [
  { key: 'bearbeiten', label: 'Bearbeiten (Status, Kapazität)' },
  { key: 'stornieren', label: 'Stornieren', gefahr: true },
];

const ARTEN = Object.keys(ART_LABEL) as BetreuungsstelleArt[];
const STATUS = Object.keys(betreuungsstelleStatus) as BetreuungsstelleStatus[];

const leer = <Typography.Text type="secondary">—</Typography.Text>;

const stellenSpalten = (
  darfSchreiben: boolean,
  onBelegungMelden: (s: Betreuungsstelle) => void,
  onAktion: (aktion: StelleAktion, s: Betreuungsstelle) => void,
) =>
  spaltenFuer<Betreuungsstelle>()([
    {
      key: 'bezeichnung',
      title: 'Bezeichnung',
      immerSichtbar: true,
      sortWert: (s) => s.bezeichnung,
      suchText: (s) => s.bezeichnung,
      render: (_, s) => <Typography.Text strong>{s.bezeichnung}</Typography.Text>,
    },
    {
      key: 'art',
      title: 'Art',
      sortWert: (s) => ARTEN.indexOf(s.art),
      filter: {
        werte: ARTEN.map((a) => ({ text: ART_LABEL[a], value: a })),
        trifft: (s, w) => s.art === w,
      },
      render: (_, s) => ART_LABEL[s.art],
    },
    {
      key: 'status',
      title: 'Status',
      sortWert: (s) => STATUS.indexOf(s.status),
      filter: {
        werte: STATUS.map((st) => ({ text: betreuungsstelleStatus[st].label, value: st })),
        trifft: (s, w) => s.status === w,
      },
      render: (_, s) => <StatusTag darstellung={betreuungsstelleStatus[s.status]} />,
    },
    {
      key: 'kapazitaet',
      title: 'Kapazität',
      zahl: true,
      sortWert: (s) => s.kapazitaet_personen,
      render: (_, s) =>
        s.kapazitaet_personen != null ? personenZahl(s.kapazitaet_personen) : leer,
    },
    {
      key: 'belegt',
      title: 'belegt',
      zahl: true,
      sortWert: (s) => s.belegung?.belegt,
      render: (_, s) => {
        if (!s.belegung) return <Typography.Text type="secondary">keine Meldung</Typography.Text>;
        const stufe = auslastung(s.belegung.belegt, s.kapazitaet_personen);
        return (
          <Space wrap>
            <span>{personenZahl(s.belegung.belegt)}</span>
            {stufe && <StatusTag darstellung={stufe} />}
          </Space>
        );
      },
    },
    {
      key: 'frei',
      title: 'frei',
      zahl: true,
      sortWert: (s) => freiePlaetze(s),
      // Überbelegung zeigt 0 frei; wie weit darüber, sagt „überbelegt" neben der Belegung.
      render: (_, s) => {
        const frei = freiePlaetze(s);
        return frei == null ? leer : personenZahl(Math.max(0, frei));
      },
    },
    {
      key: 'stand',
      title: 'Stand',
      zahl: true,
      abBreite: 'lg',
      sortWert: (s) => s.belegung?.zeitpunkt_at,
      // `ZeitAnzeige` liest den Wire-String als UTC (`dayjs.utc`) — nie `dayjs(s)` (D2).
      render: (_, s) =>
        s.belegung ? <ZeitAnzeige wert={s.belegung.zeitpunkt_at} format="kurz" /> : leer,
    },
    {
      key: 'abschnitt',
      title: 'Abschnitt',
      abBreite: 'xl',
      suchText: (s) => s.abschnitt_name,
      render: (_, s) => s.abschnitt_name ?? leer,
    },
    ...(darfSchreiben
      ? [
          {
            key: 'aktionen' as const,
            title: 'Aktionen',
            immerSichtbar: true,
            render: (_: unknown, s: Betreuungsstelle) => (
              <Space wrap>
                {s.status !== 'geschlossen' && (
                  <Button
                    aria-label={`Belegung melden für ${s.bezeichnung}`}
                    onClick={() => onBelegungMelden(s)}
                  >
                    Belegung melden
                  </Button>
                )}
                <Dropdown
                  trigger={['click']}
                  autoFocus
                  menu={{
                    items: menueEintraege(MENUE),
                    onClick: ({ key }) => onAktion(key as StelleAktion, s),
                  }}
                >
                  <Button
                    type="text"
                    aria-label={`Aktionen zu Stelle ${s.bezeichnung}`}
                    icon={
                      <span aria-hidden="true" style={{ display: 'inline-flex' }}>
                        <MoreOutlined />
                      </span>
                    }
                  />
                </Dropdown>
              </Space>
            ),
          },
        ]
      : []),
  ]);

type StelleSpalte = ReturnType<typeof stellenSpalten>[number]['key'];

/**
 * Der Kartenplan ist Pflicht am Primitiv, greift bei `form="tabelle"` aber nie. Er bleibt
 * trotzdem ehrlich belegt — falls die Form je auf `auto` wechselt, steht dort keine leere Karte.
 */
const KARTE: Kartenplan<Betreuungsstelle, StelleSpalte> = {
  art: 'plan',
  titel: { spalte: 'bezeichnung' },
  status: (s) => betreuungsstelleStatus[s.status],
  sekundaer: ['belegt', 'frei', 'art'],
};

export default function StellenBlock({
  stellen,
  ladend,
  darfSchreiben,
  hervorgehoben,
  dataUpdatedAt,
  onAnlegen,
  onBelegungMelden,
  onAktion,
}: {
  stellen: readonly Betreuungsstelle[];
  ladend: boolean;
  darfSchreiben: boolean;
  /** Per Deeplink angesteuerte Stelle (`?stelle=`). */
  hervorgehoben: number | null;
  dataUpdatedAt?: number;
  onAnlegen: () => void;
  onBelegungMelden: (s: Betreuungsstelle) => void;
  onAktion: (aktion: StelleAktion, s: Betreuungsstelle) => void;
}) {
  const { token } = theme.useToken();
  const spalten = useMemo(
    () => stellenSpalten(darfSchreiben, onBelegungMelden, onAktion),
    [darfSchreiben, onBelegungMelden, onAktion],
  );
  const gemeldet = stellen.filter((s) => s.belegung != null);
  const summe = gemeldet.reduce((n, s) => n + s.belegung!.belegt, 0);
  const ohne = stellen.length - gemeldet.length;

  return (
    <div style={{ marginBottom: token.marginLG }}>
      <Bereichskopf
        titel="Betreuungsstellen"
        ueberschrift="h2"
        meta={
          ladend || stellen.length === 0
            ? undefined
            : `${personenZahl(summe)} untergebracht${ohne > 0 ? ` · ${personenZahl(ohne)} ohne Meldung` : ''}`
        }
        dataUpdatedAt={dataUpdatedAt}
        // Sekundär und im Block, nicht im Kopf: die EINE Primäraktion der Seite ist
        // „Evakuierungsbezirk anlegen" (LFH-340). Gesperrt statt versteckt (C10/M16) — der
        // Grund steht im Hinweis über der Seite.
        aktion={
          <Button disabled={!darfSchreiben} onClick={onAnlegen}>
            Betreuungsstelle anlegen
          </Button>
        }
      />
      <Datensicht
        bezeichnung="Betreuungsstellen"
        form="tabelle"
        spalten={spalten}
        daten={stellen}
        zeilenSchluessel={(s) => `stelle-${s.id}`}
        ladend={ladend}
        leerText="Keine Betreuungsstellen"
        karte={KARTE}
        zeilenKlasse={(s) => (s.id === hervorgehoben ? HERVORGEHOBEN : undefined)}
      />
    </div>
  );
}
