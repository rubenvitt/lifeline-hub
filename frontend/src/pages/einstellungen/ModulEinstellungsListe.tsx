import { Input, Switch, Tooltip, Typography, theme } from 'antd';
import { useId, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import SektionHeader from '../../components/SektionHeader';
import { Select } from '../../components/Select';
import { useViewport } from '../../components/useViewport';
import {
  kategorien,
  moduleNachKategorie,
  istModulAusblendbar,
  type ModulEintrag,
} from '../../einsatz/modulRegistry';
import { ROLLEN_OPTIONEN } from './optionen';

/**
 * Trefflächenboden der Beschriftungszeile — rein und exportiert, damit die Zusicherung ohne Render
 * prüfbar ist. Zwei Angaben: `minHeight` aus `controlHeight` plus Polsterung (die allein käme im
 * Handschuh-Betrieb auf grob 54 statt 72 px). Aufgelöste Tokens, nie `var(--lfh-*)`. Bewusst lokal
 * statt aus `Anmeldeverfahren.tsx` importiert.
 */
export function modulZeilenStil(token: {
  controlHeight: number;
  paddingSM: number;
  padding: number;
}): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    minHeight: token.controlHeight,
    padding: `${token.paddingSM}px ${token.padding}px`,
  };
}

/** Warum eine Zeile gesperrt ist — je Zeile genau EINER, auch wenn mehrere Quellen greifen. */
export type ModulSperrGrund = 'modul' | 'rechte' | 'laeuft';

/**
 * Die drei Sperrquellen einer Zeile, getrennt statt in einem `disabled`-Ausdruck. Rein und
 * exportiert. Vorrang: Modul vor Recht vor Schreibvorgang — die Modul-Eigenschaft gilt auch für
 * Verwaltende und ist die genauere Aussage; der Schreibvorgang ist vorübergehend.
 */
export function modulSperrGrund(zeile: {
  ausblendbar: boolean;
  darfVerwalten: boolean;
  laeuft: boolean;
}): ModulSperrGrund | null {
  if (!zeile.ausblendbar) return 'modul';
  if (!zeile.darfVerwalten) return 'rechte';
  if (zeile.laeuft) return 'laeuft';
  return null;
}

/** Wortlaut eines Sperrgrunds: Kurzwort sichtbar, Begründung im Tooltip darüber. */
export interface SperrWortlaut {
  kurz: string;
  lang: string;
}

const MODUL_GRUND: SperrWortlaut = {
  // Der Kurztext ist in den Tests wörtlich gepinnt.
  kurz: 'immer sichtbar, nicht ausblendbar',
  lang: 'Selbst-Aussperr-Schutz: Einsatzdaten und Einstellungen lassen sich weder ausblenden noch auf eine Rolle beschränken — sonst käme niemand mehr an diese Einstellungen zurück.',
};

/**
 * Rückfall ohne Wortlaut vom Aufrufer — ein Wort, das in jedem Fall stimmt: auf Einsatz-Ebene
 * sperrt auch ein abgeschlossener Einsatz, „nur Verwaltung" widerspräche dort dem Seitenbanner.
 */
const RECHTE_GRUND_RUECKFALL: SperrWortlaut = {
  kurz: 'nur lesen',
  lang: 'Diese Werte lassen sich hier nicht ändern — sie stehen zum Nachlesen da.',
};

interface SichtbarSpalte {
  /** Spaltenüberschrift, z. B. „Sichtbar". */
  titel: string;
  sichtbarVon: (modulKey: string) => boolean;
  aufSichtbar: (modulKey: string, sichtbar: boolean) => void;
}

interface ModulEinstellungsListeProps {
  /** Überschrift der Rollen-Spalte („Benötigte Rolle" bzw. „… (Default)"). */
  rollenSpalte: string;
  /** Aktuelle Rolle des Moduls; '' = frei. */
  rolleVon: (modulKey: string) => string;
  aufRolle: (modulKey: string, rolle: string) => void;
  /** Fehlt sie, hat die Liste zwei Spalten und keinen Schalter (Org-Ebene). */
  sichtbarSpalte?: SichtbarSpalte;
  /** Darf der Benutzer hier überhaupt etwas ändern? */
  darfVerwalten: boolean;
  /**
   * Warum `darfVerwalten` fehlt — vom Aufrufer, weil nur er die Ursache kennt (Rolle oder
   * abgeschlossener Einsatz). Fehlt es, steht „nur lesen".
   */
  rechteGrund?: SperrWortlaut;
  /** Modul-Key der gerade mutierenden Zeile; nur diese ist gesperrt. */
  laeuftKey?: string | null;
  /** Modul-Key der zuletzt fehlgeschlagenen Zeile; nur diese wird markiert. */
  fehlerKey?: string | null;
  /** Gedämpfter Zusatz unter dem Select, z. B. der geerbte Org-Default. */
  hinweisVon?: (modulKey: string) => ReactNode;
}

/**
 * Modul-Zeilenliste der Einstellungsseiten, für Einsatz-Ebene (drei Spalten mit Sichtbar-Schalter)
 * und Org-Ebene (zwei Spalten).
 *
 * Callbacks statt einer Mutation als Prop: die Payloads unterscheiden sich fachlich, und der
 * Aufrufer kennt seinen Endpunkt. `istModulAusblendbar` wird hier ausgewertet: das ist eine
 * Eigenschaft des Moduls, keine Berechtigungsfrage, und gilt auch für Verwaltende.
 *
 * Raster `minmax(0, 1fr) auto auto` statt fester Breiten; der Rollen-Select nimmt die volle
 * Spaltenbreite (eine feste Mindestbreite drängte ihn aus der schmalen Karte). Unter `md`
 * gestapelt, und die Spaltenköpfe fallen dann ganz weg. Die Köpfe stehen einmal über allen Blöcken,
 * weil das Raster über alle Gruppen dasselbe ist.
 *
 * `laeuftKey` sperrt nur die schreibende Zeile. Der fehlgeschlagene Wert springt von selbst zurück
 * (kein optimistisches Update); `fehlerKey` markiert die Zeile am linken Rand.
 *
 * Gruppierung und Reihenfolge aus `kategorien` (`einsatz/modulRegistry.ts`), dieselbe Quelle wie
 * die Icon-Rail. Das Filterfeld trägt ein echtes `<label htmlFor>`; eine Kategorie ohne Treffer
 * fällt ganz weg, und trifft der Filter nirgends, sagt die Liste das.
 *
 * Sperrgründe je Zeile (`modulSperrGrund`): Modul-Eigenschaft und fehlendes Recht tragen ein
 * gedämpftes Kurzwort, die Begründung steht im Tooltip darüber (Tablet: kein Hover). Das Kurzwort
 * steht auch dann, wenn der `RechteHinweis` dasselbe sagt — ein grauer Schalter ohne Wort ist eine
 * Ein-Kanal-Aussage. Der Schreibvorgang zeigt sich nur als `loading` am Steuerelement; das
 * `aria-label` des Schalters schlägt die Lade-Ikone.
 */
export default function ModulEinstellungsListe({
  rollenSpalte,
  rolleVon,
  aufRolle,
  sichtbarSpalte,
  darfVerwalten,
  rechteGrund = RECHTE_GRUND_RUECKFALL,
  laeuftKey,
  fehlerKey,
  hinweisVon,
}: ModulEinstellungsListeProps) {
  const { token } = theme.useToken();
  const { istSchmal } = useViewport();
  const [filter, setFilter] = useState('');
  // `useId`: zwei Instanzen auf einer Seite trügen sonst dieselbe `id`.
  const filterId = useId();

  const suchtext = filter.trim().toLowerCase();
  const gruppen = kategorien
    .map((kategorie) => ({
      kategorie,
      module: moduleNachKategorie(kategorie.key).filter(
        (m) => !suchtext || m.label.toLowerCase().includes(suchtext),
      ),
    }))
    .filter((g) => g.module.length > 0);

  // `minmax(0, 1fr)` statt `1fr`, damit ein langes Label die Nachbarspalten nicht aus dem Container
  // schiebt.
  const raster: CSSProperties = istSchmal
    ? { display: 'grid', gridTemplateColumns: '1fr', gap: token.marginXXS }
    : {
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto auto',
        alignItems: 'center',
        gap: token.margin,
      };

  function zeile(m: ModulEintrag) {
    const ausblendbar = istModulAusblendbar(m.key);
    const laeuft = laeuftKey === m.key;
    const sperrGrund = modulSperrGrund({ ausblendbar, darfVerwalten, laeuft });
    const gesperrt = sperrGrund !== null;
    // Nur die zwei dauerhaften Gründe tragen einen Text; der Schreibvorgang zeigt sich als
    // `loading`.
    const wortlaut =
      sperrGrund === 'modul' ? MODUL_GRUND : sperrGrund === 'rechte' ? rechteGrund : null;
    const hinweis = hinweisVon?.(m.key);
    const hatFehler = fehlerKey === m.key;
    const feldId = `modul-sichtbar-${m.key}`;
    // Ein `<label htmlFor>` nur an der bedienbaren Zeile (Klick auf `disabled` leitet der Browser
    // nicht weiter). Das `aria-label` am Switch schlägt das Label, die Namen ändern sich nicht.
    const bedienbar = Boolean(sichtbarSpalte) && !gesperrt;
    const beschriftungStil: CSSProperties = {
      ...modulZeilenStil(token),
      minWidth: 0,
      gap: token.marginXS,
      flexWrap: 'wrap',
    };
    // Der Modulname steht in einem eigenen Element: sonst fände eine Abfrage auf den Namen die
    // Zeile nicht mehr (`textContent` der Hülle wäre „Einsatzdatenimmer sichtbar …").
    const beschriftung = (
      <>
        <span>{m.label}</span>
        {wortlaut && (
          // Kurzwort sichtbar, Begründung im Tooltip — an einem nicht gesperrten Element, also ohne
          // Wrapper.
          <Tooltip title={wortlaut.lang}>
            <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
              {wortlaut.kurz}
            </Typography.Text>
          </Tooltip>
        )}
      </>
    );
    return (
      <div
        key={m.key}
        data-modul-zeile={m.key}
        data-fehler={hatFehler ? 'true' : undefined}
        style={{
          ...raster,
          borderInlineStart: hatFehler ? `3px solid ${token.colorError}` : undefined,
        }}
      >
        {bedienbar ? (
          <label htmlFor={feldId} style={{ ...beschriftungStil, cursor: 'pointer' }}>
            {beschriftung}
          </label>
        ) : (
          <span style={beschriftungStil}>{beschriftung}</span>
        )}
        {sichtbarSpalte && (
          <div style={{ textAlign: istSchmal ? 'start' : 'center' }}>
            <Switch
              id={feldId}
              aria-label={`Sichtbar: ${m.label}`}
              checked={ausblendbar ? sichtbarSpalte.sichtbarVon(m.key) : true}
              disabled={gesperrt}
              loading={laeuft}
              onChange={(checked) => sichtbarSpalte.aufSichtbar(m.key, checked)}
            />
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <Select
            aria-label={`Benötigte Rolle: ${m.label}`}
            style={{ width: '100%' }}
            value={rolleVon(m.key)}
            disabled={gesperrt}
            loading={laeuft}
            options={ROLLEN_OPTIONEN}
            onChange={(val) => aufRolle(m.key, val)}
          />
          {hinweis && (
            <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
              {hinweis}
            </Typography.Text>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: token.margin }}>
      <div style={{ maxWidth: 260 }}>
        <label htmlFor={filterId} style={{ display: 'block', marginBottom: token.marginXXS }}>
          Modul filtern
        </label>
        <Input
          id={filterId}
          allowClear
          placeholder="Modulname"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {gruppen.length === 0 ? (
        <Typography.Text type="secondary">Kein Modul passt zum Filter.</Typography.Text>
      ) : (
        <>
          {!istSchmal && (
            <div style={{ ...raster, fontSize: token.fontSizeSM, opacity: 0.6 }}>
              <span>Modul</span>
              {sichtbarSpalte && (
                <span style={{ textAlign: 'center' }}>{sichtbarSpalte.titel}</span>
              )}
              <span>{rollenSpalte}</span>
            </div>
          )}
          {gruppen.map((g) => (
            <div key={g.kategorie.key}>
              <SektionHeader titel={g.kategorie.label} ueberschrift="h3" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginXXS }}>
                {g.module.map(zeile)}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
