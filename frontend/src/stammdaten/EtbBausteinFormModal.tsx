import { Collapse, Form, Input, InputNumber } from 'antd';
import { Feld, MetaZeile, Stapel, Textstufe } from '../components/instrument';
import { Select } from '../components/Select';
import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ErfassungsModal } from '../components/Erfassung';
import { aktualisiereBaustein, legeBausteinAn, type BausteinEingabe } from '../api/etbBaustein';
import type { EtbBaustein, EtbTyp, MeldeWeg } from '../api/types';
import { ERFASSBARE_TYPEN } from '../etb/typFarben';
import { etbTyp } from '../theme/statusFarben';
import { AUTO_PLATZHALTER } from '../etb/bausteinEinsetzen';
import { MELDEWEG_OPTIONEN } from '../etb/schnellerfassungModell';
import { globalKeys } from '../api/queryKeys';
import { leerZuNull } from '../api/patchTriState';

interface FormWerte {
  label: string;
  typ: EtbTyp;
  inhalt: string;
  meldeweg?: MeldeWeg;
  veranlassung?: string;
  sortier: number;
}

export default function EtbBausteinFormModal({
  offen,
  baustein,
  onClose,
}: {
  offen: boolean;
  baustein: EtbBaustein | null;
  onClose: () => void;
}) {
  const [form] = Form.useForm<FormWerte>();
  const qc = useQueryClient();

  // VORBELEGUNG, kein Zurücksetzen — Begründung in `FahrzeugFormModal`. Die Vorgabewerte stehen
  // als `initialValues` an der Hülle.
  useEffect(() => {
    if (!offen || !baustein) return;
    form.setFieldsValue({
      label: baustein.label,
      typ: baustein.typ,
      inhalt: baustein.inhalt,
      meldeweg: baustein.meldeweg ?? undefined,
      veranlassung: baustein.veranlassung ?? undefined,
      sortier: baustein.sortier,
    });
  }, [offen, baustein, form]);

  const mutation = useMutation({
    mutationFn: (werte: FormWerte) => {
      const daten: BausteinEingabe = {
        label: werte.label.trim(),
        typ: werte.typ,
        inhalt: werte.inhalt.trim(),
        meldeweg: werte.meldeweg ?? null,
        veranlassung: leerZuNull(werte.veranlassung),
        sortier: werte.sortier ?? 0,
      };
      return baustein ? aktualisiereBaustein(baustein.id, daten) : legeBausteinAn(daten);
    },
    // Kein `onClose()`: das Schließen macht `onFertig`, das Leeren die Hülle.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: globalKeys.etbBausteine() });
    },
  });

  return (
    <ErfassungsModal<FormWerte>
      offen={offen}
      titel={baustein ? 'Baustein bearbeiten' : 'Baustein anlegen'}
      form={form}
      erfassenText="Speichern"
      laeuft={mutation.isPending}
      // Kein `onError`-Toast: die Hülle nennt den Grund einer Ablehnung im Dialog
      // (`frontend/AGENTS.md`, „Rückwege und Fehler“, LFH-1077).
      speicherung={mutation}
      initialValues={{ typ: 'meldung', sortier: 0 }}
      // `mutateAsync`: bei Ablehnung muss die Zusage brechen.
      //
      // Der Formularspeicher statt der `onFinish`-Werte: ohne `forceRender` sind Meldeweg,
      // Veranlassung und Sortierung nicht montiert, und `onFinish` liefert nur montierte Felder.
      // `BausteinEingabe` ist Vollersatz — ein bearbeiteter Baustein verlöre Meldeweg und
      // Reihenfolge bei jedem Speichern ohne Aufklappen. Ein Rückfall auf `baustein?.meldeweg` wäre
      // die falsche Reparatur: er kann „nie montiert" nicht von „bewusst geleert" unterscheiden, und
      // der Meldeweg-Select trägt `allowClear`.
      //
      // `getFieldsValue(true)` ist bei antd `any`-typisiert — die Feldnamen prüft der Parametertyp
      // von `mutationFn`.
      onErfassen={() => mutation.mutateAsync(form.getFieldsValue(true))}
      onFertig={onClose}
      onAbbrechen={onClose}
    >
      <Feld label="Label" name="label" rules={[{ required: true, whitespace: true }]}>
        <Input placeholder="z. B. Lage unverändert" />
      </Feld>
      <Feld label="Typ" name="typ" rules={[{ required: true }]}>
        <Select options={ERFASSBARE_TYPEN.map((t) => ({ value: t, label: etbTyp[t].label }))} />
      </Feld>
      {/* Die automatischen Platzhalter als sichtbare Legende, kein Satz (LFH-1078); die Form
         (`10okt26`) gehört sichtbar dazu, nicht nur in einen `title` (Touch). Dass ein freier
         Platzhalter wie `{einheit}` beim Einsetzen abgefragt wird, zeigt das Beispiel im Feld;
         Klick-Chips wären eine neue Funktion. */}
      <Feld
        label="Inhalt"
        name="inhalt"
        rules={[{ required: true, whitespace: true }]}
        extra={
          <Stapel richtung="zeile" umbruch abstand="xs" ausrichten="baseline">
            <Textstufe stufe="textKlein" ton="gedaempft">
              Automatisch:
            </Textstufe>
            <MetaZeile>
              {AUTO_PLATZHALTER.map((p) => (
                <MetaZeile.Teil key={p.name} ton="gedaempft">
                  <code>{`{${p.name}}`}</code> {p.beschreibung}
                </MetaZeile.Teil>
              ))}
            </MetaZeile>
          </Stapel>
        }
      >
        <Input.TextArea rows={2} placeholder="z. B. {einheit} an Einsatzstelle eingetroffen" />
      </Feld>
      {/* FELDBUDGET: drei sichtbare Felder, drei eingeklappt. Label, Typ und Inhalt sind die
         Pflichtwerte und bleiben oben; Meldeweg und Veranlassung sind optional, die Sortierung hat
         mit 0 einen brauchbaren Vorgabewert (LFH-343).

         Bewusst OHNE `forceRender` (wie `AuftragFormular`) — sonst wäre „im Ausgangszustand drei
         Felder" nicht prüfbar. Gegenmittel am `onErfassen` oben. */}
      <Collapse
        ghost
        style={{ marginInline: -8 }}
        items={[
          {
            key: 'weitere',
            label: 'Weitere Angaben',
            children: (
              <>
                <Feld label="Meldeweg (optional)" name="meldeweg">
                  <Select allowClear options={MELDEWEG_OPTIONEN} />
                </Feld>
                <Feld label="Veranlassung (optional)" name="veranlassung">
                  <Input />
                </Feld>
                <Feld label="Sortierung" name="sortier" breite="kurz">
                  <InputNumber min={0} />
                </Feld>
              </>
            ),
          },
        ]}
      />
    </ErfassungsModal>
  );
}
