import { useState } from 'react';
import { Alert, Collapse } from 'antd';
import { useQuery } from '@tanstack/react-query';
import {
  entferneUhsAnhang,
  ladeUhsAnhangZugriffe,
  legeUhsAnhangAb,
  listeUhsAnhaenge,
  uhsAnhangDownloadPfad,
} from '../../api/einsatzUhs';
import { einsatzKeys } from '../../api/queryKeys';
import type { AnhangZugriff, Uhs } from '../../api/types';
import ErfassungsAnhaenge from '../../components/erfassungsAnhaenge/ErfassungsAnhaenge';
import KatalogTabelle, { type KatalogSpalte } from '../../components/KatalogTabelle';
import ZeitAnzeige from '../../anzeige/ZeitAnzeige';

/** Steht im Ablegen-Dialog (Spec `uhs-anhaenge`, „Hinweis auf die Protokollierung“). */
export const UHS_ABLAGE_HINWEIS =
  'Jeder Abruf einer Datei wird mit Person und Zeitpunkt protokolliert.';

const FASSUNG: Record<AnhangZugriff['fassung'], string> = {
  bereinigt: 'bereinigt',
  original: 'Original (mit Standort)',
};

interface Props {
  einsatzId: number;
  uhs: Pick<Uhs, 'id' | 'bezeichnung' | 'storniert_at'>;
  /** Schreibrecht im Einsatz (Rolle + aktiver Einsatz), wie die übrigen Aktionen der Seite. */
  darfSchreiben: boolean;
  /** Nur die Einsatzleitung sieht das Zugriffsprotokoll (Server: sonst 403). */
  zeigeZugriffe: boolean;
}

/**
 * Reiter „Dateien“ der UHS-Detailseite (LFH-758, Spec `uhs-anhaenge`): Fotos, Unterlagen und der
 * Plan einer Unfallhilfsstelle. Die UHS-Hülle um `ErfassungsAnhaenge`; jeder Download steht
 * serverseitig im Zugriffsprotokoll, darauf weist der Ablegen-Dialog hin. Die Einsatzleitung
 * sieht darunter „Zugriffe“.
 */
export default function UhsAnhaenge({ einsatzId, uhs, darfSchreiben, zeigeZugriffe }: Props) {
  return (
    <ErfassungsAnhaenge
      einsatzId={einsatzId}
      bezug={`UHS ${uhs.bezeichnung}`}
      darfSchreiben={darfSchreiben}
      gesperrt={!!uhs.storniert_at}
      zeilenKennung="uhs-anhang-zeile"
      hinweis={UHS_ABLAGE_HINWEIS}
      quelle={{
        queryKey: einsatzKeys.uhsAnhaenge(einsatzId, uhs.id),
        liste: () => listeUhsAnhaenge(einsatzId, uhs.id),
        ablegen: (datei) => legeUhsAnhangAb(einsatzId, uhs.id, datei),
        entfernen: (id) => entferneUhsAnhang(einsatzId, uhs.id, id),
        downloadPfad: (id) => uhsAnhangDownloadPfad(einsatzId, uhs.id, id),
      }}
    >
      {/* `key`: beim Wechsel der UHS (Switcher, gleiche Route) beginnt der Bereich zugeklappt —
          das Protokoll der nächsten UHS lädt erst auf ihren eigenen Klick. */}
      {zeigeZugriffe && <UhsAnhangZugriffe key={uhs.id} einsatzId={einsatzId} uhsId={uhs.id} />}
    </ErfassungsAnhaenge>
  );
}

/**
 * „Zugriffe“: das Protokoll der Datei-Abrufe dieser UHS, auch entfernter Dateien. Lädt erst beim
 * Aufklappen und ohne Wiederholung — wie das Personen-Audit; der Key ist bewusst nicht live
 * (`NICHT_LIVE_KEYS`). Die Einsicht selbst wird nicht protokolliert.
 */
function UhsAnhangZugriffe({ einsatzId, uhsId }: { einsatzId: number; uhsId: number }) {
  const [offen, setOffen] = useState(false);
  const query = useQuery({
    queryKey: einsatzKeys.uhsAnhangZugriffe(einsatzId, uhsId),
    queryFn: () => ladeUhsAnhangZugriffe(einsatzId, uhsId),
    enabled: offen,
    retry: false,
  });
  const spalten: KatalogSpalte<AnhangZugriff>[] = [
    {
      title: 'Wann',
      dataIndex: 'zugriff_at',
      key: 'zugriff_at',
      render: (v: string) => <ZeitAnzeige wert={v} format="dtgVoll" />,
    },
    { title: 'Wer', dataIndex: 'benutzer_name', key: 'benutzer_name' },
    { title: 'Datei', dataIndex: 'dateiname', key: 'dateiname' },
    {
      title: 'Fassung',
      dataIndex: 'fassung',
      key: 'fassung',
      render: (f: AnhangZugriff['fassung']) => FASSUNG[f],
    },
  ];
  return (
    <Collapse
      ghost
      activeKey={offen ? ['zugriffe'] : []}
      onChange={(k: string | string[]) =>
        setOffen((Array.isArray(k) ? k : [k]).includes('zugriffe'))
      }
      items={[
        {
          key: 'zugriffe',
          label: 'Zugriffe',
          children: query.isError ? (
            <Alert type="error" showIcon title="Zugriffe konnten nicht geladen werden" />
          ) : (
            <KatalogTabelle<AnhangZugriff>
              rowKey="id"
              pagination={false}
              loading={query.isLoading}
              dataSource={query.data ?? []}
              columns={spalten}
              locale={{ emptyText: 'Noch keine Zugriffe' }}
            />
          ),
        },
      ]}
    />
  );
}
