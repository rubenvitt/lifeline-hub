import { App, AutoComplete, Breadcrumb, Button, Col, Form, Input, InputNumber, Row, Switch, theme } from 'antd';
import { useEffect } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import AdminPage from '../components/AdminPage';
import SektionHeader from '../components/SektionHeader';
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
// Die Speicherleiste wird WIEDERVERWENDET, nicht nachgebaut: sie ist seit LFH-345 · C10 die
// eine Stelle, an der „sticky am unteren Rand, im Formular" begründet und geprüft steht.
import { speicherLeisteStil } from '../pages/einstellungen/einsatzEinstellungenForm';
import { leerZuNull } from '../api/patchTriState';
import { parseRouteId } from '../routing/deeplinks';
import type { Fahrzeug, Staerke } from '../api/types';
import { flaeche } from '../theme/tokens';
import { fahrzeugListePfad } from './stammdatenDetail';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';

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
 * Vollseite eines Fahrzeug-Stammdatensatzes (LFH-346 · A7, Befund H36).
 *
 * Elf Felder passen nicht in ein 520-px-Modal (LFH-19: Modal ≤ ~3, Schnellerfassung ≤ ~4);
 * `FahrzeugFormModal` trägt seit A7 nur noch die vier Felder, ohne die ein Fahrzeug im
 * Einsatz nicht auffindbar ist. Alles Übrige steht hier.
 *
 * **KEIN neuer Backend-Endpunkt.** `FahrzeugAnzeige` (`src/fahrzeug/mod.rs:92`) trägt bereits
 * jedes Stammdatenfeld — ein `GET /api/fahrzeuge/{id}` läge Byte für Byte auf dem, was die
 * Liste liefert. Die Seite liest deshalb DIESELBE Query wie `FahrzeugeTab` und selektiert die
 * Zeile.
 *
 * **Der Schlüssel muss dabei byte-gleich der des Tabs sein.** `globalKeys.fahrzeugeListe('alle')`
 * ist `['fahrzeuge','alle']`, `globalKeys.fahrzeuge()` dagegen `['fahrzeuge']` — ein anderes
 * Cache-Fach und damit ein zweiter Request; der argumentlose Accessor ist der
 * INVALIDIERUNGS-Prefix, kein Abrufschlüssel (Konvention in `api/queryKeys.ts`). Die
 * Zusammenführung durch TanStack, auf die dieser Aufbau baut, gibt es nur bei gleichem Key.
 *
 * Den Nicht-gefunden-Fall erzeugt die Seite selbst: ohne ihn zeigte ein toter Deeplink ein
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
  const [form] = Form.useForm<FormWerte>();

  const fahrzeugeQuery = useQuery({
    queryKey: globalKeys.fahrzeugeListe('alle'),
    queryFn: () => listeFahrzeuge(false),
  });
  const vorschlaegeQuery = useQuery({
    queryKey: globalKeys.fahrzeugVorschlaege(),
    queryFn: ladeFahrzeugVorschlaege,
  });

  const fahrzeug = id == null ? undefined : fahrzeugeQuery.data?.find((f) => f.id === id);

  /**
   * Vorbelegung per Effekt statt `initialValues`: die Zeile steht erst nach dem ersten
   * erfolgreichen Abruf zur Verfügung, `initialValues` wird aber genau einmal beim Mount
   * gelesen (derselbe Befund wie in LFH-345 · C10). Ein Formular, das damit leer bliebe,
   * schickte beim nächsten Speichern lauter Leerwerte.
   */
  useEffect(() => {
    if (!fahrzeug) return;
    form.setFieldsValue(zuFormWerten(fahrzeug));
  }, [fahrzeug, form]);

  const speichern = useMutation({
    mutationFn: (werte: FormWerte) => aktualisiereFahrzeug(id!, zuEingabe(werte)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: globalKeys.fahrzeuge() });
      qc.invalidateQueries({ queryKey: globalKeys.fahrzeugVorschlaege() });
      message.success('Fahrzeug gespeichert');
    },
    // KEIN `onError`-Toast (LFH-345 · H14): der Fehler hängt an `mutation.error` und steht
    // als Alert über dem Formular, bis der nächste Versuch läuft.
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
     * `SeitenLeer` statt antds `Empty` — und ausdrücklich nicht `components/Platzhalter.tsx`:
     * der trägt ein Emoji im Titel (Bestandsliste in CLAUDE.md), und die Regel „ein Emoji ist
     * keine Ikone" gilt für Neues. Antds Leer-Element wiederum ist genau der Bezeichner, den
     * LFH-331 · AK3 repoweit auf null zählt; eine brandneue Seite handelt sich die Altlast
     * nicht ein. `SeitenLeer` bringt den Rückweg als Knopf mit und kommt ohne Bildzeichen aus.
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
    <div style={{ maxWidth: flaeche.seiteSchmal, margin: '0 auto' }}>
      {/* Brotkrume statt eines zweiten „Zurück"-Knopfes im Kopf: der Aktionen-Slot sichert
          GENAU EINE Primäraktion zu (LFH-340 · C5), und die ist hier das Speichern — das
          im Formular steht, nicht im Kopf. */}
      <Breadcrumb
        style={{ marginBottom: token.marginSM }}
        items={[
          { title: <Link to={fahrzeugListePfad()}>Fahrzeuge</Link> },
          { title: fahrzeug.funkrufname },
        ]}
      />
      <AdminPage
        titel={fahrzeug.funkrufname}
        beschreibung="Vollständige Stammdaten. Die Schnellerfassung in der Liste trägt nur die vier Felder, ohne die ein Fahrzeug nicht auffindbar ist."
        hinweis={
          <SeitenHinweise
            fehler={speichern.error}
            rechteFehlt={!istAdmin}
            rechteText={STAMMDATEN_RECHTE_TEXT}
          />
        }
      >
        {/* `disabled` am Formular sperrt über antds DisabledContext auch den Speichern-Knopf
            — er steht gesperrt DA, statt zu verschwinden (M16, LFH-345 · C10). Ein fehlender
            Knopf ist von „diese Seite kann das gar nicht" nicht zu unterscheiden. */}
        <Form<FormWerte>
          form={form}
          layout="vertical"
          disabled={!istAdmin}
          initialValues={zuFormWerten(fahrzeug)}
          onFinish={(werte) => speichern.mutate(werte)}
        >
          <SektionHeader titel="Identität" dataUpdatedAt={fahrzeugeQuery.dataUpdatedAt} />
          <Row gutter={token.margin}>
            <Col xs={24} lg={12}>
              <Form.Item
                label="Funkrufname"
                name="funkrufname"
                rules={[{ required: true, whitespace: true, message: 'Funkrufname darf nicht leer sein' }]}
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
                  showSearch={{
                    filterOption: (input, option) =>
                      (option?.value ?? '').toLowerCase().includes(input.toLowerCase()),
                  }}
                />
              </Form.Item>
            </Col>
            <Col xs={24} lg={12}>
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
            </Col>
            <Col xs={24} lg={12}>
              <Form.Item label="Kennzeichen" name="kennzeichen"><Input /></Form.Item>
            </Col>
            <Col xs={24} lg={12}>
              <Form.Item label="OPTA" name="opta"><Input /></Form.Item>
            </Col>
            <Col xs={24} lg={12}>
              <Form.Item label="Standort" name="standort">
                <AutoComplete
                  options={vorschlaege.standort.map((t) => ({ value: t }))}
                  allowClear
                  placeholder="z. B. Wache Mitte"
                  showSearch={{
                    filterOption: (input, option) =>
                      (option?.value ?? '').toLowerCase().includes(input.toLowerCase()),
                  }}
                />
              </Form.Item>
            </Col>
          </Row>

          <SektionHeader titel="Funk & Sonderrechte" />
          <Row gutter={token.margin}>
            <Col xs={24} lg={12}>
              <Form.Item label="FMS-ISSI" name="fms_issi"><Input /></Form.Item>
            </Col>
            <Col xs={24} lg={12}>
              <Form.Item label="Sonder-/Wegerecht" name="sondersignal" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>

          <SektionHeader titel="Kapazität" />
          <Row gutter={token.margin}>
            <Col xs={24} lg={12}>
              <Form.Item label="Tragenkapazität" name="tragenkapazitaet">
                <InputNumber min={0} style={{ width: '100%', maxWidth: 160 }} />
              </Form.Item>
            </Col>
            <Col xs={24} lg={12}>
              {/*
                EIN `Form.Item` für das ganze F/UF/M-Trio — nicht drei.
                `src/routes/fahrzeug.rs:267` prüft die Stärke gegen den EFFEKTIVZUSTAND
                (`staerke_roh`, Mehrspalten-CHECK „alle drei oder keiner"). Eine Maske, die
                die drei Zahlen über Sektionen verteilt und teilweise sendet, kann eine
                Kombination erzeugen, die der CHECK ablehnt — deshalb ein Formular, ein
                Absenden, alle drei Werte.
              */}
              <Form.Item label="Soll-Stärke (alle drei oder keiner)" name="staerke">
                <StaerkeEingabe />
              </Form.Item>
            </Col>
          </Row>

          <SektionHeader titel="Bemerkung" />
          <Form.Item label="Bemerkung" name="bemerkung"><Input.TextArea rows={3} /></Form.Item>

          {/* Sticky am unteren Rand und IM `<form>`: nur dort trägt der Knopf
              `htmlType="submit"`, und Enter sendet über die eingebaute Formularübermittlung
              des Browsers ab (Erfassungs-Norm B4/LFH-332, Bauform aus LFH-345 · C10).
              Ein Knopf im Kopf-Slot von `AdminPage` wäre ein DOM-Geschwister ausserhalb des
              Formulars und könnte nichts übermitteln. */}
          <div style={speicherLeisteStil(token)}>
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
 * Formularwerte → Wire. Diese Seite trägt ALLE elf Felder, schickt also den vollen Satz;
 * ein geleertes Feld ist hier echt gemeint und geht als `null` raus (`leerZuNull`).
 *
 * Das ist der Unterschied zur gekürzten Schnellerfassung: die schickt beim Bearbeiten nur
 * ihre vier sichtbaren Felder, weil ein `null` für ein Feld, das sie gar nicht zeigt, den
 * Wert löschte (der PATCH ist ein echter Teil-Patch, LFH-306).
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
