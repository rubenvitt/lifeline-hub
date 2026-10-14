import { useId, useState } from 'react';
import { Button, Typography } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { gibMaterialFrei, ordneMaterialZu } from '../../api/einsatzMaterial';
import { einsatzKeys } from '../../api/queryKeys';
import type { Einheit, EinsatzMaterial } from '../../api/types';
import { monoStil, Paneel, useRollen } from '../../components/instrument';
import { MODUL_MATERIAL_GESPERRT } from '../../components/nurAnsicht';
import { nichtGefundenInhalt } from '../../components/SeitenZustand';
import { Select } from '../../components/Select';
import { SpeicherFehler, ZeilenFehler } from '../../components/SpeicherHinweis';
import StatusTag from '../../components/StatusTag';
import { useZeilenFehler } from '../../components/useZeilenFehler';
import { filterAktive } from '../../kraefte/kraeftebaumKern';
import { materialDarstellung, ortVon } from '../../kraefte/materialPosten';
import { isMaterialAusfall, materialAusfall } from '../../kraefte/materialVerdichtungKern';
import type { EinheitRechte } from './einheitAnsichtKern';

/**
 * Paneel „Material“ der Einheit-Ansicht (LLH-1036 Teil II, design.md D11). Material sitzt nicht
 * auf Fahrzeugen und bleibt ein eigenes Paneel. Ausfall und Darstellung kommen NUR aus der einen
 * Material-Zählung (`kraefte/materialVerdichtungKern.ts`, LLH-1093) und `materialDarstellung`
 * (`kraefte/materialPosten.ts`, Vertrag `materialStatus`): hier gibt es keine eigene Statuslogik, eine Änderung der Ausfall-Regel
 * (LLH-1224) zieht das Paneel mit.
 *
 * „Material zuordnen …“ bietet nur Posten ohne Ort an (LLH-1224 D6) und braucht die Freigabe
 * Material (die Liste der freien Posten), sonst steht die Auswahl gesperrt mit Grund. Kein Stamm:
 * Material hat keinen Sammelweg.
 */

interface EinheitMaterialProps {
  einsatzId: number;
  einheit: Einheit;
  rechte: EinheitRechte;
  /** Material des Einsatzes; nur mit `rechte.hasMaterialListe` abgefragt. */
  materialList: {
    data: readonly EinsatzMaterial[] | undefined;
    isError: boolean;
    error: unknown;
  };
}

export default function EinheitMaterial({
  einsatzId,
  einheit,
  rechte,
  materialList,
}: EinheitMaterialProps) {
  const qc = useQueryClient();
  const { token } = useRollen();
  const reasonId = useId();
  const einheitId = einheit.id;
  const posten = einheit.material_mitglieder;
  const ausfall = materialAusfall(posten);

  function invalidate() {
    for (const key of [
      einsatzKeys.einheiten(einsatzId),
      einsatzKeys.material(einsatzId),
      einsatzKeys.etb(einsatzId),
    ])
      void qc.invalidateQueries({ queryKey: key });
  }
  const rowErrors = useZeilenFehler<number>();
  // Was gerade gelöst wird, je Posten: die Rückmeldung steht am Knopf vor der Antwort.
  const [pending, setPending] = useState<ReadonlySet<number>>(() => new Set());
  const markPending = (emId: number, on: boolean) =>
    setPending((prev) => {
      const next = new Set(prev);
      if (on) next.add(emId);
      else next.delete(emId);
      return next;
    });
  const zuordnenErrors = useZeilenFehler<'zuordnen'>();
  const loesen = useMutation({
    mutationFn: (emId: number) => gibMaterialFrei(einsatzId, einheitId, emId),
    onMutate: (emId) => {
      rowErrors.beginne(emId);
      markPending(emId, true);
    },
    onSuccess: invalidate,
    onError: (e, emId) => rowErrors.melde(emId, e, 'Lösen fehlgeschlagen'),
    onSettled: (_d, _e, emId) => markPending(emId, false),
  });
  const zuordnen = useMutation({
    mutationFn: (emId: number) => ordneMaterialZu(einsatzId, einheitId, emId),
    onMutate: () => zuordnenErrors.beginne('zuordnen'),
    onSuccess: invalidate,
    onError: (e) => zuordnenErrors.melde('zuordnen', e),
  });

  // Frei heißt beim Material „ohne Ort“ (LLH-1224 D6): ein Posten an einer UHS, auf einem
  // Fahrzeug oder in einem Bereitstellungsraum ist nicht frei.
  const freiePosten = filterAktive(materialList.data ?? []).filter((m) => ortVon(m) === null);
  const emptyContent =
    nichtGefundenInhalt(materialList, { allgemein: 'Material konnte nicht geladen werden' }) ??
    'Kein freies Material';
  const isLocked = !rechte.canZuordnenMaterial;
  const zuordnenReason = zuordnenErrors.grund('zuordnen');

  return (
    <Paneel
      titel="Material"
      meta={`${posten.length} Posten${ausfall > 0 ? ` · ${ausfall} Ausfall` : ''}`}
      koerperPolster
    >
      {posten.map((m) => {
        const reason = rowErrors.grund(m.em_id);
        return (
          <div
            key={m.em_id}
            data-lfh="einheit-zuordnung"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              columnGap: token.margin,
              rowGap: token.marginSM,
              flexWrap: 'wrap',
              // Bedienziel-Boden einer handgebauten Zeile (LFH-365); zwei Zeilen stehen `marginSM`
              // auseinander, Lösen über Lösen hält so den Aktionsabstand (≥ 8 / ≥ 16).
              minHeight: token.controlHeight,
              paddingBlock: token.marginSM / 2,
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: token.marginXS,
              }}
            >
              {m.bezeichnung} <span style={monoStil(13)}>×{m.menge}</span>
              {/* Ein aufgebrauchtes Verbrauchsgut ist Ausfall und heißt „aufgebraucht“ (LLH-1224 D4). */}
              {isMaterialAusfall(m) && <StatusTag darstellung={materialDarstellung(m)} />}
            </span>
            {rechte.canEditEinheit && (
              <Button danger loading={pending.has(m.em_id)} onClick={() => loesen.mutate(m.em_id)}>
                Aus Einheit lösen
              </Button>
            )}
            {reason && (
              <div style={{ flexBasis: '100%' }}>
                <ZeilenFehler fehler={reason.fehler} fallback={reason.fallback} />
              </div>
            )}
          </div>
        );
      })}
      {rechte.canEditEinheit && (
        <div style={{ marginTop: token.marginSM }}>
          <Select
            style={{ width: '100%' }}
            placeholder="Material zuordnen …"
            aria-label="Material zuordnen"
            value={null}
            loading={zuordnen.isPending}
            disabled={isLocked}
            aria-describedby={isLocked ? reasonId : undefined}
            notFoundContent={emptyContent}
            options={freiePosten.map((m) => ({
              value: m.id,
              label: `${m.bezeichnung} ×${m.menge}`,
            }))}
            onSelect={(emId) => zuordnen.mutate(Number(emId))}
          />
          {isLocked && (
            <Typography.Text type="secondary" id={reasonId}>
              {MODUL_MATERIAL_GESPERRT}
            </Typography.Text>
          )}
        </div>
      )}
      {zuordnenReason && (
        <div style={{ marginTop: token.marginSM }}>
          <SpeicherFehler
            fehler={zuordnenReason.fehler}
            titel="Nicht zugeordnet"
            fallback="Zuordnen fehlgeschlagen"
          />
        </div>
      )}
    </Paneel>
  );
}
