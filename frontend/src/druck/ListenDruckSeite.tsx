import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Alert, Breadcrumb, Button, Typography, theme } from 'antd';
import { ladeEinsatz } from '../api/einsaetze';
import { ApiError } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { taktischeDtgVoll } from '../anzeige/format';
import EinsatzSeite from '../components/EinsatzSeite';
import { SeitenFehler, SeitenSkeleton } from '../components/SeitenZustand';
import Druckkopf from '../components/druck/Druckkopf';
import DruckKnopf from '../components/druck/DruckKnopf';

/**
 * Was der Rahmen von der Abfrage der Seite braucht — eine Teilmenge von `UseQueryResult`. Die
 * Seite reicht die Felder einzeln weiter, nicht das Ergebnisobjekt: `useQuery` beobachtet nur die
 * Felder, die die Seite selbst beim Rendern liest.
 */
export interface ListenDruckAbfrage {
  isSuccess: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

interface Props {
  einsatzId: number;
  /** Name des Moduls wie in der Navigation: „Betroffene", „Tiere", „Schäden". */
  modul: string;
  zurueckPfad: string;
  /** Dokumentart im Druckkopf: „Betroffenenliste", „Tierliste", „Schadensliste". */
  dokumentart: string;
  abfrage: ListenDruckAbfrage;
  /** Geladener Stand; `anzahl` zählt die Datensätze NACH dem Seitenfilter. */
  stand?: { geladenAt: string; anzahl: number };
  /** Kopfzeile „Auswahl" in Worten. */
  auswahl: string;
  /** „3 Personen" — Einzahl und Mehrzahl kennt nur die Seite. */
  umfang: (anzahl: number) => string;
  /**
   * Hinweis am Bildschirm über der Druckwurzel (Personen: Protokoll), in jedem Zustand außer
   * „kein Zugriff". Nie auf Papier.
   */
  hinweis?: ReactNode;
  /** Die Tabelle der Seite; erscheint nur bei mindestens einem Datensatz. */
  children: ReactNode;
}

/**
 * Seitenrahmen der Druckansichten der Modul-Listen (LFH-727,
 * `openspec/changes/archive/2026-10-01-lfh-727-druck-modul-listen/design.md` D3). Vorbild ist `EtbDruckPage`: die
 * Zustände Laden, Fehler, kein Zugriff und leere Auswahl, genau eine Druckwurzel mit dem am
 * Bildschirm sichtbaren Druckkopf, „Drucken" gesperrt, bis der Stand vollständig da ist — ein
 * Teilausdruck wäre eine falsche Übergabeunterlage.
 *
 * Die Seite liefert Abfrage, Auswahl in Worten und Tabelle; Laden und Filtern bleiben bei ihr.
 */
export default function ListenDruckSeite({
  einsatzId,
  modul,
  zurueckPfad,
  dokumentart,
  abfrage,
  stand,
  auswahl,
  umfang,
  hinweis,
  children,
}: Props) {
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const { konventionen } = useAnzeigeKonventionen();
  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
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
  const keinZugriff = abfrage.error instanceof ApiError && abfrage.error.status === 403;

  return (
    <EinsatzSeite
      titel={`${modul} – Druckansicht`}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: <Link to={zurueckPfad}>{modul}</Link> },
            { title: 'Druckansicht' },
          ]}
        />
      }
      aktionen={
        <>
          <Button
            href={zurueckPfad}
            onClick={(e) => {
              // Ein Link mit Knopfgestalt: Strg/⌘+Klick öffnet den neuen Tab wie jeder Link.
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              navigate(zurueckPfad);
            }}
          >
            {`Zurück zu ${modul}`}
          </Button>
          {!keinZugriff && (
            <Button onClick={() => void abfrage.refetch()} disabled={abfrage.isFetching}>
              Neu laden
            </Button>
          )}
          {!keinZugriff && (
            <DruckKnopf typ="primary" gesperrt={!abfrage.isSuccess || abfrage.isFetching} />
          )}
        </>
      }
    >
      {/* Vor dem Zustandsschalter: der Protokolleintrag entsteht beim Abruf, also schon beim Laden
          und auch dann, wenn danach etwas scheitert. Ohne Zugriff entsteht keiner. */}
      {hinweis && !keinZugriff && (
        <Typography.Paragraph type="secondary" data-testid="druck-hinweis">
          {hinweis}
        </Typography.Paragraph>
      )}
      {keinZugriff ? (
        <Alert
          type="info"
          showIcon
          title={`Kein Zugriff auf ${modul}`}
          description="Das Modul ist für Sie gesperrt oder die Aufbewahrungsfrist des Einsatzes ist abgelaufen. Es gibt nichts zu drucken."
        />
      ) : abfrage.isError ? (
        <Alert
          type="error"
          showIcon
          title="Die Liste konnte nicht geladen werden"
          description="Drucken bleibt gesperrt, bis die Auswahl vollständig da ist — ein Teilausdruck ist ausgeschlossen."
          action={<Button onClick={() => void abfrage.refetch()}>Erneut laden</Button>}
        />
      ) : !stand || abfrage.isFetching ? (
        <Typography.Text role="status" aria-live="polite">
          Liste wird geladen …
        </Typography.Text>
      ) : (
        <div data-lfh="druckwurzel">
          <Druckkopf
            dokumentart={dokumentart}
            einsatz={einsatz}
            sichtbarkeit="immer"
            // Am Bildschirm steht darüber der Seitenkopf mit dem `h1`.
            ebene={2}
            zeilen={[
              { etikett: 'Auswahl', wert: auswahl },
              { etikett: 'Umfang', wert: umfang(stand.anzahl) },
              { etikett: 'Stand', wert: taktischeDtgVoll(stand.geladenAt, konventionen) },
            ]}
          />
          {stand.anzahl === 0 ? (
            <Typography.Paragraph style={{ marginBlockStart: token.margin }}>
              Keine Einträge in dieser Auswahl
            </Typography.Paragraph>
          ) : (
            children
          )}
        </div>
      )}
    </EinsatzSeite>
  );
}
