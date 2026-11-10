import { Button, Form, Input, Typography } from 'antd';
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Ortsfeld, type OrtsfeldWert } from '../../anzeige/Ortsfeld';
import { parseKalenderdatum } from '../../anzeige/kalenderdatum';
import { heuteInZone } from '../../anzeige/zeitEingabe';
import { useZeitEingabe } from '../../anzeige/ZeitpunktEingabe';
import {
  PERSON_ANGABE_MAX,
  PERSON_NAME_MAX,
  PERSON_UNVERTRAEGLICHKEITEN_MAX,
  REGISTRIERUNG_PERSONEN_MAX,
} from '../../api/eingabegrenzen';
import type { Betreuungsstelle, RegistrierungEingabe } from '../../api/types';
import { ErfassungsModal, type Speicherung } from '../../components/Erfassung';
import { Augenbraue, useRollen } from '../../components/instrument';
import { useViewport } from '../../components/useViewport';
import { zeichenGrenze, zeichenRegel } from '../../components/zeichenGrenze';
import { serverJetzt } from '../../offline/serveruhr';
import FlaechenWahl from '../../personen/FlaechenWahl';
import GeschlechtWahl from './GeschlechtWahl';
import {
  KOSTFORM_KURZ,
  KOSTFORM_REIHE,
  KOSTFORM_WORT,
  haushaltKennung,
  isDiaetHinweis,
  leereZeile,
  registrierBody,
  type RegistrierWerte,
  type RegistrierZeile,
} from './registrierKern';

/**
 * Maske „Registrieren“ der Registrierstelle (LLH-1612, Spec `betreuung-registrierung`,
 * „Registrieren in der Oberfläche“, design.md D8). Ein Haushalt in einem Zug, auf
 * `ErfassungsModal`.
 *
 * - **Kompakt durch Aufteilung, nie durch Einklappen** (Entscheidung Ruben 09.11.2026): oben
 *   EINMAL Herkunftsadresse und Kontakt des Haushalts (an jeder Person gespeichert), darunter je
 *   Person eine Zeile. Kein Feld liegt hinter einem Klappteil, Menü oder zweiten Schritt; das
 *   Feldbudget der Maske „Betroffene erfassen“ gilt hier ausdrücklich nicht.
 * - **Raster ab `lg`** mit EINER Spaltenkopfzeile; jedes Feld nennt Spalte und Person über
 *   `aria-labelledby` („Nachname Person 2“), nicht nur optisch. Schmaler (und im Handschuh-Modus,
 *   wo die Ziele 72 px tragen) ein Block je Person in zwei Spalten mit Beschriftung am Feld,
 *   Kostform und Unverträglichkeiten über die ganze Breite. Abweichung von design.md D8 („ab
 *   `md`“): die Mindestbreiten der sieben Spalten passen erst ab `lg` in den Dialog.
 * - **Tastatur:** DOM-Folge Haushalt → Person 1 → Person 2 …; Geschlecht und Kostform sind je eine
 *   Gruppe mit Pfeiltasten (ein Tabulatorhalt). „Person hinzufügen“ belegt den Nachnamen der ersten
 *   Person vor und setzt den Fokus in den Vornamen der neuen Zeile, „Entfernen“ auf die Zeile davor.
 * - **Fehler am Feld:** `Form.Item` verknüpft seinen Grund per `aria-describedby` und setzt
 *   `aria-invalid` (dieselbe Optik wie `FeldFehler`).
 * - **Unverträglichkeit bei Normalkost** fragt „Diät/allergenarm wählen?“; die Kostform ändert sie
 *   nie von selbst (design.md D4).
 * - Ein neuer Haushalt nimmt den Serienmodus: „Speichern und nächste“ lässt die Maske leer für den
 *   nächsten Haushalt stehen. Das Anhängen an einen Haushalt (`haushalt`) legt einmal an.
 */

/** Schmalste Kostform-Fläche: die Kurzwörter („o. Schwein“) brechen darin höchstens einmal um. */
const KOSTFORM_FLAECHE = 80;

const KOSTFORM_OPTIONEN = KOSTFORM_REIHE.map((k) => ({
  wert: k,
  label: KOSTFORM_KURZ[k],
  name: KOSTFORM_WORT[k],
}));

/** Spalten der Personenzeile in fester Folge (Kopf und Zeile teilen sie). */
const SPALTEN = [
  { feld: 'name', wort: 'Nachname', breite: 'minmax(96px, 1fr)' },
  { feld: 'vorname', wort: 'Vorname', breite: 'minmax(88px, 1fr)' },
  { feld: 'geburtsdatum', wort: 'Geburtsdatum', breite: 'minmax(104px, 0.8fr)' },
  { feld: 'geschlecht', wort: 'Geschlecht', breite: 'auto' },
  { feld: 'kostform', wort: 'Kostform', breite: 'minmax(176px, 2.6fr)' },
  { feld: 'unvertraeglichkeiten', wort: 'Unverträglichkeiten', breite: 'minmax(96px, 1fr)' },
] as const;
type Spalte = (typeof SPALTEN)[number]['feld'];

/** Erste Spalte: die Nummer der Person; letzte: „Entfernen“. */
const RASTER_SPALTEN = ['auto', ...SPALTEN.map((s) => s.breite), 'auto'].join(' ');

export interface RegistrierMaskeProps {
  stelle: Pick<Betreuungsstelle, 'id' | 'bezeichnung'>;
  /** Anhängen an einen bestehenden Haushalt; `nachname` belegt die erste Zeile vor. */
  haushalt?: { id: number; nummer: number; nachname?: string };
  laeuft: boolean;
  /** Lehnt bei Ablehnung ab (`mutateAsync`), damit die Felder stehen bleiben. */
  onErfassen: (body: RegistrierungEingabe) => Promise<unknown>;
  /** Die Mutation (Grund der Ablehnung im Dialog, LFH-1077). */
  speicherung?: Speicherung;
  onSchliessen: () => void;
}

export default function RegistrierMaske({
  stelle,
  haushalt,
  laeuft,
  onErfassen,
  speicherung,
  onSchliessen,
}: RegistrierMaskeProps) {
  const [form] = Form.useForm<RegistrierWerte>();
  const { token } = useRollen();
  const { abBreite } = useViewport();
  const { zone } = useZeitEingabe();
  const basis = useId();
  const wurzel = useRef<HTMLDivElement>(null);
  // Nach „Person hinzufügen“ bzw. „Entfernen“: wohin der Fokus geht, sobald die Zeile steht.
  const [fokus, setFokus] = useState<{ index: number; feld: Spalte } | null>(null);
  const handschuh = token.controlHeight >= 72;
  const raster = abBreite('lg') && !handschuh;
  const personen = (Form.useWatch('personen', form) as RegistrierZeile[] | undefined) ?? [];

  useEffect(() => {
    if (!fokus) return;
    const ziel = wurzel.current?.querySelector<HTMLElement>(
      `#personen_${fokus.index}_${fokus.feld}`,
    );
    if (!ziel) return;
    ziel.focus();
    setFokus(null);
  }, [fokus, personen.length]);

  const heute = () => heuteInZone(zone, serverJetzt());
  const startwerte: RegistrierWerte = { personen: [leereZeile(haushalt?.nachname)] };
  const anzahl = personen.length || 1;

  const kopfId = (feld: Spalte) => `${basis}-kopf-${feld}`;
  const zeileId = (key: number) => `${basis}-zeile-${key}`;
  const etikettId = (key: number, feld: Spalte) => `${basis}-${key}-${feld}`;

  /** Ein Feld der Personenzeile: im Raster ohne eigene Beschriftung (der Spaltenkopf benennt es),
   *  im Block mit sichtbarer Beschriftung am Feld. */
  function zelle(
    key: number,
    feld: Spalte,
    wort: string,
    item: (beschriftungIds: string) => ReactNode,
    stil?: CSSProperties,
  ) {
    const ids = raster
      ? `${kopfId(feld)} ${zeileId(key)}`
      : `${etikettId(key, feld)} ${zeileId(key)}`;
    return (
      <div key={feld} style={{ minWidth: 0, ...stil }}>
        {!raster && (
          <div id={etikettId(key, feld)} style={{ marginBottom: token.marginXXS }}>
            <Typography.Text>{wort}</Typography.Text>
          </div>
        )}
        {item(ids)}
      </div>
    );
  }

  const ohneAbstand = { marginBottom: 0 };
  const titel = haushalt
    ? `Registrieren · ${haushaltKennung(haushalt.nummer)} · ${stelle.bezeichnung}`
    : `Registrieren · ${stelle.bezeichnung}`;

  return (
    <ErfassungsModal<RegistrierWerte>
      offen
      titel={titel}
      form={form}
      breite="min(1280px, calc(100vw - 32px))"
      erfassenText="Registrieren"
      serie={!haushalt}
      initialValues={startwerte}
      laeuft={laeuft}
      speicherung={speicherung}
      speicherFehlerTitel="Nicht registriert"
      zusammenfassung={`${anzahl} ${anzahl === 1 ? 'Person' : 'Personen'}`}
      onErfassen={(werte) => onErfassen(registrierBody(werte, heute(), haushalt?.id))}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <div ref={wurzel} data-lfh="registrier-maske">
        <Augenbraue als="h3" style={{ marginBottom: token.marginXS }}>
          Haushalt
        </Augenbraue>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))',
            columnGap: token.marginSM,
          }}
        >
          {/* Personenbezogen: nie an den Geocoder (`frontend/AGENTS.md`, Ortsangaben). */}
          <Form.Item<RegistrierWerte>
            name="herkunft_adresse"
            label="Herkunft / Adresse"
            rules={[zeichenRegel(PERSON_ANGABE_MAX, 'Herkunft / Adresse')]}
            getValueProps={(t?: string) => ({ value: { text: t ?? '', koordinate: null } })}
            normalize={(w: OrtsfeldWert) => w.text}
          >
            <Ortsfeld
              ohneSuche="personenbezogen"
              aria-label="Herkunft / Adresse des Haushalts"
              count={zeichenGrenze(PERSON_ANGABE_MAX)}
            />
          </Form.Item>
          <Form.Item<RegistrierWerte>
            name="kontakt"
            label="Kontakt"
            rules={[zeichenRegel(PERSON_ANGABE_MAX, 'Kontakt')]}
          >
            <Input aria-label="Kontakt des Haushalts" count={zeichenGrenze(PERSON_ANGABE_MAX)} />
          </Form.Item>
        </div>

        <Augenbraue als="h3" style={{ marginBottom: token.marginXS }}>
          Personen
        </Augenbraue>
        <Form.List name="personen">
          {(felder, { add, remove }) => (
            <>
              <div
                style={
                  raster
                    ? {
                        display: 'grid',
                        gridTemplateColumns: RASTER_SPALTEN,
                        columnGap: token.marginSM,
                        rowGap: token.marginXS,
                        alignItems: 'start',
                      }
                    : { display: 'flex', flexDirection: 'column', gap: token.margin }
                }
              >
                {raster && (
                  <div data-lfh="registrier-kopf" style={{ display: 'contents' }}>
                    <span aria-hidden="true" />
                    {SPALTEN.map((s) => (
                      <Typography.Text key={s.feld} id={kopfId(s.feld)} type="secondary">
                        {s.wort}
                      </Typography.Text>
                    ))}
                    <span aria-hidden="true" />
                  </div>
                )}
                {felder.map((f, index) => {
                  const zeile = personen[index];
                  const nummer = index + 1;
                  const zellen = [
                    zelle(f.key, 'name', 'Nachname', (ids) => (
                      <Form.Item
                        name={[f.name, 'name']}
                        rules={[
                          { required: true, whitespace: true, message: 'Nachname fehlt' },
                          zeichenRegel(PERSON_NAME_MAX, 'Nachname'),
                        ]}
                        style={ohneAbstand}
                      >
                        <Input aria-labelledby={ids} count={zeichenGrenze(PERSON_NAME_MAX)} />
                      </Form.Item>
                    )),
                    zelle(f.key, 'vorname', 'Vorname', (ids) => (
                      <Form.Item
                        name={[f.name, 'vorname']}
                        rules={[zeichenRegel(PERSON_NAME_MAX, 'Vorname')]}
                        style={ohneAbstand}
                      >
                        <Input aria-labelledby={ids} count={zeichenGrenze(PERSON_NAME_MAX)} />
                      </Form.Item>
                    )),
                    zelle(f.key, 'geburtsdatum', 'Geburtsdatum', (ids) => (
                      <Form.Item
                        name={[f.name, 'geburtsdatum']}
                        rules={[
                          {
                            validator: (_, w?: string) => {
                              if (!w?.trim()) return Promise.resolve();
                              const r = parseKalenderdatum(w, heute());
                              return r.ok ? Promise.resolve() : Promise.reject(new Error(r.grund));
                            },
                          },
                        ]}
                        style={ohneAbstand}
                      >
                        <Input
                          aria-labelledby={ids}
                          placeholder="TT.MM.JJJJ"
                          inputMode="numeric"
                          style={{ fontFamily: token.fontFamilyCode }}
                        />
                      </Form.Item>
                    )),
                    zelle(f.key, 'geschlecht', 'Geschlecht', () => (
                      <Form.Item name={[f.name, 'geschlecht']} style={ohneAbstand}>
                        <GeschlechtWahl aria-label={`Geschlecht, Person ${nummer}`} />
                      </Form.Item>
                    )),
                    zelle(
                      f.key,
                      'kostform',
                      'Kostform',
                      () => (
                        <Form.Item name={[f.name, 'kostform']} style={ohneAbstand}>
                          <FlaechenWahl
                            optionen={KOSTFORM_OPTIONEN}
                            breite={KOSTFORM_FLAECHE}
                            aria-label={`Kostform, Person ${nummer}`}
                          />
                        </Form.Item>
                      ),
                      raster ? undefined : { gridColumn: '1 / -1' },
                    ),
                    zelle(
                      f.key,
                      'unvertraeglichkeiten',
                      'Unverträglichkeiten',
                      (ids) => (
                        <Form.Item
                          name={[f.name, 'unvertraeglichkeiten']}
                          rules={[
                            zeichenRegel(PERSON_UNVERTRAEGLICHKEITEN_MAX, 'Unverträglichkeiten'),
                          ]}
                          style={ohneAbstand}
                        >
                          <Input
                            aria-labelledby={ids}
                            count={zeichenGrenze(PERSON_UNVERTRAEGLICHKEITEN_MAX)}
                          />
                        </Form.Item>
                      ),
                      raster ? undefined : { gridColumn: '1 / -1' },
                    ),
                  ];
                  const entfernen =
                    felder.length > 1 ? (
                      <Button
                        aria-label={`Person ${nummer} entfernen`}
                        onClick={() => {
                          remove(f.name);
                          setFokus({ index: Math.max(0, index - 1), feld: 'name' });
                        }}
                      >
                        Entfernen
                      </Button>
                    ) : (
                      <span />
                    );
                  const hinweis = zeile && isDiaetHinweis(zeile) && (
                    <div style={{ gridColumn: '1 / -1' }}>
                      <Button
                        type="link"
                        style={{ paddingInline: 0 }}
                        onClick={() =>
                          form.setFieldValue(['personen', f.name, 'kostform'], 'diaet_allergenarm')
                        }
                      >
                        Diät/allergenarm wählen?
                      </Button>
                    </div>
                  );
                  return raster ? (
                    <div
                      key={f.key}
                      role="group"
                      aria-labelledby={zeileId(f.key)}
                      style={{ display: 'contents' }}
                    >
                      <span
                        id={zeileId(f.key)}
                        aria-label={`Person ${nummer}`}
                        style={{
                          fontFamily: token.fontFamilyCode,
                          fontVariantNumeric: 'tabular-nums',
                          lineHeight: `${token.controlHeight}px`,
                        }}
                      >
                        {nummer}
                      </span>
                      {zellen}
                      {entfernen}
                      {hinweis}
                    </div>
                  ) : (
                    <div
                      key={f.key}
                      role="group"
                      aria-labelledby={zeileId(f.key)}
                      data-lfh="registrier-person"
                      style={{
                        borderTop: `1px solid ${token.colorBorderSecondary}`,
                        paddingTop: token.paddingSM,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: token.marginSM,
                          marginBottom: token.marginXS,
                        }}
                      >
                        <Typography.Text strong id={zeileId(f.key)}>
                          Person {nummer}
                        </Typography.Text>
                        {entfernen}
                      </div>
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(min(160px, 100%), 1fr))',
                          columnGap: token.marginSM,
                          rowGap: token.marginSM,
                        }}
                      >
                        {zellen}
                        {hinweis}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: token.marginSM }}>
                <Button
                  disabled={felder.length >= REGISTRIERUNG_PERSONEN_MAX}
                  aria-describedby={
                    felder.length >= REGISTRIERUNG_PERSONEN_MAX ? `${basis}-voll` : undefined
                  }
                  onClick={() => {
                    const nachname = form.getFieldValue(['personen', 0, 'name']) as
                      string | undefined;
                    add(leereZeile(nachname?.trim() || undefined));
                    setFokus({ index: felder.length, feld: 'vorname' });
                  }}
                >
                  Person hinzufügen
                </Button>
                {felder.length >= REGISTRIERUNG_PERSONEN_MAX && (
                  <Typography.Text id={`${basis}-voll`} type="secondary" style={{ marginLeft: 8 }}>
                    Höchstens {REGISTRIERUNG_PERSONEN_MAX} Personen je Registrierung
                  </Typography.Text>
                )}
              </div>
            </>
          )}
        </Form.List>
      </div>
    </ErfassungsModal>
  );
}
