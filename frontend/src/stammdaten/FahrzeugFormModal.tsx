import { App, AutoComplete, Form, Input, Typography } from 'antd';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { ErfassungsModal } from '../components/Erfassung';
import { aktualisiereFahrzeug, legeFahrzeugAn } from '../api/fahrzeuge';
import type { Fahrzeug, FahrzeugVorschlaege } from '../api/types';
import { globalKeys } from '../api/queryKeys';
import { leerZuNull } from '../api/patchTriState';
import { fahrzeugDetailPfad } from './stammdatenDetail';

/**
 * SCHNELLERFASSUNG, kein Vollformular mehr (LFH-346 · A7, Befund H36).
 *
 * Sichtbar bleiben genau die vier Felder, ohne die ein Fahrzeug nicht angelegt bzw. im
 * Einsatz nicht gefunden werden kann. Die übrigen sieben (OPTA, Standort, FMS-ISSI,
 * Sonder-/Wegerecht, Tragenkapazität, Soll-Stärke, Bemerkung) sind nicht gestrichen,
 * sondern auf `FahrzeugDetailPage` gewandert — elf Felder in einem 520-px-Dialog
 * verletzen die UI-Form-Leitlinie (LFH-19: Modal ≤ ~3, Schnellerfassung ≤ ~4).
 *
 * **Kein `<Collapse>` für den Rest.** Ein eingeklapptes Feld ist immer noch in diesem
 * Formular; die Faustregel aus CLAUDE.md sagt für einen Edit-Modus mit vielen Feldern
 * „eigene Route", nicht „weniger sichtbar".
 */
interface FormWerte {
  funkrufname: string;
  fahrzeugtyp?: string;
  traegerorganisation?: string;
  kennzeichen?: string;
}

export default function FahrzeugFormModal({
  offen,
  fahrzeug,
  vorschlaege,
  onClose,
}: {
  offen: boolean;
  fahrzeug: Fahrzeug | null; // null = neu
  vorschlaege: FahrzeugVorschlaege;
  onClose: () => void;
}) {
  const [form] = Form.useForm<FormWerte>();
  const qc = useQueryClient();
  const { message } = App.useApp();

  /**
   * VORBELEGUNG, kein Zurücksetzen (LFH-346/A6 nach dem Muster von `PersonalFormModal`).
   * Der frühere Anlegen-Zweig (`resetFields()` + `sondersignal: false`) ist weg: das
   * Zurücksetzen macht `ErfassungsModal` auf allen vier Auswegen selbst. Ein
   * zurückgebliebener Aufrufer-Reset wäre doppelt und verdeckte, ob die Hülle ihre
   * Zusicherung überhaupt einlöst.
   */
  useEffect(() => {
    if (!offen || !fahrzeug) return;
    form.setFieldsValue({
      funkrufname: fahrzeug.funkrufname,
      fahrzeugtyp: fahrzeug.fahrzeugtyp ?? undefined,
      traegerorganisation: fahrzeug.traegerorganisation ?? undefined,
      kennzeichen: fahrzeug.kennzeichen ?? undefined,
    });
  }, [offen, fahrzeug, form]);

  const mutation = useMutation({
    mutationFn: (werte: FormWerte) => {
      /**
       * NUR die vier sichtbaren Felder — beide Wege.
       *
       * Beim BEARBEITEN ist das die tragende Zusicherung: `PATCH /api/fahrzeuge/{id}` ist
       * ein echter Teil-Patch (LFH-306), fehlender Key = unverändert, `null` = leeren. Ein
       * `opta: leerZuNull(undefined)` wäre `null` — ein Bearbeiten in der Liste löschte
       * damit die sieben Felder, die diese Maske gar nicht zeigt. Beim ANLEGEN gibt es
       * nichts zu erhalten; dieselben vier Keys genügen, `sondersignal` trägt serverseitig
       * ein `#[serde(default)]`.
       */
      const daten = {
        funkrufname: werte.funkrufname.trim(),
        fahrzeugtyp: leerZuNull(werte.fahrzeugtyp),
        traegerorganisation: leerZuNull(werte.traegerorganisation),
        kennzeichen: leerZuNull(werte.kennzeichen),
      };
      return fahrzeug ? aktualisiereFahrzeug(fahrzeug.id, daten) : legeFahrzeugAn(daten);
    },
    // Nur noch invalidieren: das Schliessen macht `onFertig`, das Leeren die Hülle.
    // Ein `onClose()` hier schlösse den Dialog auch beim „Speichern und nächstes" —
    // der Serienmodus wäre still wirkungslos.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: globalKeys.fahrzeuge() });
      qc.invalidateQueries({ queryKey: globalKeys.fahrzeugVorschlaege() });
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  return (
    <ErfassungsModal<FormWerte>
      offen={offen}
      titel={fahrzeug ? 'Fahrzeug bearbeiten' : 'Fahrzeug anlegen'}
      form={form}
      erfassenText="Speichern"
      laeuft={mutation.isPending}
      // `serie` nur im ANLEGEN-Modus: „Speichern und nächste" ergibt beim Bearbeiten
      // eines bestehenden Fahrzeugs keinen Sinn und stünde dort als toter Knopf.
      serie={fahrzeug == null}
      // Nur, was über eine Erfassungsserie hinweg gleich bleibt. Der Standort ist mit A7
      // auf die Detailseite gewandert und darf hier NICHT mehr stehen — `uebernahme` nennt
      // ausschliesslich sichtbare Felder, sonst behauptet „Werte behalten" etwas über ein
      // Feld, das niemand sieht.
      uebernahme={['traegerorganisation']}
      // `mutateAsync`, nicht `mutate`: bei Ablehnung muss die Zusage BRECHEN, sonst
      // leert die Hülle die Felder trotz 422 und der Wortlaut ist weg (LFH-332).
      onErfassen={(w) => mutation.mutateAsync(w)}
      onFertig={onClose}
      onAbbrechen={onClose}
    >
      <Form.Item
        label="Funkrufname"
        name="funkrufname"
        rules={[{ required: true, whitespace: true, message: 'Funkrufname darf nicht leer sein' }]}
      >
        <Input />
      </Form.Item>
      <Form.Item label="Fahrzeugtyp" name="fahrzeugtyp">
        <AutoComplete
          options={vorschlaege.fahrzeugtyp.map((t) => ({ value: t }))}
          allowClear
          placeholder="z. B. LF 20, RTW"
          showSearch={{
            filterOption: (input, option) =>
              (option?.value ?? '').toLowerCase().includes(input.toLowerCase()),
          }}
        />
      </Form.Item>
      <Form.Item label="Trägerorganisation" name="traegerorganisation">
        <AutoComplete
          options={vorschlaege.traegerorganisation.map((t) => ({ value: t }))}
          allowClear
          placeholder="z. B. Feuerwehr Musterstadt"
          showSearch={{
            filterOption: (input, option) =>
              (option?.value ?? '').toLowerCase().includes(input.toLowerCase()),
          }}
        />
      </Form.Item>
      <Form.Item label="Kennzeichen" name="kennzeichen">
        <Input />
      </Form.Item>
      {/* NUR im Bearbeiten-Modus: ein neu angelegtes Fahrzeug hat noch keine id und damit
          keine Route. Der Weg zu den sieben übrigen Feldern ist damit von hier aus
          sichtbar, statt dass sie unauffindbar wären. */}
      {fahrzeug && (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          <Link to={fahrzeugDetailPfad(fahrzeug.id)}>
            Mehr Details… (OPTA, Standort, FMS-ISSI, Stärke, Bemerkung)
          </Link>
        </Typography.Paragraph>
      )}
    </ErfassungsModal>
  );
}
