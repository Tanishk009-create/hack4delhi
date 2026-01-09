import React, { useEffect, useState, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import L from "leaflet";
import io from "socket.io-client";
import "leaflet/dist/leaflet.css";

// --- ICONS ---
const getIcon = (color) =>
  new L.Icon({
    iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/markers-default/${color}-marker.png`,
    shadowUrl:
      "https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png",
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
  });

const icons = {
  green: getIcon("green"),
  yellow: getIcon("yellow"),
  red: getIcon("red"),
  grey: getIcon("grey"),
};

const socket = io("http://localhost:3000");

export default function Dashboard() {
  const [nodes, setNodes] = useState({});
  const [alerts, setAlerts] = useState([]);
  const [telemetry, setTelemetry] = useState([]);
  const [selectedNode, setSelectedNode] = useState(null);

  useEffect(() => {
    socket.on("sensor_update", (data) => {
      setNodes((prev) => ({
        ...prev,
        [data.node_id]: {
          lat: data.latitude,
          lng: data.longitude,
          alt: data.altitude,
          lastSeen: data.timestamp,
          status: data.severity || "green",
        },
      }));

      setTelemetry((prev) => {
        const newData = [
          ...prev,
          {
            time: new Date(data.timestamp).toLocaleTimeString(),
            node_id: data.node_id,
            accel_mag: data.accel_mag,
            accel_roll_rms: data.accel_roll_rms,
            mag_norm: data.mag_norm,
            temperature: data.temperature,
            humidity: data.humidity,
            pressure: data.pressure,
          },
        ];
        return newData.slice(-50);
      });
    });

    socket.on("new_alert", (newAlert) => {
      setAlerts((prev) => [newAlert, ...prev]);
      setNodes((prev) => ({
        ...prev,
        [newAlert.nodeId]: {
          ...prev[newAlert.nodeId],
          status: newAlert.severity === "HIGH" ? "red" : "yellow",
        },
      }));
    });

    return () => {
      socket.off("sensor_update");
      socket.off("new_alert");
    };
  }, []);

  const graphData = useMemo(() => {
    if (!selectedNode) return telemetry;
    return telemetry.filter((t) => t.node_id === selectedNode);
  }, [telemetry, selectedNode]);

  const latestEnv = graphData.length > 0 ? graphData[graphData.length - 1] : {};

  // --- STRICT STYLES ---
  const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100dvh',
    width: '100%',
    overflow: 'hidden',
    fontFamily: 'Segoe UI, Tahoma, Geneva, Verdana, sans-serif'
  },

  header: {
    height: '50px',
    backgroundColor: '#0f172a',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 20px',
    flexShrink: 0
  },

 body: {
  display: 'flex',
  height: 'calc(100vh - 50px)', // header height
  overflow: 'hidden',
  minWidth: 0
},


  /* LEFT MAP */
  leftPanel: {
  flex: '0 0 50%',
  height: '100%',
  overflow: 'hidden',
  borderRight: '1px solid #e5e7eb'
},


  /* RIGHT DATA PANEL */
  rightPanel: {
    flex: '0 0 50%',
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: '#f8fafc',
    minWidth: 0
  },

  /* ALERTS — TOP */
  alertSection: {
    flex: '0 0 35%',
    overflowY: 'auto',
    backgroundColor: 'white',
    borderBottom: '1px solid #e5e7eb'
  },

  /* GRAPHS — BOTTOM */
  graphSection: {
    flex: '1 1 65%',
    display: 'flex',
    flexDirection: 'column',
    padding: '10px',
    minHeight: 0
  },

  gridContainer: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gridTemplateRows: '1fr 1fr',
    gap: '10px',
    flex: 1,
    minHeight: 0
  }
};

  return (
    <>
      {/* GLOBAL CSS RESET */}
      <style>{`
                html, body, #root { height: 100%; margin: 0; padding: 0; overflow: hidden; }
                .leaflet-container { height: 100% !important; width: 100% !important; }
            `}</style>

      <div style={styles.container}>
        {/* HEADER */}
        <header style={styles.header}>
          <h1 style={{ fontSize: "1.2rem", fontWeight: "bold" }}>
            🚄 RailGuard Operator View
          </h1>
          <div style={{ fontSize: "0.9rem" }}>
            Status:{" "}
            <span style={{ color: "#4ade80", fontWeight: "bold" }}>
              MONITORING
            </span>
          </div>
        </header>

        {/* BODY */}
        <div style={styles.body}>
          {/* LEFT: MAP */}
          <div style={styles.leftPanel}>
  <div style={{ height: '100%', width: '100%' }}>
    <MapContainer
      center={[28.6139, 77.2090]}
      zoom={13}
      style={{ height: '100%', width: '100%' }}
    >

              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution="&copy; OpenStreetMap"
              />
              {Object.entries(nodes).map(([id, node]) => (
                <Marker
                  key={id}
                  position={[node.lat || 0, node.lng || 0]}
                  icon={icons[node.status] || icons.green}
                  eventHandlers={{ click: () => setSelectedNode(id) }}
                >
                  <Popup>
                    <b>{id}</b>
                    <br />
                    Status: {node.status}
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          </div>

          {/* RIGHT: DATA */}
          <div style={styles.rightPanel}>
            {/* 1. ALERTS */}
            <div style={styles.alertSection}>
              <div
                style={{
                  padding: "10px 15px",
                  borderBottom: "1px solid #eee",
                  fontWeight: "bold",
                  display: "flex",
                  justifyContent: "space-between",
                  position: "sticky",
                  top: 0,
                  background: "white",
                  zIndex: 10,
                }}
              >
                <span>🚨 Active Incident Feed</span>
                <span style={{ color: "red", fontSize: "0.8rem" }}>
                  {alerts.length} Active
                </span>
              </div>
              <table
                style={{
                  width: "100%",
                  fontSize: "0.85rem",
                  borderCollapse: "collapse",
                }}
              >
                <thead
                  style={{
                    background: "#f1f5f9",
                    color: "#64748b",
                    textAlign: "left",
                  }}
                >
                  <tr>
                    <th style={{ padding: "8px 15px" }}>Time</th>
                    <th style={{ padding: "8px 15px" }}>Node</th>
                    <th style={{ padding: "8px 15px" }}>Severity</th>
                    <th style={{ padding: "8px 15px" }}>Conf.</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map((alert, idx) => (
                    <tr key={idx} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "8px 15px" }}>
                        {new Date(alert.timestamp).toLocaleTimeString()}
                      </td>
                      <td style={{ padding: "8px 15px" }}>{alert.nodeId}</td>
                      <td style={{ padding: "8px 15px" }}>
                        <span
                          style={{
                            padding: "2px 6px",
                            borderRadius: "4px",
                            fontSize: "0.7rem",
                            fontWeight: "bold",
                            background:
                              alert.severity === "HIGH" ? "#fee2e2" : "#fef9c3",
                            color:
                              alert.severity === "HIGH" ? "#991b1b" : "#854d0e",
                          }}
                        >
                          {alert.severity}
                        </span>
                      </td>
                      <td style={{ padding: "8px 15px" }}>
                        {Math.round(Math.abs(alert.anomaly_score) * 100)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 2. GRAPHS */}
            <div style={styles.graphSection}>
              <div
                style={{
                  marginBottom: "5px",
                  fontSize: "0.9rem",
                  fontWeight: "bold",
                  color: "#475569",
                }}
              >
                📈 Live Telemetry
              </div>

<div style={styles.gridContainer}>
                {/* Vibration */}
                <div
                  style={{
                    background: "white",
                    border: "1px solid #e2e8f0",
                    borderRadius: "6px",
                    padding: "10px",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.7rem",
                      fontWeight: "bold",
                      color: "#94a3b8",
                      marginBottom: "5px",
                    }}
                  >
                    VIBRATION
                  </div>
                  <div style={{ flex: 1, minHeight: 0 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={graphData}>
                        <CartesianGrid stroke="#f1f5f9" />
                        <XAxis dataKey="time" hide />
                        <YAxis width={30} tick={{ fontSize: 10 }} />
                        <Tooltip />
                        <Line
                          type="monotone"
                          dataKey="accel_mag"
                          stroke="#6366f1"
                          dot={false}
                          strokeWidth={2}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Magnetic */}
                <div
                  style={{
                    background: "white",
                    border: "1px solid #e2e8f0",
                    borderRadius: "6px",
                    padding: "10px",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.7rem",
                      fontWeight: "bold",
                      color: "#94a3b8",
                      marginBottom: "5px",
                    }}
                  >
                    MAGNETIC
                  </div>
                  <div style={{ flex: 1, minHeight: 0 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={graphData}>
                        <CartesianGrid stroke="#f1f5f9" />
                        <XAxis dataKey="time" hide />
                        <YAxis
                          width={30}
                          tick={{ fontSize: 10 }}
                          domain={["auto", "auto"]}
                        />
                        <Tooltip />
                        <Line
                          type="monotone"
                          dataKey="mag_norm"
                          stroke="#f59e0b"
                          dot={false}
                          strokeWidth={2}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Environment */}
                <div
                  style={{
                    gridColumn: "span 2",
                    background: "white",
                    border: "1px solid #e2e8f0",
                    borderRadius: "6px",
                    padding: "10px",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.7rem",
                      fontWeight: "bold",
                      color: "#94a3b8",
                      marginBottom: "5px",
                    }}
                  >
                    ENVIRONMENT
                  </div>
                  <div style={{ flex: 1, minHeight: 0 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={[
                          {
                            name: "Temp",
                            value: latestEnv.temperature || 0,
                            fill: "#ef4444",
                          },
                          {
                            name: "Hum",
                            value: latestEnv.humidity || 0,
                            fill: "#3b82f6",
                          },
                          {
                            name: "Pres",
                            value: (latestEnv.pressure || 0) / 100,
                            fill: "#8b5cf6",
                          },
                        ]}
                        layout="vertical"
                      >
                        <CartesianGrid stroke="#f1f5f9" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 10 }} />
                        <YAxis
                          dataKey="name"
                          type="category"
                          width={40}
                          tick={{ fontSize: 10 }}
                        />
                        <Tooltip />
                        <Bar
                          dataKey="value"
                          barSize={15}
                          radius={[0, 4, 4, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}