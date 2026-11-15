package com.koc.padel;

import static org.junit.Assert.*;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.res.XmlResourceParser;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.xmlpull.v1.XmlPullParser;

/** Runs the real bundled SPA in Android WebView; never grants a fake Pro entitlement. */
@RunWith(AndroidJUnit4.class)
public class LaunchSmokeTest {
    @Test
    public void excludesLocalSessionsFromBackupsAndDeviceTransfers() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals(0, context.getApplicationInfo().flags & ApplicationInfo.FLAG_ALLOW_BACKUP);
        java.util.Map<String, java.util.Set<String>> excluded = new java.util.HashMap<>();
        String mode = null;
        try (XmlResourceParser rules = context.getResources().getXml(R.xml.data_extraction_rules)) {
            for (int token = rules.next(); token != XmlPullParser.END_DOCUMENT; token = rules.next()) {
                if (token != XmlPullParser.START_TAG) continue;
                if ("cloud-backup".equals(rules.getName()) || "device-transfer".equals(rules.getName())) {
                    mode = rules.getName();
                    excluded.put(mode, new java.util.HashSet<>());
                } else if ("exclude".equals(rules.getName())) {
                    assertNotNull(mode);
                    assertEquals(".", rules.getAttributeValue(null, "path"));
                    excluded.get(mode).add(rules.getAttributeValue(null, "domain"));
                }
            }
        }
        java.util.Set<String> domains = java.util.Set.of("root", "file", "database", "sharedpref", "external",
            "device_root", "device_file", "device_database", "device_sharedpref");
        assertEquals(domains, excluded.get("cloud-backup"));
        assertEquals(domains, excluded.get("device-transfer"));
    }

    @Test
    public void launchesBundledEventLibrary() throws Exception {
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        Context context = instrumentation.getTargetContext();
        assertEquals("com.koc.padel", context.getPackageName());
        try (java.io.InputStream asset = context.getAssets().open("public/index.html")) {
            assertTrue("Web bundle is present", asset.read() != -1);
        }
        Intent intent = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        MainActivity activity = (MainActivity) instrumentation.startActivitySync(intent);
        try {
            long deadline = System.currentTimeMillis() + 30000;
            boolean loaded = false;
            while (System.currentTimeMillis() < deadline) {
                CountDownLatch latch = new CountDownLatch(1);
                AtomicReference<String> result = new AtomicReference<>("false");
                instrumentation.runOnMainSync(() -> activity.getBridge().getWebView().evaluateJavascript(
                    "Boolean(document.querySelector('#root') && document.body.innerText.includes('Create event') && window.Capacitor.getPlatform() === 'android')",
                    value -> { result.set(value); latch.countDown(); }
                ));
                assertTrue("WebView responds", latch.await(5, TimeUnit.SECONDS));
                if ("true".equals(result.get())) { loaded = true; break; }
                Thread.sleep(250);
            }
            assertTrue("Native Android event library renders from bundled assets", loaded);
        } finally {
            instrumentation.runOnMainSync(activity::finish);
        }
    }
}
