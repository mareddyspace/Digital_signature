import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { initAuth } from "./auth";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);

// Sign-in comes first: in entra mode no API call may go out without a token.
initAuth()
  .then((auth) => root.render(
    <StrictMode>
      <BrowserRouter>
        <App auth={auth} />
      </BrowserRouter>
    </StrictMode>,
  ))
  .catch((e: Error) => root.render(
    <div className="signin"><div className="signin-card">
      <h1>SignGuard can't start sign-in</h1>
      <div className="note bad" role="alert">{e.message}</div>
      <p className="sub">Check that the backend is running and its Entra ID settings are complete.</p>
    </div></div>,
  ));
