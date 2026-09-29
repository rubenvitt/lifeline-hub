import { useMemo, useState } from 'react';
import { Input, theme } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { Liste, ListenEintrag } from '../../components/Liste';
import { SeitenLeer } from '../../components/SeitenZustand';
/*
 * Wert-Import aus `./Sidebar`, die ihrerseits `MarkerSuche` importiert — ein bewusster Zyklus:
 * `bedienzielStil` ist das repo-weit zitierte Referenzmuster und bleibt an seinem Ort.
 * Laufzeitsicher, weil es eine gehobene `export function` ist, die erst beim Rendern läuft. Wer aus
 * `Sidebar` eine Konstante auf Modulebene ableitet, bricht das.
 */
import { bedienzielStil } from './Sidebar';
import type { KarteMarker } from './marker';
import { gruppiereTreffer } from './objektsuche';

/**
 * Suchfeld über die wählbaren verorteten Kartenobjekte — eine Liste, keine Tabelle (hier wird
 * gesucht und angesprungen, nicht verglichen).
 *
 * Leere Gruppen fallen weg, der Leerzustand steht einmal (`Liste` baute sonst je Gruppe einen).
 * Welche Objekte hier stehen, entscheidet der Aufrufer über `suchbareMarker` (`objektsuche.ts`),
 * dort sitzen die Modulsperren. Keine Entprellung: gefiltert wird lokal.
 */
interface MarkerSucheProps {
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
        // Eigener Name: `allowClear` hängt einen zweiten Knopf in denselben Wrapper, eine Abfrage
        // über den Platzhalter wäre mehrdeutig.
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
        // Der Fehlerzweig steht vorn: „Nichts verortet" wäre eine Aussage über die Lage, die im
        // Fehlerfall niemand geprüft hat.
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
            kopf={{
              // Template-Literal, damit die Zeile EIN Textknoten bleibt.
              inhalt: `${g.label} (${zaehler(g.treffer.length)})`,
              // Einziger Einbauort ist das Paneel „Verortet" in `Sidebar`, dessen Kopf ein `<h2>`
              // ist (`KlappPaneel`).
              unterEbene: 2,
            }}
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
