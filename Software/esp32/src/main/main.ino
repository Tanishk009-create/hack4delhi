#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// --- CONFIGURATION ---
const char *ssid = "YOUR_WIFI_NAME";     // <--- UPDATE THIS
const char *password = "YOUR_WIFI_PASS"; // <--- UPDATE THIS
const char *mqtt_server = "broker.hivemq.com";
const char *node_id = "TRACK_SEC_42";

WiFiClient espClient;
PubSubClient client(espClient);

#define BOOT_BUTTON 0 // Built-in button on most ESP32 boards

void setup()
{
  Serial.begin(115200);
  pinMode(BOOT_BUTTON, INPUT_PULLUP);

  // 1. Connect to WiFi
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED)
  {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi Connected");

  // 2. Connect to MQTT
  client.setServer(mqtt_server, 1883);
}

void reconnect()
{
  while (!client.connected())
  {
    Serial.print("Attempting MQTT connection...");
    if (client.connect("RailGuard_Node_ESP32_Unique"))
    {
      Serial.println("connected");
    }
    else
    {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" try again in 5 seconds");
      delay(5000);
    }
  }
}

void loop()
{
  if (!client.connected())
    reconnect();
  client.loop();

  // Check for User Input (Tampering Simulation)
  bool isTampering = (digitalRead(BOOT_BUTTON) == LOW);

  // --- DATA GENERATION ---

  float accel_mag, mag_norm;

  if (isTampering)
  {
    // ⚠️ ATTACK SCENARIO
    // Vibration: Chaotic high spikes (Sawing/Hammering)
    accel_mag = random(250, 800) / 100.0; // 2.5g to 8.0g

    // Magnetic: Fluctuates due to metal tools moving near sensor
    mag_norm = 45.0 + (random(-150, 150) / 10.0); // 30uT to 60uT
  }
  else
  {
    // ✅ NORMAL SCENARIO
    // Vibration: Low background noise
    accel_mag = random(2, 15) / 100.0; // 0.02g to 0.15g

    // Magnetic: Stable Earth field (~45uT) + tiny noise
    mag_norm = 45.0 + (random(-10, 10) / 10.0);
  }

  // Environment (Stable-ish)
  float temp = 28.0 + (random(-5, 5) / 10.0);         // ~28 C
  float hum = 60.0 + (random(-20, 20) / 10.0);        // ~60 %
  float pressure = 1013.0 + (random(-10, 10) / 10.0); // ~1013 hPa

  // --- JSON PACKING ---
  // Increased size to 512 to fit all new fields
  StaticJsonDocument<512> doc;

  doc["node_id"] = node_id;
  doc["timestamp"] = millis();

  // Telemetry matching Dashboard keys
  doc["accel_mag"] = accel_mag;
  doc["accel_roll_rms"] = accel_mag * 0.707; // Approx RMS for sine wave
  doc["mag_norm"] = mag_norm;

  // Environment
  doc["temperature"] = temp;
  doc["humidity"] = hum;
  doc["pressure"] = pressure;

  // GPS (Hardcoded for this Node)
  doc["latitude"] = 28.6139;
  doc["longitude"] = 77.2090;
  doc["altitude"] = 216.0;

  char buffer[512];
  size_t n = serializeJson(doc, buffer);

  // --- PUBLISH ---
  client.publish("railway/sensor/1", buffer, n);

  // Debug Output
  Serial.print("Status: ");
  Serial.print(isTampering ? "TAMPERING! " : "Normal ");
  Serial.print("| Vib: ");
  Serial.print(accel_mag);
  Serial.print("| Mag: ");
  Serial.println(mag_norm);

  delay(500); // 2Hz Update Rate
}