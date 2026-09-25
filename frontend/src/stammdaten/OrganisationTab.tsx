import { Alert, App, Button, Form, Input, Modal, Space, Typography, Upload, theme } from 'antd';
import AdminPage from '../components/AdminPage';
import { Select } from '../components/Select';
import { SeitenHinweise, SpeicherFehler } from '../components/SpeicherHinweis';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import {
  entferneOrgLogo,
  ladeOrganisation,
  ladeOrgLogoHoch,
  orgLogoPfad,
  setzeOrgDefault,
  setzeOrgName,
} from '../api/organisation';
import { globalKeys } from '../api/queryKeys';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';
import { Formularpaneel, Paneel } from '../components/instrument';
import { speicherLeisteStil } from '../components/speicherLeiste';

interface FormWerte {
  tz_organisation: string;
}

interface NameWerte {
  name: string;
}

/** Höchstlänge des Namens in Zeichen — deckungsgleich mit `MAX_NAME_ZEICHEN` im Backend. */
const MAX_NAME = 120;

/** Höchstgröße des Logos — deckungsgleich mit `org::logo::MAX_GROESSE` (1 MiB). */
export const MAX_LOGO_BYTES = 1024 * 1024;
const LOGO_TYPEN = ['image/png', 'image/jpeg'];

/**
 * Vorprüfung eines Logos im Client (LFH-22). Spart den Weg zum Server für die zwei
 * häufigen Fehler; MASSGEBLICH bleibt der Server, der den Typ am Inhalt erkennt (ein
 * umbenanntes SVG besteht diese Prüfung und scheitert dort). `null` = in Ordnung.
 */
export function logoVorpruefung(datei: File): string | null {
  if (!LOGO_TYPEN.includes(datei.type)) return 'Nur PNG oder JPEG als Logo.';
  if (datei.size === 0) return 'Die Datei ist leer.';
  if (datei.size > MAX_LOGO_BYTES) return 'Das Logo ist zu groß (höchstens 1 MiB).';
  return null;
}

const ORG_OPTIONEN = [
  { value: 'feuerwehr', label: 'Feuerwehr' },
  { value: 'thw', label: 'THW' },
  { value: 'hilfsorganisation', label: 'Hilfsorganisation' },
  { value: 'polizei', label: 'Polizei' },
  { value: 'gefahrenabwehr', label: 'Gefahrenabwehr' },
  { value: 'bundeswehr', label: 'Bundeswehr' },
  { value: 'zivil', label: 'Zivil' },
  { value: 'fuehrung', label: 'Führung' },
];

export default function OrganisationTab() {
  /**
   * Diese Sektion hatte als EINZIGE der elf gar kein Rechte-Gate (LFH-346 · A2, M45) —
   * `PATCH /api/organisation` lehnt zwar serverseitig ab, aber die Absage kam erst nach
   * dem Klick und verschwand als Toast wieder. Jetzt: Formular und Knopf gesperrt, der
   * Grund steht im Hinweis-Slot.
   */
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormWerte>();
  const { token } = theme.useToken();

  const orgQuery = useQuery({ queryKey: globalKeys.organisation(), queryFn: ladeOrganisation });

  useEffect(() => {
    if (orgQuery.data?.tz_organisation) {
      form.setFieldsValue({ tz_organisation: orgQuery.data.tz_organisation });
    }
  }, [orgQuery.data, form]);

  const speichern = useMutation({
    mutationFn: (werte: FormWerte) => setzeOrgDefault(werte.tz_organisation),
    onSuccess: () => {
      message.success('DV-102-Organisation gespeichert');
      qc.invalidateQueries({ queryKey: globalKeys.organisation() });
    },
    /**
     * KEIN `onError` mehr (derselbe Befund wie LFH-345 · C10 / H14, eine Datei weiter):
     * nach rund drei Sekunden war der Toast weg, das ausgefüllte Formular stand unverändert
     * da und wirkte gespeichert. Der Fehler hängt jetzt als Alert an SEINEM PANEEL
     * („Taktische Zeichen") und räumt sich beim nächsten Absenden selbst
     * weg — react-query setzt `error` beim Übergang nach `pending` zurück. Der ERFOLG
     * bleibt beim Toast: er quittiert eine abgeschlossene Handlung.
     */
  });

  // ── Name (LFH-22, design.md D9) ──────────────────────────────────────────────
  const [nameForm] = Form.useForm<NameWerte>();
  const serverName = orgQuery.data?.name;
  /**
   * Hat die Person am Namen getippt, seit er zuletzt gespeichert wurde? Ein EIGENER Merker,
   * nicht `isFieldTouched` (LFH-342 · C7 (2)): antd setzt `touched` beim Speichern nie zurück,
   * das Feld folgte dem Serverstand nach der ersten Eingabe für den ganzen Besuch nicht mehr —
   * ein getrimmter Name blieb mit Leerzeichen stehen, eine fremde Umbenennung kam nicht an
   * und ein erneutes Speichern schrieb still den alten lokalen Wert zurück.
   */
  const [nameGeaendert, setNameGeaendert] = useState(false);
  useEffect(() => {
    // Nur solange niemand tippt: ein Refetch (Fensterfokus) darf einen angefangenen Namen
    // nicht überschreiben. `nameGeaendert` steht mit in den Abhängigkeiten: bleibt der
    // Server beim selben Namen, ändert sich `serverName` nicht, und erst das Zurückfallen
    // des Merkers bringt ihn ins Feld zurück.
    if (serverName != null && !nameGeaendert) {
      nameForm.setFieldsValue({ name: serverName });
    }
  }, [serverName, nameGeaendert, nameForm]);
  const nameSpeichern = useMutation({
    mutationFn: (werte: NameWerte) => setzeOrgName(werte.name.trim()),
    onSuccess: (antwort, werte) => {
      // ERST den Cache auf die Antwort setzen (sie ist die volle `OrganisationAnzeige`),
      // DANN den Merker zurücknehmen: sonst übernahm der Sync-Effekt den noch ALTEN Namen
      // aus dem Cache, bis der Refetch kam — und scheiterte der, blieb er stehen, und ein
      // zweites „Namen speichern" machte die Umbenennung still rückgängig.
      qc.setQueryData(globalKeys.organisation(), antwort);
      // Wer während des Speicherns weitertippt, behält seinen Stand.
      if (nameForm.getFieldValue('name') === werte.name) setNameGeaendert(false);
      message.success('Name gespeichert');
      qc.invalidateQueries({ queryKey: globalKeys.organisation() });
    },
    // Kein `onError`: der Grund steht am Paneel (H14), siehe `speichern`.
  });

  // ── Logo (LFH-22, design.md D9) ──────────────────────────────────────────────
  const logo = orgQuery.data?.logo ?? null;
  const [vorpruefung, setVorpruefung] = useState<string | null>(null);
  const [entfernenOffen, setEntfernenOffen] = useState(false);
  const logoHoch = useMutation({
    mutationFn: ladeOrgLogoHoch,
    onSuccess: (antwort) => {
      // Die Antwort trägt das neue Logo; ohne sie stünde bis zum Refetch das alte da.
      qc.setQueryData(globalKeys.organisation(), antwort);
      message.success('Logo gespeichert');
      qc.invalidateQueries({ queryKey: globalKeys.organisation() });
    },
  });
  const logoEntfernen = useMutation({
    mutationFn: entferneOrgLogo,
    onSuccess: () => {
      setEntfernenOffen(false);
      message.success('Logo entfernt');
      qc.invalidateQueries({ queryKey: globalKeys.organisation() });
    },
  });

  return (
    /* KEIN `aktionen`-Slot (LFH-346 · A3): der Speichern-Knopf gehört INS `<form>` und
       trägt `htmlType="submit"` — der Kopf-Slot von `AdminPage` liegt außerhalb jedes
       `<form>` und könnte nichts übermitteln (Erfassungs-Norm B4/LFH-332). */
    <AdminPage
      titel="Organisation"
      breite="schmal"
      hinweis={
        /* Nur der Rechte-Hinweis gilt für die ganze Seite. Speicherfehler stehen an IHREM
           Paneel (Review Welle B): drei unabhängige Speicherwege, und eine Kette `a ?? b ?? c`
           zeigte nur den ersten einer festen Rangfolge — ein späterer Fehler blieb unsichtbar. */
        <SeitenHinweise rechteFehlt={!istAdmin} rechteText={STAMMDATEN_RECHTE_TEXT} />
      }
    >
      {/* NAME (LFH-22): eigenes `<form>`, damit Enter nur den Namen sendet und der Knopf
          darin liegt (Erfassungs-Norm B4). Der Name steht im Druckkopf jedes Ausdrucks. */}
      <Form<NameWerte>
        form={nameForm}
        layout="vertical"
        disabled={!istAdmin}
        onValuesChange={() => setNameGeaendert(true)}
        onFinish={(w) => nameSpeichern.mutate(w)}
      >
        <Formularpaneel
          titel="Name"
          beschreibung="Steht im Druckkopf jedes Ausdrucks und ordnet ihn der Organisation zu."
        >
          <Form.Item
            label="Name der Organisation"
            name="name"
            style={{ maxWidth: 480 }}
            rules={[
              { required: true, whitespace: true, message: 'Der Name darf nicht leer sein.' },
              { max: MAX_NAME, message: `Höchstens ${MAX_NAME} Zeichen.` },
            ]}
          >
            <Input />
          </Form.Item>
          <div style={{ marginBlockEnd: token.marginSM }}>
            <SpeicherFehler fehler={nameSpeichern.error} />
          </div>
          <Button htmlType="submit" disabled={!istAdmin} loading={nameSpeichern.isPending}>
            Namen speichern
          </Button>
        </Formularpaneel>
      </Form>

      {/* LOGO (LFH-22): kein Formular — Hochladen wirkt sofort, Entfernen fragt nach,
          weil die Datei danach weg ist (unumkehrbar, LFH-363). */}
      <Paneel
        titel="Logo"
        meta={
          logo
            ? `${logo.mime === 'image/png' ? 'PNG' : 'JPEG'} · ${Math.ceil(logo.groesse / 1024)} KiB`
            : 'kein Logo'
        }
        koerperPolster
        style={{ marginBlockEnd: token.marginLG }}
      >
        <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
          {logo ? (
            <img
              src={orgLogoPfad(logo.sha256)}
              alt={`Logo von ${orgQuery.data?.name ?? 'der Organisation'}`}
              style={{ maxHeight: 64, maxWidth: 240, objectFit: 'contain' }}
            />
          ) : (
            <Typography.Text type="secondary">
              Kein Logo hinterlegt. Der Druckkopf zeigt dann nur den Namen.
            </Typography.Text>
          )}
          <Typography.Text type="secondary">PNG oder JPEG, höchstens 1 MiB.</Typography.Text>
          {vorpruefung && (
            <Alert type="error" showIcon title="Logo nicht übernommen" description={vorpruefung} />
          )}
          <SpeicherFehler fehler={logoHoch.error} titel="Logo nicht übernommen" />
          {/* `size="middle"`: Rot steht nicht bündig neben Neutralem (LFH-352). */}
          <Space wrap size="middle">
            <Upload
              accept={LOGO_TYPEN.join(',')}
              showUploadList={false}
              disabled={!istAdmin}
              beforeUpload={(datei) => {
                const grund = logoVorpruefung(datei);
                setVorpruefung(grund);
                // Ein alter Server-Grund stünde sonst neben dem neuen Versuch (`mutate`
                // räumt ihn nur, wenn die Vorprüfung besteht).
                logoHoch.reset();
                if (grund === null) logoHoch.mutate(datei);
                // Nie antds eigenen Upload: der Aufruf läuft über `api/organisation.ts`.
                return Upload.LIST_IGNORE;
              }}
            >
              <Button disabled={!istAdmin} loading={logoHoch.isPending}>
                {logo ? 'Logo ersetzen' : 'Logo hochladen'}
              </Button>
            </Upload>
            {logo && (
              <Button
                danger
                disabled={!istAdmin}
                onClick={() => {
                  // Ein Grund aus einem früheren Versuch gehört nicht in einen frischen
                  // Dialog — react-query hält `error` bis zum nächsten `mutate()` (LFH-535).
                  logoEntfernen.reset();
                  setEntfernenOffen(true);
                }}
              >
                Logo entfernen
              </Button>
            )}
          </Space>
        </Space>
      </Paneel>
      <Modal
        open={entfernenOffen}
        title="Logo entfernen?"
        okText="Entfernen"
        cancelText="Abbrechen"
        okButtonProps={{ danger: true, loading: logoEntfernen.isPending }}
        onOk={() => logoEntfernen.mutate()}
        onCancel={() => setEntfernenOffen(false)}
      >
        {/* Scheitert das Entfernen, bleibt der Dialog offen — der Grund steht deshalb HIER,
            nicht hinter seiner Maske an der Seite (LFH-535, Bauform `FreigabeDialog`). */}
        <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
          <Typography.Paragraph style={{ margin: 0 }}>
            Das Logo wird gelöscht und steht danach auf keinem Ausdruck mehr. Das lässt sich nicht
            rückgängig machen; ein neues Logo muss erneut hochgeladen werden.
          </Typography.Paragraph>
          <SpeicherFehler fehler={logoEntfernen.error} titel="Logo nicht entfernt" />
        </Space>
      </Modal>

      {/* `disabled` am Formular sperrt die Felder, `disabled` am Knopf den Absendeweg —
          der Knopf VERSCHWINDET nicht (M16). Neuentwurf: Feldgruppe als Paneel, der Knopf in
          der sticky Leiste IM `<form>` wie auf den Einstellungsseiten. */}
      <Form<FormWerte>
        form={form}
        layout="vertical"
        disabled={!istAdmin}
        onFinish={(w) => speichern.mutate(w)}
      >
        <Formularpaneel
          titel="Taktische Zeichen"
          beschreibung="Standard-Organisation für taktische Zeichen; pro Objekt überschreibbar."
        >
          <Form.Item label="DV-102-Organisation" name="tz_organisation" style={{ maxWidth: 480 }}>
            <Select
              options={ORG_OPTIONEN}
              placeholder="Organisation wählen"
              loading={orgQuery.isLoading}
            />
          </Form.Item>
          <SpeicherFehler fehler={speichern.error} />
        </Formularpaneel>
        <div style={speicherLeisteStil(token)}>
          <Button
            type="primary"
            htmlType="submit"
            disabled={!istAdmin}
            loading={speichern.isPending}
          >
            Speichern
          </Button>
        </div>
      </Form>
    </AdminPage>
  );
}
