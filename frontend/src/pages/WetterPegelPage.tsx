import { Alert, Breadcrumb, Button, Spin } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { ladeEinsatz } from '../api/einsaetze';
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

/** Datenzustand eines Paneels aus einer Abfrage (`leer` entscheidet der Aufrufer). */
function paneelZustand(q: { isLoading: boolean; isError: boolean }): PaneelDatenzustand {
  if (q.isLoading) return 'laden';
  if (q.isError) return 'fehler';
  return 'daten';
}

/**
 * Fachmodul „Wetter & Pegel" (LFH-633): was Wasser und Wetter am Einsatzort tun.
 *
 * DREI PANEELE, DREI STÄNDE (Spec „Datenstand und Quellausfall"): Pegel, Warnungen und
 * Vorhersage kommen aus zwei Quellen (PEGELONLINE, Bright Sky) und tragen je ihren eigenen
 * Stand. Fällt eine aus, zeigt nur ihr Paneel „Stand unbekannt" — die anderen bleiben stehen.
 * Der Seitenkopf zeigt den ältesten Abruf (`gemeinsamerDatenstand`).
 *
 * LESESEITE: gepflegt wird in Einstellungen › Pegel (Festlegen, Reihenfolge, Prognose). Die
 * Primäraktion im Kopf ÖFFNET dorthin (LFH-346: der Kopf-Slot trägt, was öffnet); diese Seite
 * schreibt nichts und braucht darum keinen Rechte-Hinweis — die Einstellungsseite nennt ihn
 * selbst.
 *
 * KEIN LIVE-EREIGNIS: alle drei Abfragen fragen alle 5 min nach. Die Uhr (30 s) lässt
 * „veraltet" auch ohne neuen Abruf umschlagen.
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
  const warnAnzahl = warnungen?.zustand === 'ok' ? (warnungen.daten ?? []).length : null;

  return (
    <EinsatzSeite
      titel="Wetter & Pegel"
      meta={[
        pegelQuery.data ? `${pegel.length} Pegel` : null,
        warnAnzahl != null ? `${warnAnzahl} Warnungen` : null,
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
