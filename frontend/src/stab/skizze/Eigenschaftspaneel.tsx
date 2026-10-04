/**
 * Eigenschaftspaneel des gewählten Elements (LFH-893, Spec „Eigenschaftspaneel des gewählten
 * Elements“): rechts neben der Fläche, inline bearbeitbar nach den Primitiven des Projekts
 * (`InlineAngabe`, `ZeitpunktEingabe`, `Segmentleiste`). Jede Änderung geht über die Handlungen
 * der Fläche (`useSkizzenHandlungen.ts`) und damit über `SkizzenAktionen` und den Befehlsstapel.
 *
 * - **Stelle:** Rufname und Kommunikationsmittel im Datensatz der Stelle, Kanäle mit „Lösen“,
 *   Lücken, „Verbinden mit …“ und „zum Datensatz ↗“ (ein Sprung, keine Handlung).
 * - **Ohne Recht** (D8) nennt das Paneel den Grund („Einheiten: kein Schreibrecht“) und zeigt
 *   die Werte nur lesend; ohne Schreibweg im Einsatz und mobil ebenso.
 * - **Schiene:** nur lesend (Katalog-Einträge gelten org-weit), mit Verweis auf die
 *   Sprechgruppen-Darstellung des Funkplans.
 */
import { Alert, Button, Flex, Input, theme } from 'antd';
import type { Dayjs } from 'dayjs';
import { forwardRef, type ReactNode } from 'react';
import { Link } from 'react-router';
import ZeitAnzeige from '../../anzeige/ZeitAnzeige';
import { ZeitpunktEingabe } from '../../anzeige/ZeitpunktEingabe';
import { alsBackendZeit, alsZeitpunkt } from '../../anzeige/zeitEingabe';
import type {
  Komponentenart,
  Verbindungsart,
  Verbindungsmedium,
  Verbindungsstatus,
  Verkehr,
  VsVermerk,
} from '../../api/fernmeldeskizzeVertrag';
import { InlineAngabe } from '../../components/InlineAngabe';
import {
  Augenbraue,
  Datenfeld,
  Datenraster,
  Paneel,
  Segmentleiste,
  useRollen,
} from '../../components/instrument';
import { KOMMUNIKATIONSMITTEL_OPTIONEN } from '../../components/kommunikationsmittel';
import { Select } from '../../components/Select';
import Tastenkuerzel from '../../components/Tastenkuerzel';
import { funkplanPfad } from '../../routing/deeplinks';
import type { Fernmeldenetz, NetzStelle } from '../fernmeldeskizze';
import { STELLENART_LABEL } from '../kommunikationsplan';
import { HERKUNFT_LABEL } from '../sprechgruppenplan';
import { stabZeilenzielStil } from '../zeilenziel';
import {
  KOMPONENTENARTEN,
  VERBINDUNGSARTEN,
  komponentenartWort,
  verbindungsartWort,
} from '../skizzenZeichen';
import { griffGrund, lageGrund, type Bedienkontext } from './bedienung';
import { SCHRIFTFELD, stichleitungen, teileStichSchluessel } from './ebenen';
import { VS_NFD } from './schriftfeld';
import { anzeigeName, rufnamenZeile } from './SkizzenElemente';
import type { SkizzenHandlungen } from './useSkizzenHandlungen';

const ART_WORT: Record<NetzStelle['art'], string> = {
  fuehrungsstelle: 'Führungsstelle',
  abschnitt: 'Abschnitt',
  einheit: 'Einheit',
  extern: 'Externe Stelle',
  komponente: 'Komponente',
};

export const MEDIUM_OPTIONEN = [
  { wert: 'funk', label: 'Funk' },
  { wert: 'leitung', label: 'Leitergebunden' },
] as const satisfies readonly { wert: Verbindungsmedium; label: string }[];

export const STATUS_OPTIONEN = [
  { wert: 'bestehend', label: 'Bestehend' },
  { wert: 'geplant', label: 'Geplant' },
] as const satisfies readonly { wert: Verbindungsstatus; label: string }[];

const VERKEHR_OPTIONEN = [
  { wert: 'keiner', label: '—' },
  { wert: 'wechsel', label: 'Wechselverkehr' },
  { wert: 'gegen', label: 'Gegenverkehr' },
] as const;

const VS_OPTIONEN = [
  { wert: 'keiner', label: 'Kein Vermerk' },
  { wert: 'vs_nfd', label: 'VS-NfD' },
] as const satisfies readonly { wert: VsVermerk; label: string }[];

const leerText = (s: string) => s.trim() === '';
const zuNull = (s: string) => (s.trim() === '' ? null : s.trim());

function TextAngabe({
  etikett,
  wert,
  darf,
  mehrzeilig,
  maxLaenge,
  onSpeichern,
}: {
  etikett: string;
  wert: string | null;
  darf: boolean;
  mehrzeilig?: boolean;
  maxLaenge?: number;
  onSpeichern: (w: string | null) => Promise<unknown>;
}) {
  return (
    <InlineAngabe<string>
      etikett={etikett}
      wert={wert ?? ''}
      anzeige={wert}
      leer={leerText}
      gleich={(a, b) => a.trim() === b.trim()}
      darfSchreiben={darf}
      mehrzeilig={mehrzeilig}
      onSpeichern={(w) => onSpeichern(zuNull(w))}
      eingabe={({ feld, value, onChange }) =>
        mehrzeilig ? (
          <Input.TextArea
            {...feld}
            rows={3}
            maxLength={maxLaenge}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <Input
            {...feld}
            maxLength={maxLaenge}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        )
      }
    />
  );
}

function AuswahlAngabe<W extends string>({
  etikett,
  wert,
  optionen,
  darf,
  onSpeichern,
}: {
  etikett: string;
  wert: W | null;
  optionen: readonly { value: W; label: string }[];
  darf: boolean;
  onSpeichern: (w: W | null) => Promise<unknown>;
}) {
  return (
    <InlineAngabe<W | null>
      etikett={etikett}
      wert={wert}
      anzeige={optionen.find((o) => o.value === wert)?.label ?? wert}
      leer={(w) => w == null}
      darfSchreiben={darf}
      onSpeichern={onSpeichern}
      eingabe={({ feld, popup, value, onChange }) => (
        <Select<W | null>
          {...feld}
          {...popup}
          allowClear
          style={{ width: '100%' }}
          value={value}
          options={optionen.map((o) => ({ value: o.value, label: o.label }))}
          onChange={(w) => onChange(w ?? null)}
        />
      )}
    />
  );
}

function ZeitAngabe({
  etikett,
  wert,
  darf,
  onSpeichern,
}: {
  etikett: string;
  wert: string | null;
  darf: boolean;
  onSpeichern: (w: string | null) => Promise<unknown>;
}) {
  return (
    <InlineAngabe<Dayjs | null>
      etikett={etikett}
      wert={alsZeitpunkt(wert) ?? null}
      anzeige={wert ? <ZeitAnzeige wert={wert} format="dtgVoll" /> : null}
      leer={(d) => d == null}
      gleich={(a, b) => (a == null || b == null ? a === b : a.valueOf() === b.valueOf())}
      darfSchreiben={darf}
      onSpeichern={(d) => onSpeichern(d ? alsBackendZeit(d) : null)}
      eingabe={({ feld, popup, value, onChange }) => (
        <ZeitpunktEingabe
          {...feld}
          {...popup}
          format="YYYY-MM-DD HH:mm"
          style={{ width: '100%' }}
          value={value}
          onChange={(d) => onChange(d ?? null)}
        />
      )}
    />
  );
}

/** Lesender Wert oder „—“. */
function Wert({ children }: { children: ReactNode }) {
  const { rollen } = useRollen();
  return children == null || children === '' ? (
    <span style={{ color: rollen.gedaempft }}>—</span>
  ) : (
    <>{children}</>
  );
}

function Sprung({ ziel, children }: { ziel: string; children: ReactNode }) {
  // Handgebautes Ziel in einer Textzeile: Trefffläche der Stab-Ziele (Gate 3, LFH-893).
  const { token } = theme.useToken();
  return (
    <Link to={ziel} data-lfh="inspector-sprung" style={stabZeilenzielStil(token)}>
      {children} <span aria-hidden="true">↗</span>
    </Link>
  );
}

export interface EigenschaftspaneelProps {
  netz: Fernmeldenetz;
  gewaehlt: string | null;
  einsatzbezeichnung: string;
  kontext: Bedienkontext;
  handlungen: SkizzenHandlungen;
  meldung: string | null;
  onVerbinden: (stelle: string) => void;
  /** Rückfrage vor Unumkehrbarem (Komponente, Bereich entfernen). */
  onEntfernenFrage: (key: string) => void;
}

/** Das Paneel; die Überschrift ist das Ziel von Enter auf der Fläche (`ref`). */
const Eigenschaftspaneel = forwardRef<HTMLHeadingElement, EigenschaftspaneelProps>(
  function Eigenschaftspaneel(props, ref) {
    const {
      netz,
      gewaehlt,
      kontext,
      handlungen: h,
      meldung,
      onVerbinden,
      onEntfernenFrage,
    } = props;
    const { token, rollen } = useRollen();
    const stiche = stichleitungen(netz);

    const kopf = (titel: string, art: string) => (
      <div style={{ marginBlockEnd: token.marginSM }}>
        <Augenbraue>{art}</Augenbraue>
        <h3
          ref={ref}
          tabIndex={-1}
          data-lfh="skizze-paneel-titel"
          style={{ margin: 0, fontSize: token.fontSizeLG, overflowWrap: 'anywhere' }}
        >
          {titel}
        </h3>
      </div>
    );
    const grundHinweis = (grund: string | null) =>
      grund ? (
        <Alert
          type="info"
          showIcon
          title={grund}
          data-lfh="skizze-rechte-grund"
          style={{ marginBlockEnd: token.marginSM }}
        />
      ) : null;
    const meldungHinweis = meldung ? (
      <Alert
        type="warning"
        showIcon
        title={meldung}
        data-lfh="skizze-meldung"
        style={{ marginBlockEnd: token.marginSM }}
      />
    ) : null;

    let inhalt: ReactNode;
    const stelle = gewaehlt ? netz.stellen.find((s) => s.key === gewaehlt) : undefined;
    const schiene = gewaehlt ? netz.schienen.find((s) => s.key === gewaehlt) : undefined;
    const verbindung = gewaehlt ? netz.verbindungen.find((v) => v.key === gewaehlt) : undefined;
    const bereich = gewaehlt ? netz.bereiche.find((b) => b.key === gewaehlt) : undefined;
    const stich = gewaehlt ? teileStichSchluessel(gewaehlt) : null;
    const skizzeGrund = lageGrund(netz, kontext);

    if (stelle) {
      const grund = griffGrund(netz, stelle.key, kontext);
      const darf = grund == null;
      const kanaele = stiche.filter((s) => s.stelle === stelle.key);
      const mittelWert =
        'kommunikationsmittel' in stelle
          ? (KOMMUNIKATIONSMITTEL_OPTIONEN.find((o) => o.label === stelle.kommunikationsmittel)
              ?.value ?? null)
          : null;
      inhalt = (
        <>
          {kopf(anzeigeName(stelle), ART_WORT[stelle.art])}
          {grundHinweis(grund)}
          {meldungHinweis}
          <Datenraster spalten={1} beschriftung={`Angaben zu ${stelle.bezeichnung}`}>
            {stelle.art === 'extern' ? (
              <>
                <Datenfeld label="Stellenart">{STELLENART_LABEL[stelle.stellenart]}</Datenfeld>
                <Datenfeld label="Bezeichnung">
                  {stelle.bezeichnung}
                  <div style={{ color: rollen.gedaempft }}>gepflegt im Kommunikationsplan</div>
                </Datenfeld>
              </>
            ) : null}
            {stelle.art === 'komponente' ? (
              <>
                <Datenfeld label="Art">
                  <AuswahlAngabe<Komponentenart>
                    etikett="Art"
                    wert={stelle.komponentenart}
                    optionen={KOMPONENTENARTEN.map((a) => ({
                      value: a,
                      label: komponentenartWort(a),
                    }))}
                    darf={darf}
                    onSpeichern={(art) =>
                      art == null
                        ? Promise.reject(new Error('Art ist Pflicht'))
                        : h.aendereKomponente(
                            stelle.key,
                            stelle.id,
                            { art },
                            { art: stelle.komponentenart },
                          )
                    }
                  />
                </Datenfeld>
                <Datenfeld label="Bezeichnung">
                  <TextAngabe
                    etikett="Bezeichnung"
                    wert={stelle.bezeichnung}
                    darf={darf}
                    maxLaenge={100}
                    onSpeichern={(b) =>
                      h.aendereKomponente(
                        stelle.key,
                        stelle.id,
                        { bezeichnung: b },
                        { bezeichnung: stelle.bezeichnung },
                      )
                    }
                  />
                </Datenfeld>
              </>
            ) : null}
            {stelle.art === 'fuehrungsstelle' ||
            stelle.art === 'abschnitt' ||
            stelle.art === 'einheit' ? (
              <>
                <Datenfeld label="Rufname" mono>
                  {stelle.art === 'fuehrungsstelle' && !stelle.erfasst ? (
                    <Wert>{stelle.hinweis}</Wert>
                  ) : (
                    <TextAngabe
                      etikett="Rufname"
                      wert={stelle.rufname}
                      darf={darf}
                      onSpeichern={(r) => h.setzeRufname(stelle.key, r, stelle.rufname)}
                    />
                  )}
                </Datenfeld>
                <Datenfeld label="Kommunikationsmittel">
                  <AuswahlAngabe<string>
                    etikett="Kommunikationsmittel"
                    wert={mittelWert}
                    optionen={KOMMUNIKATIONSMITTEL_OPTIONEN}
                    darf={darf}
                    onSpeichern={(m) => h.setzeKommunikationsmittel(stelle.key, m, mittelWert)}
                  />
                </Datenfeld>
              </>
            ) : null}
            <Datenfeld label="Kanäle">
              {kanaele.length === 0 ? (
                <Wert>{null}</Wert>
              ) : (
                <ul
                  data-lfh="skizze-kanaele"
                  style={{ margin: 0, paddingInlineStart: 0, listStyle: 'none' }}
                >
                  {kanaele.map((k) => {
                    const sch = netz.schienen.find((s) => s.key === k.schiene);
                    if (!sch) return null;
                    return (
                      <li key={k.key} style={{ marginBlockEnd: token.marginXS }}>
                        <Flex gap={token.marginSM} wrap align="center">
                          <span style={{ fontFamily: token.fontFamilyCode }}>{sch.zeichen}</span>
                          {stelle.art === 'extern' && darf ? (
                            <Segmentleiste<Verbindungsstatus>
                              beschriftung={`Status ${sch.zeichen}`}
                              optionen={STATUS_OPTIONEN}
                              wert={k.status}
                              onWechsel={(st) =>
                                void h.kanalStatus(stelle.key, sch.id, st, k.status).catch(() => {})
                              }
                            />
                          ) : k.status === 'geplant' ? (
                            <span>geplant</span>
                          ) : null}
                          {darf ? (
                            <Button
                              danger
                              onClick={() => void h.loesen(stelle.key, sch.id).catch(() => {})}
                              aria-label={`${sch.zeichen} von ${stelle.bezeichnung} lösen`}
                            >
                              Lösen
                            </Button>
                          ) : null}
                        </Flex>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Datenfeld>
            {stelle.luecken.length > 0 ? (
              <Datenfeld label="Lücken">
                {stelle.luecken.map((l) => (
                  <div key={l.art} style={{ color: rollen.achtungText }}>
                    {l.text}
                  </div>
                ))}
              </Datenfeld>
            ) : null}
          </Datenraster>
          <Flex
            gap={token.marginSM}
            wrap
            align="center"
            style={{ marginBlockStart: token.marginSM }}
          >
            {darf || skizzeGrund == null ? (
              <Button onClick={() => onVerbinden(stelle.key)} data-lfh="skizze-verbinden">
                Verbinden mit …{' '}
                <Tastenkuerzel style={{ marginInlineStart: token.marginXXS }}>V</Tastenkuerzel>
              </Button>
            ) : null}
            {stelle.art === 'komponente' && darf ? (
              <Button danger onClick={() => onEntfernenFrage(stelle.key)}>
                Entfernen
              </Button>
            ) : null}
          </Flex>
          {stelle.ziel ? (
            <div style={{ marginBlockStart: token.marginSM }}>
              <Sprung ziel={stelle.ziel}>zum Datensatz</Sprung>
            </div>
          ) : null}
        </>
      );
    } else if (schiene) {
      inhalt = (
        <>
          {kopf(schiene.zeichen, 'Sammelschiene')}
          {meldungHinweis}
          <Datenraster spalten={1} beschriftung={`Angaben zu ${schiene.zeichen}`}>
            <Datenfeld label="Betriebsart">{schiene.betriebsart}</Datenfeld>
            <Datenfeld label="Bezeichnung" mono>
              {schiene.bezeichnung}
            </Datenfeld>
            <Datenfeld label="Hinweis">
              <Wert>{schiene.hinweis}</Wert>
            </Datenfeld>
            <Datenfeld label="Herkunft">{HERKUNFT_LABEL[schiene.herkunft]}</Datenfeld>
            <Datenfeld label="Teilnehmer">
              {schiene.teilnehmer.length === 0 ? (
                <Wert>{null}</Wert>
              ) : (
                <ul style={{ margin: 0, paddingInlineStart: token.paddingMD }}>
                  {schiene.teilnehmer.map((t) => {
                    const s = netz.stellen.find((x) => x.key === t.element);
                    return (
                      <li key={t.element}>
                        {s ? anzeigeName(s) : t.element}
                        {s && rufnamenZeile(s) && s.art !== 'extern'
                          ? ` · ${rufnamenZeile(s)}`
                          : ''}
                        {t.status === 'geplant' ? ' · geplant' : ''}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Datenfeld>
            {schiene.luecken.length > 0 ? (
              <Datenfeld label="Lücken">
                {schiene.luecken.map((l) => (
                  <div key={l.art} style={{ color: rollen.achtungText }}>
                    {l.text}
                  </div>
                ))}
              </Datenfeld>
            ) : null}
          </Datenraster>
          <div style={{ marginBlockStart: token.marginSM }}>
            <Sprung ziel={funkplanPfad(netz.einsatzId, { ansicht: 'sprechgruppen' })}>
              Sprechgruppe in der Kanalbelegung
            </Sprung>
          </div>
        </>
      );
    } else if (stich && gewaehlt) {
      const st = netz.stellen.find((s) => s.key === stich.stelle);
      const sch = netz.schienen.find((s) => s.key === stich.schiene);
      const t = sch?.teilnehmer.find((x) => x.element === stich.stelle);
      const grund = st ? griffGrund(netz, st.key, kontext) : null;
      inhalt =
        st && sch && t ? (
          <>
            {kopf(`${st.bezeichnung} an ${sch.zeichen}`, 'Stichleitung')}
            {grundHinweis(grund)}
            {meldungHinweis}
            <Datenraster spalten={1}>
              <Datenfeld label="Status">
                {t.status === 'geplant' ? 'geplant' : 'bestehend'}
              </Datenfeld>
            </Datenraster>
            {grund == null ? (
              <Button
                danger
                style={{ marginBlockStart: token.marginSM }}
                onClick={() => void h.loesen(st.key, sch.id).catch(() => {})}
              >
                Lösen{' '}
                <Tastenkuerzel style={{ marginInlineStart: token.marginXXS }}>Entf</Tastenkuerzel>
              </Button>
            ) : null}
          </>
        ) : null;
    } else if (verbindung) {
      const darf = skizzeGrund == null;
      const von = netz.stellen.find((s) => s.key === verbindung.von);
      const nach = netz.stellen.find((s) => s.key === verbindung.nach);
      const aendere = (felder: Parameters<typeof h.aendereVerbindung>[1]) =>
        void h.aendereVerbindung(verbindung, felder).catch(() => {});
      inhalt = (
        <>
          {kopf(`${von?.bezeichnung ?? '—'} – ${nach?.bezeichnung ?? '—'}`, 'Verbindung')}
          {grundHinweis(skizzeGrund)}
          {meldungHinweis}
          <Datenraster spalten={1} beschriftung="Angaben zur Verbindung">
            <Datenfeld label="Art">
              <AuswahlAngabe<Verbindungsart>
                etikett="Art"
                wert={verbindung.art}
                optionen={VERBINDUNGSARTEN.map((a) => ({ value: a, label: verbindungsartWort(a) }))}
                darf={darf}
                onSpeichern={(art) =>
                  art == null
                    ? Promise.reject(new Error('Art ist Pflicht'))
                    : h.aendereVerbindung(verbindung, { art })
                }
              />
            </Datenfeld>
            <Datenfeld label="Medium">
              {darf ? (
                <Segmentleiste<Verbindungsmedium>
                  beschriftung="Medium"
                  optionen={MEDIUM_OPTIONEN}
                  wert={verbindung.medium}
                  onWechsel={(medium) => aendere({ medium })}
                />
              ) : (
                MEDIUM_OPTIONEN.find((o) => o.wert === verbindung.medium)?.label
              )}
            </Datenfeld>
            <Datenfeld label="Status">
              {darf ? (
                <Segmentleiste<Verbindungsstatus>
                  beschriftung="Status"
                  optionen={STATUS_OPTIONEN}
                  wert={verbindung.status}
                  onWechsel={(status) => aendere({ status })}
                />
              ) : (
                STATUS_OPTIONEN.find((o) => o.wert === verbindung.status)?.label
              )}
            </Datenfeld>
            <Datenfeld label="Betriebsart">
              {darf ? (
                <Segmentleiste<'keiner' | Verkehr>
                  beschriftung="Betriebsart"
                  optionen={VERKEHR_OPTIONEN}
                  wert={verbindung.verkehr ?? 'keiner'}
                  onWechsel={(v) => aendere({ verkehr: v === 'keiner' ? null : v })}
                />
              ) : (
                VERKEHR_OPTIONEN.find((o) => o.wert === (verbindung.verkehr ?? 'keiner'))?.label
              )}
            </Datenfeld>
            <Datenfeld label="Hinweis">
              <TextAngabe
                etikett="Hinweis"
                wert={verbindung.hinweis}
                darf={darf}
                mehrzeilig
                maxLaenge={200}
                onSpeichern={(hinweis) => h.aendereVerbindung(verbindung, { hinweis })}
              />
            </Datenfeld>
          </Datenraster>
          {darf ? (
            <Button
              danger
              style={{ marginBlockStart: token.marginSM }}
              onClick={() => void h.entferneVerbindung(verbindung).catch(() => {})}
            >
              Entfernen{' '}
              <Tastenkuerzel style={{ marginInlineStart: token.marginXXS }}>Entf</Tastenkuerzel>
            </Button>
          ) : null}
        </>
      );
    } else if (bereich) {
      const darf = skizzeGrund == null;
      inhalt = (
        <>
          {kopf(bereich.bezeichnung, 'Bereich')}
          {grundHinweis(skizzeGrund)}
          {meldungHinweis}
          <Datenraster spalten={1}>
            <Datenfeld label="Bezeichnung">
              <TextAngabe
                etikett="Bezeichnung"
                wert={bereich.bezeichnung}
                darf={darf}
                maxLaenge={100}
                onSpeichern={(b) =>
                  b == null
                    ? Promise.reject(new Error('Bezeichnung ist Pflicht'))
                    : h.aendereBereich(bereich, { bezeichnung: b })
                }
              />
            </Datenfeld>
            <Datenfeld label="Größe" mono>
              {`${bereich.breite} × ${bereich.hoehe}`}
            </Datenfeld>
          </Datenraster>
          {darf ? (
            <Button
              danger
              style={{ marginBlockStart: token.marginSM }}
              onClick={() => onEntfernenFrage(bereich.key)}
            >
              Entfernen
            </Button>
          ) : null}
        </>
      );
    } else if (gewaehlt === SCHRIFTFELD) {
      const sf = netz.schriftfeld;
      const darf = skizzeGrund == null && sf != null;
      inhalt = (
        <>
          {kopf('Schriftfeld', 'Fernmeldeskizze')}
          {grundHinweis(sf == null ? 'Daten der Skizze: nicht geladen' : skizzeGrund)}
          {meldungHinweis}
          <Datenraster spalten={1} beschriftung="Schriftfeld">
            <Datenfeld label="Herausgeber">
              <TextAngabe
                etikett="Herausgeber"
                wert={sf?.herausgeber ?? null}
                darf={darf}
                onSpeichern={(v) =>
                  h.setzeSchriftfeld({ herausgeber: v }, { herausgeber: sf?.herausgeber ?? null })
                }
              />
              {!sf?.herausgeber ? (
                <div
                  style={{ color: rollen.gedaempft }}
                >{`Vorgabe: ${props.einsatzbezeichnung}`}</div>
              ) : null}
            </Datenfeld>
            <Datenfeld label="VS-Vermerk">
              {darf && sf ? (
                <Segmentleiste<VsVermerk>
                  beschriftung="VS-Vermerk"
                  optionen={VS_OPTIONEN}
                  wert={sf.vs_vermerk}
                  onWechsel={(vs) =>
                    void h
                      .setzeSchriftfeld({ vs_vermerk: vs }, { vs_vermerk: sf.vs_vermerk })
                      .catch(() => {})
                  }
                />
              ) : sf?.vs_vermerk === 'vs_nfd' ? (
                VS_NFD
              ) : (
                'Kein Vermerk'
              )}
            </Datenfeld>
            <Datenfeld label="Gültig ab" mono>
              <ZeitAngabe
                etikett="Gültig ab"
                wert={sf?.gueltig_ab ?? null}
                darf={darf}
                onSpeichern={(v) =>
                  h.setzeSchriftfeld({ gueltig_ab: v }, { gueltig_ab: sf?.gueltig_ab ?? null })
                }
              />
            </Datenfeld>
            <Datenfeld label="gez. (Name)">
              <TextAngabe
                etikett="gez. Name"
                wert={sf?.gez_name ?? null}
                darf={darf}
                onSpeichern={(v) =>
                  h.setzeSchriftfeld({ gez_name: v }, { gez_name: sf?.gez_name ?? null })
                }
              />
            </Datenfeld>
            <Datenfeld label="gez. (DTG)" mono>
              <ZeitAngabe
                etikett="gez. DTG"
                wert={sf?.gez_at ?? null}
                darf={darf}
                onSpeichern={(v) =>
                  h.setzeSchriftfeld({ gez_at: v }, { gez_at: sf?.gez_at ?? null })
                }
              />
            </Datenfeld>
            <Datenfeld label="Stand" mono>
              {netz.stand ? (
                <ZeitAnzeige wert={netz.stand} format="dtgVoll" />
              ) : (
                <Wert>{null}</Wert>
              )}
            </Datenfeld>
          </Datenraster>
        </>
      );
    } else {
      inhalt = (
        <div style={{ color: rollen.gedaempft }} data-lfh="skizze-paneel-leer">
          Kein Element gewählt. Klick, Tippen oder Tab wählt ein Element; das Schriftfeld steht
          unten rechts im Bild.
        </div>
      );
    }

    return (
      <Paneel
        titel="Eigenschaften"
        ueberschrift="h2"
        koerperPolster
        className="lfh-skizze-bedienung"
      >
        <div data-lfh="skizze-paneel">{inhalt}</div>
      </Paneel>
    );
  },
);

export default Eigenschaftspaneel;
