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
 * Lese-Vorschau einer Einheit in der Sprungpalette (LFH-664).
 *
 * DATEN: das Listenfach der Palette (`datensatzAbfrage.einheiten`) mit `select` auf die `id`.
 * Die Detailseite der Einheit ist ein Formular — es gibt keinen Lese-Inhalt zum Herauslösen,
 * das Bauteil ist neu.
 *
 * STATUS aus `einheitStatusAnzeige` (dieselbe Ableitung wie das Meldebild): FMS-Code und Wort
 * als Etikett („S2 · Frei auf Wache", Schreibweise der Handstatus-Zelle in
 * `KraefteuebersichtPage`); bei „gemischt" steht die Verteilung als Text darunter, statt einen
 * Status zu erfinden. Als `StatusTag`, nicht als `StatusChip`: ein HANDstatus trägt die
 * Mandantenfarbe seines Katalogeintrags (`status.farbe`, ungeprüfter Freitext), und die geht
 * wie bei Fahrzeug und Personal an `farbe` und erzwingt die Rand-Form (design.md §6). Ein aus
 * den Fahrzeugen abgeleiteter Status bleibt ohne Mandantenfarbe — wie im Meldebild.
 *
 * STÄRKE in der BOS-Schreibweise F/UF/M//Σ; die Soll-Stärke nur, wenn sie gesetzt ist
 * (dieselbe Regel wie im Seitenkopf von `EinheitDetailPage`: eine erfundene Soll-Stärke wäre
 * eine Behauptung). Die Stärke inklusive unterstellter Einheiten steht nur, wenn sie von der
 * eigenen abweicht — sonst stünde dieselbe Zahl zweimal da. Leere optionale Angaben fehlen
 * ganz; Funk/Erreichbarkeit erscheint nur, wenn es Funkdaten gibt.
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
