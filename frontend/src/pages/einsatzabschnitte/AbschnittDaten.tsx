import type { ReactNode } from 'react';
import type { Einsatzabschnitt } from '../../api/types';
import StaerkeAnzeige from '../../anzeige/StaerkeAnzeige';
import FunkErreichbarkeit from '../../components/FunkErreichbarkeit';
import StatusTag from '../../components/StatusTag';
import { Datenfeld, Datenraster, useRollen } from '../../components/instrument';
import { abschnittLagezustand } from '../../theme/statusFarben';
import type { AbschnittStaerken } from './abschnittStaerke';

/**
 * Die Angaben eines Einsatzabschnitts zum Lesen — EIN Bauteil für den Lesezweig der
 * Abschnittsseite und die Vorschau der Sprungpalette (LFH-664). Ohne Knöpfe: Bearbeiten und
 * Auflösen bleiben der Seite vorbehalten.
 *
 * Die Stärke rechnet der Aufrufer (`abschnittStaerken`), weil sie die Einheitenliste und den
 * ganzen Abschnittsbaum braucht, die das Bauteil nicht kennen soll. Fehlt sie noch (Liste lädt)
 * oder ist sie nicht abrufbar, setzt der Aufrufer `staerken` auf `undefined` und sagt den Grund
 * über `staerkenErsatz` — „—" hieße sonst „keine Einheit zugeordnet", und das wäre eine Aussage,
 * die niemand gemessen hat.
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
      {/* Die fehlende Beurteilung steht als WORT da, nicht als leere Zelle: sonst ist „noch
          nicht beurteilt“ von „vergessen anzuzeigen“ nicht zu trennen. */}
      <Datenfeld label="Lagezustand">
        {a.lagezustand ? (
          <StatusTag darstellung={abschnittLagezustand[a.lagezustand]} darstellungsart="rand" />
        ) : (
          <span style={{ color: rollen.gedaempft }}>nicht beurteilt</span>
        )}
      </Datenfeld>
      <Datenfeld label="Fortschritt" mono={a.fortschritt != null}>
        {a.fortschritt != null ? (
          `${a.fortschritt} %`
        ) : (
          <span style={{ color: rollen.gedaempft }}>nicht eingeschätzt</span>
        )}
      </Datenfeld>
      {a.abschnittsauftrag && (
        <Datenfeld label="Abschnittsauftrag" breit>
          {a.abschnittsauftrag}
        </Datenfeld>
      )}
      <Datenfeld label="Funk / Erreichbarkeit" breit>
        <FunkErreichbarkeit
          sprechgruppen={a.sprechgruppen}
          kommunikationsmittel={a.kommunikationsmittel}
          erreichbarkeit={a.erreichbarkeit}
          leerText="keine Funk-Angaben"
        />
      </Datenfeld>
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
