import { Alert, Breadcrumb, Button, Spin } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ladeEinsatz } from '../api/einsaetze';
import type { PegelAnzeige, PegelVerlauf } from '../api/types';
import { pegelAbfrage, pegelVerlaufAbfrage } from '../api/pegel';
import { einsatzKeys } from '../api/queryKeys';
import { wetterAbfrage } from '../api/wetter';
import { useUhr } from '../abloesung/useUhr';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import EinsatzSeite from '../components/EinsatzSeite';
import { useRollen, type PaneelDatenzustand } from '../components/instrument';
import { einsatzdatenPfad, einsatzEinstellungenPfad } from '../routing/deeplinks';
import PegelPaneel from '../wetter/PegelPaneel';
import { VorhersagePaneel, WarnungenPaneel } from '../wetter/WetterPaneele';
import { teileWarnungen } from '../wetter/wetterStand';

/** „1 Warnung" · „n Warnungen" (Seitenkopf). Rein. */
export function warnungenMeta(n: number): string {
  return n === 1 ? '1 Warnung' : `${n} Warnungen`;
}

/**
 * Zeigt ein Pegel einen Messwert, aber keine Verlaufsreihe? Dann hat der Verlauf beim Einhängen
 * gegen die Liste verloren: beide Abfragen treffen einen kalten Cache-Eintrag, und nur eine gewinnt
 * die In-flight-Marke des Backends (`pegel::abruf`). Die Liste heilt sich über ihre 10-s-Nachfrage,
 * der Verlauf hat nur den 5-min-Takt — ohne Nachziehen stünde bis zu 5 min ein Wert neben „noch
 * kein Verlauf". Ohne Messung fehlt beides: ein Ausfall, kein Wettlauf. Rein.
 */
export function verlaufLuecke(
  pegel: readonly PegelAnzeige[],
  verlauf: readonly PegelVerlauf[] | undefined,
): boolean {
  if (!verlauf) return false;
  return pegel.some(
    (p) => p.messung && !(verlauf.find((v) => v.pegel_id === p.id)?.punkte.length ?? 0),
  );
}

/** Datenzustand eines Paneels aus einer Abfrage (`leer` entscheidet der Aufrufer). */
function paneelZustand(q: { isLoading: boolean; isError: boolean }): PaneelDatenzustand {
  if (q.isLoading) return 'laden';
  if (q.isError) return 'fehler';
  return 'daten';
}

/**
 * Fachmodul „Wetter & Pegel" (LFH-633): was Wasser und Wetter am Einsatzort tun.
 *
 * Drei Paneele, drei Stände: Pegel, Warnungen und Vorhersage kommen aus zwei Quellen (PEGELONLINE,
 * Bright Sky) und tragen je ihren Stand. Fällt eine aus, zeigt nur ihr Paneel „Stand unbekannt".
 * Der Seitenkopf zeigt den ältesten Abruf (`gemeinsamerDatenstand`).
 *
 * Leseseite: gepflegt wird in Einstellungen › Pegel. Die Primäraktion im Kopf öffnet dorthin; diese
 * Seite schreibt nichts und braucht keinen Rechte-Hinweis.
 *
 * Kein Live-Ereignis: alle drei Abfragen fragen alle 5 min nach. Die Uhr (30 s) lässt „veraltet"
 * auch ohne Abruf umschlagen.
 */
export default function WetterPegelPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const navigate = useNavigate();
  const { token } = useRollen();
  const { konventionen: konv } = useAnzeigeKonventionen();
  const jetzt = useUhr().valueOf();

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const pegelQuery = useQuery(pegelAbfrage(einsatzId));
  const verlaufQuery = useQuery(pegelVerlaufAbfrage(einsatzId));
  const wetterQuery = useQuery(wetterAbfrage(einsatzId));

  // Den Verlauf an die Liste koppeln (siehe `verlaufLuecke`): jede neue Listenantwort zieht ihn
  // einmal nach, solange eine Lücke besteht. Bleibt sie, geschieht bis zur nächsten Listenantwort
  // nichts — keine Schleife.
  const luecke = verlaufLuecke(pegelQuery.data ?? [], verlaufQuery.data);
  const { refetch: verlaufNeuLaden } = verlaufQuery;
  useEffect(() => {
    if (luecke) void verlaufNeuLaden();
  }, [pegelQuery.dataUpdatedAt, luecke, verlaufNeuLaden]);

  if (einsatzQuery.isLoading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const pegel = pegelQuery.data ?? [];
  const zuDenEinstellungen = () => navigate(einsatzEinstellungenPfad(einsatzId, 'pegel'));
  const pegelZustand: PaneelDatenzustand =
    paneelZustand(pegelQuery) === 'daten' && pegel.length === 0
      ? 'leer'
      : paneelZustand(pegelQuery);
  const warnungen = wetterQuery.data?.warnungen;
  // Aus derselben gefilterten Menge wie das Paneel: eine seit dem letzten Abruf abgelaufene
  // Warnung zählt nicht mehr mit.
  const warnLage =
    warnungen?.zustand === 'ok' ? teileWarnungen(warnungen.daten ?? [], jetzt) : null;
  const warnAnzahl = warnLage ? warnLage.giltJetzt.length + warnLage.angekuendigt.length : null;

  return (
    <EinsatzSeite
      titel="Wetter & Pegel"
      meta={[
        pegelQuery.data ? `${pegel.length} Pegel` : null,
        warnAnzahl != null ? warnungenMeta(warnAnzahl) : null,
      ]
        .filter(Boolean)
        .join(' · ')}
      dataUpdatedAt={gemeinsamerDatenstand(pegelQuery.dataUpdatedAt, wetterQuery.dataUpdatedAt)}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: 'Wetter & Pegel' },
          ]}
        />
      }
      aktionen={
        <Button type="primary" onClick={zuDenEinstellungen}>
          Pegel festlegen
        </Button>
      }
    >
      <div
        data-lfh="wetter-pegel-raster"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))',
          gap: token.margin,
          alignItems: 'start',
        }}
      >
        <div style={{ gridColumn: '1 / -1', minWidth: 0 }}>
          <PegelPaneel
            zustand={pegelZustand}
            pegel={pegel}
            verlauf={verlaufQuery.isError ? null : verlaufQuery.data}
            jetzt={jetzt}
            konv={konv}
            onEinstellungen={zuDenEinstellungen}
            onNeuladen={() => {
              void pegelQuery.refetch();
              void verlaufQuery.refetch();
            }}
          />
        </div>
        <div style={{ minWidth: 0 }}>
          <WarnungenPaneel
            zustand={paneelZustand(wetterQuery)}
            wetter={wetterQuery.data}
            jetzt={jetzt}
            konv={konv}
            onNeuladen={() => void wetterQuery.refetch()}
            onEinsatzdaten={() => navigate(einsatzdatenPfad(einsatzId))}
          />
        </div>
        <div style={{ minWidth: 0 }}>
          <VorhersagePaneel
            zustand={paneelZustand(wetterQuery)}
            wetter={wetterQuery.data}
            jetzt={jetzt}
            konv={konv}
            onNeuladen={() => void wetterQuery.refetch()}
          />
        </div>
      </div>
    </EinsatzSeite>
  );
}
