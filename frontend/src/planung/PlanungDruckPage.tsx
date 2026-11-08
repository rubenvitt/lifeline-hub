import { useMemo } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Flex, Typography, theme } from 'antd';
import { ApiError } from '../api/client';
import { ladePlanung } from '../api/planungen';
import { listeQualifikationen } from '../api/qualifikationen';
import { globalKeys } from '../api/queryKeys';
import { aushaenge, zettel } from '../abloesung/schichtplan/ausgabe/ausgabePlan';
import SchichtplanBlaetter, {
  type BlattSicht,
} from '../abloesung/schichtplan/ausgabe/SchichtplanBlaetter';
import AdminPage from '../components/AdminPage';
import DruckKnopf from '../components/druck/DruckKnopf';
import { Segmentleiste } from '../components/instrument';
import { Select } from '../components/Select';
import { SeitenLeer } from '../components/SeitenZustand';
import { teilwortSuche } from '../components/teilwortSuche';
import { DRUCK_ABFRAGE } from '../druck/abfrageOptionen';
import {
  parseRouteId,
  parseSchichtplanDruckAuswahl,
  planungDruckPfad,
  planungenPfad,
  planungPfad,
} from '../routing/deeplinks';
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
 */
export default function PlanungDruckPage() {
  const { planungId: roh } = useParams();
  const planungId = parseRouteId(roh);
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const [searchParams] = useSearchParams();
  const suche = searchParams.toString();
  const gewaehlt = useMemo(() => parseSchichtplanDruckAuswahl(new URLSearchParams(suche)), [suche]);

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
  const qualiNamen = useMemo(
    () => new Map((daten?.qualifikationen ?? []).map((q) => [q.id, q.label])),
    [daten],
  );
  const sicht: BlattSicht = gewaehlt.sicht === 'person' ? 'person' : 'posten';
  const optionen = useMemo(() => {
    if (!plan) return [];
    return sicht === 'posten'
      ? aushaenge(plan).map((a) => ({ value: a.posten.schluessel, label: a.posten.titel }))
      : zettel(plan).map((z) => ({ value: z.person.schluessel, label: z.person.name }));
  }, [plan, sicht]);
  const auswahl = optionen.some((o) => o.value === gewaehlt.auswahl) ? gewaehlt.auswahl : null;

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

  const zuPfad = (s: BlattSicht, a: string | null) =>
    navigate(planungDruckPfad(planungId, { sicht: s, auswahl: a }), { replace: true });
  const keinZugriff = error instanceof ApiError && error.status === 403;
  const leer = optionen.length === 0;

  return (
    <AdminPage
      titel={bezeichnung ? `${bezeichnung} – Druckansicht` : 'Planung – Druckansicht'}
      pfad={pfad}
      aktionen={
        <>
          <Button
            href={zurueck}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              navigate(zurueck);
            }}
          >
            Zurück zur Planung
          </Button>
          {!keinZugriff && (
            <Button onClick={() => void refetch()} disabled={isFetching}>
              Neu laden
            </Button>
          )}
          {!keinZugriff && <DruckKnopf typ="primary" gesperrt={!isSuccess || isFetching || leer} />}
        </>
      }
    >
      <Flex gap={token.marginSM} wrap align="center" style={{ marginBlockEnd: token.margin }}>
        <Segmentleiste<BlattSicht>
          beschriftung="Blätter"
          wert={sicht}
          onWechsel={(s) => zuPfad(s, null)}
          optionen={[
            { wert: 'posten', label: 'Je Posten' },
            { wert: 'person', label: 'Je Person' },
          ]}
          style={{ flex: 'none' }}
        />
        <Select
          allowClear
          showSearch={teilwortSuche}
          aria-label="Blatt"
          placeholder={sicht === 'posten' ? 'Alle Posten' : 'Alle Personen'}
          value={auswahl ?? undefined}
          onChange={(v?: string) => zuPfad(sicht, v ?? null)}
          options={optionen}
          disabled={leer}
          style={{ minWidth: 240 }}
        />
      </Flex>
      {keinZugriff ? (
        <Alert type="info" showIcon title="Kein Zugriff auf die Planung" />
      ) : isError ? (
        <Alert
          type="error"
          showIcon
          title="Die Planung konnte nicht geladen werden"
          action={<Button onClick={() => void refetch()}>Erneut laden</Button>}
        />
      ) : !plan || !daten || isFetching ? (
        <Typography.Text role="status" aria-live="polite">
          Planung wird geladen …
        </Typography.Text>
      ) : leer ? (
        <Typography.Paragraph>
          {sicht === 'posten' ? 'Keine Schichten in der Planung' : 'Niemand eingeteilt'}
        </Typography.Paragraph>
      ) : (
        <div data-lfh="druckwurzel">
          <SchichtplanBlaetter
            plan={plan}
            sicht={sicht}
            auswahl={auswahl}
            einsatz={{ bezeichnung: daten.planung.kopf.bezeichnung }}
            bezug="Planung"

            qualiNamen={qualiNamen}
            geladenAt={daten.geladenAt}
          />
        </div>
      )}
    </AdminPage>
  );
}
