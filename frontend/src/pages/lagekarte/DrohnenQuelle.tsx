import { Button, Switch } from 'antd';
import { useId } from 'react';
import {
  useAbschalten,
  useDrohnenQuellen,
  useZuschalten,
  type DroneSourceView,
} from '../../api/drohne';
import { fehlerText, istKonflikt } from '../../api/client';
import { schriftStil, useRollen } from '../../components/instrument';

export interface DrohnenQuelleProps {
  einsatzId: number;
  /** Nur die Einsatzleitung eines laufenden Einsatzes schaltet (`darfEinsatzLeiten`). */
  darfSchalten: boolean;
  /** Öffnet das Livebild der Quelle (Fenster über der Karte); ohne sie kein Knopf. */
  onLivebild?: (adapterId: string) => void;
}

/** Zustand der Quelle in diesem Einsatz als Wort — der zweite Kanal neben jeder Farbe. */
function zustandWort(q: DroneSourceView): string {
  if (q.held_by_other) return `Bereits an Einsatz ${q.held_by_other} zugeschaltet`;
  // Ohne Leserecht am anderen Einsatz kommt kein Name, nur das Merkmal.
  if (q.held_by_other_hidden) return 'Bereits an einem anderen Einsatz zugeschaltet';
  if (!q.connected) return 'Nicht zugeschaltet';
  return q.mission_name ? `Zugeschaltet · Mission ${q.mission_name}` : 'Zugeschaltet';
}

/** Zeile unter dem Schalter „Livebild auf dem Lagemonitor“ (LLH-2109): sagt, was gilt. */
export const LAGEMONITOR_AUS = 'Aus (Vorgabe): das Großbild zeigt kein Livebild.';
export const LAGEMONITOR_AN =
  'Das Großbild zeigt das Livebild; Personen im Bild sind dort sichtbar.';

/**
 * Zeile je Drohnenquelle unter der Ebene „Drohnenlage“ in der Kartenleiste (LLH-2106), außerhalb
 * des Zeilenknopfs: Name, Zustand und Missionsname als Text, dazu „Suchlage zuschalten“ bzw.
 * „Abschalten“ — beides nur für die Einsatzleitung (der Server prüft sie ebenso, `403`).
 *
 * Hält ein anderer laufender Einsatz die Quelle, steht „Bereits an Einsatz … zugeschaltet“ (ohne
 * Leserecht an ihm „… an einem anderen Einsatz …“) und kein Knopf; das gilt auch, wenn die Anfrage
 * erst am `409` des Servers scheitert (zwei Zuschaltungen zugleich). Der Name des anderen Einsatzes
 * kommt aus der Quellenliste, die danach neu geladen wird.
 *
 * „Suchlage zuschalten“ steht nur, solange keine Quelle dieses Einsatzes zugeschaltet ist (Spec
 * §5.4); danach nur „Abschalten“ an der zugeschalteten.
 *
 * Unter der zugeschalteten Quelle steht der Schalter „Livebild auf dem Lagemonitor“ (LLH-2109,
 * Vorgabe aus): Auf dem Großbild können Personen im Bild zu sehen sein, deshalb legt nur die
 * Einsatzleitung es dorthin. Ohne Schaltrecht steht nur die Zeile, die sagt, was gilt.
 */
export default function DrohnenQuelle({ einsatzId, darfSchalten, onLivebild }: DrohnenQuelleProps) {
  const { token, rollen } = useRollen();
  const listeId = useId();
  const quellen = useDrohnenQuellen(einsatzId);
  const zuschalten = useZuschalten(einsatzId);
  const abschalten = useAbschalten(einsatzId);

  const fehler = zuschalten.error ?? abschalten.error;
  const konflikt = istKonflikt(zuschalten.error);
  const liste = quellen.data ?? [];
  const istGehalten = (q: DroneSourceView) => !!q.held_by_other || q.held_by_other_hidden;
  const eineZugeschaltet = liste.some((q) => q.connected);

  return (
    <div
      data-lfh="drohnen-quellen"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: token.marginXS,
        padding: token.paddingSM,
        paddingInlineStart: token.padding,
        ...schriftStil('textKlein'),
        color: rollen.text2,
      }}
    >
      {quellen.isError && <span role="alert">Drohnenquellen nicht erreichbar.</span>}
      {quellen.isSuccess && liste.length === 0 && (
        <span data-lfh="drohnen-keine-quelle">Keine Drohnenquelle eingerichtet.</span>
      )}
      <ul
        id={listeId}
        aria-label="Drohnenquellen"
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: token.marginXS,
        }}
      >
        {liste.map((q) => {
          const beschreibung = `${listeId}-${q.adapter_id}`;
          const gehalten = istGehalten(q);
          // Zuschalten nur ohne zugeschaltete Quelle; Abschalten immer an der zugeschalteten.
          const schaltbar = q.connected || (!gehalten && !eineZugeschaltet);
          const laeuft =
            (zuschalten.isPending && zuschalten.variables?.adapterId === q.adapter_id) ||
            (abschalten.isPending && abschalten.variables === q.adapter_id);
          return (
            <li
              key={q.adapter_id}
              data-lfh="drohnen-quelle"
              style={{ display: 'flex', flexDirection: 'column', gap: token.marginXXS }}
            >
              <span style={{ color: rollen.text }}>{q.label}</span>
              <span id={beschreibung} data-lfh="drohnen-zustand">
                {zustandWort(q)}
              </span>
              {onLivebild && q.connected && q.video_keys.length > 0 && (
                <Button
                  style={{ alignSelf: 'flex-start' }}
                  aria-describedby={beschreibung}
                  onClick={() => onLivebild(q.adapter_id)}
                >
                  Livebild
                </Button>
              )}
              {q.connected && (
                <LagemonitorSchalter
                  quelle={q}
                  darfSchalten={darfSchalten}
                  laeuft={zuschalten.isPending && zuschalten.variables?.adapterId === q.adapter_id}
                  onSchalten={(an) =>
                    zuschalten.mutate({ adapterId: q.adapter_id, lagemonitor: an })
                  }
                />
              )}
              {darfSchalten && schaltbar && (
                <Button
                  style={{ alignSelf: 'flex-start' }}
                  type={q.connected ? 'default' : 'primary'}
                  loading={laeuft}
                  aria-describedby={beschreibung}
                  onClick={() =>
                    q.connected
                      ? abschalten.mutate(q.adapter_id)
                      : zuschalten.mutate({ adapterId: q.adapter_id, lagemonitor: false })
                  }
                >
                  {q.connected ? 'Abschalten' : 'Suchlage zuschalten'}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {/* Ein 409 ohne Namen in der Liste (noch nicht neu geladen) sagt es allgemein. */}
      {konflikt && !liste.some(istGehalten) && (
        <span role="alert" style={{ color: rollen.achtungText }}>
          Bereits an einem anderen Einsatz zugeschaltet.
        </span>
      )}
      {fehler && !konflikt && (
        <span role="alert" style={{ color: rollen.alarmText }}>
          {fehlerText(fehler, 'Drohnenquelle konnte nicht geschaltet werden')}
        </span>
      )}
    </div>
  );
}

/** Schalter „Livebild auf dem Lagemonitor“ einer zugeschalteten Quelle (LLH-2109). */
function LagemonitorSchalter({
  quelle,
  darfSchalten,
  laeuft,
  onSchalten,
}: {
  quelle: DroneSourceView;
  darfSchalten: boolean;
  laeuft: boolean;
  onSchalten: (an: boolean) => void;
}) {
  const { token, rollen } = useRollen();
  const hinweisId = useId();
  const hinweis = quelle.lagemonitor ? LAGEMONITOR_AN : LAGEMONITOR_AUS;
  if (!darfSchalten) return <span data-lfh="drohnen-lagemonitor">{hinweis}</span>;
  return (
    <>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: token.marginXS,
          color: rollen.text,
          cursor: 'pointer',
        }}
      >
        <Switch
          checked={quelle.lagemonitor}
          loading={laeuft}
          aria-describedby={hinweisId}
          onChange={onSchalten}
        />
        Livebild auf dem Lagemonitor
      </label>
      <span id={hinweisId} data-lfh="drohnen-lagemonitor">
        {hinweis}
      </span>
    </>
  );
}
