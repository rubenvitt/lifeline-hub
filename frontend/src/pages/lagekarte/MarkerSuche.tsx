import { useMemo, useState } from 'react';
import { Input, theme } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { Liste, ListenEintrag } from '../../components/Liste';
import { SeitenLeer } from '../../components/SeitenZustand';
/*
 * Wert-Import aus `./Sidebar`, die ihrerseits `MarkerSuche` importiert — ein Zyklus, der
 * bewusst stehen bleibt: `bedienzielStil` ist repo-weit das zitierte Referenzmuster für eine
 * reine, exportierte Stilfunktion, und mehrere Dateien verweisen namentlich auf ihren Ort.
 *
 * Laufzeitsicher, weil `bedienzielStil` eine gehobene `export function` ist, die erst beim
 * Rendern gerufen wird. Wer hier eine Konstante auf Modulebene aus `Sidebar` ableitet, bricht
 * das — dann ist der Umzug fällig.
 */
import { bedienzielStil } from './Sidebar';
import type { KarteMarker } from './marker';
import { gruppiereTreffer } from './objektsuche';

/**
 * Suchfeld über die wählbaren verorteten Kartenobjekte (LFH-716; Kandidat aus LFH-344 · M63).
 *
 * **Liste, keine Tabelle** (CLAUDE.md, „Die Liste ist die zweite Frage"): hier wird gesucht
 * und angesprungen, nicht verglichen.
 *
 * **Leere Gruppen fallen weg, der Leerzustand steht EINMAL.** `Liste` baut sich ihren
 * Leerzustand selbst, sobald `dataSource` leer ist — neun leere Gruppen wären neun Kästen.
 *
 * **Welche Objekte überhaupt hier stehen, entscheidet der Aufrufer** über `suchbareMarker`
 * (`objektsuche.ts`) — dort sitzen die Modulsperren für Betreuung und Betroffene.
 *
 * **Keine Entprellung:** gefiltert wird lokal über eine geladene Liste, eine Frist brächte nur
 * Verzögerung ohne eingesparte Abfrage.
 */
export interface MarkerSucheProps {
  marker: KarteMarker[];
  onMarkerWaehlen: (schluessel: string) => void;
  /** Eine Lagebild-Quelle ist ausgefallen — dann steht „—" statt einer Zahl und keine Leere. */
  zaehlerUnbekannt?: boolean;
}

export default function MarkerSuche({
  marker,
  onMarkerWaehlen,
  zaehlerUnbekannt,
}: MarkerSucheProps) {
  const { token } = theme.useToken();
  const [suche, setSuche] = useState('');
  const gruppen = useMemo(() => gruppiereTreffer(marker, suche), [marker, suche]);
  const begriff = suche.trim();
  const zaehler = (n: number) => (zaehlerUnbekannt ? '—' : String(n));

  return (
    <div>
      <Input
        // Eigener Name, weil `allowClear` einen zweiten Knopf in denselben Wrapper hängt und
        // eine Abfrage über den Platzhalter dann mehrdeutig wird.
        aria-label="Kartenobjekte suchen"
        placeholder="Kartenobjekte suchen"
        allowClear
        value={suche}
        onChange={(e) => setSuche(e.target.value)}
        // Die Hülle nimmt dem Icon sein englisches `aria-label` („search").
        prefix={
          <span aria-hidden="true">
            <SearchOutlined />
          </span>
        }
        style={{ marginBottom: token.marginXS }}
      />

      {gruppen.length === 0 ? (
        // Der Fehlerzweig steht vorn: „Nichts verortet" und „kein Kartenobjekt zu X" sind
        // Aussagen über die Lage, und im Fehlerfall hat sie niemand geprüft.
        <SeitenLeer
          titel={
            zaehlerUnbekannt
              ? 'Verortete Objekte konnten nicht vollständig geladen werden'
              : begriff !== ''
                ? `Kein Kartenobjekt zu „${begriff}“`
                : 'Nichts verortet'
          }
          hinweis={
            zaehlerUnbekannt
              ? 'Was hier steht, ist unvollständig — die Karte zeigt womöglich mehr.'
              : begriff !== ''
                ? 'Suchbegriff kürzen oder Schreibweise prüfen.'
                : 'Objekte erscheinen hier, sobald sie auf der Karte platziert sind.'
          }
        />
      ) : (
        gruppen.map((g) => (
          <Liste
            key={g.typ}
            size="small"
            // Template-Literal, damit die Zeile EIN Textknoten bleibt.
            header={`${g.label} (${zaehler(g.treffer.length)})`}
            dataSource={g.treffer}
            rowKey={(m) => m.schluessel}
            style={{ marginBottom: token.marginXS }}
            renderItem={(m) => (
              <ListenEintrag
                style={bedienzielStil(token)}
                onClick={() => onMarkerWaehlen(m.schluessel)}
              >
                {m.label}
              </ListenEintrag>
            )}
          />
        ))
      )}
    </div>
  );
}
