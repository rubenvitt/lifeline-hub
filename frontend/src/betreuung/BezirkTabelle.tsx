import { Button, Space, Typography, theme } from 'antd';
import { useMemo } from 'react';
import type { Evakuierungsbezirk, Raeumungszustand } from '../api/types';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import Datensicht, { spaltenFuer, type Kartenplan } from '../components/Datensicht';
import { useListenGedaechtnis, type GedaechtnisSpalte } from '../components/listenGedaechtnis';
import { KennungsLink } from '../components/kennungsLink';
import { MenueAusloeser, type MenueEintrag } from '../components/MenueAusloeser';
import StatusTag from '../components/StatusTag';
import { Balken, useRollen } from '../components/instrument';
import { useViewport } from '../components/useViewport';
import { KEINE_BERECHTIGUNG } from '../einsatz/modulRegistry';
import { useSprungSperre } from '../einsatz/useSprungSperre';
import { evakuierungsbezirkPfad } from '../routing/deeplinks';
import { raeumungszustand } from '../theme/statusFarben';
import { evakuiertText, personenZahl, RAEUMUNG_FOLGE } from './betreuungText';
import MeldeVerlauf from './MeldeVerlauf';
import { gebietZeichnenText } from './gebietZeichnen';

/**
 * Die Bezirkstabelle der Evakuierungsseite (LLH-1034, ersetzt die Bezirkskarten der früheren
 * Betreuungsseite).
 *
 * Tabelle in JEDER Breite: verglichen wird über Bezirke hinweg („wo läuft die Räumung, wo fehlt
 * ein Stand?"). Fixierte Kennung ist die Bezeichnung, nie die DB-`id`. Rangfolge nach der
 * Zielfrage: Räumung und Evakuiert direkt hinter der Kennung; Stand, Sammelstelle, Fläche und
 * Abschnitt weichen in schmalen Breiten (`abBreite`, zurückholbar über den Spaltenschalter).
 *
 * „Evakuiert" führt mit der Zahl („N · von M geplant", „≈" bei geschätzt, „keine Meldung" statt
 * 0); der Balken darunter ist der zweite Kanal und trägt denselben Wortlaut als Namen.
 *
 * Zeilenaktionen: „Stand melden" direkt — unter `md` in der fixierten Kennung unter dem Namen,
 * sonst läge der Knopf bei 390 px hinter dem Querscrollen (wie „Belegung melden" der Stellen) —,
 * alles Weitere im Menü. „Auf Karte zeigen" steht im Menü, sobald der Bezirk eine Fläche hat,
 * auch ohne Schreibrecht (ein Sprung ist Lesen).
 *
 * „Verlauf" als Aufklappbereich je Zeile, auch ohne Schreibrecht; lädt erst beim Aufklappen. Er
 * bleibt neben der Detailseite stehen (LLH-1076, design.md D8): nach „Stand melden" in der Liste
 * gleicht man mehrere Bezirke ab und nimmt eine Fehlmeldung zurück, ohne die Liste zu verlassen.
 *
 * Die Bezeichnung ist der Kennungs-Link auf die Detailseite des Bezirks (LLH-1076); einen
 * Zeilenklick gibt es nicht, weil die Zeile Knöpfe, Menü und Aufklapper trägt, deren Klicks sonst
 * mitnavigierten (der Riegel von `onZeileKlick` kennt nur Anker). Der Link steht im `render` der Spalte und nicht als
 * `titel.ziel` der Datensicht: unter `md` reitet „Stand melden" in derselben Zelle mit, und ein
 * Knopf in einem Anker wäre ungültig. Den Plangröße-Dialog gibt es nicht mehr: die Plangröße
 * schreibt die Detailseite.
 *
 * Der Zeilenschlüssel trägt ein Präfix (`bezirk-5`).
 *
 * Sortieren und Filtern (LLH-1096, Muster der Schadenliste): Räumung, Stand („gemeldet“ / „keine
 * Meldung“) und Abschnitt filtern im Spaltenkopf, jede Spalte mit vergleichbarem Wert sortiert;
 * die Sammelstelle ist Freitext und bleibt ohne. Sortierung und Filter stehen in der Adresse.
 * Stand und Abschnitt weichen in schmalen Breiten wie bisher; ihr Filter wirkt dann nicht (Spec,
 * „was man nicht sieht, wirkt nicht“), ein Auswahlfeld kommt nicht dazu (Tabelle in jeder Breite).
 */

export type BezirkAktion = 'karte' | 'zeichnen' | 'raeumung' | 'stornieren';

const MENUE: readonly MenueEintrag<BezirkAktion>[] = [
  { key: 'raeumung', label: 'Räumung setzen' },
  { key: 'stornieren', label: 'Stornieren', gefahr: true },
];

/**
 * Menü einer Zeile: „Auf Karte zeigen" zuerst, sobald der Bezirk eine Fläche hat — auch OHNE
 * Schreibrecht. Mit Schreibrecht danach „Gebiet zeichnen“ bzw. „Weitere Teilfläche zeichnen“
 * (LLH-1069). Ist die Lagekarte gesperrt, stehen beide gesperrt mit Grund da (LFH-888).
 */
export function bezirkMenue(
  b: Pick<Evakuierungsbezirk, 'flaechen'>,
  darfSchreiben: boolean,
  karteGesperrt: boolean,
): readonly MenueEintrag<BezirkAktion>[] {
  const eintrag = (key: BezirkAktion, label: string): MenueEintrag<BezirkAktion> =>
    karteGesperrt
      ? { key, label: `${label} (${KEINE_BERECHTIGUNG})`, gesperrt: true }
      : { key, label };
  const karte = b.flaechen > 0 ? [eintrag('karte', 'Auf Karte zeigen')] : [];
  if (!darfSchreiben) return karte;
  return [...karte, eintrag('zeichnen', gebietZeichnenText(b.flaechen)), ...MENUE];
}

/** Werte des Standfilters: ob für den Bezirk eine Meldung vorliegt („keine Meldung“ statt 0). */
const STAND_WERTE = [
  { text: 'Gemeldet', value: 'gemeldet' },
  { text: 'Keine Meldung', value: 'keine' },
];
const RAEUMUNG_WERTE = RAEUMUNG_FOLGE.map((r: Raeumungszustand) => ({
  text: raeumungszustand[r].label,
  value: r as string,
}));

/**
 * Was das Listengedächtnis beim Aufbau prüft (LLH-1096, Herleitung in `pages/FahrzeugePage.tsx`):
 * feste Achsen mit ihren Werten; der Abschnitt nimmt seine Werte aus den Bezirken (`ausDaten`).
 * Muss zu `bezirkSpalten` passen.
 */
const GEDAECHTNIS_SPALTEN: readonly GedaechtnisSpalte[] = [
  { key: 'bezeichnung', sortWert: true },
  { key: 'raeumung', sortWert: true, filter: { werte: RAEUMUNG_WERTE } },
  { key: 'evakuiert', sortWert: true },
  { key: 'stand', sortWert: true, filter: { werte: STAND_WERTE } },
  { key: 'flaeche', sortWert: true },
];
// Alle Spaltenschlüssel, auch die ohne Sortierung und Filter: Die Datensicht typisiert das Gedächtnis
// über die Schlüssel ihrer Spalten.
type GedaechtnisKey =
  | 'bezeichnung'
  | 'raeumung'
  | 'evakuiert'
  | 'stand'
  | 'sammelstelle'
  | 'flaeche'
  | 'abschnitt'
  | 'aktionen';
const GEDAECHTNIS_AUS_DATEN: readonly GedaechtnisKey[] = ['abschnitt'];

/** Breite, in der ein langer Bezirksname unter `md` umbricht (wie bei den Stellen). */
const KENNUNG_MAX_PX = 150;

const leer = <Typography.Text type="secondary">—</Typography.Text>;

const bezirkSpalten = (
  einsatzId: number,
  darfSchreiben: boolean,
  onStandMelden: (b: Evakuierungsbezirk) => void,
  onAktion: (aktion: BezirkAktion, b: Evakuierungsbezirk) => void,
  karteGesperrt: boolean,
  /** Unter `md`: „Stand melden" reitet in der fixierten Kennung mit. */
  meldenInKennung: boolean,
  kennungAbstand: number,
  balkenFarbe: string,
  /** Die Abschnitte der Bezirke, für den Filter; leer heißt kein Filter. */
  abschnittWerte: readonly { text: string; value: string }[],
) => {
  const meldeKnopf = (b: Evakuierungsbezirk) =>
    darfSchreiben ? (
      <Button
        aria-label={`Stand melden für Bezirk ${b.bezeichnung}`}
        onClick={() => onStandMelden(b)}
      >
        Stand melden
      </Button>
    ) : null;
  return spaltenFuer<Evakuierungsbezirk>()([
    {
      key: 'bezeichnung',
      title: 'Bezirk',
      immerSichtbar: true,
      sortWert: (b) => b.bezeichnung,
      suchText: (b) => b.bezeichnung,
      render: (_, b) => {
        const name = (
          <KennungsLink
            to={evakuierungsbezirkPfad(einsatzId, b.id)}
            style={{
              fontWeight: 600,
              ...(meldenInKennung ? { maxWidth: KENNUNG_MAX_PX } : {}),
            }}
          >
            {b.bezeichnung}
          </KennungsLink>
        );
        const knopf = meldenInKennung ? meldeKnopf(b) : null;
        return knopf ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: kennungAbstand,
            }}
          >
            {name}
            {knopf}
          </div>
        ) : (
          name
        );
      },
    },
    {
      key: 'raeumung',
      title: 'Räumung',
      sortWert: (b) => RAEUMUNG_FOLGE.indexOf(b.raeumung),
      filter: { werte: RAEUMUNG_WERTE, trifft: (b, w) => b.raeumung === w },
      render: (_, b) => <StatusTag darstellung={raeumungszustand[b.raeumung]} />,
    },
    {
      key: 'evakuiert',
      title: 'Evakuiert',
      zahl: true,
      sortWert: (b) => b.stand?.evakuiert,
      render: (_, b) => {
        const text = evakuiertText(b);
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: kennungAbstand / 2 }}>
            <span>{text}</span>
            {b.stand && (
              <Balken
                wert={b.stand.evakuiert}
                max={b.plan_personen}
                farbe={balkenFarbe}
                beschriftung={`Bezirk ${b.bezeichnung}: ${text}`}
                style={{ minWidth: 96 }}
              />
            )}
          </div>
        );
      },
    },
    {
      key: 'stand',
      title: 'Stand',
      zahl: true,
      abBreite: 'md',
      sortWert: (b) => b.stand?.zeitpunkt_at,
      filter: { werte: STAND_WERTE, trifft: (b, w) => (b.stand ? 'gemeldet' : 'keine') === w },
      // `ZeitAnzeige` liest den Wire-String als UTC — nie `dayjs(s)`.
      render: (_, b) => (b.stand ? <ZeitAnzeige wert={b.stand.zeitpunkt_at} rolle="kurz" /> : leer),
    },
    {
      key: 'sammelstelle',
      title: 'Sammelstelle',
      abBreite: 'lg',
      // Weder Sortierung noch Filter (LLH-1096): Freitext, kein Vergleichswert.
      suchText: (b) => b.sammelstelle,
      render: (_, b) => b.sammelstelle ?? leer,
    },
    {
      key: 'flaeche',
      title: 'Fläche',
      abBreite: 'lg',
      sortWert: (b) => b.flaechen,
      // Zeichen und Wort: ohne Fläche „—“ mit „keine“, damit Farbe oder Zeichen nie allein tragen.
      render: (_, b) =>
        b.flaechen > 0 ? (
          <span>
            <span aria-hidden="true">▰ </span>
            {b.flaechen === 1 ? '1 Fläche' : `${personenZahl(b.flaechen)} Flächen`}
          </span>
        ) : (
          <Typography.Text type="secondary">
            <span aria-hidden="true">— </span>keine
          </Typography.Text>
        ),
    },
    {
      key: 'abschnitt',
      title: 'Abschnitt',
      abBreite: 'xl',
      sortWert: (b) => b.abschnitt_name,
      filter:
        abschnittWerte.length > 0
          ? { werte: abschnittWerte, trifft: (b, w) => b.abschnitt_name === w }
          : undefined,
      suchText: (b) => b.abschnitt_name,
      render: (_, b) => b.abschnitt_name ?? leer,
    },
    {
      key: 'aktionen' as const,
      title: 'Aktionen',
      immerSichtbar: true,
      render: (_: unknown, b: Evakuierungsbezirk) => {
        const eintraege = bezirkMenue(b, darfSchreiben, karteGesperrt);
        return (
          // `middle`: hält ≥ 16 px zwischen Knopf und Dreipunkt im Handschuh-Betrieb.
          <Space wrap size="middle">
            {!meldenInKennung && meldeKnopf(b)}
            {eintraege.length > 0 && (
              <MenueAusloeser
                eintraege={eintraege}
                zugaenglicherName={`Aktionen zu Bezirk ${b.bezeichnung}`}
                onWahl={(aktion) => onAktion(aktion, b)}
              />
            )}
          </Space>
        );
      },
    },
  ]);
};

type BezirkSpalte = ReturnType<typeof bezirkSpalten>[number]['key'];

/**
 * Der Kartenplan ist Pflicht am Primitiv, greift bei `form="tabelle"` aber nie; ehrlich belegt,
 * falls die Form je auf `auto` wechselt.
 */
const KARTE: Kartenplan<Evakuierungsbezirk, BezirkSpalte> = {
  art: 'plan',
  titel: { spalte: 'bezeichnung' },
  status: (b) => raeumungszustand[b.raeumung],
  sekundaer: ['evakuiert', 'stand', 'abschnitt'],
};

export default function BezirkTabelle({
  einsatzId,
  bezirke,
  ladend,
  darfSchreiben,
  onStandMelden,
  onAktion,
}: {
  einsatzId: number;
  bezirke: readonly Evakuierungsbezirk[];
  ladend: boolean;
  darfSchreiben: boolean;
  onStandMelden: (b: Evakuierungsbezirk) => void;
  onAktion: (aktion: BezirkAktion, b: Evakuierungsbezirk) => void;
}) {
  const { token } = theme.useToken();
  const { rollen } = useRollen();
  const { istSchmal } = useViewport();
  const karteGesperrt = useSprungSperre(einsatzId)('lagekarte');
  const gedaechtnis = useListenGedaechtnis<GedaechtnisKey>('evakuierung', GEDAECHTNIS_SPALTEN, {
    vorgabe: null,
    einsatzId,
    ausDaten: GEDAECHTNIS_AUS_DATEN,
  });
  // Die Namen als ein Schlüssel: neue Spalten nur, wenn sich die Menge der Abschnitte ändert.
  const abschnittNamen = [
    ...new Set(bezirke.map((b) => b.abschnitt_name).filter((n): n is string => !!n)),
  ]
    .sort((a, b) => a.localeCompare(b, 'de', { numeric: true }))
    .join('\n');
  const abschnittWerte = useMemo(
    () => (abschnittNamen ? abschnittNamen.split('\n').map((n) => ({ text: n, value: n })) : []),
    [abschnittNamen],
  );
  const spalten = useMemo(
    () =>
      bezirkSpalten(
        einsatzId,
        darfSchreiben,
        onStandMelden,
        onAktion,
        karteGesperrt,
        istSchmal,
        token.marginXS,
        rollen.gedaempft,
        abschnittWerte,
      ),
    [
      einsatzId,
      darfSchreiben,
      onStandMelden,
      onAktion,
      karteGesperrt,
      istSchmal,
      token.marginXS,
      rollen.gedaempft,
      abschnittWerte,
    ],
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
    <Datensicht
      bezeichnung="Evakuierungsbezirke"
      form="tabelle"
      spalten={spalten}
      daten={bezirke}
      zeilenSchluessel={(b) => `bezirk-${b.id}`}
      ladend={ladend}
      // Der Anlegen-Knopf steht im Seitenkopf (die EINE Primäraktion).
      leerText="Keine Evakuierungsbezirke"
      mehrzahl="Bezirken"
      gedaechtnis={gedaechtnis}
      karte={KARTE}
      aufklappen={aufklappen}
    />
  );
}
