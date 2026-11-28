import { useState } from "react";
import { Link } from "react-router-dom";
import { api, fmt, type Delegation, type Permission } from "../api";
import { Badge, ErrorNote, Page, PERMISSION_TEXT, SignaturePreview, StateBadge, flagText, useLoad } from "../ui";

interface MyTrustData {
  me: { name: string; email: string; job_title: string; department: string };
  signature_external: string;
  signature_internal: string;
  signature_for_mail_apps: string;
  who_can_send_as_me: Permission[];
  delegations: Delegation[];
}

export default function MyTrust() {
  const { data, error } = useLoad(() => api<MyTrustData>("/me/trust"));
  return (
    <Page title="My signature" intro="Your signature, and everyone who can send email as you.">
      <ErrorNote error={error} />
      {data && (
        <>
          <InstallInOutlook html={data.signature_for_mail_apps} />
          <h2 className="section">Who can send as me</h2>
          {data.who_can_send_as_me.length === 0 ? (
            <div className="empty">Nobody else has access to your mailbox.</div>
          ) : (
            <div className="card flush table-wrap"><table>
              <thead><tr><th>Person</th><th>Access</th><th>Granted</th><th>Last used</th><th>Status</th></tr></thead>
              <tbody>
                {data.who_can_send_as_me.map((p) => (
                  <tr key={p.id}>
                    <td><strong>{p.trustee_name}</strong><div className="sub">{p.trustee}</div></td>
                    <td>{PERMISSION_TEXT[p.type] ?? p.type}</td>
                    <td>{fmt(p.granted_at)}</td>
                    <td>{p.last_used ? fmt(p.last_used) : "Never"}</td>
                    <td>{p.flags.length ? p.flags.map((f) => <Badge key={f} tone="bad">{flagText(f)}</Badge>) : <Badge tone="good">Approved</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
          <p className="sub">Don't recognise someone? Tell your IT team. To give someone time-limited access, use <Link to="/delegations">Delegations</Link>.</p>

          <h2 className="section">My delegations</h2>
          {data.delegations.length === 0 ? (
            <div className="empty">No delegations.</div>
          ) : (
            <div className="card flush table-wrap"><table>
              <thead><tr><th>Who sends</th><th>For whom</th><th>Until</th><th>Status</th></tr></thead>
              <tbody>
                {data.delegations.map((d) => (
                  <tr key={d.id}>
                    <td>{d.delegate_name}</td>
                    <td>{d.owner_name}</td>
                    <td>{fmt(d.ends_at)}</td>
                    <td><StateBadge state={d.state} /></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}

          <h2 className="section">My signatures</h2>
          <div className="two">
            <div><h3>To people outside the company</h3><SignaturePreview html={data.signature_external} /></div>
            <div><h3>To colleagues</h3><SignaturePreview html={data.signature_internal} height={120} /></div>
          </div>
        </>
      )}
    </Page>
  );
}

const STEPS: Record<string, { name: string; steps: string[] }> = {
  web: { name: "Outlook on the web", steps: [
    "Click Copy signature above.",
    "Open outlook.office.com, then Settings (gear icon) → Account → Signatures.",
    "Click + New signature, name it SignGuard, click in the box and press Ctrl + V.",
    "Under Select default signatures, choose SignGuard for new messages and for replies/forwards. Click Save.",
  ] },
  newOutlook: { name: "New Outlook for Windows", steps: [
    "Click Copy signature above.",
    "In Outlook, Settings (gear icon) → Account → Signatures.",
    "Click + New signature, name it SignGuard and press Ctrl + V in the box.",
    "Choose SignGuard as the default for new messages and replies/forwards. Click Save.",
  ] },
  classic: { name: "Classic Outlook", steps: [
    "Click Copy signature above.",
    "In Outlook, File → Options → Mail → Signatures…",
    "Click New, name it SignGuard, click in the edit box and press Ctrl + V.",
    "Pick SignGuard for New messages and Replies/forwards, then OK.",
  ] },
};

/** Copy the signature (formatted) so a person can paste it into their mail app's signature settings once. */
function InstallInOutlook({ html }: { html: string }) {
  const [app, setApp] = useState<keyof typeof STEPS>("web");
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    const plain = new DOMParser().parseFromString(html, "text/html").body.innerText;
    try {
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plain], { type: "text/plain" }),
      })]);
      setState("copied");
    } catch {
      // Older browsers: copy the rendered signature through a hidden, selected element.
      const box = document.createElement("div");
      box.innerHTML = html;
      box.style.cssText = "position:fixed;left:-9999px;top:0";
      document.body.appendChild(box);
      const range = document.createRange();
      range.selectNodeContents(box);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      const ok = document.execCommand("copy");
      sel?.removeAllRanges();
      box.remove();
      setState(ok ? "copied" : "failed");
    }
  };
  return (
    <div className="card install">
      <div className="install-head">
        <div>
          <h2 className="section" style={{ margin: 0 }}>Use it in Outlook</h2>
          <p className="sub" style={{ margin: "4px 0 0" }}>Copy your signature once and paste it into Outlook's signature settings. Copy again whenever your details change.</p>
        </div>
        <button onClick={copy}>{state === "copied" ? "✓ Copied" : "Copy signature"}</button>
      </div>
      {state === "failed" && <div className="note bad" role="alert">Your browser blocked copying. Select the signature below with the mouse and press Ctrl + C.</div>}
      <div className="seg" role="tablist" aria-label="Outlook version">
        {Object.entries(STEPS).map(([key, v]) => (
          <button key={key} role="tab" aria-selected={app === key} className={app === key ? "on" : ""} onClick={() => setApp(key as keyof typeof STEPS)}>{v.name}</button>
        ))}
      </div>
      <ol className="install-steps">{STEPS[app].steps.map((s) => <li key={s}>{s}</li>)}</ol>
      <p className="sub">This copy has no per-email verification code; that needs the SignGuard Outlook add-in.</p>
    </div>
  );
}
