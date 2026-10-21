import { Link } from 'react-router';
import type { AbrufZustand } from '../../api/abrufZustand';
import type { Nachforderung } from '../../api/types';
import { formatVor } from '../../anzeige/abstand';
import { Paneel, monoStil, useRollen } from '../../components/instrument';
import {
  OFFENE_STUFEN,
  offenText,
  stufeWort,
  type NachforderungsZahlen,
} from '../../nachforderungen/nachforderungStufen';
import { nachforderungenPfad } from '../../routing/deeplinks';
import { zeilenzielStil } from './ueberblickStil';
import Zustandsfeld from './Zustandsfeld';

/** Wie viele der am längsten wartenden offenen das Paneel nennt. */
export const NACHFORDERUNGEN_AELTESTE = 2;

/**
 * Die am längsten wartenden offenen Nachforderungen, älteste zuerst — rein, für das Paneel.
 * Gezählt wird nicht hier: die Zahlen kommen aus dem Modulzähler (LFH-550).
 */
export function aeltesteOffene(
  liste: readonly Nachforderung[],
  anzahl = NACHFORDERUNGEN_AELTESTE,
): Nachforderung[] {
  return liste
    .filter((n) => n.status !== 'eingetroffen' && n.status !== 'abgelehnt')
    .sort((a, b) => a.angefordert_at.localeCompare(b.angefordert_at) || a.id - b.id)
    .slice(0, anzahl);
}

/**
 * Paneel „Nachforderungen“ des Führungsüberblicks (LLH-1078): die offenen je Stufe aus dem
 * Server-Zähler, darunter die am längsten wartenden mit ihrem Alter. Nach dem Muster der übrigen
 * Paneele der Seite (`Zustandsfeld`); zieht in den Dashboard-Baukasten um, sobald es ihn gibt.
 */
export default function NachforderungenPaneel({
  einsatzId,
  zustand,
  zahlen,
  aelteste,
  jetzt,
  darfSchreiben,
  onNeuladen,
}: {
  einsatzId: number;
  /** Schlechtester Zustand aus Zähler und Liste. */
  zustand: AbrufZustand;
  zahlen: NachforderungsZahlen | null;
  aelteste: readonly Nachforderung[];
  /** Uhr der Seite (ms). */
  jetzt: number;
  darfSchreiben: boolean;
  onNeuladen: () => void;
}) {
  const { token, rollen } = useRollen();
  const zeile = zeilenzielStil(rollen, token);
  const daten = zustand === 'daten' && zahlen != null;

  return (
    <Paneel
      titel="Nachforderungen"
      meta={daten ? offenText(zahlen) : undefined}
      aktion={
        // Kein Sprung in ein gesperrtes Modul (wie die Kennzahlen ohne Link).
        zustand === 'gesperrt' ? undefined : (
          <Link
            to={nachforderungenPfad(einsatzId)}
            aria-label="Nachforderungen öffnen"
            style={{
              ...monoStil(11),
              color: rollen.bedien,
              display: 'inline-flex',
              alignItems: 'center',
              minHeight: token.controlHeight,
              paddingInline: token.paddingXS,
            }}
          >
            Nachforderungen ↗
          </Link>
        )
      }
    >
      <Zustandsfeld
        zustand={zahlen == null && zustand === 'daten' ? 'gesperrt' : zustand}
        leer={zahlen?.offen === 0}
        leerText="Keine offenen Nachforderungen."
        leerAktion={
          darfSchreiben
            ? { text: 'Nachforderung anlegen', ziel: nachforderungenPfad(einsatzId, { neu: true }) }
            : undefined
        }
        onNeuladen={onNeuladen}
      >
        {zahlen != null && (
          <dl
            data-lfh="nachforderung-stufen"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              margin: 0,
              borderBlockEnd: `1px solid ${rollen.flaeche3}`,
            }}
          >
            {OFFENE_STUFEN.map((stufe) => (
              <div
                key={stufe}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  paddingBlock: token.paddingSM,
                  paddingInline: token.padding,
                  minWidth: 0,
                }}
              >
                <dt style={{ fontSize: 12, color: rollen.gedaempft }}>{stufeWort(stufe)}</dt>
                <dd style={{ margin: 0, ...monoStil(20, 500), color: rollen.text }}>
                  {zahlen[stufe]}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {aelteste.map((n) => (
            <li key={n.id}>
              <Link
                to={nachforderungenPfad(einsatzId, { nachforderung: n.id })}
                data-lfh="ueberblick-nachforderung"
                style={zeile}
              >
                <span
                  style={{
                    ...monoStil(11),
                    color: rollen.gedaempft,
                    flex: '0 0 auto',
                    minWidth: 72,
                  }}
                >
                  {formatVor(n.angefordert_at, jetzt)}
                </span>
                <span
                  style={{
                    flex: '1 1 auto',
                    minWidth: 0,
                    fontSize: 12,
                    lineHeight: 1.45,
                    color: rollen.text2,
                    overflowWrap: 'anywhere',
                  }}
                >
                  {n.anzahl != null ? `${n.anzahl}× ` : ''}
                  {n.art} · {n.bezeichnung}
                </span>
                <span
                  style={{
                    ...monoStil(10),
                    letterSpacing: '0.06em',
                    color: rollen.gedaempft,
                    flex: '0 0 auto',
                  }}
                >
                  {stufeWort(n.status)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Zustandsfeld>
    </Paneel>
  );
}
