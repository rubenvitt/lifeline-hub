import { Breadcrumb, Button, DatePicker, Form, Input, Spin, Typography, theme } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { Select } from '../components/Select';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { lageberichtDetailPfad } from '../routing/deeplinks';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { einsatzKeys } from '../api/queryKeys';
import { legeLageberichtAn, listeLageberichte } from '../api/lageberichte';
import type { LageberichtVorlageKey } from '../api/types';
import { VORLAGEN } from '../lageberichte/vorlagen';
import { kettenKoepfe, type KettenKopf } from '../lageberichte/ketten';
import Datensicht, { spaltenFuer } from '../components/Datensicht';
import { ErfassungsModal } from '../components/Erfassung';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { LAGEBERICHT_STATUS, StatusBadge } from '../kommunikation';
import EinsatzSeite from '../components/EinsatzSeite';
import { alsBackendZeit } from '../etb/filterZeit';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';

/**
 * Lageberichte als Kartensicht — Zwilling der Befehlsliste. `form="karte"` in jeder Breite: ein
 * Lagebericht wird als Einheit gelesen (Vorlage, Fassung, Freigabestand), nicht spaltenweise
 * verglichen.
 *
 * Die Sicht zeigt Kettenköpfe, nicht Berichte. Die Fortschreibung legt eine neue Zeile mit `version
 * + 1` und demselben Titel an, der Vorgänger bleibt freigegeben liegen. Jede Kette trägt eine Karte
 * mit dem jüngsten Stand im Kopf und den Vorgängern als Links in der Fassungszeile
 * (`lageberichte/ketten.ts`). Suche, Filter und Gruppen laufen über den Kopf; ein Vorgänger ist
 * über seinen Link erreichbar, aber kein eigener Treffer.
 */

function vorlageLabel(schluessel: LageberichtVorlageKey | string): string {
  return VORLAGEN.find((v) => v.schluessel === schluessel)?.label ?? String(schluessel);
}

/**
 * Die Spalten brauchen die `einsatzId` (Vorgänger-Links) und entstehen in der Komponente — mit
 * `spaltenFuer`, weil der Guard die Marke je Konsumentendatei verlangt. Nie annotieren: eine
 * Typangabe weitete `K` auf `string`, und der Kartenplan nähme Slot-Tippfehler an.
 */
function lageberichtSpalten(einsatzId: number) {
  return spaltenFuer<KettenKopf>()([
    {
      key: 'titel',
      title: 'Titel',
      immerSichtbar: true,
      sortWert: (k) => k.kopf.titel,
      suchText: (k) => k.kopf.titel,
      // Kein Anker hier: den Link setzt `karte.titel.ziel`, sonst verschachtelte Links.
      render: (_t, k) => k.kopf.titel,
    },
    {
      key: 'status',
      title: 'Status',
      // Sekundärslot statt `karte.status`: das Modul bleibt auf der Phasenachse aus
      // `kommunikation/phase.ts`, die bewusst außerhalb des Statusfarb-Vertrags liegt.
      render: (_t, k) => (
        <StatusBadge
          phase={LAGEBERICHT_STATUS[k.kopf.status].phase}
          label={LAGEBERICHT_STATUS[k.kopf.status].label}
        />
      ),
    },
    {
      key: 'vorlage',
      // Beim Lagebericht heißt die Achse „Vorlage", beim Befehl „Schema".
      title: 'Vorlage',
      suchText: (k) => vorlageLabel(k.kopf.vorlage),
      filter: {
        werte: VORLAGEN.map((v) => ({ text: v.label, value: v.schluessel })),
        trifft: (k, w) => k.kopf.vorlage === w,
      },
      render: (_t, k) => vorlageLabel(k.kopf.vorlage),
    },
    {
      key: 'fassung',
      title: 'Fassung',
      sortWert: (k) => k.kopf.zeitstand,
      // v-Nummer, Zeitstand und Ersteller in einer Zeile — drei Slots sind das Maximum. `zeitstand`
      // läuft durch `ZeitAnzeige` (taktische DTG in der Anzeigezone); `sortWert` bleibt der
      // UTC-Wirestring, der lexikografisch sortiert, die DTG nicht. Die Vorgänger als Deeplinks aus
      // dem Spalten-`render` — erlaubt, weil nicht die Titelspalte; der Klick-Riegel im Primitiv
      // trennt Link- und Zeilenklick.
      render: (_t, k) => (
        <>
          {`v${k.kopf.version} · `}
          <ZeitAnzeige wert={k.kopf.zeitstand} />
          {` · ${k.kopf.ersteller_name}`}
          {k.vorgaenger.length > 0 && (
            <span style={{ display: 'block' }}>
              {'Vorgänger: '}
              {k.vorgaenger.map((v, i) => (
                <span key={v.id}>
                  {i > 0 && ', '}
                  <Link to={lageberichtDetailPfad(einsatzId, v.id)}>v{v.version}</Link>
                </span>
              ))}
            </span>
          )}
        </>
      ),
    },
  ]);
}

/** Werte des Anlegedialogs — `zeitstand` als lokale Picker-Zeit, UTC erst beim Senden. */
interface AnlegenWerte {
  titel: string;
  vorlage: LageberichtVorlageKey;
  zeitstand?: Dayjs;
}

/**
 * Titelvorschlag aus der Uhrzeit („Lageüberblick 10:30 Uhr") in taktischer Schreibweise.
 */
function titelVorschlag(jetzt: Dayjs): string {
  return `Lageüberblick ${jetzt.format('HHmm')}`;
}

export default function LageberichtePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const [anlegenOffen, setAnlegenOffen] = useState(false);
  const [form] = Form.useForm<AnlegenWerte>();
  const { token } = theme.useToken();
  const spalten = useMemo(() => lageberichtSpalten(einsatzId), [einsatzId]);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const berichteQuery = useQuery({
    queryKey: einsatzKeys.lageberichte(einsatzId),
    queryFn: () => listeLageberichte(einsatzId),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: einsatzKeys.lageberichte(einsatzId) });

  const anlegenMutation = useMutation({
    mutationFn: (w: AnlegenWerte) =>
      legeLageberichtAn(einsatzId, {
        vorlage: w.vorlage,
        titel: w.titel,
        // Leer = jetzt (Backend-Default); ein leeres Feld wird nicht mitgeschickt.
        ...(w.zeitstand ? { zeitstand: alsBackendZeit(w.zeitstand) } : {}),
      }),
    onSuccess: invalidate,
    // Kein Toast: der Grund steht im Dialog, der die Werte bei Ablehnung stehen lässt. Es bleibt
    // bei `mutation.error` mit react-querys Räumen beim Absenden — anders als beim Autosave drückt
    // hier ein Mensch den Knopf, es gibt keinen Auto-Retry.
  });

  /**
   * Der Titelvorschlag wird beim Öffnen in den Formularspeicher geschrieben, nicht über
   * `initialValues`: der Speicher von rc-field-form überlebt `destroyOnHidden`, und beim nächsten
   * Einhängen gewinnt der alte Store (`merge(initialValues, store)`). Ein zweites Öffnen zeigte
   * sonst die Uhrzeit des ersten — in einer Kette, in der die Uhrzeit im Titel der
   * Ordnungsschlüssel ist, eine falsche Angabe. Dieselbe Falle beschreibt
   * `components/Erfassung.tsx`.
   *
   * Der Vorschlag braucht den Effekt (der Formularspeicher steht erst nach dem Einhängen); das
   * Räumen des letzten Fehlers liegt im Öffnen-Handler, weil ein Effekt nach dem Paint läuft und
   * der alte Grund sonst ein Bild lang über einem frischen Formular stünde.
   */
  useEffect(() => {
    if (anlegenOffen) form.setFieldsValue({ titel: titelVorschlag(dayjs()) });
  }, [anlegenOffen, form]);

  if (einsatzQuery.isLoading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <Typography.Text type="danger">Einsatz nicht gefunden oder kein Zugriff.</Typography.Text>
    );
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  const berichte = berichteQuery.data ?? [];
  const koepfe = kettenKoepfe(berichte);
  const entwuerfe = berichte.filter((lb) => lb.status === 'entwurf').length;

  return (
    // Die Mengen im Kopf zählen den Bestand, die Gruppenköpfe das Angezeigte — bei aktiver Suche
    // laufen die Zahlen auseinander. Gewollt: der Seitenkopf ist die Lageauskunft, der Gruppenkopf
    // die Auskunft über die Trefferliste.
    <EinsatzSeite
      titel="Lageberichte"
      meta={`${berichte.length} Berichte in ${koepfe.length} Ketten · ${entwuerfe} im Entwurf`}
      dataUpdatedAt={berichteQuery.dataUpdatedAt}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: 'Lageberichte' },
          ]}
        />
      }
      aktionen={
        darfSchreiben && (
          // Kein `size`-Prop: die Dichte trägt das Token am `ConfigProvider`. `aria-label` gegen
          // antds Icon-Etikett: `<span role="img" aria-label="plus">` flösse sonst in den Namen ein
          // („plus Neuer Bericht").
          <Button
            type="primary"
            icon={<PlusOutlined />}
            aria-label="Neuer Bericht"
            onClick={() => {
              anlegenMutation.reset();
              setAnlegenOffen(true);
            }}
          >
            Neuer Bericht
          </Button>
        )
      }
    >
      <Datensicht
        bezeichnung="Lageberichte"
        form="karte"
        spalten={spalten}
        daten={koepfe}
        zeilenSchluessel={(k) => k.kopf.id}
        ladend={berichteQuery.isLoading}
        leerText="Noch keine Lageberichte"
        suche={{ platzhalter: 'Titel oder Vorlage' }}
        standardSortierung={{ spalte: 'fassung', richtung: 'ab' }}
        gruppen={{
          schluessel: (k) => k.kopf.status,
          etikett: (w) => (w === 'entwurf' ? 'Entwürfe' : 'Freigegeben'),
          reihenfolge: ['entwurf', 'freigegeben'],
          // Die Gruppenköpfe stehen direkt unter dem Seitentitel (h1).
          unterEbene: 1,
        }}
        karte={{
          art: 'plan',
          titel: { spalte: 'titel', ziel: (k) => lageberichtDetailPfad(einsatzId, k.kopf.id) },
          // Keine `aktion`: Freigeben/Fortschreiben/Drucken liegen auf der Detailseite, die einzige
          // Interaktion der Zeile ist der Titel-Link.
          sekundaer: ['status', 'vorlage', 'fassung'],
        }}
      />

      {/* Erfassungs-Hülle: Absende-Knopf im Formular (Enter sendet), Fokus im ersten Feld — das
          ist der Titel, deshalb steht er vor der Vorlage. Drei Felder, innerhalb der
          Modal-Grenze. */}
      <ErfassungsModal<AnlegenWerte>
        offen={anlegenOffen}
        titel="Neuer Lagebericht"
        form={form}
        erfassenText="Anlegen"
        laeuft={anlegenMutation.isPending}
        initialValues={{ vorlage: 'lagebericht' }}
        onErfassen={(w) => anlegenMutation.mutateAsync(w)}
        onFertig={() => setAnlegenOffen(false)}
        onAbbrechen={() => setAnlegenOffen(false)}
      >
        {/* Der Grund der Ablehnung steht über den stehengebliebenen Feldern — sonst wäre der
            unveränderte Dialog von „nichts passiert" nicht zu unterscheiden. */}
        {anlegenMutation.error != null && (
          <div style={{ marginBottom: token.marginSM }}>
            <SpeicherFehler fehler={anlegenMutation.error} titel="Nicht angelegt" />
          </div>
        )}
        <Form.Item
          label="Titel"
          name="titel"
          rules={[{ required: true, message: 'Titel erforderlich' }]}
        >
          <Input placeholder="z. B. Lageüberblick 1030" />
        </Form.Item>
        <Form.Item label="Vorlage" name="vorlage" rules={[{ required: true }]}>
          <Select options={VORLAGEN.map((v) => ({ value: v.schluessel, label: v.label }))} />
        </Form.Item>
        <Form.Item label="Zeitstand" name="zeitstand" extra="Leer gelassen: jetzt">
          <DatePicker showTime format="DD.MM.YYYY HH:mm" style={{ width: '100%' }} />
        </Form.Item>
      </ErfassungsModal>
    </EinsatzSeite>
  );
}
