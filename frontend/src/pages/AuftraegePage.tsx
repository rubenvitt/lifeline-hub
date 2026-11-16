import { Breadcrumb, Tabs } from 'antd';
import { Link, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { einsatzKeys } from '../api/queryKeys';
import AuftraegeListe from '../auftraege/AuftraegeListe';
import BefehlListe from '../auftraege/BefehlListe';
import EinsatzSeite from '../components/EinsatzSeite';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import { SeitenFehler, SeitenSkeleton } from '../components/SeitenZustand';
import { parseAuftraegeReiter } from '../routing/deeplinks';
import { useLinkAuftrag } from '../routing/useLinkAuftrag';
import { modulName } from '../einsatz/modulRegistry';

export default function AuftraegePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  // Der Reiter ist Zustand der Adresse (`auftraegePfad`, `reiter`): Brotkrume und Browser-Zurück
  // aus einem Befehl landen so auf „Einsatzbefehle", nicht auf der Vorgabe.
  const [searchParams, setSearchParams] = useSearchParams();
  const reiter = parseAuftraegeReiter(searchParams);
  const reiterWechseln = (neu: string) =>
    setSearchParams(
      (alt) => {
        const naechste = new URLSearchParams(alt);
        if (neu === 'befehle') naechste.set('reiter', 'befehle');
        else naechste.delete('reiter');
        return naechste;
      },
      // Kein History-Eintrag je Reiterwechsel: Zurück führt aus der Seite, nicht durch die Reiter.
      { replace: true },
    );

  // Grund einer abgelehnten Rücknahme aus dem Rückgängig-Toast der Einzelaufträge: die Karte ist
  // dann oft nicht mehr zu sehen, der Grund steht im Hinweis der Seite (LFH-1077).
  const [seitenFehler, setSeitenFehler] = useState<unknown>(null);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });

  // Schnellaktion „Auftrag erteilen“ (Sprungpalette): ?neu=1 öffnet den Dialog der Einzelaufträge.
  // Gelesen HIER, nicht in der Liste: der Guard der Schnellaktionen ordnet Leser über den
  // Dateinamen ihrem Modul zu. Muster wie `TierePage`: erst nach dem Laden des Einsatzes
  // entscheiden, immer räumen, einmal je Verlaufseintrag (`useLinkAuftrag`, LLH-1558).
  const neuAuftrag = useLinkAuftrag();
  const [erteilenAngefordert, setErteilenAngefordert] = useState(false);
  const darfSchreibenRoh = darfImEinsatzSchreiben(einsatzQuery.data);
  useEffect(() => {
    if (searchParams.get('neu') !== '1') return;
    if (neuAuftrag.verbraucht()) return;
    if (einsatzQuery.isLoading) return;
    if (darfSchreibenRoh) setErteilenAngefordert(true);
    neuAuftrag.raeume('neu');
  }, [searchParams, neuAuftrag, einsatzQuery.isLoading, darfSchreibenRoh]);

  // Seitenzustände wie die Nachbarseiten (oxgob5gk D11): Skelett statt Spinner, Fehler mit Ursache.
  if (einsatzQuery.isLoading) return <SeitenSkeleton />;
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Einsatz nicht gefunden oder kein Zugriff"
        ursache={einsatzQuery.error}
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz);

  return (
    // Titel und Ortspfad trägt der Seitenkopf; Mengen, Datenstand und Anlegen-Aktion
    // gehören dem jeweiligen Reiter (`Bereichskopf`) — die zwei Bereiche zählen Verschiedenes.
    <EinsatzSeite
      titel={modulName('auftraege')}
      // Nur mit Inhalt gesetzt: ein leerer Slot rendert in `EinsatzSeite` trotzdem seinen Rahmen.
      hinweis={
        seitenFehler != null && (
          <SeitenHinweise
            fehler={seitenFehler}
            fehlerTitel="Nicht zurückgenommen"
            fehlerFallback="Rücknahme fehlgeschlagen"
          />
        )
      }
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: modulName('auftraege') },
          ]}
        />
      }
    >
      <Tabs
        activeKey={reiter}
        onChange={reiterWechseln}
        items={[
          // Die Reiternamen grenzen die zwei Objekte ab (LFH-972, LFH-1078): ein Einzelauftrag geht
          // an einen Empfänger und wird quittiert und vollzogen, ein Einsatzbefehl ist ein Dokument
          // mit Fassungen und Freigabe. Kein Erklärsatz darunter.
          {
            key: 'auftraege',
            label: 'Einzelaufträge',
            children: (
              <AuftraegeListe
                einsatzId={einsatzId}
                darfSchreiben={darfSchreiben}
                onSeitenFehler={setSeitenFehler}
                erteilenAngefordert={erteilenAngefordert}
                onErteilenAngenommen={() => setErteilenAngefordert(false)}
              />
            ),
          },
          {
            key: 'befehle',
            label: 'Einsatzbefehle',
            children: <BefehlListe einsatzId={einsatzId} darfSchreiben={darfSchreiben} />,
          },
        ]}
      />
    </EinsatzSeite>
  );
}
