// TD-071: run any pending localStorage schema migrations before any
// component reads from storage. Keep this at the very top of the import
// graph so it executes during the synchronous module init, ahead of any
// `loadStored*()` call in feature modules (App.jsx + hooks initialize
// their state from localStorage during the App import below).
import { runStorageMigrations } from "./lib/storageSchema.js";
runStorageMigrations();

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// MapLibre's stylesheet ships with the lazy MapView/ShareDispatch chunks
// (imported in those modules) so it doesn't block first paint.
import "./wayfarer/index.css";
import "./index.css";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
