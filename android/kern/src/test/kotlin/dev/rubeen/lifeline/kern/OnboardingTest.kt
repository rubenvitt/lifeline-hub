package dev.rubeen.lifeline.kern

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Onboarding als Zustandsfunktion: Adresse, Prüfung, gespeichert wird nur ein verträglicher Server. */
class OnboardingTest {
    private val elw = ServerAdresse.parse("https://elw.local:8443")
    private val info = ShellInfo("1.0.0-alpha.300", 1)

    private fun step(state: Onboarding.State, event: Onboarding.Event) = Onboarding.next(state, event)

    @Test
    fun `der Start ist eine leere Eingabe`() {
        assertEquals(Onboarding.State.Eingabe("", null), Onboarding.State.START)
    }

    @Test
    fun `eine ungültige Adresse zeigt die Meldung und prüft nicht`() {
        val schritt = step(Onboarding.State.Eingabe("http://elw.local", null), Onboarding.Event.Verbinden)
        assertEquals(Onboarding.State.Eingabe("http://elw.local", AdressError.KEIN_HTTPS.meldung), schritt.state)
        assertNull(schritt.effect)
    }

    @Test
    fun `Tippen nimmt die Meldung weg`() {
        val schritt = step(Onboarding.State.Eingabe("http://", "x"), Onboarding.Event.TextChanged("https://elw"))
        assertEquals(Onboarding.State.Eingabe("https://elw", null), schritt.state)
        assertNull(schritt.effect)
    }

    @Test
    fun `eine gültige Adresse wird geprüft`() {
        val schritt = step(Onboarding.State.Eingabe(" https://ELW.local:8443 ", null), Onboarding.Event.Verbinden)
        assertEquals(Onboarding.State.Pruefung(elw), schritt.state)
        assertEquals(Onboarding.Effect.Check(elw), schritt.effect)
    }

    @Test
    fun `nur ein verträglicher Server wird gespeichert`() {
        val schritt = step(Onboarding.State.Pruefung(elw), Onboarding.Event.Ergebnis(Vertragsergebnis.Vertraeglich(info), elw))
        assertEquals(Onboarding.State.Verbunden(elw, info), schritt.state)
        assertEquals(Onboarding.Effect.Save(elw, info), schritt.effect)
    }

    @Test
    fun `ein unverträglicher oder unerreichbarer Server wird nicht gespeichert`() {
        for (ergebnis in listOf<Vertragsergebnis>(
            Vertragsergebnis.NichtVertraeglich(Fehlerklasse.ZU_ALT, null),
            Vertragsergebnis.NichtVertraeglich(Fehlerklasse.ZU_NEU, ShellInfo("2.0.0", 2)),
            Vertragsergebnis.NichtErreichbar(Fehlerklasse.ZERTIFIKAT),
            Vertragsergebnis.NichtErreichbar(Fehlerklasse.NICHT_ERREICHBAR),
        )) {
            val schritt = step(Onboarding.State.Pruefung(elw), Onboarding.Event.Ergebnis(ergebnis, elw))
            assertEquals(Onboarding.State.Abgelehnt(elw, ergebnis), schritt.state, "$ergebnis")
            assertNull(schritt.effect, "$ergebnis")
        }
    }

    @Test
    fun `nach einer Ablehnung lässt sich erneut prüfen oder die Adresse ändern`() {
        val abgelehnt = Onboarding.State.Abgelehnt(elw, Vertragsergebnis.NichtErreichbar(Fehlerklasse.NICHT_ERREICHBAR))
        assertEquals(Onboarding.Effect.Check(elw), step(abgelehnt, Onboarding.Event.Verbinden).effect)
        assertEquals(
            Onboarding.State.Eingabe("https://elw.local:9443", null),
            step(abgelehnt, Onboarding.Event.TextChanged("https://elw.local:9443")).state,
        )
        assertEquals(Onboarding.State.Eingabe(elw.text, null), step(abgelehnt, Onboarding.Event.Zurueck).state)
    }

    @Test
    fun `Vorbelegen setzt die Adresse ohne zu prüfen`() {
        val schritt = step(Onboarding.State.START, Onboarding.Event.Vorbelegen(elw))
        assertEquals(Onboarding.State.Eingabe(elw.text, null), schritt.state)
        assertNull(schritt.effect)
    }

    @Test
    fun `ein veraltetes Ergebnis bleibt wirkungslos`() {
        val andere = ServerAdresse.parse("https://fuekw.local")
        val eingabe = Onboarding.State.Eingabe("abc", null)
        val ok = Vertragsergebnis.Vertraeglich(info)
        assertEquals(eingabe, step(eingabe, Onboarding.Event.Ergebnis(ok, elw)).state)
        assertNull(step(eingabe, Onboarding.Event.Ergebnis(ok, elw)).effect)
        val schritt = step(Onboarding.State.Pruefung(andere), Onboarding.Event.Ergebnis(ok, elw))
        assertEquals(Onboarding.State.Pruefung(andere), schritt.state)
        assertNull(schritt.effect)
    }

    @Test
    fun `während der Prüfung führt Zurück zur Eingabe`() {
        val schritt = step(Onboarding.State.Pruefung(elw), Onboarding.Event.Zurueck)
        assertEquals(Onboarding.State.Eingabe(elw.text, null), schritt.state)
        assertNull(schritt.effect)
    }

    /**
     * Wer das Blatt „Server hinzufügen“ während der Prüfung schließt, sendet `Zurueck`; ein
     * Ergebnis, das danach ankommt, speichert und aktiviert nichts (kein stiller Wechsel).
     */
    @Test
    fun `nach dem Schließen während der Prüfung speichert ein spätes Ergebnis nichts`() {
        val geschlossen = step(Onboarding.State.Pruefung(elw), Onboarding.Event.Zurueck).state
        val spaet = step(geschlossen, Onboarding.Event.Ergebnis(Vertragsergebnis.Vertraeglich(info), elw))
        assertEquals(Onboarding.State.Eingabe(elw.text, null), spaet.state)
        assertNull(spaet.effect)
    }

    @Test
    fun `während der Prüfung ändern Tippen und Vorbelegen nichts`() {
        val pruefung = Onboarding.State.Pruefung(elw)
        assertEquals(pruefung, step(pruefung, Onboarding.Event.TextChanged("x")).state)
        assertEquals(pruefung, step(pruefung, Onboarding.Event.Vorbelegen(ServerAdresse.parse("https://a.example"))).state)
    }

    @Test
    fun `nach dem Speichern ändert nichts den Zustand`() {
        val verbunden = Onboarding.State.Verbunden(elw, info)
        assertEquals(verbunden, step(verbunden, Onboarding.Event.Zurueck).state)
        assertNull(step(verbunden, Onboarding.Event.Verbinden).effect)
    }
}
