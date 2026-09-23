import { App, Skeleton, Typography } from 'antd';
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
} from 'react';
import type { EinsatzFahrzeug, Einheit, FahrzeugStatus } from '../api/types';
import { formatUhrzeitMitTag } from '../anzeige/format';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import StatusWahl, { type StatusBedienung } from '../components/StatusWahl';
import Tastenkuerzel from '../components/Tastenkuerzel';
import { monoStil, Paneel, Sammelbanner, StatusChip, useRollen } from '../components/instrument';
import { statusKategorie, type StatusDarstellung } from '../theme/statusFarben';
import {
  baueFmsTableau,
  fmsStatusOptionen,
  OHNE_EINHEIT_TITEL,
  zifferZuordnung,
} from './fmsTableauKern';
import { fahrzeugStatus } from './meldebildRaster';

/**
 * FMS-Tableau (LFH-642) — alle Fahrzeuge des Einsatzes auf einer Fläche, Status per Klick,
 * die Ziffer als Beschleuniger. Formverdikt und Reihenfolge: Kopf von `fmsTableauKern.ts`.
 *
 * ── EIN BEDIENZIEL JE KACHEL ───────────────────────────────────────────────────────────
 *
 * Bedient wird über `StatusWahl` (antd-`Button` mit Menü im Portal, Höhe vom
 * `ConfigProvider`). Die Kachel selbst ist NICHT klickbar: eine klickbare Fläche wäre ein
 * handgebautes Bedienziel mit Dichte-Zusicherung (LFH-365), und sie stünde als zweiter Weg
 * neben dem Auslöser — ein Klick daneben änderte dann einen Status, den niemand gewählt hat.
 * Der Auslöser trägt den `StatusChip` (S-Code + Wort) als Etikett; der Ton kommt allein aus
 * der Kategorie, `status_farbe` ist ungeprüfter Freitext und bleibt ein Punkt im Menü.
 *
 * Der Deskriptor kommt von der Seite ({@link FmsTableauProps.bedienungVon}): Tabelle,
 * Karte und Tableau bedienen dieselbe Mutation mit demselben Riegel. Nur die Menüwerte
 * tauscht das Tableau gegen die FMS-Beschriftung („S4 · Am Einsatzort") — dieselben IDs.
 *
 * ── ZIFFERN ────────────────────────────────────────────────────────────────────────────
 *
 * Eine Ziffer wirkt auf die Kachel, IN DER der Fokus steht — per DOM-Vorfahr, nicht per
 * Komponentenbaum: ein Tastendruck im geöffneten Statusmenü steigt als Synthetic Event aus
 * dem Portal bis hierher auf, hat im DOM aber keine Kachel über sich und bleibt wirkungslos.
 * Der Listener hängt an der Tableau-Wurzel, nicht an `window` — ausserhalb des Tableaus ist
 * eine Ziffer eine Ziffer. `fms_anker` ist nullable und nicht eindeutig: nur ein eindeutig
 * belegter Anker setzt einen Status, sonst gibt es einen Hinweis und KEINEN Wechsel.
 *
 * ── ZUFLUSS ────────────────────────────────────────────────────────────────────────────
 *
 * Steht der Fokus im Tableau, friert die Menge der gezeigten Fahrzeuge ein; ein neu
 * disponiertes Fahrzeug wartet hinter dem Sammelbanner, statt die Kacheln unter dem Finger
 * zu verschieben (Kriterium 12, WCAG 3.2.5). Statuswechsel ändern die Menge nicht und die
 * Reihenfolge ohnehin nicht. Ein Wechsel ins Statusmenü ist KEIN Verlassen — dieselbe
 * Ausnahme wie in `Datensicht` (`pruefeVerlassen`, LFH-339). Entfernte Fahrzeuge fallen
 * sofort weg: was es nicht mehr gibt, lässt sich nicht zurückhalten.
 */

export interface FmsTableauProps {
  fahrzeuge: EinsatzFahrzeug[];
  katalog: FahrzeugStatus[];
  /** `null` = nicht abrufbar (Modul `einheiten` gesperrt) — dann ungegliedert. */
  einheiten: Einheit[] | null;
  /** Grund, warum ungegliedert gezeigt wird. */
  einheitenHinweis?: string;
  darfSchreiben: boolean;
  /** Derselbe Deskriptor wie in Tabelle und Karte — ein Bedienweg. */
  bedienungVon: (ef: EinsatzFahrzeug) => StatusBedienung;
  ladend?: boolean;
}

const KACHEL = 'fms-kachel';
const OVERLAY = '.ant-dropdown, .ant-select-dropdown, .ant-picker-dropdown';

function darstellungVon(ef: EinsatzFahrzeug): StatusDarstellung | null {
  if (!ef.status_label || !ef.status_kategorie) return null;
  return { ...statusKategorie[ef.status_kategorie], label: ef.status_label };
}

/** Kachelraster — rein und exportiert. `min(100%, …)` hält die Spalte am 390-px-Schirm. */
export function kachelRasterStil(token: { marginXS: number }): CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 208px), 1fr))',
    gap: token.marginXS,
  };
}

export default function FmsTableau({
  fahrzeuge,
  katalog,
  einheiten,
  einheitenHinweis,
  darfSchreiben,
  bedienungVon,
  ladend = false,
}: FmsTableauProps) {
  const { token, rollen } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const { message } = App.useApp();
  const wurzel = useRef<HTMLElement>(null);

  const katalogNach = useMemo(() => new Map(katalog.map((s) => [s.id, s])), [katalog]);
  const zuordnung = useMemo(() => zifferZuordnung(katalog), [katalog]);
  const optionen = useMemo(() => fmsStatusOptionen(katalog), [katalog]);
  const zifferBelegt = [...zuordnung.values()].some((z) => z.art === 'eindeutig');

  // ── Zuflussschleuse ─────────────────────────────────────────────────────────────────
  const [gefroren, setGefroren] = useState<ReadonlySet<number> | null>(null);
  const gezeigt = gefroren ? fahrzeuge.filter((f) => gefroren.has(f.id)) : fahrzeuge;
  const zufluessig = gefroren ? fahrzeuge.length - gezeigt.length : 0;
  const friereEin = useCallback(
    () => setGefroren(new Set(fahrzeuge.map((f) => f.id))),
    [fahrzeuge],
  );
  const betreten = () => {
    if (gefroren == null && fahrzeuge.length > 0) friereEin();
  };
  const verlassen = (e: FocusEvent<HTMLElement>) => {
    const ziel = e.relatedTarget;
    if (ziel instanceof Node && wurzel.current?.contains(ziel)) return;
    if (ziel instanceof Element && ziel.closest(OVERLAY)) return;
    setGefroren(null);
  };

  const gruppen = baueFmsTableau(gezeigt, einheiten);

  // ── Ziffern ─────────────────────────────────────────────────────────────────────────
  const tasteGedrueckt = (e: KeyboardEvent<HTMLElement>) => {
    if (!darfSchreiben) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!/^[0-9]$/.test(e.key)) return;
    const ziel = e.target;
    if (!(ziel instanceof Element)) return;
    if (ziel.closest('input, textarea, select, [contenteditable="true"]')) return;
    const kachel = ziel.closest<HTMLElement>(`[data-lfh="${KACHEL}"]`);
    if (!kachel || !wurzel.current?.contains(kachel)) return;
    const ef = fahrzeuge.find((f) => String(f.id) === kachel.dataset.efId);
    if (!ef) return;
    const bedienung = bedienungVon(ef);
    if (bedienung.gesperrt || bedienung.laeuft) return;

    e.preventDefault();
    const ziffer = Number(e.key);
    const zielStatus = zuordnung.get(ziffer);
    if (!zielStatus) {
      void message.info(`Ziffer ${ziffer} ist keinem Status zugeordnet`);
      return;
    }
    if (zielStatus.art === 'mehrdeutig') {
      void message.warning(
        `Ziffer ${ziffer} ist im Statuskatalog ${zielStatus.anzahl}-fach belegt — Status bitte über das Menü wählen`,
      );
      return;
    }
    if (zielStatus.status.id === ef.status_id) return;
    bedienung.onWaehlen(zielStatus.status.id);
  };

  const gedaempft: CSSProperties = { color: rollen.gedaempft, minWidth: 0 };
  const abgeschnitten: CSSProperties = {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };

  if (ladend && fahrzeuge.length === 0) return <Skeleton active />;

  return (
    <section
      ref={wurzel}
      aria-label="FMS-Tableau"
      data-lfh="fms-tableau"
      onKeyDown={tasteGedrueckt}
      onFocus={betreten}
      onBlur={verlassen}
      style={{ display: 'flex', flexDirection: 'column', gap: token.margin, minWidth: 0 }}
    >
      {(einheitenHinweis || (darfSchreiben && zifferBelegt)) && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            columnGap: token.margin,
            rowGap: token.marginXXS,
            fontSize: 12,
          }}
        >
          {darfSchreiben && zifferBelegt && (
            <span style={{ ...gedaempft, display: 'inline-flex', gap: token.marginXS }}>
              <Tastenkuerzel>0–9</Tastenkuerzel>
              <span>setzt den Status des gewählten Fahrzeugs (Ziffer = S-Code)</span>
            </span>
          )}
          {einheitenHinweis && <span style={gedaempft}>{einheitenHinweis}</span>}
        </div>
      )}

      {zufluessig > 0 && (
        <Sammelbanner aktion={{ label: 'anzeigen', onKlick: friereEin }}>
          {zufluessig === 1 ? '1 neues Fahrzeug' : `${zufluessig} neue Fahrzeuge`}
        </Sammelbanner>
      )}

      {gruppen.length === 0 && (
        <Typography.Text type="secondary">Noch keine Fahrzeuge disponiert</Typography.Text>
      )}

      {gruppen.map((g) => (
        <Paneel key={g.schluessel} titel={g.titel} meta={`${g.kacheln.length} Fzg.`} koerperPolster>
          <div style={kachelRasterStil(token)}>
            {g.kacheln.map(({ ef, einheit }) => {
              const bedienung = bedienungVon(ef);
              const status = fahrzeugStatus(ef, katalogNach);
              const seit = bedienung.laeuft
                ? '…'
                : ef.status_seit
                  ? formatUhrzeitMitTag(ef.status_seit, konventionen)
                  : '—';
              return (
                <div
                  key={ef.id}
                  data-lfh={KACHEL}
                  data-ef-id={ef.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: token.marginXXS,
                    minWidth: 0,
                    padding: token.paddingSM,
                    background: rollen.paneel,
                    border: `1px solid ${rollen.linie}`,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignSelf: 'stretch',
                      alignItems: 'baseline',
                      justifyContent: 'space-between',
                      gap: token.marginXS,
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{ ...monoStil(13), ...abgeschnitten, minWidth: 0 }}
                      title={ef.funkrufname}
                    >
                      {ef.funkrufname}
                    </span>
                    <span style={{ ...monoStil(11), ...gedaempft, flex: '0 0 auto' }}>
                      seit {seit}
                    </span>
                  </div>
                  <StatusWahl
                    {...bedienung}
                    optionen={optionen}
                    darstellung={darstellungVon(ef)}
                    etikett={<StatusChip ton={status.ton} code={status.code} wort={status.wort} />}
                    darfSchreiben={darfSchreiben}
                  />
                  {einheiten !== null && (
                    <span
                      style={{ fontSize: 12, ...gedaempft, ...abgeschnitten, maxWidth: '100%' }}
                    >
                      {einheit ?? OHNE_EINHEIT_TITEL}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </Paneel>
      ))}
    </section>
  );
}
