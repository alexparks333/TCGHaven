package com.alexhparks.tcghaven;

import android.graphics.Color;
import android.os.Bundle;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Our own native plugin: the card scanner (CardScannerPlugin.kt — docs/android-app.md)
        registerPlugin(CardScannerPlugin.class);
        super.onCreate(savedInstanceState);
        // Behind the status and navigation bars: the site's parchment (not white), with dark icons
        getWindow().getDecorView().setBackgroundColor(Color.parseColor("#E8DCC0"));
        WindowInsetsControllerCompat bars = new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());
        bars.setAppearanceLightStatusBars(true);
        bars.setAppearanceLightNavigationBars(true);
    }
}
