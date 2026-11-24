import { useId, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Switch, Typography, theme } from 'antd';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { useZeitEingabe } from '../../anzeige/ZeitpunktEingabe';
import { zeitpunkt } from '../../anzeige/zeitDarstellung';
import { heuteInZone } from '../../anzeige/zeitEingabe';
import { loadRegistrierlisteDruck } from '../../api/betreuungRegistrierung';
import { ApiError } from '../../api/client';
import { ladeEinsatz } from '../../api/incidents';
import { einsatzKeys } from '../../api/queryKeys';
import EinsatzSeite from '../../components/EinsatzSeite';
import type { PlatzhalterRueckweg } from '../../components/Platzhalter';
import {
  istNichtGefunden,
  SeitenFehler,
  SeitenNichtGefunden,
  SeitenSkeleton,
} from '../../components/SeitenZustand';
import Druckkopf from '../../components/druck/Druckkopf';
import DruckKnopf from '../../components/druck/DruckKnopf';
import { DRUCK_ABFRAGE } from '../../druck/abfrageOptionen';
import { serverJetzt } from '../../offline/serveruhr';
import RegistrierlisteBlatt from './RegistrierlisteBlatt';
import { allePersonen } from './registrierKern';

export interface RegistrierlisteDruckSeiteProps {
  einsatzId: number;
  stelleId: number;
  /** Bezeichnung der Stelle für Seitenkopf und Druckkopf, sobald bekannt. */
  stelleBezeichnung?: string;
  zurueck: { pfad: string; label: string };
  /**
   * Rückweg, wenn es die Stelle nicht (mehr) gibt (404, LLH-1960): die Betreuung des Einsatzes bzw.
   * des Geräts, nicht die Stelle selbst.
   */
  liste: PlatzhalterRueckweg;
  /** Brotkrumen der Stabsoberfläche; das Gerät hat keine. */
  breadcrumb?: (einsatzBezeichnung: string) => ReactNode;
}

const zahl = (n: number, eins: string, viele: string) => `${n} ${n === 1 ? eins : viele}`;

/**
 * Druckansicht der Registrierliste einer Betreuungsstelle (LLH-1616, Spec
 * `betreuung-registrierung`; Change `iw8hjb93-registrierliste-drucken` design.md D3/D4), an der
 * Stabsoberfläche (`pages/RegistrierlisteDruckPage.tsx`) und am Gerät „Betreuungsstelle“
 * (`geraet/GeraetRegistrierlisteDruckPage.tsx`) derselbe Baustein. Muster `PersonDruckPage`:
 *
 * - **Nur über den Druckabruf** (`GET …/registrierungen/druck`), der je Person einen
 *   Eintrag `registrierliste` ins Zugriffsprotokoll schreibt (`druck/AGENTS.md`, Personendruck). Deshalb
 *   `DRUCK_ABFRAGE` (kein stiller Retry, offline scheitern), ein eigener, nicht live geführter Key
 *   und `gcTime: 0`: das Blatt ist ein Schnappschuss, „Neu laden“ holt den neuen Stand.
 * - **Gesundheitsangaben nur auf Wunsch:** der Schalter „Unverträglichkeiten mitdrucken“ steht in
 *   der Adresse (`?unvertraeglichkeiten=1`), Vorgabe aus; ohne ihn liefert der Server das Feld
 *   nicht. Die Wahl steht im Key, ein Wechsel ist ein neuer (protokollierter) Abruf.
 * - Leer: ein Satz, kein Druckknopf. 403 „Kein Zugriff“. 404: `SeitenNichtGefunden` ersetzt die
 *   ganze Druckansicht, der Rückweg führt zur Liste (`liste`, LLH-1960).
 */
export default function RegistrierlisteDruckSeite({
  einsatzId,
  stelleId,
  stelleBezeichnung,
  zurueck,
  liste: listeRueckweg,
  breadcrumb,
}: RegistrierlisteDruckSeiteProps) {
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const { konventionen } = useAnzeigeKonventionen();
  const { zone } = useZeitEingabe();
  const [suche, setSuche] = useSearchParams();
  const schalterId = useId();
  const hasUnvertraeglichkeiten = suche.get('unvertraeglichkeiten') === '1';

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const druckQuery = useQuery({
    ...DRUCK_ABFRAGE,
    queryKey: einsatzKeys.registrierlisteDruck(einsatzId, stelleId, hasUnvertraeglichkeiten),
    queryFn: () => loadRegistrierlisteDruck(einsatzId, stelleId, hasUnvertraeglichkeiten),
    gcTime: 0,
  });

  if (istNichtGefunden(druckQuery.error)) {
    return (
      <SeitenNichtGefunden
        titel="Diese Betreuungsstelle gibt es nicht (mehr)"
        rueckweg={listeRueckweg}
      />
    );
  }
  if (einsatzQuery.isLoading) return <SeitenSkeleton />;
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Einsatz nicht gefunden oder kein Zugriff"
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }
  const einsatz = einsatzQuery.data;
  const status = druckQuery.error instanceof ApiError ? druckQuery.error.status : null;
  const isOhneDruck = status === 403;
  const liste = druckQuery.data;
  const personen = liste ? allePersonen(liste).length : 0;
  const isLeer = liste != null && personen === 0;
  const haushalte = liste ? liste.haushalte.length : 0;

  return (
    <EinsatzSeite
      titel="Registrierliste – Druckansicht"
      meta={stelleBezeichnung}
      breadcrumb={breadcrumb?.(einsatz.bezeichnung)}
      aktionen={
        <>
          <Button
            href={zurueck.pfad}
            onClick={(e) => {
              // Ein Link mit Knopfgestalt: Strg/⌘+Klick öffnet den neuen Tab wie jeder Link.
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              navigate(zurueck.pfad);
            }}
          >
            {zurueck.label}
          </Button>
          {!isOhneDruck && (
            <Button onClick={() => void druckQuery.refetch()} disabled={druckQuery.isFetching}>
              Neu laden
            </Button>
          )}
          {!isOhneDruck && !isLeer && (
            <DruckKnopf typ="primary" gesperrt={!druckQuery.isSuccess || druckQuery.isFetching} />
          )}
        </>
      }
    >
      {!isOhneDruck && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            columnGap: token.marginLG,
            rowGap: token.marginXS,
            marginBlockEnd: token.marginSM,
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: token.marginXS }}>
            <Switch
              id={schalterId}
              checked={hasUnvertraeglichkeiten}
              disabled={druckQuery.isFetching}
              onChange={(an) =>
                setSuche(
                  (alt) => {
                    const neu = new URLSearchParams(alt);
                    if (an) neu.set('unvertraeglichkeiten', '1');
                    else neu.delete('unvertraeglichkeiten');
                    return neu;
                  },
                  { replace: true },
                )
              }
            />
            <label htmlFor={schalterId}>Unverträglichkeiten mitdrucken</label>
          </span>
          {/* Vor dem Zustandsschalter: der Eintrag entsteht beim Abruf, schon beim Laden. */}
          <Typography.Text type="secondary" data-testid="druck-hinweis">
            Zugriff wird protokolliert.
          </Typography.Text>
        </div>
      )}
      {status === 403 ? (
        <Alert
          type="info"
          showIcon
          title="Kein Zugriff auf die Personen"
          description="Modul gesperrt oder Aufbewahrungsfrist abgelaufen"
        />
      ) : druckQuery.isError ? (
        <SeitenFehler
          text="Die Registrierliste konnte nicht geladen werden"
          ursache={druckQuery.error}
          laedt={druckQuery.isFetching}
          onWiederholen={() => void druckQuery.refetch()}
        />
      ) : !liste || druckQuery.isFetching ? (
        <Typography.Text role="status" aria-live="polite">
          Registrierliste wird geladen …
        </Typography.Text>
      ) : isLeer ? (
        <Typography.Paragraph>An dieser Stelle ist niemand registriert.</Typography.Paragraph>
      ) : (
        <div data-lfh="druckwurzel">
          <Druckkopf
            dokumentart="Registrierliste"
            titel={stelleBezeichnung}
            einsatz={einsatz}
            sichtbarkeit="immer"
            // Am Bildschirm steht darüber der Seitenkopf mit dem `h1`.
            ebene={2}
            zeilen={[
              {
                etikett: 'Umfang',
                wert: `${zahl(haushalte, 'Haushalt', 'Haushalte')} · ${zahl(personen, 'Person', 'Personen')}`,
              },
              {
                etikett: 'Stand',
                wert: zeitpunkt(new Date(druckQuery.dataUpdatedAt).toISOString(), konventionen),
              },
              ...(hasUnvertraeglichkeiten
                ? [{ etikett: 'Gesundheitsangaben', wert: 'mit Unverträglichkeiten' }]
                : []),
            ]}
          />
          <RegistrierlisteBlatt
            liste={liste}
            heute={heuteInZone(zone, serverJetzt())}
            hasUnvertraeglichkeiten={hasUnvertraeglichkeiten}
          />
        </div>
      )}
    </EinsatzSeite>
  );
}
