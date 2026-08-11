import { Space, theme } from 'antd';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { einsatzKeys } from '../api/queryKeys';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { rollenFarbe, statusKategorie } from '../theme/statusFarben';
import { staerkeText, verdichte } from './kraeftebild';

/**
 * Die Führungsantwort im Kopf einer Kräfte-Modulseite (LFH-338 · C3, Befund H21).
 *
 * Σ-Stärke und Fahrzeugverfügbarkeit über der Tabelle, verlinkt auf das volle Meldebild:
 * die Führungsantwort oben, die Pflegearbeit darunter. Bis dahin verlinkte KEINE der vier
 * Kräfte-Modulseiten die aggregierende Übersicht (grep: 0 Treffer) — wer auf der
 * Fahrzeugseite stand und die Gesamtstärke brauchte, suchte sie über die Modulnavigation.
 *
 * ── SIE LÄDT SELBST ─────────────────────────────────────────────────────────────
 *
 * Nach dem Muster der Lage-Dashboard-Kacheln („jede Kachel hängt an ihren eigenen
 * Queries"). Gemessen am Bestand führt von den vier Seiten nur `EinheitenPage` beide
 * Listen; `MaterialPage` führt keine von beiden. Die Alternative wäre, jeder Seite ein bis
 * zwei Queries zu verpassen und die Zahlen über Props hereinzureichen — viermal dieselbe
 * Verdrahtung, und drei der vier Seiten trügen Daten, die sie selbst nicht anzeigen.
 *
 * Der zweite Abruf ist keiner: die Schlüssel sind DIESELBEN `einsatzKeys` wie auf den
 * Seiten, TanStack Query dedupliziert also gegen die schon laufende Query.
 *
 * ── KEIN MATERIAL ───────────────────────────────────────────────────────────────
 *
 * Die Zeile beantwortet „welche Kräfte habe ich", nicht „welches Gerät". `verdichte` nimmt
 * Material als dritten Parameter und bekommt hier bewusst eine leere Liste — das hält den
 * Abruf bei zwei Listen statt drei, auch auf der Materialseite selbst, wo die Gerätefrage
 * die Tabelle darunter beantwortet.
 *
 * ── STUMM BEI FEHLER, STUMM BEIM LADEN ──────────────────────────────────────────
 *
 * Kein Nullwert und kein Skelett. „0/0/0//0" auf einer Führungsfläche liest sich wie eine
 * Meldung und ist keine — es sähe aus wie „keine Kräfte im Einsatz", während in Wahrheit
 * nur der Abruf scheiterte. Und ein Platzhalter, der eine Zeile hoch ein- und ausblendet,
 * verschöbe die Tabelle darunter bei jedem Laden (Prüflisten-Kriterium 12, CLS ≤ 0,1).
 * Die Fehleranzeige gehört der Tabelle darunter, die dieselben Daten trägt.
 *
 * ── DEN PFAD BAUT DER AUFRUFER ──────────────────────────────────────────────────
 *
 * Dieselbe Arbeitsteilung wie bei `SeitenLeerAktion.pfad` und `PlatzhalterRueckweg`: die
 * Komponente kennt keine Einsatz-Routen, sie bekommt den fertigen Pfad. Der Nebeneffekt ist
 * der eigentliche Gewinn — `kraefteuebersichtPfad` steht damit einmal in jeder der vier
 * Modulseiten, statt viermal gar nicht. Das ist wörtlich das Akzeptanzkriterium des
 * Tickets, und es gibt trotzdem nur EINEN Link je Seite; ein zweiter Kopf-Link daneben
 * hätte den Grep ebenfalls befriedigt und die Bedienung verschlechtert.
 */
export default function Verdichtungszeile({
  einsatzId,
  pfad,
}: {
  einsatzId: number;
  pfad: string;
}) {
  const { token } = theme.useToken();
  const personalQuery = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
  });
  const fahrzeugeQuery = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
  });

  if (personalQuery.isError || fahrzeugeQuery.isError) return null;
  if (!personalQuery.data || !fahrzeugeQuery.data) return null;

  const v = verdichte(personalQuery.data, fahrzeugeQuery.data, []);
  return (
    <Space wrap align="center" style={{ marginBlockEnd: token.margin }}>
      <span style={{ color: token.colorTextSecondary }}>Stärke</span>
      <strong>{staerkeText(v.staerke)}</strong>
      <span aria-hidden>·</span>
      <span style={{ color: token.colorTextSecondary }}>Fzg {v.anzahlFahrzeuge}</span>
      <span style={{ color: rollenFarbe(statusKategorie.verfuegbar.rolle, token) }}>
        {v.fahrzeugStatus.verfuegbar} frei
      </span>
      <span style={{ color: rollenFarbe(statusKategorie.gebunden.rolle, token) }}>
        {v.fahrzeugStatus.gebunden} gebunden
      </span>
      <span style={{ color: rollenFarbe(statusKategorie.nicht_verfuegbar.rolle, token) }}>
        {v.fahrzeugStatus.nicht_verfuegbar} n. verf.
      </span>
      <Link to={pfad}>Kräfteübersicht</Link>
    </Space>
  );
}
