from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
import pandas as pd
import numpy as np
import joblib
import os

app = FastAPI()

# -----------------------------
# Load trained model & scaler
# -----------------------------
# (Mock loading if files don't exist to prevent crash during setup)
if os.path.exists("isolation_forest.pkl") and os.path.exists("scaler.pkl"):
    model = joblib.load("isolation_forest.pkl")
    scaler = joblib.load("scaler.pkl")
    print("✅ AI Model Loaded")
else:
    model = None
    scaler = None
    print("⚠️ No model found, running in Rule-Based Mode")

FEATURE_COLUMNS = [
    "accel_mag",
    "delta_accel_mag",
    "accel_roll_mean",
    "accel_roll_std",
    "accel_roll_rms",
    "accel_roll_range",
    "mag_norm",
    "delta_mag_norm",
    "TEMPERATURE",
    "HUMIDITY",
    "PRESSURE"
]

# rolling buffer for real-time vibration context
ROLL_BUFFER = []
WINDOW = 40

# -----------------------------
# Input schema (Must match ESP32 JSON exactly)
# -----------------------------
class SensorInput(BaseModel):
    node_id: str
    timestamp: int
    
    # GPS
    latitude: float
    longitude: float
    
    # Raw Sensors
    accel_x: float
    accel_y: float
    accel_z: float
    mag_x: float
    mag_y: float
    mag_z: float
    
    # New Fields from ESP32
    heading: float
    tilt: int       # Digital (0 or 1)
    tilt_alert: bool
    
    # Computed Features (ESP32 sends these now)
    accel_mag: float
    accel_roll_rms: float
    mag_norm: float
    mic_level: float
    
    # Environment
    temperature: float
    humidity: float
    pressure: float

# -----------------------------
# Prediction API
# -----------------------------
@app.post("/predict")
def predict(data: SensorInput):
    global ROLL_BUFFER

    # -----------------------------
    # VIBRATION ANALYSIS (Server-Side Calculation)
    # -----------------------------
    # We recalculate to maintain our own rolling buffer logic
    server_accel_mag = np.sqrt(
        data.accel_x**2 +
        data.accel_y**2 +
        data.accel_z**2
    )

    ROLL_BUFFER.append(server_accel_mag)
    if len(ROLL_BUFFER) > WINDOW:
        ROLL_BUFFER.pop(0)

    accel_roll_mean = float(np.mean(ROLL_BUFFER))
    accel_roll_std  = float(np.std(ROLL_BUFFER))
    accel_roll_rms  = float(np.sqrt(np.mean(np.square(ROLL_BUFFER))))
    accel_roll_range = float(max(ROLL_BUFFER) - min(ROLL_BUFFER))

    # -----------------------------
    # ANOMALY DETECTION LOGIC
    # -----------------------------
    is_anomaly = False
    severity = "LOW"
    anomaly_score = 0.0

    # 1. Rule-Based Checks (Immediate Flags)
    # Tilt=0 usually means triggered (Active Low)
    if data.tilt == 0:
        is_anomaly = True
        severity = "CRITICAL"
        anomaly_score = 0.98
        print(f"🚨 TILT DETECTED at {data.node_id}")

    elif data.accel_mag > 2.5: # Hard vibration threshold
        is_anomaly = True
        severity = "HIGH"
        anomaly_score = min(data.accel_mag / 4.0, 1.0)

    # 2. AI Model Prediction (If available)
    elif model and scaler:
        try:
            # Prepare feature vector matching training data
            feature_row = pd.DataFrame([{
                "accel_mag": server_accel_mag,
                "delta_accel_mag": 0, # Simplified for stream
                "accel_roll_mean": accel_roll_mean,
                "accel_roll_std": accel_roll_std,
                "accel_roll_rms": accel_roll_rms,
                "accel_roll_range": accel_roll_range,
                "mag_norm": data.mag_norm,
                "delta_mag_norm": 0,
                "TEMPERATURE": data.temperature,
                "HUMIDITY": data.humidity,
                "PRESSURE": data.pressure
            }])

            X_scaled = scaler.transform(feature_row[FEATURE_COLUMNS])
            
            # Predict
            score = model.decision_function(X_scaled)[0]
            prediction = model.predict(X_scaled)[0]  # -1 anomaly, +1 normal
            
            if prediction == -1:
                is_anomaly = True
                severity = "MEDIUM" # AI anomalies usually subtle start
                anomaly_score = abs(float(score)) # Distance from hyperplane
        except Exception as e:
            print(f"AI Prediction Error: {e}")

    # -----------------------------
    # RESPONSE
    # -----------------------------
    return {
        "node_id": data.node_id,
        "is_anomaly": is_anomaly,
        "severity": severity,
        "anomaly_score": round(anomaly_score, 2),
        
        # Pass back computed features for frontend visualization
        "ai_decision": {
            "tilt_detected": data.tilt == 0,
            "vibration_peak": round(server_accel_mag, 3),
            "rolling_rms": round(accel_roll_rms, 3),
            "mag_strength": round(data.mag_norm, 3),
            "mic_level": data.mic_level
        },
        
        # Keep environment data passing through
        "environment": {
            "temp": data.temperature,
            "hum": data.humidity
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)