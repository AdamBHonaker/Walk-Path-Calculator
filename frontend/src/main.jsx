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
