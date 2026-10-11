import { IconMinus } from '../../icons';
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
import { serializeAnySpec } from '@einsatzzeichen/core';
import type { AnySpec, Drawing, SymbolKind, SymbolSpec } from '@einsatzzeichen/schema';
import { Select } from '../../components/Select';
import type { FreiesZeichenUpdate } from '../../api/types';
import type { Farbrollen } from '../../theme/tokens';
import { useRollen } from '../../components/instrument';
import { ZeichenBild } from '../../zeichen/EinsatzZeichen';
import { freiesZeichen } from '../../zeichen/freiesZeichen';
import { abonniereZuletztVerwendet, leseZuletztVerwendet } from './zuletztVerwendet';
import {
  detailOptionen,
  detailVon,
  grundzeichenOptionen,
  grundzeichenVon,
  KEINE_DETAILS,
  leseEntwurf,
  mitDetail,
  mitGrundzeichen,
  mitSymbol,
  symbolOptionen,
  symbolVon,
  zeichenName,
  type DetailAchse,
} from './zeichenWahl';

export interface FreiesZeichenPickerProps {
  /** Der Entwurf: das Zeichen als `zeichen_spec` (`serializeAnySpec`), dazu die Bezeichnung. */
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

/** Die Auswahlen unter „Details“ in ihrer Reihenfolge — vom Träger zum Beiwerk. */
const DETAIL_ACHSEN: { achse: Exclude<DetailAchse, 'farbe'>; label: string }[] = [
  { achse: 'organisation', label: 'Organisation' },
  { achse: 'fachaufgabe', label: 'Fachaufgabe' },
  { achse: 'einheit', label: 'Einheit' },
];

/** Kantenlänge der Zeichnung in einer Kachel. Ab 40 px bleibt die DV-102-Binnenzeichnung
 *  (Fachaufgabe im Grundzeichen) unterscheidbar. */
const KACHEL_BILD = 40;
const VORSCHAU_BILD = 56;

/** Kachel-Höhen, bis das Raster scrollt. Die Suche ist der eigentliche Weg zum Ziel. */
const RASTER_REIHEN = 4;

/** Mindestspaltenbreite: lange Kachelnamen brechen in zwei Zeilen um, statt die Leiste (300 px)
 *  auf zwei Spalten zu drücken. */
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

interface RasterEintrag {
  /** `null` ist die Leer-Kachel („Kein Grundzeichen“, „Kein Symbol“). */
  id: string | null;
  label: string;
  /** Weitere Suchbegriffe neben Name und Kennung. */
  suche?: string;
  drawing?: Drawing | null;
}

function passt(eintrag: RasterEintrag, suche: string): boolean {
  const s = suche.trim().toLowerCase();
  if (!s) return true;
  return [eintrag.label, eintrag.id ?? '', eintrag.suche ?? ''].some((t) =>
    t.toLowerCase().includes(s),
  );
}

/** `data-id` einer Kachel; `''` steht für „keins" (die Leer-Kachel eines Rasters). */
function idAus(el: HTMLElement | null): string | null | undefined {
  if (!el) return undefined;
  const roh = el.dataset.id;
  if (roh == null) return undefined;
  return roh === '' ? null : roh;
}

interface KachelProps {
  id: string | null;
  label: string;
  drawing: Drawing | null | undefined;
  gewaehlt: boolean;
  tabbar: boolean;
  stil: CSSProperties;
}

/**
 * Eine Katalog-Kachel: Zeichnung und Name — ein Piktogramm allein ist keine Beschriftung, und die
 * Namen durchsucht die Suche. Die Grafik hängt in einer `aria-hidden`-Hülle und trägt ihren eigenen
 * `idPrefix` (`ZeichenBild`), sonst kollidierten die SVG-ids der Kacheln.
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
          <IconMinus style={{ fontSize: KACHEL_BILD / 2 }} />
        ) : p.drawing ? (
          <ZeichenBild drawing={p.drawing} size={KACHEL_BILD} />
        ) : null}
      </span>
      <span style={{ lineHeight: 1.15, textAlign: 'center', wordBreak: 'break-word' }}>
        {p.label}
      </span>
    </button>
  );
});

interface RasterProps {
  /** Zugleich der zugängliche Name der Radiogruppe. */
  gruppenName: string;
  suchName: string;
  autoFocus?: boolean;
  eintraege: readonly RasterEintrag[];
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
            id={e.id}
            label={e.label}
            drawing={e.drawing}
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

/** Die Palettenfarbe als Feld neben ihrem Namen; die Farbe ist zweiter Kanal, der Name der erste. */
function Farbfeld({ farbe, rand }: { farbe: string; rand: string }) {
  return (
    <span
      aria-hidden
      data-lfh="farbfeld"
      data-farbe={farbe}
      style={{
        display: 'inline-block',
        width: '1em',
        height: '1em',
        marginInlineEnd: '0.5em',
        verticalAlign: '-0.15em',
        background: farbe,
        border: `1px solid ${rand}`,
      }}
    />
  );
}

/**
 * Controlled Editor eines freien taktischen Zeichens aus dem Vokabular von @einsatzzeichen (LFH-836,
 * design.md D7): Bild-Raster mit Suche, „zuletzt verwendet" und Enter-Weg. Kein `<Form>`: das
 * Absenden gehört der Leiste.
 *
 * „Kein Grundzeichen“ ohne gewähltes Symbol ist noch kein Zeichen: der Picker merkt sich die Wahl
 * selbst und meldet erst das gewählte freistehende Symbol. Bis dahin steht der Entwurf des
 * Aufrufers unverändert (Vorschau und Platzieren zeigen, was gilt).
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

  const entwurf = useMemo(() => leseEntwurf(wert.zeichen_spec), [wert.zeichen_spec]);

  /** „Kein Grundzeichen“ gewählt, aber noch kein Symbol — gilt nur für den Entwurf, an dem es geschah. */
  const [ohneFuer, setOhneFuer] = useState<string | null>(null);
  const grundzeichen: SymbolKind | null =
    ohneFuer === wert.zeichen_spec ? null : grundzeichenVon(entwurf);
  const koerper = grundzeichen ? (entwurf as SymbolSpec) : null;

  // Das Vokabular zeichnet jeden Kandidaten probeweise (D7): Optionen je Entwurfsstand gemerkt.
  const gzEintraege = useMemo<RasterEintrag[]>(
    () => [{ id: null, label: 'Kein Grundzeichen' }, ...grundzeichenOptionen()],
    [],
  );
  const symbolEintraege = useMemo<RasterEintrag[]>(
    () =>
      koerper
        ? [{ id: null, label: 'Kein Symbol' }, ...symbolOptionen(koerper)]
        : symbolOptionen(null),
    [koerper],
  );
  // Ohne Grundzeichen (auch „Kein Grundzeichen“ vor der Symbolwahl) nur die Bezeichnung.
  const details = useMemo(() => (koerper ? detailOptionen(koerper) : KEINE_DETAILS), [koerper]);
  const vorschau = useMemo(
    () => freiesZeichen({ zeichen_spec: wert.zeichen_spec }).drawing,
    [wert.zeichen_spec],
  );

  const mitSpec = (spec: AnySpec): FreiesZeichenUpdate => ({
    ...wert,
    zeichen_spec: serializeAnySpec(spec),
  });
  const melde = (spec: FreiesZeichenUpdate) => {
    setOhneFuer(null);
    onChange(spec);
  };

  /**
   * Übernimmt eine Spec und sendet sie — dieselbe frische Spec an beide, weil der Aufrufer seinen
   * State in dieser Runde noch nicht hat.
   */
  const uebernimmUndSende = (spec: FreiesZeichenUpdate) => {
    if (!onAbsenden) return;
    melde(spec);
    onAbsenden(spec);
  };

  /** Der Entwurf nach einer Grundzeichen-Kachel; `null` heißt „Kein Grundzeichen“ (noch kein Zeichen). */
  const nachGrundzeichen = (id: string | null): FreiesZeichenUpdate | null => {
    if (id == null) return null;
    return mitSpec(mitGrundzeichen(entwurf, id as SymbolKind));
  };
  const waehleGrundzeichen = (id: string | null) => {
    const neu = nachGrundzeichen(id);
    if (neu) melde(neu);
    else if (grundzeichenVon(entwurf) !== null) setOhneFuer(wert.zeichen_spec);
  };

  const nachSymbol = (id: string | null): FreiesZeichenUpdate | null => {
    const spec = mitSymbol(koerper ?? nullWennKoerper(entwurf), id);
    return spec ? mitSpec(spec) : null;
  };

  /**
   * Ein Griff in die Leiste tauscht das Zeichen, nicht die Platzierung: Name und Ansichts-Bindung
   * bleiben.
   */
  const uebernimm = (zeichenSpec: string) => melde({ ...wert, zeichen_spec: zeichenSpec });

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

  const leistenKnopf = { ...kachelStil(token), ...kachelFarben(rollen, false) };
  const farbOptionen = details.farbe;

  return (
    <Space orientation="vertical" style={{ width: '100%' }} data-lfh="zeichen-picker">
      <div style={{ display: 'flex', justifyContent: 'center' }} aria-label="Vorschau">
        <span aria-hidden style={{ display: 'flex' }}>
          <ZeichenBild drawing={vorschau} size={VORSCHAU_BILD} />
        </span>
      </div>

      {zuletzt.length > 0 && (
        <div
          role="group"
          aria-label="Zuletzt verwendet"
          style={{ display: 'flex', flexWrap: 'wrap', gap: token.marginXXS }}
        >
          {zuletzt.map((z) => {
            const name = zeichenName(leseEntwurf(z));
            return (
              /* Name als `aria-label` samt Tooltip: sechs ausgeschriebene DV-102-Namen sprengten
                 die Leiste. Die kanonische Spec ist der Schlüssel (die Leiste ist entdoppelt). */
              <Tooltip key={z} title={name}>
                <button
                  type="button"
                  aria-label={name}
                  onClick={() => uebernimm(z)}
                  style={leistenKnopf}
                >
                  <span aria-hidden style={{ display: 'flex' }}>
                    <ZeichenBild
                      drawing={freiesZeichen({ zeichen_spec: z }).drawing}
                      size={KACHEL_BILD}
                    />
                  </span>
                </button>
              </Tooltip>
            );
          })}
        </div>
      )}

      <Raster
        gruppenName="Grundzeichen"
        suchName="Grundzeichen suchen"
        autoFocus={autoFokus}
        eintraege={gzEintraege}
        gewaehlt={grundzeichen}
        onWaehle={waehleGrundzeichen}
        onWaehleUndSende={
          onAbsenden
            ? (id) => {
                const neu = nachGrundzeichen(id);
                if (neu) uebernimmUndSende(neu);
                // „Kein Grundzeichen“: ein schon freistehendes Zeichen gilt, sonst nur wählen.
                else if (grundzeichenVon(entwurf) === null) uebernimmUndSende(wert);
                else waehleGrundzeichen(id);
              }
            : undefined
        }
      />

      {symbolEintraege.some((e) => e.id != null) && (
        <Raster
          gruppenName="Symbol"
          suchName="Symbol suchen"
          eintraege={symbolEintraege}
          gewaehlt={grundzeichen || grundzeichenVon(entwurf) === null ? symbolVon(entwurf) : null}
          onWaehle={(id) => {
            const neu = nachSymbol(id);
            if (neu) melde(neu);
          }}
          onWaehleUndSende={
            onAbsenden
              ? (id) => {
                  const neu = nachSymbol(id);
                  if (neu) uebernimmUndSende(neu);
                }
              : undefined
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
                  {DETAIL_ACHSEN.map(({ achse, label }) =>
                    details[achse].length > 0 ? (
                      <Select
                        key={achse}
                        aria-label={label}
                        allowClear
                        placeholder={label}
                        style={{ width: '100%' }}
                        value={detailVon(entwurf, achse) ?? undefined}
                        options={details[achse]}
                        onChange={(v?: string) =>
                          melde(mitSpec(mitDetail(entwurf, achse, v ?? null)))
                        }
                      />
                    ) : null,
                  )}

                  {/* Farbe nur aus der Palette und nur, wo das Zeichen eine Füllung trägt (D6). */}
                  {farbOptionen.length > 0 && (
                    <Select
                      aria-label="Farbe"
                      allowClear
                      placeholder="Farbe"
                      style={{ width: '100%' }}
                      value={detailVon(entwurf, 'farbe') ?? undefined}
                      options={farbOptionen}
                      optionRender={(o) => (
                        <span>
                          <Farbfeld farbe={o.data.farbe} rand={rollen.steuerRahmen} />
                          {o.data.label}
                        </span>
                      )}
                      labelRender={(o) => {
                        const option = farbOptionen.find((f) => f.value === o.value);
                        return option ? (
                          <span>
                            <Farbfeld farbe={option.farbe} rand={rollen.steuerRahmen} />
                            {option.label}
                          </span>
                        ) : (
                          o.label
                        );
                      }}
                      onChange={(v?: string) =>
                        melde(mitSpec(mitDetail(entwurf, 'farbe', v ?? null)))
                      }
                    />
                  )}

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

/** Ein freistehender Entwurf bleibt Grundlage des Symbolwechsels; ein Körper nicht (dann „ohne“). */
function nullWennKoerper(spec: AnySpec): AnySpec | null {
  return grundzeichenVon(spec) === null ? spec : null;
}
