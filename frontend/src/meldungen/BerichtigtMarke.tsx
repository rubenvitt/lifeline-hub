import type { CSSProperties } from 'react';
import { KennungsLink } from '../components/kennungsLink';
import { StatusChip } from '../components/instrument';
import { useGeraetDarf } from '../geraet/geraetSicht';
import { etbPfad } from '../routing/deeplinks';

interface BerichtigtMarkeProps {
  einsatzId: number;
  /** Jüngste ETB-Berichtigung des Eintrags der Meldung (`etb_berichtigung_id`); fehlt ohne. */
  berichtigungId?: number | null;
  /** Ihre laufende Nummer im ETB (`etb_berichtigung_lfd_nr`). */
  berichtigungLfdNr?: number | null;
  /** Legt sich über die Hülle, etwa der Abstand im Meta einer Zeile. */
  style?: CSSProperties;
}

/**
 * Marke „berichtigt“ an Meldungskarte und Lagemeldungs-Zeile (LLH-1382, Spec `meldungseingang`,
 * „Eine berichtigte Meldung zeigt die Berichtigung“; Herleitung `llh-1021/llh-1382/design.md`).
 * Der Wortlaut bleibt, wie er einging; eine Korrektur gibt es nur als ETB-Berichtigung seines
 * Eintrags. Wortlaut und Ton wie im ETB (`EtbZeitachse`, `kopfMeta`): Chip „berichtigt“ in
 * `achtung`, daneben der Sprung auf die jüngste Berichtigung (`?eintrag=`). „ETB“ steht im Text,
 * weil neben der Karte schon „#12“ der Meldung steht.
 *
 * Ein Gerät hat kein ETB (keine Ansicht trägt `GET …/etb`, `src/geraet/mod.rs`): dort fehlt die
 * Marke ganz, wie „↗ Auftrag“ (design.md D4).
 */
export default function BerichtigtMarke({
  berichtigungId,
  berichtigungLfdNr,
  ...rest
}: BerichtigtMarkeProps) {
  // Ohne Berichtigung kein Hook: die Meldungskarte zählt in Tests ihre Renders über
  // `useGeraetDarf` (`MeldungenPage.blaettern.test.tsx`), und die meisten Karten tragen keine.
  if (berichtigungId == null || berichtigungLfdNr == null) return null;
  return (
    <Verweis {...rest} berichtigungId={berichtigungId} berichtigungLfdNr={berichtigungLfdNr} />
  );
}

function Verweis({
  einsatzId,
  berichtigungId,
  berichtigungLfdNr,
  style,
}: BerichtigtMarkeProps & { berichtigungId: number; berichtigungLfdNr: number }) {
  const darf = useGeraetDarf();
  if (!darf('fremde-module')) return null;
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', ...style }}
    >
      <StatusChip ton="achtung" wort="berichtigt" />
      <KennungsLink
        to={etbPfad(einsatzId, { eintrag: berichtigungId })}
        aria-label={`Berichtigung im ETB, Nr. ${berichtigungLfdNr}`}
      >
        → ETB Nr. {berichtigungLfdNr}
      </KennungsLink>
    </span>
  );
}
