import React from "react";
import ReactDOM from "react-dom/client";
import "./character-engine/runtime";
import App from "./App";
import SettingsPanel from "./SettingsPanel";
import "./styles.css";

const settingsView = new URLSearchParams(window.location.search).get("view") === "settings";
document.documentElement.dataset.view = settingsView ? "settings" : "pet";
ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode>{settingsView ? <SettingsPanel /> : <App />}</React.StrictMode>);
