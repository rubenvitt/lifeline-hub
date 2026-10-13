import { Button, Flex, Popconfirm, Space, Typography } from 'antd';
import { useMemo } from 'react';
import { StatusChip, monoStil, useRollen } from '../components/instrument';
import { ZeilenFehler } from '../components/SpeicherHinweis';
import type { ZeilenGrund } from '../components/useZeilenFehler';

/**
 * Quittungsstand und Quittieren je Empfänger, geteilt von Einzelauftrag und Einsatzbefehl (Spec
 * `auftraege-befehle`, „Karte eines Befehls“ und „Einsatzbefehl im Detail“; LLH-1173 design.md
 * D7). Die Zeilen sind neutral (`id`, Name, Zeitpunkt der Quittung), damit beide Datenquellen
 * denselben Baustein füllen statt ihn zu kopieren.
 *
 * Der Unterschied liegt in `rueckfrage`: Der Auftrag hat keinen Rückweg und fragt deshalb vor dem
 * Quittieren; der Befehl hat einen (`…/zuruecknehmen`) und quittiert mit einem Klick, der
 * Rückgängig-Hinweis kommt vom Aufrufer (LFH-343, `frontend/AGENTS.md`, „Rückwege und Fehler“).
 */

const { Text } = Typography;

/** Höchstzahl quittierter Empfänger-Chips; der Rest steht als „+n ✓". */
const QUITTIERT_CHIP_GRENZE = 3;

/** Zählzeile „n Empfänger · q/n quittiert“, die Listenkarten und Empfängerblöcke teilen. */
export function Quittungsstand({ anzahl, quittiert }: { anzahl: number; quittiert: number }) {
  const { rollen } = useRollen();
  return (
    <Text
      type="secondary"
      style={{ ...monoStil(11), color: rollen.gedaempft, whiteSpace: 'nowrap' }}
    >
      {anzahl} Empfänger · {quittiert}/{anzahl} quittiert
    </Text>
  );
}

export interface QuittungsZeile {
  id: number;
  /** Angezeigter Name (beim Auftrag mit Besetzung). */
  name: string;
  /** Name im zugänglichen Namen des Knopfs: „Empfang für <ariaName> quittieren“. */
  ariaName: string;
  quittiertAt?: string | null;
}

export interface EmpfaengerQuittungProps {
  zeilen: readonly QuittungsZeile[];
  /** Knöpfe überhaupt zeigen (Schreibrecht, Handler, Zustand des Objekts). */
  canQuittieren: boolean;
  /** Welche Zeilen quittierbar sind; ohne: alle (ein Abschnittsgerät nur seine). */
  canQuittierenFor?: (id: number) => boolean;
  /** Eine Quittung läuft: alle Knöpfe isLocked, `pendingId` zeigt den ladenden. */
  isLocked?: boolean;
  pendingId?: number | null;
  onQuittieren?: (id: number) => void;
  /** Mit Rückfrage nur, wo es keinen Rückweg gibt (LFH-343). */
  rueckfrage?: { title: string; okText: string };
  /** Vorsatz der Zeile mit offenen Empfängern. */
  offenLabel?: string;
  /** Grund der zuletzt abgelehnten Quittung; steht unter den Empfängern. */
  error?: ZeilenGrund | null;
  /** Zählstand vom Server (Auftrag); ohne: aus den Zeilen gezählt. */
  stand?: { anzahl: number; quittiert: number };
}

/** Quittungsstand, quittierte Chips und die Zeile „Quittung offen:“ mit ihren Knöpfen. */
export default function EmpfaengerQuittung({
  zeilen,
  canQuittieren,
  canQuittierenFor,
  isLocked = false,
  pendingId = null,
  onQuittieren,
  rueckfrage,
  offenLabel = 'Quittung offen:',
  error,
  stand,
}: EmpfaengerQuittungProps) {
  // Der Statuschip zeigt nur QUITTIERTE Empfänger; offene stehen in der Zeile „Quittung offen:".
  // Die Zeile hängt NICHT am Schreibrecht, nur ihr Knopf — sonst verlöre ein Beobachter den Namen
  // des offenen Empfängers.
  // Ein optimistischer Cache kann das Ziel schon als quittiert markieren. Solange der Request
  // läuft, bleibt es trotzdem als ladender Aktionsknopf sichtbar; andere Quittierungen sind
  // serialisiert und damit isLocked.
  const ziel = isLocked ? pendingId : null;
  const [quittierte, offene] = useMemo(
    () => [
      zeilen.filter((e) => e.quittiertAt && e.id !== ziel),
      zeilen.filter((e) => !e.quittiertAt || e.id === ziel),
    ],
    [zeilen, ziel],
  );
  // Die Anzeigegrenze schneidet nur QUITTIERTE Chips: Quittiertes ist Lesestoff, Offenes ist
  // Arbeit und steht immer da. Schnitte sie die ganze Liste, verlöre ein offener Empfänger seinen
  // Knopf.
  const sichtbareQuittierte = quittierte.slice(0, QUITTIERT_CHIP_GRENZE);
  const restQuittierte = quittierte.length - sichtbareQuittierte.length;
  const quittiere = (id: number) => {
    if (!isLocked) onQuittieren?.(id);
  };

  return (
    <>
      <Flex align="center" gap={8} wrap style={{ marginBottom: 8 }}>
        <Quittungsstand
          anzahl={stand?.anzahl ?? zeilen.length}
          quittiert={stand?.quittiert ?? zeilen.filter((e) => e.quittiertAt).length}
        />
        <Space size={4} wrap>
          {sichtbareQuittierte.map((e) => (
            <StatusChip key={e.id} ton="normal" wort={`${e.name} ✓`} />
          ))}
          {/* „+n" zählt nur verborgene QUITTIERTE — das ✓ sagt es ohne Farbe (WCAG 1.4.1). */}
          {restQuittierte > 0 && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              +{restQuittierte} ✓
            </Text>
          )}
        </Space>
      </Flex>

      {/* Quittungs-Aktionen in EIGENER Zeile, nicht als antippbarer Chip: derselbe Chip trägt auch den
         reinen Statuszustand, die Bedienbarkeit hinge sonst allein an der Farbe. Wer für WEN
         quittiert, steht im zugänglichen Namen. */}
      {offene.length > 0 && (
        <Flex align="center" gap={8} wrap style={{ marginBottom: 8 }}>
          <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
            {offenLabel}
          </Text>
          {offene.map((e) => {
            const knopf = (
              <Button
                aria-label={`Empfang für ${e.ariaName} quittieren`}
                loading={isLocked && pendingId === e.id}
                disabled={isLocked}
                onClick={rueckfrage ? undefined : () => quittiere(e.id)}
              >
                Quittieren
              </Button>
            );
            return (
              <Space key={e.id} size={4}>
                <Text style={{ fontSize: 13 }}>{e.name}</Text>
                {canQuittieren &&
                  (canQuittierenFor?.(e.id) ?? true) &&
                  (rueckfrage ? (
                    <Popconfirm
                      title={rueckfrage.title}
                      okText={rueckfrage.okText}
                      cancelText="Abbrechen"
                      disabled={isLocked}
                      onConfirm={() => quittiere(e.id)}
                    >
                      {knopf}
                    </Popconfirm>
                  ) : (
                    knopf
                  ))}
              </Space>
            );
          })}
        </Flex>
      )}
      {/* Grund einer abgelehnten Quittung unter den Empfängern (LFH-1077, `frontend/AGENTS.md`,
         „Rückwege und Fehler“). Außerhalb der Zeile, weil sie fehlt, sobald alle quittiert sind:
         gerade „bereits quittiert“ bliebe sonst ungesagt. */}
      {error && (
        <div style={{ marginBottom: 8 }}>
          <ZeilenFehler fehler={error.fehler} fallback={error.fallback} />
        </div>
      )}
    </>
  );
}
