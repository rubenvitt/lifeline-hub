import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Alert, Breadcrumb, Button, Typography, theme } from 'antd';
import { ladeEinsatz } from '../api/einsaetze';
import { listeEinheiten } from '../api/einheiten';
import { ApiError } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { taktischeDtgVoll } from '../anzeige/format';
import EinsatzSeite from '../components/EinsatzSeite';
import { SeitenFehler, SeitenSkeleton } from '../components/SeitenZustand';
import Druckkopf from '../components/druck/Druckkopf';
import DruckKnopf from '../components/druck/DruckKnopf';
import { ladeEtbVollstaendig } from '../etb/druckAbruf';
import { auswahlZeilen } from '../etb/druckAuswahl';
import EtbDruckTabelle from '../etb/EtbDruckTabelle';
import { etbPfad, parseEtbFilter } from '../routing/deeplinks';
import { etbTyp } from '../theme/statusFarben';

/** „1 200 Einträge" — Tausender mit geschütztem Leerzeichen, Einzahl bei genau einem. */
function umfang(anzahl: number): string {
  const zahl = String(anzahl).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${zahl} ${anzahl === 1 ? 'Eintrag' : 'Einträge'}`;
}

/**
 * ETB-Druckansicht (LFH-22, design.md D5): das Einsatztagebuch für Papier und PDF über den
 * Druckdialog des Browsers — kein Server-PDF.
 *
 * VOLLSTÄNDIG ODER GAR NICHT: Die Seite lädt ALLE Einträge der Auswahl
 * (`etb/druckAbruf.ts`, Cursor-Schleife über die bestehende Liste — dieselben Gates,
 * derselbe Filter wie am Bildschirm). Solange nicht alles da ist oder wenn ein Teilabruf
 * scheitert, ist „Drucken" gesperrt. Ein Teilausdruck wäre eine falsche Beweisunterlage.
 *
 * SCHNAPPSCHUSS: Der Stand ist der des Ladens (`einsatzKeys.etbDruck` ist nicht live, kein
 * Nachladen bei Fokus). Neue Einträge schiebt niemand still dazu; „Neu laden" holt sie.
 *
 * Der Filter kommt aus der Adresse (`parseEtbFilter`), ein unbekannter Wert fällt dort GANZ
 * weg und steht dann auch nicht im Kopf. Die Sperre setzt der Server durch: ein 403 der
 * Liste heißt „kein Zugriff", ohne Druckknopf.
 */
export default function EtbDruckPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const { konventionen } = useAnzeigeKonventionen();
  const [searchParams] = useSearchParams();
  // Über den STRING memoisiert, nicht über die Instanz (Begründung in `EtbPage`).
  const filterText = searchParams.toString();
  const filter = useMemo(() => parseEtbFilter(new URLSearchParams(filterText)), [filterText]);
  const [geladen, setGeladen] = useState(0);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  // Nur für den Namen einer gefilterten Einheit. Ohne Modulzugang (403) bleibt der Name
  // weg — der Kopf sagt dann „eine Einheit (Name nicht verfügbar)", nie die Kennung.
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
    enabled: filter.einheit_id != null,
    retry: false,
  });
  const druckQuery = useQuery({
    queryKey: einsatzKeys.etbDruck(einsatzId, filter),
    queryFn: () => {
      setGeladen(0);
      return ladeEtbVollstaendig(einsatzId, filter, { onFortschritt: setGeladen });
    },
    // Ein Druckbeleg ist ein Schnappschuss (NICHT_LIVE_KEYS): kein stilles Nachladen.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // Ein gescheiterter Abruf wird nicht still wiederholt — die Person entscheidet.
    retry: false,
  });

  if (einsatzQuery.isLoading) return <SeitenSkeleton />;
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Einsatz nicht gefunden oder kein Zugriff"
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }
  const einsatz = einsatzQuery.data;
  const keinZugriff = druckQuery.error instanceof ApiError && druckQuery.error.status === 403;
  const stand = druckQuery.data;

  const auswahl = auswahlZeilen(filter, {
    konventionen,
    typWort: (t) => etbTyp[t].label,
    einheitName: (eid) => einheitenQuery.data?.find((e) => e.id === eid)?.name,
  });

  const zurueck = etbPfad(einsatzId, filter);

  return (
    <EinsatzSeite
      titel="ETB – Druckansicht"
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: <Link to={zurueck}>Einsatztagebuch</Link> },
            { title: 'Druckansicht' },
          ]}
        />
      }
      aktionen={
        <>
          <Button
            href={zurueck}
            onClick={(e) => {
              // Ein Link mit Knopfgestalt: Strg/⌘+Klick öffnet den neuen Tab wie jeder Link.
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              navigate(zurueck);
            }}
          >
            Zurück zum ETB
          </Button>
          {!keinZugriff && (
            <Button onClick={() => void druckQuery.refetch()} disabled={druckQuery.isFetching}>
              Neu laden
            </Button>
          )}
          {!keinZugriff && (
            <DruckKnopf
              typ="primary"
              // Gesperrt, bis ALLES da ist — auch der Einheitenname für den Kopf, sonst
              // stünde „Name nicht verfügbar" auf einem Blatt, dessen Name gleich käme.
              gesperrt={
                !druckQuery.isSuccess ||
                druckQuery.isFetching ||
                (filter.einheit_id != null && einheitenQuery.isLoading)
              }
            />
          )}
        </>
      }
    >
      {keinZugriff ? (
        <Alert
          type="info"
          showIcon
          title="Kein Zugriff auf das Einsatztagebuch"
          description="Das Modul ist für Sie gesperrt oder die Aufbewahrungsfrist des Einsatzes ist abgelaufen. Es gibt nichts zu drucken."
        />
      ) : druckQuery.isError ? (
        <Alert
          type="error"
          showIcon
          title="Das Tagebuch konnte nicht vollständig geladen werden"
          description="Drucken bleibt gesperrt, bis alle Einträge der Auswahl da sind — ein Teilausdruck ist ausgeschlossen."
          action={<Button onClick={() => void druckQuery.refetch()}>Erneut laden</Button>}
        />
      ) : !stand || druckQuery.isFetching ? (
        <Typography.Text role="status" aria-live="polite">
          {umfang(geladen)} geladen …
        </Typography.Text>
      ) : (
        <div className="etb-druck-root" data-lfh="druckwurzel">
          <Druckkopf
            dokumentart="Einsatztagebuch"
            einsatz={einsatz}
            sichtbarkeit="immer"
            // Am Bildschirm steht darüber der Seitenkopf mit dem `h1`.
            ebene={2}
            zeilen={[
              { etikett: 'Auswahl', wert: auswahl.join(' · ') },
              { etikett: 'Umfang', wert: umfang(stand.eintraege.length) },
              {
                etikett: 'Stand',
                wert:
                  stand.hoechsteLfdNr != null
                    ? `${taktischeDtgVoll(stand.geladenAt, konventionen)} · bis Nr. ${stand.hoechsteLfdNr}`
                    : taktischeDtgVoll(stand.geladenAt, konventionen),
              },
            ]}
          />
          {stand.eintraege.length === 0 ? (
            <Typography.Paragraph style={{ marginBlockStart: token.margin }}>
              Keine Einträge in dieser Auswahl
            </Typography.Paragraph>
          ) : (
            <EtbDruckTabelle
              eintraege={stand.eintraege}
              berichtigungen={stand.berichtigungen}
              konventionen={konventionen}
            />
          )}
        </div>
      )}
    </EinsatzSeite>
  );
}
