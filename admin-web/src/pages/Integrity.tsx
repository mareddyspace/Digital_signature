import { useState } from "react";
import { api } from "../api";
import { Badge, ErrorNote, Page, useLoad } from "../ui";

interface Seal { template_id: number; name: string; version: number; status: "sealed" | "tampered" | "unsealed"; sha256: string }
interface Check {
  result: string; tone: string; title: string; message: string;
  matched_lines?: number; total_lines?: number; altered?: { received: string; similarity: number }[]; removed_count?: number;
}

const TONE: Record<string, "good" | "bad" | "warn"> = { sealed: "good", tampered: "bad", unsealed: "warn" };

export default function Integrity() {
  const seals = useLoad(() => api<Seal[]>("/integrity/templates"));
  const [code, setCode] = useState("");
  const [text, setText] = useState("");
  const [result, setResult] = useState<Check | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tampered = seals.data?.filter((s) => s.status === "tampered").length ?? 0;

  const check = async () => {
    setError(null);
    setResult(null);
    try {
      setResult(await api<Check>("/integrity/signature", { body: { code, signature: text } }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Page
      title="Signature integrity"
      intro="Every approved template is sealed with a keyed hash, and every external email's signature is recorded with its verification code. SignGuard refuses to use a template that was changed outside approval, and lets anyone check whether a received signature was altered."
    >
      <ErrorNote error={seals.error} />
      <div className={`note ${tampered ? "bad" : "good"}`}>
        {tampered ? `${tampered} live template(s) failed the integrity check and are blocked.` : "All live templates match their approved, sealed versions."}
      </div>
      <div className="two-wide">
        <div className="card">
          <h2>Template seals</h2>
          <table>
            <thead><tr><th>Template</th><th>Version</th><th>Seal</th><th>SHA-256</th></tr></thead>
            <tbody>
              {seals.data?.map((s) => (
                <tr key={s.template_id}>
                  <td>{s.name}</td>
                  <td>{s.version}</td>
                  <td><Badge tone={TONE[s.status]}>{s.status}</Badge></td>
                  <td><code className="hash" title={s.sha256}>{s.sha256.slice(0, 16)}…</code></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="sub">Seals are HMAC-SHA256 with the server's CODE_SECRET, written when a second admin approves a version.</p>
        </div>
        <div className="card">
          <h2>Check a received signature</h2>
          <p className="sub">For suspected invoice or payment fraud: paste the signature from the email. Recipients can do the same on the public verify page.</p>
          <label className="field">Verification code<input value={code} placeholder="SG-XXXX-XXXX" onChange={(e) => setCode(e.target.value)} className="mono" /></label>
          <label className="field">Signature or whole email<textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} /></label>
          <button onClick={check} disabled={code.trim().length < 4 || !text.trim()}>Compare</button>
          <ErrorNote error={error} />
          {result && (
            <div className={`verify-result ${result.tone}`}>
              <strong>{result.title}</strong>
              <p>{result.message}</p>
              {result.total_lines !== undefined && <p className="sub">{result.matched_lines} of {result.total_lines} lines match.</p>}
              {result.altered && result.altered.length > 0 && (
                <ul>{result.altered.map((a) => <li key={a.received}>Changed: “{a.received}”</li>)}</ul>
              )}
            </div>
          )}
        </div>
      </div>
    </Page>
  );
}
