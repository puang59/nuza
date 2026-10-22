import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import "./App.css";
import { installWebviewLockdown } from "./lib/webviewLockdown";
import { isLinuxPlatform } from "./lib/platform";

// Before anything is drawn: no right click should ever have offered a browser's menu.
installWebviewLockdown();

// So the stylesheet can leave out what this platform's web view draws badly.
if (isLinuxPlatform()) document.documentElement.dataset.platform = "linux";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
