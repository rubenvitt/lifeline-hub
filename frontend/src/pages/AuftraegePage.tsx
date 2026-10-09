import { Alert, Breadcrumb, Spin, Tabs } from 'antd';
import { Link, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { einsatzKeys } from '../api/queryKeys';
import AuftraegeListe from '../auftraege/AuftraegeListe';
import BefehlListe from '../auftraege/BefehlListe';
import EinsatzSeite from '../components/EinsatzSeite';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import { parseAuftraegeReiter } from '../routing/deeplinks';
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
