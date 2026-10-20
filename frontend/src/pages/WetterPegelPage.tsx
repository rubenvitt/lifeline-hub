import { Alert, Breadcrumb, Spin } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
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
import PegelPaneel, { PegelLeerzeile } from '../wetter/PegelPaneel';
import { AktuellPaneel, VorhersagePaneel, WarnungenPaneel } from '../wetter/WetterPaneele';
import { teileWarnungen } from '../wetter/wetterStand';
import { modulName } from '../einsatz/modulRegistry';

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
 * Fachmodul „Wetter & Pegel" (LFH-633): was Wetter und Wasser am Einsatzort tun.
 *
 * Vier Paneele, vier Stände: Warnungen, Pegel, aktuelle Bedingungen (LFH-864) und Vorhersage kommen
 * aus zwei Quellen (PEGELONLINE, Bright Sky) und tragen je ihren Stand. Fällt ein Teil aus, zeigt
 * nur sein Paneel „Stand unbekannt". Der Seitenkopf zeigt den ältesten Abruf
 * (`gemeinsamerDatenstand`).
 *
 * Reihenfolge (LLH-1117, Spec `lage-wetter-pegel`, „Reihenfolge der Modulseite"): Wetter betrifft
 * fast jede Lage, ein Pegel führt nur in einer Hochwasserlage. Amtliche Warnungen stehen immer
 * vorn. Mit festgelegtem Pegel folgt das Pegel-Paneel, dann Bedingungen und Vorhersage; ohne
 * stehen Bedingungen und Vorhersage direkt nach den Warnungen und der Pegel als EINE Zeile zuletzt.
 * „Festgelegt" ist die Entscheidung am Einsatz (`lagekennzahlen`, wie die Kennzahlreihe des
 * Lagebilds, LFH-640), nicht die Pegelliste: der Einsatz ist zuerst da, die Reihenfolge flackert
 * nicht beim Laden. Der Zuschnitt hält beim Betrachten (siehe `zuschnitt`).
 *
 * Leseseite: gepflegt wird in Einstellungen › Pegel. Der Weg dorthin ist ein Nebenweg im Kopf
 * (`weitere`, LFH-963), keine Primäraktion; diese Seite schreibt nichts und braucht keinen
 * Rechte-Hinweis.
 *
 * Kein Live-Ereignis: alle drei Abfragen (Pegel, Verlauf, Wetter) fragen alle 5 min nach. Die Uhr (30 s) lässt „veraltet"
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

  /*
   * Der Zuschnitt (mit oder ohne Pegel-Paneel vorn), mit dem die Seite für diesen Einsatz aufgebaut
   * wurde — Muster der Kennzahlreihe im Lagebild, im Render angeglichen, nicht per Effekt. Gesetzt
   * erst, wenn kein Einsatz-Abruf mehr läuft (wer gerade einen Pegel festgelegt hat und herwechselt,
   * findet sonst den alten Einsatz im Speicher). Danach hält er: legt jemand währenddessen einen
   * Pegel fest, springt nichts unter dem Blick — das volle Paneel erscheint an der Stelle der Zeile,
   * ganz unten. Beim nächsten Öffnen gilt der neue Zuschnitt.
   */
  const pegelFestgelegt = einsatzQuery.data
    ? einsatzQuery.data.lagekennzahlen.includes('pegel')
    : null;
  const [zuschnitt, setZuschnitt] = useState<{ einsatzId: number; mitPegel: boolean } | null>(null);
  if (pegelFestgelegt != null && !einsatzQuery.isFetching && zuschnitt?.einsatzId !== einsatzId) {
    setZuschnitt({ einsatzId, mitPegel: pegelFestgelegt });
  }
  const mitPegel =
    zuschnitt?.einsatzId === einsatzId ? zuschnitt.mitPegel : (pegelFestgelegt ?? false);

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
  const zelle = { minWidth: 0 };
  const volleBreite = { gridColumn: '1 / -1', minWidth: 0 };
  const pegelPaneel = (
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
  );

  return (
    <EinsatzSeite
      titel={modulName('wetter-pegel')}
      // Wetter vorn; „0 Pegel" ist ohne Hochwasserlage nur Rauschen.
      meta={[
        warnAnzahl != null ? warnungenMeta(warnAnzahl) : null,
        pegel.length > 0 ? `${pegel.length} Pegel` : null,
      ]
        .filter(Boolean)
        .join(' · ')}
      dataUpdatedAt={gemeinsamerDatenstand(pegelQuery.dataUpdatedAt, wetterQuery.dataUpdatedAt)}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: modulName('wetter-pegel') },
          ]}
        />
      }
      weitere={{
        name: 'Weitere Aktionen zu Wetter & Pegel',
        eintraege: [{ key: 'pegel', label: 'Pegel festlegen', onWahl: zuDenEinstellungen }],
      }}
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
        <div style={volleBreite}>
          <WarnungenPaneel
            zustand={paneelZustand(wetterQuery)}
            wetter={wetterQuery.data}
            jetzt={jetzt}
            konv={konv}
            onNeuladen={() => void wetterQuery.refetch()}
            onEinsatzdaten={() => navigate(einsatzdatenPfad(einsatzId))}
          />
        </div>
        {mitPegel && <div style={volleBreite}>{pegelPaneel}</div>}
        <div style={zelle}>
          <AktuellPaneel
            zustand={paneelZustand(wetterQuery)}
            wetter={wetterQuery.data}
            jetzt={jetzt}
            konv={konv}
            onNeuladen={() => void wetterQuery.refetch()}
          />
        </div>
        <div style={zelle}>
          <VorhersagePaneel
            zustand={paneelZustand(wetterQuery)}
            wetter={wetterQuery.data}
            jetzt={jetzt}
            konv={konv}
            onNeuladen={() => void wetterQuery.refetch()}
          />
        </div>
        {/* Ohne Entscheidung: eine Zeile — es sei denn, während des Lesens kam eine Liste. */}
        {!mitPegel && (
          <div style={volleBreite} data-lfh="pegel-leerzeile">
            {pegel.length > 0 ? (
              pegelPaneel
            ) : (
              <PegelLeerzeile onEinstellungen={zuDenEinstellungen} />
            )}
          </div>
        )}
      </div>
    </EinsatzSeite>
  );
}
