import type { ReactNode } from 'react';
import type { Einsatzabschnitt } from '../../api/types';
import StaerkeAnzeige from '../../anzeige/StaerkeAnzeige';
import FunkUndTelefon from '../../components/FunkUndTelefon';
import StatusTag from '../../components/StatusTag';
import { Datenfeld, Datenraster, useRollen } from '../../components/instrument';
import { abschnittLagezustand } from '../../theme/statusFarben';
import type { AbschnittStaerken } from './abschnittStaerke';

/**
 * Die Angaben eines Einsatzabschnitts zum Lesen — ein Bauteil für den Lesezweig der Abschnittsseite
 * und die Vorschau der Sprungpalette, ohne Knöpfe.
 *
 * Die Stärke rechnet der Aufrufer (`abschnittStaerken`), weil sie Einheitenliste und Abschnittsbaum
 * braucht. Fehlt sie, kommt `staerken` als `undefined` plus Grund in `staerkenErsatz` — „—" hieße
 * „keine Einheit zugeordnet", und das wäre ungeprüft.
 */
export default function AbschnittDaten({
  abschnitt: a,
  staerken,
  staerkenErsatz = '—',
  spalten = 2,
}: {
  abschnitt: Einsatzabschnitt;
  staerken: AbschnittStaerken | undefined;
  staerkenErsatz?: ReactNode;
  spalten?: number;
}) {
  const { rollen } = useRollen();
  return (
    <Datenraster spalten={spalten} beschriftung="Abschnittsdaten">
      {a.kurzbezeichnung && <Datenfeld label="Kurzbezeichnung">{a.kurzbezeichnung}</Datenfeld>}
      <Datenfeld label="Abschnittsleiter">{a.leiter_name ?? '—'}</Datenfeld>
      {/* Fehlende Beurteilung als Wort, nicht als leere Zelle: sonst ist „nicht beurteilt“ von
          „vergessen anzuzeigen“ nicht zu trennen. */}
      <Datenfeld label="Lagezustand">
        {a.lagezustand ? (
          <StatusTag darstellung={abschnittLagezustand[a.lagezustand]} darstellungsart="rand" />
        ) : (
          <span style={{ color: rollen.gedaempft }}>nicht beurteilt</span>
        )}
      </Datenfeld>
      {/* Kein Fortschritt (LFH-1208, LLH-1170): eine geschätzte Prozentzahl ist im Einsatz nicht
          belastbar; die Lage trägt der Lagezustand, den Arbeitsstand die offenen Aufträge. */}
      {a.abschnittsauftrag && (
        <Datenfeld label="Abschnittsauftrag" breit>
          {a.abschnittsauftrag}
        </Datenfeld>
      )}
      {/* Funk und Telefon getrennt (LLH-1134). */}
      <FunkUndTelefon
        rufname={a.rufname}
        sprechgruppen={a.sprechgruppen}
        verbindungen={a.verbindungen}
      />
      <Datenfeld label="Stärke (F/UF/M//Σ)" mono>
        {staerken ? <StaerkeAnzeige wert={staerken.eigene} /> : staerkenErsatz}
      </Datenfeld>
      <Datenfeld label="Stärke inkl. Unterabschnitte (F/UF/M//Σ)" mono>
        {staerken ? <StaerkeAnzeige wert={staerken.inklUnter} /> : staerkenErsatz}
      </Datenfeld>
      {a.bemerkung && (
        <Datenfeld label="Bemerkung" breit>
          {a.bemerkung}
        </Datenfeld>
      )}
    </Datenraster>
  );
}
