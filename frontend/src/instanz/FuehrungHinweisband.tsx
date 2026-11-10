import { Alert, Button } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { zeitKurz } from '../anzeige/zeitDarstellung';
import { loadFuehrung } from '../api/fuehrung';
import { einsatzKeys } from '../api/queryKeys';
import type { EinsatzAnzeige } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { darfFuehrungBedienen } from '../einsatz/schreibrecht';
import { UebernahmeEntscheidung } from './FuehrungPaneel';

/**
 * Hinweisband unter der Kopfleiste (LLH-1491, Spec „Die meldende Seite prüft jede Übernahme gegen
 * sie“): eine gültige Notübernahme wartet auf die Einsatzleitung. Von wem, wann, warum, dazu
 * „Übernahme bestätigen“ und „Widersprechen“. Bis zur Entscheidung schreibt diese Instanz weiter.
 * `warning`, weil Rot der Gefahr vorbehalten ist; der Alarm einer ungültigen Übernahme läuft über
 * die Benachrichtigungen.
 */
export default function FuehrungHinweisband({ einsatz }: { einsatz: EinsatzAnzeige }) {
  const { benutzer } = useAuth();
  const { konventionen: konv } = useAnzeigeKonventionen();
  const offen = einsatz.fuehrung?.offen === true;
  const fuehrungQ = useQuery({
    queryKey: einsatzKeys.fuehrung(einsatz.id),
    queryFn: () => loadFuehrung(einsatz.id),
    enabled: offen,
  });
  const f = fuehrungQ.data;
  if (!offen) return null;
  if (!f?.offen) {
    // Scheitert der Abruf, bleibt das Band stehen: die offene Übernahme kennt der Einsatzkopf
    // schon, nur ihre Angaben fehlen (CodeRabbit-Review LLH-1491).
    if (!fuehrungQ.isError) return null;
    return (
      <div data-lfh="fuehrung-hinweisband">
        <Alert
          type="warning"
          showIcon
          banner
          title="Übernahme der Führung wartet auf Entscheidung"
          description="Die Angaben zur Übernahme ließen sich nicht laden."
          action={<Button onClick={() => void fuehrungQ.refetch()}>Erneut laden</Button>}
        />
      </div>
    );
  }
  const teile = [
    f.offen.zeitpunkt ? zeitKurz(f.offen.zeitpunkt, konv) : null,
    f.offen.unterzeichner ? `unterzeichnet von ${f.offen.unterzeichner}` : null,
    f.offen.grund ?? null,
  ].filter((t): t is string => t != null);
  return (
    <div data-lfh="fuehrung-hinweisband">
      <Alert
        type="warning"
        showIcon
        banner
        title={`Führung übernommen von ${f.offen.von}`}
        description={teile.join(' · ')}
        action={
          darfFuehrungBedienen(einsatz, benutzer) ? (
            <UebernahmeEntscheidung fuehrung={f} einsatzId={einsatz.id} />
          ) : undefined
        }
      />
    </div>
  );
}
