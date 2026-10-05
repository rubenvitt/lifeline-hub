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
import { formatiereDatenstand } from '../components/Datenstand';
import { formatUhrzeitMitTag } from '../anzeige/format';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { useOhneVerbindung } from '../offline/verbindung';
import { ANSICHT_LABEL } from '../pages/einstellungen/geraeteKern';
import { farbenDunkel, rahmenFarben, schrift } from '../theme/tokens';
import { GeraeteMenue } from './GeraeteMenue';

dayjs.extend(utc);

/** Ab hier gilt das Kopplungsende als bald (Spec `feldgeraet-bedienung`). */
export const KOPPLUNG_ENDET_BALD_MS = 60 * 60 * 1000;

/** Endet die Kopplung in weniger als einer Stunde? `laeuftAbAt` ist UTC vom Server. */
export function kopplungEndetBald(laeuftAbAt: string, jetzt: number): boolean {
  return dayjs.utc(laeuftAbAt).valueOf() - jetzt < KOPPLUNG_ENDET_BALD_MS;
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

/** Ende der Kopplung; unter einer Stunde mit Wort und Farbe hervorgehoben (WCAG 1.4.1). */
function KopplungsEnde({ laeuftAbAt }: { laeuftAbAt: string }) {
  const { token } = theme.useToken();
  const jetzt = useMinutenTakt();
  const bald = kopplungEndetBald(laeuftAbAt, jetzt);
  // Die Hülle hat keinen `EinsatzAnzeigeProvider` (`geraet/AGENTS.md`): der Hook liefert dort die
  // Browserzone, unter einem Provider dessen Zone (LFH-913).
  const { konventionen } = useAnzeigeKonventionen();
  const uhrzeit = formatUhrzeitMitTag(laeuftAbAt, konventionen);
  const farbe = bald ? farbenDunkel.achtung : rahmenFarben.gedaempft;
  return (
    <div
      data-lfh="kopf-kopplungsende"
      data-bald={bald ? 'ja' : 'nein'}
      role="img"
      aria-label={bald ? `Kopplung endet bald, um ${uhrzeit}` : `Kopplung bis ${uhrzeit}`}
      title={bald ? 'Für eine Verlängerung bei der Einsatzleitung melden.' : undefined}
      style={kopfZelleStil(token)}
    >
      <span aria-hidden="true" style={{ display: 'inline-flex', color: farbe }}>
        <IconUhr size={16} />
      </span>
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
        {bald ? `endet ${uhrzeit}` : `bis ${uhrzeit}`}
      </span>
    </div>
  );
}

/**
 * Kopfzeile der Gerätehülle (LFH-892, Spec `feldgeraet-bedienung`): Stelle, Gerät, Verbindung und
 * Kopplungsende stehen immer; ohne Netz zusätzlich der Stand der angezeigten Daten. Rechts das
 * Gerätemenü statt des Benutzermenüs, keine Suche und keine Sprungpalette.
 */
export function GeraeteKopf({ geraet }: { geraet: GeraetAnzeige }) {
  const { token } = theme.useToken();
  const ohneVerbindung = useOhneVerbindung();
  const stand = useJuengsterDatenstand();
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
        style={{ ...kopfZelleStil(token), flex: '1 1 0', minWidth: 0, flexWrap: 'wrap' }}
      >
        <strong style={{ whiteSpace: 'nowrap' }}>
          {geraet.stelle ?? ANSICHT_LABEL[geraet.ansicht]}
        </strong>
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
        <KopplungsEnde laeuftAbAt={geraet.laeuft_ab_at} />
        <SyncAnzeige liveErwartet />
        {ohneVerbindung && stand > 0 && (
          // Eigene Zelle statt `Datenstand`: dessen Sekundärtext folgt dem Modus, der Kopf ist
          // immer dunkel.
          <div
            data-lfh="kopf-datenstand"
            aria-label={`Datenstand ${formatiereDatenstand(stand)}, offline`}
            role="img"
            style={{
              ...kopfZelleStil(token),
              fontFamily: schrift.zahl,
              fontSize: 12,
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
              color: farbenDunkel.achtung,
            }}
          >
            <span aria-hidden="true">Stand {formatiereDatenstand(stand)}</span>
          </div>
        )}
        <Uhr />
        <div style={{ ...kopfZelleStil(token, 'keiner'), paddingInlineStart: token.paddingXS }}>
          <GeraeteMenue />
        </div>
      </KopfRechts>
    </header>
  );
}
