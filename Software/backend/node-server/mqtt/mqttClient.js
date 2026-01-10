const mqtt = require('mqtt');
const config = require('../config/config');
const aiService = require('../ai/aiService');
const { broadcastUpdate } = require('../socket/socket');
const { sendCriticalAlert } = require('../services/alertService'); // Import Alert Service

const connectMQTT = (onAnomalyCallback) => {
    const client = mqtt.connect(config.mqtt.brokerUrl);

    client.on('connect', () => {
        console.log('✅ Connected to MQTT Broker');
        client.subscribe(config.mqtt.topic);
    });

    client.on('message', async (topic, message) => {
        try {
            const rawData = JSON.parse(message.toString());
            
            // 1. Get AI Decision
            // Expects: { is_anomaly: true, severity: 'HIGH', anomaly_score: -0.5 }
            const aiResult = await aiService.getPrediction(rawData);
            
            // 2. Merge Data (Raw Sensor Data + AI Insights)
            const enrichedData = {
                ...rawData,
                ...aiResult,
                processed_at: new Date().toISOString()
            };

            // 3. Push Telemetry to Frontend (Updates Live Graphs immediately)
            // This happens regardless of anomaly status
            broadcastUpdate(enrichedData);

            // 4. Handle Anomaly Logic
            if(enrichedData.is_anomaly) {
                console.log(`⚠️ CRITICAL ALERT: Tampering detected at ${enrichedData.node_id}`);
                
                // --- STEP A: Trigger External Notifications (Email) ---
                // This calls the service we created. It handles rate-limiting internally.
                sendCriticalAlert(enrichedData);

                // --- STEP B: Format Alert for Dashboard & Storage ---
                // We create a structured object that matches what the React Dashboard expects
                const alertPacket = {
                    id: Date.now(), // Unique ID for React lists
                    nodeId: enrichedData.node_id,
                    severity: enrichedData.severity || 'HIGH',
                    timestamp: enrichedData.timestamp || Date.now(),
                    // Map ESP32 'latitude' to Dashboard 'lat'
                    lat: enrichedData.latitude, 
                    lng: enrichedData.longitude,
                    // New Fields for User Action
                    status: 'OPEN', // Default status for dropdown
                    isConstruction: false,
                    anomaly_score: enrichedData.anomaly_score
                };
                
                // --- STEP C: Execute Callback ---
                // This passes 'alertPacket' back to index.js to:
                // 1. Save to alerts.json (Persistence)
                // 2. Emit 'new_alert' socket event (Frontend Sound & Map Marker)
                if (onAnomalyCallback) {
                    onAnomalyCallback(alertPacket);
                }
            }
        } catch (err) {
            console.error("Error processing MQTT message:", err.message);
        }
    });

    return client;
};

module.exports = { connectMQTT };