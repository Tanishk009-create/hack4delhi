const axios = require('axios');
const config = require('../config/config');

async function getPrediction(sensorData) {
    try {
        // 1. Construct Payload
        // We MUST map every field expected by the Python 'SensorInput' class.
        // If a field is missing in sensorData, we default it to 0 or 0.0 to prevent 422 errors.
        const payload = {
            node_id: sensorData.node_id || "UNKNOWN",
            timestamp: sensorData.timestamp || Date.now(),
            
            // GPS
            latitude: sensorData.latitude || 0.0,
            longitude: sensorData.longitude || 0.0,
            
            // Raw Sensors
            accel_x: sensorData.accel_x || 0.0,
            accel_y: sensorData.accel_y || 0.0,
            accel_z: sensorData.accel_z || 0.0,
            mag_x: sensorData.mag_x || 0.0,
            mag_y: sensorData.mag_y || 0.0,
            mag_z: sensorData.mag_z || 0.0,
            
            // New Fields
            heading: sensorData.heading || 0.0,
            tilt: sensorData.tilt !== undefined ? sensorData.tilt : 1, // Default 1 (Safe)
            tilt_alert: sensorData.tilt_alert || false,
            
            // Computed Features
            accel_mag: sensorData.accel_mag || 0.0,
            accel_roll_rms: sensorData.accel_roll_rms || 0.0,
            mag_norm: sensorData.mag_norm || 0.0,
            mic_level: sensorData.mic_level || 0.0,
            
            // Environment
            temperature: sensorData.temperature || 0.0,
            humidity: sensorData.humidity || 0.0,
            pressure: sensorData.pressure || 0.0
        };

        // 2. Send to Python AI
        // This usually runs on http://127.0.0.1:5000/predict
        const response = await axios.post(config.ai.url, payload);
        return response.data;

    } catch (error) {
        // Log detailed error from Python if available
        if (error.response) {
            console.error("AI Service Error (422/500):", JSON.stringify(error.response.data));
        } else {
            console.error("AI Service Connection Error:", error.message);
        }
        
        // 3. Fallback Response (Safe Mode)
        // If Python is dead or rejects data, return this so the Node server keeps running.
        return { 
            node_id: sensorData.node_id,
            is_anomaly: false, 
            severity: "LOW", 
            anomaly_score: 0,
            ai_decision: { note: "AI Service Unavailable - Using Fallback" }
        };
    }
}

module.exports = { getPrediction };