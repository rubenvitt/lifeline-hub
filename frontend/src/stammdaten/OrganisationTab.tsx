import { Alert, App, Button, Form, Input, Modal, Space, Typography, Upload, theme } from 'antd';
import AdminPage from '../components/AdminPage';
import { Select } from '../components/Select';
import { SeitenHinweise, SpeicherFehler } from '../components/SpeicherHinweis';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import {
  aendereOrganisation,
  entferneOrgLogo,
  ladeOrganisation,
  ladeOrgLogoHoch,
  orgLogoPfad,
  type OrganisationAenderung,
} from '../api/organisation';
import type { OrganisationInfo } from '../api/types';
import { globalKeys } from '../api/queryKeys';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';
import { Formularpaneel, Paneel } from '../components/instrument';
import { useSpeicherLeiste } from '../components/speicherLeiste';
import VerlassenRueckfrage from '../components/VerlassenRueckfrage';
import { useFormularVerlassenSchutz } from '../components/useFormularVerlassenSchutz';

interface FormWerte {
  name: string;
  tz_organisation?: string;
}

/** Höchstlänge des Namens in Zeichen — deckungsgleich mit `MAX_NAME_ZEICHEN` im Backend. */
const MAX_NAME = 120;

/** Höchstgröße des Logos — deckungsgleich mit `org::logo::MAX_GROESSE` (1 MiB). */
const MAX_LOGO_BYTES = 1024 * 1024;
const LOGO_TYPEN = ['image/png', 'image/jpeg'];

/**
 * Vorprüfung eines Logos im Client. Spart den Weg zum Server für die zwei häufigen Fehler;
 * MASSGEBLICH bleibt der Server, der den Typ am Inhalt erkennt (ein umbenanntes SVG besteht
 * diese Prüfung und scheitert dort). `null` = in Ordnung.
 */
function logoVorpruefung(datei: File): string | null {
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

/**
 * Was gegenüber dem Serverstand geändert ist — nur das geht in den PATCH (LFH-979). Der Name
 * zählt getrimmt: nur angehängte Leerzeichen sind keine Umbenennung. `null` = nichts geändert.
 */
function geaenderteFelder(
  werte: FormWerte,
  server: OrganisationInfo | undefined,
): OrganisationAenderung | null {
  const felder: OrganisationAenderung = {};
  const name = werte.name.trim();
  if (name !== server?.name) felder.name = name;
  if (werte.tz_organisation != null && werte.tz_organisation !== server?.tz_organisation) {
    felder.tz_organisation = werte.tz_organisation;
  }
  return Object.keys(felder).length > 0 ? felder : null;
}

/** Die Erfolgsmeldung nennt genau, was gespeichert wurde (LFH-979). */
function erfolgsText(felder: OrganisationAenderung): string {
  if (felder.name !== undefined && felder.tz_organisation !== undefined) {
    return 'Name und DV-102-Organisation gespeichert';
  }
  return felder.name !== undefined ? 'Name gespeichert' : 'DV-102-Organisation gespeichert';
}

export default function OrganisationTab() {
  /**
   * Rechte-Gate: `PATCH /api/organisation` lehnt zwar serverseitig ab, aber erst nach dem
   * Klick. Formular und Knopf sind deshalb gesperrt, der Grund steht im Hinweis-Slot.
   */
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormWerte>();
  const { token } = theme.useToken();
  const speicherLeiste = useSpeicherLeiste();

  const orgQuery = useQuery({ queryKey: globalKeys.organisation(), queryFn: ladeOrganisation });

  /**
   * Verlassen-Schutz (LFH-979, `frontend/AGENTS.md` „Formularseiten“). Sein Merker ist zugleich
   * der Riegel des Abgleichs unten — ein EIGENER Merker, nicht `isFieldTouched`: antd setzt
   * `touched` beim Speichern nie zurück, die Felder folgten dem Serverstand sonst für den ganzen
   * Besuch nicht mehr — eine fremde Umbenennung käme nicht an.
   */
  const schutz = useFormularVerlassenSchutz({ aktiv: istAdmin });
  const server = orgQuery.data;
  useEffect(() => {
    // Nur solange nichts Ungespeichertes im Formular steht: ein Refetch (Fensterfokus) darf eine
    // angefangene Eingabe nicht überschreiben. `ungespeichert` steht mit in den Abhängigkeiten:
    // bleibt der Server beim selben Stand, ändert sich `server` nicht, und erst das Zurückfallen
    // des Merkers bringt ihn ins Feld zurück.
    if (!server || schutz.ungespeichert) return;
    form.setFieldsValue({
      name: server.name,
      ...(server.tz_organisation ? { tz_organisation: server.tz_organisation } : {}),
    });
  }, [server, schutz.ungespeichert, form]);

  /**
   * EIN Speicherweg für Name und DV-102-Organisation (LFH-979): vorher hatte jedes Feld sein
   * eigenes `<form>`, und die auffällige Leiste schickte nur die DV-102-Organisation — ein
   * umbenannter Name ging mit grünem Toast still verloren. Ein PATCH mit genau den geänderten
   * Feldern; der Server schreibt beide in einem `UPDATE`, halb gespeichert gibt es nicht.
   */
  const speichern = useMutation({
    mutationFn: aendereOrganisation,
    onSuccess: (antwort, felder) => {
      // ERST den Cache auf die Antwort setzen (sie ist die volle `OrganisationAnzeige`), DANN den
      // Merker zurücknehmen (`onSuccess` am `mutate`): sonst übernähme der Abgleich den noch ALTEN
      // Stand aus dem Cache, und scheiterte der Refetch, machte ein zweites Speichern die
      // Umbenennung rückgängig.
      qc.setQueryData(globalKeys.organisation(), antwort);
      message.success(erfolgsText(felder));
      qc.invalidateQueries({ queryKey: globalKeys.organisation() });
    },
    /**
     * KEIN `onError`: ein Toast wäre nach drei Sekunden weg, und das unveränderte Formular wirkte
     * gespeichert. Der Fehler hängt als Alert über der Leiste und räumt sich beim nächsten
     * Absenden selbst weg (react-query setzt `error` beim Übergang nach `pending` zurück). Der
     * ERFOLG bleibt beim Toast.
     */
  });

  function absenden(werte: FormWerte) {
    // Stand beim Absenden: wer während des Speicherns weitertippt, behält den Schutz.
    const fassung = schutz.fassung();
    const felder = geaenderteFelder(werte, server);
    if (felder === null) {
      // Nichts zu speichern, also auch kein Erfolg zu melden. Ein alter Grund gilt nicht mehr.
      speichern.reset();
      schutz.gespeichert(fassung);
      return;
    }
    speichern.mutate(felder, { onSuccess: () => schutz.gespeichert(fassung) });
  }

  // ── Logo (LFH-22) ─────────────────────────────────────────────────────────────
  const logo = orgQuery.data?.logo ?? null;
  const [vorpruefung, setVorpruefung] = useState<string | null>(null);
  // Ein Logo, das nicht lädt, fällt weg statt als kaputter Bildrahmen zu stehen (wie im
  // Druckkopf). Gemerkt je sha256: ein ersetztes Logo bekommt einen neuen Versuch.
  const [kaputtesLogo, setKaputtesLogo] = useState<string | null>(null);
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
    /* KEIN `aktionen`-Slot: der Speichern-Knopf gehört INS `<form>` und trägt
       `htmlType="submit"` — der Kopf-Slot von `AdminPage` liegt außerhalb jedes `<form>`. */
    <AdminPage
      titel="Organisation"
      breite="schmal"
      hinweis={
        /* Nur der Rechte-Hinweis gilt für die ganze Seite. Speicherfehler stehen an IHREM Ort:
           zwei unabhängige Speicherwege (Formular, Logo), eine Kette `a ?? b` zeigte nur den
           ersten. */
        <SeitenHinweise rechteFehlt={!istAdmin} rechteText={STAMMDATEN_RECHTE_TEXT} />
      }
    >
      <VerlassenRueckfrage ungespeichert={schutz.ungespeichert} />
      {/* EIN `<form>` für die ganze Seite (LFH-979): Enter im Namen und die Leiste senden
         dasselbe. `disabled` am Formular sperrt die Felder, `disabled` am Knopf den Absendeweg —
         der Knopf VERSCHWINDET nicht. */}
      <Form<FormWerte>
        form={form}
        layout="vertical"
        disabled={!istAdmin}
        onValuesChange={schutz.geaendert}
        onFinish={absenden}
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
        </Formularpaneel>

        {/* LOGO (LFH-22): keine Felder — Hochladen wirkt sofort, Entfernen fragt nach,
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
            {logo && kaputtesLogo === logo.sha256 ? (
              // Anders als im Druckkopf mit Hinweis: hier ist der Ort, an dem man es behebt.
              <Alert
                type="warning"
                showIcon
                title="Das hinterlegte Logo lässt sich nicht anzeigen."
                description="Auf Ausdrucken fehlt es, bis es ersetzt oder entfernt ist."
              />
            ) : logo ? (
              <img
                src={orgLogoPfad(logo.sha256)}
                alt={`Logo von ${orgQuery.data?.name ?? 'der Organisation'}`}
                style={{ maxHeight: 64, maxWidth: 240, objectFit: 'contain' }}
                onError={() => setKaputtesLogo(logo.sha256)}
              />
            ) : (
              <Typography.Text type="secondary">
                Kein Logo hinterlegt. Der Druckkopf zeigt dann nur den Namen.
              </Typography.Text>
            )}
            <Typography.Text type="secondary">PNG oder JPEG, höchstens 1 MiB.</Typography.Text>
            {vorpruefung && (
              <Alert
                type="error"
                showIcon
                title="Logo nicht übernommen"
                description={vorpruefung}
              />
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
        </Formularpaneel>
        {/* Ein Speicherweg, ein Grund: direkt über dem Knopf, der ihn ausgelöst hat. */}
        <SpeicherFehler fehler={speichern.error} />
        <div {...speicherLeiste}>
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
      <Modal
        open={entfernenOffen}
        title="Logo entfernen?"
        okText="Entfernen"
        cancelText="Abbrechen"
        okButtonProps={{ danger: true, loading: logoEntfernen.isPending }}
        onOk={() => logoEntfernen.mutate()}
        onCancel={() => setEntfernenOffen(false)}
      >
        {/* Scheitert das Entfernen, bleibt der Dialog offen — der Grund steht deshalb HIER, nicht
           hinter seiner Maske an der Seite (Bauform `FreigabeDialog`). */}
        <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
          <Typography.Paragraph style={{ margin: 0 }}>
            Das Logo wird gelöscht und steht danach auf keinem Ausdruck mehr. Das lässt sich nicht
            rückgängig machen; ein neues Logo muss erneut hochgeladen werden.
          </Typography.Paragraph>
          <SpeicherFehler fehler={logoEntfernen.error} titel="Logo nicht entfernt" />
        </Space>
      </Modal>
    </AdminPage>
  );
}
