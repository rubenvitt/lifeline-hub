package dev.rubeen.lifeline.kern

import java.util.Base64
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Befehle der Brücke (Nachrichten als JSON-Text) und ihre Ausführung gegen die Systemdienste. */
class BrueckenbefehlTest {
    // Lesen

    @Test
    fun `haptics wird gelesen`() {
        assertEquals(Brueckenbefehl.Haptics("success"), Bruecke.parse("""{"cmd":"haptics","kind":"success"}"""))
        assertEquals(Brueckenbefehl.Haptics(""), Bruecke.parse("""{"cmd":"haptics"}"""))
    }

    @Test
    fun `show_notification wird gelesen`() {
        assertEquals(
            Brueckenbefehl.ShowNotification(3, "Alarm", "ELW 1"),
            Bruecke.parse("""{"cmd":"show_notification","id":3,"title":"Alarm","body":"ELW 1"}"""),
        )
        assertEquals(
            Brueckenbefehl.ShowNotification(4, "Alarm", null),
            Bruecke.parse("""{"cmd":"show_notification","id":4,"title":"Alarm","body":null}"""),
        )
    }

    @Test
    fun `print, Anmeldung und Download werden gelesen`() {
        assertEquals(Brueckenbefehl.Print(7), Bruecke.parse("""{"cmd":"print","id":7}"""))
        assertEquals(Brueckenbefehl.Print(3), Bruecke.parse("""{"cmd":"print","id":3}"""))
        assertEquals(Brueckenbefehl.SignInWithBrowser(8), Bruecke.parse("""{"cmd":"sign_in_with_browser","id":8}"""))
        assertEquals(
            Brueckenbefehl.DownloadBlob(9, "liste.csv", "YWJj"),
            Bruecke.parse("""{"cmd":"download_blob","id":9,"name":"liste.csv","data":"YWJj"}"""),
        )
        // JS-Zahlen kommen auch mit Nachkommastelle null.
        assertEquals(Brueckenbefehl.Print(2), Bruecke.parse("""{"cmd":"print","id":2.0}"""))
    }

    @Test
    fun `set_app_badge gibt es auf Android nicht`() {
        val befehl = Bruecke.parse("""{"cmd":"set_app_badge","id":1,"count":5}""")
        assertEquals(Brueckenbefehl.Ungueltig(1, "Unbekannter Befehl der Hülle: set_app_badge"), befehl)
    }

    @Test
    fun `fehlerhafte Nachrichten mit id bekommen eine Ablehnung`() {
        val faelle = listOf(
            """{"cmd":"show_notification","id":1}""",
            """{"cmd":"show_notification","id":1,"title":5}""",
            """{"cmd":"open_settings","id":1}""",
            """{"cmd":"download_blob","id":1}""",
            """{"cmd":"download_blob","id":1,"name":"a.csv"}""",
            """{"cmd":"download_blob","id":1,"name":"a.csv","data":5}""",
        )
        for (nachricht in faelle) {
            val befehl = Bruecke.parse(nachricht)
            assertTrue(befehl is Brueckenbefehl.Ungueltig && befehl.id == 1, nachricht)
        }
    }

    @Test
    fun `ohne lesbare id bleibt eine Nachricht ohne Wirkung`() {
        val faelle = listOf(
            "haptics", "5", "[]", "", "null", "{", """{"kind":"success"}""", """{"cmd":"print"}""",
            """{"cmd":"print","id":"1"}""", """{"cmd":"print","id":1.5}""", """{"cmd":"print","id":true}""",
            """{"cmd":"print","id":null}""", """{"cmd":"unknown"}""", """{"cmd":5,"id":1}""",
            """{"cmd":"print","id":99999999999}""",
        )
        for (nachricht in faelle) assertNull(Bruecke.parse(nachricht), nachricht)
    }

    @Test
    fun `download_blob ohne Namen heißt Download`() {
        assertEquals(
            Brueckenbefehl.DownloadBlob(1, "Download", "YQ=="),
            Bruecke.parse("""{"cmd":"download_blob","id":1,"data":"YQ=="}"""),
        )
        assertEquals(
            Brueckenbefehl.DownloadBlob(2, "Download", "YQ=="),
            Bruecke.parse("""{"cmd":"download_blob","id":2,"name":"  ","data":"YQ=="}"""),
        )
    }

    @Test
    fun `ein zu großer blob-Download wird abgelehnt`() {
        val grenze = "A".repeat(70_000_000)
        val ok = Bruecke.parse("""{"cmd":"download_blob","id":1,"name":"a","data":"$grenze"}""")
        assertTrue(ok is Brueckenbefehl.DownloadBlob)
        val zuGross = Bruecke.parse("""{"cmd":"download_blob","id":1,"name":"a","data":"${grenze}A"}""")
        assertTrue(zuGross is Brueckenbefehl.Ungueltig && zuGross.id == 1, "$zuGross".take(80))
    }

    // Antwort an die Seite

    private fun antwort(a: Brueckenantwort): JsonObject = Json.parseToJsonElement(Bruecke.replyJson(a)).jsonObject

    @Test
    fun `die Antwort trägt id, fehler und wert`() {
        assertEquals(
            """{"id":4,"fehler":null,"wert":true}""",
            Bruecke.replyJson(Brueckenantwort(4, null, Antwortwert.Bool(true))),
        )
        assertEquals(
            """{"id":5,"fehler":null,"wert":null}""",
            Bruecke.replyJson(Brueckenantwort(5, null, Antwortwert.Null)),
        )
        assertEquals(
            """{"id":6,"fehler":"x","wert":false}""",
            Bruecke.replyJson(Brueckenantwort(6, "x", Antwortwert.Bool(false))),
        )
    }

    @Test
    fun `Fehlertexte werden als JSON maskiert`() {
        val text = "a\"b'c\n</script>\\ „ü“"
        val a = antwort(Brueckenantwort(6, text, Antwortwert.Null))
        assertEquals(6, a["id"]!!.jsonPrimitive.int)
        assertEquals(text, a["fehler"]!!.jsonPrimitive.content)
        assertEquals(JsonNull, a["wert"])
        assertTrue(a["fehler"] is JsonPrimitive)
        assertEquals(true, antwort(Brueckenantwort(1, null, Antwortwert.Bool(true)))["wert"]!!.jsonPrimitive.boolean)
    }

    // Ausführung

    @Test
    fun `haptics spielt die abgebildete Rückmeldung ohne Antwort`() = runBlocking {
        val dienste = Dienste()
        assertNull(Brueckenausfuehrung.run(Brueckenbefehl.Haptics("tap"), dienste))
        assertEquals(listOf(Haptik.Feedback.TAP), dienste.gespielt)
    }

    @Test
    fun `haptics beachtet den Schalter`() = runBlocking {
        val dienste = Dienste().apply { isHaptikEnabled = false }
        Brueckenausfuehrung.run(Brueckenbefehl.Haptics("success"), dienste)
        Brueckenausfuehrung.run(Brueckenbefehl.Haptics("boom"), dienste)
        assertEquals(emptyList(), dienste.gespielt)
    }

    @Test
    fun `die erste Meldung fragt nach der Berechtigung`() = runBlocking {
        val dienste = Dienste().apply {
            freigabe = Meldungsfreigabe.OFFEN
            erteilt = true
        }
        val antwort = Brueckenausfuehrung.run(Brueckenbefehl.ShowNotification(1, "Alarm", null), dienste)
        assertEquals(1, dienste.anfragen)
        assertEquals(listOf<Pair<String, String?>>("Alarm" to null), dienste.meldungen)
        assertEquals(Brueckenantwort(1, null, Antwortwert.Null), antwort)
    }

    @Test
    fun `erlaubte Meldungen fragen nicht erneut`() = runBlocking {
        val dienste = Dienste().apply { freigabe = Meldungsfreigabe.ERLAUBT }
        Brueckenausfuehrung.run(Brueckenbefehl.ShowNotification(1, "A", "B"), dienste)
        assertEquals(0, dienste.anfragen)
        assertEquals("B", dienste.meldungen.first().second)
    }

    @Test
    fun `ohne Berechtigung lehnt die Hülle ab und zeigt nichts`() = runBlocking {
        for (freigabe in listOf(Meldungsfreigabe.VERWEIGERT, Meldungsfreigabe.OFFEN)) {
            val dienste = Dienste().apply {
                this.freigabe = freigabe
                erteilt = false
            }
            val antwort = Brueckenausfuehrung.run(Brueckenbefehl.ShowNotification(2, "Alarm", null), dienste)
            assertEquals(0, dienste.meldungen.size)
            assertEquals(Brueckenantwort(2, Brueckenausfuehrung.MELDUNGEN_AUS, Antwortwert.Null), antwort)
        }
    }

    @Test
    fun `ein Fehler des Systems geht als Ablehnung an die Seite`() = runBlocking {
        val dienste = Dienste().apply { wirft = true }
        val antwort = Brueckenausfuehrung.run(Brueckenbefehl.ShowNotification(9, "x", null), dienste)
        assertEquals(Brueckenantwort(9, "kaputt", Antwortwert.Null), antwort)
    }

    @Test
    fun `Drucken meldet ob gedruckt wurde`() = runBlocking {
        val dienste = Dienste().apply { gedruckt = false }
        val antwort = Brueckenausfuehrung.run(Brueckenbefehl.Print(3), dienste)
        assertEquals(Brueckenantwort(3, null, Antwortwert.Bool(false)), antwort)
        assertEquals(1, dienste.drucke)
    }

    @Test
    fun `ungültige Befehle werden abgelehnt`() = runBlocking {
        val a = Brueckenausfuehrung.run(Brueckenbefehl.Ungueltig(4, "x"), Dienste())
        assertEquals(Brueckenantwort(4, "x", Antwortwert.Null), a)
    }

    @Test
    fun `die Anmeldung im Browser startet die Sitzung`() = runBlocking {
        val dienste = Dienste()
        val a = Brueckenausfuehrung.run(Brueckenbefehl.SignInWithBrowser(5), dienste)
        assertEquals(Brueckenantwort(5, null, Antwortwert.Null), a)
        assertEquals(1, dienste.anmeldungen)
        dienste.wirft = true
        val b = Brueckenausfuehrung.run(Brueckenbefehl.SignInWithBrowser(6), dienste)
        assertEquals(Brueckenantwort(6, "kaputt", Antwortwert.Null), b)
    }

    @Test
    fun `ein blob-Download legt die entschlüsselten Bytes ab`() = runBlocking {
        val dienste = Dienste()
        val daten = "a;b\n1;2\n".toByteArray()
        val base64 = Base64.getEncoder().encodeToString(daten)
        val a = Brueckenausfuehrung.run(Brueckenbefehl.DownloadBlob(1, "liste.csv", base64), dienste)
        assertEquals(Brueckenantwort(1, null, Antwortwert.Null), a)
        assertEquals("liste.csv", dienste.downloads.single().first)
        assertTrue(daten.contentEquals(dienste.downloads.single().second))
    }

    @Test
    fun `ein ungültiger blob-Download lehnt ab und legt nichts ab`() = runBlocking {
        val dienste = Dienste()
        val a = Brueckenausfuehrung.run(Brueckenbefehl.DownloadBlob(1, "x.csv", "!!!"), dienste)
        assertEquals(1, a!!.id)
        assertNotNull(a.fehler)
        assertEquals(0, dienste.downloads.size)
        dienste.wirft = true
        val b = Brueckenausfuehrung.run(Brueckenbefehl.DownloadBlob(2, "x.csv", "YQ=="), dienste)
        assertEquals(Brueckenantwort(2, "kaputt", Antwortwert.Null), b)
    }

    private class Dienste : Huellendienste {
        override var isHaptikEnabled = true
        var freigabe = Meldungsfreigabe.ERLAUBT
        var erteilt = false
        var wirft = false
        var gedruckt = true
        val gespielt = mutableListOf<Haptik.Feedback>()
        var anfragen = 0
        val meldungen = mutableListOf<Pair<String, String?>>()
        var drucke = 0
        var anmeldungen = 0
        val downloads = mutableListOf<Pair<String, ByteArray>>()

        override fun play(feedback: Haptik.Feedback) {
            gespielt += feedback
        }

        override suspend fun loadMeldungsfreigabe() = freigabe

        override suspend fun requestMeldungsfreigabe(): Boolean {
            anfragen += 1
            return erteilt
        }

        override suspend fun showNotification(title: String, body: String?) {
            if (wirft) throw IllegalStateException("kaputt")
            meldungen += title to body
        }

        override suspend fun print(): Boolean {
            if (wirft) throw IllegalStateException("kaputt")
            drucke += 1
            return gedruckt
        }

        override fun startAnmeldung() {
            if (wirft) throw IllegalStateException("kaputt")
            anmeldungen += 1
        }

        override suspend fun saveDownload(name: String, bytes: ByteArray) {
            if (wirft) throw IllegalStateException("kaputt")
            downloads += name to bytes
        }
    }
}
