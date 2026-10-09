import { useId, useState } from 'react';
import { Alert, Button, Space, Spin } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { IconKachelraster } from '../icons';
import { useAuth } from '../auth/AuthContext';
import { ladeEinsatz } from '../api/einsaetze';
import { ladeUhs } from '../api/einsatzUhs';
import { listePersonen } from '../api/einsatzPerson';
import { einsatzKeys } from '../api/queryKeys';
import type { Person, UhsDetail } from '../api/types';
import EinsatzSeite from '../components/EinsatzSeite';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import { Kennzahl, Kennzahlenband, Segmentleiste } from '../components/instrument';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import MaterialTab from '../pages/uhs/MaterialTab';
import UhsAnhaenge from '../pages/uhs/UhsAnhaenge';
import UhsKraefte from '../pages/uhs/UhsKraefte';
import { geraetUhsPfad } from '../routing/deeplinks';
import GeraetMeldungen from './GeraetMeldungen';

const BEREICH_NAME = {
  plaetze: 'Plätze',
  kraefte: 'Kräfte',
  material: 'Material',
  meldungen: 'Meldungen',
  dateien: 'Dateien',
} as const;
type Bereich = keyof typeof BEREICH_NAME;
const BEREICHE = Object.keys(BEREICH_NAME) as Bereich[];

/** Belegung der Plätze in Zahlen: belegt zählt die Personen auf einem Platz, nicht die Karten. */
export function platzZahlen(uhs: UhsDetail, belegtePlatzIds: ReadonlySet<number>) {
  const plaetze = uhs.plaetze.filter((p) => !p.storniert_at && p.typ !== 'wartebereich');
  const belegt = plaetze.filter((p) => belegtePlatzIds.has(p.id)).length;
  const nichtVerfuegbar = plaetze.filter(
    (p) => !belegtePlatzIds.has(p.id) && p.verfuegbarkeit !== 'frei',
  ).length;
  return {
    gesamt: plaetze.length,
    belegt,
    frei: plaetze.length - belegt - nichtVerfuegbar,
    nichtVerfuegbar,
  };
}

/** Belegte Plätze wie im Grundriss: der aktuelle Platz jeder Person in dieser UHS. */
function belegtePlaetze(uhs: UhsDetail, personen: readonly Person[]): Set<number> {
  const ids = new Set<number>();
  for (const p of personen) {
    if (!p.storniert_at && p.aktuelle_uhs_id === uhs.id && p.aktueller_platz_id != null) {
      ids.add(p.aktueller_platz_id);
    }
  }
  return ids;
}

function PlaetzeBereich({ einsatzId, uhs }: { einsatzId: number; uhs: UhsDetail }) {
  const navigate = useNavigate();
  const personenQuery = useQuery({
    queryKey: einsatzKeys.personen(einsatzId),
    queryFn: () => listePersonen(einsatzId),
  });
  const zustand = personenQuery.isError ? 'fehler' : personenQuery.isLoading ? 'laden' : 'daten';
  const z = platzZahlen(uhs, belegtePlaetze(uhs, personenQuery.data ?? []));
  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Kennzahlenband beschriftung="Plätze in Zahlen">
        <Kennzahl titel="Plätze" wert={z.gesamt} />
        <Kennzahl
          titel="Belegt"
          wert={z.belegt}
          zustand={zustand}
          ton={z.belegt > 0 ? 'bedien' : 'neutral'}
        />
        <Kennzahl titel="Frei" wert={z.frei} zustand={zustand} ton="normal" />
        <Kennzahl
          titel="Nicht verfügbar"
          wert={z.nichtVerfuegbar}
          zustand={zustand}
          ton={z.nichtVerfuegbar > 0 ? 'achtung' : 'neutral'}
        />
      </Kennzahlenband>
      <Button
        icon={<IconKachelraster />}
        onClick={() => navigate(geraetUhsPfad(einsatzId, uhs.id))}
      >
        Grundriss bearbeiten
      </Button>
    </Space>
  );
}

/**
 * Bereich „UHS“ des UHS-Laptops (LFH-892, Subtask LFH-1025; Spec `feldgeraet-bedienung`): Plätze
 * in Zahlen mit dem Weg in den Grundriss, Stärke und Kräfte der UHS (LFH-1045), Material der
 * eigenen UHS zum Lesen, Meldungen an die Einsatzleitung und die Dateien der UHS. Der Grundriss
 * selbst bleibt der eigene Bereich.
 */
export default function GeraetStellePage() {
  const { geraet } = useAuth();
  const einsatzId = geraet?.einsatz_id ?? 0;
  const uhsId = geraet?.uhs_id ?? null;
  const [bereich, setBereich] = useState<Bereich>('plaetze');
  const feld = useId();

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
    enabled: geraet != null,
  });
  const uhsQuery = useQuery({
    queryKey: einsatzKeys.uhsDetail(einsatzId, uhsId ?? 0),
    queryFn: () => ladeUhs(einsatzId, uhsId!),
    enabled: geraet != null && uhsId != null,
  });
  const uhs = uhsQuery.data;
  const schreibgeschuetzt = !darfImEinsatzSchreiben(einsatzQuery.data);

  return (
    <EinsatzSeite
      titel="UHS"
      meta={uhs?.bezeichnung}
      dataUpdatedAt={gemeinsamerDatenstand(einsatzQuery.dataUpdatedAt, uhsQuery.dataUpdatedAt)}
    >
      {uhsQuery.isError ? (
        <Alert type="error" showIcon title="UHS konnte nicht geladen werden" />
      ) : !uhs ? (
        <Spin />
      ) : (
        <>
          <Segmentleiste
            rolle="tablist"
            beschriftung="Plätze, Kräfte, Material, Meldungen und Dateien"
            wert={bereich}
            onWechsel={setBereich}
            optionen={BEREICHE.map((b) => ({ wert: b, label: BEREICH_NAME[b], steuert: feld }))}
            style={{ marginBottom: 12 }}
          />
          <div role="tabpanel" id={feld} aria-label={BEREICH_NAME[bereich]}>
            {bereich === 'plaetze' ? (
              <PlaetzeBereich einsatzId={einsatzId} uhs={uhs} />
            ) : bereich === 'kraefte' ? (
              <UhsKraefte
                einsatzId={einsatzId}
                uhs={uhs}
                schreibgeschuetzt={schreibgeschuetzt}
                einheitZuordnen={false}
              />
            ) : bereich === 'material' ? (
              <MaterialTab einsatzId={einsatzId} uhs={uhs} schreibgeschuetzt />
            ) : bereich === 'meldungen' ? (
              <GeraetMeldungen
                einsatzId={einsatzId}
                absender={[uhs.bezeichnung, geraet?.bezeichnung].filter(Boolean).join(' · ')}
                schreibgeschuetzt={schreibgeschuetzt}
              />
            ) : (
              <UhsAnhaenge
                einsatzId={einsatzId}
                uhs={uhs}
                darfSchreiben={!schreibgeschuetzt}
                zeigeZugriffe={false}
              />
            )}
          </div>
        </>
      )}
    </EinsatzSeite>
  );
}
