package dev.rubeen.lifeline.kern

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json

/** Serverliste der Android-App (Entwurf D3: ein WebView-Profil je Eintrag). */
class ServerlisteTest {
    private val elw = ServerAdresse.parse("https://elw.local:8443")
    private val fuekw = ServerAdresse.parse("https://fuekw.local")

    private fun ids(): () -> String {
        var zaehler = 0
        return { "id-${++zaehler}" }
    }

    @Test
    fun `der erste Server wird aktiv und heißt wie sein Host`() {
        val (liste, eintrag) = Serverliste().add(elw, neueId = ids())
        assertEquals("elw.local", eintrag.name)
        assertEquals(elw, eintrag.adresse)
        assertNull(eintrag.zuletztVerbunden)
        assertNull(eintrag.bestaetigterVertrag)
        assertFalse(eintrag.geladenImProfil)
        assertEquals(eintrag, liste.aktiv)
        assertEquals(listOf(eintrag), liste.eintraege)
    }

    @Test
    fun `ein weiterer Server lässt den aktiven aktiv`() {
        val neueId = ids()
        val (eins, erster) = Serverliste().add(elw, neueId = neueId)
        val (zwei, zweiter) = eins.add(fuekw, "FüKW", neueId)
        assertEquals("FüKW", zweiter.name)
        assertEquals(erster.id, zwei.aktiv?.id)
        assertEquals(listOf(erster.id, zweiter.id), zwei.eintraege.map { it.id })
    }

    @Test
    fun `dieselbe Adresse zweimal gibt keinen zweiten Eintrag`() {
        val neueId = ids()
        val (liste, erster) = Serverliste().add(elw, neueId = neueId)
        val (nochmal, eintrag) = liste.add(ServerAdresse.parse("https://ELW.local:8443/"), neueId = neueId)
        assertEquals(erster.id, eintrag.id)
        assertEquals(liste, nochmal)
        assertEquals(erster.id, liste.eintragFuer(elw)?.id)
        assertNull(liste.eintragFuer(fuekw))
    }

    @Test
    fun `umbenennen, und ein leerer Name fällt auf den Host zurück`() {
        val (liste, eintrag) = Serverliste().add(elw, neueId = ids())
        assertEquals("ELW 1", liste.rename(eintrag.id, "  ELW 1  ").aktiv?.name)
        assertEquals("elw.local", liste.rename(eintrag.id, "ELW 1").rename(eintrag.id, "   ").aktiv?.name)
        assertEquals(ListError.UNBEKANNT, assertFailsWith<ListException> { liste.rename("x", "y") }.error)
    }

    @Test
    fun `wechseln macht den gewählten aktiv`() {
        val neueId = ids()
        val (eins, _) = Serverliste().add(elw, neueId = neueId)
        val (zwei, zweiter) = eins.add(fuekw, neueId = neueId)
        assertEquals(zweiter.id, zwei.activate(zweiter.id).aktiv?.id)
        assertEquals(ListError.UNBEKANNT, assertFailsWith<ListException> { zwei.activate("x") }.error)
    }

    @Test
    fun `der aktive Server lässt sich erst nach einem Wechsel entfernen`() {
        val neueId = ids()
        val (eins, erster) = Serverliste().add(elw, neueId = neueId)
        val (zwei, zweiter) = eins.add(fuekw, neueId = neueId)
        assertEquals(
            ListError.AKTIV_NICHT_ENTFERNBAR,
            assertFailsWith<ListException> { zwei.remove(erster.id) }.error,
        )
        val danach = zwei.activate(zweiter.id).remove(erster.id)
        assertEquals(listOf(zweiter.id), danach.eintraege.map { it.id })
        assertEquals(ListError.UNBEKANNT, assertFailsWith<ListException> { danach.remove(erster.id) }.error)
    }

    @Test
    fun `verbunden merkt Zeitpunkt und bestätigten Vertrag`() {
        val (liste, eintrag) = Serverliste().add(elw, neueId = ids())
        val verbunden = liste.markVerbunden(eintrag.id, 1_800_000_000_000, 1)
        assertEquals(1_800_000_000_000, verbunden.aktiv?.zuletztVerbunden)
        assertEquals(1, verbunden.aktiv?.bestaetigterVertrag)
    }

    @Test
    fun `markGeladen merkt sich, dass das Profil diesen Server schon zeigte`() {
        val (liste, eintrag) = Serverliste().add(elw, neueId = ids())
        assertFalse(liste.aktiv!!.geladenImProfil)
        val geladen = liste.markGeladen(eintrag.id)
        assertTrue(geladen.aktiv!!.geladenImProfil)
        assertEquals(ListError.UNBEKANNT, assertFailsWith<ListException> { liste.markGeladen("x") }.error)
    }

    @Test
    fun `die Liste lässt sich speichern und wieder lesen`() {
        val neueId = ids()
        val (eins, erster) = Serverliste().add(elw, neueId = neueId)
        val liste = eins.add(fuekw, "FüKW", neueId).first.markVerbunden(erster.id, 1_800_000_000_000, 1).markGeladen(erster.id)
        val text = Json.encodeToString(Serverliste.serializer(), liste)
        assertEquals(liste, Json.decodeFromString(Serverliste.serializer(), text))
    }

    @Test
    fun `ein aktiver ohne Eintrag gilt als keiner`() {
        val liste = Json.decodeFromString(Serverliste.serializer(), """{"eintraege":[],"aktivId":"6f1c"}""")
        assertNull(liste.aktiv)
    }
}
