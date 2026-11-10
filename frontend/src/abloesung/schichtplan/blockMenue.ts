/**
 * Kontextmenü eines Schichtplan-Blocks (LLH-1600, Stufe 3 von LLH-1590; Baustein LLH-1596, Spec
 * `datensatz-aktionsmenue`). EINE Quelle für die Einträge im Schichtplan des Einsatzes und in der
 * Vorplanung; das Raster zeigt sie über `useKontextMenue` und `KontextMenue`. Einen ⋮-Knopf trägt
 * ein Block nicht (abgestimmt 09.11.2026: Blöcke sind oft nur wenige Pixel breit); den Weg ohne
 * Zeiger tragen die Kontextmenü-Taste und der Blockdialog.
 *
 * Einträge (abgestimmt 09.11.2026): „Bearbeiten“ öffnet den Blockdialog, „Als nächsten Block
 * kopieren“ kopiert still (die Kopie erscheint im Raster), „Wechsel vollziehen …“ nur wo der
 * Blockdialog den Knopf zeigt, rot hinter dem Trenner „Block löschen …“ mit Rückfrage im Dialog
 * (Spec: „Rückfrage im Dialog, nicht im Menü“). Ohne Schreibrecht gibt der Aufrufer kein Menü; dann
 * bleibt das Browsermenü.
 */
import { App } from 'antd';
import { useEffect, useRef } from 'react';
import type { SchichtplanBlock } from '../../api/types';
import type { MenueEintrag } from '../../components/MenueAusloeser';
import type { RasterBlockMenue } from './SchichtplanRaster';

export type BlockMenueKey = 'bearbeiten' | 'kopieren' | 'wechsel' | 'loeschen';

/** Einträge eines Blocks; `laeuft`: ein Kopieren oder Löschen aus dem Menü ist noch unterwegs. */
export function blockMenueEintraege({
  wechsel,
  laeuft,
}: {
  wechsel: boolean;
  laeuft: boolean;
}): MenueEintrag<BlockMenueKey>[] {
  const sperre = laeuft ? { gesperrt: true as const } : {};
  return [
    { key: 'bearbeiten', label: 'Bearbeiten' },
    { key: 'kopieren', label: 'Als nächsten Block kopieren', ...sperre },
    ...(wechsel ? [{ key: 'wechsel' as const, label: 'Wechsel vollziehen …' }] : []),
    { key: 'loeschen', label: 'Block löschen …', gefahr: true, ...sperre },
  ];
}

export interface BlockMenueOptionen {
  blockVon: (blockId: number) => SchichtplanBlock | null;
  /** Öffnet den Blockdialog. */
  onBearbeiten: (blockId: number) => void;
  /** „Als nächsten Block kopieren“, ohne Dialog. */
  onKopieren: (block: SchichtplanBlock) => void;
  /** Erst nach der Rückfrage, mit dem Stand des Blocks zu diesem Zeitpunkt. */
  onLoeschen: (block: SchichtplanBlock) => void;
  /** Wechsel aus dem Plan (nur Einsatz); ohne gibt es den Eintrag nicht. */
  onWechsel?: (block: SchichtplanBlock) => void;
  wechselMoeglich?: (block: SchichtplanBlock) => boolean;
  laeuft: boolean;
}

export function useBlockMenue(optionen: BlockMenueOptionen): RasterBlockMenue {
  const { modal } = App.useApp();
  const aktuell = useRef(optionen);
  useEffect(() => {
    aktuell.current = optionen;
  });

  // Die offene Rückfrage schließt, wenn ihr Block anderswo gelöscht wird (Spec, Szenario
  // „Nachricht wird währenddessen gelöscht“); ein zweites Löschen geht dann nicht hinaus.
  const rueckfrage = useRef<{ blockId: number; zu: () => void } | null>(null);
  useEffect(() => {
    const r = rueckfrage.current;
    if (r != null && optionen.blockVon(r.blockId) == null) {
      rueckfrage.current = null;
      r.zu();
    }
  });
  useEffect(
    () => () => {
      rueckfrage.current?.zu();
      rueckfrage.current = null;
    },
    [],
  );

  const { blockVon, onWechsel, wechselMoeglich, laeuft } = optionen;
  return {
    eintraege: (blockId) => {
      const block = blockVon(blockId);
      if (block == null) return [];
      return blockMenueEintraege({
        wechsel: onWechsel != null && (wechselMoeglich?.(block) ?? true),
        laeuft,
      });
    },
    onWahl: (blockId, key) => {
      const o = aktuell.current;
      const block = o.blockVon(blockId);
      if (block == null) return;
      switch (key as BlockMenueKey) {
        case 'bearbeiten':
          o.onBearbeiten(blockId);
          return;
        case 'kopieren':
          o.onKopieren(block);
          return;
        case 'wechsel':
          o.onWechsel?.(block);
          return;
        case 'loeschen': {
          const instanz = modal.confirm({
            title: 'Block löschen?',
            okText: 'Block löschen',
            cancelText: 'Behalten',
            okButtonProps: { danger: true },
            onOk: () => {
              rueckfrage.current = null;
              const jetzt = aktuell.current.blockVon(blockId);
              if (jetzt != null) aktuell.current.onLoeschen(jetzt);
            },
            onCancel: () => {
              rueckfrage.current = null;
            },
          });
          rueckfrage.current = { blockId, zu: () => instanz.destroy() };
          return;
        }
      }
    },
  };
}
