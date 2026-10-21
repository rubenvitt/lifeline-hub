import { Button, Dropdown, Space } from 'antd';
import { IconChevronRunter, IconPlus } from '../icons';
import type { LageberichtVorlageKey } from '../api/types';
import { VORLAGEN } from './vorlagen';

/** Die Vorlage des Primärknopfs; die übrigen stehen im Menü am Pfeil. */
export const VORGABE_VORLAGE: LageberichtVorlageKey = 'lagebericht';

/** Zugänglicher Name des Pfeils — exportiert, damit Tests ihn nicht nachschreiben. */
export const ANDERE_VORLAGE = 'Andere Vorlage wählen';

/** Menüeintrag für die Vorgabe-Vorlage ohne Startinhalt (LLH-1081). */
export const LEERER_LAGEVORTRAG = 'Leerer Lagevortrag';

/** Menüschlüssel des leeren Lagevortrags; keine Vorlage heißt so. */
const LEER_KEY = 'leer';

interface Props {
  /**
   * Ein Aufruf legt an und öffnet; der Riegel gegen Doppelklick liegt beim Aufrufer.
   * `ausLagebild`: mit Startinhalt aus den Quellen der Vorlage (LLH-1081); nur „Leerer
   * Lagevortrag“ verzichtet darauf.
   */
  onAnlegen: (vorlage: LageberichtVorlageKey, ausLagebild: boolean) => void;
  laeuft: boolean;
  /** Ohne Schreibrecht: sichtbar gesperrt, der Grund steht im Seitenhinweis (M16). */
  gesperrt: boolean;
}

/**
 * „Neuer Lagevortrag“ als geteilter Knopf (LLH-1064): der Primärteil legt sofort einen
 * „Lagevortrag zur Information“ an, gefüllt aus dem Lagebild (LLH-1081), der Pfeil daneben bietet
 * „Leerer Lagevortrag“ und die übrigen Vorlagen. Kein Dialog: Titel und Zeitstand ändert man im
 * Entwurf.
 *
 * Kein `size`: beide Teile tragen die Steuerhöhe der Dichte, der Pfeil als Knopf ohne Text den
 * Boden `controlHeightSM` in der Breite (`antdKnopf`), die Menüeinträge die Steuerhöhe des
 * `Dropdown` (gemessen in `e2e/trefflaeche-pruefflaechen.spec.ts`, C13). Kein `MenueAusloeser`:
 * das ist der Dreipunkt für Datensatz-Aktionen; hier wählt der Pfeil eine Variante der
 * Primäraktion. `aria-label` am Primärteil: antds Ladezeichen flösse sonst in den Namen ein.
 */
export default function NeuerLagevortragKnopf({ onAnlegen, laeuft, gesperrt }: Props) {
  const andere = VORLAGEN.filter((v) => v.schluessel !== VORGABE_VORLAGE);
  return (
    // `data-lfh="geteilter-knopf"`: der Seitenkopf zählt beide Teile als EINE Primäraktion.
    <span data-lfh="geteilter-knopf" style={{ display: 'inline-flex' }}>
      <Space.Compact>
        <Button
          type="primary"
          icon={<IconPlus />}
          aria-label="Neuer Lagevortrag"
          loading={laeuft}
          disabled={gesperrt}
          onClick={() => onAnlegen(VORGABE_VORLAGE, true)}
        >
          Neuer Lagevortrag
        </Button>
        <Dropdown
          trigger={['click']}
          // Ohne `autoFocus` bleibt der Fokus am Pfeil, die Pfeiltasten heben im Menü nichts hervor.
          autoFocus
          disabled={gesperrt || laeuft}
          menu={{
            items: [
              { key: LEER_KEY, label: LEERER_LAGEVORTRAG },
              ...andere.map((v) => ({ key: v.schluessel, label: v.label })),
            ],
            onClick: ({ key }) =>
              key === LEER_KEY
                ? onAnlegen(VORGABE_VORLAGE, false)
                : onAnlegen(key as LageberichtVorlageKey, true),
          }}
        >
          <Button
            type="primary"
            disabled={gesperrt || laeuft}
            aria-label={ANDERE_VORLAGE}
            icon={
              <span aria-hidden="true" style={{ display: 'inline-flex' }}>
                <IconChevronRunter />
              </span>
            }
          />
        </Dropdown>
      </Space.Compact>
    </span>
  );
}
