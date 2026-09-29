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
 * Block „Evakuierung" der Betreuungsseite.
 *
 * Karten in JEDER Breite — ein Bezirk wird gelesen, nicht verglichen. Titel = Bezeichnung,
 * Status = Räumungszustand, drei Sekundärfelder: „N · von M geplant", Stand-Zeit, Abschnitt.
 * Genau EINE Primäraktion („Stand melden"), alles Weitere im Menü (`weitere`).
 *
 * „Verlauf“ als beschrifteter Aufklappbereich an jeder Karte, auch ohne Schreibrecht (Lesen
 * zählt nicht gegen die Primäraktion); die Reihe lädt erst beim Aufklappen.
 * Der Zeilenschlüssel trägt ein Präfix (`bezirk-5`), weil die Stellen-Tabelle derselben Seite
 * eigene Zeilen mit eigenen Nummern hat und `scrolleZurZeile` beide Marken sucht.
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
    // `ZeitAnzeige` liest den Wire-String als UTC — nie `dayjs(s)`.
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
 * Menü einer Bezirkskarte: „Auf Karte zeigen" zuerst, sobald der Bezirk eine Fläche hat — auch
 * OHNE Schreibrecht, denn ein Sprung ist Lesen. Die Handlungen folgen nur mit Schreibrecht.
 * Rein und exportiert.
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
      // Ohne Schreibrecht entfallen die Zeilenaktionen; der Grund steht EINMAL über der Seite.
      aktion: darfSchreiben
        ? {
            etikett: 'Stand melden',
            zugaenglicherName: (b) => `Stand melden für Bezirk ${b.bezeichnung}`,
            onKlick: onStandMelden,
          }
        : undefined,
      // Ohne Schreibrecht bleibt nur der Sprung auf die Karte; ohne Fläche dann kein Auslöser.
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
