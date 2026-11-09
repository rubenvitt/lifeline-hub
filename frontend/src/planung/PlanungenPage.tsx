import { Button, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { listePlanungen } from '../api/planungen';
import { globalKeys } from '../api/queryKeys';
import type { PlanungListeneintrag } from '../api/types';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { datum, tagUndUhrzeit } from '../anzeige/zeitDarstellung';
import { alsZeitpunkt } from '../anzeige/zeitEingabe';
import AdminPage from '../components/AdminPage';
import { monoStil } from '../components/instrument';
import KatalogTabelle, {
  KENNUNG_SCHMAL_BREITE,
  type KatalogSpalte,
} from '../components/KatalogTabelle';
import { nachText, nachZahl } from '../components/katalogVergleich';
import { KennungsLink } from '../components/kennungsLink';
import { useListenGedaechtnis } from '../components/listenGedaechtnis';
import { SeitenFehler } from '../components/SeitenZustand';
import { useViewport } from '../components/useViewport';
import { EINSATZART_LABELS } from '../einsatz/einsatzart';
import { planungPfad } from '../routing/deeplinks';
import PlanungAnlegenDialog from './PlanungAnlegenDialog';

/** Ab so vielen Tagen vor dem Löschen nennt die Liste den Tag. */
const LOESCHHINWEIS_TAGE = 14;

/** Der Löschtag, wenn er in den nächsten 14 Tagen liegt; sonst `null`. */
export function loeschHinweisTag(loeschungAt: string, jetzt: number): dayjs.Dayjs | null {
  const t = alsZeitpunkt(loeschungAt);
  if (!t) return null;
  return t.valueOf() - jetzt <= LOESCHHINWEIS_TAGE * 24 * 60 * 60_000 ? t : null;
}

/**
 * Liste der Planungen ohne Einsatz (LLH-1586, Spec `vorplanung`): offene zuerst, dann nach Beginn
 * (Reihenfolge des Servers, deshalb kein `defaultSortOrder`). Soll, Ist, Offen und Konflikte
 * rechnet der Server; ältere Planungen tragen keine, eine übernommene die von damals (LLH-1587).
 * Eine übernommene Zeile nennt ihren Einsatz; 14 Tage vor dem Löschen nennt die Zeile den Tag. Erreichbar nur für wer planen darf (Kopfleiste, Server 403).
 */
export default function PlanungenPage() {
  const { konventionen } = useAnzeigeKonventionen();
  const { istSchmal } = useViewport();
  const [anlegen, setAnlegen] = useState(false);
  const query = useQuery({ queryKey: globalKeys.planungen(), queryFn: listePlanungen });
  const jetzt = Date.now();

  const kennzahl = (
    titel: string,
    key: 'soll' | 'ist' | 'offen' | 'konflikte',
  ): KatalogSpalte<PlanungListeneintrag> => ({
    title: titel,
    key,
    zahl: true,
    sorter: nachZahl((p: PlanungListeneintrag) => p.kennzahlen?.[key] ?? null),
    render: (_, p) => <span style={monoStil(12)}>{p.kennzahlen ? p.kennzahlen[key] : '—'}</span>,
  });

  const spalten: KatalogSpalte<PlanungListeneintrag>[] = [
    {
      title: 'Bezeichnung',
      dataIndex: 'bezeichnung',
      key: 'bezeichnung',
      width: istSchmal ? KENNUNG_SCHMAL_BREITE : undefined,
      sorter: nachText((p: PlanungListeneintrag) => p.bezeichnung),
      render: (_, p) => {
        const loeschTag = loeschHinweisTag(p.loeschung_at, jetzt);
        return (
          <>
            <KennungsLink to={planungPfad(p.id)} style={{ overflowWrap: 'anywhere' }}>
              {p.bezeichnung}
            </KennungsLink>
            {p.uebernahme && (
              <Typography.Text
                type="secondary"
                data-lfh="planung-uebernommen"
                style={{ display: 'block' }}
              >
                übernommen in{' '}
                <span style={monoStil(12)}>
                  {p.uebernahme.einsatznummer ?? `Einsatz ${p.uebernahme.einsatz_id}`}
                </span>
              </Typography.Text>
            )}
            {loeschTag && (
              <Typography.Text
                type="secondary"
                data-lfh="planung-loeschhinweis"
                style={{ display: 'block' }}
              >
                wird am {datum(loeschTag, konventionen)} gelöscht
              </Typography.Text>
            )}
          </>
        );
      },
    },
    {
      title: 'Zeitraum',
      key: 'zeitraum',
      sorter: nachZahl((p: PlanungListeneintrag) => alsZeitpunkt(p.von)?.valueOf() ?? null),
      suchText: (p) =>
        `${tagUndUhrzeit(p.von, konventionen)} ${tagUndUhrzeit(p.bis, konventionen)}`,
      render: (_, p) => (
        <span style={{ ...monoStil(12), whiteSpace: 'nowrap' }}>
          {tagUndUhrzeit(p.von, konventionen)}–{tagUndUhrzeit(p.bis, konventionen)}
        </span>
      ),
    },
    {
      title: 'Ort',
      key: 'ort',
      abBreite: 'lg',
      suchText: (p) => p.ort,
      sorter: nachText((p: PlanungListeneintrag) => p.ort),
      render: (_, p) => p.ort ?? '—',
    },
    {
      title: 'Einsatzart',
      key: 'einsatzart',
      abBreite: 'xl',
      suchText: (p) => EINSATZART_LABELS[p.einsatzart],
      sorter: nachText((p: PlanungListeneintrag) => EINSATZART_LABELS[p.einsatzart]),
      render: (_, p) => EINSATZART_LABELS[p.einsatzart],
    },
    kennzahl('Soll', 'soll'),
    kennzahl('Ist', 'ist'),
    kennzahl('Offen', 'offen'),
    kennzahl('Konflikte', 'konflikte'),
  ];
  const gedaechtnis = useListenGedaechtnis('planungen', spalten);

  return (
    <AdminPage
      titel="Planungen"
      aktionen={
        <Button type="primary" onClick={() => setAnlegen(true)}>
          Planung anlegen
        </Button>
      }
    >
      {query.isError ? (
        <SeitenFehler
          text="Planungen konnten nicht geladen werden"
          ursache={query.error}
          onWiederholen={() => void query.refetch()}
        />
      ) : (
        <KatalogTabelle
          rowKey="id"
          loading={query.isLoading}
          dataSource={query.data ?? []}
          columns={spalten}
          gedaechtnis={gedaechtnis}
          spaltenSchalter={{ bezeichnung: 'Planungen' }}
          mehrzahl="Planungen"
          suche={{ platzhalter: 'Bezeichnung, Ort oder Zeitraum' }}
          locale={{ emptyText: 'Noch keine Planungen' }}
        />
      )}
      <PlanungAnlegenDialog offen={anlegen} onClose={() => setAnlegen(false)} />
    </AdminPage>
  );
}
