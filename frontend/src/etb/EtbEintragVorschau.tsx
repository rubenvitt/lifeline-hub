import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { EtbEintragAnzeige } from '../api/types';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { formatUhrzeit } from '../anzeige/format';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { etbNummerAbfrage } from '../command-palette/datensatzAbfrage';
import { VORSCHAU_UNTER_EBENE, VorschauZustand } from '../command-palette/VorschauZustand';
import Markdown from '../components/Markdown';
import { Datenfeld, Datenraster, monoStil, useRollen } from '../components/instrument';
import { etbTyp, etbTypFarbe } from '../theme/statusFarben';
import EtbAnhaenge from './EtbAnhaenge';
import EtbBacklinkBadges from './EtbBacklinkBadges';
import { MELDEWEG_LABEL } from './EtbZeitachse';
import { istNachgetragen } from './typFarben';
import { verweisStil } from './zeitachseModell';
import { etbPfad } from '../routing/deeplinks';
import { verfasserText } from './verfasser';

/**
 * Lese-Vorschau eines ETB-Eintrags in der Sprungpalette (LFH-664).
 *
 * ── DATEN ────────────────────────────────────────────────────────────────────────────
 *
 * Das ETB hat kein Fach, das einen Eintrag über seine `id` adressiert. Gelesen wird deshalb
 * das NUMMERNFACH der Palette ({@link etbNummerAbfrage}, dieselbe Abruffunktion und Frische):
 * für einen Nummerntreffer ist es warm, für einen Volltexttreffer kostet es einen Abruf mit
 * `limit: 1`.
 *
 * Gezeigt wird nur ein Eintrag mit DERSELBEN `id`. `before_lfd_nr` filtert strikt `<` — fehlt
 * die Nummer (Lücke), liefert der Cursor den nächstälteren Eintrag, der ohne den Vergleich
 * still an seiner Stelle stünde. So heißt es „nicht mehr vorhanden".
 *
 * ── WAS FEHLT, MIT ABSICHT ───────────────────────────────────────────────────────────
 *
 * Die Nummer des Grundeintrags einer Berichtigung: der Eintrag trägt nur dessen `id`, die
 * VORWÄRTSRICHTUNG heißt deshalb „berichtigt einen älteren Eintrag" wie der Rückfall der
 * Zeitachse. Keine Aktionen — die Vorschau liest nur. Leere optionale Angaben fehlen statt als
 * Platzhalter.
 *
 * Die RÜCKRICHTUNG („berichtigt durch Nr. …") liefert der Server am Eintrag
 * (`berichtigt_durch`, LFH-689), unabhängig von Seite und Filter — ohne sie wäre ein überholter
 * Eintrag hier nicht als überholt erkennbar. Die Zeitachse bildet sie weiter aus der geladenen
 * Liste (`berichtigungsindex`).
 *
 * Die Verweise auf Befehl, Lagebericht, Auftrag und Folgeaufträge bleiben: sie ändern nichts,
 * brauchen nur diesen Eintrag (`EtbBacklinkBadges`), und ein Klick darauf schließt die Palette.
 */
export default function EtbEintragVorschau({
  einsatzId,
  id,
  lfdNr,
}: {
  einsatzId: number;
  id: number;
  lfdNr: number;
}) {
  const select = useCallback((liste: EtbEintragAnzeige[]) => liste.find((e) => e.id === id), [id]);
  const abfrage = useQuery({ ...etbNummerAbfrage(einsatzId, lfdNr), select });
  return (
    <VorschauZustand abfrage={abfrage} sorte="Der ETB-Eintrag">
      {(e) => <EintragInhalt einsatzId={einsatzId} eintrag={e} />}
    </VorschauZustand>
  );
}

function EintragInhalt({
  einsatzId,
  eintrag: e,
}: {
  einsatzId: number;
  eintrag: EtbEintragAnzeige;
}) {
  const { token, rollen } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const farbe = etbTypFarbe(e.typ, token);
  const vonAn = e.von || e.an ? `${e.von || '—'} → ${e.an || '—'}` : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: token.margin }}>
      <Datenraster spalten={2} beschriftung={`ETB-Eintrag Nr. ${e.lfd_nr}`}>
        <Datenfeld label="Nummer" mono>
          Nr. {e.lfd_nr}
        </Datenfeld>
        <Datenfeld label="Ereigniszeit" mono>
          <ZeitAnzeige wert={e.ereigniszeit} />
        </Datenfeld>
        <Datenfeld label="Typ">
          {/* Typkante + Typwort wie in der Zeitachse: die Kante ist Dekoration, das Wort
              trägt die Aussage (WCAG 1.4.1). */}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: token.marginXS }}>
            <span
              aria-hidden="true"
              data-lfh="typkante"
              style={{ width: 2, alignSelf: 'stretch', background: farbe.kante }}
            />
            <span
              data-lfh="typwort"
              style={{
                ...monoStil(11, 500),
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: farbe.wort,
              }}
            >
              {etbTyp[e.typ].label}
            </span>
          </span>
        </Datenfeld>
        {vonAn && <Datenfeld label="Von → An">{vonAn}</Datenfeld>}
        {e.meldeweg && <Datenfeld label="Meldeweg">{MELDEWEG_LABEL[e.meldeweg]}</Datenfeld>}
        {e.veranlassung && <Datenfeld label="Veranlassung">{e.veranlassung}</Datenfeld>}
        <Datenfeld label="Verfasser">{verfasserText(e)}</Datenfeld>
        {(e.berichtigt_eintrag_id != null || e.berichtigt_durch.length > 0) && (
          <Datenfeld label="Berichtigung" breit>
            {/* Beide Richtungen in EINEM Feld: ein Feld „Berichtigt durch“ trüge das Wort doppelt.
                Blau, nicht rot: Rot bedient nichts — Wortlaut und Ziel wie in der Zeitachse. */}
            <span style={{ display: 'inline-flex', flexWrap: 'wrap', columnGap: token.marginXS }}>
              {e.berichtigt_eintrag_id != null && (
                <span>
                  berichtigt einen älteren Eintrag —{' '}
                  <Link
                    to={etbPfad(einsatzId, { eintrag: e.berichtigt_eintrag_id })}
                    style={verweisStil(token)}
                  >
                    Grundeintrag anzeigen<span aria-hidden="true"> ↗</span>
                  </Link>
                </span>
              )}
              {e.berichtigt_durch.map((b) => (
                <Link
                  key={b.id}
                  to={etbPfad(einsatzId, { eintrag: b.id })}
                  style={verweisStil(token)}
                >
                  berichtigt durch Nr. {b.lfd_nr}
                  <span aria-hidden="true"> ↗</span>
                </Link>
              ))}
            </span>
          </Datenfeld>
        )}
        {istNachgetragen(e.ereigniszeit, e.received_at) && (
          <Datenfeld label="Erfasst">
            <span style={{ color: rollen.text2 }}>
              <span aria-hidden="true">⧖ </span>nachgetragen um{' '}
              {formatUhrzeit(e.received_at, konventionen)}
            </span>
          </Datenfeld>
        )}
      </Datenraster>
      <Markdown variante="kompakt" unterEbene={VORSCHAU_UNTER_EBENE}>
        {e.inhalt}
      </Markdown>
      {/* Rendert nichts ohne Verknüpfung. */}
      <EtbBacklinkBadges eintrag={e} einsatzId={einsatzId} />
      {/* Dasselbe Bauteil wie in der Zeitachse; rendert nichts ohne Anhang. */}
      <EtbAnhaenge eintrag={e} einsatzId={einsatzId} />
    </div>
  );
}
