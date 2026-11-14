import { Button, Space, Typography, theme } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ladeSchwaerzungsantraege, nimmSchwaerzungsantragZurueck } from '../api/aufbewahrung';
import { globalKeys } from '../api/queryKeys';
import type { ArchivAkte, Schwaerzungsantrag } from '../api/types';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import KatalogTabelle, { type KatalogSpalte } from '../components/KatalogTabelle';
import { nachFolge, nachText, werteAusKatalog } from '../components/katalogVergleich';
import { SeitenFehler, SeitenSkeleton } from '../components/SeitenZustand';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import StatusTag from '../components/StatusTag';
import { Paneel } from '../components/instrument';
import { schwaerzungsantragStand } from '../theme/statusFarben';
import { ZIEL_ART } from './archivText';
import ArchivPersonAntragDialog from './ArchivPersonAntragDialog';
import PersonensucheDialog from './PersonensucheDialog';
import SchwaerzungsantragDialog, { type AntragZielWahl } from './SchwaerzungsantragDialog';

/**
 * Paneel „Löschersuchen (Art. 17)“ der Archivakte (LFH-751, Spec `aufbewahrung-loeschersuchen`,
 * „Anträge in der Archivakte“).
 *
 * Liste aller Anträge (Ziel nur als Kennung, Aktenzeichen, Stand, Fälligkeit, beteiligte
 * Personen) mit
 * „Zurücknehmen“ an jedem offenen, noch nicht fälligen Antrag. Darüber die zwei Wege zu einem
 * neuen Antrag: „Person suchen und schwärzen“ und „Einsatz sofort schwärzen“. An einem
 * geschwärzten Einsatz fehlen beide (der Server lehnte mit 409 ab), bei einem offenen
 * Einsatz-Antrag fehlt der zweite. An einem archivierten Einsatz (LLH-1712) heißen sie „Person
 * per Kennung schwärzen“ und „Einsatz und Archiv löschen“; ein fälliger Personen-Antrag wartet
 * dort auf den Befehl mit dem Archiv-Schlüssel.
 *
 * Die Rücknahme hat keine Rückfrage (LFH-363): sie ist umkehrbar, ein neuer Antrag ist jederzeit
 * möglich. Der Antrag selbst fragt zurück (`SchwaerzungsantragDialog`).
 *
 * Sortieren und Filtern im Spaltenkopf (LLH-1096): Art und Stand filtern, alle Spalten mit
 * vergleichbarem Wert sortieren. Ohne Listengedächtnis: die Akte trägt mehrere Listen, ihre
 * Adresse nur eine (`ArchivAktePage`, Register).
 */

const leer = '—';

/** Welche Antragswege die Akte anbietet — rein, ohne Render prüfbar. Ein geschwärzter Einsatz
 *  mit Archiv (`akte.archiv`) bietet beide an; ob ein Einsatz-Antrag offen ist, sagt dort die
 *  Liste der Anträge, nicht der Zustand (LLH-1712). Ist sie noch nicht geladen oder gescheitert
 *  (`undefined`), bleibt der Einsatz-Weg dort weg, statt erst am 409 des Servers zu scheitern. */
export function antragswege(
  akte: Pick<ArchivAkte, 'zustand'> & Partial<Pick<ArchivAkte, 'archiv'>>,
  antraege?: Schwaerzungsantrag[],
): { person: boolean; einsatz: boolean; archiv: boolean } {
  const geschwaerzt = akte.zustand === 'geschwaerzt' || akte.zustand === 'loeschung_ausstehend';
  if (geschwaerzt) {
    if (!akte.archiv) return { person: false, einsatz: false, archiv: false };
    const einsatzOffen =
      antraege === undefined ||
      antraege.some((a) => a.ziel_art === 'einsatz' && a.stand === 'offen');
    return { person: true, einsatz: !einsatzOffen, archiv: true };
  }
  return { person: true, einsatz: akte.zustand !== 'schwaerzung_beantragt', archiv: false };
}

/** Ein fälliger Personen-Antrag am archivierten Einsatz: den vollzieht kein Purge-Lauf, sondern
 *  der Befehl mit dem Archiv-Schlüssel. */
function wartetAufBefehl(a: Schwaerzungsantrag, archiv: boolean): boolean {
  return archiv && a.stand === 'offen' && a.ziel_art !== 'einsatz' && !a.zuruecknehmbar;
}

export default function Loeschersuchen({
  einsatzId,
  akte,
}: {
  einsatzId: number;
  akte: ArchivAkte;
}) {
  const qc = useQueryClient();
  const { token } = theme.useToken();
  const [sucheOffen, setSucheOffen] = useState(false);
  const [ziel, setZiel] = useState<AntragZielWahl | null>(null);
  const [kennungOffen, setKennungOffen] = useState(false);
  const einsatzKennung = akte.kopf.einsatznummer_intern ?? `#${akte.kopf.id}`;

  const abfrage = useQuery({
    queryKey: globalKeys.aufbewahrungAntraege(einsatzId),
    queryFn: () => ladeSchwaerzungsantraege(einsatzId),
  });
  const wege = antragswege(akte, abfrage.data);
  const ruecknahme = useMutation({
    mutationFn: (antragId: number) => nimmSchwaerzungsantragZurueck(einsatzId, antragId),
    // Auch nach einer Ablehnung (409, z. B. Frist inzwischen abgelaufen) neu laden, sonst
    // bliebe „Zurücknehmen“ an einem nicht mehr zurücknehmbaren Antrag stehen.
    onSettled: () => void qc.invalidateQueries({ queryKey: globalKeys.aufbewahrung() }),
  });

  const spalten: KatalogSpalte<Schwaerzungsantrag>[] = [
    {
      key: 'ziel',
      title: 'Ziel',
      width: 120,
      zahl: true,
      sorter: nachText((a: Schwaerzungsantrag) => a.ziel_kennung),
      render: (_, a) => a.ziel_kennung,
    },
    {
      key: 'art',
      title: 'Art',
      width: 220,
      sorter: nachText((a: Schwaerzungsantrag) => ZIEL_ART[a.ziel_art]),
      filters: werteAusKatalog(ZIEL_ART),
      onFilter: (w, a) => a.ziel_art === w,
      render: (_, a) => ZIEL_ART[a.ziel_art],
    },
    {
      key: 'aktenzeichen',
      title: 'Aktenzeichen',
      width: 170,
      zahl: true,
      sorter: nachText((a: Schwaerzungsantrag) => a.aktenzeichen),
      render: (_, a) => a.aktenzeichen,
    },
    {
      key: 'stand',
      title: 'Stand',
      width: 150,
      sorter: nachFolge(Object.keys(schwaerzungsantragStand), (a: Schwaerzungsantrag) => a.stand),
      filters: werteAusKatalog(schwaerzungsantragStand),
      onFilter: (w, a) => a.stand === w,
      render: (_, a) => <StatusTag darstellung={schwaerzungsantragStand[a.stand]} />,
    },
    {
      key: 'beantragt',
      title: 'Beantragt',
      width: 220,
      sorter: nachText((a: Schwaerzungsantrag) => a.beantragt_at),
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
      sorter: nachText((a: Schwaerzungsantrag) => a.faellig_at),
      render: (_, a) => <ZeitAnzeige wert={a.faellig_at} />,
    },
    {
      key: 'erledigt',
      title: 'Erledigt',
      width: 240,
      render: (_, a) => {
        if (a.vollzogen_at) return <ZeitAnzeige wert={a.vollzogen_at} />;
        if (wartetAufBefehl(a, wege.archiv)) {
          return (
            <Typography.Text type="warning">wartet auf Befehl mit Archiv-Schlüssel</Typography.Text>
          );
        }
        if (a.zurueckgenommen_at) {
          return (
            <>
              <ZeitAnzeige wert={a.zurueckgenommen_at} /> · {a.zurueckgenommen_von_name ?? leer}
            </>
          );
        }
        return leer;
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
        {wege.person &&
          (wege.archiv ? (
            <Button onClick={() => setKennungOffen(true)}>Person per Kennung schwärzen</Button>
          ) : (
            <Button onClick={() => setSucheOffen(true)}>Person suchen und schwärzen</Button>
          ))}
        {wege.einsatz && (
          <Button danger onClick={() => setZiel({ art: 'einsatz', kennung: einsatzKennung })}>
            {wege.archiv ? 'Einsatz und Archiv löschen' : 'Einsatz sofort schwärzen'}
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
        mehrzahl="Löschersuchen"
      />
    );
  }

  return (
    <Paneel titel="Löschersuchen (Art. 17)" meta="24 h zurücknehmbar" koerperPolster>
      <div data-lfh="loeschersuchen">
        {/* Die Aktionen stehen im Körper, nicht im Paneelkopf: dessen Aktionsslot schrumpft nie,
            und zwei Knöpfe liefen bei 390 px über (Review LFH-751). */}
        {aktionen && <div style={{ marginBottom: token.marginSM }}>{aktionen}</div>}
        {inhalt}
        <SpeicherFehler fehler={ruecknahme.error} titel="Rücknahme fehlgeschlagen" />
        {!wege.person && (
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Einsatz bereits geschwärzt
          </Typography.Paragraph>
        )}
      </div>
      {kennungOffen && (
        <ArchivPersonAntragDialog
          einsatzId={einsatzId}
          onSchliessen={() => setKennungOffen(false)}
        />
      )}
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
          archiv={wege.archiv}
          onSchliessen={() => setZiel(null)}
        />
      )}
    </Paneel>
  );
}
