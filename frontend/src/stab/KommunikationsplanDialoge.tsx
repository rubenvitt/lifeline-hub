import { AutoComplete, Form, Input, Modal } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { ladeFuehrungsfunktionen } from '../api/fuehrungsfunktionen';
import { globalKeys } from '../api/queryKeys';
import type {
  Fuehrungsfunktion,
  KommunikationsStelle,
  NeueKommunikationsStelle,
  NeueVerbindung,
  Stellenart,
  VerbindungPatch,
  Verbindungsmittel,
} from '../api/types';
import { ErfassungsModal } from '../components/Erfassung';
import { Select } from '../components/Select';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { teilwortSuche } from '../components/teilwortSuche';
import { optionsLabel } from '../fuehrung/funktionsOptionenKern';
import { externeStellenOptions, useExterneStellen } from '../stammdaten/externeStellenVorschlaege';
import {
  EXTERNE_STELLENARTEN,
  STELLENART_LABEL,
  VERBINDUNGSMITTEL_OPTIONEN,
  katalogStellenFuer,
  verbindungAusRufnummer,
  type VerbindungsAnzeige,
} from './kommunikationsplan';

/**
 * Masken des Kommunikationsplans (LFH-848, design.md D5). Jede Maske wird nur montiert, solange
 * sie offen ist (frischer Formularspeicher je Öffnung, wie `BesetzungModal`). Gespeichert wird
 * über `mutateAsync` des Aufrufers: lehnt der Server ab, bleiben die Felder stehen und der Fehler
 * steht IN der Maske.
 */

const TEXT_MAX = 200;
const LAENGE = { max: TEXT_MAX, message: `Höchstens ${TEXT_MAX} Zeichen` };
const KEINE_BESETZUNG = new Map();

const STELLENART_OPTIONEN = (['funktion', ...EXTERNE_STELLENARTEN] as Stellenart[]).map((a) => ({
  value: a,
  label: STELLENART_LABEL[a],
}));

interface StelleFormWerte {
  stellenart: Stellenart;
  funktion?: Fuehrungsfunktion;
  bezeichnung?: string;
  rufnummer?: string;
}

/** Vorbelegung der Maske, etwa mit der zuständigen Leitstelle aus der Lücke (LLH-1165). */
export type StelleVorbelegung = Pick<StelleFormWerte, 'stellenart' | 'bezeichnung' | 'rufnummer'>;

/**
 * „Stelle hinzufügen“: Art, bei „Führungsfunktion“ die Funktion aus dem Katalog (schon vergebene
 * ausgegraut), die Bezeichnung nur, wo sie Pflicht ist (extern, Führungshilfspersonal,
 * Fachberater). Ausgeblendet heißt: nicht leer abgeschickt.
 *
 * Bei einer externen Stelle schlägt die Bezeichnung die aktiven Stellen des Katalogs „Externe
 * Stellen“ vor, die als diese Art in den Plan kommen (LLH-1165, `STELLENART_AUS_KATALOG`); Freitext
 * bleibt. Die Wahl übernimmt die Rufnummer ins Feld „Rufnummer“, solange dort nichts von Hand
 * steht. Gespeichert wird nur Text; die Rufnummer wird die erste Verbindung der Stelle.
 */
export function StelleAnlegenModal({
  stellen,
  vorbelegung,
  laeuft,
  fehler,
  onAnlegen,
  onSchliessen,
}: {
  stellen: readonly KommunikationsStelle[];
  vorbelegung?: StelleVorbelegung;
  laeuft: boolean;
  fehler: unknown;
  onAnlegen: (body: NeueKommunikationsStelle, verbindung?: NeueVerbindung) => Promise<unknown>;
  onSchliessen: () => void;
}) {
  const [form] = Form.useForm<StelleFormWerte>();
  const art = Form.useWatch('stellenart', form) ?? vorbelegung?.stellenart ?? 'funktion';
  const gewaehlt = Form.useWatch('funktion', form);
  const katalog = useQuery({
    queryKey: globalKeys.fuehrungsfunktionen(),
    queryFn: ladeFuehrungsfunktionen,
    staleTime: 5 * 60_000,
  });
  // Nur bei einer externen Art gebraucht; die Abfrage teilt den Cache mit den anderen Abnehmern.
  const externeStellen = useExterneStellen().data;
  const passende = useMemo(
    () => (art === 'funktion' ? [] : katalogStellenFuer(art, externeStellen ?? [])),
    [art, externeStellen],
  );
  const stellenOptionen = useMemo(() => externeStellenOptions(passende), [passende]);
  // Vergeben ist eine Funktion ohne Bezeichnungspflicht, die schon im Plan steht; FHP und
  // Fachberater dürfen mehrfach stehen (je Bezeichnung, der Server prüft die Dublette).
  const funktionsOptionen = useMemo(() => {
    const vergeben = new Set(
      stellen.filter((s) => s.stellenart === 'funktion').map((s) => s.funktion),
    );
    return (katalog.data ?? []).map((e) => ({
      value: e.funktion,
      label: optionsLabel(e, KEINE_BESETZUNG),
      disabled: !e.bezeichnung_pflicht && vergeben.has(e.funktion),
    }));
  }, [katalog.data, stellen]);
  const pflicht = katalog.data?.find((e) => e.funktion === gewaehlt)?.bezeichnung_pflicht ?? false;
  const extern = art !== 'funktion';
  const mitBezeichnung = extern || pflicht;

  return (
    <ErfassungsModal<StelleFormWerte>
      offen
      titel="Stelle hinzufügen"
      form={form}
      initialValues={vorbelegung ?? { stellenart: 'funktion' }}
      erfassenText="Anlegen"
      laeuft={laeuft}
      onErfassen={async (w) => {
        const bezeichnung = w.bezeichnung?.trim();
        if (w.stellenart === 'funktion') {
          await onAnlegen({
            stellenart: 'funktion',
            funktion: w.funktion,
            ...(pflicht && bezeichnung ? { bezeichnung } : {}),
          });
          return;
        }
        await onAnlegen(
          { stellenart: w.stellenart, ...(bezeichnung ? { bezeichnung } : {}) },
          verbindungAusRufnummer(w.rufnummer),
        );
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item label="Art" name="stellenart" rules={[{ required: true }]}>
        <Select options={STELLENART_OPTIONEN} />
      </Form.Item>
      {art === 'funktion' && (
        <Form.Item
          label="Funktion"
          name="funktion"
          rules={[{ required: true, message: 'Funktion wählen' }]}
        >
          <Select options={funktionsOptionen} loading={katalog.isLoading} />
        </Form.Item>
      )}
      {mitBezeichnung && (
        <Form.Item
          label="Bezeichnung"
          name="bezeichnung"
          rules={[{ required: true, whitespace: true, message: 'Bezeichnung angeben' }, LAENGE]}
        >
          {extern ? (
            <AutoComplete
              options={stellenOptionen}
              showSearch={teilwortSuche}
              placeholder="z. B. ILS Nord"
              onSelect={(bezeichnung: string) => {
                if (form.isFieldTouched('rufnummer')) return;
                const stelle = passende.find((s) => s.bezeichnung === bezeichnung);
                form.setFieldValue('rufnummer', stelle?.rufnummer ?? '');
              }}
            />
          ) : (
            <Input placeholder="z. B. THW" />
          )}
        </Form.Item>
      )}
      {extern && (
        <Form.Item label="Rufnummer" name="rufnummer" rules={[LAENGE]}>
          <Input placeholder="z. B. 0421 123456" />
        </Form.Item>
      )}
      <SpeicherFehler fehler={fehler} />
    </ErfassungsModal>
  );
}

/** „Bezeichnung ändern“ einer externen Stelle bzw. von Führungshilfspersonal und Fachberater. */
export function BezeichnungModal({
  stelle,
  kennung,
  laeuft,
  fehler,
  onSpeichern,
  onSchliessen,
}: {
  stelle: KommunikationsStelle;
  kennung: string;
  laeuft: boolean;
  fehler: unknown;
  onSpeichern: (bezeichnung: string) => Promise<unknown>;
  onSchliessen: () => void;
}) {
  const [form] = Form.useForm<{ bezeichnung: string }>();
  return (
    <ErfassungsModal<{ bezeichnung: string }>
      offen
      titel={`Bezeichnung · ${kennung}`}
      form={form}
      initialValues={{ bezeichnung: stelle.bezeichnung ?? '' }}
      erfassenText="Speichern"
      laeuft={laeuft}
      onErfassen={async (w) => {
        const neu = w.bezeichnung.trim();
        if (neu !== (stelle.bezeichnung ?? '')) await onSpeichern(neu);
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item
        label="Bezeichnung"
        name="bezeichnung"
        rules={[{ required: true, whitespace: true, message: 'Bezeichnung angeben' }, LAENGE]}
      >
        <Input />
      </Form.Item>
      <SpeicherFehler fehler={fehler} />
    </ErfassungsModal>
  );
}

interface VerbindungFormWerte {
  mittel: Verbindungsmittel;
  wert: string;
  hinweis?: string;
}

/**
 * Verbindung anlegen (Serienmodus: eine Stelle bekommt meist mehrere) oder bearbeiten
 * (vorbelegt, schickt nur Geändertes; ein geleerter Hinweis wird entfernt).
 */
export function VerbindungModal({
  kennung,
  basis,
  laeuft,
  fehler,
  onAnlegen,
  onAendern,
  onSchliessen,
}: {
  kennung: string;
  /** Gesetzt = bearbeiten. */
  basis?: VerbindungsAnzeige;
  laeuft: boolean;
  fehler: unknown;
  onAnlegen: (body: NeueVerbindung) => Promise<unknown>;
  onAendern: (patch: VerbindungPatch) => Promise<unknown>;
  onSchliessen: () => void;
}) {
  const [form] = Form.useForm<VerbindungFormWerte>();
  return (
    <ErfassungsModal<VerbindungFormWerte>
      offen
      titel={`${basis ? 'Verbindung bearbeiten' : 'Verbindung hinzufügen'} · ${kennung}`}
      form={form}
      initialValues={
        basis?.mittel
          ? { mittel: basis.mittel, wert: basis.wert, hinweis: basis.hinweis ?? '' }
          : undefined
      }
      erfassenText="Speichern"
      serie={basis == null}
      uebernahme={basis == null ? ['mittel'] : undefined}
      laeuft={laeuft}
      onErfassen={async (w) => {
        const wert = w.wert.trim();
        const hinweis = w.hinweis?.trim() ?? '';
        if (basis == null) {
          await onAnlegen({ mittel: w.mittel, wert, ...(hinweis ? { hinweis } : {}) });
          return;
        }
        const patch: VerbindungPatch = {
          ...(w.mittel !== basis.mittel ? { mittel: w.mittel } : {}),
          ...(wert !== basis.wert ? { wert } : {}),
          ...(hinweis !== (basis.hinweis ?? '') ? { hinweis: hinweis || null } : {}),
        };
        if (Object.keys(patch).length > 0) await onAendern(patch);
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item
        label="Mittel"
        name="mittel"
        rules={[{ required: true, message: 'Mittel wählen' }]}
      >
        <Select options={VERBINDUNGSMITTEL_OPTIONEN} />
      </Form.Item>
      <Form.Item
        label="Nummer/Adresse"
        name="wert"
        rules={[
          { required: true, whitespace: true, message: 'Nummer oder Adresse angeben' },
          LAENGE,
        ]}
      >
        <Input placeholder="z. B. 0421 123456" />
      </Form.Item>
      <Form.Item label="Hinweis" name="hinweis" rules={[LAENGE]}>
        <Input placeholder="z. B. Lagedienst, nur tagsüber" />
      </Form.Item>
      <SpeicherFehler fehler={fehler} />
    </ErfassungsModal>
  );
}

/**
 * Rückfrage vor dem Entfernen einer Stelle MIT Verbindungen (Prüfliste Nr. 4): nennt, wie viele
 * mitgehen. Ein Dialog statt `Popconfirm`, weil der Auslöser ein Menüeintrag ist, an dem kein
 * Popover hängen kann. Ohne Verbindungen entfernt die Seite ohne Rückfrage.
 */
/** Rückfrage beim Entfernen; der Text nennt, was mitgeht (`stab/kommunikationsplan.ts:entfernText`). */
export function StelleEntfernenRueckfrage({
  text,
  laeuft,
  onEntfernen,
  onSchliessen,
}: {
  text: string;
  laeuft: boolean;
  onEntfernen: () => void;
  onSchliessen: () => void;
}) {
  return (
    <Modal
      open
      title="Stelle entfernen?"
      okText="Entfernen"
      okButtonProps={{ danger: true }}
      cancelText="Abbrechen"
      confirmLoading={laeuft}
      onOk={onEntfernen}
      onCancel={onSchliessen}
    >
      {text}
    </Modal>
  );
}
