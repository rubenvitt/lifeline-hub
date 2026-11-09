import { Button, Flex } from 'antd';
import { useId } from 'react';
import type { SchichtplanBlock, SchichtplanWechselpunkt } from '../../api/types';
import { alsZeitpunkt } from '../../anzeige/zeitEingabe';
import { Augenbraue, StatusChip, monoStil, useRollen } from '../../components/instrument';
import type { StatusTon } from '../../components/instrument/statusFlaeche';

/**
 * Wechsel-Leiste über dem Raster (LLH-1555 Welle 3, Change `qo0amhd5-wechsel-aus-schichtplan`,
 * Spec `kraefte-schichtplan` „Wechsel-Leiste“): je Zeitpunkt ein Knopf „14:00 · 3 Wechsel“, darunter
 * die Wechsel des gewählten Zeitpunkts mit ihrem Griff. Ein gebündelter Hinweis springt mit
 * `?wechsel=<minute>` auf seinen Zeitpunkt.
 *
 * Kein eigener Rechenweg: Zeitpunkte, Einträge und ihren Stand liefert der Server im Plan
 * (`wechsel`, `abloesung::schichtplan::wechselpunkte`); hier wird nur angeordnet
 * (`frontend/src/kraefte/AGENTS.md`, „Schichtplan“). Die Bezeichnung des Postens kommt aus dem
 * Block des Plans.
 */

interface SchichtplanWechselLeisteProps {
  wechsel: readonly SchichtplanWechselpunkt[];
  bloecke: readonly SchichtplanBlock[];
  jetzt: number;
  formatZeit: (ms: number) => string;
  /** Der gewählte Zeitpunkt (Minuten seit 1970); `null` = keiner. */
  gewaehlt: number | null;
  onWaehlen: (minute: number | null) => void;
  /** Griff an UHS und Pause: öffnet den Wechsel des Blocks; `undefined` = hier nicht möglich. */
  wechselGriff: (blockId: number) => (() => void) | undefined;
  /** Griff an einer Einheit: der Vollzug ihrer Schicht; fehlt ohne Schreibrecht. */
  onVollziehen?: (abloesungId: number) => void;
}

type Eintrag = SchichtplanWechselpunkt['eintraege'][number];

const STAND_WORT: Record<Eintrag['stand'], string> = {
  offen: 'offen',
  vollzogen: 'vollzogen',
  ohne_schicht: 'keine Schicht',
};

function standTon(e: Eintrag, vorbei: boolean): StatusTon {
  if (e.stand === 'vollzogen') return 'normal';
  if (e.stand === 'offen') return vorbei ? 'achtung' : 'bedien';
  return 'neutral';
}

/** Was an diesem Zeitpunkt geschieht, aus Bediensicht; an einer Einheit sagt es der Server. */
function artWort(e: Eintrag): string {
  switch (e.art) {
    case 'uhs':
      return 'Wechsel an der UHS';
    case 'pause_beginn':
      return 'Pause beginnt';
    case 'pause_ende':
      return 'Pause endet';
    case 'einheit':
      return e.einheit === 'beginn'
        ? 'Posten beginnt'
        : e.einheit === 'ende'
          ? 'Posten endet'
          : 'Schichtwechsel';
  }
}

export default function SchichtplanWechselLeiste({
  wechsel,
  bloecke,
  jetzt,
  formatZeit,
  gewaehlt,
  onWaehlen,
  wechselGriff,
  onVollziehen,
}: SchichtplanWechselLeisteProps) {
  const { token, rollen } = useRollen();
  const kopfId = useId();
  const listeId = useId();
  if (wechsel.length === 0) return null;
  const punkt = wechsel.find((w) => w.minute === gewaehlt) ?? null;
  const blockVon = (id: number) => bloecke.find((b) => b.id === id);
  const ms = (w: SchichtplanWechselpunkt) => alsZeitpunkt(w.zeitpunkt)?.valueOf() ?? 0;

  return (
    <section
      aria-labelledby={kopfId}
      data-lfh="schichtplan-wechsel-leiste"
      style={{ marginBottom: token.margin }}
    >
      <Augenbraue als="h2" id={kopfId}>
        Wechsel laut Plan
      </Augenbraue>
      <Flex
        gap={token.marginXS}
        role="group"
        aria-labelledby={kopfId}
        style={{ overflowX: 'auto', paddingBlock: token.paddingXXS }}
      >
        {wechsel.map((w) => {
          const offen = w.eintraege.filter((e) => e.stand === 'offen').length;
          const vorbei = ms(w) < jetzt;
          const an = w.minute === gewaehlt;
          return (
            <Button
              key={w.minute}
              aria-pressed={an}
              aria-controls={an ? listeId : undefined}
              data-minute={w.minute}
              onClick={() => onWaehlen(an ? null : w.minute)}
              style={{
                flex: 'none',
                background: an ? rollen.auswahlFlaeche : undefined,
                borderColor: vorbei && offen > 0 ? rollen.achtung : undefined,
              }}
            >
              <span style={monoStil(13, 500)}>{formatZeit(ms(w))}</span>
              <span aria-hidden="true">·</span>
              <span>
                {w.eintraege.length === 1 ? '1 Wechsel' : `${w.eintraege.length} Wechsel`}
              </span>
              {offen > 0 && offen < w.eintraege.length && (
                <span style={{ color: rollen.gedaempft }}>({offen} offen)</span>
              )}
              {vorbei && offen > 0 && <StatusChip ton="achtung" wort="überfällig" />}
            </Button>
          );
        })}
      </Flex>
      {punkt && (
        <ul
          id={listeId}
          aria-label={`Wechsel um ${formatZeit(ms(punkt))}`}
          style={{
            listStyle: 'none',
            margin: 0,
            marginTop: token.marginXS,
            padding: 0,
            border: `1px solid ${rollen.linie}`,
          }}
        >
          {punkt.eintraege.map((e) => {
            const block = blockVon(e.block_id);
            const name =
              block?.posten.bezeichnung ?? (block?.posten.art === 'pause' ? 'Pause' : 'Posten');
            const griff =
              e.art === 'einheit'
                ? e.stand === 'offen' && e.abloesung_id != null && onVollziehen
                  ? {
                      text: 'Ablösung vollziehen',
                      los: () => onVollziehen(e.abloesung_id as number),
                    }
                  : null
                : (() => {
                    const los = wechselGriff(e.block_id);
                    if (!los) return null;
                    return {
                      text: e.stand === 'offen' ? 'Wechsel vollziehen' : 'Wechsel ansehen',
                      los,
                    };
                  })();
            return (
              <li
                key={`${e.art}-${e.block_id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: token.marginSM,
                  flexWrap: 'wrap',
                  minHeight: token.controlHeight,
                  paddingInline: token.paddingSM,
                  paddingBlock: token.paddingXXS,
                  borderTop: `1px solid ${rollen.linie}`,
                }}
              >
                <span style={{ flex: '1 1 10rem', minWidth: 0 }}>
                  <span style={{ color: rollen.text }}>{name}</span>
                  <span style={{ color: rollen.gedaempft }}>
                    {' · '}
                    {artWort(e)}
                  </span>
                </span>
                <StatusChip ton={standTon(e, ms(punkt) < jetzt)} wort={STAND_WORT[e.stand]} />
                {griff && <Button onClick={griff.los}>{griff.text}</Button>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
