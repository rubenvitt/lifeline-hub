import { Alert, App, Button, Collapse, Flex, Form, Input, Modal, Space, Typography } from 'antd';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../../api/client';
import {
  EINHEIT_BEMERKUNG_MAX,
  FAHRZEUG_ADHOC_TEXT_MAX,
  SAMMEL_MAX,
} from '../../api/eingabegrenzen';
import { loadBrErwartet, loadBrStammTreffer } from '../../api/einsatzBereitstellungsraum';
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
import DemoMarke from '../../components/DemoMarke';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import { zeichenGrenze, zeichenRegel } from '../../components/zeichenGrenze';
import { monoStil, useRollen } from '../../components/instrument';
import AdhocFahrzeugFelder from '../../kraefte/AdhocFahrzeugFelder';
import { eintreffenQueryKeys } from '../../bereitstellungsraum/eintreffenQueryKeys';
import { erfasseEintreffenOfflineFaehig } from '../../offline/schreiben';
import {
  buildEintreffenEingabe,
  buildEintreffenGruppen,
  buildNachgefordertZeilen,
  buildStammZeilen,
  findDoppelbuchung,
  kraftEingabe,
  nachgefordertHinweise,
  nachgefordertZiel,
  stammHinweise,
  stammSuche,
  trefferHinweise,
  vorlageEingabe,
  type EintreffenGruppen,
  type EintreffenTreffer,
  type NachgefordertZeile,
  type StammZeile,
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
const KEINE_VORGEMERKT: readonly EintreffenEingabe[] = [];

/** Beschriftung einer Zeile „Aus Nachforderungen“: Rufname, sonst die Art „ohne Rufname“. */
function zeilenName(z: NachgefordertZeile): string {
  return z.rufname ?? `${z.art} ohne Rufname`;
}

/** 422 „… ist schon im Einsatz“ (D9): die Serverprüfung fand eine gleichnamige Kraft. */
function isDoppelbuchung(fehler: unknown): boolean {
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
  /** Besitzer der Offline-Queue, in die eine Buchung ohne Netz geht (Teil III). */
  benutzerId: number | undefined;
  /** Der Raum; seine Kräfte stehen nicht zur Wahl, auch wenn die Listen sie noch frei führen. */
  br: Pick<BrDetail, 'id' | 'bezeichnung' | 'einheiten' | 'fahrzeuge'>;
  einheiten: readonly Einheit[];
  fahrzeuge: readonly EinsatzFahrzeug[];
  /**
   * Ohne Netz vorgemerkte Buchungen dieses Geräts im Einsatz (Teil III): der Server kennt sie
   * noch nicht, der Dialog bietet sie deshalb nicht erneut zum Buchen an.
   */
  vorgemerkt?: readonly EintreffenEingabe[];
  offen: boolean;
  onClose: () => void;
  /** Nach einer Buchung beim Server, vor der Invalidierung: die eigene Anmeldung steht sofort. */
  onGebucht?: (ergebnis: EintreffenErgebnis) => void;
}

/**
 * „Eintreffen buchen“ am Bereitstellungsraum (LLH-1075, design.md D14). Schritt 1 sucht in den
 * Kräften des Einsatzes und bucht einen Treffer mit einem Tipp; „Nicht in der Liste“ führt zu
 * Schritt 2, der eine unangemeldete Kraft mit dem Suchtext als Funkrufnamen anlegt. Am Gerät
 * vollflächig. Ablehnungen stehen im Dialog (`SpeicherFehler`), kein Fehler-Toast.
 *
 * Über „Erwartet“ steht „Aus Nachforderungen“ (LLH-1387, design.md D6): die offenen Rufnamen der
 * Nachforderungen mit Ziel = dieser Raum. Eine Zeile bucht die gleichnamige Einheit oder führt
 * vorbelegt zu Schritt 2; beide Wege senden den Verweis `nachforderung_id`. Ohne Freigabe (403)
 * oder ohne Netz fehlt die Gruppe still.
 *
 * Unter „Im Einsatz“ steht ab drei Zeichen „Aus den Stammdaten“ (LLH-1300, design.md D6): die
 * Einheiten-Vorlagen der Organisation aus der Projektion `…/stamm-treffer` (das Gerät liest den
 * Katalog nicht). „Eintreffen“ bildet die Einheit aus der Vorlage und bucht sie mit einem Tipp. Ohne
 * Netz oder Freigabe fehlt die Gruppe still.
 *
 * Ohne Netz (Teil III, `frontend/src/offline/AGENTS.md`, „Schreiben ohne Netz“) geht die Buchung
 * mit `client_id` in die Offline-Queue: Hinweis „Offline vorgemerkt“, der Dialog schließt, die
 * Seite zeigt sie unter „Vorgemerkt“. Eine Ablehnung beim Nachsenden landet im
 * Wiederherstellungsbereich, nicht hier.
 */
export default function EintreffenDialog({
  einsatzId,
  benutzerId,
  br,
  einheiten,
  fahrzeuge,
  vorgemerkt = KEINE_VORGEMERKT,
  offen,
  onClose,
  onGebucht,
}: EintreffenDialogProps) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { token, rollen } = useRollen();
  const { zeitKurz } = useAnzeigeKonventionen();
  const amGeraet = useAuthOptional()?.geraet != null;
  const [form] = Form.useForm<UnangemeldetFormular>();
  const [schritt, setSchritt] = useState<'suche' | 'neu'>('suche');
  const [suche, setSuche] = useState('');
  const [klappOffen, setKlappOffen] = useState<string[]>([]);
  // Die Nachforderung, aus der Schritt 2 eine Kraft anlegt (LLH-1387); `null` = unangemeldet.
  const [herkunft, setHerkunft] = useState<NachgefordertZeile | null>(null);
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

  // Erwartete Kräfte aus Nachforderungen (LLH-1387): ohne Freigabe 403, dann ohne Gruppe.
  const erwartetQuery = useQuery({
    queryKey: einsatzKeys.brErwartet(einsatzId, br.id),
    queryFn: () => loadBrErwartet(einsatzId, br.id),
    enabled: offen,
    retry: false,
  });

  // Stamm-Treffer (LLH-1300): erst ab drei Zeichen; die letzte Antwort bleibt beim Weitertippen
  // stehen, damit die Liste nicht springt. Ohne Netz oder Freigabe fehlt die Gruppe.
  const stammText = stammSuche(suche);
  const stammQuery = useQuery({
    queryKey: einsatzKeys.brStammTreffer(einsatzId, br.id, stammText ?? ''),
    queryFn: () => loadBrStammTreffer(einsatzId, br.id, stammText ?? ''),
    enabled: offen && stammText != null,
    retry: false,
    placeholderData: keepPreviousData,
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
        ? buildEintreffenGruppen({
            einheiten,
            fahrzeuge,
            perioden: periodenQuery.data,
            imRaum,
            vorgemerkt,
          })
        : KEINE_GRUPPEN,
    [offen, einheiten, fahrzeuge, periodenQuery.data, imRaum, vorgemerkt],
  );
  const gruppen = useMemo(
    () =>
      offen
        ? buildEintreffenGruppen({
            einheiten,
            fahrzeuge,
            perioden: periodenQuery.data,
            imRaum,
            vorgemerkt,
            suche,
          })
        : KEINE_GRUPPEN,
    [offen, einheiten, fahrzeuge, periodenQuery.data, imRaum, vorgemerkt, suche],
  );

  const nachgefordert = useMemo(
    () =>
      offen && erwartetQuery.data
        ? buildNachgefordertZeilen(erwartetQuery.data, suche).map((z) => ({
            zeile: z,
            ziel: nachgefordertZiel(z, { einheiten, fahrzeuge, kandidaten: alle, vorgemerkt }),
          }))
        : [],
    [offen, erwartetQuery.data, suche, einheiten, fahrzeuge, alle, vorgemerkt],
  );
  const stammZeilen = useMemo(
    () =>
      offen && stammText != null && stammQuery.data
        ? buildStammZeilen(stammQuery.data, { einheiten, fahrzeuge, kandidaten: alle, vorgemerkt })
        : [],
    [offen, stammText, stammQuery.data, einheiten, fahrzeuge, alle, vorgemerkt],
  );
  // Eine Einheit, die eine Zeile „Aus Nachforderungen“ bucht, steht nicht noch einmal darunter.
  const angeboten = useMemo(
    () =>
      new Set(
        nachgefordert.flatMap(({ ziel }) =>
          ziel.art === 'buchen' ? [`${ziel.treffer.art}-${ziel.treffer.id}`] : [],
        ),
      ),
    [nachgefordert],
  );
  const ohneAngebotene = (treffer: readonly EintreffenTreffer[]) =>
    angeboten.size === 0 ? treffer : treffer.filter((t) => !angeboten.has(`${t.art}-${t.id}`));
  const erwartetTreffer = ohneAngebotene(gruppen.erwartet);
  const imEinsatzTreffer = ohneAngebotene(gruppen.imEinsatz);

  const buchung = useMutation({
    // Die Funktion merkt ohne Netz selbst vor; TanStacks Vorgabe hielte die Mutation an
    // (`frontend/src/offline/AGENTS.md`, „Schreiben ohne Netz“).
    networkMode: 'always',
    mutationFn: ({ daten, name }: Buchung) => {
      // Ohne Besitzer läge die Vormerkung keinem Benutzer zugeordnet in der Queue.
      if (benutzerId == null) throw new Error('Nicht angemeldet');
      return erfasseEintreffenOfflineFaehig(
        benutzerId,
        einsatzId,
        { id: br.id, bezeichnung: br.bezeichnung },
        name,
        daten,
      );
    },
    onSuccess: (ergebnis, b) => {
      if (ergebnis.zustand === 'vorgemerkt') {
        message.warning(`Offline vorgemerkt: Eintreffen ${b.name}`);
        return;
      }
      message.success(
        !ergebnis.daten.unangemeldet
          ? `${b.name} gebucht`
          : b.daten.nachforderung_id != null
            ? `${b.name} gebucht, Einsatzleitung informiert`
            : `${b.name} unangemeldet gebucht, Einsatzleitung informiert`,
      );
      onGebucht?.(ergebnis.daten);
      for (const queryKey of eintreffenQueryKeys(einsatzId, br.id)) {
        qc.invalidateQueries({ queryKey });
      }
    },
  });

  function close() {
    setSchritt('suche');
    setSuche('');
    setKlappOffen([]);
    setHerkunft(null);
    trotzdemRef.current = false;
    buchung.reset();
    onClose();
  }

  /** Bucht eine bekannte Kraft; mit `nachforderungId` trägt sie den Verweis (LLH-1396). */
  function bucheTreffer(t: EintreffenTreffer, nachher?: () => void, nachforderungId?: number) {
    buchung.mutate(
      {
        daten: {
          ...kraftEingabe(t),
          ...(nachforderungId != null ? { nachforderung_id: nachforderungId } : {}),
        },
        name: t.name,
      },
      {
        onSuccess: () => {
          nachher?.();
          close();
        },
      },
    );
  }

  function zuSchrittZwei(aus: NachgefordertZeile | null = null) {
    buchung.reset();
    // Der Speicher von `form` überlebt das Aushängen von Schritt 2 (Zurück, Schließen) und gewänne
    // beim Einhängen gegen `initialValues` (Falle wie an `ErfassungsModal`): Schritt 2 beginnt
    // deshalb hier leer mit dem aktuellen Suchtext, aus einer Nachforderung mit Rufname und Art.
    form.resetFields();
    form.setFieldsValue(
      aus
        ? { funkrufname: aus.rufname ?? '', fahrzeugtyp: aus.art }
        : { funkrufname: suche.trim() },
    );
    setHerkunft(aus);
    setSchritt('neu');
  }

  function bucheNachgefordert({ zeile, ziel }: (typeof nachgefordert)[number]) {
    if (ziel.art === 'buchen') {
      buchung.mutate(
        {
          daten: { ...kraftEingabe(ziel.treffer), nachforderung_id: zeile.nachforderungId },
          name: ziel.treffer.name,
        },
        { onSuccess: () => close() },
      );
    } else if (ziel.art === 'neu') {
      zuSchrittZwei(zeile);
    }
  }

  function bucheStamm(z: StammZeile) {
    buchung.mutate(
      { daten: vorlageEingabe(z.treffer), name: z.treffer.name },
      { onSuccess: () => close() },
    );
  }

  // Ein Ausweg (Kreuz, Maske, Escape) während der Buchung bliebe ohne Ort für die Antwort.
  const sperrtAbbruch = buchung.isPending;
  function aufAbbruch() {
    if (schritt === 'neu' && steuerung.current) steuerung.current.abbrechen();
    else if (!sperrtAbbruch) close();
  }

  const funkrufname = Form.useWatch('funkrufname', form) ?? '';
  const doppel =
    schritt === 'neu'
      ? findDoppelbuchung(funkrufname, { einheiten, fahrzeuge, kandidaten: alle, vorgemerkt })
      : null;
  const serverDoppel = schritt === 'neu' && isDoppelbuchung(buchung.error);
  // Aus einer Nachforderung trägt „Diese buchen“ den Verweis mit (LLH-1396), auch bei einem
  // Fahrzeug ohne Einheit: der Server macht es dabei zur Einheit (LLH-1444).
  const doppelVerweis = herkunft != null && doppel?.treffer ? herkunft.nachforderungId : undefined;
  const bemerkung = Form.useWatch('bemerkung', form) as string | undefined;
  const weitere = (Form.useWatch('weitere', form) ?? []) as UnangemeldetFormular['weitere'];
  const weitereNamen = (weitere ?? []).map((w) => w?.funkrufname?.trim()).filter(Boolean);

  function trotzdemAnlegen() {
    trotzdemRef.current = true;
    form.submit();
  }

  const trefferZeile = (t: EintreffenTreffer) => {
    const hinweise = trefferHinweise(t, zeitKurz);
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
            // Ohne Netz schon vorgemerkt: ein zweiter Tipp reihte eine zweite Buchung ein. Der
            // Grund steht als „vorgemerkt …“ in den Hinweisen der Zeile.
            disabled={buchung.isPending || t.vorgemerktAt != null}
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

  const nachgefordertZeile = ({ zeile, ziel }: (typeof nachgefordert)[number]) => {
    const hinweise = nachgefordertHinweise(zeile, zeitKurz);
    if (ziel.art === 'vorgemerkt') hinweise.unshift('vorgemerkt');
    return (
      <ListenEintrag
        actions={[
          <Button
            key="eintreffen"
            aria-label={`Eintreffen ${zeilenName(zeile)}`}
            onClick={() => bucheNachgefordert({ zeile, ziel })}
            loading={
              buchung.isPending &&
              buchung.variables?.daten.nachforderung_id === zeile.nachforderungId &&
              buchung.variables.daten.kraft != null &&
              ziel.art === 'buchen' &&
              buchung.variables.daten.kraft.objekt_id === ziel.treffer.id
            }
            // Ohne Netz schon vorgemerkt: ein zweiter Tipp reihte eine zweite Buchung ein.
            disabled={buchung.isPending || ziel.art === 'vorgemerkt'}
          >
            Eintreffen
          </Button>,
        ]}
      >
        <Flex vertical gap={2} style={{ minWidth: 0 }}>
          <Space size={token.marginXS} wrap>
            <span>{zeilenName(zeile)}</span>
            {zeile.rufname != null && (
              <Typography.Text type="secondary">{zeile.art}</Typography.Text>
            )}
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            {hinweise.join(' · ')}
          </Typography.Text>
        </Flex>
      </ListenEintrag>
    );
  };

  const stammZeile = (z: StammZeile) => {
    const t = z.treffer;
    const hinweise = stammHinweise(z, zeitKurz);
    return (
      <ListenEintrag
        actions={[
          <Button
            key="eintreffen"
            aria-label={`Eintreffen ${t.name}`}
            onClick={() => bucheStamm(z)}
            loading={
              buchung.isPending && buchung.variables?.daten.vorlage?.vorlage_id === t.vorlage_id
            }
            // Ohne Netz schon vorgemerkt: ein zweiter Tipp bildete eine zweite Einheit.
            disabled={buchung.isPending || z.vorgemerktAt != null}
          >
            Eintreffen
          </Button>,
        ]}
      >
        <Flex vertical gap={2} style={{ minWidth: 0 }}>
          <Space size={token.marginXS} wrap>
            <span>{t.name}</span>
            <Typography.Text type="secondary">{t.typ_label}</Typography.Text>
            {t.ist_demo && <DemoMarke />}
          </Space>
          {t.fahrzeuge.length > 0 && (
            <span style={{ ...monoStil(12), color: rollen.gedaempft }}>
              {t.fahrzeuge.join(' · ')}
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

  const gruppeStamm: ReactNode = stammZeilen.length > 0 && (
    <section aria-label="Aus den Stammdaten" style={{ marginTop: token.marginSM }}>
      <Typography.Text strong>
        Aus den Stammdaten <Typography.Text type="secondary">{stammZeilen.length}</Typography.Text>
      </Typography.Text>
      <Liste
        dataSource={stammZeilen}
        rowKey={(z) => String(z.treffer.vorlage_id)}
        renderItem={stammZeile}
      />
    </section>
  );

  const gruppeNachgefordert: ReactNode = nachgefordert.length > 0 && (
    <section aria-label="Aus Nachforderungen" style={{ marginTop: token.marginSM }}>
      <Typography.Text strong>
        Aus Nachforderungen{' '}
        <Typography.Text type="secondary">{nachgefordert.length}</Typography.Text>
      </Typography.Text>
      <Liste
        dataSource={nachgefordert}
        rowKey={(n) => n.zeile.schluessel}
        renderItem={nachgefordertZeile}
      />
    </section>
  );

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
        {gruppeNachgefordert}
        {gruppe('Erwartet', erwartetTreffer)}
        {gruppe('Im Einsatz', imEinsatzTreffer)}
        {gruppeStamm}
        {nachgefordert.length +
          erwartetTreffer.length +
          imEinsatzTreffer.length +
          stammZeilen.length ===
          0 && <Typography.Text type="secondary">Keine Treffer</Typography.Text>}
      </div>
      <Button block onClick={() => zuSchrittZwei()}>
        Nicht in der Liste
      </Button>
    </Flex>
  );

  const schrittZwei = (
    <>
      <Button
        type="link"
        onClick={() => {
          setHerkunft(null);
          setSchritt('suche');
        }}
        style={{ paddingInline: 0 }}
      >
        Zurück zur Suche
      </Button>
      {herkunft && (
        <Typography.Paragraph type="secondary">
          {`Aus Nachforderung ${herkunft.kurz}`}
        </Typography.Paragraph>
      )}
      <ErfassungsFormular<UnangemeldetFormular>
        form={form}
        initialValues={{ funkrufname: suche.trim() }}
        steuerungRef={steuerung}
        erfassenText={herkunft ? 'Eintreffen buchen' : 'Unangemeldet buchen'}
        gesperrt={doppel != null}
        speicherung={buchung}
        speicherFehlerTitel="Nicht gebucht"
        speicherFehlerFallback="Buchen fehlgeschlagen"
        onErfassen={(w) => {
          const trotzdem = trotzdemRef.current;
          trotzdemRef.current = false;
          return buchung.mutateAsync({
            daten: buildEintreffenEingabe(w, {
              trotzdemAnlegen: trotzdem,
              nachforderungId: herkunft?.nachforderungId,
            }),
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
        onFertig={close}
        onAbbrechen={close}
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
                            dependencies={[['weitere', z.name, 'fahrzeugtyp']]}
                            rules={[
                              // Eine Zeile mit Typ, aber ohne Namen ginge beim Senden still verloren.
                              ({ getFieldValue }) => ({
                                validator: (_, wert?: string) =>
                                  wert?.trim() ||
                                  !getFieldValue(['weitere', z.name, 'fahrzeugtyp'])?.trim()
                                    ? Promise.resolve()
                                    : Promise.reject(new Error('Funkrufname angeben')),
                              }),
                              zeichenRegel(FAHRZEUG_ADHOC_TEXT_MAX, 'Funkrufname'),
                            ]}
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
            title={
              doppel
                ? `${doppel.vorgemerkt ? 'Schon vorgemerkt' : 'Schon im Einsatz'}: ${doppel.name}`
                : 'Schon im Einsatz'
            }
            // Unter dem Titel statt daneben: bei 390 px drückte die Knopfreihe den Titel auf null.
            description={
              <Space size="middle" wrap>
                {doppel?.treffer && (
                  <Button
                    onClick={() =>
                      bucheTreffer(doppel.treffer!, () => form.resetFields(), doppelVerweis)
                    }
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
