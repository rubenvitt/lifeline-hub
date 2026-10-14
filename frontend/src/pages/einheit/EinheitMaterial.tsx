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
import { isMaterialAusfall, materialAusfall } from '../../kraefte/materialVerdichtungKern';
import { materialStatus } from '../../theme/statusFarben';
import type { EinheitRechte } from './einheitAnsichtKern';

/**
 * Paneel „Material“ der Einheit-Ansicht (LLH-1036 Teil II, design.md D11). Material sitzt nicht
 * auf Fahrzeugen und bleibt ein eigenes Paneel. Ausfall und Darstellung kommen NUR aus der einen
 * Material-Zählung (`kraefte/materialVerdichtungKern.ts`, LLH-1093) und dem Vertrag
 * `materialStatus`: hier gibt es keine eigene Statuslogik, eine Änderung der Ausfall-Regel
 * (LLH-1224) zieht das Paneel mit.
 *
 * „Material zuordnen …“ braucht die Freigabe Material (die Liste der freien Posten), sonst steht
 * die Auswahl gesperrt mit Grund. Kein Stamm: Material hat keinen Sammelweg.
 */

interface EinheitMaterialProps {
  einsatzId: number;
  einheit: Einheit;
  rechte: EinheitRechte;
  /** Material des Einsatzes; nur mit `rechte.hasMaterialListe` abgefragt. */
  materialListe: {
    data: readonly EinsatzMaterial[] | undefined;
    isError: boolean;
    error: unknown;
  };
}

export default function EinheitMaterial({
  einsatzId,
  einheit,
  rechte,
  materialListe,
}: EinheitMaterialProps) {
  const qc = useQueryClient();
  const { token } = useRollen();
  const grundId = useId();
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
  const zeilen = useZeilenFehler<number>();
  // Was gerade gelöst wird, je Posten: die Rückmeldung steht am Knopf vor der Antwort.
  const [laufend, setLaufend] = useState<ReadonlySet<number>>(() => new Set());
  const markiere = (emId: number, an: boolean) =>
    setLaufend((alt) => {
      const neu = new Set(alt);
      if (an) neu.add(emId);
      else neu.delete(emId);
      return neu;
    });
  const zuordnenFehler = useZeilenFehler<'zuordnen'>();
  const frei = useMutation({
    mutationFn: (emId: number) => gibMaterialFrei(einsatzId, einheitId, emId),
    onMutate: (emId) => {
      zeilen.beginne(emId);
      markiere(emId, true);
    },
    onSuccess: invalidate,
    onError: (e, emId) => zeilen.melde(emId, e, 'Lösen fehlgeschlagen'),
    onSettled: (_d, _e, emId) => markiere(emId, false),
  });
  const zu = useMutation({
    mutationFn: (emId: number) => ordneMaterialZu(einsatzId, einheitId, emId),
    onMutate: () => zuordnenFehler.beginne('zuordnen'),
    onSuccess: invalidate,
    onError: (e) => zuordnenFehler.melde('zuordnen', e),
  });

  const freiePosten = filterAktive(materialListe.data ?? []).filter((m) => m.einheit_id == null);
  const leerInhalt =
    nichtGefundenInhalt(materialListe, { allgemein: 'Material konnte nicht geladen werden' }) ??
    'Kein freies Material';
  const gesperrt = !rechte.canZuordnenMaterial;
  const zuordnenGrund = zuordnenFehler.grund('zuordnen');

  return (
    <Paneel
      titel="Material"
      meta={`${posten.length} Posten${ausfall > 0 ? ` · ${ausfall} Ausfall` : ''}`}
      koerperPolster
    >
      {posten.map((m) => {
        const grund = zeilen.grund(m.em_id);
        return (
          <div
            key={m.em_id}
            data-lfh="einheit-zuordnung"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: token.margin,
              flexWrap: 'wrap',
              // Bedienziel-Boden einer handgebauten Zeile (LFH-365).
              minHeight: token.controlHeight,
              paddingBlock: token.paddingXXS,
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
              {isMaterialAusfall(m.status) && <StatusTag darstellung={materialStatus[m.status]} />}
            </span>
            {rechte.canEditEinheit && (
              <Button danger loading={laufend.has(m.em_id)} onClick={() => frei.mutate(m.em_id)}>
                Aus Einheit lösen
              </Button>
            )}
            {grund && (
              <div style={{ flexBasis: '100%' }}>
                <ZeilenFehler fehler={grund.fehler} fallback={grund.fallback} />
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
            loading={zu.isPending}
            disabled={gesperrt}
            aria-describedby={gesperrt ? grundId : undefined}
            notFoundContent={leerInhalt}
            options={freiePosten.map((m) => ({
              value: m.id,
              label: `${m.bezeichnung} ×${m.menge}`,
            }))}
            onSelect={(emId) => zu.mutate(Number(emId))}
          />
          {gesperrt && (
            <Typography.Text type="secondary" id={grundId}>
              {MODUL_MATERIAL_GESPERRT}
            </Typography.Text>
          )}
        </div>
      )}
      {zuordnenGrund && (
        <div style={{ marginTop: token.marginSM }}>
          <SpeicherFehler
            fehler={zuordnenGrund.fehler}
            titel="Nicht zugeordnet"
            fallback="Zuordnen fehlgeschlagen"
          />
        </div>
      )}
    </Paneel>
  );
}
