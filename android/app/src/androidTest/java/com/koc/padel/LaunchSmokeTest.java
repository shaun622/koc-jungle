package com.koc.padel;

import static org.junit.Assert.*;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Runs the real bundled SPA in Android WebView; never grants a fake Pro entitlement. */
@RunWith(AndroidJUnit4.class)
public class LaunchSmokeTest {
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
