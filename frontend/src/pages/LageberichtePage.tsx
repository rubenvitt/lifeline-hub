import { Breadcrumb, Button, DatePicker, Flex, Form, Input, Spin, Typography, theme } from 'antd';
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
import Datenstand from '../components/Datenstand';
import { alsBackendZeit } from '../etb/filterZeit';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';

/**
 * Lageberichte als Kartensicht (LFH-330 · B2, Bündel III) — der Zwilling der Befehlsliste.
 *
 * `form="karte"` in JEDER Breite: ein Lagebericht wird als EINHEIT gelesen (Vorlage,
 * Fassung, Freigabestand), nicht spaltenweise verglichen. Beide Flächen werden gemeinsam
 * umgestellt, weil sie bis auf die Fachbegriffe gleich gebaut sind — nur eine von beiden
 * umzustellen erzeugte eine Divergenz zwischen zwei nahezu identischen Seiten.
 *
 * SEIT LFH-348 · C13 (Befund N23) ZEIGT DIE SICHT KETTENKÖPFE, NICHT BERICHTE. Die
 * Fortschreibung legt eine NEUE Zeile mit `version + 1` und demselben Titel an, der
 * Vorgänger bleibt freigegeben liegen — die Liste trug damit je Kette n gleichnamige
 * Karten, unterscheidbar nur an der Fassung, und der Arbeitsvorrat („welcher Stand ist der
 * aktuelle?") war nicht ablesbar. Jetzt trägt jede Kette EINE Karte mit dem jüngsten Stand
 * im Kopf und den Vorgängern als Links in der Fassungszeile (`lageberichte/ketten.ts`).
 * Suche, Filter und Gruppen laufen über den Kopf; ein Vorgänger ist über seinen Link
 * erreichbar, aber kein eigener Treffer.
 */

function vorlageLabel(schluessel: LageberichtVorlageKey | string): string {
  return VORLAGEN.find((v) => v.schluessel === schluessel)?.label ?? String(schluessel);
}

/**
 * Die Spalten brauchen die `einsatzId` (Vorgänger-Links) und entstehen deshalb in der
 * Komponente — mit `spaltenFuer`, weil der Guard die Marke je Konsumentendatei verlangt.
 * Nie annotieren — eine Typangabe weitete `K` auf `string`, und der Kartenplan nähme danach
 * jeden Slot-Tippfehler stillschweigend an.
 */
function lageberichtSpalten(einsatzId: number) {
  return spaltenFuer<KettenKopf>()([
    {
      key: 'titel',
      title: 'Titel',
      immerSichtbar: true,
      sortWert: (k) => k.kopf.titel,
      suchText: (k) => k.kopf.titel,
      // KEIN Anker hier: den Link setzt `karte.titel.ziel`, sonst verschachtelte Links.
      render: (_t, k) => k.kopf.titel,
    },
    {
      key: 'status',
      title: 'Status',
      // Sekundärslot statt `karte.status`: das Modul bleibt auf der Phasenachse aus
      // `kommunikation/phase.ts`, die bewusst außerhalb des A2-Statusfarb-Vertrags liegt.
      render: (_t, k) => (
        <StatusBadge
          phase={LAGEBERICHT_STATUS[k.kopf.status].phase}
          label={LAGEBERICHT_STATUS[k.kopf.status].label}
        />
      ),
    },
    {
      key: 'vorlage',
      // Bezeichnung „Vorlage" beibehalten — beim Lagebericht heißt die Achse so, beim Befehl
      // „Schema". Eine Umbenennung wäre eine fachliche Änderung ohne Anlass.
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
      // v-Nummer, Zeitstand und Ersteller in EINER Zeile — drei Slots sind das Maximum.
      // `zeitstand` läuft seit LFH-350 (F2/H60) durch `ZeitAnzeige` (taktische DTG in der
      // Anzeigezone), gleichlautend mit der Detailseite. `sortWert` bleibt der rohe
      // UTC-Wirestring: der sortiert lexikografisch korrekt, die DTG (`DDHHmm…`) nicht.
      // Die Vorgänger als Deeplinks aus dem Spalten-`render` — erlaubt, weil NICHT die
      // Titelspalte (deren Anker setzt das Primitiv); der Klick-Riegel im Primitiv trennt
      // den Link-Klick vom Zeilenklick (LFH-340 · C5).
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
 * Titelvorschlag aus der Uhrzeit — die Konvention, die der Platzhalter schon nannte
 * („Lageüberblick 10:30 Uhr"), jetzt vorbelegt in taktischer Schreibweise. Rein und
 * exportiert, damit die Form ohne Uhr prüfbar ist.
 */
export function titelVorschlag(jetzt: Dayjs): string {
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
    // KEIN Toast (LFH-494): der Grund steht im Dialog. Die Erfassungs-Hülle lässt die Werte
    // bei Ablehnung stehen (B4/LFH-332) — bis dahin aber ohne Grund, der Dialog sah nach dem
    // Verschwinden des Toasts unverändert aus. Hier bleibt es bei `mutation.error` mit
    // react-querys Räumen beim Absenden: anders als beim Autosave der Entwurfsseiten
    // (`useEntwurfVerlustschutz`) drückt hier ein Mensch den Knopf, es gibt keinen Auto-Retry.
  });

  /**
   * Der Titelvorschlag wird BEIM ÖFFNEN in den Formularspeicher geschrieben — nicht über
   * `initialValues`. Gemessen (Review LFH-348): der Speicher von rc-field-form überlebt das
   * Abhängen der Kinder (`destroyOnHidden`), und beim nächsten Einhängen gewinnt der alte
   * Store gegen neue `initialValues` (`useForm.js`: `merge(initialValues, store)`). Ein
   * zweites Öffnen um 14:15 zeigte sonst „Lageüberblick 1030" — in einer Kette, in der die
   * Uhrzeit im Titel der Ordnungsschlüssel ist, eine falsche Angabe in einer Führungsunterlage.
   * Dieselbe Falle beschreibt `components/Erfassung.tsx` am `ErfassungsModal`.
   *
   * Der Vorschlag braucht den EFFEKT (der Formularspeicher steht erst nach dem Einhängen);
   * das Räumen des letzten Fehlers braucht ihn NICHT und liegt deshalb im Öffnen-Handler
   * (LFH-494). Ein Effekt läuft nach dem Paint — der abgelehnte Versuch von vorhin stünde
   * sonst ein Bild lang über einem frisch vorbelegten Formular.
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
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: einsatz.bezeichnung },
          { title: 'Lageberichte' },
        ]}
      />
      <Flex justify="space-between" align="center" gap={16} wrap style={{ marginBottom: 16 }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            Lageberichte
          </Typography.Title>
          {/*
            Zählt den BESTAND, während die Gruppenköpfe das ANGEZEIGTE zählen — bei aktiver
            Suche laufen die Zahlen deshalb auseinander. Gewollt: die Kopfzeile ist die
            Lageauskunft, der Gruppenkopf die Auskunft über die Trefferliste.
          */}
          <Typography.Text type="secondary">
            {berichte.length} Berichte in {koepfe.length} Ketten · {entwuerfe} im Entwurf
          </Typography.Text>
          <div>
            <Datenstand dataUpdatedAt={berichteQuery.dataUpdatedAt} />
          </div>
        </div>
        {darfSchreiben && (
          // Kein `size`-Prop: Träger der Dichte ist das Dichte-Token am `ConfigProvider`.
          // `aria-label` gegen antds Icon-Etikett: `<span role="img" aria-label="plus">`
          // fließt sonst in den berechneten Namen ein („plus Neuer Bericht", gemessen).
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
        )}
      </Flex>

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
        }}
        karte={{
          art: 'plan',
          titel: { spalte: 'titel', ziel: (k) => lageberichtDetailPfad(einsatzId, k.kopf.id) },
          // Keine `aktion`: Freigeben/Fortschreiben/Drucken liegen auf der Detailseite,
          // die einzige Interaktion der Zeile ist der Titel-Link.
          sekundaer: ['status', 'vorlage', 'fassung'],
        }}
      />

      {/*
        Erfassungs-Hülle (B4/LFH-332): Absende-Knopf IM Formular (Enter sendet), Fokus im
        ersten Feld — das ist der Titel, deshalb steht er vor der Vorlage (N23 verlangt den
        Fokus dort). Drei Felder, innerhalb der LFH-19-Modal-Grenze.
      */}
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
        {/* Der Grund der Ablehnung steht ÜBER den Feldern, deren Werte stehen geblieben
            sind — sonst ist der unveränderte Dialog von „nichts passiert" nicht zu
            unterscheiden (LFH-494). */}
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
    </div>
  );
}
