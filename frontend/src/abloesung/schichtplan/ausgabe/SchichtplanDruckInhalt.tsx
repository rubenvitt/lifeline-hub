import { useMemo, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Alert, Button, Flex, Typography, theme } from 'antd';
import { ApiError } from '../../../api/client';
import type { Qualifikation } from '../../../api/types';
import DruckKnopf from '../../../components/druck/DruckKnopf';
import { Segmentleiste } from '../../../components/instrument';
import { MODUL_PERSONAL_GESPERRT } from '../../../components/nurAnsicht';
import { Select } from '../../../components/Select';
import { teilwortSuche } from '../../../components/teilwortSuche';
import {
  parseSchichtplanDruckAuswahl,
  type SchichtplanDruckAuswahl,
} from '../../../routing/deeplinks';
import { aushaenge, zettel, type AusgabePlan } from './ausgabePlan';
import SchichtplanBlaetter, { type BlattSicht } from './SchichtplanBlaetter';

/** Die Wortlaute einer Druckseite, je Plan („der Schichtplan“, „die Planung“). */
export interface SchichtplanDruckTexte {
  keinZugriff: string;
  ladeFehler: string;
  laedt: string;
  /** Leer-Hinweis in der Sicht „Je Posten“. */
  keineSchichten: string;
}

interface SchichtplanDruckInhaltProps {
  /** Der Ausgabeplan aus dem Schnappschuss; `null`, solange nichts geladen ist. */
  plan: AusgabePlan | null;
  qualifikationen: readonly Qualifikation[] | undefined;
  /** Zeitpunkt des Schnappschusses; `undefined`, solange nichts geladen ist. */
  geladenAt: string | undefined;
  // Query-Felder einzeln (`frontend/src/druck/AGENTS.md`): `useQuery` beobachtet nur, was die
  // Seite liest.
  isSuccess: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
  /** Ein Abruf, auf den die Hülle wartet (Freigaben im Einsatz): sperrt Neu- und Erneut-Laden. */
  isReloadBlocked?: boolean;
  /** Pfad dieser Druckseite mit einer anderen Wahl. */
  druckPfad: (wahl: SchichtplanDruckAuswahl) => string;
  /** Rücksprung vor „Neu laden“: Ziel und Beschriftung. */
  zurueck: { pfad: string; label: string };
  texte: SchichtplanDruckTexte;
  /** Kopf der Blätter (`SchichtplanBlaetter`). */
  einsatz: { bezeichnung: string; einsatznummer_intern?: string | null };
  bezug?: string;
  /** Die Hülle setzt die Teile in ihren Seitenrahmen. */
  renderPage: (teile: { actions: ReactNode; content: ReactNode }) => ReactNode;
}

/**
 * Gemeinsamer Inhalt der Druckseiten des Schichtplans (`pages/SchichtplanDruckPage.tsx`) und der
 * Vorplanung (`planung/PlanungDruckPage.tsx`), Change `y106s29r-blockplan-kern` D6: Sicht und
 * Auswahl aus der Adresse, Segmentleiste und Auswahl des Blatts, „Neu laden“ und `DruckKnopf`,
 * Lade-, Fehler- und Leer-Hinweise und die Blätter. Seitenrahmen und Laden bleiben je Seite.
 *
 * Ohne Namen im Plan (Modul Personal gesperrt) gibt es nur den Aushang; „Je Person“ steht gesperrt.
 */
export default function SchichtplanDruckInhalt({
  plan,
  qualifikationen,
  geladenAt,
  isSuccess,
  isFetching,
  isError,
  error,
  refetch,
  isReloadBlocked = false,
  druckPfad,
  zurueck,
  texte,
  einsatz,
  bezug,
  renderPage,
}: SchichtplanDruckInhaltProps) {
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const [searchParams] = useSearchParams();
  const suche = searchParams.toString();
  const gewaehlt = useMemo(() => parseSchichtplanDruckAuswahl(new URLSearchParams(suche)), [suche]);

  const qualiNamen = useMemo(
    () => new Map((qualifikationen ?? []).map((q) => [q.id, q.label])),
    [qualifikationen],
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
    navigate(druckPfad({ sicht: s, auswahl: a }), { replace: true });

  const keinZugriff = error instanceof ApiError && error.status === 403;
  const leer = optionen.length === 0;

  const actions = (
    <>
      <Button
        href={zurueck.pfad}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          navigate(zurueck.pfad);
        }}
      >
        {zurueck.label}
      </Button>
      {!keinZugriff && (
        <Button onClick={() => void refetch()} disabled={isFetching || isReloadBlocked}>
          Neu laden
        </Button>
      )}
      {!keinZugriff && <DruckKnopf typ="primary" gesperrt={!isSuccess || isFetching || leer} />}
    </>
  );

  const content = (
    <>
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
        <Alert type="info" showIcon title={texte.keinZugriff} />
      ) : isError ? (
        <Alert
          type="error"
          showIcon
          title={texte.ladeFehler}
          action={
            <Button onClick={() => void refetch()} disabled={isReloadBlocked}>
              Erneut laden
            </Button>
          }
        />
      ) : !plan || geladenAt == null || isFetching ? (
        <Typography.Text role="status" aria-live="polite">
          {texte.laedt}
        </Typography.Text>
      ) : leer ? (
        <Typography.Paragraph>
          {sicht === 'posten' ? texte.keineSchichten : 'Niemand eingeteilt'}
        </Typography.Paragraph>
      ) : (
        <div data-lfh="druckwurzel">
          <SchichtplanBlaetter
            plan={plan}
            sicht={sicht}
            auswahl={auswahl}
            einsatz={einsatz}
            bezug={bezug}
            qualiNamen={qualiNamen}
            geladenAt={geladenAt}
          />
        </div>
      )}
    </>
  );

  return renderPage({ actions, content });
}
