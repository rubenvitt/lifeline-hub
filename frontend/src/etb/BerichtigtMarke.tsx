import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { StatusChip, useRollen } from '../components/instrument';
import { etbPfad } from '../routing/deeplinks';
import { juengsteBerichtigung, type MitBerichtigungen } from './berichtigung';
import { verweisStil } from './zeitachseModell';

/**
 * Die Kennzeichnung eines berichtigten ETB-Eintrags (LLH-1099, LLH-1321): Marke `achtung`
 * „berichtigt“ und der Sprung „→ Nr. n“ auf die jüngste Berichtigung, davor gesetzt vor den
 * übrigen Kopfinhalt (`children`). Ohne Berichtigung steht nur der Kopfinhalt da. Dieselbe Form
 * in jeder Ansicht, die ETB-Einträge listet — sonst hält man dort die falsche Fassung für gültig.
 *
 * Der Sprung führt über `?eintrag=` ohne Filter (LFH-25): die ETB-Seite lädt nach, bis die
 * Berichtigung da ist. Der Text des Eintrags bleibt, wie er ist: er ist ein Beleg.
 */
export default function BerichtigtMarke({
  einsatzId,
  eintrag,
  children,
}: {
  einsatzId: number;
  eintrag: MitBerichtigungen;
  children?: ReactNode;
}) {
  const { token } = useRollen();
  const juengste = juengsteBerichtigung(eintrag);
  if (!juengste) return <>{children}</>;
  return (
    <span
      data-lfh="berichtigt-marke"
      style={{
        display: 'inline-flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: token.marginXS,
      }}
    >
      <StatusChip ton="achtung" wort="berichtigt" />
      <Link to={etbPfad(einsatzId, { eintrag: juengste.id })} style={verweisStil(token)}>
        → Nr. {juengste.lfd_nr}
      </Link>
      {children}
    </span>
  );
}
