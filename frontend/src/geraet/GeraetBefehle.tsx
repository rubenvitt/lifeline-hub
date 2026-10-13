import { Alert, App, Button, Flex, Space, Typography } from 'antd';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ladeBefehl,
  listeBefehle,
  nimmBefehlQuittungZurueck,
  quittiereBefehlEmpfang,
} from '../api/befehle';
import { einsatzKeys } from '../api/queryKeys';
import type { BefehlAnzeige, BefehlKopf } from '../api/types';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import BefehlLesefassung from '../auftraege/BefehlLesefassung';
import EmpfaengerQuittung from '../auftraege/EmpfaengerQuittung';
import { befehlSchemaLabel } from '../auftraege/befehlTexte';
import { vorlage } from '../befehle/vorlagen';
import { Augenbraue, monoStil, useRollen } from '../components/instrument';
import { SeitenSkeleton } from '../components/SeitenZustand';
import { useZeilenFehler, type ZeilenGrund } from '../components/useZeilenFehler';
import KommKarte from '../kommunikation/KommKarte';
import type { EmpfaengerZiel } from './GeraetAuftraegePage';
import { zeigeRueckgaengig } from '../kommunikation/rueckgaengig';

const { Text } = Typography;

type QuittungsZiel = { befehlId: number; eintragId: number };

/**
 * Einsatzbefehle an den Bereich des Abschnittsgeräts (LLH-1190, `geraet/AGENTS.md`,
 * „Abschnittsansicht“). Der Server liefert nur die geltenden Fassungen mit
 * einem Verteiler-Eintrag im Bereich; hier stehen sie als Karten unter den Aufträgen, mit
 * „Quittieren“ nur an den eigenen Einträgen. Quittiert wird wie im Befehlsdetail der Leitung mit
 * einem Klick und dem Hinweis „Rückgängig“ (LFH-343), Ablehnungen stehen an der Karte (LFH-1077).
 * Ohne Befehl an den Bereich bleibt der Block weg.
 */
export default function GeraetBefehle({
  einsatzId,
  darfSchreiben,
  isEigen,
}: {
  einsatzId: number;
  darfSchreiben: boolean;
  /** Ob ein Verteiler-Eintrag zum Bereich gehört (`isEigenerEmpfaenger` der Seite). */
  isEigen: (e: EmpfaengerZiel) => boolean;
}) {
  const { token } = useRollen();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const befehleQuery = useQuery({
    queryKey: einsatzKeys.befehle(einsatzId),
    queryFn: () => listeBefehle(einsatzId),
  });

  const quittungErrors = useZeilenFehler<number>();
  const applyQuittung = (stand: BefehlAnzeige) => {
    qc.setQueryData(einsatzKeys.befehl(einsatzId, stand.id), stand);
    void qc.invalidateQueries({ queryKey: einsatzKeys.befehle(einsatzId) });
  };
  const zuruecknehmenMutation = useMutation({
    mutationFn: ({ befehlId, eintragId }: QuittungsZiel) =>
      nimmBefehlQuittungZurueck(einsatzId, befehlId, eintragId),
    onMutate: ({ befehlId }) => quittungErrors.beginne(befehlId),
    onSuccess: applyQuittung,
    onError: (e, { befehlId }) =>
      quittungErrors.melde(befehlId, e, 'Quittung nicht zurückgenommen'),
  });
  const quittierenMutation = useMutation({
    mutationFn: ({ befehlId, eintragId }: QuittungsZiel) =>
      quittiereBefehlEmpfang(einsatzId, befehlId, eintragId),
    onMutate: ({ befehlId }) => quittungErrors.beginne(befehlId),
    onSuccess: (stand, ziel) => {
      applyQuittung(stand);
      zeigeRueckgaengig(message, 'Empfang quittiert', () => zuruecknehmenMutation.mutate(ziel));
    },
    onError: (e, { befehlId }) => quittungErrors.melde(befehlId, e, 'Quittung fehlgeschlagen'),
  });
  const isQuittungPending = quittierenMutation.isPending || zuruecknehmenMutation.isPending;

  const befehle = befehleQuery.data ?? [];
  if (befehleQuery.isError) {
    return (
      <Alert
        type="error"
        showIcon
        title="Einsatzbefehle konnten nicht geladen werden"
        style={{ marginTop: token.marginLG }}
      />
    );
  }
  if (befehle.length === 0) return null;
  return (
    <section data-lfh="geraet-befehle" style={{ marginTop: token.marginLG }}>
      <Augenbraue als="h2" style={{ display: 'block', marginBottom: token.marginXS }}>
        Einsatzbefehle
      </Augenbraue>
      {befehle.map((b) => (
        <BefehlKarte
          key={b.id}
          befehl={b}
          einsatzId={einsatzId}
          darfSchreiben={darfSchreiben}
          isEigen={isEigen}
          isLocked={isQuittungPending}
          pendingId={
            quittierenMutation.isPending && quittierenMutation.variables.befehlId === b.id
              ? quittierenMutation.variables.eintragId
              : null
          }
          onQuittieren={(eintragId) => quittierenMutation.mutate({ befehlId: b.id, eintragId })}
          error={quittungErrors.grund(b.id)}
        />
      ))}
    </section>
  );
}

function BefehlKarte({
  befehl: b,
  einsatzId,
  darfSchreiben,
  isEigen,
  isLocked,
  pendingId,
  onQuittieren,
  error,
}: {
  befehl: BefehlKopf;
  einsatzId: number;
  darfSchreiben: boolean;
  isEigen: (e: EmpfaengerZiel) => boolean;
  isLocked: boolean;
  pendingId: number | null;
  onQuittieren: (eintragId: number) => void;
  error: ZeilenGrund | null;
}) {
  const { token, rollen } = useRollen();
  const [isTextOffen, setIsTextOffen] = useState(false);
  // Den Text liefert nur das Detail (LFH-931); geladen wird er erst beim Aufklappen.
  const detailQuery = useQuery({
    queryKey: einsatzKeys.befehl(einsatzId, b.id),
    queryFn: () => ladeBefehl(einsatzId, b.id),
    enabled: isTextOffen,
  });
  const verteiler = b.verteiler ?? [];
  const eigeneIds = new Set(verteiler.filter(isEigen).map((e) => e.id));
  const hasEigenOffen = verteiler.some((e) => eigeneIds.has(e.id) && !e.quittiert_at);
  const textId = `geraet-befehl-text-${b.id}`;
  return (
    <KommKarte
      data-befehl-id={b.id}
      unbearbeitet={hasEigenOffen}
      zeit={
        <>
          <span style={{ display: 'block', ...monoStil(10), color: rollen.schwach }}>Stand</span>
          <span>
            <ZeitAnzeige wert={b.zeitstand} format="uhrzeit" />
          </span>
        </>
      }
      nr={`v${b.version}`}
    >
      <Space size={6} wrap style={{ marginBottom: 6 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {befehlSchemaLabel(b.vorlage)}
        </Text>
      </Space>
      <Text strong style={{ display: 'block', fontSize: 15, lineHeight: 1.4 }}>
        {b.titel}
      </Text>
      {b.freigegeben_at && (
        <Flex gap={8} wrap style={{ marginTop: 4, ...monoStil(11), color: rollen.gedaempft }}>
          <span>
            freigegeben <ZeitAnzeige wert={b.freigegeben_at} format="uhrzeit" />
            {b.freigegeben_von_name ? ` von ${b.freigegeben_von_name}` : ''}
          </span>
        </Flex>
      )}
      <div style={{ marginTop: token.marginSM }}>
        <EmpfaengerQuittung
          zeilen={verteiler.map((e) => ({
            id: e.id,
            name: e.snap_anzeige,
            ariaName: e.snap_anzeige,
            quittiertAt: e.quittiert_at,
          }))}
          canQuittieren={darfSchreiben && b.is_quittierbar === true}
          canQuittierenFor={(id) => eigeneIds.has(id)}
          isLocked={isLocked}
          pendingId={pendingId}
          onQuittieren={onQuittieren}
          error={error}
        />
      </div>
      <Button
        aria-expanded={isTextOffen}
        aria-controls={textId}
        onClick={() => setIsTextOffen((o) => !o)}
      >
        Befehlstext
      </Button>
      {isTextOffen && (
        <div id={textId} style={{ marginTop: token.marginSM }}>
          {detailQuery.data ? (
            <BefehlLesefassung
              vorlage={vorlage(detailQuery.data.vorlage)}
              abschnitte={detailQuery.data.abschnitte}
              ebene={3}
            />
          ) : detailQuery.isError ? (
            <Alert type="error" showIcon title="Befehlstext konnte nicht geladen werden" />
          ) : (
            <SeitenSkeleton />
          )}
        </div>
      )}
    </KommKarte>
  );
}
