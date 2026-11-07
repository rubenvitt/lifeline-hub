import { Flex, Switch, Typography, theme } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { Formularpaneel } from '../../components/instrument';
import { NUR_LEITUNG_FUEHRUNG } from '../../components/nurAnsicht';
import { SeitenFehler, SeitenSkeleton } from '../../components/SeitenZustand';
import { SeitenHinweise } from '../../components/SpeicherHinweis';
import { setzeLagekennzahlWahl } from '../../api/lagekennzahlWahl';
import { einsatzKeys } from '../../api/queryKeys';
import type { Lagekennzahl } from '../../api/types';
import { darfImEinsatzSchreiben } from '../../einsatz/schreibrecht';
import { useEinstellungenDaten } from '../EinsatzEinstellungenPage';

/** Die wählbaren Lagekennzahlen — gespiegelt zu `Lagekennzahl::ist_waehlbar` im Backend. */
const WAEHLBAR: readonly Lagekennzahl[] = ['nachforderungen', 'sanitaetsdienst'];

/** Die Wahl mit `kennzahl` an oder aus, die übrigen bleiben. */
function umgeschaltet(
  gewaehlt: readonly Lagekennzahl[],
  kennzahl: Lagekennzahl,
  an: boolean,
): Lagekennzahl[] {
  const ohne = gewaehlt.filter((k) => k !== kennzahl);
  return an ? [...ohne, kennzahl] : ohne;
}

/**
 * Sektion `…/einstellungen/kennzahlen` — die Wahl der Lagekennzahlen im Kennzahlenband des
 * Lage-Dashboards (LLH-1371, Regel LFH-640: Lageplätze nur per Entscheidung am Einsatz). Zwei
 * Schalter: „Nachforderungen offen" auf Platz 3, hinter einer angeordneten Evakuierung, und die
 * Reihe „Sanitätsdienst“ (LLH-1574), die alle sechs Plätze und die Gefahrenmatrix ersetzt; ein
 * Einsatz mit Einsatzart Sanitätsdienst beginnt mit ihr.
 * Herleitung `/mnt/project-files/llh-1021/llh-1371/design.md` D3, D8.
 *
 * Gelesen wird die Wahl aus `EinsatzAnzeige.lagekennzahlen`, geschrieben über
 * `PUT …/lagekennzahl-wahl` (Vollersatz der Wahl). Speicherweg sofort wie die Pegel-Sektion,
 * keine Speicherleiste: ein Schalter hat keinen Entwurf. Danach wird der Einsatz neu abgerufen,
 * damit das Dashboard den neuen Zuschnitt ohne Banner zeigt. Rechte wie der Pegel
 * (`darfImEinsatzSchreiben`, Server `EinsatzSchreibzugriff`).
 */
export default function EinsatzKennzahlen() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const qc = useQueryClient();
  const { token } = theme.useToken();
  const daten = useEinstellungenDaten(einsatzId);

  // Kein `onError`-Toast: der Fehler steht über dem Paneel.
  const waehlen = useMutation({
    mutationFn: (gewaehlt: Lagekennzahl[]) => setzeLagekennzahlWahl(einsatzId, gewaehlt),
    onSuccess: () => qc.invalidateQueries({ queryKey: einsatzKeys.einsatz(einsatzId) }),
  });

  if (daten.laedt) return <SeitenSkeleton />;
  if (!daten.einsatz) {
    return (
      <SeitenFehler text="Einsatz nicht ladbar oder kein Zugriff" onWiederholen={daten.neuLaden} />
    );
  }

  const aktiv = daten.einsatz.lagekennzahlen;
  const gewaehlt = aktiv.filter((k) => WAEHLBAR.includes(k));
  const nachforderungen = gewaehlt.includes('nachforderungen');
  const sanitaetsdienst = gewaehlt.includes('sanitaetsdienst');
  const darf = darfImEinsatzSchreiben(daten.einsatz);
  const feldId = 'lagekennzahl-nachforderungen';
  const sanFeldId = 'lagekennzahl-sanitaetsdienst';

  return (
    <>
      <SeitenHinweise
        fehler={waehlen.error}
        rechteFehlt={daten.istAktiv && !darf}
        rechteText={NUR_LEITUNG_FUEHRUNG}
      />
      <Formularpaneel titel="Lage in Zahlen">
        <Flex vertical gap={token.marginXS}>
          <Flex align="center" gap={token.marginSM}>
            <Switch
              id={feldId}
              aria-label="Nachforderungen offen auf Platz 3"
              checked={nachforderungen}
              disabled={!darf}
              loading={waehlen.isPending}
              onChange={(an) => waehlen.mutate(umgeschaltet(gewaehlt, 'nachforderungen', an))}
            />
            <label htmlFor={feldId}>Nachforderungen offen auf Platz 3</label>
          </Flex>
          {/* Zustand, keine Bedienung (`frontend/AGENTS.md`, „Texte: zeigen statt erklären“): die
              Wahl ist gespeichert, wirkt aber gerade nicht. Erklärt wird im Kapitel
              `docs/anwender/kapitel/einsatz-einstellungen.md`. */}
          {sanitaetsdienst && nachforderungen ? (
            <Typography.Text type="secondary">
              Gilt nicht in der Reihe Sanitätsdienst.
            </Typography.Text>
          ) : (
            aktiv.includes('evakuiert') &&
            !sanitaetsdienst && (
              <Typography.Text type="secondary">
                Platz 3 zeigt „Evakuiert“, solange eine Evakuierung angeordnet ist.
              </Typography.Text>
            )
          )}
          <Flex align="center" gap={token.marginSM}>
            <Switch
              id={sanFeldId}
              aria-label="Reihe Sanitätsdienst"
              checked={sanitaetsdienst}
              disabled={!darf}
              loading={waehlen.isPending}
              onChange={(an) => waehlen.mutate(umgeschaltet(gewaehlt, 'sanitaetsdienst', an))}
            />
            <label htmlFor={sanFeldId}>Reihe Sanitätsdienst</label>
          </Flex>
        </Flex>
      </Formularpaneel>
    </>
  );
}
