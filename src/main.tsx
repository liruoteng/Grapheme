import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
const PdfViewer = React.lazy(() => import("./components/PdfViewer/PdfViewer").then((module) => ({ default: module.PdfViewer })));
import { ErrorBoundary } from "./components/ErrorBoundary";

const pdfPath = new URLSearchParams(window.location.search).get("pdfPath");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary name="App">
      <React.Suspense fallback={<div role="status">Loading…</div>}>
        {pdfPath ? <PdfViewer pdfPath={pdfPath} /> : <App />}
      </React.Suspense>
    </ErrorBoundary>
  </React.StrictMode>
);
