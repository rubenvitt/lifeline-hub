import { useRef, useState } from 'react';
import { Input, TreeSelect } from 'antd';
import { ApiError } from '../../api/client';
import type { AbschnittPatch } from '../../api/einsatzabschnitte';
import { leerZuNull } from '../../api/patchTriState';
import type { AbschnittLagezustand, Einsatzabschnitt } from '../../api/types';
import StaerkeAnzeige from '../../anzeige/StaerkeAnzeige';
import { InlineAngabe } from '../../components/InlineAngabe';
import {
  Datenfeld,
  Datenraster,
  Segmentleiste,
  monoStil,
  useRollen,
  type SegmentOption,
} from '../../components/instrument';
import {
  KOMMUNIKATIONSMITTEL_OPTIONEN,
  kommunikationsmittelLabel,
  mitBetriebsart,
  teileSprechgruppen,
} from '../../components/kommunikationsmittel';
import { Select } from '../../components/Select';
import { ZeilenFehler } from '../../components/SpeicherHinweis';
import SprechgruppenPicker from '../../components/SprechgruppenPicker';
import StatusTag from '../../components/StatusTag';
import { abschnittLagezustand, rollenFarbe } from '../../theme/statusFarben';
import { nachfahrenInkl, type AbschnittStaerken } from './abschnittStaerke';
import { findKurzbezeichnungKonflikt, kurzbezeichnungVergeben } from './kurzbezeichnung';

/**
 * Speichert EINE Angabe des Abschnitts (LFH-1208): `etikett` nennt sie in der Erfolgsmeldung, der
 * Patch trägt genau einen Schlüssel. Erfüllt erst, wenn der neue Stand im Cache steht; lehnt bei
 * Ablehnung ab, dann zeigt die Zeile den Grund.
 */
export type AbschnittPatchHandler = (etikett: string, patch: AbschnittPatch) => Promise<unknown>;

interface AbschnittDetailProps {
  abschnitt: Einsatzabschnitt;
  /** Alle Abschnitte des Einsatzes: Über-Abschnitt-Auswahl und Kurzbezeichnungs-Prüfung. */
  abschnitte: Einsatzabschnitt[];
  /** Disponierte Personen für den Abschnittsleiter. */
  personal: readonly { id: number; name: string }[];
  einsatzId: number;
  staerken: AbschnittStaerken;
  darfSchreiben: boolean;
  onPatch: AbschnittPatchHandler;
}

/** Leer ist ein Text, der nach dem Trimmen nichts übrig lässt — wie `leerZuNull` beim Senden. */
const leererText = (w: string) => w.trim() === '';
const gleicherText = (a: string, b: string) => a.trim() === b.trim();

function gleicheIds(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const menge = new Set(a);
  return b.every((id) => menge.has(id));
}

/**
 * Das Detail eines Einsatzabschnitts zum Lesen UND Bearbeiten (LFH-1208, Spec
 * `einsatzabschnitt-bearbeitung`): jede Angabe an ihrem Wert, ein Speichern schickt genau ein Feld.
 * Kein Langformular — es überschrieb mit dem Stand vom Öffnen still, was ein anderer Arbeitsplatz
 * inzwischen geändert hatte.
 *
 * Bewusst ein eigenes Bauteil neben `AbschnittDaten` (design.md D1): Vorschau und
 * Funktionsansicht lesen nur und sollen weder Personal noch Mutationen kennen.
 *
 * Alle Angaben nehmen `InlineAngabe`, auch die optionalen Freitexte: `BemerkungZelle` ist für
 * Listen gebaut und speichert beim Verlassen; hier gilt wie auf den Einsatzdaten EIN Vertrag
 * (Speichern/Abbrechen, Fehler an der Zeile).
 */
export default function AbschnittDetail({
  abschnitt: a,
  abschnitte,
  personal,
  einsatzId,
  staerken,
  darfSchreiben,
  onPatch,
}: AbschnittDetailProps) {
  const text = (
    etikett: string,
    feld: 'abschnittsauftrag' | 'erreichbarkeit' | 'bemerkung',
    mehrzeilig: boolean,
  ) => (
    <InlineAngabe<string>
      etikett={etikett}
      wert={a[feld] ?? ''}
      anzeige={<span style={{ whiteSpace: 'pre-wrap' }}>{a[feld]}</span>}
      leer={leererText}
      gleich={gleicherText}
      darfSchreiben={darfSchreiben}
      mehrzeilig={mehrzeilig}
      onSpeichern={(w) => onPatch(etikett, { [feld]: leerZuNull(w) })}
      eingabe={({ feld: f, value, onChange }) =>
        mehrzeilig ? (
          <Input.TextArea
            {...f}
            autoSize={{ minRows: 2 }}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <Input {...f} value={value} onChange={(e) => onChange(e.target.value)} />
        )
      }
    />
  );

  // Ein Abschnitt kann nicht unter sich selbst oder einen eigenen Unterabschnitt rücken.
  const verboten = nachfahrenInkl(abschnitte, a.id);
  const ueberOptionen = abschnitte
    .filter((x) => !verboten.has(x.id))
    .map((x) => ({ value: x.id, title: x.name }));
  const ueberName = abschnitte.find((x) => x.id === a.ueber_abschnitt_id)?.name ?? null;

  const { tmo, dmo } = teileSprechgruppen(a.sprechgruppen);
  const sprechgruppenText = [
    tmo.length > 0 ? mitBetriebsart('TMO', tmo.map((s) => s.bezeichnung).join(', ')) : null,
    dmo.length > 0 ? mitBetriebsart('DMO', dmo.map((s) => s.bezeichnung).join(', ')) : null,
  ]
    .filter((t): t is string => t != null)
    .join(' · ');

  return (
    <Datenraster spalten={2} beschriftung="Abschnittsdaten">
      <Datenfeld label="Name">
        <InlineAngabe<string>
          etikett="Name"
          wert={a.name}
          anzeige={a.name}
          leer={leererText}
          gleich={gleicherText}
          darfSchreiben={darfSchreiben}
          pflicht
          onSpeichern={(w) => onPatch('Name', { name: w.trim() })}
          eingabe={({ feld, value, onChange }) => (
            <Input {...feld} value={value} onChange={(e) => onChange(e.target.value)} />
          )}
        />
      </Datenfeld>
      <Datenfeld label="Kurzbezeichnung">
        <InlineAngabe<string>
          etikett="Kurzbezeichnung"
          wert={a.kurzbezeichnung ?? ''}
          anzeige={<span style={monoStil(13)}>{a.kurzbezeichnung}</span>}
          leer={leererText}
          gleich={gleicherText}
          darfSchreiben={darfSchreiben}
          onSpeichern={(w) => {
            const belegt = findKurzbezeichnungKonflikt(abschnitte, w, a.id);
            // Dieselbe Ablehnung, die der Index des Servers mit 409 gäbe — nur ohne Anfrage.
            if (belegt) return Promise.reject(new ApiError(409, kurzbezeichnungVergeben(belegt)));
            return onPatch('Kurzbezeichnung', { kurzbezeichnung: leerZuNull(w) });
          }}
          eingabe={({ feld, value, onChange }) => (
            <Input
              {...feld}
              maxLength={20}
              placeholder="z. B. EA-N"
              value={value}
              onChange={(e) => onChange(e.target.value)}
            />
          )}
        />
      </Datenfeld>
      <Datenfeld label="Über-Abschnitt">
        <InlineAngabe<number | null>
          etikett="Über-Abschnitt"
          wert={a.ueber_abschnitt_id ?? null}
          anzeige={ueberName}
          leer={(w) => w == null}
          darfSchreiben={darfSchreiben}
          onSpeichern={(w) => onPatch('Über-Abschnitt', { ueber_abschnitt_id: w })}
          eingabe={({ feld, popup, value, onChange }) => (
            <TreeSelect<number>
              {...feld}
              {...popup}
              allowClear
              treeData={ueberOptionen}
              value={value ?? undefined}
              onChange={(w) => onChange(w ?? null)}
            />
          )}
        />
      </Datenfeld>
      <Datenfeld label="Abschnittsleiter">
        <InlineAngabe<number | null>
          etikett="Abschnittsleiter"
          wert={a.leiter_id ?? null}
          anzeige={a.leiter_name}
          leer={(w) => w == null}
          darfSchreiben={darfSchreiben}
          onSpeichern={(w) => onPatch('Abschnittsleiter', { leiter_id: w })}
          eingabe={({ feld, popup, value, onChange }) => (
            <Select<number>
              {...feld}
              {...popup}
              allowClear
              options={personal.map((p) => ({ value: p.id, label: p.name }))}
              value={value ?? undefined}
              onChange={(w) => onChange(w ?? null)}
            />
          )}
        />
      </Datenfeld>
      <Datenfeld label="Lagezustand" breit>
        <LagezustandWahl
          wert={a.lagezustand ?? null}
          darfSchreiben={darfSchreiben}
          onPatch={onPatch}
        />
      </Datenfeld>
      <Datenfeld label="Abschnittsauftrag" breit>
        {text('Abschnittsauftrag', 'abschnittsauftrag', true)}
      </Datenfeld>
      <Datenfeld label="Sprechgruppen">
        <InlineAngabe<number[]>
          etikett="Sprechgruppen"
          wert={(a.sprechgruppen ?? []).map((s) => s.id)}
          anzeige={<span style={monoStil(13)}>{sprechgruppenText}</span>}
          leer={(ids) => ids.length === 0}
          gleich={gleicheIds}
          darfSchreiben={darfSchreiben}
          onSpeichern={(ids) => onPatch('Sprechgruppen', { sprechgruppe_ids: ids })}
          eingabe={({ feld, popup, value, onChange }) => (
            <SprechgruppenPicker
              einsatzId={einsatzId}
              value={value}
              onChange={onChange}
              auswahl={{ ...feld, ...popup }}
            />
          )}
        />
      </Datenfeld>
      <Datenfeld label="Kommunikationsmittel">
        <InlineAngabe<string | null>
          etikett="Kommunikationsmittel"
          wert={a.kommunikationsmittel ?? null}
          anzeige={kommunikationsmittelLabel(a.kommunikationsmittel)}
          leer={(w) => w == null}
          darfSchreiben={darfSchreiben}
          onSpeichern={(w) => onPatch('Kommunikationsmittel', { kommunikationsmittel: w })}
          eingabe={({ feld, popup, value, onChange }) => (
            <Select<string>
              {...feld}
              {...popup}
              allowClear
              options={KOMMUNIKATIONSMITTEL_OPTIONEN}
              value={value ?? undefined}
              onChange={(w) => onChange(w ?? null)}
            />
          )}
        />
      </Datenfeld>
      <Datenfeld label="Erreichbarkeit / Nummer">
        {text('Erreichbarkeit / Nummer', 'erreichbarkeit', false)}
      </Datenfeld>
      <Datenfeld label="Bemerkung">{text('Bemerkung', 'bemerkung', true)}</Datenfeld>
      <Datenfeld label="Stärke (F/UF/M//Σ)" mono>
        <StaerkeAnzeige wert={staerken.eigene} />
      </Datenfeld>
      <Datenfeld label="Stärke inkl. Unterabschnitte (F/UF/M//Σ)" mono>
        <StaerkeAnzeige wert={staerken.inklUnter} />
      </Datenfeld>
    </Datenraster>
  );
}

/** Wert der Segmentleiste für „nicht beurteilt“ — die Leiste kennt kein `null`. */
const NICHT_BEURTEILT = 'nicht_beurteilt';
type LageWahl = AbschnittLagezustand | typeof NICHT_BEURTEILT;
const STUFEN = ['planmaessig', 'angespannt', 'kritisch'] as const;

/**
 * Lagezustand mit einem Klick (design.md D4): jede Wahl der Segmentleiste speichert sofort, auch
 * mit den Pfeiltasten — der Wechsel IST die Handlung, und der Server schreibt je Wechsel einen
 * ETB-Eintrag. Bis zur Antwort steht die gewählte Stufe; eine Ablehnung springt auf den Serverstand
 * zurück und nennt den Grund an der Zeile. Ein Riegel hält weitere Wahlen an, solange eine läuft:
 * sonst könnte eine ältere Antwort eine jüngere Wahl überholen.
 */
function LagezustandWahl({
  wert,
  darfSchreiben,
  onPatch,
}: {
  wert: AbschnittLagezustand | null;
  darfSchreiben: boolean;
  onPatch: AbschnittPatchHandler;
}) {
  const { token, rollen } = useRollen();
  const [laufend, setLaufend] = useState<LageWahl | null>(null);
  const [fehler, setFehler] = useState<unknown>(null);
  const sendetRef = useRef(false);

  if (!darfSchreiben) {
    // Fehlende Beurteilung als Wort, nicht als leere Zelle (LFH-608).
    return wert ? (
      <StatusTag darstellung={abschnittLagezustand[wert]} darstellungsart="rand" />
    ) : (
      <span style={{ color: rollen.gedaempft }}>nicht beurteilt</span>
    );
  }

  const optionen: SegmentOption<LageWahl>[] = [
    { wert: NICHT_BEURTEILT, label: 'nicht beurteilt' },
    ...STUFEN.map((l) => ({
      wert: l,
      label: abschnittLagezustand[l].label,
      punkt: rollenFarbe(abschnittLagezustand[l].rolle, token),
    })),
  ];
  const gespeichert: LageWahl = wert ?? NICHT_BEURTEILT;

  async function waehle(neu: LageWahl) {
    if (sendetRef.current || neu === gespeichert) return;
    sendetRef.current = true;
    setLaufend(neu);
    setFehler(null);
    try {
      await onPatch('Lagezustand', { lagezustand: neu === NICHT_BEURTEILT ? null : neu });
    } catch (e) {
      setFehler(e);
    } finally {
      sendetRef.current = false;
      setLaufend(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginXS }}>
      <Segmentleiste<LageWahl>
        beschriftung="Lagezustand"
        optionen={optionen}
        wert={laufend ?? gespeichert}
        onWechsel={(w) => void waehle(w)}
      />
      <ZeilenFehler fehler={fehler} />
    </div>
  );
}
