import { useMemo } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Alert, Breadcrumb, Button, Flex, Typography, theme } from 'antd';
import { listeAbloesungVorgaben } from '../api/abloesungen';
import { ApiError } from '../api/client';
import { listeEinheiten } from '../api/einheiten';
import { ladeEinsatz } from '../api/einsaetze';
import { listeUhs } from '../api/einsatzUhs';
import { listeQualifikationen } from '../api/qualifikationen';
import { einsatzKeys } from '../api/queryKeys';
import { fetchSchichtplan } from '../api/schichtplan';
import { ausEinsatzPlan } from '../abloesung/schichtplan/ausgabe/ausEinsatzPlan';
import { aushaenge, zettel } from '../abloesung/schichtplan/ausgabe/ausgabePlan';
import SchichtplanBlaetter, {
  type BlattSicht,
} from '../abloesung/schichtplan/ausgabe/SchichtplanBlaetter';
import { baueZeilen } from '../abloesung/schichtplan/schichtplanZeilen';
import EinsatzSeite from '../components/EinsatzSeite';
import { Segmentleiste } from '../components/instrument';
import { Select } from '../components/Select';
import { MODUL_PERSONAL_GESPERRT } from '../components/nurAnsicht';
import { SeitenFehler, SeitenSkeleton } from '../components/SeitenZustand';
import DruckKnopf from '../components/druck/DruckKnopf';
import { teilwortSuche } from '../components/teilwortSuche';
import { DRUCK_ABFRAGE } from '../druck/abfrageOptionen';
import { istKeyFreigegeben } from '../einsatz/modulRegistry';
import { useModulFreigabenStand } from '../einsatz/useSprungSperre';
import {
  abloesungPfad,
  parseSchichtplanDruckAuswahl,
  schichtplanDruckPfad,
} from '../routing/deeplinks';

/**
 * Druckansicht des Schichtplans (LLH-1557, Change `jwqanxja-schichtplan-ausgeben` D2): Aushang je
 * Posten oder Zettel je Person, alle Blätter oder eines. Vorbild ist die Ausgabe der Suite: oben die
 * Wahl, darunter die Blätter, wie sie aufs Papier kommen.
 *
 * Der Stand ist ein Schnappschuss (`schichtplanDruck`, nicht live): ein Ereignis darf das Blatt vor
 * dem Druck nicht still ändern, „Neu laden“ holt neu. Einheiten und UHS liefern nur Abschnitt und
 * Reihenfolge der Posten; fehlen sie (Modul gesperrt, Fehler), stehen die Posten ohne Abschnitt.
 * Ohne Modul Personal liefert der Plan keine Namen: dann nur der Aushang mit der Besetzung als
 * Zahl.
 */
export default function SchichtplanDruckPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const [searchParams] = useSearchParams();
  const suche = searchParams.toString();
  const gewaehlt = useMemo(() => parseSchichtplanDruckAuswahl(new URLSearchParams(suche)), [suche]);

  // Scheitern die Freigaben, druckt die Seite trotzdem: die Posten stehen dann ohne Abschnitt.
  const { freigaben, gescheitert } = useModulFreigabenStand(einsatzId);
  const einheitenFrei = istKeyFreigegeben('einheiten', freigaben);
  const uhsFrei = istKeyFreigegeben('unfallhilfsstellen', freigaben);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const druckQuery = useQuery({
    queryKey: einsatzKeys.schichtplanDruck(einsatzId),
    queryFn: async () => {
      const [plan, vorgaben, einheiten, uhs, qualifikationen] = await Promise.all([
        fetchSchichtplan(einsatzId),
        listeAbloesungVorgaben(einsatzId).catch(() => []),
        einheitenFrei ? listeEinheiten(einsatzId).catch(() => undefined) : undefined,
        uhsFrei ? listeUhs(einsatzId).catch(() => undefined) : undefined,
        listeQualifikationen().catch(() => []),
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
    enabled: freigaben != null || gescheitert,
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
  const qualiNamen = useMemo(
    () => new Map((daten?.qualifikationen ?? []).map((q) => [q.id, q.label])),
    [daten],
  );
  const ohneNamen = plan != null && plan.personen == null;
  const sicht: BlattSicht = gewaehlt.sicht === 'person' && !ohneNamen ? 'person' : 'posten';
  const optionen = useMemo(() => {
    if (!plan) return [];
    return sicht === 'posten'
      ? aushaenge(plan).map((a) => ({ value: a.posten.schluessel, label: a.posten.titel }))
      : zettel(plan).map((z) => ({ value: z.person.schluessel, label: z.person.name }));
  }, [plan, sicht]);
  const auswahl = optionen.some((o) => o.value === gewaehlt.auswahl) ? gewaehlt.auswahl : null;
  const zuPfad = (s: BlattSicht, a: string | null) =>
    navigate(schichtplanDruckPfad(einsatzId, { sicht: s, auswahl: a }), { replace: true });

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
  const keinZugriff = error instanceof ApiError && error.status === 403;
  const leer = optionen.length === 0;

  return (
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
            Zurück zum Schichtplan
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
            {
              wert: 'person',
              label: 'Je Person',
              ...(ohneNamen ? { gesperrt: MODUL_PERSONAL_GESPERRT } : {}),
            },
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
        <Alert type="info" showIcon title="Kein Zugriff auf den Schichtplan" />
      ) : isError ? (
        <Alert
          type="error"
          showIcon
          title="Der Schichtplan konnte nicht geladen werden"
          action={<Button onClick={() => void refetch()}>Erneut laden</Button>}
        />
      ) : !plan || !daten || isFetching ? (
        <Typography.Text role="status" aria-live="polite">
          Schichtplan wird geladen …
        </Typography.Text>
      ) : leer ? (
        <Typography.Paragraph>
          {sicht === 'posten' ? 'Keine Schichten im Plan' : 'Niemand eingeteilt'}
        </Typography.Paragraph>
      ) : (
        <div data-lfh="druckwurzel">
          <SchichtplanBlaetter
            plan={plan}
            sicht={sicht}
            auswahl={auswahl}
            einsatz={einsatz}
            qualiNamen={qualiNamen}
            geladenAt={daten.geladenAt}
          />
        </div>
      )}
    </EinsatzSeite>
  );
}
