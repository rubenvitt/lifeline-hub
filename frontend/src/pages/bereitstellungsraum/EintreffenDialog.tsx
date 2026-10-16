import { Alert, App, Button, Collapse, Flex, Form, Input, Modal, Space, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../../api/client';
import {
  EINHEIT_BEMERKUNG_MAX,
  FAHRZEUG_ADHOC_TEXT_MAX,
  SAMMEL_MAX,
} from '../../api/eingabegrenzen';
import { bucheEintreffen } from '../../api/einsatzBereitstellungsraum';
import { listeEinheitenPerioden } from '../../api/kraefteZeitachse';
import { einsatzKeys } from '../../api/queryKeys';
import type {
  BrDetail,
  Einheit,
  EinsatzFahrzeug,
  EintreffenEingabe,
  EintreffenErgebnis,
  Staerke,
} from '../../api/types';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import StaerkeEingabe from '../../anzeige/StaerkeEingabe';
import { useAuthOptional } from '../../auth/AuthContext';
import { ErfassungsFormular, type ErfassungsFormularSteuerung } from '../../components/Erfassung';
import { Liste, ListenEintrag } from '../../components/Liste';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import { zeichenGrenze, zeichenRegel } from '../../components/zeichenGrenze';
import { monoStil, useRollen } from '../../components/instrument';
import AdhocFahrzeugFelder from '../../kraefte/AdhocFahrzeugFelder';
import {
  buildEintreffenEingabe,
  buildEintreffenGruppen,
  findDoppelbuchung,
  kraftEingabe,
  trefferHinweise,
  type EintreffenGruppen,
  type EintreffenTreffer,
} from './eintreffenKern';

/** Die Felder von Schritt 2 (unangemeldete Kraft). */
interface UnangemeldetFormular {
  funkrufname: string;
  traegerorganisation?: string;
  fahrzeugtyp?: string;
  staerke?: Staerke | null;
  bemerkung?: string;
  weitere?: { funkrufname?: string; fahrzeugtyp?: string }[];
}

/** Die Bezeichnung reist nur für die Quittung mit, der Server bekommt allein `daten`. */
interface Buchung {
  daten: EintreffenEingabe;
  name: string;
}

const KLAPP_BEMERKUNG = 'bemerkung';
const KLAPP_WEITERE = 'weitere';

/** Die Felder des Fahrzeugs, das der Einheit ihren Namen gibt (design.md D14). */
const FAHRZEUG_FELDER = ['funkrufname', 'traegerorganisation', 'fahrzeugtyp'] as const;
const KEINE_WEITEREN = [] as const;
const KEINE_GRUPPEN: EintreffenGruppen = { erwartet: [], imEinsatz: [] };

/** 422 „… ist schon im Einsatz“ (D9): die Serverprüfung fand eine gleichnamige Kraft. */
function istDoppelbuchung(fehler: unknown): boolean {
  return (
    fehler instanceof ApiError &&
    fehler.status === 422 &&
    /ist schon im Einsatz/.test(fehler.message)
  );
}

function kurz(text: string, max = 30): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export interface EintreffenDialogProps {
  einsatzId: number;
  /** Der Raum; seine Kräfte stehen nicht zur Wahl, auch wenn die Listen sie noch frei führen. */
  br: Pick<BrDetail, 'id' | 'einheiten' | 'fahrzeuge'>;
  einheiten: readonly Einheit[];
  fahrzeuge: readonly EinsatzFahrzeug[];
  offen: boolean;
  onClose: () => void;
  /** Nach einer Buchung, vor der Invalidierung: die eigene Anmeldung steht sofort. */
  onGebucht?: (ergebnis: EintreffenErgebnis) => void;
}

/**
 * „Eintreffen buchen“ am Bereitstellungsraum (LLH-1075, design.md D14). Schritt 1 sucht in den
 * Kräften des Einsatzes und bucht einen Treffer mit einem Tipp; „Nicht in der Liste“ führt zu
 * Schritt 2, der eine unangemeldete Kraft mit dem Suchtext als Funkrufnamen anlegt. Am Gerät
 * vollflächig. Ablehnungen stehen im Dialog (`SpeicherFehler`), kein Fehler-Toast.
 */
export default function EintreffenDialog({
  einsatzId,
  br,
  einheiten,
  fahrzeuge,
  offen,
  onClose,
  onGebucht,
}: EintreffenDialogProps) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { token, rollen } = useRollen();
  const { formatZeitKurz } = useAnzeigeKonventionen();
  const amGeraet = useAuthOptional()?.geraet != null;
  const [form] = Form.useForm<UnangemeldetFormular>();
  const [schritt, setSchritt] = useState<'suche' | 'neu'>('suche');
  const [suche, setSuche] = useState('');
  const [klappOffen, setKlappOffen] = useState<string[]>([]);
  const trotzdemRef = useRef(false);
  const steuerung = useRef<ErfassungsFormularSteuerung>(null);
  const sucheRef = useRef<HTMLInputElement>(null);

  // Perioden je Einheit: wer in der offenen Periode schon eingetroffen ist, ist nicht „erwartet“.
  // Ohne Antwort zählt nur der Abschnitt (die Liste bleibt bedienbar).
  const periodenQuery = useQuery({
    queryKey: einsatzKeys.kraefteZeitachseEinheiten(einsatzId),
    queryFn: () => listeEinheitenPerioden(einsatzId),
    enabled: offen,
  });

  const imRaum = useMemo(
    () => ({
      einheiten: br.einheiten.map((e) => e.id),
      fahrzeuge: br.fahrzeuge.map((f) => f.id),
    }),
    [br.einheiten, br.fahrzeuge],
  );
  // Geschlossen rechnet der Dialog nichts: er hängt dauerhaft an der Seite des Raums.
  const alle = useMemo(
    () =>
      offen
        ? buildEintreffenGruppen({ einheiten, fahrzeuge, perioden: periodenQuery.data, imRaum })
        : KEINE_GRUPPEN,
    [offen, einheiten, fahrzeuge, periodenQuery.data, imRaum],
  );
  const gruppen = useMemo(
    () =>
      offen
        ? buildEintreffenGruppen({
            einheiten,
            fahrzeuge,
            perioden: periodenQuery.data,
            imRaum,
            suche,
          })
        : KEINE_GRUPPEN,
    [offen, einheiten, fahrzeuge, periodenQuery.data, imRaum, suche],
  );

  const buchung = useMutation({
    mutationFn: ({ daten }: Buchung) => bucheEintreffen(einsatzId, br.id, daten),
    onSuccess: (ergebnis, b) => {
      message.success(
        ergebnis.unangemeldet
          ? `${b.name} unangemeldet gebucht, Einsatzleitung informiert`
          : `${b.name} gebucht`,
      );
      onGebucht?.(ergebnis);
      for (const key of [
        einsatzKeys.br(einsatzId),
        einsatzKeys.brDetail(einsatzId, br.id),
        einsatzKeys.brVerlauf(einsatzId, br.id),
        einsatzKeys.einheiten(einsatzId),
        einsatzKeys.fahrzeuge(einsatzId),
        einsatzKeys.kraefteZeitachse(einsatzId),
        einsatzKeys.meldungen(einsatzId),
        einsatzKeys.etb(einsatzId),
      ]) {
        qc.invalidateQueries({ queryKey: key });
      }
    },
  });

  function schliessen() {
    setSchritt('suche');
    setSuche('');
    setKlappOffen([]);
    trotzdemRef.current = false;
    buchung.reset();
    onClose();
  }

  function bucheTreffer(t: EintreffenTreffer, nachher?: () => void) {
    buchung.mutate(
      { daten: kraftEingabe(t), name: t.name },
      {
        onSuccess: () => {
          nachher?.();
          schliessen();
        },
      },
    );
  }

  function zuSchrittZwei() {
    buchung.reset();
    // Der Speicher von `form` überlebt das Aushängen von Schritt 2 (Zurück, Schließen) und gewänne
    // beim Einhängen gegen `initialValues` (Falle wie an `ErfassungsModal`): Schritt 2 beginnt
    // deshalb hier leer mit dem aktuellen Suchtext.
    form.resetFields();
    form.setFieldsValue({ funkrufname: suche.trim() });
    setSchritt('neu');
  }

  // Ein Ausweg (Kreuz, Maske, Escape) während der Buchung bliebe ohne Ort für die Antwort.
  const sperrtAbbruch = buchung.isPending;
  function aufAbbruch() {
    if (schritt === 'neu' && steuerung.current) steuerung.current.abbrechen();
    else if (!sperrtAbbruch) schliessen();
  }

  const funkrufname = Form.useWatch('funkrufname', form) ?? '';
  const doppel =
    schritt === 'neu'
      ? findDoppelbuchung(funkrufname, { einheiten, fahrzeuge, kandidaten: alle })
      : null;
  const serverDoppel = schritt === 'neu' && istDoppelbuchung(buchung.error);
  const bemerkung = Form.useWatch('bemerkung', form) as string | undefined;
  const weitere = (Form.useWatch('weitere', form) ?? []) as UnangemeldetFormular['weitere'];
  const weitereNamen = (weitere ?? []).map((w) => w?.funkrufname?.trim()).filter(Boolean);

  function trotzdemAnlegen() {
    trotzdemRef.current = true;
    form.submit();
  }

  const trefferZeile = (t: EintreffenTreffer) => {
    const hinweise = trefferHinweise(t, formatZeitKurz);
    return (
      <ListenEintrag
        actions={[
          <Button
            key="eintreffen"
            aria-label={`Eintreffen ${t.name}`}
            onClick={() => bucheTreffer(t)}
            loading={
              buchung.isPending &&
              buchung.variables?.daten.kraft?.objekt_id === t.id &&
              buchung.variables.daten.kraft.objekt_typ === t.art
            }
            disabled={buchung.isPending}
          >
            Eintreffen
          </Button>,
        ]}
      >
        <Flex vertical gap={2} style={{ minWidth: 0 }}>
          <Space size={token.marginXS} wrap>
            <span>{t.name}</span>
            {t.typ && <Typography.Text type="secondary">{t.typ}</Typography.Text>}
          </Space>
          {t.funkrufnamen.length > 0 && (
            <span style={{ ...monoStil(12), color: rollen.gedaempft }}>
              {t.funkrufnamen.join(' · ')}
            </span>
          )}
          {hinweise.length > 0 && (
            <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
              {hinweise.join(' · ')}
            </Typography.Text>
          )}
        </Flex>
      </ListenEintrag>
    );
  };

  const gruppe = (titel: string, treffer: readonly EintreffenTreffer[]): ReactNode =>
    treffer.length > 0 && (
      <section aria-label={titel} style={{ marginTop: token.marginSM }}>
        <Typography.Text strong>
          {titel} <Typography.Text type="secondary">{treffer.length}</Typography.Text>
        </Typography.Text>
        <Liste dataSource={treffer} rowKey={(t) => `${t.art}-${t.id}`} renderItem={trefferZeile} />
      </section>
    );

  const schrittEins = (
    <Flex vertical gap={token.marginSM}>
      <Input
        ref={(el) => {
          sucheRef.current = el?.input ?? null;
        }}
        type="search"
        aria-label="Suche"
        placeholder="Name oder Funkrufname"
        autoFocus
        allowClear
        value={suche}
        onChange={(e) => setSuche(e.target.value)}
      />
      <SpeicherFehler
        fehler={buchung.error}
        titel="Nicht gebucht"
        fallback="Buchen fehlgeschlagen"
      />
      <div>
        {gruppe('Erwartet', gruppen.erwartet)}
        {gruppe('Im Einsatz', gruppen.imEinsatz)}
        {gruppen.erwartet.length + gruppen.imEinsatz.length === 0 && (
          <Typography.Text type="secondary">Keine Treffer</Typography.Text>
        )}
      </div>
      <Button block onClick={zuSchrittZwei}>
        Nicht in der Liste
      </Button>
    </Flex>
  );

  const schrittZwei = (
    <>
      <Button type="link" onClick={() => setSchritt('suche')} style={{ paddingInline: 0 }}>
        Zurück zur Suche
      </Button>
      <ErfassungsFormular<UnangemeldetFormular>
        form={form}
        initialValues={{ funkrufname: suche.trim() }}
        steuerungRef={steuerung}
        erfassenText="Unangemeldet buchen"
        gesperrt={doppel != null}
        speicherung={buchung}
        speicherFehlerTitel="Nicht gebucht"
        speicherFehlerFallback="Buchen fehlgeschlagen"
        onErfassen={(w) => {
          const trotzdem = trotzdemRef.current;
          trotzdemRef.current = false;
          return buchung.mutateAsync({
            daten: buildEintreffenEingabe(w, { trotzdemAnlegen: trotzdem }),
            name: w.funkrufname.trim(),
          });
        }}
        onPruefungGescheitert={(felder) => {
          const auf = new Set(klappOffen);
          if (felder.includes('bemerkung')) auf.add(KLAPP_BEMERKUNG);
          if (felder.some((f) => f.startsWith('weitere'))) auf.add(KLAPP_WEITERE);
          setKlappOffen([...auf]);
          trotzdemRef.current = false;
        }}
        onFertig={schliessen}
        onAbbrechen={schliessen}
      >
        <AdhocFahrzeugFelder
          felder={FAHRZEUG_FELDER}
          weitere={KEINE_WEITEREN}
          weitereOffen={false}
          onWeitereOffen={() => {}}
        />
        <Form.Item label="Stärke" name="staerke">
          <StaerkeEingabe />
        </Form.Item>
        {/* `forceRender`: ein eingetragener und wieder zugeklappter Wert geht mit; der Kopf nennt
            ihn (wie `AdhocFahrzeugFelder`, LFH-974). */}
        <Collapse
          ghost
          activeKey={klappOffen}
          onChange={(keys) => setKlappOffen(Array.isArray(keys) ? keys : [keys])}
          items={[
            {
              key: KLAPP_BEMERKUNG,
              forceRender: true,
              label: (
                <Space size={4} wrap>
                  <span>Bemerkung</span>
                  {bemerkung?.trim() && (
                    <Typography.Text type="secondary">· {kurz(bemerkung.trim())}</Typography.Text>
                  )}
                </Space>
              ),
              children: (
                <Form.Item
                  name="bemerkung"
                  rules={[zeichenRegel(EINHEIT_BEMERKUNG_MAX, 'Bemerkung')]}
                >
                  <Input.TextArea
                    aria-label="Bemerkung"
                    autoSize={{ minRows: 2, maxRows: 6 }}
                    count={zeichenGrenze(EINHEIT_BEMERKUNG_MAX)}
                  />
                </Form.Item>
              ),
            },
            {
              key: KLAPP_WEITERE,
              forceRender: true,
              label: (
                <Space size={4} wrap>
                  <span>Weiteres Fahrzeug</span>
                  {weitereNamen.length > 0 && (
                    <Typography.Text type="secondary">· {weitereNamen.join(', ')}</Typography.Text>
                  )}
                </Space>
              ),
              children: (
                <Form.List name="weitere">
                  {(zeilen, { add, remove }) => (
                    <Flex vertical gap={token.marginSM}>
                      {zeilen.map((z, i) => (
                        <Flex key={z.key} gap={token.marginSM} align="start" wrap>
                          <Form.Item
                            name={[z.name, 'funkrufname']}
                            rules={[zeichenRegel(FAHRZEUG_ADHOC_TEXT_MAX, 'Funkrufname')]}
                            style={{ flex: '2 1 180px', marginBottom: 0 }}
                          >
                            <Input
                              aria-label={`Funkrufname weiteres Fahrzeug ${i + 1}`}
                              placeholder="Funkrufname"
                              count={zeichenGrenze(FAHRZEUG_ADHOC_TEXT_MAX)}
                            />
                          </Form.Item>
                          <Form.Item
                            name={[z.name, 'fahrzeugtyp']}
                            rules={[zeichenRegel(FAHRZEUG_ADHOC_TEXT_MAX, 'Fahrzeugtyp')]}
                            style={{ flex: '1 1 120px', marginBottom: 0 }}
                          >
                            <Input
                              aria-label={`Fahrzeugtyp weiteres Fahrzeug ${i + 1}`}
                              placeholder="Fahrzeugtyp"
                              count={zeichenGrenze(FAHRZEUG_ADHOC_TEXT_MAX)}
                            />
                          </Form.Item>
                          <Button
                            danger
                            aria-label={`Fahrzeug ${i + 1} entfernen`}
                            onClick={() => remove(z.name)}
                          >
                            entfernen
                          </Button>
                        </Flex>
                      ))}
                      {zeilen.length < SAMMEL_MAX - 1 && (
                        <Button onClick={() => add({})} style={{ alignSelf: 'flex-start' }}>
                          Fahrzeug hinzufügen
                        </Button>
                      )}
                    </Flex>
                  )}
                </Form.List>
              ),
            },
          ]}
        />
        {(doppel != null || serverDoppel) && (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: token.marginSM }}
            title={doppel ? `Schon im Einsatz: ${doppel.name}` : 'Schon im Einsatz'}
            // Unter dem Titel statt daneben: bei 390 px drückte die Knopfreihe den Titel auf null.
            description={
              <Space size="middle" wrap>
                {doppel?.treffer && (
                  <Button
                    onClick={() => bucheTreffer(doppel.treffer!, () => form.resetFields())}
                    loading={buchung.isPending && buchung.variables?.daten.kraft != null}
                  >
                    Diese buchen
                  </Button>
                )}
                <Button onClick={trotzdemAnlegen} disabled={buchung.isPending}>
                  Trotzdem neu anlegen
                </Button>
              </Space>
            }
          />
        )}
      </ErfassungsFormular>
    </>
  );

  return (
    <Modal
      open={offen}
      title="Eintreffen buchen"
      onCancel={aufAbbruch}
      closable={sperrtAbbruch ? { disabled: true } : true}
      mask={{ closable: !sperrtAbbruch }}
      footer={null}
      destroyOnHidden
      // Schritt 2 trägt Escape über die Tastaturebene der Erfassung.
      keyboard={schritt === 'suche' && !sperrtAbbruch}
      afterOpenChange={(auf) => {
        if (auf && schritt === 'suche') sucheRef.current?.focus();
      }}
      {...(amGeraet
        ? {
            width: '100%',
            style: { top: 0, maxWidth: '100vw', margin: 0, paddingBottom: 0 },
            styles: { container: { minHeight: '100dvh', borderRadius: 0 } },
          }
        : {})}
    >
      {schritt === 'suche' ? schrittEins : schrittZwei}
    </Modal>
  );
}
