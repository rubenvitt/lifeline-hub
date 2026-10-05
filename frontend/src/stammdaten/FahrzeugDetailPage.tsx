import {
  App,
  AutoComplete,
  Breadcrumb,
  Button,
  Col,
  Form,
  Input,
  InputNumber,
  Row,
  Space,
  Switch,
  theme,
} from 'antd';
import DemoMarke from '../components/DemoMarke';
import { Link, Navigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import AdminPage from '../components/AdminPage';
import { monoStil } from '../components/instrument';
import { SeitenFehler, SeitenLeer, SeitenSkeleton } from '../components/SeitenZustand';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import StaerkeEingabe from '../anzeige/StaerkeEingabe';
import { useAuth } from '../auth/AuthContext';
import {
  aktualisiereFahrzeug,
  ladeFahrzeugVorschlaege,
  listeFahrzeuge,
  type FahrzeugEingabe,
} from '../api/fahrzeuge';
import { globalKeys } from '../api/queryKeys';
// Die Speicherleiste wird WIEDERVERWENDET, nicht nachgebaut: `speicherLeiste` ist die eine
// Stelle, an der „sticky am unteren Rand, im Formular" begründet und geprüft ist.
import { useSpeicherLeiste } from '../components/speicherLeiste';
import VerlassenRueckfrage from '../components/VerlassenRueckfrage';
import { useFormularVerlassenSchutz } from '../components/useFormularVerlassenSchutz';
import { leerZuNull } from '../api/patchTriState';
import { parseRouteId } from '../routing/deeplinks';
import type { Fahrzeug, Staerke } from '../api/types';
import { fahrzeugListePfad } from './stammdatenDetail';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';
import { Formularpaneel } from '../components/instrument';
import { teilwortSuche } from '../components/teilwortSuche';

interface FormWerte {
  funkrufname: string;
  fahrzeugtyp?: string;
  traegerorganisation?: string;
  kennzeichen?: string;
  opta?: string;
  standort?: string;
  fms_issi?: string;
  sondersignal: boolean;
  tragenkapazitaet?: number;
  staerke?: Staerke | null;
  bemerkung?: string;
}

/**
 * Vollseite eines Fahrzeug-Stammdatensatzes (LFH-346, Befund H36).
 *
 * Elf Felder passen nicht in ein Modal (LFH-19); `FahrzeugFormModal` trägt nur die vier
 * Felder, ohne die ein Fahrzeug im Einsatz nicht auffindbar ist. Alles Übrige steht hier.
 *
 * **KEIN eigener Backend-Endpunkt.** `FahrzeugAnzeige` trägt bereits jedes Stammdatenfeld —
 * ein `GET /api/fahrzeuge/{id}` läge Byte für Byte auf der Liste. Die Seite liest deshalb
 * DIESELBE Query wie `FahrzeugeTab` und selektiert die Zeile.
 *
 * **Der Schlüssel muss byte-gleich der des Tabs sein.** `globalKeys.fahrzeugeListe('alle')`
 * ist `['fahrzeuge','alle']`, `globalKeys.fahrzeuge()` dagegen `['fahrzeuge']` — ein anderes
 * Cache-Fach und ein zweiter Request; der argumentlose Accessor ist der INVALIDIERUNGS-Prefix,
 * kein Abrufschlüssel (`api/queryKeys.ts`).
 *
 * Den Nicht-gefunden-Fall erzeugt die Seite selbst: sonst zeigte ein toter Deeplink ein
 * leeres Formular, dessen Speichern einen fremden Datensatz träfe.
 */
export default function FahrzeugDetailPage() {
  const { fahrzeugId } = useParams();
  const id = parseRouteId(fahrzeugId);
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const speicherLeiste = useSpeicherLeiste();
  // Verlassen-Schutz (LFH-979, `frontend/AGENTS.md` „Formularseiten“); `schluessel` wie `key={id}`
  // am Formular.
  const schutz = useFormularVerlassenSchutz({ aktiv: istAdmin, schluessel: id });

  const fahrzeugeQuery = useQuery({
    queryKey: globalKeys.fahrzeugeListe('alle'),
    queryFn: () => listeFahrzeuge(false),
  });
  const vorschlaegeQuery = useQuery({
    queryKey: globalKeys.fahrzeugVorschlaege(),
    queryFn: ladeFahrzeugVorschlaege,
  });

  const fahrzeug = id == null ? undefined : fahrzeugeQuery.data?.find((f) => f.id === id);

  const speichern = useMutation({
    mutationFn: (werte: FormWerte) => aktualisiereFahrzeug(id!, zuEingabe(werte)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: globalKeys.fahrzeuge() });
      qc.invalidateQueries({ queryKey: globalKeys.fahrzeugVorschlaege() });
      message.success('Fahrzeug gespeichert');
    },
    // KEIN `onError`-Toast: der Fehler hängt an `mutation.error` und steht als Alert über dem
    // Formular, bis der nächste Versuch läuft.
  });

  // Eine kaputte Route-ID ist ein toter Link, kein leerer Datensatz (Regel `parseRouteId`).
  if (id == null) return <Navigate to={fahrzeugListePfad()} replace />;
  if (fahrzeugeQuery.isError) {
    return (
      <AdminPage titel="Fahrzeug">
        <SeitenFehler
          text="Fahrzeuge konnten nicht geladen werden"
          ursache={fahrzeugeQuery.error}
          onWiederholen={() => void fahrzeugeQuery.refetch()}
        />
      </AdminPage>
    );
  }
  if (fahrzeugeQuery.isLoading) return <SeitenSkeleton />;
  if (!fahrzeug) {
    /**
     * `SeitenLeer` statt antds `Empty` und statt `components/Platzhalter.tsx` (der trägt ein
     * Emoji im Titel): antds Leer-Element zählt LFH-331 repoweit auf null. `SeitenLeer` bringt den
     * Rückweg als Knopf mit und kommt ohne Bildzeichen aus.
     */
    return (
      <AdminPage titel="Fahrzeug">
        <SeitenLeer
          titel="Fahrzeug nicht gefunden"
          hinweis="Der Datensatz wurde entfernt oder gehört zu einer anderen Organisation."
          aktion={{ label: 'Zur Fahrzeugliste', pfad: fahrzeugListePfad() }}
        />
      </AdminPage>
    );
  }

  const vorschlaege = vorschlaegeQuery.data ?? {
    fahrzeugtyp: [],
    traegerorganisation: [],
    standort: [],
  };

  return (
    <div>
      <VerlassenRueckfrage ungespeichert={schutz.ungespeichert} />
      {/* Brotkrume statt eines zweiten „Zurück"-Knopfes im Kopf: der Aktionen-Slot sichert GENAU
         EINE Primäraktion zu, und die ist hier das Speichern — das im Formular steht. */}
      <Breadcrumb
        style={{ marginBottom: token.marginSM }}
        items={[
          { title: <Link to={fahrzeugListePfad()}>Fahrzeuge</Link> },
          { title: fahrzeug.funkrufname },
        ]}
      />
      <AdminPage
        breite="schmal"
        titel={
          <Space size={8}>
            <span style={monoStil(14, 500)}>{fahrzeug.funkrufname}</span>
            {fahrzeug.ist_demo && <DemoMarke />}
          </Space>
        }
        beschreibung="Vollständige Stammdaten. Die Schnellerfassung in der Liste trägt nur die vier Felder, ohne die ein Fahrzeug nicht auffindbar ist."
        hinweis={
          <SeitenHinweise
            fehler={speichern.error}
            rechteFehlt={!istAdmin}
            rechteText={STAMMDATEN_RECHTE_TEXT}
          />
        }
      >
        {/* `disabled` am Formular sperrt über antds DisabledContext auch den Speichern-Knopf — er
           steht gesperrt DA, statt zu verschwinden. */}
        {/* SEEDING NUR BEIM MOUNT — und `key={id}` für den Wechsel auf einen ANDEREN Datensatz: antds
           `initialValues` wird genau einmal gelesen, ohne den Schlüssel trüge das Formular die Werte
           des vorigen Satzes.

           UND DESHALB STEHT HIER KEIN `Form.useForm()`. Der Schlüssel allein reicht NICHT: eine in der
           Seite gehaltene Instanz liegt AUSSERHALB des gekeyten Teilbaums, ihr rc-field-form-Speicher
           überlebt den Remount und gewinnt gegen die neuen `initialValues` (`preserve` ist per
           Vorgabe an). Ohne die Instanz legt `<Form>` seinen Speicher je `key` selbst an.

           Wer hier `form.validateFields()` o. ä. braucht, holt mit `const [form]` den Fehler zurück —
           dann ist `key={id}` wirkungslos, und nur „trägt nach dem Wechsel auf einen anderen
           Datensatz DESSEN Werte" wird rot. Der Absende-Knopf braucht die Instanz nicht: er liegt als
           `htmlType="submit"` IM `<form>`.

           Ein Effekt, der bei jeder Query-Änderung `setFieldsValue` ruft, gehört NICHT hierher: die
           Query wird auch von FREMDEN Änderungen invalidiert und ersetzte den gerade getippten Text.
           Die Rückgaben oben stellen sicher, dass das Formular erst mit vorhandenem Datensatz montiert. */}
        <Form<FormWerte>
          key={id}
          layout="vertical"
          disabled={!istAdmin}
          onValuesChange={schutz.geaendert}
          initialValues={zuFormWerten(fahrzeug)}
          onFinish={(werte) => {
            const fassung = schutz.fassung();
            speichern.mutate(werte, { onSuccess: () => schutz.gespeichert(fassung) });
          }}
        >
          <Formularpaneel titel="Identität" dataUpdatedAt={fahrzeugeQuery.dataUpdatedAt}>
            <Row gutter={token.margin}>
              <Col xs={24} lg={12}>
                <Form.Item
                  label="Funkrufname"
                  name="funkrufname"
                  rules={[
                    {
                      required: true,
                      whitespace: true,
                      message: 'Funkrufname darf nicht leer sein',
                    },
                  ]}
                >
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} lg={12}>
                <Form.Item label="Fahrzeugtyp" name="fahrzeugtyp">
                  <AutoComplete
                    options={vorschlaege.fahrzeugtyp.map((t) => ({ value: t }))}
                    allowClear
                    placeholder="z. B. LF 20, RTW"
                    showSearch={teilwortSuche}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} lg={12}>
                <Form.Item label="Trägerorganisation" name="traegerorganisation">
                  <AutoComplete
                    options={vorschlaege.traegerorganisation.map((t) => ({ value: t }))}
                    allowClear
                    placeholder="z. B. Feuerwehr Musterstadt"
                    showSearch={teilwortSuche}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} lg={12}>
                <Form.Item label="Kennzeichen" name="kennzeichen">
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} lg={12}>
                <Form.Item label="OPTA" name="opta">
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} lg={12}>
                <Form.Item label="Standort" name="standort">
                  <AutoComplete
                    options={vorschlaege.standort.map((t) => ({ value: t }))}
                    allowClear
                    placeholder="z. B. Wache Mitte"
                    showSearch={teilwortSuche}
                  />
                </Form.Item>
              </Col>
            </Row>
          </Formularpaneel>

          <Formularpaneel titel="Funk & Sonderrechte">
            <Row gutter={token.margin}>
              <Col xs={24} lg={12}>
                <Form.Item label="FMS-ISSI" name="fms_issi">
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} lg={12}>
                <Form.Item label="Sonder-/Wegerecht" name="sondersignal" valuePropName="checked">
                  <Switch />
                </Form.Item>
              </Col>
            </Row>
          </Formularpaneel>

          <Formularpaneel titel="Kapazität">
            <Row gutter={token.margin}>
              <Col xs={24} lg={12}>
                <Form.Item label="Tragenkapazität" name="tragenkapazitaet">
                  <InputNumber min={0} style={{ width: '100%', maxWidth: 160 }} />
                </Form.Item>
              </Col>
              <Col xs={24} lg={12}>
                {/* EIN `Form.Item` für das ganze F/UF/M-Trio — nicht drei. Das Backend prüft die Stärke gegen
                   den EFFEKTIVZUSTAND (Mehrspalten-CHECK „alle drei oder keiner"); verteilt und teilweise
                   gesendet entstünde eine Kombination, die der CHECK ablehnt. */}
                <Form.Item label="Soll-Stärke (alle drei oder keiner)" name="staerke">
                  <StaerkeEingabe />
                </Form.Item>
              </Col>
            </Row>
          </Formularpaneel>

          <Formularpaneel titel="Freitext">
            <Form.Item label="Bemerkung" name="bemerkung">
              <Input.TextArea rows={3} />
            </Form.Item>
          </Formularpaneel>

          {/* Sticky am unteren Rand und IM `<form>`: nur dort trägt der Knopf `htmlType="submit"`, und
             Enter sendet über die eingebaute Formularübermittlung ab. Ein Knopf im Kopf-Slot von
             `AdminPage` läge außerhalb des Formulars. */}
          <div {...speicherLeiste}>
            <Button type="primary" htmlType="submit" loading={speichern.isPending}>
              Speichern
            </Button>
          </div>
        </Form>
      </AdminPage>
    </div>
  );
}

/** Datensatz → Formularwerte (`null → undefined`, sonst zeigt antd keinen Platzhalter). */
function zuFormWerten(f: Fahrzeug): FormWerte {
  return {
    funkrufname: f.funkrufname,
    fahrzeugtyp: f.fahrzeugtyp ?? undefined,
    traegerorganisation: f.traegerorganisation ?? undefined,
    kennzeichen: f.kennzeichen ?? undefined,
    opta: f.opta ?? undefined,
    standort: f.standort ?? undefined,
    fms_issi: f.fms_issi ?? undefined,
    sondersignal: f.sondersignal,
    tragenkapazitaet: f.tragenkapazitaet ?? undefined,
    staerke: f.staerke,
    bemerkung: f.bemerkung ?? undefined,
  };
}

/**
 * Formularwerte → Wire. Diese Seite trägt ALLE elf Felder und schickt den vollen Satz; ein
 * geleertes Feld ist echt gemeint und geht als `null` raus (`leerZuNull`).
 *
 * Anders die Schnellerfassung: sie schickt beim Bearbeiten nur ihre vier sichtbaren Felder,
 * weil ein `null` für ein nicht gezeigtes Feld den Wert löschte (Teil-Patch, LFH-306).
 */
function zuEingabe(w: FormWerte): FahrzeugEingabe {
  return {
    funkrufname: w.funkrufname.trim(),
    fahrzeugtyp: leerZuNull(w.fahrzeugtyp),
    traegerorganisation: leerZuNull(w.traegerorganisation),
    kennzeichen: leerZuNull(w.kennzeichen),
    opta: leerZuNull(w.opta),
    standort: leerZuNull(w.standort),
    fms_issi: leerZuNull(w.fms_issi),
    sondersignal: w.sondersignal ?? false,
    tragenkapazitaet: w.tragenkapazitaet ?? null,
    staerke_fuehrer: w.staerke?.fuehrer ?? null,
    staerke_unterfuehrer: w.staerke?.unterfuehrer ?? null,
    staerke_mannschaft: w.staerke?.mannschaft ?? null,
    bemerkung: leerZuNull(w.bemerkung),
  };
}
