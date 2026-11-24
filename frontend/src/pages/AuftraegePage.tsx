import { Breadcrumb, theme } from 'antd';
import { Link, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { ladeEinsatz } from '../api/incidents';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { einsatzKeys } from '../api/queryKeys';
import AuftraegeListe from '../auftraege/AuftraegeListe';
import BefehlListe from '../auftraege/BefehlListe';
import EinsatzSeite from '../components/EinsatzSeite';
import { Segmentleiste } from '../components/instrument';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import { SeitenFehler } from '../components/SeitenZustand';
import { parseAuftraegeReiter } from '../routing/deeplinks';
import { useLinkAuftrag } from '../routing/useLinkAuftrag';
import { modulName } from '../einsatz/modulRegistry';
import { useAdressAenderung } from '../routing/useLinkAuftrag';
import { ModulGerippeSeite } from '../einsatz/ModulWechselGerippe';

export default function AuftraegePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  // Der Reiter ist Zustand der Adresse (`auftraegePfad`, `reiter`): Brotkrume und Browser-Zurück
  // aus einem Befehl landen so auf „Einsatzbefehle", nicht auf der Vorgabe.
  const [searchParams] = useSearchParams();
  const reiter = parseAuftraegeReiter(searchParams);
  const reiterflaecheId = useId();
  // Welche Fläche schon einmal offen war: sie bleibt danach montiert (siehe unten).
  const [besuchtListe, setBesuchtListe] = useState<readonly string[]>([reiter]);
  if (!besuchtListe.includes(reiter)) setBesuchtListe([...besuchtListe, reiter]);
  const besucht = {
    auftraege: besuchtListe.includes('auftraege'),
    befehle: besuchtListe.includes('befehle'),
  };
  const { token } = theme.useToken();
  // Kein History-Eintrag je Reiterwechsel (`replace`): Zurück führt aus der Seite, nicht durch die
  // Reiter. Über `useAdressAenderung` (LLH-1826), wie die Filter der Listen darunter.
  const aendereAdresse = useAdressAenderung();
  const reiterWechseln = (neu: string) =>
    aendereAdresse((naechste) => {
      if (neu === 'befehle') naechste.set('reiter', 'befehle');
      else naechste.delete('reiter');
    });

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
  if (einsatzQuery.isLoading) return <ModulGerippeSeite modulKey="auftraege" />;
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
      {/* Fläche umschalten: Segmentleiste als Reiter (Spec `bedien-umschalten`). Die Reiternamen
          grenzen die zwei Objekte ab (LFH-972, LFH-1078): ein Einzelauftrag geht an einen
          Empfänger und wird quittiert und vollzogen, ein Einsatzbefehl ist ein Dokument mit
          Fassungen und Freigabe. Kein Erklärsatz darunter. */}
      <Segmentleiste
        rolle="tablist"
        beschriftung="Aufträge und Befehle"
        wert={reiter}
        onWechsel={reiterWechseln}
        optionen={[
          { wert: 'auftraege', label: 'Einzelaufträge', steuert: `${reiterflaecheId}-auftraege` },
          { wert: 'befehle', label: 'Einsatzbefehle', steuert: `${reiterflaecheId}-befehle` },
        ]}
        style={{ marginBottom: token.margin }}
      />
      {/* Eine besuchte Fläche bleibt montiert und ist nur verborgen, wie vorher bei antds Tabs:
          Ansicht, Filter, Suche und Auswahl einer Liste überstehen den Wechsel zur anderen. */}
      <div
        role="tabpanel"
        id={`${reiterflaecheId}-auftraege`}
        aria-label="Einzelaufträge"
        hidden={reiter !== 'auftraege'}
      >
        {besucht.auftraege && (
          <AuftraegeListe
            einsatzId={einsatzId}
            darfSchreiben={darfSchreiben}
            onSeitenFehler={setSeitenFehler}
            erteilenAngefordert={erteilenAngefordert}
            onErteilenAngenommen={() => setErteilenAngefordert(false)}
          />
        )}
      </div>
      <div
        role="tabpanel"
        id={`${reiterflaecheId}-befehle`}
        aria-label="Einsatzbefehle"
        hidden={reiter !== 'befehle'}
      >
        {besucht.befehle && <BefehlListe einsatzId={einsatzId} darfSchreiben={darfSchreiben} />}
      </div>
    </EinsatzSeite>
  );
}
