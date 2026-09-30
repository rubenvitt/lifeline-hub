import { IkoneMinus } from '../../ikonen';
import {
  memo,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { Collapse, Input, Space, Tooltip, Typography } from 'antd';
import { Select } from '../../components/Select';
import TaktischesZeichen, {
  einheiten,
  fachaufgaben,
  funktionen,
  grundzeichen as grundzeichenKatalog,
  organisationen,
  symbole,
} from 'taktische-zeichen-react';
import type { GrundzeichenId, SymbolId } from 'taktische-zeichen-react';
import type { FreiesZeichenUpdate } from '../../api/types';
import type { Farbrollen } from '../../theme/tokens';
import { useRollen } from '../../components/instrument';
import { grundzeichenAkzeptiert } from './taktischesZeichen';
import { baueFreiesZeichenTz } from './marker';
import { abonniereZuletztVerwendet, leseZuletztVerwendet } from './zuletztVerwendet';

export interface FreiesZeichenPickerProps {
  wert: FreiesZeichenUpdate;
  onChange: (spec: FreiesZeichenUpdate) => void;
  /**
   * Enter im Picker: auf einer Kachel, in einem Suchfeld und in der Bezeichnung. Ohne diesen
   * Callback (Inspector) sendet Enter nichts — das Platzieren gehört der Leiste.
   *
   * Der Callback bringt die Spec mit: die Bezeichnung wird erst beim Verlassen übernommen, und eine
   * per Enter gewählte Kachel steht in derselben Runde noch nicht im State des Aufrufers.
   */
  onAbsenden?: (spec: FreiesZeichenUpdate) => void;
  /**
   * Fokus beim Einhängen ins Grundzeichen-Suchfeld, Vorgabe an (wer die Leiste öffnet, will
   * tippen). Der Inspector setzt `false`: er hängt beim Marker-Klick ein und verschluckte sonst die
   * nächste Tastatureingabe auf der Karte.
   */
  autoFokus?: boolean;
}

/**
 * Die 5 accepts-gegateten Overlay-Felder. `key` ist zugleich der ComponentType fürs {@link
 * grundzeichenAkzeptiert}-Gating und der Feldname in FreiesZeichenUpdate.
 */
type OverlayKey = 'organisation' | 'fachaufgabe' | 'symbol' | 'einheit' | 'funktion';

interface KatalogEintrag {
  id: string;
  label: string;
}

/**
 * Die vier Overlays als Text-`Select` hinter „Details". `symbol` hat ein eigenes Bild-Raster (84
 * Einträge).
 */
const DETAIL_OVERLAYS: {
  key: Exclude<OverlayKey, 'symbol'>;
  label: string;
  katalog: readonly KatalogEintrag[];
}[] = [
  { key: 'organisation', label: 'Organisation', katalog: organisationen },
  { key: 'fachaufgabe', label: 'Fachaufgabe', katalog: fachaufgaben },
  { key: 'einheit', label: 'Einheit', katalog: einheiten },
  { key: 'funktion', label: 'Funktion', katalog: funktionen },
];

/** Reihenfolge, in der ein Zeichen benannt wird — vom Träger zum Beiwerk. */
const NAMENS_TEILE: { katalog: readonly KatalogEintrag[]; feld: keyof FreiesZeichenUpdate }[] = [
  { katalog: organisationen, feld: 'organisation' },
  { katalog: fachaufgaben, feld: 'fachaufgabe' },
  { katalog: symbole, feld: 'symbol' },
  { katalog: einheiten, feld: 'einheit' },
  { katalog: funktionen, feld: 'funktion' },
];

const NEUTRALE_FARBE = '#333333';

/** Kantenlänge der Zeichnung in einer Kachel. Ab 40 px bleibt die DV-102-Binnenzeichnung
 *  (Fachaufgabe im Grundzeichen) unterscheidbar. */
const KACHEL_BILD = 40;
const VORSCHAU_BILD = 56;

/** Kachel-Höhen, bis das Raster scrollt. Die Suche ist der eigentliche Weg zum Ziel. */
const RASTER_REIHEN = 4;

/** Mindestspaltenbreite: der längste Kachelname („Stelle, Einrichtung") bricht in zwei Zeilen
 *  um, statt die Leiste (300 px) auf zwei Spalten zu drücken. */
const SPALTE_MIN = 78;

/**
 * Trefflächen-Geometrie einer Katalog-Kachel — rein und exportiert. Boden ist die Dichte-Staffel
 * (`controlHeight`) in Höhe und Breite; Radius aus dem Token.
 */
export function kachelStil(token: {
  controlHeight: number;
  paddingXS: number;
  borderRadius: number;
  fontSizeSM: number;
}): CSSProperties {
  return {
    minHeight: token.controlHeight,
    minWidth: token.controlHeight,
    padding: token.paddingXS,
    borderRadius: token.borderRadius,
    // Der Kachelname erbt die Schriftgröße von hier — kein eigenes Pixelmaß am Text.
    fontSize: token.fontSizeSM,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    cursor: 'pointer',
    borderStyle: 'solid',
    borderWidth: 1,
  };
}

/**
 * Farben einer Kachel aus den Rollen des aktiven Modus — rein und exportiert. Gewählt und
 * hervorgehoben liegen auf `flaeche3`, nicht `flaeche2` (die am Tag auf `paneel` unsichtbar ist).
 * Die Wahl trägt zusätzlich den Bedienrand; der zweite Kanal ist `aria-checked`.
 */
export function kachelFarben(
  rollen: Farbrollen,
  gewaehlt: boolean,
  hervorgehoben = false,
): CSSProperties {
  return {
    // Ruhe-Rand ist `steuerRahmen`: `linie` ist dekorativ und hält WCAG 1.4.11 nicht.
    borderColor: gewaehlt ? rollen.bedien : rollen.steuerRahmen,
    background: gewaehlt || hervorgehoben ? rollen.flaeche3 : rollen.paneel,
    color: rollen.text,
  };
}

/**
 * Benennt ein Zeichen aus seinen Katalog-Bestandteilen — der zugängliche Name der „zuletzt
 * verwendet"-Kacheln. Rein.
 */
export function zeichenName(spec: FreiesZeichenUpdate): string {
  const roh = spec as unknown as Record<string, unknown>;
  const teile = [
    grundzeichenKatalog.find((g) => g.id === spec.grundzeichen)?.label ?? String(spec.grundzeichen),
  ];
  for (const { katalog, feld } of NAMENS_TEILE) {
    const wert = roh[feld];
    if (typeof wert !== 'string') continue;
    const label = katalog.find((k) => k.id === wert)?.label;
    if (label) teile.push(label);
  }
  return teile.join(' · ');
}

/**
 * Entfernt beim Grundzeichen-Wechsel alle Overlays, die das neue Grundzeichen nicht rendert — als
 * `null` (nicht `undefined`) für den Whole-Spec-PATCH, damit kein Phantom-Overlay den tz-Icon-Key
 * verändert.
 */
function strippeNichtAkzeptierte(spec: FreiesZeichenUpdate): FreiesZeichenUpdate {
  const gz = spec.grundzeichen;
  return {
    ...spec,
    organisation: grundzeichenAkzeptiert(gz, 'organisation') ? spec.organisation : null,
    fachaufgabe: grundzeichenAkzeptiert(gz, 'fachaufgabe') ? spec.fachaufgabe : null,
    symbol: grundzeichenAkzeptiert(gz, 'symbol') ? spec.symbol : null,
    einheit: grundzeichenAkzeptiert(gz, 'einheit') ? spec.einheit : null,
    funktion: grundzeichenAkzeptiert(gz, 'funktion') ? spec.funktion : null,
  };
}

function passt(eintrag: { id: string | null; label: string }, suche: string): boolean {
  const s = suche.trim().toLowerCase();
  if (!s) return true;
  return eintrag.label.toLowerCase().includes(s) || (eintrag.id ?? '').toLowerCase().includes(s);
}

/** `data-id` einer Kachel; `''` steht für „keins" (die Leer-Kachel des Symbol-Rasters). */
function idAus(el: HTMLElement | null): string | null | undefined {
  if (!el) return undefined;
  const roh = el.dataset.id;
  if (roh == null) return undefined;
  return roh === '' ? null : roh;
}

interface KachelProps {
  art: 'grundzeichen' | 'symbol';
  id: string | null;
  label: string;
  gewaehlt: boolean;
  tabbar: boolean;
  stil: CSSProperties;
}

/**
 * Eine Katalog-Kachel: Zeichnung und Name — ein Piktogramm allein ist keine Beschriftung, und die
 * Namen durchsucht die Suche. Die Grafik hängt in einer `aria-hidden`-Hülle.
 *
 * `memo` plus Klick-/Tasten-Delegation an der Gruppe: eine Pfeilfunktion je Kachel wechselte bei
 * jedem Anschlag die Identität. Das Stilobjekt kommt identitätsstabil vom Raster.
 */
const Kachel = memo(function Kachel(p: KachelProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={p.gewaehlt}
      tabIndex={p.tabbar ? 0 : -1}
      data-id={p.id ?? ''}
      style={p.stil}
    >
      <span aria-hidden style={{ display: 'flex', height: KACHEL_BILD, alignItems: 'center' }}>
        {p.id == null ? (
          <IkoneMinus style={{ fontSize: KACHEL_BILD / 2 }} />
        ) : (
          <TaktischesZeichen
            {...(p.art === 'grundzeichen'
              ? { grundzeichen: p.id as GrundzeichenId }
              : { grundzeichen: 'ohne' as GrundzeichenId, symbol: p.id as SymbolId })}
            style={{ width: KACHEL_BILD, height: KACHEL_BILD }}
          />
        )}
      </span>
      <span style={{ lineHeight: 1.15, textAlign: 'center', wordBreak: 'break-word' }}>
        {p.label}
      </span>
    </button>
  );
});

interface RasterProps {
  art: 'grundzeichen' | 'symbol';
  /** Zugleich der zugängliche Name der Radiogruppe. */
  gruppenName: string;
  suchName: string;
  autoFocus?: boolean;
  eintraege: { id: string | null; label: string }[];
  gewaehlt: string | null;
  onWaehle: (id: string | null) => void;
  /** Enter auf einer Kachel oder im Suchfeld: wählen UND absenden (D4). */
  onWaehleUndSende?: (id: string | null) => void;
}

const PFEILE: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * Suchfeld plus Kachel-Raster. Der Suchtext ist Bedienzustand und liegt hier, nicht in der Spec —
 * sonst liefe jeder Anschlag als Entwurfsänderung durch die Kartenseite.
 */
function Raster({
  art,
  gruppenName,
  suchName,
  autoFocus,
  eintraege,
  gewaehlt,
  onWaehle,
  onWaehleUndSende,
}: RasterProps) {
  const { token, rollen } = useRollen();
  const [suche, setSuche] = useState('');
  const [zeigerId, setZeigerId] = useState<string | null | undefined>(undefined);
  const begriff = suche.trim();
  // Die Leer-Kachel („keins") überlebt jeden Filter, zählt aber nicht als Treffer.
  const sichtbare = eintraege.filter((e) => e.id == null || passt(e, suche));
  const treffer = sichtbare.filter((e) => e.id != null);

  // Die Stilobjekte müssen über Renders identisch bleiben, sonst setzte ein frisches Objekt `memo`
  // außer Kraft. Drei Zustände, drei Objekte.
  const basis = useMemo(() => kachelStil(token), [token]);
  const stile = useMemo(
    () => ({
      gewaehlt: { ...basis, ...kachelFarben(rollen, true) },
      zeiger: { ...basis, ...kachelFarben(rollen, false, true) },
      ruhe: { ...basis, ...kachelFarben(rollen, false) },
    }),
    [basis, rollen],
  );

  // Rollender Tabstopp: die Gruppe ist ein Tabstopp. Ist die Auswahl weggefiltert, übernimmt die
  // erste sichtbare Kachel.
  const tabbarId = sichtbare.some((e) => e.id === gewaehlt) ? gewaehlt : (sichtbare[0]?.id ?? null);

  const kachelVon = (ziel: EventTarget) =>
    (ziel as HTMLElement).closest<HTMLElement>('[role="radio"]');

  const aufKlick = (e: MouseEvent<HTMLDivElement>) => {
    const id = idAus(kachelVon(e.target));
    if (id !== undefined) onWaehle(id);
  };

  const aufZeiger = (e: MouseEvent<HTMLDivElement>) => {
    const id = idAus(kachelVon(e.target));
    setZeigerId((alt) => (alt === id ? alt : id));
  };

  const aufTaste = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter') {
      const id = idAus(kachelVon(e.target));
      if (id === undefined) return;
      // Ohne `preventDefault` löste der Browser auf dem `<button>` zusätzlich einen Klick aus.
      e.preventDefault();
      if (onWaehleUndSende) onWaehleUndSende(id);
      else onWaehle(id);
      return;
    }
    const schritt = PFEILE[e.key];
    if (schritt == null) return;
    const kacheln = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'));
    if (kacheln.length === 0) return;
    const jetzt = kacheln.indexOf(document.activeElement as HTMLElement);
    const ziel = kacheln[((jetzt < 0 ? 0 : jetzt) + schritt + kacheln.length) % kacheln.length];
    e.preventDefault();
    ziel.focus();
    const id = idAus(ziel);
    if (id !== undefined) onWaehle(id);
  };

  /** Enter im Suchfeld (D4): ohne Begriff gilt die Auswahl; mit Begriff die Auswahl, wenn sie
   *  unter den Treffern steht, sonst der erste echte Treffer; ohne Treffer nichts. */
  const aufSuchEnter = () => {
    if (!onWaehleUndSende) return;
    if (begriff === '') {
      onWaehleUndSende(gewaehlt);
      return;
    }
    if (treffer.length === 0) return;
    onWaehleUndSende(treffer.some((e) => e.id === gewaehlt) ? gewaehlt : treffer[0].id);
  };

  return (
    <div style={{ width: '100%' }}>
      <Input
        aria-label={suchName}
        placeholder={suchName}
        allowClear
        autoFocus={autoFocus}
        value={suche}
        onChange={(e) => setSuche(e.target.value)}
        onPressEnter={aufSuchEnter}
        style={{ marginBottom: token.marginXXS }}
      />
      <div
        role="radiogroup"
        aria-label={gruppenName}
        onClick={aufKlick}
        onKeyDown={aufTaste}
        onMouseOver={aufZeiger}
        onMouseLeave={() => setZeigerId(undefined)}
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fill, minmax(max(${SPALTE_MIN}px, ${
            token.controlHeight + 2 * token.paddingXS
          }px), 1fr))`,
          gap: token.marginXXS,
          maxHeight: (KACHEL_BILD + token.controlHeight) * RASTER_REIHEN,
          overflowY: 'auto',
        }}
      >
        {sichtbare.map((e) => (
          <Kachel
            key={e.id ?? ''}
            art={art}
            id={e.id}
            label={e.label}
            gewaehlt={e.id === gewaehlt}
            tabbar={e.id === tabbarId}
            stil={
              e.id === gewaehlt ? stile.gewaehlt : e.id === zeigerId ? stile.zeiger : stile.ruhe
            }
          />
        ))}
      </div>
      {treffer.length === 0 && begriff !== '' && (
        <Typography.Text type="secondary">Kein Treffer</Typography.Text>
      )}
    </div>
  );
}

/**
 * Controlled Editor für die DV-102-Spec eines freien taktischen Zeichens: Bild-Raster mit Suche,
 * „zuletzt verwendet" und Enter-Weg. Kein `<Form>`: das Absenden gehört der Leiste.
 */
export default function FreiesZeichenPicker({
  wert,
  onChange,
  onAbsenden,
  autoFokus = true,
}: FreiesZeichenPickerProps) {
  const { token, rollen } = useRollen();
  const [zuletzt, setZuletzt] = useState(leseZuletztVerwendet);

  // Geschrieben wird an der Platzier-Stelle (`useKartenInteraktion`); ohne das Signal zeigte ein
  // montierter Picker den Stand vom Einhängen.
  useEffect(() => abonniereZuletztVerwendet(() => setZuletzt(leseZuletztVerwendet())), []);

  const mitGrundzeichen = (gz: string): FreiesZeichenUpdate =>
    strippeNichtAkzeptierte({ ...wert, grundzeichen: gz as GrundzeichenId });
  const mitOverlay = (key: OverlayKey, v: string | null): FreiesZeichenUpdate =>
    ({ ...wert, [key]: v }) as FreiesZeichenUpdate;

  /**
   * Übernimmt eine Spec und sendet sie — dieselbe frische Spec an beide, weil der Aufrufer seinen
   * State in dieser Runde noch nicht hat.
   */
  const uebernimmUndSende = (spec: FreiesZeichenUpdate) => {
    if (!onAbsenden) return;
    onChange(spec);
    onAbsenden(spec);
  };

  /**
   * Ein Griff in die Leiste tauscht das Zeichen, nicht die Platzierung: Name und Ansichts-Bindung
   * bleiben. Felder einzeln gesetzt, damit kein Overlay des alten Entwurfs überlebt.
   */
  const uebernimm = (z: FreiesZeichenUpdate) =>
    onChange(
      strippeNichtAkzeptierte({
        ...wert,
        grundzeichen: z.grundzeichen,
        organisation: z.organisation ?? null,
        fachaufgabe: z.fachaufgabe ?? null,
        symbol: z.symbol ?? null,
        einheit: z.einheit ?? null,
        funktion: z.funktion ?? null,
        farbe: z.farbe ?? null,
      }),
    );

  const mitLabel = (roh: string): FreiesZeichenUpdate => ({ ...wert, label: roh.trim() || null });

  /**
   * Die Bezeichnung ist kontrolliert, mit eigenem Tipp-Merker: das Feld folgt `wert.label`, solange
   * nicht getippt wird, und übernommen wird nur Getipptes — ein `defaultValue` zeigte nach einer
   * fremden Änderung den alten Namen und schriebe ihn beim Verlassen zurück. Kein
   * `key={wert.label}`: der Remount verwürfe gerade Getipptes.
   *
   * Übernommen wird erst beim Verlassen, nicht je Anschlag.
   */
  const [bezeichnung, setBezeichnung] = useState(wert.label ?? '');
  const [bezeichnungGetippt, setBezeichnungGetippt] = useState(false);
  if (!bezeichnungGetippt && bezeichnung !== (wert.label ?? '')) setBezeichnung(wert.label ?? '');
  const bezeichnungUebernehmen = (): FreiesZeichenUpdate | null => {
    setBezeichnungGetippt(false);
    const spec = mitLabel(bezeichnung);
    return spec.label !== (wert.label ?? null) ? spec : null;
  };

  const vorschau = baueFreiesZeichenTz(wert);
  const zeigtSymbol = grundzeichenAkzeptiert(wert.grundzeichen, 'symbol');
  const leistenKnopf = { ...kachelStil(token), ...kachelFarben(rollen, false) };

  return (
    <Space orientation="vertical" style={{ width: '100%' }} data-lfh="zeichen-picker">
      <div style={{ display: 'flex', justifyContent: 'center' }} aria-label="Vorschau">
        <span aria-hidden style={{ display: 'flex' }}>
          <TaktischesZeichen
            {...vorschau}
            style={{ width: VORSCHAU_BILD, height: VORSCHAU_BILD }}
          />
        </span>
      </div>

      {zuletzt.length > 0 && (
        <div
          role="group"
          aria-label="Zuletzt verwendet"
          style={{ display: 'flex', flexWrap: 'wrap', gap: token.marginXXS }}
        >
          {zuletzt.map((z) => {
            const name = zeichenName(z);
            /* Nicht der Name als React-Key: zwei Einträge dürfen sich nur in der Farbe
               unterscheiden. */
            const key = [
              z.grundzeichen,
              z.organisation,
              z.fachaufgabe,
              z.symbol,
              z.einheit,
              z.funktion,
              z.farbe,
            ].join('|');
            return (
              /* Name als `aria-label` samt Tooltip: sechs ausgeschriebene DV-102-Namen sprengten
                 die Leiste. */
              <Tooltip key={key} title={name}>
                <button
                  type="button"
                  aria-label={name}
                  onClick={() => uebernimm(z)}
                  style={leistenKnopf}
                >
                  <span aria-hidden style={{ display: 'flex' }}>
                    <TaktischesZeichen
                      {...baueFreiesZeichenTz(z)}
                      style={{ width: KACHEL_BILD, height: KACHEL_BILD }}
                    />
                  </span>
                </button>
              </Tooltip>
            );
          })}
        </div>
      )}

      <Raster
        art="grundzeichen"
        gruppenName="Grundzeichen"
        suchName="Grundzeichen suchen"
        autoFocus={autoFokus}
        eintraege={grundzeichenKatalog.map((g) => ({ id: g.id as string, label: g.label }))}
        gewaehlt={wert.grundzeichen}
        onWaehle={(gz) => {
          if (gz != null) onChange(mitGrundzeichen(gz));
        }}
        onWaehleUndSende={
          onAbsenden
            ? (gz) => {
                if (gz != null) uebernimmUndSende(mitGrundzeichen(gz));
              }
            : undefined
        }
      />

      {zeigtSymbol && (
        <Raster
          art="symbol"
          gruppenName="Symbol"
          suchName="Symbol suchen"
          eintraege={[
            { id: null, label: 'Kein Symbol' },
            ...symbole.map((s) => ({ id: s.id as string, label: s.label })),
          ]}
          gewaehlt={wert.symbol ?? null}
          onWaehle={(id) => onChange(mitOverlay('symbol', id))}
          onWaehleUndSende={
            onAbsenden ? (id) => uebernimmUndSende(mitOverlay('symbol', id)) : undefined
          }
        />
      )}

      <Collapse
        ghost
        items={[
          {
            key: 'details',
            label: 'Details',
            // Ohne `forceRender` stünden die Felder erst beim Aufklappen im Baum — die Zählung
            // „offen liegen nur zwei" wäre trivial.
            forceRender: true,
            children: (
              <div data-lfh="zeichen-details">
                <Space orientation="vertical" style={{ width: '100%' }}>
                  {DETAIL_OVERLAYS.map(({ key, label, katalog }) =>
                    grundzeichenAkzeptiert(wert.grundzeichen, key) ? (
                      <Select
                        key={key}
                        aria-label={label}
                        allowClear
                        placeholder={label}
                        style={{ width: '100%' }}
                        value={(wert[key] as string | null | undefined) ?? undefined}
                        options={katalog.map((k) => ({ value: k.id, label: k.label }))}
                        onChange={(v?: string) => onChange(mitOverlay(key, v ?? null))}
                      />
                    ) : null,
                  )}

                  {/* `key` am unkontrollierten Farbfeld: ein Griff in „zuletzt verwendet" bringt
                      eine fremde Farbe mit. */}
                  <Input
                    key={`farbe-${wert.farbe ?? ''}`}
                    aria-label="Farbe"
                    type="color"
                    defaultValue={wert.farbe ?? NEUTRALE_FARBE}
                    onBlur={(e) => {
                      if (e.target.value !== (wert.farbe ?? NEUTRALE_FARBE)) {
                        onChange({ ...wert, farbe: e.target.value });
                      }
                    }}
                  />

                  <Input
                    aria-label="Bezeichnung"
                    placeholder="Bezeichnung"
                    value={bezeichnung}
                    onChange={(e) => {
                      setBezeichnung(e.target.value);
                      setBezeichnungGetippt(true);
                    }}
                    onBlur={() => {
                      if (!bezeichnungGetippt) return;
                      const spec = bezeichnungUebernehmen();
                      if (spec) onChange(spec);
                    }}
                    onPressEnter={() => {
                      const geaendert = bezeichnungUebernehmen();
                      // Mit `onAbsenden` (Leiste) platziert Enter; ohne (Inspector) übernimmt es
                      // nur den getippten Namen.
                      if (onAbsenden) uebernimmUndSende(geaendert ?? wert);
                      else if (geaendert) onChange(geaendert);
                    }}
                  />
                </Space>
              </div>
            ),
          },
        ]}
      />
    </Space>
  );
}
