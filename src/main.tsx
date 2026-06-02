import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { PdfViewer } from "./components/PdfViewer/PdfViewer";
import { ErrorBoundary } from "./components/ErrorBoundary";

const pdfPath = new URLSearchParams(window.location.search).get("pdfPath");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary name="App">
      {pdfPath ? <PdfViewer pdfPath={pdfPath} /> : <App />}
    </ErrorBoundary>
  </React.StrictMode>
);
