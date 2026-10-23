import { useState } from 'react';
import { Input } from 'antd';
import { useQuery } from '@tanstack/react-query';
import {
  EINHEIT_BEMERKUNG_MAX,
  EINHEIT_FUNKRUFNAME_MAX,
  EINHEIT_NAME_MAX,
} from '../../api/eingabegrenzen';
import type { EinheitPatch } from '../../api/einheiten';
import { listeFahrzeugStatus } from '../../api/fahrzeugStatus';
import { leerZuNull } from '../../api/patchTriState';
import { globalKeys } from '../../api/queryKeys';
import type { Einheit, Einsatzabschnitt, EinheitTyp, Staerke } from '../../api/types';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import StaerkeAnzeige from '../../anzeige/StaerkeAnzeige';
import StaerkeEingabe from '../../anzeige/StaerkeEingabe';
import { InlineAngabe } from '../../components/InlineAngabe';
import { KennungsLink } from '../../components/kennungsLink';
import {
  Datenfeld,
  Datenraster,
  Paneel,
  StatusChip,
  monoStil,
  useRollen,
} from '../../components/instrument';
import { nichtGefundenInhalt } from '../../components/SeitenZustand';
import { Select } from '../../components/Select';
import { ZeilenFehler } from '../../components/SpeicherHinweis';
import StatusTag from '../../components/StatusTag';
import StatusWahl from '../../components/StatusWahl';
import { grenzeText, istZuLang, zeichenGrenze } from '../../components/zeichenGrenze';
import EinheitZeichen from '../../kraefte/EinheitZeichen';
import NichtUebernommenMarke from '../../kraefte/NichtUebernommenMarke';
import { handStatusOptionen, KEIN_HANDSTATUS } from '../../kraefte/fmsTableauKern';
import { einheitStaerkeUrteilVon } from '../../kraefte/kraeftebaumKern';
import { einheitStatusAnzeige } from '../../kraefte/meldebildRaster';
import { einheitStaerkeUrteil, statusKategorie } from '../../theme/statusFarben';
import { collectNachfahren } from './einheitAnsichtKern';
import { zeitKurz } from '../../anzeige/zeitDarstellung';

/**
 * Speichert EINE Angabe der Einheit (LLH-1036, design.md D1): `etikett` nennt sie in der
 * Erfolgsmeldung, der Patch trägt genau ihr Feld (die Soll-Stärke ihre drei). Erfüllt erst, wenn
 * der neue Stand im Cache steht; lehnt bei Ablehnung ab, dann zeigt die Zeile den Grund.
 */
export type EinheitPatchHandler = (etikett: string, patch: EinheitPatch) => Promise<unknown>;

/** Setzt oder leert den Handstatus einer Einheit ohne Fahrzeug; lehnt bei Ablehnung ab. */
export type HandStatusHandler = (statusId: number | null) => Promise<unknown>;

/** Was eine Katalog-Query dem Auswahlfeld liefert: die Daten und ob ihr Abruf scheiterte. */
interface Katalog<T> {
  data: readonly T[] | undefined;
  isError: boolean;
  error: unknown;
}

interface EinheitKopfProps {
  einheit: Einheit;
  /** Alle Einheiten des Einsatzes: Über-Einheit und „kumuliert“. */
  einheiten: readonly Einheit[];
  typen: Katalog<EinheitTyp>;
  abschnitte: Katalog<Einsatzabschnitt>;
  /** Schreiben + Freigabe Einheiten (`EinheitRechte.canEditEinheit`). */
  canEdit: boolean;
  /** Organisations-Vorgabe des Zeichens aus `/api/organisation`. */
  orgDefault: string | null;
  onPatch: EinheitPatchHandler;
  onSetHandStatus: HandStatusHandler;
  /**
   * Sprung zur Nachforderung, aus der die Einheit stammt (LLH-1383 D9); `null` ohne Freigabe
   * Nachforderungen — dann steht die Herkunft ohne Sprung.
   */
  nachforderungPfad?: string | null;
}

/** Leer ist ein Text, der nach dem Trimmen nichts übrig lässt — wie `leerZuNull` beim Senden. */
const isEmptyText = (w: string) => w.trim() === '';
const isSameText = (a: string, b: string) => a.trim() === b.trim();
const isSameStaerke = (a: Staerke | null, b: Staerke | null) =>
  a == null || b == null
    ? a == null && b == null
    : a.fuehrer === b.fuehrer && a.unterfuehrer === b.unterfuehrer && a.mannschaft === b.mannschaft;

/**
 * Der Kopf einer Einheit (LLH-1036, design.md D1–D4): links das taktische Zeichen groß im
 * gespeicherten Stand, rechts jede Angabe an ihrem Wert. Eine Zeile schickt genau ihr Feld; die
 * Seite hat kein Formular, keine Speichern-Leiste und damit keinen Verlassen-Schutz (wie der
 * Abschnitt, LFH-1208). So überschreibt keine Zeile, was ein anderer Arbeitsplatz oder die
 * Fernmeldeskizze inzwischen geändert hat.
 *
 * Funkrufname und Bemerkung stehen hier, weil sie die Einheit benennen bzw. sie ganz betreffen;
 * womit man sie erreicht, steht im Paneel „Funk und Kommunikation“ (D2). Die Einsatzdauer steht
 * nur im Paneel „Zeitachse“ (eine Heimat je Zahl).
 */
export default function EinheitKopf({
  einheit: e,
  einheiten,
  typen,
  abschnitte,
  canEdit,
  orgDefault,
  onPatch,
  onSetHandStatus,
  nachforderungPfad,
}: EinheitKopfProps) {
  const { token } = useRollen();
  // Grenzen wie der Server (Spec `eingabegrenzen`, LLH-1242): der kurze Funkrufname über
  // `maxLength`, die mehrzeilige Bemerkung mit Zähler und Prüfung, nie gekürzt
  // (`frontend/AGENTS.md`, „Freitext nie länger als der Server erlaubt“).
  const textRow = (
    etikett: string,
    feld: 'funkrufname' | 'bemerkung',
    max: number,
    mehrzeilig: boolean,
    placeholder?: string,
  ) => (
    <InlineAngabe<string>
      etikett={etikett}
      wert={e[feld] ?? ''}
      anzeige={
        <span style={feld === 'funkrufname' ? monoStil(13) : { whiteSpace: 'pre-wrap' }}>
          {e[feld]}
        </span>
      }
      leer={isEmptyText}
      gleich={isSameText}
      darfSchreiben={canEdit}
      mehrzeilig={mehrzeilig}
      pruefe={(w) =>
        mehrzeilig && istZuLang(w, max)
          ? `${etikett} darf höchstens ${grenzeText(max)} Zeichen lang sein`
          : null
      }
      onSpeichern={(w) => onPatch(etikett, { [feld]: leerZuNull(w) })}
      eingabe={({ feld: f, value, onChange }) =>
        mehrzeilig ? (
          <Input.TextArea
            {...f}
            autoSize={{ minRows: 2 }}
            count={zeichenGrenze(max)}
            value={value}
            onChange={(ev) => onChange(ev.target.value)}
          />
        ) : (
          <Input
            {...f}
            placeholder={placeholder}
            maxLength={max}
            value={value}
            onChange={(ev) => onChange(ev.target.value)}
          />
        )
      }
    />
  );

  // Über-Einheit: weder die Einheit selbst noch einer ihrer Nachfahren, sonst entstünde ein Kreis.
  const gesperrt = collectNachfahren(einheiten, e.id);
  const ueberOptionen = einheiten
    .filter((x) => !gesperrt.has(x.id))
    .map((x) => ({ value: x.id, label: x.name }));
  const ueberName = einheiten.find((x) => x.id === e.ueber_einheit_id)?.name ?? null;
  const hasUntereinheiten = einheiten.some((x) => x.ueber_einheit_id === e.id);
  const urteil = einheitStaerkeUrteilVon(e.ist_kumuliert, e.soll ?? null);

  return (
    <Paneel
      titel="Kopfdaten"
      meta={e.nicht_uebernommen_seit != null ? <NichtUebernommenMarke /> : undefined}
      koerperPolster
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          gap: token.margin,
        }}
      >
        {/* Der gespeicherte Stand; die Vorschau beim Ändern steht im Eingabefeld (D4). */}
        <EinheitZeichen
          tz={{
            typLabel: e.typ_label ?? null,
            fachaufgabe: e.tz_fachaufgabe ?? null,
            organisation: e.tz_organisation ?? null,
          }}
          groesse={64}
          orgDefault={orgDefault}
        />
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <Datenraster spalten={2} beschriftung="Kopfdaten">
            <Datenfeld label="Name">
              <InlineAngabe<string>
                etikett="Name"
                wert={e.name}
                anzeige={e.name}
                leer={isEmptyText}
                gleich={isSameText}
                darfSchreiben={canEdit}
                pflicht
                onSpeichern={(w) => onPatch('Name', { name: w.trim() })}
                eingabe={({ feld, value, onChange }) => (
                  <Input
                    {...feld}
                    maxLength={EINHEIT_NAME_MAX}
                    value={value}
                    onChange={(ev) => onChange(ev.target.value)}
                  />
                )}
              />
            </Datenfeld>
            <Datenfeld label="Typ">
              <InlineAngabe<number | null>
                etikett="Typ"
                wert={e.typ_id ?? null}
                anzeige={e.typ_label}
                leer={(w) => w == null}
                darfSchreiben={canEdit}
                onSpeichern={(w) => onPatch('Typ', { typ_id: w })}
                eingabe={({ feld, popup, value, onChange }) => (
                  // Der Typkatalog ist eine Fremdquelle: fällt er aus, steht der Ausfall im Feld,
                  // statt dass die Auswahl stumm leer bleibt.
                  <Select<number>
                    {...feld}
                    {...popup}
                    allowClear
                    placeholder="Typ wählen"
                    notFoundContent={nichtGefundenInhalt(typen, {
                      allgemein: 'Einheitentypen konnten nicht geladen werden',
                    })}
                    options={(typen.data ?? []).map((t) => ({ value: t.id, label: t.label }))}
                    value={value ?? undefined}
                    onChange={(w) => onChange(w ?? null)}
                  />
                )}
              />
            </Datenfeld>
            {/* Der Rufname der Einheit, nicht eines ihrer Fahrzeuge. Leer zeigt das Meldebild
                höchstens den Rufnamen des einzigen Fahrzeugs. */}
            <Datenfeld label="Funkrufname">
              {textRow(
                'Funkrufname',
                'funkrufname',
                EINHEIT_FUNKRUFNAME_MAX,
                false,
                'z. B. Florian HM 12/44',
              )}
            </Datenfeld>
            <Datenfeld label="Abschnitt">
              <InlineAngabe<number | null>
                etikett="Abschnitt"
                wert={e.abschnitt_id ?? null}
                anzeige={e.abschnitt_name}
                leer={(w) => w == null}
                darfSchreiben={canEdit}
                onSpeichern={(w) => onPatch('Abschnitt', { abschnitt_id: w })}
                eingabe={({ feld, popup, value, onChange }) => (
                  <Select<number>
                    {...feld}
                    {...popup}
                    allowClear
                    placeholder="Abschnitt zuordnen"
                    notFoundContent={nichtGefundenInhalt(abschnitte, {
                      allgemein: 'Abschnitte konnten nicht geladen werden',
                    })}
                    options={(abschnitte.data ?? []).map((a) => ({ value: a.id, label: a.name }))}
                    value={value ?? undefined}
                    onChange={(w) => onChange(w ?? null)}
                  />
                )}
              />
            </Datenfeld>
            <Datenfeld label="Über-Einheit">
              <InlineAngabe<number | null>
                etikett="Über-Einheit"
                wert={e.ueber_einheit_id ?? null}
                anzeige={ueberName}
                leer={(w) => w == null}
                darfSchreiben={canEdit}
                onSpeichern={(w) => onPatch('Über-Einheit', { ueber_einheit_id: w })}
                eingabe={({ feld, popup, value, onChange }) => (
                  <Select<number>
                    {...feld}
                    {...popup}
                    allowClear
                    placeholder="Unterstellung"
                    options={ueberOptionen}
                    value={value ?? undefined}
                    onChange={(w) => onChange(w ?? null)}
                  />
                )}
              />
            </Datenfeld>
            {/* Herkunft (LLH-1383 D9): fest, nicht änderbar; ein Sprung ist keine Handlung. */}
            {e.nachforderung_id != null && (
              <Datenfeld label="Herkunft">
                <span data-lfh="einheit-herkunft">
                  {nachforderungPfad ? (
                    <KennungsLink to={nachforderungPfad}>
                      aus Nachforderung #{e.nachforderung_id} <span aria-hidden="true">↗</span>
                    </KennungsLink>
                  ) : (
                    <>aus Nachforderung #{e.nachforderung_id}</>
                  )}
                </span>
              </Datenfeld>
            )}
            {/* Eine Person der Einheit; der Server schreibt den Wechsel ins Tagebuch. Die leere
                Zeile „Einheitsführer eintragen“ zeigt die Lücke (D9). */}
            <Datenfeld label="Einheitsführer">
              <InlineAngabe<number | null>
                etikett="Einheitsführer"
                wert={e.fuehrer_id ?? null}
                anzeige={e.fuehrer_name}
                leer={(w) => w == null}
                darfSchreiben={canEdit}
                onSpeichern={(w) => onPatch('Einheitsführer', { fuehrer_id: w })}
                eingabe={({ feld, popup, value, onChange }) => (
                  <Select<number>
                    {...feld}
                    {...popup}
                    allowClear
                    placeholder="Person der Einheit"
                    notFoundContent="Keine Personen in der Einheit"
                    options={e.personal_mitglieder.map((m) => ({ value: m.ep_id, label: m.name }))}
                    value={value ?? undefined}
                    onChange={(w) => onChange(w ?? null)}
                  />
                )}
              />
            </Datenfeld>
            {/* BOS-Fachsprache: Soll-Stärke (Führer / Unterführer / Mannschaft). Die drei gehen in
                EINER Anfrage: der Server verlangt alle drei oder keinen. */}
            <Datenfeld label="Soll-Stärke (F/UF/M)">
              <InlineAngabe<Staerke | null>
                etikett="Soll-Stärke"
                wert={e.soll ?? null}
                anzeige={
                  <span style={monoStil(13)}>
                    <StaerkeAnzeige wert={e.soll ?? null} />
                  </span>
                }
                leer={(w) => w == null}
                gleich={isSameStaerke}
                darfSchreiben={canEdit}
                onSpeichern={(w) =>
                  onPatch('Soll-Stärke', {
                    soll_fuehrer: w?.fuehrer ?? null,
                    soll_unterfuehrer: w?.unterfuehrer ?? null,
                    soll_mannschaft: w?.mannschaft ?? null,
                  })
                }
                eingabe={({ feld, value, onChange }) => (
                  <div role="group" id={feld.id} aria-label={feld['aria-label']}>
                    <StaerkeEingabe value={value} onChange={onChange} autoFocus />
                  </div>
                )}
              />
            </Datenfeld>
            <Datenfeld label="Ist (F/UF/M//Σ)">
              <IstAnzeige
                ist={e.ist}
                kumuliert={hasUntereinheiten ? e.ist_kumuliert : null}
                urteil={urteil}
              />
            </Datenfeld>
            <Datenfeld label="Status">
              <StatusZeile einheit={e} canEdit={canEdit} onSetHandStatus={onSetHandStatus} />
            </Datenfeld>
            <Datenfeld label="Bemerkung" breit>
              {textRow('Bemerkung', 'bemerkung', EINHEIT_BEMERKUNG_MAX, true)}
            </Datenfeld>
          </Datenraster>
        </div>
      </div>
    </Paneel>
  );
}

/**
 * Ist vom Server (D3): die eigene, mit Untereinheiten auch die kumulierte, dazu das Urteil der
 * kumulierten gegen das Soll mit Wort (zweiter Kanal). Ohne Soll kein Urteil.
 */
function IstAnzeige({
  ist,
  kumuliert,
  urteil,
}: {
  ist: Staerke;
  kumuliert: Staerke | null;
  urteil: ReturnType<typeof einheitStaerkeUrteilVon>;
}) {
  const { token } = useRollen();
  return (
    <span
      style={{
        display: 'inline-flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: token.marginXS,
      }}
    >
      <span style={monoStil(13)}>
        <StaerkeAnzeige wert={ist} />
        {kumuliert && (
          <>
            {' · kumuliert '}
            <StaerkeAnzeige wert={kumuliert} />
          </>
        )}
      </span>
      {urteil !== 'kein_soll' && <StatusTag darstellung={einheitStaerkeUrteil[urteil]} umbrechen />}
    </span>
  );
}

/**
 * Status wie im Meldebild (`einheitStatusAnzeige`) mit „seit“. Ohne Fahrzeug und mit Schreibrecht
 * setzt die Zeile den Handstatus über dasselbe Menü wie das Meldebild; mit Fahrzeugen ist der
 * Status abgeleitet und nur Anzeige (der Server lehnte das Setzen mit 422 ab). Eine Ablehnung
 * steht an der Zeile.
 */
function StatusZeile({
  einheit: e,
  canEdit,
  onSetHandStatus,
}: {
  einheit: Einheit;
  canEdit: boolean;
  onSetHandStatus: HandStatusHandler;
}) {
  const { token, rollen } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const isHand = canEdit && e.fahrzeug_mitglieder.length === 0;
  const katalogQuery = useQuery({
    queryKey: globalKeys.fahrzeugStatus(),
    queryFn: listeFahrzeugStatus,
    enabled: isHand,
  });
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<unknown>(null);
  const s = einheitStatusAnzeige(e.status);
  const seit = e.status.seit ? (
    <span style={{ ...monoStil(12), color: rollen.gedaempft }}>
      seit {zeitKurz(e.status.seit, konventionen)}
    </span>
  ) : null;

  let status: React.ReactNode;
  if (isHand) {
    const hand = e.status.quelle === 'hand' ? (e.status.status ?? null) : null;
    status = (
      <StatusWahl<number>
        darstellung={
          hand
            ? {
                ...statusKategorie[hand.kategorie],
                label: s.code ? `${s.code} · ${s.wort}` : s.wort,
              }
            : null
        }
        aktuell={hand?.status_id ?? null}
        farbe={hand?.farbe ?? null}
        optionen={handStatusOptionen(katalogQuery.data ?? [])}
        kennung={e.name}
        laeuft={laeuft}
        darfSchreiben
        onWaehlen={(wert) => {
          if (laeuft) return;
          setLaeuft(true);
          setFehler(null);
          onSetHandStatus(wert === KEIN_HANDSTATUS ? null : wert)
            .catch((err: unknown) => setFehler(err))
            .finally(() => setLaeuft(false));
        }}
      />
    );
  } else {
    status = <StatusChip ton={s.ton} code={s.code ?? undefined} wort={s.wort} trenner />;
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: token.marginXXS }}>
      <span
        style={{
          display: 'inline-flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: token.marginXS,
        }}
      >
        {status}
        {seit}
      </span>
      {s.verteilung && (
        <span style={{ ...monoStil(11), color: rollen.gedaempft }}>{s.verteilung}</span>
      )}
      {fehler != null && <ZeilenFehler fehler={fehler} fallback="Status nicht gesetzt" />}
    </span>
  );
}
