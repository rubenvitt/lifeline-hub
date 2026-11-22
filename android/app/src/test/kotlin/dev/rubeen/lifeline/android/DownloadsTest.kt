package dev.rubeen.lifeline.android

import android.app.Application
import android.content.Intent
import android.net.Uri
import android.webkit.WebView
import androidx.core.content.FileProvider
import androidx.test.core.app.ApplicationProvider
import dev.rubeen.lifeline.android.dienste.Downloadanfrage
import dev.rubeen.lifeline.android.dienste.Downloads
import dev.rubeen.lifeline.kern.ServerAdresse
import java.io.File
import java.net.URI
import java.util.concurrent.TimeUnit
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Before
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking

/**
 * Downloads (Entwurf D8): mit der Sitzung des Profils laden, nur von einer Seite des aktiven
 * Servers, bereinigt in ein eigenes Verzeichnis ablegen und zum Teilen anbieten.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class DownloadsTest {
    private val context: Application = ApplicationProvider.getApplicationContext()
    private val elw = ServerAdresse.parse("https://elw.local:8443")
    private val ablage = File(context.cacheDir, "downloads")
    private val scope = CoroutineScope(Dispatchers.Unconfined + Job())
    private val anfragen = mutableListOf<Downloadanfrage>()
    private val testserver = mutableListOf<MockWebServer>()

    private val downloads = Downloads(
        context = context,
        scope = scope,
        aktiverServer = { elw },
        cookie = { _, _ -> "sitzung=geheim" },
        io = Dispatchers.Unconfined,
        laden = { anfrage, ablegen ->
            anfragen += anfrage
            ablegen("bericht.csv") { it.write("a;b".toByteArray()) } to "text/csv"
        },
    )

    /**
     * `FileProvider` merkt sich seine Wurzeln je Autorität im Prozess; Robolectric gibt jedem Test
     * ein neues Datenverzeichnis.
     */
    @Before
    fun vergissWurzeln() {
        val ablage = FileProvider::class.java.getDeclaredField("sCache").apply { isAccessible = true }
        (ablage.get(null) as MutableMap<*, *>).clear()
    }

    @After
    fun beende() {
        scope.cancel()
        testserver.forEach { it.shutdown() }
    }

    private fun seite(url: String) = WebView(context).apply { loadUrl(url) }

    /** Das geteilte Intent hinter der Auswahl des Systems. */
    private fun geteilt(): Intent {
        val auswahl = shadowOf(context).nextStartedActivity
        assertEquals(Intent.ACTION_CHOOSER, auswahl.action)
        @Suppress("DEPRECATION")
        return auswahl.getParcelableExtra(Intent.EXTRA_INTENT)!!
    }

    @Suppress("DEPRECATION")
    private fun Intent.datei(): Uri = getParcelableExtra(Intent.EXTRA_STREAM)!!

    @Test
    fun `saveDownload legt die Datei bereinigt im eigenen Verzeichnis ab und teilt sie`() {
        runBlocking { downloads.saveDownload("../a/b:c.csv", "x;y".toByteArray()) }

        val teilen = geteilt()
        assertEquals(Intent.ACTION_SEND, teilen.action)
        assertTrue(teilen.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
        val uri = teilen.datei()
        assertEquals("dev.rubeen.lifeline.android.dateien", uri.authority)
        assertEquals("b_c.csv", uri.lastPathSegment)
        val ordner = ablage.listFiles()!!.single()
        val datei = File(ordner, "b_c.csv")
        assertEquals("x;y", datei.readText())
        assertEquals("/downloads/${ordner.name}/b_c.csv", uri.path)
    }

    @Test
    fun `zwei Downloads gleichen Namens liegen in eigenen Verzeichnissen`() {
        runBlocking {
            downloads.saveDownload("liste.csv", "1".toByteArray())
            downloads.saveDownload("liste.csv", "2".toByteArray())
        }

        val ordner = ablage.listFiles()!!.map { it.name }
        assertEquals(2, ordner.size)
        assertNotEquals(ordner[0], ordner[1])
    }

    @Test
    fun `alte Downloads werden beim nächsten weggeräumt`() {
        val alt = File(ablage, "alt").apply { mkdirs() }
        File(alt, "rest.pdf").writeText("x")
        alt.setLastModified(System.currentTimeMillis() - Downloads.AUFBEWAHRUNG_MS - 60_000)

        runBlocking { downloads.saveDownload("neu.pdf", "y".toByteArray()) }

        assertFalse(alt.exists())
        assertEquals(1, ablage.listFiles()!!.size)
    }

    @Test
    fun `eine Dateiroute der Seite des Servers lädt mit der Sitzung des Profils und wird geteilt`() {
        downloads.herunterladen(seite("https://elw.local:8443/etb"), "https://elw.local:8443/api/etb/export.csv", null, "text/csv")

        val anfrage = anfragen.single()
        assertEquals(URI("https://elw.local:8443/api/etb/export.csv"), anfrage.ziel)
        assertEquals("sitzung=geheim", anfrage.cookie)
        assertEquals("bericht.csv", geteilt().datei().lastPathSegment)
    }

    @Test
    fun `von einer fremden Seite oder ohne http lädt nichts`() {
        downloads.herunterladen(seite("https://idp.example/login"), "https://elw.local:8443/api/etb/export.csv", null, null)
        downloads.herunterladen(seite("https://elw.local:8443/etb"), "blob:https://elw.local:8443/1234", null, null)
        downloads.herunterladen(seite("https://elw.local:8443/etb"), "data:text/plain,hallo", null, null)

        assertTrue(anfragen.isEmpty())
        assertNull(shadowOf(context).nextStartedActivity)
    }

    @Test
    fun `eine fremde Download-Adresse bekommt die Sitzung des Servers nicht`() {
        downloads.herunterladen(seite("https://elw.local:8443/etb"), "https://cdn.example/datei.pdf", null, null)

        assertNull(anfragen.single().cookie)
    }

    // Laden über HTTP (Testserver ohne TLS; die Origin-Prüfung gilt für ihn genauso).

    private fun testserver() = MockWebServer().also {
        it.start()
        testserver += it
    }

    private fun lade(anfrage: Downloadanfrage) = runBlocking { Downloads.abrufen(anfrage, downloads::ablegen) }

    @Test
    fun `der Name kommt aus Content-Disposition und wird bereinigt`() {
        val server = testserver()
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "text/csv; charset=utf-8")
                .setHeader("Content-Disposition", "attachment; filename=\"../export:1.csv\"")
                .setBody("a;b"),
        )
        val ziel = server.url("/api/etb/export").toUri()

        val (datei, typ) = lade(Downloadanfrage(ziel, server = ziel.resolve("/"), cookie = "sitzung=geheim", null, null))

        assertEquals("export_1.csv", datei.name)
        assertEquals("a;b", datei.readText())
        assertEquals("text/csv; charset=utf-8", typ)
        assertEquals("sitzung=geheim", server.takeRequest(1, TimeUnit.SECONDS)!!.getHeader("Cookie"))
    }

    @Test
    fun `eine Umleitung auf eine fremde Origin verliert die Sitzung`() {
        val fremd = testserver()
        fremd.enqueue(MockResponse().setBody("inhalt"))
        val server = testserver()
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", fremd.url("/ablage/datei.pdf").toString()))
        val ziel = server.url("/api/anhang/1").toUri()

        val (datei, _) = lade(Downloadanfrage(ziel, server = ziel.resolve("/"), cookie = "sitzung=geheim", null, null))

        assertEquals("inhalt", datei.readText())
        assertEquals("sitzung=geheim", server.takeRequest(1, TimeUnit.SECONDS)!!.getHeader("Cookie"))
        assertNull(fremd.takeRequest(1, TimeUnit.SECONDS)!!.getHeader("Cookie"))
    }

    @Test
    fun `eine Fehlerantwort legt keine Datei ab`() {
        val server = testserver()
        server.enqueue(MockResponse().setResponseCode(404))
        val ziel = server.url("/api/fehlt").toUri()

        val fehler = runCatching { lade(Downloadanfrage(ziel, server = ziel.resolve("/"), cookie = null, null, null)) }

        assertTrue(fehler.isFailure)
        assertFalse(ablage.exists() && ablage.listFiles()!!.any { it.listFiles()!!.isNotEmpty() })
    }
}
