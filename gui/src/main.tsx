/// <reference types="vite/client" />
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

function applySystemTheme() {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle("dark", prefersDark);
}

applySystemTheme();
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applySystemTheme);

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root container is missing.");
}

const root = createRoot(container);

const render = () => {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
};

if (import.meta.env.DEV) {
  // In a plain browser there is no Electron preload bridge; install the
  // in-memory mock before the app reads window.heimdall. The module is a
  // no-op inside Electron, and this branch is removed from production builds.
  void import("./mock-desktop-api.ts").then(render);
} else {
  render();
}
