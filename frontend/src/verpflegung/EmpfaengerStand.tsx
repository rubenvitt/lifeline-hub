import { Button } from 'antd';
import { Fragment, useId, type ReactNode } from 'react';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import type { AusgabeEingabe, VerpflegungEmpfaenger, VerpflegungZeitfenster } from '../api/types';
import { Augenbraue, monoStil, useRollen } from '../components/instrument';
import {
  staerkeAnzeige,
  verpflegungsstand,
  type AusgabeKurz,
  type EmpfaengerWahl,
  type StandZeile,
} from './empfaengerKern';
import { uhrzeit } from './verpflegungText';

export interface EmpfaengerStandProps {
  zeitfenster: Pick<VerpflegungZeitfenster, 'ausgaben' | 'bis_at' | 'verpflegt_anderswo'>;
  empfaenger: VerpflegungEmpfaenger;
  /** Auf diesem Gerät vorgemerkte Ausgaben DIESES Zeitfensters (nur „ausstehend“, nie verpflegt). */
  ausstehend?: readonly Pick<AusgabeEingabe, 'menge' | 'einheit_id'>[];
  /** Ebene der Überschriften „Noch nicht verpflegt“ und „Verpflegt“; „ohne Eintreffen“ eine darunter. */
  ueberschrift: 'h2' | 'h3' | 'h4';
  /** Wählt eine Einheit als Empfänger der Ausgabeansicht; ohne gibt es keine Knöpfe. */
  onWaehlen?: (w: EmpfaengerWahl) => void;
  gewaehlt?: EmpfaengerWahl | null;
  /** Knöpfe gesperrt (ohne Schreibrecht, vergangen); der Grund steht an den Zähltasten. */
  gesperrt?: boolean;
  /** `aria-describedby` der gesperrten Knöpfe. */
  grundId?: string;
}

const UNTER: Record<EmpfaengerStandProps['ueberschrift'], 'h3' | 'h4' | 'h5'> = {
  h2: 'h3',
  h3: 'h4',
  h4: 'h5',
};

/** „9 EP 12:10, 4 EP 12:40“ in der Anzeigezone. */
function ausgabenText(ausgaben: readonly AusgabeKurz[], uhr: (s: string) => string): string {
  return ausgaben.map((a) => `${a.menge} EP ${uhr(a.zeitpunkt_at)}`).join(', ');
}

/** Teile einer Zeile, getrennt durch „ · “; leere fallen weg. */
function Teile({ teile }: { teile: readonly (ReactNode | null | undefined | false)[] }) {
  const da = teile.filter((t) => t != null && t !== false && t !== '');
  return (
    <>
      {da.map((t, i) => (
        <Fragment key={i}>
          {i > 0 && ' · '}
          {t}
        </Fragment>
      ))}
    </>
  );
}

/**
 * Wer in einem Zeitfenster noch nicht verpflegt ist und wer schon (LLH-1055 Teil II, Spec
 * `kraefte-verpflegung`, „Noch nicht verpflegt“). Die Ableitung steht in `empfaengerKern.ts`
 * ({@link verpflegungsstand}); diese Fläche zeigt sie nur.
 *
 * „Noch nicht verpflegt“ in der Folge des Kräftebaums, Untereinheiten eingerückt, je Zeile
 * Funkrufname, Stärke des Teilbaums (`summiereStaerke`/`staerkeText`, wie die Vorgabe der Menge)
 * und Abschnitt; darunter gesondert „ohne Eintreffen“. „Verpflegt“ nennt die direkten Empfänger
 * mit Menge und Zeit und die mitverpflegten Untereinheiten, dann die Zuführungen an Abschnitte.
 * Am gebundenen Gerät steht eine anderswo verpflegte Einheit dort als „anderswo verpflegt · n EP“
 * (LLH-1048, `verpflegt_anderswo` des Servers).
 * Mit `onWaehlen` trägt jede noch nicht verpflegte Zeile „Wählen“ (Handschuh: die Zeile ist der
 * schnellere Weg als die Auswahlliste). Ohne Einheiten im Einsatz gibt es die Fläche nicht.
 */
export default function EmpfaengerStand({
  zeitfenster,
  empfaenger,
  ausstehend = [],
  ueberschrift,
  onWaehlen,
  gewaehlt = null,
  gesperrt = false,
  grundId,
}: EmpfaengerStandProps) {
  const { token, rollen } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const id = useId();
  if (empfaenger.einheiten.length === 0 && empfaenger.abschnitte.length === 0) return null;
  const stand = verpflegungsstand(zeitfenster, empfaenger, ausstehend);
  const uhr = (s: string) => uhrzeit(s, konventionen);
  const nebentext = { ...monoStil(12), color: rollen.text2 };
  const listeStil = { listStyle: 'none', margin: 0, padding: 0 } as const;
  const zeileStil = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: token.marginSM,
    rowGap: token.marginXXS,
    paddingBlock: 2,
  } as const;

  const standZeile = (z: StandZeile) => {
    const istGewaehlt = gewaehlt?.art === 'einheit' && gewaehlt.id === z.id;
    return (
      <li
        key={z.id}
        data-einheit={z.id}
        data-tiefe={z.tiefe}
        style={{
          ...zeileStil,
          paddingInlineStart: z.tiefe * token.padding,
          // Gewählt: die Auswahlfläche über das Token (`colorPrimaryBg`, Rolle `auswahlFlaeche`,
          // LFH-984), dazu `aria-pressed` am Knopf als zweiter Kanal.
          background: istGewaehlt ? token.colorPrimaryBg : undefined,
        }}
      >
        <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
          <Teile
            teile={[
              z.name,
              z.funkrufname && <span style={monoStil(13)}>{z.funkrufname}</span>,
              staerkeAnzeige(z.einheit) && (
                <span style={monoStil(13)}>{staerkeAnzeige(z.einheit)}</span>
              ),
              z.abschnitt,
              z.ausstehend > 0 && <span style={nebentext}>ausstehend {z.ausstehend} EP</span>,
              z.zufuehrung && (
                <span style={{ color: rollen.text2 }}>Zuführung an {z.zufuehrung}</span>
              ),
            ]}
          />
        </span>
        {onWaehlen && (
          <Button
            aria-label={`Empfänger wählen: ${z.name}`}
            aria-pressed={istGewaehlt}
            disabled={gesperrt}
            aria-describedby={gesperrt ? grundId : undefined}
            onClick={() => onWaehlen({ art: 'einheit', id: z.id })}
          >
            Wählen
          </Button>
        )}
      </li>
    );
  };

  return (
    <section data-lfh="verpflegung-stand" aria-labelledby={`${id}-offen`} style={{ minWidth: 0 }}>
      <Augenbraue als={ueberschrift} id={`${id}-offen`}>
        Noch nicht verpflegt · {stand.offen.length}
      </Augenbraue>
      {stand.offen.length > 0 && (
        <ul data-lfh="stand-offen" style={listeStil}>
          {stand.offen.map(standZeile)}
        </ul>
      )}
      {stand.ohneEintreffen.length > 0 && (
        <>
          <Augenbraue als={UNTER[ueberschrift]} style={{ marginTop: token.marginXS }}>
            ohne Eintreffen · {stand.ohneEintreffen.length}
          </Augenbraue>
          <ul data-lfh="stand-ohne-eintreffen" style={listeStil}>
            {stand.ohneEintreffen.map(standZeile)}
          </ul>
        </>
      )}
      <Augenbraue als={ueberschrift} style={{ marginTop: token.marginSM }}>
        Verpflegt · {stand.verpflegt.length}
      </Augenbraue>
      {stand.verpflegt.length > 0 && (
        <ul data-lfh="stand-verpflegt" style={listeStil}>
          {stand.verpflegt.map((z) => (
            <li key={z.id} data-einheit={z.id} style={zeileStil}>
              <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                <Teile
                  teile={[
                    z.name,
                    z.funkrufname && <span style={monoStil(13)}>{z.funkrufname}</span>,
                    z.ausgaben.length > 0 && (
                      <span key="m" style={monoStil(13, 500)}>
                        {ausgabenText(z.ausgaben, uhr)}
                      </span>
                    ),
                    // Am gebundenen Gerät (LLH-1048): nur die Summe des Servers, ohne Zeit.
                    z.anderswo > 0 && 'anderswo verpflegt',
                    z.anderswo > 0 && (
                      <span key="a" data-lfh="stand-anderswo" style={monoStil(13, 500)}>
                        {z.anderswo} EP
                      </span>
                    ),
                    z.untereinheiten > 0 &&
                      `mit ${z.untereinheiten} ${z.untereinheiten === 1 ? 'Untereinheit' : 'Untereinheiten'}`,
                    z.abschnitt,
                    z.aufgeloest && <span style={{ color: rollen.text2 }}>aufgelöst</span>,
                  ]}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
      {stand.zufuehrungen.length > 0 && (
        <ul data-lfh="stand-zufuehrung" style={listeStil}>
          {stand.zufuehrungen.map((z) => (
            <li key={z.id} data-abschnitt={z.id} style={zeileStil}>
              <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                <Teile
                  teile={[
                    `Zuführung ${z.name}`,
                    <span key="m" style={monoStil(13, 500)}>
                      {ausgabenText(z.ausgaben, uhr)}
                    </span>,
                  ]}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
