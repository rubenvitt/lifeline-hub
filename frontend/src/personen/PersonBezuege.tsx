import { Button, Flex, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { aktualisiereTier, listeTiere, tierRegistrierAnzeige } from '../api/einsatzTier';
import {
  aktualisiereSchaden,
  listeSchaeden,
  schadenRegistrierAnzeige,
} from '../api/einsatzSchaden';
import { einsatzKeys } from '../api/queryKeys';
import { KennungsLink } from '../components/kennungsLink';
import { SpeicherFehler, ZeilenFehler } from '../components/SpeicherHinweis';
import { useZeilenFehler, type ZeilenGrund } from '../components/useZeilenFehler';
import { useRollen } from '../components/instrument/rollenwerte';
import { SPEZIES_META } from '../pages/tiere/tierHelfer';
import { schadenDetailPfad, tiereDetailPfad } from '../routing/deeplinks';
import { BezugHinzufuegenDialog } from './ZuweisungsDialoge';

interface PersonBezuegeProps {
  einsatzId: number;
  personId: number;
  /** Schreibrecht und nicht storniert; sonst nur lesen. */
  darfZuordnen: boolean;
}

/** Eine Zeile der Bezugsliste, gleich für Tier und Schaden. */
interface BezugZeile {
  art: 'tier' | 'schaden';
  id: number;
  kennung: string;
  text: string;
  pfad: string;
}

/**
 * Bezüge der Person zu Tier und Schaden in EINER Liste in Einsatzsprache (LLH-1129, Option A,
 * Spec `personen-detail`): „Halter von T-003 · Hund „Bello““, „Geschädigt bei S-007 ·
 * Wasserschaden (mittel)“. Der Aufenthalt in einer UHS steht im Patientenkopf, nicht hier.
 *
 * Ladehoheit: der Abschnitt hängt im eingeklappten `Collapse` ohne `forceRender`, die Abfragen
 * laufen erst mit dem Aufklappen. Die Seite hängt ihn mit `key` an die Person: ein Wechsel räumt
 * Gründe und Dialog. Eine Ablehnung steht an ihrer Zeile (Schlüssel ist die Kennung); ist die
 * Zeile inzwischen fort (live von anderer Seite gelöst), steht der Grund über der Liste.
 */
export default function PersonBezuege({ einsatzId, personId, darfZuordnen }: PersonBezuegeProps) {
  const { token } = useRollen();
  const qc = useQueryClient();
  const fehler = useZeilenFehler<string>();
  const [hinzufuegenOffen, setHinzufuegenOffen] = useState(false);

  const tiereQuery = useQuery({
    queryKey: einsatzKeys.tiereHalter(einsatzId, personId),
    queryFn: () => listeTiere(einsatzId, { halterPersonId: personId }),
  });
  const schaedenQuery = useQuery({
    queryKey: einsatzKeys.schaedenGeschaedigt(einsatzId, personId),
    queryFn: () =>
      listeSchaeden(einsatzId, { geschaedigtPersonId: personId, inklStorniert: false }),
  });

  function invalidate() {
    void qc.invalidateQueries({ queryKey: einsatzKeys.person(einsatzId, personId) });
    void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
    void qc.invalidateQueries({ queryKey: einsatzKeys.tiere(einsatzId) });
    void qc.invalidateQueries({ queryKey: einsatzKeys.schaeden(einsatzId) });
    void qc.invalidateQueries({ queryKey: einsatzKeys.tiereHalter(einsatzId, personId) });
    void qc.invalidateQueries({ queryKey: einsatzKeys.schaedenGeschaedigt(einsatzId, personId) });
  }

  const loesen = useMutation({
    mutationFn: (z: BezugZeile): Promise<unknown> =>
      z.art === 'tier'
        ? aktualisiereTier(einsatzId, z.id, { halter_person_id: null })
        : aktualisiereSchaden(einsatzId, z.id, { geschaedigt_person_id: null }),
    onMutate: (z) => fehler.beginne(z.kennung),
    onSuccess: invalidate,
    onError: (e, z) => fehler.melde(z.kennung, e, 'Lösen fehlgeschlagen'),
  });

  const zeilen: BezugZeile[] = [
    ...(tiereQuery.data ?? []).map((t) => {
      const kennung = tierRegistrierAnzeige(t.registrier_nr);
      const spezies = SPEZIES_META[t.spezies] ?? t.spezies;
      return {
        art: 'tier' as const,
        id: t.id,
        kennung,
        text: `Halter von ${kennung} · ${spezies}${t.rufname ? ` „${t.rufname}“` : ''}`,
        pfad: tiereDetailPfad(einsatzId, t.id),
      };
    }),
    ...(schaedenQuery.data ?? []).map((sch) => {
      const kennung = schadenRegistrierAnzeige(sch.registrier_nr);
      return {
        art: 'schaden' as const,
        id: sch.id,
        kennung,
        text: `Geschädigt bei ${kennung} · ${sch.typ} (${sch.ausmass})`,
        pfad: schadenDetailPfad(einsatzId, sch.id),
      };
    }),
  ];
  const laedt = tiereQuery.isLoading || schaedenQuery.isLoading;
  const da = new Set(zeilen.map((z) => z.kennung));
  const zeilenGrund = (g: ZeilenGrund | null) =>
    g && <ZeilenFehler fehler={g.fehler} fallback={g.fallback} />;

  return (
    <Flex vertical gap={token.marginSM} data-lfh="bezuege">
      <Flex align="center" gap={token.marginSM} wrap>
        <Typography.Text strong>Bezüge {laedt ? '…' : zeilen.length}</Typography.Text>
        {darfZuordnen && (
          <Button onClick={() => setHinzufuegenOffen(true)}>Bezug hinzufügen</Button>
        )}
      </Flex>
      {fehler
        .gemeldet()
        .filter((k) => !da.has(k))
        .map((k) => {
          const g = fehler.grund(k);
          return (
            g && (
              <SpeicherFehler
                key={k}
                fehler={g.fehler}
                titel={`Bezug ${k} nicht gelöst`}
                fallback={g.fallback}
              />
            )
          );
        })}
      {zeilen.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {zeilen.map((z) => (
            <li
              key={`${z.art}:${z.id}`}
              data-lfh="bezug"
              style={{ padding: `${token.paddingXXS}px 0` }}
            >
              <Flex align="center" gap={token.marginSM} wrap>
                <KennungsLink to={z.pfad}>{z.text}</KennungsLink>
                {darfZuordnen && (
                  <Button
                    danger
                    type="text"
                    aria-label={`Bezug zu ${z.kennung} lösen`}
                    loading={loesen.isPending && loesen.variables?.kennung === z.kennung}
                    onClick={() => loesen.mutate(z)}
                  >
                    Bezug lösen
                  </Button>
                )}
              </Flex>
              {zeilenGrund(fehler.grund(z.kennung))}
            </li>
          ))}
        </ul>
      )}
      <BezugHinzufuegenDialog
        einsatzId={einsatzId}
        personId={personId}
        offen={hinzufuegenOffen}
        onZugewiesen={invalidate}
        onSchliessen={() => setHinzufuegenOffen(false)}
      />
    </Flex>
  );
}
