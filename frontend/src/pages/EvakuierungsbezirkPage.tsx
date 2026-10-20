import { Breadcrumb, Button, Space } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { ladeEinsatz } from '../api/einsaetze';
import { ladeEvakuierung } from '../api/evakuierung';
import { einsatzKeys } from '../api/queryKeys';
import type { Evakuierungsbezirk } from '../api/types';
import BezirkGebiet from '../betreuung/BezirkGebiet';
import BezirkKennzahlen from '../betreuung/BezirkKennzahlen';
import BezirkStammdaten from '../betreuung/BezirkStammdaten';
import BezirkStandlinie from '../betreuung/BezirkStandlinie';
import MeldeVerlauf from '../betreuung/MeldeVerlauf';
import { raeumungPlan, type RaeumungSchritt } from '../betreuung/raeumungSchritte';
import { useBezirkHandlungen } from '../betreuung/useBezirkHandlungen';
import EinsatzSeite from '../components/EinsatzSeite';
import { MenueAusloeser, type MenueEintrag } from '../components/MenueAusloeser';
import { SeitenFehler, SeitenSkeleton, SeitenStandVeraltet } from '../components/SeitenZustand';
import { SeitenHinweise, SpeicherFehler } from '../components/SpeicherHinweis';
import StatusTag from '../components/StatusTag';
import { Paneel, useRollen } from '../components/instrument';
import { einsatzRechteGrund } from '../components/nurAnsicht';
import { useViewport } from '../components/useViewport';
import { modulName } from '../einsatz/modulRegistry';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useSprungSperre } from '../einsatz/useSprungSperre';
import { evakuierungPfad, parseRouteId } from '../routing/deeplinks';
import { raeumungszustand } from '../theme/statusFarben';

/** Schlüssel eines Menüeintrags im Kopf: ein Räumungsschritt (`raeumung:<ziel>`) oder `stornieren`. */
type MenueAktion = string;

/**
 * Detailseite eines Evakuierungsbezirks (LLH-1076, Item-Route `…/evakuierung/:bezirkId`): was mit
 * DIESEM Bezirk ist — Anordnung, Stand, Gebiet, Stammdaten, Verlauf — an einer Stelle statt auf
 * Tabellenzeile, Aufklappbereich und vier Dialoge verteilt.
 *
 * - Gelesen wird aus der Übersicht `GET …/evakuierung` (kein Einzel-Endpunkt, die Listenform trägt
 *   jedes Feld; design.md D1). Ungültige, unbekannte, fremde oder stornierte Kennung → zurück zur
 *   Übersicht (`replace`).
 * - Kopf (D3): genau eine Primäraktion „Stand melden“, daneben höchstens EIN Räumungsschritt und
 *   „Bearbeiten“, die übrigen Schritte samt Rückwegen im Menü, rot abgesetzt „Anordnung aufheben“
 *   (Rückfrage) und „Stornieren“. Handlungen und Dialoge nur über `useBezirkHandlungen`.
 * - Ohne Schreibrecht: alles lesbar, kein Kopf-Plan, der Hinweis über der Seite nennt den Grund;
 *   der Sprung auf die Lagekarte bleibt (ein Sprung ist Lesen).
 * - Bearbeiten in der Ansicht (D6): während der Sitzung steht kein Kopf-Plan, Speichern und
 *   Abbrechen tragen die Leiste im Formular.
 */
export default function EvakuierungsbezirkPage() {
  const { id, bezirkId: bezirkParam } = useParams();
  const einsatzId = Number(id);
  const bezirkId = parseRouteId(bezirkParam);
  const { token } = useRollen();
  const { istSchmal } = useViewport();

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const evakuierungQuery = useQuery({
    queryKey: einsatzKeys.evakuierung(einsatzId),
    queryFn: () => ladeEvakuierung(einsatzId),
    enabled: bezirkId != null,
  });
  const darfSchreiben = einsatzQuery.data ? darfImEinsatzSchreiben(einsatzQuery.data) : false;
  const bezirke = useMemo(() => evakuierungQuery.data?.bezirke ?? [], [evakuierungQuery.data]);
  const bezirk = bezirke.find((b) => b.id === bezirkId) ?? null;
  const handlungen = useBezirkHandlungen({ einsatzId, bezirke, darfSchreiben });
  const karteGesperrt = useSprungSperre(einsatzId)('lagekarte');

  // Bearbeiten-Sitzung: der Stand beim Öffnen, eingefroren (dreiseitiger PATCH, design.md D6).
  // `sitzungNr` montiert das Formular je Sitzung frisch.
  const [beimOeffnen, setBeimOeffnen] = useState<Evakuierungsbezirk | null>(null);
  const [sitzungNr, setSitzungNr] = useState(0);
  const { reset: stammdatenReset } = handlungen.stammdaten;
  // Die Route hat keinen `key`: der Wechsel zu einem anderen Bezirk nimmt keine Sitzung mit.
  useEffect(() => {
    setBeimOeffnen(null);
    stammdatenReset();
  }, [bezirkId, stammdatenReset]);

  const uebersicht = evakuierungPfad(einsatzId);
  if (bezirkId == null) return <Navigate to={uebersicht} replace />;
  if (einsatzQuery.isLoading || evakuierungQuery.isLoading) return <SeitenSkeleton />;
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Einsatz nicht gefunden oder kein Zugriff"
        ursache={einsatzQuery.error}
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }
  if (evakuierungQuery.data == null) {
    return (
      <SeitenFehler
        text="Evakuierung konnte nicht geladen werden"
        ursache={evakuierungQuery.error}
        onWiederholen={() => void evakuierungQuery.refetch()}
      />
    );
  }
  // Unbekannt, fremd oder storniert (die Übersicht führt nur nicht stornierte Bezirke): zurück.
  if (!bezirk) return <Navigate to={uebersicht} replace />;

  const einsatz = einsatzQuery.data;
  const bearbeiten = beimOeffnen != null;
  const veraltet = evakuierungQuery.isError;
  const plan = raeumungPlan(bezirk.raeumung);
  const zeigeKopf = darfSchreiben && !bearbeiten;

  const menue: MenueEintrag<MenueAktion>[] = [
    ...plan.menue.map((s) => ({ key: s.key, label: s.label })),
    ...(plan.aufheben
      ? [{ key: plan.aufheben.key, label: plan.aufheben.label, gefahr: true as const }]
      : []),
    { key: 'stornieren', label: 'Stornieren', gefahr: true as const },
  ];
  const schritte: RaeumungSchritt[] = [
    ...(plan.knopf ? [plan.knopf] : []),
    ...plan.menue,
    ...(plan.aufheben ? [plan.aufheben] : []),
  ];
  const waehle = (key: MenueAktion) => {
    if (key === 'stornieren') {
      handlungen.bezirkAktion('stornieren', bezirk);
      return;
    }
    const s = schritte.find((x) => x.key === key);
    if (s) handlungen.setzeRaeumung(bezirk, s.ziel);
  };
  const starteBearbeiten = () => {
    handlungen.stammdaten.reset();
    setBeimOeffnen(bezirk);
    setSitzungNr((n) => n + 1);
  };

  const fehlerOben = handlungen.raeumungFehler ?? null;

  return (
    <EinsatzSeite
      titel={
        <Space wrap size={8}>
          <span>{`Bezirk ${bezirk.bezeichnung}`}</span>
          <StatusTag darstellung={raeumungszustand[bezirk.raeumung]} />
        </Space>
      }
      dataUpdatedAt={evakuierungQuery.dataUpdatedAt}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: <Link to={uebersicht}>{modulName('evakuierung')}</Link> },
            { title: bezirk.bezeichnung },
          ]}
        />
      }
      aktionen={
        zeigeKopf && (
          <Space wrap size="middle">
            <Button type="primary" onClick={() => handlungen.oeffneStand(bezirk)}>
              Stand melden
            </Button>
            {plan.knopf && (
              <Button
                loading={handlungen.raeumungLaeuft === plan.knopf.ziel}
                onClick={() => handlungen.setzeRaeumung(bezirk, plan.knopf!.ziel)}
              >
                {plan.knopf.label}
              </Button>
            )}
            <Button onClick={starteBearbeiten}>Bearbeiten</Button>
            <MenueAusloeser
              eintraege={menue}
              laeuft={
                handlungen.raeumungLaeuft != null && handlungen.raeumungLaeuft !== plan.knopf?.ziel
              }
              zugaenglicherName={`Weitere Aktionen zu Bezirk ${bezirk.bezeichnung}`}
              onWahl={waehle}
            />
          </Space>
        )
      }
      hinweis={
        (!darfSchreiben || fehlerOben != null || handlungen.ruecknahmeFehler != null) && (
          <>
            <SeitenHinweise
              rechteFehlt={!darfSchreiben}
              rechteText={einsatzRechteGrund(einsatz.status)}
              fehler={fehlerOben}
              fehlerTitel="Räumung nicht geändert"
            />
            <SpeicherFehler
              fehler={handlungen.ruecknahmeFehler}
              titel="Meldung konnte nicht zurückgenommen werden"
            />
          </>
        )
      }
    >
      {veraltet && <SeitenStandVeraltet onWiederholen={() => void evakuierungQuery.refetch()} />}
      <BezirkKennzahlen bezirk={bezirk} />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: istSchmal
            ? 'minmax(0, 1fr)'
            : 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: token.marginLG,
          alignItems: 'start',
          marginBottom: token.marginLG,
        }}
      >
        <BezirkStammdaten
          key={sitzungNr}
          bezirk={bezirk}
          beimOeffnen={beimOeffnen}
          abschnitte={handlungen.abschnitte}
          laeuft={handlungen.stammdaten.laeuft}
          fehler={handlungen.stammdaten.fehler}
          onSpeichern={(patch) => handlungen.speichereStammdaten(bezirk.id, patch)}
          onBeenden={() => setBeimOeffnen(null)}
        />
        <BezirkGebiet einsatzId={einsatzId} bezirk={bezirk} karteGesperrt={karteGesperrt} />
      </div>
      <Paneel titel="Standverlauf" koerperPolster>
        <BezirkStandlinie einsatzId={einsatzId} bezirkId={bezirk.id} plan={bezirk.plan_personen} />
        <MeldeVerlauf
          einsatzId={einsatzId}
          art="bezirk"
          objektId={bezirk.id}
          darfZuruecknehmen={darfSchreiben}
        />
      </Paneel>
      {handlungen.dialoge}
    </EinsatzSeite>
  );
}
