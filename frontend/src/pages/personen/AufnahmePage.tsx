import { Alert, App, Breadcrumb, Form, Space } from 'antd';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ladeEinsatz } from '../../api/einsaetze';
import { darfImEinsatzSchreiben } from '../../einsatz/schreibrecht';
import { useAuth } from '../../auth/AuthContext';
import { registrierAnzeige } from '../../api/einsatzPerson';
import { fehlerText } from '../../api/client';
import { einsatzKeys } from '../../api/queryKeys';
import { ErfassungsFormular } from '../../components/Erfassung';
import {
  liesErfassungsSitzungswert,
  schreibeErfassungsSitzungswert,
} from '../../components/erfassungsSitzung';
import EinsatzSeite from '../../components/EinsatzSeite';
import { SeitenFehler, SeitenSkeleton } from '../../components/SeitenZustand';
import { SK_META } from '../../personen/personMeta';
import AufnahmeFelder, { type AufnahmeEingabe } from '../../personen/AufnahmeFelder';
import { erfassePersonOfflineFaehig } from '../../offline/schreiben';
import { parseRouteId, personenPfad, uhsDetailPfad } from '../../routing/deeplinks';
import { flaeche } from '../../theme/tokens';
import StatusTag from '../../components/StatusTag';
import { einsatzStatus } from '../../theme/statusFarben';

/**
 * Vollseiten-Aufnahme für Personen (LFH-340 · C5).
 *
 * ── WARUM ES DIESE SEITE GIBT, obwohl die Schnellerfassung dasselbe kann ────
 *
 * Nicht wegen des Feldumfangs — die Maske ist Zeichen für Zeichen dieselbe
 * (`personen/AufnahmeFelder`, ein Bauteil, zwei Mounts). Sondern wegen der ADRESSE: andere
 * Module springen die Aufnahme an, und ein Dialog hat keine.
 *
 * Das AK des Tickets verlangt „≤ 4 Interaktionen UND ohne Seitenwechsel" und gleichzeitig
 * eine eigene Route. Beides wörtlich zugleich geht nicht — eine angesprungene Route IST ein
 * Seitenwechsel. Aufgelöst ist der Widerspruch so: den Zählweg erfüllt das Modal auf der
 * Personenliste (offen → Kategorie → speichern), diese Route ist der Weg von außen. Sie
 * konkurriert nicht mit ihm, sie ergänzt ihn.
 *
 * ── SERIE IST HIER DER NORMALFALL, NICHT DIE AUSNAHME ───────────────────────
 *
 * Wer diese Seite ansteuert, steht an der Aufnahme und erfasst der Reihe nach:
 * „Speichern und nächste" hält die Seite, der Primär-Knopf speichert die letzte Person und
 * geht in die Liste zurück. Die Quittung bleibt bis zur nächsten Erfassung stehen — an ihr
 * wird die Registriernummer abgelesen und auf das Band geschrieben, ein Toast wäre weg,
 * bevor jemand ihn abschreiben kann.
 *
 * ── DER ERSTE KONSUMENT VON AUSSEN: DIE UHS-KOPFZEILE (LFH-341 · C6) ────────
 *
 * „Patient aufnehmen" in der UHS-Detailseite schickt hierher mit `?uhs=<id>` (der
 * `uhsAuftrag` unten). Wer über diesen Weg kommt, erfasst keine Person im Allgemeinen,
 * sondern einen Patienten dieser Unfallhilfsstelle. `uhs_id` geht mit dem Anlegen
 * mit (LFH-458): der Server schreibt Person und Wartebereich-Eintritt atomar. Die
 * Offline-Queue erhält denselben Auftrag samt client_id; die Seite kehrt zur UHS zurück.
 */
export default function AufnahmePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<AufnahmeEingabe>();
  const [quittung, setQuittung] = useState<string | null>(null);
  const sitzungsortGeladen = useRef<number | null>(null);
  const [searchParams] = useSearchParams();
  /**
   * DER UHS-AUFTRAG (LFH-341 · C6). Wer von der UHS-Kopfzeile kommt, erfasst einen
   * PATIENTEN, keine Person im Allgemeinen: mit dem Anlegen wird der Eintritt in den
   * Wartebereich gebucht, und der Rückweg geht zur UHS statt in die Personenliste.
   *
   * Unbrauchbares wird GANZ verworfen, nicht halb übernommen — dieselbe Regel wie beim
   * Platzier-Auftrag der Lagekarte (`parsePlatzierenAuftrag`): ein halb gelesener Auftrag
   * bucht auf eine UHS, die es nicht gibt. Derselbe Validator wie dort, `parseRouteId` —
   * eine `uhs`-ID ist eine Route-ID wie jede andere.
   */
  const uhsAuftrag = parseRouteId(searchParams.get('uhs') ?? undefined);

  /**
   * DER SITZUNGSWEITE ANTREFFORT GILT AN BEIDEN MOUNTS (im Review gefunden). Das Modal las
   * ihn beim Öffnen und schrieb ihn nach jeder erfolgreichen Mutation zurück; diese Route
   * tat weder das eine noch das andere — ausgerechnet dort, wo der Serienbetrieb der
   * Normalfall ist. Wer hier fünf Personen von derselben Sammelstelle erfasst, kurz in die
   * Liste geht und zurückkommt, fand das Feld leer, während derselbe Weg über das Modal
   * vorbelegt hätte. `uebernahme={['antreff_ort']}` deckt nur INNERHALB eines Laufs ab.
   *
   * Der Wert wird als Formularwert gesetzt und NICHT zu `initialValues`: sonst füllte jeder
   * Serien-Reset den Ort auch bei ausgeschaltetem „Werte behalten" heimlich wieder auf —
   * dieselbe Begründung wie im Modal. Der Merker sorgt dafür, dass ein späterer Render den
   * bereits getippten Ort nicht überschreibt.
   */
  useEffect(() => {
    if (sitzungsortGeladen.current === einsatzId) return;
    sitzungsortGeladen.current = einsatzId;
    const ort = liesErfassungsSitzungswert(einsatzId, 'person', 'antreff_ort');
    if (ort !== undefined) form.setFieldValue('antreff_ort', ort);
  }, [einsatzId, form]);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });

  const anlegenMutation = useMutation({
    mutationFn: async (daten: AufnahmeEingabe) => {
      if (!benutzer) throw new Error('Nicht angemeldet');
      return erfassePersonOfflineFaehig(benutzer.id, einsatzId, {
        ...daten,
        ...(uhsAuftrag !== null ? { uhs_id: uhsAuftrag } : {}),
      });
    },
    onSuccess: (ergebnis) => {
      if (ergebnis.zustand === 'vorgemerkt') {
        setQuittung('Offline vorgemerkt — Registriernummer folgt nach der Übertragung.');
      } else {
        const person = ergebnis.daten;
        const zusatz =
          uhsAuftrag && person.aktuelle_uhs_id === uhsAuftrag && person.aktueller_platz_id === null
            ? ' · im Wartebereich'
            : '';
        if (uhsAuftrag) {
          void qc.invalidateQueries({ queryKey: einsatzKeys.uhsDetail(einsatzId, uhsAuftrag) });
          void qc.invalidateQueries({ queryKey: einsatzKeys.uhs(einsatzId) });
        }
        // Aus der ANTWORT gelesen, nicht aus den gesendeten Werten: das Backend schreibt
        // die Sichtung in derselben Transaktion und kann sie verwerfen.
        setQuittung(
          (person.aktuelle_sichtung
            ? `Erfasst als ${registrierAnzeige(person.registrier_nr)} · ${SK_META[person.aktuelle_sichtung].label}`
            : `Erfasst als ${registrierAnzeige(person.registrier_nr)}`) + zusatz,
        );
      }
      void qc.invalidateQueries({ queryKey: einsatzKeys.personen(einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
    },
    onError: (e) => message.error(fehlerText(e)),
  });

  if (einsatzQuery.isLoading) {
    return <SeitenSkeleton />;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Einsatz nicht gefunden oder kein Zugriff"
        ursache={einsatzQuery.error}
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  return (
    <EinsatzSeite
      breite={flaeche.seiteSchmal}
      titel={
        <Space>
          Aufnahme
          <StatusTag darstellung={einsatzStatus[einsatz.status]} />
        </Space>
      }
      beschreibung={
        uhsAuftrag
          ? 'Sichtungskategorie zuerst — die Person landet danach im Wartebereich der Unfallhilfsstelle.'
          : 'Sichtungskategorie zuerst — die übrigen Angaben sind optional.'
      }
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            {
              // Zeigt den Auftrag, statt „Personen" zu behaupten (Brief-Vorgabe): der
              // Rückweg geht bei einem Auftrag zur UHS, nicht in die Personenliste — der
              // Breadcrumb führt denselben Weg, sonst weiß niemand, wohin der Patient
              // läuft. Der UHS-NAME wird hier bewusst nicht geladen: das bräuchte eine
              // zusätzliche Query nur für einen Breadcrumb-Titel; die Rückverlinkung
              // allein beantwortet die Frage aus dem Brief.
              title: uhsAuftrag ? (
                <Link to={uhsDetailPfad(einsatzId, uhsAuftrag)}>Unfallhilfsstelle</Link>
              ) : (
                <Link to={personenPfad(einsatzId)}>Personen</Link>
              ),
            },
            { title: 'Aufnahme' },
          ]}
        />
      }
      hinweis={
        !darfSchreiben && (
          <Alert
            type="info"
            showIcon
            title={
              einsatz.status === 'aktiv'
                ? 'Keine Schreibberechtigung in diesem Einsatz.'
                : 'Einsatz ist abgeschlossen — nur Ansicht.'
            }
          />
        )
      }
    >
      {quittung && (
        // STEHENDE Quittung, kein Toast (Befund H30): an ihr wird die Registriernummer
        // abgelesen und auf das Band geschrieben. Sie bleibt bis zur nächsten Erfassung.
        <Alert style={{ marginBottom: 16 }} type="success" showIcon title={quittung} />
      )}

      {darfSchreiben && (
        <ErfassungsFormular<AufnahmeEingabe>
          form={form}
          serie
          uebernahme={['antreff_ort']}
          laeuft={anlegenMutation.isPending}
          // `mutateAsync`, nicht `mutate`: nur eine abgelehnte Zusage hält die Felder stehen.
          onErfassen={(daten) => anlegenMutation.mutateAsync(daten)}
          // Erst die Post-Acceptance-Stufe der Hülle darf den Sitzungswert ändern: ein
          // Abbruch während des POST besteht die Generation davor nicht (Muster aus
          // `PersonErfassungModal`).
          onErfasst={(daten) => {
            if (typeof daten.antreff_ort === 'string') {
              schreibeErfassungsSitzungswert(einsatzId, 'person', 'antreff_ort', daten.antreff_ort);
            }
          }}
          /**
           * Die beiden Knöpfe der Hülle bekommen hier ihre Bedeutung aus der Serie:
           * „Speichern und nächste" hält die Seite, der Primär-Knopf „Erfassen" speichert
           * die LETZTE Person und geht zurück in die Liste. Der Primär-Knopf behält seine
           * Vorgabebeschriftung — ihn „Fertig" zu nennen wäre eine Lüge: er speichert.
           */
          onFertig={() =>
            navigate(uhsAuftrag ? uhsDetailPfad(einsatzId, uhsAuftrag) : personenPfad(einsatzId))
          }
        >
          <AufnahmeFelder modus="schnell" />
        </ErfassungsFormular>
      )}
    </EinsatzSeite>
  );
}
