const axios = require('axios');
const config = require('../config/config');

async function getPrediction(sensorData) {
    try {
        // 1. Construct Payload (Must match Python Pydantic Model exactly)
        const payload = {
            node_id: sensorData.node_id,
            timestamp: sensorData.timestamp,
            
            // GPS
            latitude: sensorData.latitude,
            longitude: sensorData.longitude,
            
            // Raw Accelerometer
            accel_x: sensorData.accel_x,
            accel_y: sensorData.accel_y,
            accel_z: sensorData.accel_z,
            
            // Raw Magnetometer
            mag_x: sensorData.mag_x,
            mag_y: sensorData.mag_y,
            mag_z: sensorData.mag_z,
            
            // New Fields from ESP32
            heading: sensorData.heading || 0, // Default to 0 if missing
            tilt: sensorData.tilt,
            tilt_alert: sensorData.tilt_alert,
            
            // Computed Features
            accel_mag: sensorData.accel_mag,
            accel_roll_rms: sensorData.accel_roll_rms,
            mag_norm: sensorData.mag_norm,
            mic_level: sensorData.mic_level,
            
            // Environment
            temperature: sensorData.temperature,
            humidity: sensorData.humidity,
            pressure: sensorData.pressure
        };

        // 2. Send to Python AI
        const response = await axios.post(config.ai.url, payload);
        return response.data;

    } catch (error) {
        console.error("AI Service Connection Error:", error.message);
        
        // 3. Fallback Response (If AI is down, assume system is safe)
        return { 
            is_anomaly: false, 
            severity: "LOW", 
            anomaly_score: 0,
            ai_decision: { note: "AI Service Unavailable - Using Fallback" }
        };
    }
}

module.exports = { getPrediction };