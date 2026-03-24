require('dotenv').config(); // <--- ADD THIS LINE

const express = require('express');
const http = require('http');
const cors = require('cors');
const bodyParser = require('body-parser'); 
const axios = require('axios'); // <--- ADDED for Python API Calls
const { initSocket } = require('./socket/socket');
const { connectMQTT } = require('./mqtt/mqttClient');
const dataController = require('./controllers/dataController');

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
// We are replacing the standard 'data' pass-through with the Python AI logic layer
const mqttClient = connectMQTT(async (rawData) => {
    
    // FIX: Normalize the Node ID (Handle both 'nodeId' and 'node_id')
    const targetNodeId = rawData.nodeId || rawData.node_id;

    if (targetNodeId) {
        try {
            // ==========================================
            // NEW: 1. Send Raw Data to Python AI Engine
            // ==========================================
            // The Python engine handles the 3-Stage Lock (Vibration + Mic + Mag)
            const aiResponse = await axios.post(PYTHON_AI_URL, rawData);
            const aiAnalysis = aiResponse.data;

            // ==========================================
            // NEW: 2. Broadcast Live Telemetry to Dashboard
            // ==========================================
            // We emit the live sensor data + AI scores for the graphs
            const telemetryPacket = {
                ...rawData,
                ...aiAnalysis,
                timestamp: rawData.timestamp || Date.now(),
                node_id: targetNodeId
            };
            io.emit('sensor_update', telemetryPacket);

            // ==========================================
            // ==========================================
            // NEW: 3. Handle Alerts if Python Flags Anomaly
            // ==========================================
            if (aiAnalysis.is_anomaly) {
                const now = Date.now();
                const lastAlertTime = dashboardAlertCooldowns.get(targetNodeId) || 0;

                // FLOOD PROTECTION: Only trigger a new dashboard incident every 15 seconds
                if (now - lastAlertTime > DASHBOARD_COOLDOWN_TIME) {
                    dashboardAlertCooldowns.set(targetNodeId, now); // Update cooldown timer
                    
                    console.log(`🚨 Registering New Incident: ${targetNodeId}`);
                    
                    const severity = aiAnalysis.severity || "CRITICAL"; 
                    const savedAlert = dataController.addAlert(targetNodeId, severity);
                    
                    // MERGE Data for Frontend Map
                    const broadcastPacket = {
                        ...savedAlert,                 
                        lat: rawData.lat || rawData.latitude || 28.6139, 
                        lng: rawData.lng || rawData.longitude || 77.2090,
                        anomaly_score: aiAnalysis.anomaly_score || 1.0,
                        nodeId: targetNodeId,
                        severity: severity, // <--- CRITICAL FIX: Ensures React knows to open the camera!
                        reasons: aiAnalysis.reasons ? aiAnalysis.reasons.join(", ") : "" 
                    };
                    
                    // Broadcast FULL alert object to Frontend
                    io.emit('new_alert', broadcastPacket);
                }
            }

        } catch (error) {
            console.error("Error communicating with Python AI Engine:", error.message);
            // Fallback: If Python fails, still push the raw telemetry so graphs don't freeze
            io.emit('sensor_update', { ...rawData, node_id: targetNodeId, timestamp: Date.now() });
        }
    }
});

const { GoogleGenerativeAI } = require("@google/generative-ai");

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Create the Vision Endpoint
app.post('/api/vision', async (req, res) => {
    const { alert_id, image_base64 } = req.body;

    try {
        // 1. Strip the data URL prefix (e.g., "data:image/jpeg;base64,")
        const base64Data = image_base64.replace(/^data:image\/(png|jpeg|jpg);base64,/, "");

        // 2. Setup the Gemini model (Current Gen)
        // Note: 'gemini-2.5-flash' is not a standard model name yet. 
        // If this fails, revert to 'gemini-1.5-flash'
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash", 
            generationConfig: { responseMimeType: "application/json" } 
        });

        // 3. The Prompt Engineering (Crucial for accuracy)
        const prompt = `
        You are a highly secure railway monitoring AI. Analyze this image of a railway track.
        Determine if there is any evidence of tampering, sabotage, or unauthorized presence.
        Look for:
        - People standing on or dangerously close to the tracks.
        - Heavy tools (wrenches, hammers, saws, grinders) left on the tracks.
        - Missing fishplates, removed bolts, or cut rails.
        
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

        // 4. Send to Gemini
        const result = await model.generateContent([prompt, imagePart]);
        const responseText = result.response.text();
        
        // 5. Parse and Return
        const aiVerdict = JSON.parse(responseText);
        
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