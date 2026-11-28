import { useEffect, useRef, useState } from "react";
import { api, type Employee, type SignatureResult } from "../api";
import { Badge, ErrorNote, Page, SignaturePreview, useLoad } from "../ui";

interface VerifyResult { result: "verified" | "warning"; title: string; message: string }

/**
 * Stand-in for Outlook: it calls exactly the endpoints the add-in calls, so the whole flow can
 * be shown without a Microsoft 365 tenant.
 */
export default function Compose({ me }: { me: Employee }) {
  const people = useLoad(() => api<{ email: string; name: string }[]>("/dev/users"));
  const [from, setFrom] = useState(me.email);
  const [to, setTo] = useState("buyer@fabrikam.com");
  const [isReply, setIsReply] = useState(false);
  const [subject, setSubject] = useState("Invoice 4471 for October");
  const [sig, setSig] = useState<SignatureResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ code: string | null; to: string } | null>(null);
  const [check, setCheck] = useState<VerifyResult | null>(null);
  const codeRef = useRef<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api<SignatureResult>("/addin/signature", {
        body: {
          recipients: to.split(/[,;\s]+/).filter(Boolean),
          from_email: from,
          message_type: isReply ? "reply" : "new",
          previous_code: codeRef.current,
          // Tagged so previews here never count as real Outlook use in Analytics or Home.
          client: "simulator",
        },
      })
        .then((s) => {
          codeRef.current = s.verification_code ?? codeRef.current;
          setSig(s);
          setError(null);
        })
        .catch((e: Error) => setError(e.message));
    }, 400);
    return () => clearTimeout(t);
  }, [to, from, isReply]);

  const send = async () => {
    try {
      if (sig?.verification_code) await api("/addin/sent", { body: { verification_code: sig.verification_code, subject } });
      setSent({ code: sig?.verification_code ?? null, to });
      setCheck(null);
      codeRef.current = null;
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const verify = async (code: string, yourEmail?: string) => {
    const res = await fetch("/api/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, your_email: yourEmail ?? null }),
    });
    setCheck(await res.json());
  };

  const newEmail = () => {
    setSent(null);
    setCheck(null);
    setTo(to + " ");
  };

  return (
    <Page title="Try it: write an email" intro="This page calls the same API as the Outlook add-in. Change the recipients or the From address and watch the signature change.">
      <ErrorNote error={error ?? people.error} />
      {!sent ? (
        <div className="compose">
          <div className="compose-field">
            <label htmlFor="from">From</label>
            <select id="from" value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value={me.email}>{me.name} (me)</option>
              {people.data?.filter((p) => p.email !== me.email).map((p) => <option key={p.email} value={p.email}>{p.name}'s mailbox</option>)}
              <option value="finance@contoso.com">Finance shared mailbox</option>
            </select>
          </div>
          <div className="compose-field">
            <label htmlFor="to">To</label>
            <input id="to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@company.com, separated by commas" />
          </div>
          <div className="compose-field">
            <label htmlFor="subject">Subject</label>
            <input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            <label className="inline"><input type="checkbox" checked={isReply} onChange={(e) => setIsReply(e.target.checked)} /> Reply</label>
          </div>
          <textarea className="compose-body" defaultValue={"Hi,\n\nPlease find the invoice attached.\n\nThanks,"} rows={5} aria-label="Message" />
          {sig?.warnings.map((w) => <div key={w} className="note warn">{w}</div>)}
          {sig ? <SignaturePreview html={sig.html} height={200} /> : <div className="empty">{error ? "No signature" : "Loading signature…"}</div>}
          <div className="compose-foot">
            <div className="why">
              {sig && (
                <>
                  <Badge tone={sig.recipient_type === "internal" ? "info" : "neutral"}>{sig.recipient_type === "internal" ? "colleagues only" : "outside recipients"}</Badge>
                  {sig.on_behalf_of && <Badge tone="good">On behalf of {sig.on_behalf_of}</Badge>}
                  <span className="sub">{sig.template_name ?? "No signature"}: {sig.reason}</span>
                </>
              )}
            </div>
            <button onClick={send}>Send</button>
          </div>
        </div>
      ) : (
        <div className="card">
          <h2>Sent to {sent.to.trim()}</h2>
          {sent.code ? (
            <>
              <p>The recipient can check <code>{sent.code}</code> at <a href="/verify" target="_blank" rel="noreferrer">the verify page</a>. Try it as them:</p>
              <div className="row">
                <button onClick={() => verify(sent.code!, sent.to.split(/[,;\s]+/).filter(Boolean)[0])}>Check as the real recipient</button>
                <button className="secondary" onClick={() => verify(sent.code!, "attacker@evil.example")}>Check as someone else who copied it</button>
                <button className="secondary" onClick={() => verify("SG-FAKE-4471")}>Check a fake email's code</button>
              </div>
            </>
          ) : (
            <p>Emails to colleagues don't carry a verification code.</p>
          )}
          {check && (
            <div className={`verify-result ${check.result}`}>
              <strong>{check.title}</strong>
              <p>{check.message}</p>
            </div>
          )}
          <button className="secondary" onClick={newEmail}>Write another email</button>
        </div>
      )}
    </Page>
  );
}
