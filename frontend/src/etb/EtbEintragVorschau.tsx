import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { EtbEintragAnzeige } from '../api/types';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { formatUhrzeit } from '../anzeige/format';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { etbNummerAbfrage } from '../command-palette/datensatzAbfrage';
import { VORSCHAU_UNTER_EBENE, VorschauZustand } from '../command-palette/VorschauZustand';
import Markdown from '../components/Markdown';
import { Datenfeld, Datenraster, monoStil, useRollen } from '../components/instrument';
import { etbTyp, etbTypFarbe } from '../theme/statusFarben';
import EtbBacklinkBadges from './EtbBacklinkBadges';
import { MELDEWEG_LABEL } from './EtbZeitachse';
import { istNachgetragen } from './typFarben';
import { verfasserText } from './verfasser';

/**
 * Lese-Vorschau eines ETB-Eintrags in der Sprungpalette (LFH-664, Design Entscheidung 2).
 *
 * ── DATEN ────────────────────────────────────────────────────────────────────────────
 *
 * Das ETB hat kein Fach, das einen Eintrag über seine `id` adressiert; die Suchfächer hängen
 * am Begriff. Gelesen wird deshalb das NUMMERNFACH der Palette ({@link etbNummerAbfrage},
 * dieselbe Abruffunktion und Frische): für einen Nummerntreffer ist es warm, für einen
 * Volltexttreffer kostet es genau einen Abruf mit `limit: 1`.
 *
 * Gezeigt wird nur ein Eintrag mit DERSELBEN `id`. `before_lfd_nr` filtert strikt `<` — fehlt
 * die Nummer (Lücke), liefert der Cursor den nächstälteren Eintrag, und ohne den Vergleich
 * stünde der still an seiner Stelle. So heißt es „nicht mehr vorhanden".
 *
 * ── WAS FEHLT, MIT ABSICHT ───────────────────────────────────────────────────────────
 *
 * Keine Berichtigungshinweise („berichtigt durch Nr. …", „Grundeintrag anzeigen"): sie
 * brauchen den Berichtigungsindex über die ganze Liste, die Vorschau hat einen Eintrag
 * (Design, Non-Goals). Keine Aktionen (Berichtigen, Wiedervorlage, Auftrag erteilen) — die
 * Vorschau liest nur. Leere optionale Angaben (von/an, Meldeweg, Veranlassung) stehen nicht
 * als Platzhalter da, sondern fehlen.
 *
 * Die Verweise auf Befehl, Lagebericht, Auftrag und Folgeaufträge bleiben dagegen: sie ändern
 * nichts, brauchen nur diesen einen Eintrag (`EtbBacklinkBadges`, dasselbe Bauteil wie in der
 * Zeitachse), und ein Klick darauf schließt die Palette (Design Entscheidung 8).
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
    </div>
  );
}
