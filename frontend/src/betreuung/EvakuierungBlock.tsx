import { Typography, theme } from 'antd';
import { useMemo } from 'react';
import type { Evakuierungsbezirk } from '../api/types';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import Datensicht, {
  HERVORGEHOBEN,
  spaltenFuer,
  type Kartenplan,
  type MenueEintrag,
} from '../components/Datensicht';
import Bereichskopf from '../kommunikation/Bereichskopf';
import { raeumungszustand } from '../theme/statusFarben';
import { evakuiertText, kennzahlText } from './betreuungText';
import { evakuierungKennzahl } from './evakuierungKennzahl';
import MeldeVerlauf from './MeldeVerlauf';

/**
 * Block „Evakuierung" der Betreuungsseite (LFH-639, design.md D7).
 *
 * FORM: Karten (`form="karte"`, Plan-Modus) in JEDER Breite — ein Bezirk wird GELESEN („was
 * ist mit diesem Bezirk?"), nicht verglichen. Titel = Bezeichnung, Status = Räumungszustand,
 * drei Sekundärfelder: „N · von M geplant", Stand-Zeit, Abschnitt. Genau EINE Primäraktion
 * („Stand melden"), alles Weitere gebündelt im Menü (`weitere`, LFH-365).
 *
 * VERLAUF (LFH-676): ein beschrifteter Aufklappbereich „Verlauf“ an jeder Karte, auch ohne
 * Schreibrecht — Lesen ist keine Handlung und zählt nicht gegen die eine Primäraktion. Die
 * Standreihe lädt erst beim Aufklappen.
 *
 * Der Zeilenschlüssel trägt ein Präfix (`bezirk-5`): `scrolleZurZeile` sucht über
 * `[data-row-key]` UND die Kartenmarke, und die Stellen-Tabelle derselben Seite hat eigene
 * Zeilen mit eigenen Nummern.
 */

export type BezirkAktion = 'karte' | 'plangroesse' | 'raeumung' | 'stornieren';

const spalten = spaltenFuer<Evakuierungsbezirk>()([
  {
    key: 'bezeichnung',
    title: 'Bezirk',
    immerSichtbar: true,
    sortWert: (b) => b.bezeichnung,
    suchText: (b) => b.bezeichnung,
    render: (_, b) => b.bezeichnung,
  },
  {
    key: 'evakuiert',
    title: 'Evakuiert',
    zahl: true,
    sortWert: (b) => b.stand?.evakuiert,
    render: (_, b) => evakuiertText(b),
  },
  {
    key: 'stand',
    title: 'Stand',
    zahl: true,
    sortWert: (b) => b.stand?.zeitpunkt_at,
    // `ZeitAnzeige` liest den Wire-String als UTC (`dayjs.utc`) — nie `dayjs(s)` (D2).
    render: (_, b) =>
      b.stand ? (
        <ZeitAnzeige wert={b.stand.zeitpunkt_at} format="kurz" />
      ) : (
        <Typography.Text type="secondary">—</Typography.Text>
      ),
  },
  {
    key: 'abschnitt',
    title: 'Abschnitt',
    suchText: (b) => b.abschnitt_name,
    render: (_, b) => b.abschnitt_name ?? <Typography.Text type="secondary">—</Typography.Text>,
  },
]);

type BezirkSpalte = (typeof spalten)[number]['key'];

const MENUE: readonly (MenueEintrag & { key: BezirkAktion })[] = [
  { key: 'plangroesse', label: 'Plangröße fortschreiben' },
  { key: 'raeumung', label: 'Räumung setzen' },
  { key: 'stornieren', label: 'Stornieren', gefahr: true },
];

/**
 * Menü einer Bezirkskarte (LFH-673): „Auf Karte zeigen" zuerst, sobald der Bezirk eine Fläche
 * hat — auch OHNE Schreibrecht, denn ein Sprung ist Lesen (LFH-616). Die Handlungen folgen
 * nur mit Schreibrecht. Ohne Fläche fehlt der Eintrag; ein eigenes Feld „keine Fläche" hat
 * der Plan-Modus nicht (höchstens drei Sekundärfelder, alle belegt). Rein und exportiert.
 */
export function bezirkMenue(
  b: Pick<Evakuierungsbezirk, 'flaechen'>,
  darfSchreiben: boolean,
): readonly (MenueEintrag & { key: BezirkAktion })[] {
  const karte: (MenueEintrag & { key: BezirkAktion })[] =
    b.flaechen > 0 ? [{ key: 'karte', label: 'Auf Karte zeigen' }] : [];
  return darfSchreiben ? [...karte, ...MENUE] : karte;
}

export default function EvakuierungBlock({
  einsatzId,
  bezirke,
  ladend,
  darfSchreiben,
  hervorgehoben,
  dataUpdatedAt,
  onStandMelden,
  onAktion,
}: {
  einsatzId: number;
  bezirke: readonly Evakuierungsbezirk[];
  ladend: boolean;
  darfSchreiben: boolean;
  /** Per Deeplink angesteuerter Bezirk (`?bezirk=`). */
  hervorgehoben: number | null;
  dataUpdatedAt?: number;
  onStandMelden: (b: Evakuierungsbezirk) => void;
  onAktion: (aktion: BezirkAktion, b: Evakuierungsbezirk) => void;
}) {
  const { token } = theme.useToken();
  const kennzahl = useMemo(() => evakuierungKennzahl(bezirke), [bezirke]);
  const karte = useMemo<Kartenplan<Evakuierungsbezirk, BezirkSpalte>>(
    () => ({
      art: 'plan',
      titel: { spalte: 'bezeichnung' },
      status: (b) => raeumungszustand[b.raeumung],
      sekundaer: ['evakuiert', 'stand', 'abschnitt'],
      // Ohne Schreibrecht entfallen die Zeilenaktionen ganz (LFH-346, zwei Zuschnitte): der
      // Grund steht EINMAL über der Seite, nicht n-mal als gesperrter Knopf.
      aktion: darfSchreiben
        ? {
            etikett: 'Stand melden',
            zugaenglicherName: (b) => `Stand melden für Bezirk ${b.bezeichnung}`,
            onKlick: onStandMelden,
          }
        : undefined,
      // Ohne Schreibrecht bleibt nur der Sprung auf die Karte; ohne Fläche gibt es dann
      // keinen Auslöser (das Primitiv baut keinen für ein leeres Menü).
      weitere: {
        eintraege: (b) => bezirkMenue(b, darfSchreiben),
        zugaenglicherName: (b) => `Aktionen zu Bezirk ${b.bezeichnung}`,
        onWahl: (key, b) => onAktion(key as BezirkAktion, b),
      },
    }),
    [darfSchreiben, onStandMelden, onAktion],
  );
  const aufklappen = useMemo(
    () => ({
      etikett: 'Verlauf',
      zugaenglicherName: (b: Evakuierungsbezirk) => `Verlauf zu Bezirk ${b.bezeichnung}`,
      inhalt: (b: Evakuierungsbezirk) => (
        <MeldeVerlauf
          einsatzId={einsatzId}
          art="bezirk"
          objektId={b.id}
          darfZuruecknehmen={darfSchreiben}
        />
      ),
    }),
    [einsatzId, darfSchreiben],
  );

  return (
    <div style={{ marginBottom: token.marginLG }}>
      <Bereichskopf
        titel="Evakuierung"
        ueberschrift="h2"
        meta={ladend ? undefined : kennzahlText(kennzahl)}
        dataUpdatedAt={dataUpdatedAt}
      />
      <Datensicht
        bezeichnung="Evakuierungsbezirke"
        form="karte"
        spalten={spalten}
        daten={bezirke}
        zeilenSchluessel={(b) => `bezirk-${b.id}`}
        ladend={ladend}
        leerText="Keine Evakuierungsbezirke. Mit „Evakuierungsbezirk anlegen“ wird eine Räumung mit ihrer Plangröße erfasst."
        karte={karte}
        aufklappen={aufklappen}
        zeilenKlasse={(b) => (b.id === hervorgehoben ? HERVORGEHOBEN : undefined)}
      />
    </div>
  );
}
