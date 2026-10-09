import { useCallback, useMemo, useState } from 'react';
import { Alert, App, Spin } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { listeOffeneAuftraege, quittiereEmpfaenger, setzeVollzug } from '../api/auftraege';
import { ladeEinsatz } from '../api/einsaetze';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinheiten } from '../api/einheiten';
import { einsatzKeys } from '../api/queryKeys';
import type { Auftrag, AuftragEmpfaenger } from '../api/types';
import AuftragListe from '../auftraege/AuftragListe';
import VollzugMeldenModal from '../auftraege/VollzugMeldenModal';
import EinsatzSeite from '../components/EinsatzSeite';
import { SeitenLeer } from '../components/SeitenZustand';
import { useFehlerMeldung } from '../components/useFehlerMeldung';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { prioRang } from '../kommunikation';

/**
 * Ob eine Empfängerzeile zum Bereich des Geräts gehört: ein Abschnitt des Teilbaums oder eine
 * Einheit darin. Die Mengen kommen aus den Listen, die der Server schon zugeschnitten hat.
 */
export function istEigenerEmpfaenger(
  e: Pick<AuftragEmpfaenger, 'abschnitt_id' | 'einheit_id'>,
  abschnitte: ReadonlySet<number>,
  einheiten: ReadonlySet<number>,
): boolean {
  return (
    (e.abschnitt_id != null && abschnitte.has(e.abschnitt_id)) ||
    (e.einheit_id != null && einheiten.has(e.einheit_id))
  );
}

/** Dringendes zuerst, dann die früheste Frist. */
function vergleiche(a: Auftrag, b: Auftrag): number {
  return (
    prioRang(a.prioritaet) - prioRang(b.prioritaet) ||
    (a.frist_at ?? '￿').localeCompare(b.frist_at ?? '￿')
  );
}

/**
 * Aufträge des Abschnittsgeräts (LFH-1043, Spec `funktionsansichten`): die offenen Aufträge an den
 * eigenen Teilbaum und seine Einheiten, mit Quittung je eigener Empfängerzeile, „In Bearbeitung“
 * und „Vollzug melden“. Erteilen und Abnehmen fehlen; die Liste schneidet der Server zu. Kein
 * Rückverweis ins ETB: das liest das Gerät nicht.
 */
export default function GeraetAuftraegePage() {
  const { geraet } = useAuth();
  const einsatzId = geraet?.einsatz_id ?? 0;
  const qc = useQueryClient();
  const { message } = App.useApp();
  const fehler = useFehlerMeldung();
  const [vollzugFuer, setVollzugFuer] = useState<number | null>(null);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
    enabled: geraet != null,
  });
  const auftraegeQuery = useQuery({
    queryKey: einsatzKeys.auftraegePhase(einsatzId, 'offen', 'alle', 'alle'),
    queryFn: () => listeOffeneAuftraege(einsatzId),
    enabled: geraet != null,
  });
  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
    enabled: geraet != null,
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
    enabled: geraet != null,
  });
  const darfSchreiben = darfImEinsatzSchreiben(einsatzQuery.data);

  const eigeneAbschnitte = useMemo(
    () => new Set((abschnitteQuery.data ?? []).map((a) => a.id)),
    [abschnitteQuery.data],
  );
  const eigeneEinheiten = useMemo(
    () => new Set((einheitenQuery.data ?? []).map((e) => e.id)),
    [einheitenQuery.data],
  );
  const darfQuittierenFuer = useCallback(
    (e: AuftragEmpfaenger) => istEigenerEmpfaenger(e, eigeneAbschnitte, eigeneEinheiten),
    [eigeneAbschnitte, eigeneEinheiten],
  );

  const invalidiere = () => qc.invalidateQueries({ queryKey: einsatzKeys.auftraege(einsatzId) });
  const quittieren = useMutation({
    mutationFn: (z: { auftragId: number; empfaengerId: number }) =>
      quittiereEmpfaenger(einsatzId, z.auftragId, z.empfaengerId),
    onSuccess: () => {
      message.success('Empfang quittiert');
      void invalidiere();
    },
    onError: fehler,
  });
  const vollzug = useMutation({
    mutationFn: (v: { auftragId: number; status: 'in_arbeit' | 'vollzogen'; text?: string }) =>
      setzeVollzug(einsatzId, v.auftragId, v.status, v.text),
    onSuccess: (_d, v) => {
      setVollzugFuer(null);
      message.success(v.status === 'vollzogen' ? 'Vollzug gemeldet' : 'Auftrag in Bearbeitung');
      void invalidiere();
    },
    onError: fehler,
  });

  const auftraege = useMemo(
    () =>
      (auftraegeQuery.data ?? [])
        .filter((a) => a.bearbeitungsstatus === 'offen' || a.bearbeitungsstatus === 'in_arbeit')
        .sort(vergleiche),
    [auftraegeQuery.data],
  );

  return (
    <EinsatzSeite titel="Aufträge" dataUpdatedAt={auftraegeQuery.dataUpdatedAt}>
      {auftraegeQuery.isError ? (
        <Alert type="error" showIcon title="Aufträge konnten nicht geladen werden" />
      ) : auftraegeQuery.isLoading ? (
        <Spin />
      ) : auftraege.length === 0 ? (
        <SeitenLeer titel="Keine offenen Aufträge" />
      ) : (
        <AuftragListe
          auftraege={auftraege}
          darfSchreiben={darfSchreiben}
          quittierungLaeuft={quittieren.isPending}
          quittierungZiel={quittieren.isPending ? quittieren.variables : null}
          onQuittieren={(auftragId, empfaengerId) => quittieren.mutate({ auftragId, empfaengerId })}
          darfQuittierenFuer={darfQuittierenFuer}
          onInArbeit={(auftragId) => vollzug.mutate({ auftragId, status: 'in_arbeit' })}
          onVollzugMelden={setVollzugFuer}
        />
      )}
      <VollzugMeldenModal
        offen={vollzugFuer != null}
        onAbbrechen={() => setVollzugFuer(null)}
        onBestaetigen={(text) => {
          if (vollzugFuer != null)
            vollzug.mutate({ auftragId: vollzugFuer, status: 'vollzogen', text });
        }}
      />
    </EinsatzSeite>
  );
}
