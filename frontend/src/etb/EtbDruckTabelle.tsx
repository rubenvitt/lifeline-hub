import { theme } from 'antd';
import type { EtbEintragAnzeige, MeldeWeg } from '../api/types';
import Markdown from '../components/Markdown';
import { monoStil } from '../components/instrument';
import { inZone, type AnzeigeKonventionen } from '../anzeige/format';
import { etbTyp } from '../theme/statusFarben';
import { istNachgetragen } from './typFarben';
import { MELDEWEG_OPTIONEN } from './schnellerfassungModell';
import { berichtigungsindex } from './zeitachseModell';

/**
 * Die Papierform des Einsatztagebuchs (LFH-22, design.md D5).
 *
 * ── BENANNTE AUSNAHME ──────────────────────────────────────────────────────────────
 * Zwei Regeln der Bedien-Leitlinie gelten hier ausdrücklich NICHT: „das ETB ist auf allen
 * Breiten eine Zeitachse" (Neuentwurf S4) und „Tabelle nur, wenn verglichen wird"
 * (LFH-330/B2). Die Druckansicht ist kein Bedienort, sondern die Papierform des Tagebuchs —
 * der Vordruck mit laufender Nummer, Zeit, Von/An, Inhalt. Deshalb:
 * - ein schlichtes HTML-`<table>`, weder `KatalogTabelle` noch `Datensicht`: keine
 *   Sortierung, kein Filter, kein Spaltenschalter, keine Zeilenaktion;
 * - nur eine Tabelle wiederholt ihren Kopf auf jeder Druckseite (`thead` als
 *   `table-header-group` in `druck/druck.css`), und eine Zeile bricht nicht über den Rand;
 * - Ordnung AUFSTEIGEND nach `lfd_nr`, nicht nach Ereigniszeit: auf Papier beweist die
 *   lückenlose Nummernfolge die Vollständigkeit, und ein Nachtrag steht an seiner Nummer.
 * Das Typwort steht ohne Farbe: Farbe trägt auf Papier nichts, das Wort war schon der
 * zweite Kanal.
 *
 * Wer hier Sortierung oder Filter nachrüstet, baut einen zweiten Bedienort für das ETB und
 * gehört auf `Datensicht` zurück — mit Begründung gegen die Zeitachse.
 */

const MELDEWEG_WORT = Object.fromEntries(
  MELDEWEG_OPTIONEN.map((o) => [o.value, o.label]),
) as Record<MeldeWeg, string>;

interface Props {
  /** Die gedruckte Auswahl, in beliebiger Ordnung. */
  eintraege: readonly EtbEintragAnzeige[];
  /**
   * Berichtigungen außerhalb der Auswahl (Berichtigungs-Durchgang aus `druckAbruf.ts`) —
   * nur für „berichtigt durch Nr. m" und die Nummer eines Grundeintrags, nicht gedruckt.
   */
  berichtigungen: readonly EtbEintragAnzeige[];
  konventionen: AnzeigeKonventionen;
}

function zeit(wire: string, konventionen: AnzeigeKonventionen): string {
  return inZone(wire, konventionen).format('DD.MM.YYYY HH:mm');
}

/** „nachgetragen um 10:40" — mit Datum nur, wenn die Erfassung an einem anderen Tag lag. */
function nachtrag(e: EtbEintragAnzeige, konventionen: AnzeigeKonventionen): string {
  const ereignis = inZone(e.ereigniszeit, konventionen);
  const erfasst = inZone(e.received_at, konventionen);
  return `nachgetragen um ${erfasst.format(erfasst.isSame(ereignis, 'day') ? 'HH:mm' : 'DD.MM.YYYY HH:mm')}`;
}

export default function EtbDruckTabelle({ eintraege, berichtigungen, konventionen }: Props) {
  const { token } = theme.useToken();
  const geordnet = [...eintraege].sort((a, b) => a.lfd_nr - b.lfd_nr);
  // Index über Auswahl ∪ Berichtigungs-Durchgang: so findet ein gedruckter Eintrag seine
  // Berichtigung auch dann, wenn sie nicht gedruckt wird.
  const bekannt = new Map<number, EtbEintragAnzeige>();
  for (const e of [...eintraege, ...berichtigungen]) bekannt.set(e.id, e);
  const index = berichtigungsindex([...bekannt.values()]);

  const zelle = {
    padding: `${token.paddingXXS}px ${token.paddingXS}px`,
    borderBlockEnd: `1px solid ${token.colorBorderSecondary}`,
    verticalAlign: 'top',
    textAlign: 'start',
  } as const;
  const hinweis = { color: token.colorTextSecondary, fontSize: token.fontSizeSM } as const;

  return (
    <table
      data-lfh="etb-druck-tabelle"
      style={{ width: '100%', borderCollapse: 'collapse', fontSize: token.fontSize }}
    >
      <thead>
        <tr>
          {['Nr.', 'Zeit', 'Typ', 'Von/An', 'Inhalt', 'Erfasser'].map((k) => (
            <th
              key={k}
              scope="col"
              style={{
                ...zelle,
                borderBlockEnd: `1px solid ${token.colorBorder}`,
                fontWeight: 600,
              }}
            >
              {k}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {geordnet.map((e) => {
          const grund = index.grundeintrag(e);
          const durch = index.berichtigtDurch(e);
          return (
            <tr key={e.id}>
              <td style={{ ...zelle, ...monoStil(token.fontSize), whiteSpace: 'nowrap' }}>
                {e.lfd_nr}
              </td>
              <td style={{ ...zelle, ...monoStil(token.fontSize), whiteSpace: 'nowrap' }}>
                <div>{zeit(e.ereigniszeit, konventionen)}</div>
                {istNachgetragen(e.ereigniszeit, e.received_at) && (
                  <div style={hinweis}>{nachtrag(e, konventionen)}</div>
                )}
              </td>
              <td style={zelle}>{etbTyp[e.typ].label}</td>
              <td style={zelle}>
                {e.von && <div>von {e.von}</div>}
                {e.an && <div>an {e.an}</div>}
                {e.meldeweg && <div style={hinweis}>{MELDEWEG_WORT[e.meldeweg]}</div>}
              </td>
              <td style={zelle}>
                {/* Über dem Text steht der Titel des Druckkopfs (hier `h2`, weil der
                    Seitenkopf am Bildschirm das `h1` trägt); eine Gruppenüberschrift gibt es
                    nicht — `#` im Inhalt wird `h3`. */}
                <Markdown variante="dokument" unterEbene={2}>
                  {e.inhalt}
                </Markdown>
                {grund && (
                  <div style={hinweis}>
                    {/* Die Nummer des Grundeintrags ist nur bekannt, wenn er geladen ist
                        (Auswahl oder Berichtigungs-Durchgang) — erfunden wird sie nie. */}
                    {grund.lfd_nr != null
                      ? `berichtigt Nr. ${grund.lfd_nr}`
                      : 'berichtigt einen Eintrag außerhalb dieser Auswahl'}
                  </div>
                )}
                {durch.length > 0 && (
                  <div style={hinweis}>
                    berichtigt durch{' '}
                    {[...durch]
                      .sort((a, b) => a.lfd_nr - b.lfd_nr)
                      .map((d) => `Nr. ${d.lfd_nr}`)
                      .join(', ')}
                  </div>
                )}
              </td>
              <td style={zelle}>
                {e.erfasser_name}
                {e.erfasser_funktion && <div style={hinweis}>{e.erfasser_funktion}</div>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
