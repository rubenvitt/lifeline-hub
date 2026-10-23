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
const WAEHLBAR: readonly Lagekennzahl[] = ['nachforderungen'];

/**
 * Sektion `…/einstellungen/kennzahlen` — die Wahl der Lagekennzahlen im Kennzahlenband des
 * Lage-Dashboards (LLH-1371, Regel LFH-640: Lageplätze nur per Entscheidung am Einsatz). Heute
 * ein Schalter: „Nachforderungen offen" auf Platz 3, hinter einer angeordneten Evakuierung.
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
  const darf = darfImEinsatzSchreiben(daten.einsatz);
  const feldId = 'lagekennzahl-nachforderungen';

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
              onChange={(an) =>
                waehlen.mutate(
                  an
                    ? [...gewaehlt.filter((k) => k !== 'nachforderungen'), 'nachforderungen']
                    : gewaehlt.filter((k) => k !== 'nachforderungen'),
                )
              }
            />
            <label htmlFor={feldId}>Nachforderungen offen auf Platz 3</label>
          </Flex>
          {/* Zustand, keine Bedienung (`frontend/AGENTS.md`, „Texte: zeigen statt erklären“): die
              Wahl ist gespeichert, wirkt aber gerade nicht. Erklärt wird im Kapitel
              `docs/anwender/kapitel/einsatz-einstellungen.md`. */}
          {aktiv.includes('evakuiert') && (
            <Typography.Text type="secondary">
              Platz 3 zeigt „Evakuiert“, solange eine Evakuierung angeordnet ist.
            </Typography.Text>
          )}
        </Flex>
      </Formularpaneel>
    </>
  );
}
