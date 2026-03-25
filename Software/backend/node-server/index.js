require('dotenv').config(); // <--- ADD THIS LINE

const express = require('express');
const http = require('http');
const cors = require('cors');
const bodyParser = require('body-parser'); 
const axios = require('axios'); // <--- ADDED for Python API Calls
const { initSocket } = require('./socket/socket');
const { connectMQTT } = require('./mqtt/mqttClient');
const dataController = require('./controllers/dataController');
const { sendCriticalAlert } = require('./services/alertService'); // <--- IMPORT EMAIL SERVICE

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' })); // <--- UPDATED
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true })); // <--- ADDED

const server = http.createServer(app);
// Initialize Socket.io (Must be done before MQTT)
const io = initSocket(server);

// --- CONFIGURATION ---
const PYTHON_AI_URL = 'http://127.0.0.1:5000/predict';
const dashboardAlertCooldowns = new Map();         // <--- ADD THIS
const DASHBOARD_COOLDOWN_TIME = 15 * 1000;         // <--- ADD THIS (15 Seconds)

// --- API ROUTES ---

// 1. Get all historical alerts (for map load)
app.get('/api/alerts', (req, res) => {
    res.json(dataController.readAlerts());
});

// 2. Mark as Construction
app.post('/api/alerts/mark-construction', (req, res) => {
    const { id } = req.body;
    const updated = dataController.markConstruction(id);
    if(updated) {
        io.emit('alert_update', updated); // Notify frontend immediately
        res.json({ success: true, alert: updated });
    } else {
        res.status(404).json({ error: "Alert not found" });
    }
});

// --- START SYSTEM ---

// Connect to MQTT and pass the "Anomaly Handler" callback
const mqttClient = connectMQTT(async (rawData) => {
    
    // FIX: Normalize the Node ID (Handle both 'nodeId' and 'node_id')
    const targetNodeId = rawData.nodeId || rawData.node_id;

    if (targetNodeId) {
        try {
            // 1. Send Raw Data to Python AI Engine
            const aiResponse = await axios.post(PYTHON_AI_URL, rawData,{timeout:5000});
            const aiAnalysis = aiResponse.data;

            // 2. Broadcast Live Telemetry to Dashboard
            const telemetryPacket = {
                ...rawData,
                ...aiAnalysis,
                timestamp: rawData.timestamp || Date.now(),
                node_id: targetNodeId
            };
            io.emit('sensor_update', telemetryPacket);

            // 3. Handle Alerts if Python Flags Anomaly
            if (aiAnalysis.is_anomaly) {
                const now = Date.now();
                const lastAlertTime = dashboardAlertCooldowns.get(targetNodeId) || 0;

                // FLOOD PROTECTION: Only trigger a dashboard alert every 15 seconds
                if (now - lastAlertTime > DASHBOARD_COOLDOWN_TIME) {
                    dashboardAlertCooldowns.set(targetNodeId, now); 
                    
                    console.log(`🚨 Anomaly Detected by Sensors: ${targetNodeId}. Waking Camera...`);
                    
                    const severity = aiAnalysis.severity || "CRITICAL"; 
                    const savedAlert = dataController.addAlert(targetNodeId, severity);
                    
                    const broadcastPacket = {
                        ...savedAlert,                 
                        lat: rawData.lat || rawData.latitude || 28.6139, 
                        lng: rawData.lng || rawData.longitude || 77.2090,
                        anomaly_score: aiAnalysis.anomaly_score || 1.0,
                        nodeId: targetNodeId,
                        severity: severity,
                        reasons: aiAnalysis.reasons ? aiAnalysis.reasons.join(", ") : "",
                        // Pass current telemetry so React can send it back to /vision later
                        telemetry: {
                            accel_mag: aiAnalysis.accel_mag,
                            mag_norm: aiAnalysis.mag_norm
                        }
                    };
                    
                    io.emit('new_alert', broadcastPacket);
                }
            }

        } catch (error) {
            console.error("Error communicating with Python AI Engine:", error.message);
            io.emit('sensor_update', { ...rawData, node_id: targetNodeId, timestamp: Date.now() });
        }
    }
});

const { GoogleGenerativeAI } = require("@google/generative-ai");

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Create the Vision Endpoint
app.post('/api/vision', async (req, res) => {
    // UPDATED: Destructure node_id and telemetry passed from React
    const { alert_id, image_base64, node_id, telemetry } = req.body;

    try {
        const base64Data = image_base64.replace(/^data:image\/(png|jpeg|jpg);base64,/, "");

        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash", 
            generationConfig: { responseMimeType: "application/json" } 
        });

        const prompt = `
        You are a highly secure railway monitoring AI. Analyze this image of a railway track.
        Determine if there is any evidence of tampering, sabotage, or unauthorized presence.
        Respond ONLY with a JSON object in this exact format:
        {
            "confirmed": true/false,
            "confidence": <number between 0 and 100>,
            "reason": "<A brief, 1-sentence explanation of what you see>"
        }`;

        const imagePart = {
            inlineData: {
                data: base64Data,
                mimeType: "image/jpeg"
            }
        };

        // const result = await model.generateContent([prompt, imagePart]);
        // const responseText = result.response.text();
        // const aiVerdict = JSON.parse(responseText);
        
        // // ==========================================
        // // NEW: DISPATCH EMAIL ONLY ON VISION CONFIRM
        // // ==========================================
        // if (aiVerdict.confirmed === true) {
        //     console.log(`✅ VISUAL CONFIRMATION: Sending Email Report for ${node_id || "Unknown Node"}`);
            
        //     await sendCriticalAlert({
        //         node_id: node_id || "TRACK_SEC_42",
        //         severity: "CRITICAL (Visual Confirmation)",
        //         image: image_base64, // The email service will handle the attachment
        //         reason: aiVerdict.reason,
        //         confidence: aiVerdict.confidence,
        //         accel_mag: telemetry?.accel_mag,
        //         mag_norm: telemetry?.mag_norm,
        //         latitude: telemetry?.latitude,
        //         longitude: telemetry?.longitude
        //     });
        // }
        const result = await model.generateContent([prompt, imagePart]);
        const responseText = await result.response.text();

let aiVerdict;
try {
    // Regex helps strip any markdown (```json ... ```) Gemini might add
    const cleanJson = responseText.replace(/```json|```/g, "").trim();
    aiVerdict = JSON.parse(cleanJson);
} catch (e) {
    console.error("AI returned malformed JSON:", responseText);
    return res.status(500).json({ status: "error", message: "AI response parsing failed" });
}
        
        res.json({
            status: "success",
            alert_id: alert_id,
            visual_confirmation: aiVerdict.confirmed,
            confidence: aiVerdict.confidence,
            reason: aiVerdict.reason
        });

    } catch (error) {
        console.error("VLM Error:", error);
        res.status(500).json({ status: "error", message: "Vision analysis failed" });
    }
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`\n==================================================`);
    console.log(`RailGuard Backend Active`);
    console.log(`API:    http://localhost:${PORT}`);
    console.log(`Socket: Enabled`);
    console.log(`AI:     ${PYTHON_AI_URL}`);
    console.log(`==================================================\n`);
});