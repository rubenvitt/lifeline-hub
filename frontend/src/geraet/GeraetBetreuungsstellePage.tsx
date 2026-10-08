import { useId, useState } from 'react';
import { Alert, App, Button, Space, Spin } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { ladeBetreuung } from '../api/betreuung';
import { ladeEinsatz } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';
import type { Betreuungsstelle, BelegungsmeldungEingabe } from '../api/types';
import { BelegungMeldenDialog } from '../betreuung/BetreuungDialoge';
import MeldeVerlauf from '../betreuung/MeldeVerlauf';
import { GESCHLOSSEN_HINWEIS } from '../betreuung/StellenBlock';
import { personenZahl } from '../betreuung/betreuungText';
import EinsatzSeite from '../components/EinsatzSeite';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import { Kennzahl, Kennzahlenband, Paneel, Segmentleiste } from '../components/instrument';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { erfasseBelegungOfflineFaehig } from '../offline/schreiben';
import GeraetMeldungen from './GeraetMeldungen';

const BEREICH_NAME = { belegung: 'Belegung', meldungen: 'Meldungen' } as const;
type Bereich = keyof typeof BEREICH_NAME;
const BEREICHE = Object.keys(BEREICH_NAME) as Bereich[];

/** Freie Plätze, nur wenn Kapazität und Belegung bekannt sind; nie negativ. */
export function freiePlaetze(stelle: Betreuungsstelle): number | null {
  if (stelle.kapazitaet_personen == null || !stelle.belegung) return null;
  return Math.max(0, stelle.kapazitaet_personen - stelle.belegung.belegt);
}

function BelegungBereich({
  einsatzId,
  stelle,
  namentlich,
  darfSchreiben,
}: {
  einsatzId: number;
  stelle: Betreuungsstelle;
  namentlich: number | undefined;
  darfSchreiben: boolean;
}) {
  const geschlossen = stelle.status === 'geschlossen';
  const frei = freiePlaetze(stelle);
  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Kennzahlenband beschriftung="Belegung in Zahlen">
        <Kennzahl
          titel="Belegt"
          wert={stelle.belegung ? personenZahl(stelle.belegung.belegt) : '—'}
          ton={stelle.belegung ? 'bedien' : 'neutral'}
        />
        <Kennzahl
          titel="Kapazität"
          wert={stelle.kapazitaet_personen != null ? personenZahl(stelle.kapazitaet_personen) : '—'}
        />
        <Kennzahl
          titel="Frei"
          wert={frei != null ? personenZahl(frei) : '—'}
          ton={frei === 0 ? 'achtung' : frei != null ? 'normal' : 'neutral'}
        />
        {/* Nur mit Personenrecht geliefert; ein Hinweis neben der Mengenmeldung, kein Summand. */}
        {namentlich !== undefined && (
          <Kennzahl titel="Davon namentlich" wert={personenZahl(namentlich)} />
        )}
      </Kennzahlenband>
      <Paneel titel="Meldeverlauf" koerperPolster>
        <MeldeVerlauf
          einsatzId={einsatzId}
          art="stelle"
          objektId={stelle.id}
          darfZuruecknehmen={darfSchreiben && !geschlossen}
          sperrHinweis={darfSchreiben && geschlossen ? GESCHLOSSEN_HINWEIS : undefined}
        />
      </Paneel>
    </Space>
  );
}

/**
 * Bereich „Stelle“ der Betreuungsstelle (LFH-1041, Spec `funktionsansichten`): Belegung der eigenen
 * Stelle in Zahlen mit Meldeverlauf und „Belegung melden“, dazu Meldungen an die Einsatzleitung.
 * Stammdaten und Status der Stelle bleiben bei der Einsatzleitung. Die Mengenmeldung ist führend;
 * „davon namentlich“ zählt nur die hier Aufgenommenen.
 */
export default function GeraetBetreuungsstellePage() {
  const { geraet, benutzer } = useAuth();
  const einsatzId = geraet?.einsatz_id ?? 0;
  const stelleId = geraet?.stelle_id ?? null;
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [bereich, setBereich] = useState<Bereich>('belegung');
  const [meldenOffen, setMeldenOffen] = useState(false);
  const feld = useId();

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
    enabled: geraet != null,
  });
  const betreuungQuery = useQuery({
    queryKey: einsatzKeys.betreuung(einsatzId),
    queryFn: () => ladeBetreuung(einsatzId),
    enabled: geraet != null,
  });
  const stelle = betreuungQuery.data?.stellen.find((s) => s.id === stelleId);
  const namentlich = betreuungQuery.data?.namentlich
    ? (betreuungQuery.data.namentlich.find((n) => n.stelle_id === stelleId)?.anzahl ?? 0)
    : undefined;
  const darfSchreiben = darfImEinsatzSchreiben(einsatzQuery.data, benutzer);

  const belegungMut = useMutation({
    // Die Funktion merkt ohne Netz selbst vor; TanStacks Vorgabe hielte die Mutation an
    // (LFH-705, design.md D6).
    networkMode: 'always',
    mutationFn: ({ ziel, body }: { ziel: Betreuungsstelle; body: BelegungsmeldungEingabe }) => {
      if (!benutzer) throw new Error('Nicht angemeldet');
      return erfasseBelegungOfflineFaehig(benutzer.id, einsatzId, ziel, body);
    },
    onSuccess: (ergebnis, { ziel, body }) => {
      if (ergebnis.zustand === 'vorgemerkt') {
        message.warning(`Offline vorgemerkt: Belegungsmeldung ${ziel.bezeichnung}`);
        return;
      }
      void qc.invalidateQueries({ queryKey: einsatzKeys.betreuung(einsatzId) });
      message.success(`Belegung gemeldet: ${personenZahl(body.belegt)} untergebracht`);
    },
  });

  return (
    <EinsatzSeite
      titel="Stelle"
      meta={stelle?.bezeichnung ?? geraet?.stelle ?? undefined}
      dataUpdatedAt={gemeinsamerDatenstand(
        einsatzQuery.dataUpdatedAt,
        betreuungQuery.dataUpdatedAt,
      )}
      aktionen={
        darfSchreiben &&
        stelle &&
        stelle.status !== 'geschlossen' && (
          <Button type="primary" onClick={() => setMeldenOffen(true)}>
            Belegung melden
          </Button>
        )
      }
    >
      {betreuungQuery.isError ? (
        <Alert type="error" showIcon title="Stelle konnte nicht geladen werden" />
      ) : betreuungQuery.isLoading ? (
        <Spin />
      ) : !stelle ? (
        <Alert type="warning" showIcon title="Stelle nicht mehr vorhanden" />
      ) : (
        <>
          <Segmentleiste
            rolle="tablist"
            beschriftung="Belegung und Meldungen"
            wert={bereich}
            onWechsel={setBereich}
            optionen={BEREICHE.map((b) => ({ wert: b, label: BEREICH_NAME[b], steuert: feld }))}
            style={{ marginBottom: 12 }}
          />
          <div role="tabpanel" id={feld} aria-label={BEREICH_NAME[bereich]}>
            {bereich === 'belegung' ? (
              <BelegungBereich
                einsatzId={einsatzId}
                stelle={stelle}
                namentlich={namentlich}
                darfSchreiben={darfSchreiben}
              />
            ) : (
              <GeraetMeldungen
                einsatzId={einsatzId}
                stelle={stelle.bezeichnung}
                schreibgeschuetzt={!darfSchreiben}
              />
            )}
          </div>
          {meldenOffen && (
            <BelegungMeldenDialog
              stelle={stelle}
              laeuft={belegungMut.isPending}
              fehler={belegungMut.error}
              onErfassen={(body) => belegungMut.mutateAsync({ ziel: stelle, body })}
              onSchliessen={() => setMeldenOffen(false)}
            />
          )}
        </>
      )}
    </EinsatzSeite>
  );
}
