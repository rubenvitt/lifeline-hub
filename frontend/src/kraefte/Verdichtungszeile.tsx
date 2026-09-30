import { Space } from 'antd';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { einsatzKeys } from '../api/queryKeys';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { statusKategorie, type Statusrolle } from '../theme/statusFarben';
import { statusFlaeche, tonVonRolle } from '../components/instrument/statusFlaeche';
import { useRollen } from '../components/instrument';
import { staerkeText, verdichte } from './kraeftebild';

/**
 * Der Meldebild-Link als Bedienziel auf der Dichte-Staffel: ein `<a>` erbt keine Steuerhöhe
 * (im Browser blieb er im Handschuh-Betrieb bei 16 px).
 * ZWEI Angaben: `minHeight` aus `controlHeight` plus mitziehende Polsterung auf BEIDEN Achsen
 * (hier polstert niemand sonst). `inline-flex`, weil der Link ein Glied einer waagerechten
 * `Space`-Zeile ist; `flex` risse ihn auf volle Breite. Rein und exportiert, damit über zwei
 * Dichtestufen ohne Rendern prüfbar.
 */
export function verdichtungsLinkStil(token: { controlHeight: number; paddingSM: number }) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: token.controlHeight,
    padding: `${token.paddingSM}px`,
  } as const;
}

/**
 * Textfarbe einer Statuszahl in der Zeile: die TEXTROLLE des Tons (`normalText`/`achtungText`/
 * `alarmText`, über `statusFlaeche`), nicht die Füllrolle aus `rollenFarbe`. Die Zahlen stehen
 * als Text auf Seitengrund (`grund`); dort tragen die Füllrollen am Tag den Boden 7 : 1 nicht
 * (gemessen 5,80 / 5,78 / 5,66), die Textrollen schon (gerechnet 7,68 / 7,72 / 7,51; nachts 11,58 /
 * 12,45 / 7,18). LFH-538, gemessen in `e2e/kraefte-kontrast.spec.ts`. Rein.
 */
export function verdichtungsTextfarbe(
  rollen: Parameters<typeof statusFlaeche>[0],
  rolle: Statusrolle,
): string {
  return statusFlaeche(rollen, tonVonRolle(rolle) ?? 'neutral').text;
}

/**
 * Die Führungsantwort im Kopf einer Kräfte-Modulseite: Σ-Stärke und Fahrzeugverfügbarkeit über
 * der Tabelle, verlinkt auf das volle Meldebild.
 *
 * SIE LÄDT SELBST (wie die Lage-Dashboard-Kacheln), statt dass jede Seite Listen hereinreicht,
 * die sie selbst nicht anzeigt. Die Schlüssel sind DIESELBEN `einsatzKeys` wie auf den Seiten,
 * TanStack dedupliziert.
 *
 * KEIN MATERIAL: die Zeile beantwortet „welche Kräfte habe ich"; `verdichte` bekommt eine leere
 * Materialliste, der Abruf bleibt bei zwei Listen.
 *
 * STUMM BEI FEHLER UND BEIM LADEN: „0/0/0//0" läse sich wie „keine Kräfte im Einsatz", und ein
 * ein- und ausblendender Platzhalter verschöbe die Tabelle darunter. Die Fehleranzeige gehört
 * der Tabelle, die dieselben Daten trägt.
 *
 * Den Pfad baut der Aufrufer; die Komponente kennt keine Einsatz-Routen.
 */

export default function Verdichtungszeile({
  einsatzId,
  pfad,
}: {
  einsatzId: number;
  pfad: string;
}) {
  const { token, rollen } = useRollen();
  const personalQuery = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
  });
  const fahrzeugeQuery = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
  });

  // Der Datenriegel steht VORN: liegen keine Zahlen vor, ist die Zeile still — ob der Abruf noch
  // läuft oder scheiterte. Liegen Zahlen vor und scheitert erst ein Folgeabruf, bleiben sie
  // stehen (echt, nur womöglich alt), sonst spränge die Tabelle darunter unter dem Cursor.
  if (!personalQuery.data || !fahrzeugeQuery.data) return null;

  const v = verdichte(personalQuery.data, fahrzeugeQuery.data, []);
  return (
    <Space wrap align="center" style={{ marginBlockEnd: token.margin }}>
      <span style={{ color: token.colorTextSecondary }}>Stärke</span>
      <strong>{staerkeText(v.staerke)}</strong>
      <span aria-hidden>·</span>
      <span style={{ color: token.colorTextSecondary }}>Fzg {v.anzahlFahrzeuge}</span>
      <span style={{ color: verdichtungsTextfarbe(rollen, statusKategorie.verfuegbar.rolle) }}>
        {v.fahrzeugStatus.verfuegbar} frei
      </span>
      <span style={{ color: verdichtungsTextfarbe(rollen, statusKategorie.gebunden.rolle) }}>
        {v.fahrzeugStatus.gebunden} gebunden
      </span>
      <span
        style={{ color: verdichtungsTextfarbe(rollen, statusKategorie.nicht_verfuegbar.rolle) }}
      >
        {v.fahrzeugStatus.nicht_verfuegbar} n. verf.
      </span>
      {/* Der Linktext folgt dem Seitennamen „Meldebild"; die Route bleibt `kraefteuebersicht`. */}
      <Link to={pfad} style={verdichtungsLinkStil(token)}>
        Meldebild
      </Link>
    </Space>
  );
}
