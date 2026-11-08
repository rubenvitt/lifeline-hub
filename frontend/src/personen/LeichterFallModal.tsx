import { Form, Input, InputNumber } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { ladeVersorgendeEinheiten, type PersonAnlegenEingabe } from '../api/einsatzPerson';
import { PERSON_ANGABE_MAX, PERSON_NAME_MAX } from '../api/eingabegrenzen';
import { einsatzKeys } from '../api/queryKeys';
import type {
  MassnahmeArt,
  PersonAnlass,
  Uhs,
  UhsZielAuswahl,
  VersorgendeEinheitAuswahl,
} from '../api/types';
import { EinsatzOrtsfeld } from '../anzeige/EinsatzOrtsfeld';
import type { OrtsfeldWert } from '../anzeige/Ortsfeld';
import { ortFelder, ortRegeln } from '../anzeige/ortsfeldFormular';
import { ErfassungsModal, type Nebenaktion, type Speicherung } from '../components/Erfassung';
import FormularEingehaengt from '../components/FormularEingehaengt';
import { Select } from '../components/Select';
import { useRollen } from '../components/instrument';
import { useFormularEingehaengt } from '../components/useFormularEingehaengt';
import {
  liesErfassungsSitzungswert,
  schreibeErfassungsSitzungswert,
} from '../components/erfassungsSitzung';
import { zeichenGrenze, zeichenRegel } from '../components/zeichenGrenze';
import StandortFeld from '../geraet/StandortFeld';
import { useOhneVerbindung } from '../offline/verbindung';
import type { Eigenposition } from '../pages/lagekarte/useEigenposition';
import AnlassWahl from './AnlassWahl';
import FlaechenWahl, { FlaechenMehrfachWahl } from './FlaechenWahl';
import { fundortAusText } from './AufnahmeFelder';
import { LEICHTE_MASSNAHMEN, LEICHTE_MASSNAHMEN_MAX, MASSNAHME_WORT } from './personMeta';
import { einheitText } from './VersorgtVon';

/** Titel und Primärknopf des Dialogs (LLH-1572, design.md D2). */
export const LEICHTER_FALL_TITEL = 'Versorgt und entlassen';

/** Titel am Einheitengerät (LLH-1580): ein Kontakt hat dort drei Ausgänge. */
export const KONTAKT_TITEL = 'Kontakt';

/** Die Nebenausgänge am Einheitengerät (LLH-1580, Entwurf K1–K3); der Primärknopf entlässt. */
export const KONTAKT_AUSGANG = { zurUhs: 'zur-uhs', rtw: 'rtw' } as const;
type KontaktAusgang = (typeof KONTAKT_AUSGANG)[keyof typeof KONTAKT_AUSGANG];

const MASSNAHMEN_OPTIONEN = LEICHTE_MASSNAHMEN.map((m) => ({ wert: m, label: MASSNAHME_WORT[m] }));

/** „Versorgt von“ als ein Schlüssel: `uhs:3` oder `einheit:7`. */
type VersorgtVonSchluessel = `uhs:${number}` | `einheit:${number}`;

export interface LeichterFallWerte {
  anlass?: PersonAnlass | null;
  massnahmen?: MassnahmeArt[];
  versorgt_von?: VersorgtVonSchluessel | null;
  antreff_ort?: OrtsfeldWert;
  name?: string;
  alter_geschaetzt?: number | null;
  /** Nur am Einheitengerät: die Position des Handys, beim Öffnen einmal ermittelt (K6). */
  standort?: Eigenposition | null;
  /** Nur am Einheitengerät mit mehr als einer aktiven UHS: das Ziel „Zur UHS“ (K3). */
  ziel_uhs?: string | null;
}

/**
 * Die feste Stelle eines Geräts (design.md D2/D4): die eigene UHS, die Wahl entfällt. Am
 * Einheitengerät (LLH-1580) die eigene Einheit mit den aktiven UHS als Ziel „Zur UHS“.
 */
export type LeichterFallStelle =
  | {
      art: 'uhs';
      uhs: Pick<Uhs, 'id' | 'bezeichnung' | 'lat' | 'lon'>;
    }
  | {
      art: 'einheit';
      einheit: Pick<VersorgendeEinheitAuswahl, 'id' | 'name' | 'abschnitt_name'>;
      uhsZiele: readonly UhsZielAuswahl[];
    };

/** Fundort einer festen Stelle (design.md D4). */
function fundortDerStelle(stelle: LeichterFallStelle): OrtsfeldWert {
  return stelle.art === 'uhs' ? fundortAusUhs(stelle.uhs) : fundortAusEinheit(stelle.einheit);
}

/** Fundort aus der UHS: ihre Bezeichnung, ihre Koordinate, wenn sie eine hat (design.md D4). */
export function fundortAusUhs(uhs: Pick<Uhs, 'bezeichnung' | 'lat' | 'lon'>): OrtsfeldWert {
  return {
    text: uhs.bezeichnung,
    koordinate: uhs.lat != null && uhs.lon != null ? { lat: uhs.lat, lon: uhs.lon } : null,
  };
}

/** Fundort aus der Einheit: ihr Abschnitt, ohne Abschnitt ihr Name (design.md D4). */
export function fundortAusEinheit(
  einheit: Pick<VersorgendeEinheitAuswahl, 'name' | 'abschnitt_name'>,
): OrtsfeldWert {
  return fundortAusText(einheit.abschnitt_name ?? einheit.name);
}

function liesSchluessel(
  roh: string | null | undefined,
): { art: 'uhs' | 'einheit'; id: number } | null {
  const m = /^(uhs|einheit):(\d+)$/.exec(roh ?? '');
  return m ? { art: m[1] as 'uhs' | 'einheit', id: Number(m[2]) } : null;
}

/**
 * Formularwerte → Anlage des leichten Falls (design.md D1/D5): Status `betroffen`, ohne Sichtung,
 * mit `entlassen`; „Versorgt von“ wird zu `uhs_id` oder `versorgende_einheit_id`. Rein.
 */
export function leichterFallZuEingabe(
  werte: LeichterFallWerte,
  stelle: LeichterFallStelle | null,
  ausgang?: string,
): PersonAnlegenEingabe {
  if (stelle?.art === 'einheit') return kontaktZuEingabe(werte, stelle, ausgang);
  const ort = ortFelder(werte.antreff_ort);
  const name = werte.name?.trim();
  const bezug = stelle
    ? { art: 'uhs' as const, id: stelle.uhs.id }
    : liesSchluessel(werte.versorgt_von);
  return {
    status: 'betroffen',
    entlassen: true,
    ...(werte.anlass ? { anlass: werte.anlass } : {}),
    ...(werte.massnahmen && werte.massnahmen.length > 0 ? { massnahmen: werte.massnahmen } : {}),
    ...(name ? { name } : {}),
    ...(werte.alter_geschaetzt != null ? { alter_geschaetzt: werte.alter_geschaetzt } : {}),
    ...(ort.text != null ? { antreff_ort: ort.text } : {}),
    ...(ort.lat != null && ort.lon != null ? { antreff_lat: ort.lat, antreff_lon: ort.lon } : {}),
    ...(bezug?.art === 'uhs' ? { uhs_id: bezug.id } : {}),
    ...(bezug?.art === 'einheit' ? { versorgende_einheit_id: bezug.id } : {}),
  };
}

/**
 * Formularwerte → Kontakt am Einheitengerät (LLH-1580, Entwurf K1–K6): ohne Name und Alter, die
 * eigene Einheit als versorgende, Koordinate aus dem Standort des Handys. Ohne `ausgang` (der
 * Primärknopf) entlassen, `zur-uhs` in den Eingang der gewählten (oder einzigen) UHS, `rtw` mit
 * Sofortmeldung. Rein.
 */
export function kontaktZuEingabe(
  werte: LeichterFallWerte,
  stelle: Extract<LeichterFallStelle, { art: 'einheit' }>,
  ausgang?: string,
): PersonAnlegenEingabe {
  const ort = ortFelder(werte.antreff_ort);
  const zielUhs =
    werte.ziel_uhs != null ? Number(werte.ziel_uhs) : (stelle.uhsZiele[0]?.id ?? null);
  const ausgangFelder =
    ausgang === KONTAKT_AUSGANG.rtw
      ? { rtw: true }
      : ausgang === KONTAKT_AUSGANG.zurUhs && zielUhs != null
        ? { uhs_id: zielUhs }
        : { entlassen: true };
  return {
    status: 'betroffen',
    versorgende_einheit_id: stelle.einheit.id,
    ...ausgangFelder,
    ...(werte.anlass ? { anlass: werte.anlass } : {}),
    ...(werte.massnahmen && werte.massnahmen.length > 0 ? { massnahmen: werte.massnahmen } : {}),
    ...(ort.text != null ? { antreff_ort: ort.text } : {}),
    ...(werte.standort ? { antreff_lat: werte.standort.lat, antreff_lon: werte.standort.lon } : {}),
  };
}

const MASKE = 'leichter-fall';

/** Der getippte Text eines Ortsfelds; ein leeres Feld trägt `{ text: '' }` oder nichts. */
function ortsText(wert: OrtsfeldWert | undefined): string {
  return wert?.text?.trim() ?? '';
}

interface Props {
  einsatzId: number;
  offen: boolean;
  /** Feste Stelle des Geräts; ohne sie wählt man „Versorgt von“ aus UHS und Einheiten. */
  stelle?: LeichterFallStelle | null;
  /** Die UHS des Einsatzes für „Versorgt von“; nur aktive stehen zur Wahl. */
  uhsListe?: readonly Uhs[];
  laeuft: boolean;
  /** Anlegen. **Muss bei Ablehnung ablehnen** (`mutateAsync`). */
  onErfassen: (daten: PersonAnlegenEingabe) => Promise<unknown>;
  onFertig: () => void;
  onAbbrechen: () => void;
  speicherung?: Speicherung;
}

/**
 * Dialog „Versorgt und entlassen“ (LLH-1572, Change `o1igsr0s-leichte-faelle`, design.md D2–D5):
 * ein leichter Fall in höchstens drei Griffen — öffnen, Anlass, „Entlassen“. Anlass ist Pflicht,
 * bis zu drei Maßnahmen als Flächen, Name und Alter optional. „Versorgt von“ belegt den Fundort
 * vor und bleibt für den nächsten Fall stehen (Sitzungswert je Einsatz, Serie mit „Werte
 * behalten“); am UHS-Gerät steht die eigene UHS fest. Gesendet wird über die offlinefähige
 * Anlage des Aufrufers: ein POST mit `entlassen`, ohne Netz vorgemerkt.
 */
export default function LeichterFallModal({
  einsatzId,
  offen,
  stelle = null,
  uhsListe = [],
  laeuft,
  onErfassen,
  onFertig,
  onAbbrechen,
  speicherung,
}: Props) {
  const [form] = Form.useForm<LeichterFallWerte>();
  const { token } = useRollen();
  const formular = useFormularEingehaengt();
  const geladen = useRef<string | null>(null);
  const mitWahl = stelle == null;
  const einheitStelle = stelle?.art === 'einheit' ? stelle : null;
  const ohneVerbindung = useOhneVerbindung();

  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.personenEinheiten(einsatzId),
    queryFn: () => ladeVersorgendeEinheiten(einsatzId),
    enabled: offen && mitWahl,
  });
  const einheiten = useMemo(() => einheitenQuery.data ?? [], [einheitenQuery.data]);
  const aktiveUhs = useMemo(() => uhsListe.filter((u) => u.status === 'aktiv'), [uhsListe]);
  const versorgtVonOptionen = useMemo(
    () =>
      [
        aktiveUhs.length > 0 && {
          label: 'Unfallhilfsstellen',
          options: aktiveUhs.map((u) => ({ value: `uhs:${u.id}`, label: u.bezeichnung })),
        },
        einheiten.length > 0 && {
          label: 'Einheiten',
          options: einheiten.map((e) => ({
            value: `einheit:${e.id}`,
            label: einheitText(e.name, e.abschnitt_name) ?? e.name,
          })),
        },
      ].filter(Boolean) as { label: string; options: { value: string; label: string }[] }[],
    [aktiveUhs, einheiten],
  );

  const fundortVon = useCallback(
    (schluessel: string | null | undefined): OrtsfeldWert | undefined => {
      const bezug = liesSchluessel(schluessel);
      if (bezug?.art === 'uhs') {
        const uhs = aktiveUhs.find((u) => u.id === bezug.id);
        return uhs ? fundortAusUhs(uhs) : undefined;
      }
      if (bezug?.art === 'einheit') {
        const einheit = einheiten.find((e) => e.id === bezug.id);
        return einheit ? fundortAusEinheit(einheit) : undefined;
      }
      return undefined;
    },
    [aktiveUhs, einheiten],
  );

  // Beim Öffnen: die feste UHS bzw. die letzte Wahl „Versorgt von“ und ihr Fundort.
  useEffect(() => {
    if (!offen) {
      geladen.current = null;
      return;
    }
    if (!formular.da) return;
    const schluessel = stelle
      ? null
      : (liesErfassungsSitzungswert(einsatzId, MASKE, 'versorgt_von') ?? null);
    const kennung = `${einsatzId}:${schluessel ?? '-'}:${einheiten.length}:${aktiveUhs.length}`;
    if (geladen.current === kennung) return;
    if (stelle) {
      geladen.current = kennung;
      if (!ortsText(form.getFieldValue('antreff_ort')))
        form.setFieldValue('antreff_ort', fundortDerStelle(stelle));
      // Die letzte Wahl „Zur UHS“ bleibt stehen, solange die UHS aktiv ist (K3).
      if (stelle.art === 'einheit' && stelle.uhsZiele.length > 1) {
        const letzte = liesErfassungsSitzungswert(einsatzId, MASKE, 'ziel_uhs');
        const ziel = stelle.uhsZiele.find((u) => String(u.id) === letzte) ?? stelle.uhsZiele[0];
        form.setFieldValue('ziel_uhs', String(ziel.id));
      }
      return;
    }
    if (schluessel == null || form.getFieldValue('versorgt_von') != null) {
      geladen.current = kennung;
      return;
    }
    const ort = fundortVon(schluessel);
    // Erst setzen, wenn die Wahl geladen ist: eine aufgelöste Einheit oder geschlossene UHS
    // bleibt draußen.
    if (ort === undefined) return;
    geladen.current = kennung;
    // Ein schon getippter Fundort bleibt stehen, die Wahl „Versorgt von“ kommt trotzdem.
    form.setFieldsValue({
      versorgt_von: schluessel as VersorgtVonSchluessel,
      ...(ortsText(form.getFieldValue('antreff_ort')) ? {} : { antreff_ort: ort }),
    });
  }, [offen, formular.da, einsatzId, stelle, einheiten.length, aktiveUhs.length, fundortVon, form]);

  // Am Einheitengerät (LLH-1580): „Entlassen“ ist der Primärknopf, daneben „Zur UHS“ (nur mit
  // aktiver UHS) und „RTW nötig“. Ohne Netz geht der RTW über Funk (K2), die anderen werden
  // vorgemerkt.
  const nebenaktionen: Nebenaktion[] | undefined = einheitStelle
    ? [
        ...(einheitStelle.uhsZiele.length > 0
          ? [{ schluessel: KONTAKT_AUSGANG.zurUhs satisfies KontaktAusgang, text: 'Zur UHS' }]
          : []),
        {
          schluessel: KONTAKT_AUSGANG.rtw satisfies KontaktAusgang,
          text: ohneVerbindung ? 'RTW über Funk' : 'RTW nötig',
          danger: true,
          gesperrt: ohneVerbindung,
        },
      ]
    : undefined;

  return (
    <ErfassungsModal<LeichterFallWerte>
      offen={offen}
      titel={einheitStelle ? KONTAKT_TITEL : LEICHTER_FALL_TITEL}
      form={form}
      erfassenText="Entlassen"
      nebenaktionen={nebenaktionen}
      onErfassen={(werte, ausgang) => onErfassen(leichterFallZuEingabe(werte, stelle, ausgang))}
      onErfasst={(werte) => {
        if (mitWahl && werte.versorgt_von) {
          schreibeErfassungsSitzungswert(einsatzId, MASKE, 'versorgt_von', werte.versorgt_von);
        }
        if (einheitStelle && werte.ziel_uhs) {
          schreibeErfassungsSitzungswert(einsatzId, MASKE, 'ziel_uhs', werte.ziel_uhs);
        }
      }}
      onFertig={onFertig}
      onAbbrechen={onAbbrechen}
      laeuft={laeuft}
      speicherung={speicherung}
      speicherFehlerTitel="Person nicht erfasst"
      // Am Handy schließt jeder Kontakt den Dialog: die Liste darunter zeigt ihn gleich.
      serie={!einheitStelle}
      uebernahme={
        einheitStelle ? undefined : mitWahl ? ['versorgt_von', 'antreff_ort'] : ['antreff_ort']
      }
    >
      <FormularEingehaengt onWechsel={formular.melde} />
      <Form.Item label="Anlass" name="anlass" rules={[{ required: true, message: 'Anlass fehlt' }]}>
        <AnlassWahl />
      </Form.Item>
      <Form.Item label="Maßnahmen" name="massnahmen">
        <FlaechenMehrfachWahl<MassnahmeArt>
          aria-label="Maßnahmen"
          optionen={MASSNAHMEN_OPTIONEN}
          max={LEICHTE_MASSNAHMEN_MAX}
        />
      </Form.Item>
      {einheitStelle && einheitStelle.uhsZiele.length > 1 && (
        <Form.Item label="UHS" name="ziel_uhs">
          <FlaechenWahl<string>
            aria-label="UHS"
            optionen={einheitStelle.uhsZiele.map((u) => ({
              wert: String(u.id),
              label: u.bezeichnung,
            }))}
          />
        </Form.Item>
      )}
      {mitWahl && (
        <Form.Item label="Versorgt von" name="versorgt_von">
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            loading={einheitenQuery.isLoading}
            options={versorgtVonOptionen}
            onChange={(wert: string | undefined) => {
              const ort = fundortVon(wert);
              if (ort) form.setFieldValue('antreff_ort', ort);
            }}
          />
        </Form.Item>
      )}
      {mitWahl ? (
        <Form.Item
          label="Fundort"
          name="antreff_ort"
          rules={ortRegeln(PERSON_ANGABE_MAX, 'Fundort')}
        >
          <EinsatzOrtsfeld
            einsatzId={einsatzId}
            etikett="Fundort"
            count={zeichenGrenze(PERSON_ANGABE_MAX)}
          />
        </Form.Item>
      ) : (
        <Form.Item
          label="Fundort"
          name="antreff_ort"
          rules={ortRegeln(PERSON_ANGABE_MAX, 'Fundort')}
          getValueProps={(w?: OrtsfeldWert) => ({ value: w?.text ?? '' })}
          normalize={(text: string) => fundortAusText(text)}
        >
          <Input count={zeichenGrenze(PERSON_ANGABE_MAX)} />
        </Form.Item>
      )}
      {einheitStelle && (
        <Form.Item label="Standort" name="standort">
          <StandortFeld sofort />
        </Form.Item>
      )}
      {/* Am Handy ohne Namen und Alter (F6, K5): sie ergänzen UHS oder Einsatzleitung. */}
      {!einheitStelle && (
        <div style={{ display: 'flex', gap: token.margin, flexWrap: 'wrap' }}>
          <Form.Item
            label="Name"
            name="name"
            rules={[zeichenRegel(PERSON_NAME_MAX, 'Name')]}
            style={{ flex: '1 1 200px' }}
          >
            <Input count={zeichenGrenze(PERSON_NAME_MAX)} />
          </Form.Item>
          <Form.Item label="Alter" name="alter_geschaetzt">
            <InputNumber min={0} max={120} style={{ width: 120 }} />
          </Form.Item>
        </div>
      )}
    </ErfassungsModal>
  );
}
