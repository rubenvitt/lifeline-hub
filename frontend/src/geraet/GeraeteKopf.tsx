import { useCallback, useSyncExternalStore } from 'react';
import { theme } from 'antd';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { notifyManager, useQueryClient } from '@tanstack/react-query';
import { IconUhr } from '../icons';
import type { GeraetAnzeige } from '../api/types';
import {
  KOPF_HOEHE,
  KopfRechts,
  Markenzelle,
  SyncAnzeige,
  Uhr,
  kopfZelleStil,
} from '../components/Kopfleiste';
import { useMinutenTakt } from '../components/useMinutenTakt';
import { useViewport } from '../components/useViewport';
import { formatiereDatenstand } from '../components/Datenstand';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { useOhneVerbindung } from '../offline/verbindung';
import { ANSICHT_LABEL } from '../pages/einstellungen/geraeteKern';
import { farbenDunkel, rahmenFarben, schrift } from '../theme/tokens';
import { GeraeteMenue } from './GeraeteMenue';
import { useStellenName } from './stellenName';
import { zeitpunkt } from '../anzeige/zeitDarstellung';

dayjs.extend(utc);

/** Ab hier gilt das Kopplungsende als bald (Spec `feldgeraet-bedienung`). */
export const KOPPLUNG_ENDET_BALD_MS = 60 * 60 * 1000;

/** Endet die Kopplung in weniger als einer Stunde? `laeuftAbAt` ist UTC vom Server. */
export function kopplungEndetBald(laeuftAbAt: string, jetzt: number): boolean {
  return dayjs.utc(laeuftAbAt).valueOf() - jetzt < KOPPLUNG_ENDET_BALD_MS;
}

const STUNDE_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/**
 * Restzeit der Kopplung für die Kopfzeile (LLH-1734, Spec `feldgeraet-bedienung`): `kurz` sichtbar,
 * `lang` für den zugänglichen Namen. Ab einer Stunde ganze Stunden, darunter Minuten, beide
 * abgerundet (lieber früher gewarnt; aufgerundet folgte auf „1 h“ eine Minute „60 min“). Die letzte
 * Minute heißt „1 min“, nicht „0 min“. Danach „endet“, bis die Hülle auf „Kopplung beendet“ wechselt.
 */
export function kopplungRestText(
  laeuftAbAt: string,
  jetzt: number,
): { kurz: string; lang: string } {
  const rest = dayjs.utc(laeuftAbAt).valueOf() - jetzt;
  if (rest <= 0) return { kurz: 'endet', lang: 'endet jetzt' };
  if (rest >= STUNDE_MS) {
    const h = Math.floor(rest / STUNDE_MS);
    return { kurz: `noch ${h} h`, lang: `noch ${h} ${h === 1 ? 'Stunde' : 'Stunden'}` };
  }
  const min = Math.max(1, Math.floor(rest / MINUTE_MS));
  return { kurz: `noch ${min} min`, lang: `noch ${min} ${min === 1 ? 'Minute' : 'Minuten'}` };
}

/**
 * Der jüngste Datenstand im Abfragecache: was das Gerät zuletzt vom Server bekam. Ohne Netz sagt
 * die Kopfzeile damit, wie alt die angezeigten Daten sind.
 */
function useJuengsterDatenstand(): number {
  const cache = useQueryClient().getQueryCache();
  // `batchCalls` wie TanStacks eigene Zähler (`useIsFetching`): der Cache meldet auch, während
  // eine andere Komponente rendert und dabei eine Abfrage anlegt; erst gebündelt nachgereicht
  // rendert die Kopfzeile nicht mitten in fremdem Rendern.
  const abonniere = useCallback(
    (melde: () => void) => cache.subscribe(notifyManager.batchCalls(melde)),
    [cache],
  );
  return useSyncExternalStore(abonniere, () =>
    cache.getAll().reduce((max, q) => Math.max(max, q.state.dataUpdatedAt), 0),
  );
}

/**
 * Ende der Kopplung als Restzeit mit Wort, „Kopplung noch 5 h“ (LLH-1734: „bis 131757“ in taktischer
 * Darstellung erklärte sich nicht). Die Endzeit in der Zeitdarstellung steht im Hinweis und im
 * zugänglichen Namen. Unter einer Stunde mit Wort und Farbe hervorgehoben (WCAG 1.4.1).
 */
function KopplungsEnde({
  laeuftAbAt,
  zelle,
  mitSymbol,
}: {
  laeuftAbAt: string;
  zelle: { padding: number };
  /** Unter `md` ohne Uhr-Symbol: das Wort „Kopplung“ trägt die Zelle allein, Platz für die Zeile. */
  mitSymbol: boolean;
}) {
  const jetzt = useMinutenTakt();
  const bald = kopplungEndetBald(laeuftAbAt, jetzt);
  // Die Hülle hat keinen `EinsatzAnzeigeProvider` (`geraet/AGENTS.md`): der Hook liefert dort die
  // Browserzone, unter einem Provider dessen Zone (LFH-913).
  const { konventionen } = useAnzeigeKonventionen();
  const ende = zeitpunkt(laeuftAbAt, konventionen);
  const rest = kopplungRestText(laeuftAbAt, jetzt);
  const farbe = bald ? farbenDunkel.achtung : rahmenFarben.gedaempft;
  return (
    <div
      data-lfh="kopf-kopplungsende"
      data-bald={bald ? 'ja' : 'nein'}
      role="img"
      aria-label={
        // „bald“ nur, solange Zeit bleibt; abgelaufen sagt `rest.lang` selbst „endet jetzt“.
        bald && rest.kurz !== 'endet'
          ? `Kopplung endet bald, ${rest.lang}, bis ${ende}`
          : `Kopplung ${rest.lang}, bis ${ende}`
      }
      title={bald ? `Kopplung bis ${ende} · Verlängern: Einsatzleitung` : `Kopplung bis ${ende}`}
      style={kopfZelleStil(zelle)}
    >
      {mitSymbol && (
        <span aria-hidden="true" style={{ display: 'inline-flex', color: farbe }}>
          <IconUhr size={16} />
        </span>
      )}
      <span
        aria-hidden="true"
        style={{
          fontFamily: schrift.zahl,
          fontSize: 12,
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
          color: bald ? farbe : rahmenFarben.text,
          fontWeight: bald ? 600 : 400,
        }}
      >
        {`Kopplung ${rest.kurz}`}
      </span>
    </div>
  );
}

/**
 * Kopfzeile der Gerätehülle (LFH-892, Spec `feldgeraet-bedienung`): Stelle, Gerät, Verbindung und
 * Kopplungsende stehen immer; ohne Netz zusätzlich der Stand der angezeigten Daten. Rechts das
 * Gerätemenü statt des Benutzermenüs, keine Suche und keine Sprungpalette. Den Namen der Stelle
 * liest {@link useStellenName} live, nicht aus der Sitzung (LLH-1155).
 */
export function GeraeteKopf({ geraet }: { geraet: GeraetAnzeige }) {
  const { token } = theme.useToken();
  const ohneVerbindung = useOhneVerbindung();
  const stand = useJuengsterDatenstand();
  const stelle = useStellenName(geraet);
  const { konventionen } = useAnzeigeKonventionen();
  // Unter `md` rücken die Zellen zusammen wie im Einsatzkopf (LLH-1728, D3), und die Restzeit steht
  // ohne Uhr-Symbol: sonst bräche die rechte Gruppe auf 390 px seit „Kopplung noch 5 h“ (LLH-1734)
  // in `kompakt` und `komfortabel` in eine zweite Zeile, und die Ausgabeansicht rollte um deren
  // Höhe (LLH-1294). In `handschuh` bricht sie weiter um, wie schon vorher.
  const mittel = useViewport().abBreite('md');
  const zellToken = mittel ? token : { padding: token.paddingXS };
  return (
    <header
      data-lfh="geraet-kopf"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'stretch',
        minHeight: KOPF_HOEHE,
        background: rahmenFarben.grund,
        borderBottom: `1px solid ${rahmenFarben.linie}`,
        color: rahmenFarben.text,
      }}
    >
      <Markenzelle />
      <div
        data-lfh="kopf-stelle"
        style={{ ...kopfZelleStil(zellToken), flex: '1 1 0', minWidth: 0, flexWrap: 'wrap' }}
      >
        <strong style={{ whiteSpace: 'nowrap' }}>{stelle ?? ANSICHT_LABEL[geraet.ansicht]}</strong>
        <span
          style={{
            color: rahmenFarben.gedaempft,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {geraet.bezeichnung}
        </span>
      </div>
      <KopfRechts>
        <KopplungsEnde laeuftAbAt={geraet.laeuft_ab_at} zelle={zellToken} mitSymbol={mittel} />
        <SyncAnzeige liveErwartet zelle={zellToken} />
        {ohneVerbindung && stand > 0 && (
          // Eigene Zelle statt `Datenstand`: dessen Sekundärtext folgt dem Modus, der Kopf ist
          // immer dunkel.
          <div
            data-lfh="kopf-datenstand"
            aria-label={`Datenstand ${formatiereDatenstand(stand, konventionen)}, offline`}
            role="img"
            style={{
              ...kopfZelleStil(zellToken),
              fontFamily: schrift.zahl,
              fontSize: 12,
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
              color: farbenDunkel.achtung,
            }}
          >
            <span aria-hidden="true">Stand {formatiereDatenstand(stand, konventionen)}</span>
          </div>
        )}
        <Uhr zelle={zellToken} />
        <div style={{ ...kopfZelleStil(zellToken, 'keiner'), paddingInlineStart: token.paddingXS }}>
          <GeraeteMenue />
        </div>
      </KopfRechts>
    </header>
  );
}
