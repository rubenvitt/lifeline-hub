import { useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Breadcrumb } from 'antd';
import { listeAbloesungVorgaben } from '../api/abloesungen';
import { ApiError } from '../api/client';
import { listeEinheiten } from '../api/einheiten';
import { ladeEinsatz } from '../api/einsaetze';
import { listeUhs } from '../api/einsatzUhs';
import { listeQualifikationen } from '../api/qualifikationen';
import { einsatzKeys } from '../api/queryKeys';
import { fetchSchichtplan } from '../api/schichtplan';
import { ausEinsatzPlan } from '../abloesung/schichtplan/ausgabe/ausEinsatzPlan';
import SchichtplanDruckInhalt from '../abloesung/schichtplan/ausgabe/SchichtplanDruckInhalt';
import { baueZeilen } from '../abloesung/schichtplan/schichtplanZeilen';
import EinsatzSeite from '../components/EinsatzSeite';
import { SeitenFehler, SeitenSkeleton } from '../components/SeitenZustand';
import { DRUCK_ABFRAGE } from '../druck/abfrageOptionen';
import { istKeyFreigegeben } from '../einsatz/modulRegistry';
import { useModulFreigabenStand } from '../einsatz/useSprungSperre';
import { abloesungPfad, schichtplanDruckPfad } from '../routing/deeplinks';

/** Ein 403 einer Nachbarliste heißt „Modul gesperrt“: dann fehlt sie, statt den Druck zu sperren. */
function ohneGesperrtesModul<T>(abruf: Promise<T>): Promise<T | undefined> {
  return abruf.catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 403) return undefined;
    throw e;
  });
}

/**
 * Druckansicht des Schichtplans (LLH-1557, Change `jwqanxja-schichtplan-ausgeben` D2): Aushang je
 * Posten oder Zettel je Person, alle Blätter oder eines. Vorbild ist die Ausgabe der Suite: oben die
 * Wahl, darunter die Blätter, wie sie aufs Papier kommen.
 *
 * Der Stand ist ein Schnappschuss (`schichtplanDruck`, nicht live): ein Ereignis darf das Blatt vor
 * dem Druck nicht still ändern, „Neu laden“ holt neu. Einheiten und UHS liefern nur Abschnitt und
 * Reihenfolge der Posten; ist ihr Modul gesperrt (auch per 403), stehen die Posten ohne Abschnitt.
 * Scheitert ein Abruf sonst, scheitert die ganze Ansicht (Ladefehler mit „Erneut laden“, kein
 * Druck): sonst stünde ein Blatt still ohne Abschnitt oder Qualifikation da.
 * Ohne Modul Personal liefert der Plan keine Namen: dann nur der Aushang mit der Besetzung als
 * Zahl.
 *
 * Wahl, Knöpfe, Hinweise und Blätter teilt die Seite mit der Vorplanung
 * (`abloesung/schichtplan/ausgabe/SchichtplanDruckInhalt.tsx`); hier stehen Rahmen und Laden.
 */
export default function SchichtplanDruckPage() {
  const { id } = useParams();
  const einsatzId = Number(id);

  // Einheiten und UHS nur abfragen, wenn ihr Modul frei ist. Sind die Freigaben unbekannt
  // (Abruf gescheitert), wird trotzdem gefragt; ein 403 heißt dann wie bei veralteten Freigaben:
  // Modul gesperrt, Posten ohne Abschnitt. Jeder andere Fehler scheitert sichtbar.
  const { freigaben, gescheitert, laedt: freigabenLaden } = useModulFreigabenStand(einsatzId);
  const einheitenFrei = freigaben == null || istKeyFreigegeben('einheiten', freigaben);
  const uhsFrei = freigaben == null || istKeyFreigegeben('unfallhilfsstellen', freigaben);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const druckQuery = useQuery({
    queryKey: einsatzKeys.schichtplanDruck(einsatzId),
    queryFn: async () => {
      const [plan, vorgaben, einheiten, uhs, qualifikationen] = await Promise.all([
        fetchSchichtplan(einsatzId),
        listeAbloesungVorgaben(einsatzId),
        einheitenFrei ? ohneGesperrtesModul(listeEinheiten(einsatzId)) : undefined,
        uhsFrei ? ohneGesperrtesModul(listeUhs(einsatzId)) : undefined,
        listeQualifikationen(),
      ]);
      return {
        plan,
        vorgaben,
        einheiten,
        uhs,
        qualifikationen,
        geladenAt: new Date().toISOString(),
      };
    },
    // Ein laufender Abruf der Freigaben (alter Stand im Cache) wird abgewartet.
    enabled: (freigaben != null || gescheitert) && !freigabenLaden,
    ...DRUCK_ABFRAGE,
    gcTime: 0,
  });
  // Felder hier lesen: `useQuery` beobachtet nur, was beim Rendern gelesen wird.
  const { data: daten, isSuccess, isFetching, isError, error, refetch } = druckQuery;

  const plan = useMemo(
    () =>
      daten
        ? ausEinsatzPlan(
            daten.plan,
            baueZeilen({
              einheiten: daten.einheiten,
              uhs: daten.uhs,
              abschnitte: daten.vorgaben,
              bloecke: daten.plan.bloecke,
            }),
          )
        : null,
    [daten],
  );

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
  const zurueck = abloesungPfad(einsatzId, { ansicht: 'plan' });

  return (
    <SchichtplanDruckInhalt
      plan={plan}
      qualifikationen={daten?.qualifikationen}
      geladenAt={daten?.geladenAt}
      isSuccess={isSuccess}
      isFetching={isFetching}
      isError={isError}
      error={error}
      refetch={refetch}
      isReloadBlocked={freigabenLaden}
      druckPfad={(wahl) => schichtplanDruckPfad(einsatzId, wahl)}
      zurueck={{ pfad: zurueck, label: 'Zurück zum Schichtplan' }}
      texte={{
        keinZugriff: 'Kein Zugriff auf den Schichtplan',
        ladeFehler: 'Der Schichtplan konnte nicht geladen werden',
        laedt: 'Schichtplan wird geladen …',
        keineSchichten: 'Keine Schichten im Plan',
      }}
      einsatz={einsatz}
      renderPage={({ actions, content }) => (
        <EinsatzSeite
          titel="Schichtplan – Druckansicht"
          breadcrumb={
            <Breadcrumb
              items={[
                { title: <Link to="/einsaetze">Einsätze</Link> },
                { title: einsatz.bezeichnung },
                { title: <Link to={zurueck}>Ablösung</Link> },
                { title: 'Schichtplan drucken' },
              ]}
            />
          }
          aktionen={actions}
        >
          {content}
        </EinsatzSeite>
      )}
    />
  );
}
