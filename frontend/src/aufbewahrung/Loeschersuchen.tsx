import { Button, Space, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ladeSchwaerzungsantraege, nimmSchwaerzungsantragZurueck } from '../api/aufbewahrung';
import { globalKeys } from '../api/queryKeys';
import type { ArchivAkte, Schwaerzungsantrag } from '../api/types';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import KatalogTabelle, { type KatalogSpalte } from '../components/KatalogTabelle';
import { SeitenFehler, SeitenSkeleton } from '../components/SeitenZustand';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import StatusTag from '../components/StatusTag';
import { Paneel } from '../components/instrument';
import { schwaerzungsantragStand } from '../theme/statusFarben';
import { ZIEL_ART } from './archivText';
import PersonensucheDialog from './PersonensucheDialog';
import SchwaerzungsantragDialog, { type AntragZielWahl } from './SchwaerzungsantragDialog';

/**
 * Paneel „Löschersuchen (Art. 17)“ der Archivakte (LFH-751, Spec `aufbewahrung-loeschersuchen`,
 * „Anträge in der Archivakte“).
 *
 * Liste aller Anträge (Ziel nur als Kennung, Aktenzeichen, Stand, Fälligkeit) mit
 * „Zurücknehmen“ an jedem offenen, noch nicht fälligen Antrag. Darüber die zwei Wege zu einem
 * neuen Antrag: „Person suchen und schwärzen“ und „Einsatz sofort schwärzen“. An einem
 * geschwärzten Einsatz fehlen beide (der Server lehnte mit 409 ab), bei einem offenen
 * Einsatz-Antrag fehlt der zweite.
 *
 * Die Rücknahme hat keine Rückfrage (LFH-363): sie ist umkehrbar, ein neuer Antrag ist jederzeit
 * möglich. Der Antrag selbst fragt zurück (`SchwaerzungsantragDialog`).
 */

const leer = '—';

/** Welche Antragswege die Akte anbietet — rein, ohne Render prüfbar. */
export function antragswege(akte: Pick<ArchivAkte, 'zustand'>): {
  person: boolean;
  einsatz: boolean;
} {
  if (akte.zustand === 'geschwaerzt') return { person: false, einsatz: false };
  return { person: true, einsatz: akte.zustand !== 'schwaerzung_beantragt' };
}

export default function Loeschersuchen({
  einsatzId,
  akte,
}: {
  einsatzId: number;
  akte: ArchivAkte;
}) {
  const qc = useQueryClient();
  const [sucheOffen, setSucheOffen] = useState(false);
  const [ziel, setZiel] = useState<AntragZielWahl | null>(null);
  const wege = antragswege(akte);
  const einsatzKennung = akte.kopf.einsatznummer_intern ?? `#${akte.kopf.id}`;

  const abfrage = useQuery({
    queryKey: globalKeys.aufbewahrungAntraege(einsatzId),
    queryFn: () => ladeSchwaerzungsantraege(einsatzId),
  });
  const ruecknahme = useMutation({
    mutationFn: (antragId: number) => nimmSchwaerzungsantragZurueck(einsatzId, antragId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: globalKeys.aufbewahrung() }),
  });

  const spalten: KatalogSpalte<Schwaerzungsantrag>[] = [
    {
      key: 'ziel',
      title: 'Ziel',
      width: 120,
      zahl: true,
      render: (_, a) => a.ziel_kennung,
    },
    { key: 'art', title: 'Art', width: 220, render: (_, a) => ZIEL_ART[a.ziel_art] },
    {
      key: 'aktenzeichen',
      title: 'Aktenzeichen',
      width: 170,
      zahl: true,
      render: (_, a) => a.aktenzeichen,
    },
    {
      key: 'stand',
      title: 'Stand',
      width: 150,
      render: (_, a) => <StatusTag darstellung={schwaerzungsantragStand[a.stand]} />,
    },
    {
      key: 'beantragt',
      title: 'Beantragt',
      width: 220,
      render: (_, a) => (
        <>
          <ZeitAnzeige wert={a.beantragt_at} /> · {a.beantragt_von_name}
        </>
      ),
    },
    {
      key: 'faellig',
      title: 'Vollzug ab',
      width: 160,
      zahl: true,
      render: (_, a) => <ZeitAnzeige wert={a.faellig_at} />,
    },
    {
      key: 'erledigt',
      title: 'Erledigt',
      width: 160,
      zahl: true,
      render: (_, a) => {
        const zeit = a.vollzogen_at ?? a.zurueckgenommen_at;
        return zeit ? <ZeitAnzeige wert={zeit} /> : leer;
      },
    },
    {
      key: 'aktion',
      title: 'Aktion',
      width: 160,
      render: (_, a) =>
        a.zuruecknehmbar ? (
          <Button
            onClick={() => ruecknahme.mutate(a.id)}
            loading={ruecknahme.isPending && ruecknahme.variables === a.id}
            aria-label={`Antrag für ${a.ziel_kennung} zurücknehmen`}
          >
            Zurücknehmen
          </Button>
        ) : (
          leer
        ),
    },
  ];

  const aktionen =
    wege.person || wege.einsatz ? (
      <Space size="middle" wrap>
        {wege.person && (
          <Button onClick={() => setSucheOffen(true)}>Person suchen und schwärzen</Button>
        )}
        {wege.einsatz && (
          <Button danger onClick={() => setZiel({ art: 'einsatz', kennung: einsatzKennung })}>
            Einsatz sofort schwärzen
          </Button>
        )}
      </Space>
    ) : undefined;

  let inhalt;
  if (abfrage.isLoading) inhalt = <SeitenSkeleton />;
  else if (!abfrage.data) {
    inhalt = (
      <SeitenFehler
        text="Löschersuchen nicht ladbar"
        ursache={abfrage.error}
        onWiederholen={() => void abfrage.refetch()}
      />
    );
  } else {
    inhalt = (
      <KatalogTabelle<Schwaerzungsantrag>
        rowKey={(a) => String(a.id)}
        pagination={false}
        columns={spalten}
        dataSource={abfrage.data}
        locale={{ emptyText: 'Kein Löschersuchen gestellt' }}
      />
    );
  }

  return (
    <Paneel
      titel="Löschersuchen (Art. 17)"
      meta="Vollzug 24 Stunden nach dem Antrag, bis dahin zurücknehmbar"
      aktion={aktionen}
      koerperPolster
    >
      <div data-lfh="loeschersuchen">
        {inhalt}
        <SpeicherFehler fehler={ruecknahme.error} titel="Rücknahme fehlgeschlagen" />
        {!wege.person && (
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Der Einsatz ist geschwärzt — ein weiteres Löschersuchen ist nicht nötig.
          </Typography.Paragraph>
        )}
      </div>
      {sucheOffen && (
        <PersonensucheDialog
          einsatzId={einsatzId}
          onSchliessen={() => setSucheOffen(false)}
          onWaehlen={(t) => {
            setSucheOffen(false);
            setZiel({ art: t.art, id: t.id, kennung: t.kennung });
          }}
        />
      )}
      {ziel && (
        <SchwaerzungsantragDialog
          einsatzId={einsatzId}
          ziel={ziel}
          onSchliessen={() => setZiel(null)}
        />
      )}
    </Paneel>
  );
}
