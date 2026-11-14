import { useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { ladePlanung } from '../api/planungen';
import { listeQualifikationen } from '../api/qualifikationen';
import { globalKeys } from '../api/queryKeys';
import SchichtplanDruckInhalt from '../abloesung/schichtplan/ausgabe/SchichtplanDruckInhalt';
import AdminPage from '../components/AdminPage';
import { SeitenLeer } from '../components/SeitenZustand';
import { DRUCK_ABFRAGE } from '../druck/abfrageOptionen';
import { parseRouteId, planungDruckPfad, planungenPfad, planungPfad } from '../routing/deeplinks';
import { ausPlanung } from './ausPlanung';

/**
 * Druckansicht einer Planung ohne Einsatz (LLH-1593, Teil C von LLH-1557, design D8): dieselben
 * Blätter wie beim Schichtplan eines Einsatzes (`SchichtplanDruckPage`), Aushang je Posten oder
 * Zettel je Person, alle oder eines. Der Druckkopf nennt die Planung statt eines Einsatzes, die
 * Zeiten stehen in der Zone der Organisation (`useAnzeigeKonventionen` außerhalb eines Einsatzes).
 *
 * Der Stand ist ein Schnappschuss (`planungDruck`, nicht live): eine Änderung an der Planung darf
 * das Blatt vor dem Druck nicht still ändern, „Neu laden“ holt neu. Eine Planung trägt immer Namen;
 * wer sie lesen darf, sieht auch das Personal (`NurMitPlanungsrecht` an der Route).
 *
 * Wahl, Knöpfe, Hinweise und Blätter teilt die Seite mit dem Einsatz
 * (`abloesung/schichtplan/ausgabe/SchichtplanDruckInhalt.tsx`); hier stehen Rahmen und Laden.
 */
export default function PlanungDruckPage() {
  const { planungId: roh } = useParams();
  const planungId = parseRouteId(roh);

  const druckQuery = useQuery({
    queryKey: globalKeys.planungDruck(planungId ?? 0),
    queryFn: async () => {
      const [planung, qualifikationen] = await Promise.all([
        ladePlanung(planungId as number),
        listeQualifikationen(),
      ]);
      return { planung, qualifikationen, geladenAt: new Date().toISOString() };
    },
    enabled: planungId != null,
    ...DRUCK_ABFRAGE,
    gcTime: 0,
  });
  // Felder hier lesen: `useQuery` beobachtet nur, was beim Rendern gelesen wird.
  const { data: daten, isSuccess, isFetching, isError, error, refetch } = druckQuery;

  const plan = useMemo(() => (daten ? ausPlanung(daten.planung) : null), [daten]);

  const bezeichnung = daten?.planung.kopf.bezeichnung;
  const zurueck = planungId != null ? planungPfad(planungId) : planungenPfad();
  const pfad = [
    { title: <Link to={planungenPfad()}>Planungen</Link> },
    { title: <Link to={zurueck}>{bezeichnung ?? 'Planung'}</Link> },
    { title: 'Drucken' },
  ];

  if (planungId == null || (error instanceof ApiError && error.status === 404)) {
    return (
      <AdminPage titel="Planung drucken" pfad={pfad}>
        <SeitenLeer titel="Diese Planung gibt es nicht" />
      </AdminPage>
    );
  }

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
      druckPfad={(wahl) => planungDruckPfad(planungId, wahl)}
      zurueck={{ pfad: zurueck, label: 'Zurück zur Planung' }}
      texte={{
        keinZugriff: 'Kein Zugriff auf die Planung',
        ladeFehler: 'Die Planung konnte nicht geladen werden',
        laedt: 'Planung wird geladen …',
        keineSchichten: 'Keine Schichten in der Planung',
      }}
      einsatz={{ bezeichnung: daten?.planung.kopf.bezeichnung ?? '' }}
      bezug="Planung"
      renderPage={({ actions, content }) => (
        <AdminPage
          titel={bezeichnung ? `${bezeichnung} – Druckansicht` : 'Planung – Druckansicht'}
          pfad={pfad}
          aktionen={actions}
        >
          {content}
        </AdminPage>
      )}
    />
  );
}
