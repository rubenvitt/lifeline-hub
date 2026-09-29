import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Einheit, Staerke } from '../api/types';
import StaerkeAnzeige from '../anzeige/StaerkeAnzeige';
import FunkErreichbarkeit from '../components/FunkErreichbarkeit';
import StatusTag from '../components/StatusTag';
import { Datenfeld, Datenraster, monoStil, useRollen } from '../components/instrument';
import { datensatzAbfrage } from '../command-palette/datensatzAbfrage';
import { VorschauZustand } from '../command-palette/VorschauZustand';
import { einheitStatusAnzeige } from './meldebildRaster';

function gleicheStaerke(a: Staerke, b: Staerke): boolean {
  return (
    a.fuehrer === b.fuehrer && a.unterfuehrer === b.unterfuehrer && a.mannschaft === b.mannschaft
  );
}

/** „1 Fahrzeug" / „2 Fahrzeuge" — die Zahl ist echt, auch bei 0. */
function mittelText(e: Einheit): string {
  const f = e.fahrzeug_mitglieder.length;
  return `${f} ${f === 1 ? 'Fahrzeug' : 'Fahrzeuge'} · ${e.personal_mitglieder.length} Personal · ${e.material_mitglieder.length} Material`;
}

/**
 * Lese-Vorschau einer Einheit in der Sprungpalette.
 *
 * DATEN: das Listenfach der Palette (`datensatzAbfrage.einheiten`) mit `select` auf die `id`.
 *
 * STATUS aus `einheitStatusAnzeige` wie im Meldebild: „S2 · Frei auf Wache"; bei „gemischt"
 * steht die Verteilung darunter, statt einen Status zu erfinden. Als `StatusTag`, weil ein
 * HANDstatus die Mandantenfarbe seines Katalogeintrags trägt, die die Rand-Form erzwingt.
 *
 * STÄRKE F/UF/M//Σ; die Soll-Stärke nur, wenn gesetzt. Die Stärke inklusive Unterstellter nur,
 * wenn sie von der eigenen abweicht. Leere optionale Angaben fehlen ganz; Funk nur mit
 * Funkdaten.
 */
export default function EinheitVorschau({ einsatzId, id }: { einsatzId: number; id: number }) {
  const { token, rollen } = useRollen();
  const select = useCallback((liste: Einheit[]) => liste.find((e) => e.id === id), [id]);
  const abfrage = useQuery({ ...datensatzAbfrage.einheiten(einsatzId), select });

  return (
    <VorschauZustand abfrage={abfrage} sorte="Die Einheit">
      {(e) => {
        const status = einheitStatusAnzeige(e.status);
        const hatFunk =
          (e.sprechgruppen?.length ?? 0) > 0 || !!e.kommunikationsmittel || !!e.erreichbarkeit;
        return (
          <Datenraster spalten={2} beschriftung={`Einheit ${e.name}`}>
            <Datenfeld label="Name">{e.name}</Datenfeld>
            <Datenfeld label="Status">
              <span
                style={{ display: 'inline-flex', flexDirection: 'column', gap: token.marginXXS }}
              >
                <StatusTag
                  darstellung={{
                    rolle: status.ton,
                    label: status.code ? `${status.code} · ${status.wort}` : status.wort,
                  }}
                  farbe={e.status.quelle === 'hand' ? e.status.status?.farbe : null}
                />
                {status.verteilung && (
                  <span style={{ ...monoStil(11), color: rollen.gedaempft }}>
                    {status.verteilung}
                  </span>
                )}
              </span>
            </Datenfeld>
            {e.typ_label && <Datenfeld label="Typ">{e.typ_label}</Datenfeld>}
            {e.funkrufname && (
              <Datenfeld label="Funkrufname" mono>
                {e.funkrufname}
              </Datenfeld>
            )}
            <Datenfeld label="Ist-Stärke (F/UF/M//Σ)" mono>
              <StaerkeAnzeige wert={e.ist} />
            </Datenfeld>
            {!gleicheStaerke(e.ist, e.ist_kumuliert) && (
              <Datenfeld label="Ist inkl. Unterstellte" mono>
                <StaerkeAnzeige wert={e.ist_kumuliert} />
              </Datenfeld>
            )}
            {e.soll && (
              <Datenfeld label="Soll-Stärke (F/UF/M//Σ)" mono>
                <StaerkeAnzeige wert={e.soll} />
              </Datenfeld>
            )}
            {e.fuehrer_name && <Datenfeld label="Führer">{e.fuehrer_name}</Datenfeld>}
            {e.abschnitt_name && <Datenfeld label="Abschnitt">{e.abschnitt_name}</Datenfeld>}
            <Datenfeld label="Zugeordnet" mono>
              {mittelText(e)}
            </Datenfeld>
            {hatFunk && (
              <Datenfeld label="Funk / Erreichbarkeit" breit>
                <FunkErreichbarkeit
                  sprechgruppen={e.sprechgruppen}
                  kommunikationsmittel={e.kommunikationsmittel}
                  erreichbarkeit={e.erreichbarkeit}
                />
              </Datenfeld>
            )}
            {e.bemerkung && (
              <Datenfeld label="Bemerkung" breit>
                {e.bemerkung}
              </Datenfeld>
            )}
          </Datenraster>
        );
      }}
    </VorschauZustand>
  );
}
