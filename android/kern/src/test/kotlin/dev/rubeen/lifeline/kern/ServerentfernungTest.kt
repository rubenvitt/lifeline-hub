package dev.rubeen.lifeline.kern

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.runBlocking

/**
 * Entfernen eines Servers (Entwurf D3): erst den WebView des Profils schließen, dann das Profil
 * löschen, erst danach den Eintrag; ein Fehler bleibt sichtbar, und der Eintrag bleibt stehen.
 */
class ServerentfernungTest {
    private val elwEintrag: ServerEintrag
    private val lagerEintrag: ServerEintrag
    private val liste: Serverliste

    init {
        var zaehler = 0
        val neueId = { "id-${++zaehler}" }
        val (eins, elw) = Serverliste().add(ServerAdresse.parse("https://elw.local:8443"), neueId = neueId)
        val (zwei, lager) = eins.add(ServerAdresse.parse("https://lager.example"), "Lager", neueId)
        elwEintrag = elw
        lagerEintrag = lager
        liste = zwei
    }

    private class Dienste(var liste: Serverliste) : Entfernungsdienste {
        val schritte = mutableListOf<String>()
        var profilFehler: List<String> = emptyList()
        var waehrendDesLoeschens: ((Dienste) -> Unit)? = null
        var speicherFehler: String? = null

        override val serverliste: Serverliste get() = liste

        override fun closeWebView(profil: String) {
            schritte += "closeWebView:$profil"
        }

        override suspend fun removeProfil(profil: String) {
            schritte += "removeProfil:$profil"
            waehrendDesLoeschens?.invoke(this)
            if (profilFehler.isNotEmpty()) throw IllegalStateException(profilFehler.first()).also { profilFehler = profilFehler.drop(1) }
        }

        override fun removeEintrag(id: String) {
            liste = liste.remove(id)
            schritte += "removeEintrag:$id"
            speicherFehler?.let { throw java.io.IOException(it) }
        }
    }

    private fun fehler(dienste: Dienste, id: String): Serverentfernung.Fehler =
        assertFailsWith<EntfernungException> { runBlocking { Serverentfernung.run(id, dienste) } }.fehler

    @Test
    fun `die Reihenfolge ist WebView, Profil, Eintrag`() {
        val dienste = Dienste(liste)
        runBlocking { Serverentfernung.run(lagerEintrag.id, dienste) }
        assertEquals(
            listOf("closeWebView:${lagerEintrag.id}", "removeProfil:${lagerEintrag.id}", "removeEintrag:${lagerEintrag.id}"),
            dienste.schritte,
        )
        assertEquals(listOf(elwEintrag.id), dienste.liste.eintraege.map { it.id })
    }

    /** Review K10: scheitert das Speichern, sagt die App es, statt still weiterzumachen. */
    @Test
    fun `scheitert das Speichern der Liste, meldet die App es`() {
        val dienste = Dienste(liste).apply { speicherFehler = "Kein Speicherplatz" }
        val fehler = fehler(dienste, lagerEintrag.id)
        assertEquals(Serverentfernung.Fehler.Speichern("Lager", "Kein Speicherplatz"), fehler)
        assertEquals(
            "Die Serverliste ließ sich nicht speichern (Kein Speicherplatz). Nach einem Neustart kann " +
                "„Lager“ wieder in der Liste stehen; dann bitte erneut entfernen.",
            fehler.meldung,
        )
    }

    @Test
    fun `der aktive Server lässt sich nicht entfernen`() {
        val dienste = Dienste(liste)
        assertEquals(Serverentfernung.Fehler.Aktiv, fehler(dienste, elwEintrag.id))
        assertEquals(emptyList(), dienste.schritte)
        assertFalse(Serverentfernung.isEntfernbar(elwEintrag.id, liste))
        assertTrue(Serverentfernung.isEntfernbar(lagerEintrag.id, liste))
    }

    @Test
    fun `ein unbekannter Server ändert nichts`() {
        val dienste = Dienste(liste)
        assertEquals(Serverentfernung.Fehler.Unbekannt, fehler(dienste, "gibt-es-nicht"))
        assertEquals(emptyList(), dienste.schritte)
    }

    @Test
    fun `scheitert das Löschen, bleibt der Eintrag und der Fehler wird gemeldet`() {
        val dienste = Dienste(liste).apply { profilFehler = listOf("in Benutzung") }
        val fehler = fehler(dienste, lagerEintrag.id)
        assertEquals(Serverentfernung.Fehler.Profil("Lager", "in Benutzung"), fehler)
        assertEquals(
            "Die Daten von „Lager“ ließen sich nicht löschen (in Benutzung). Der Server bleibt in der Liste; bitte später erneut entfernen.",
            fehler.meldung,
        )
        assertEquals(2, dienste.liste.eintraege.size)
    }

    @Test
    fun `scheitert das Löschen des Profils, bleibt der Eintrag und ein zweiter Versuch geht`() {
        val dienste = Dienste(liste).apply { profilFehler = listOf("in Benutzung") }
        assertEquals(Serverentfernung.Fehler.Profil("Lager", "in Benutzung"), fehler(dienste, lagerEintrag.id))
        assertEquals(2, dienste.liste.eintraege.size)
        runBlocking { Serverentfernung.run(lagerEintrag.id, dienste) }
        assertEquals(listOf(elwEintrag.id), dienste.liste.eintraege.map { it.id })
        val id = lagerEintrag.id
        assertEquals(
            listOf(
                "closeWebView:$id", "removeProfil:$id",
                "closeWebView:$id", "removeProfil:$id", "removeEintrag:$id",
            ),
            dienste.schritte,
        )
    }

    @Test
    fun `wird der Server unterwegs aktiv, bleibt er stehen`() {
        val dienste = Dienste(liste)
        dienste.waehrendDesLoeschens = { it.liste = it.liste.activate(lagerEintrag.id) }
        assertEquals(Serverentfernung.Fehler.Aktiv, fehler(dienste, lagerEintrag.id))
        assertEquals(2, dienste.liste.eintraege.size)
    }

    @Test
    fun `die Rückfrage nennt die nicht übertragenen Einträge`() {
        assertEquals("„Lager“ entfernen?", Serverentfernung.rueckfrageTitel(lagerEintrag))
        assertTrue("noch nicht übertragen" in Serverentfernung.HINWEIS, Serverentfernung.HINWEIS)
        assertTrue("Anmeldung" in Serverentfernung.HINWEIS, Serverentfernung.HINWEIS)
    }

    @Test
    fun `die Meldungen sind die der iOS-Hülle`() {
        assertEquals("Der Server steht nicht mehr in der Liste.", Serverentfernung.Fehler.Unbekannt.meldung)
        assertEquals(
            "Der aktive Server lässt sich erst nach einem Wechsel entfernen.",
            Serverentfernung.Fehler.Aktiv.meldung,
        )
    }
}
