require('dotenv').config(); // <--- ADD THIS LINE

const express = require('express');
const http = require('http');
const cors = require('cors');
const bodyParser = require('body-parser'); 
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
const mqttClient = connectMQTT((data) => {
    // FIX: Normalize the Node ID (Handle both 'nodeId' and 'node_id')
    const targetNodeId = data.nodeId || data.node_id;

    if (targetNodeId) {
        console.log(`Registering Incident: ${targetNodeId}`);
        
        // Use the severity calculated by Python (or fallback to MEDIUM)
        const severity = data.severity || "MEDIUM"; 
        
        // 1. Save to Database (JSON file)
        const savedAlert = dataController.addAlert(targetNodeId, severity);
        
        // 2. MERGE Data for Frontend
        // We must combine the Database ID with the Sensor Data (Lat/Lng) 
        // otherwise the map marker and table row won't appear.
        const broadcastPacket = {
            ...savedAlert,                 // Contains DB ID and Timestamp
            lat: data.lat || data.latitude || 28.6139, // Ensure Location exists
            lng: data.lng || data.longitude || 77.2090,
            anomaly_score: data.anomaly_score || 1.0,
            nodeId: targetNodeId           // Ensure Frontend gets 'nodeId'
        };
        
        // 3. Broadcast FULL alert object to Frontend
        io.emit('new_alert', broadcastPacket);
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

        // 2. Setup the Gemini 2.5 Flash model (Current Gen)
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash", // <--- THE FIX
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
    console.log(`==================================================\n`);
});