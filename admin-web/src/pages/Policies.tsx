
import { useMemo, useState } from "react";
import { api, type Employee, type SignatureResult } from "../api";
import {
  Badge,
  ErrorNote,
  Page,
  SignaturePreview,
  useLoad,
} from "../ui";

interface Policy {
  id: number;
  name: string;
  priority: number;
  departments: string;
  recipient_type: string;
  message_type: string;
  template_id: number;
  template_name: string | null;
  enabled: boolean;
}

interface PolicyForm {
  id?: number;
  name: string;
  priority: number;
  departments: string;
  recipient_type: string;
  message_type: string;
  template_id: number;
  enabled: boolean;
}

const EMPTY: PolicyForm = {
  name: "",
  priority: 100,
  departments: "",
  recipient_type: "any",
  message_type: "any",
  template_id: 0,
  enabled: true,
};

const recipientLabels: Record<string, string> = {
  any: "Anyone",
  internal: "Internal recipients",
  external: "External recipients",
};

const messageLabels: Record<string, string> = {
  any: "All email types",
  new: "New email",
  reply: "Reply or forward",
};

export default function Policies({ me }: { me: Employee }) {
  const policies = useLoad(() => api<Policy[]>("/policies"));
  const templates = useLoad(
    () => api<{ id: number; name: string }[]>("/templates")
  );
  const people = useLoad(() => api<Employee[]>("/employees"));

  const [editing, setEditing] = useState<PolicyForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const isAdmin = me.role === "admin";

  const [sender, setSender] = useState("sara.khan@contoso.com");
  const [recipients, setRecipients] = useState("buyer@fabrikam.com");
  const [messageType, setMessageType] = useState("new");
  const [result, setResult] = useState<SignatureResult | null>(null);
  const [testing, setTesting] = useState(false);

  const allPolicies = policies.data ?? [];
  const allTemplates = templates.data ?? [];

  const enabledCount = allPolicies.filter((p) => p.enabled).length;
  const disabledCount = allPolicies.length - enabledCount;

  const templatesUsed = new Set(
    allPolicies.map((p) => p.template_id)
  ).size;

  const visiblePolicies = useMemo(() => {
    return allPolicies
      .filter((p) => {
        const query = search.trim().toLowerCase();

        const matchesSearch =
          !query ||
          p.name.toLowerCase().includes(query) ||
          p.departments.toLowerCase().includes(query) ||
          (p.template_name ?? "").toLowerCase().includes(query);

        const matchesStatus =
          statusFilter === "all" ||
          (statusFilter === "enabled" && p.enabled) ||
          (statusFilter === "disabled" && !p.enabled);

        return matchesSearch && matchesStatus;
      })
      .sort(
        (a, b) =>
          a.priority - b.priority || a.id - b.id
      );
  }, [allPolicies, search, statusFilter]);

  const startCreate = () => {
    setError(null);
    setEditing({
      ...EMPTY,
      template_id: allTemplates[0]?.id ?? 0,
    });
  };

  const startEdit = (p: Policy) => {
    setError(null);
    setEditing({
      id: p.id,
      name: p.name,
      priority: p.priority,
      departments: p.departments,
      recipient_type: p.recipient_type,
      message_type: p.message_type,
      template_id: p.template_id,
      enabled: p.enabled,
    });
  };

  const save = async () => {
    if (!editing) return;

    if (!editing.name.trim()) {
      setError("Please enter a policy name.");
      return;
    }

    if (!editing.template_id) {
      setError("Please select a template.");
      return;
    }

    setError(null);

    try {
      const { id, ...body } = editing;

      await api(
        id ? `/policies/${id}` : "/policies",
        {
          method: id ? "PUT" : "POST",
          body,
        }
      );

      setEditing(null);
      policies.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (p: Policy) => {
    if (!confirm(`Delete the policy "${p.name}"?`)) return;

    setError(null);

    try {
      await api(`/policies/${p.id}`, {
        method: "DELETE",
      });

      policies.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const test = async () => {
    setError(null);
    setTesting(true);
    setResult(null);

    try {
      const recipientList = recipients
        .split(/[,;\s]+/)
        .map((r) => r.trim())
        .filter(Boolean);

      const response = await api<SignatureResult>(
        "/policies/test",
        {
          body: {
            sender_email: sender,
            recipients: recipientList,
            message_type: messageType,
          },
        }
      );

      setResult(response);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <Page
      title="Signature policies"
      intro="Control which email signature is applied to employees based on department, recipients and message type."
      actions={
        isAdmin && (
          <button onClick={startCreate}>
            + Create policy
          </button>
        )
      }
    >
      <ErrorNote error={policies.error ?? error} />

      {/* Dashboard summary */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          gap: 14,
          marginBottom: 24,
        }}
      >
        <div className="card">
          <div style={{ color: "var(--muted, #888)", fontSize: 13 }}>
            Total policies
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>
            {allPolicies.length}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted, #888)" }}>
            Configured policies
          </div>
        </div>

        <div className="card">
          <div style={{ color: "var(--muted, #888)", fontSize: 13 }}>
            Enabled policies
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>
            {enabledCount}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted, #888)" }}>
            Available for matching
          </div>
        </div>

        <div className="card">
          <div style={{ color: "var(--muted, #888)", fontSize: 13 }}>
            Disabled policies
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>
            {disabledCount}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted, #888)" }}>
            Excluded from matching
          </div>
        </div>

        <div className="card">
          <div style={{ color: "var(--muted, #888)", fontSize: 13 }}>
            Templates used
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>
            {templatesUsed}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted, #888)" }}>
            Distinct assigned templates
          </div>
        </div>
      </div>

      {/* Policy editor */}
      {editing && (
        <div
          className="card"
          style={{ marginBottom: 24 }}
        >
          <h2 style={{ marginTop: 0 }}>
            {editing.id ? "Edit policy" : "Create policy"}
          </h2>

          <p style={{ color: "var(--muted, #888)", fontSize: 13 }}>
            Configure the conditions that determine when this signature
            policy should be selected.
          </p>

          <div className="form-grid">
            <label>
              Policy name
              <input
                value={editing.name}
                placeholder="e.g. Sales External Signature"
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    name: e.target.value,
                  })
                }
              />
            </label>

            <label>
              Execution priority
              <input
                type="number"
                value={editing.priority}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    priority: Number(e.target.value),
                  })
                }
              />
              <small>Lower numbers are evaluated first.</small>
            </label>

            <label>
              Departments
              <input
                value={editing.departments}
                placeholder="Sales, Marketing"
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    departments: e.target.value,
                  })
                }
              />
              <small>Comma-separated. Leave empty for everyone.</small>
            </label>

            <label>
              Recipient conditions
              <select
                value={editing.recipient_type}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    recipient_type: e.target.value,
                  })
                }
              >
                <option value="any">Anyone</option>
                <option value="internal">Internal recipients only</option>
                <option value="external">External recipients</option>
              </select>
            </label>

            <label>
              Email type
              <select
                value={editing.message_type}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    message_type: e.target.value,
                  })
                }
              >
                <option value="any">New, reply or forward</option>
                <option value="new">New email</option>
                <option value="reply">Reply or forward</option>
              </select>
            </label>

            <label>
              Assigned signature template
              <select
                value={editing.template_id}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    template_id: Number(e.target.value),
                  })
                }
              >
                <option value={0}>Select a template</option>
                {allTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>

            <label
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
              }}
            >
              <input
                type="checkbox"
                checked={editing.enabled}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    enabled: e.target.checked,
                  })
                }
              />
              Enable this policy
            </label>
          </div>

          <div className="row" style={{ marginTop: 20 }}>
            <button
              onClick={save}
              disabled={
                !editing.name.trim() ||
                !editing.template_id
              }
            >
              Save policy
            </button>

            <button
              className="secondary"
              onClick={() => setEditing(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Policy list */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 14,
            marginBottom: 18,
          }}
        >
          <div>
            <h2 style={{ margin: 0 }}>Policy execution order</h2>
            <p style={{ color: "var(--muted, #888)", fontSize: 13 }}>
              The first enabled policy that matches is selected.
            </p>
          </div>

          <div className="row">
            <input
              value={search}
              placeholder="Search policies..."
              onChange={(e) => setSearch(e.target.value)}
            />

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All policies</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </select>
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Execution order</th>
                <th>Policy</th>
                <th>Department</th>
                <th>Recipients</th>
                <th>Email type</th>
                <th>Template</th>
                <th>Status</th>
                {isAdmin && <th>Actions</th>}
              </tr>
            </thead>

            <tbody>
              {visiblePolicies.map((p, index) => (
                <tr key={p.id}>
                  <td>
                    <strong>#{index + 1}</strong>
                    <div style={{ fontSize: 11, color: "var(--muted, #888)" }}>
                      Priority {p.priority}
                    </div>
                  </td>

                  <td>
                    <strong>{p.name}</strong>
                  </td>

                  <td>{p.departments || "Everyone"}</td>

                  <td>
                    {recipientLabels[p.recipient_type] ??
                      p.recipient_type}
                  </td>

                  <td>
                    {messageLabels[p.message_type] ??
                      p.message_type}
                  </td>

                  <td>{p.template_name ?? "Unavailable"}</td>

                  <td>
                    {p.enabled ? (
                      <Badge>Enabled</Badge>
                    ) : (
                      <Badge>Disabled</Badge>
                    )}
                  </td>

                  {isAdmin && (
                    <td className="nowrap">
                      <button
                        className="link-button"
                        onClick={() => startEdit(p)}
                      >
                        Edit
                      </button>

                      <button
                        className="link-button danger"
                        onClick={() => remove(p)}
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}

              {visiblePolicies.length === 0 && (
                <tr>
                  <td
                    colSpan={isAdmin ? 8 : 7}
                    style={{
                      textAlign: "center",
                      padding: 30,
                      color: "var(--muted, #888)",
                    }}
                  >
                    No policies found. Try changing your search or filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Policy simulator */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Policy simulator</h2>

        <p style={{ color: "var(--muted, #888)", fontSize: 13 }}>
          Test a real employee and recipient combination to see which
          signature the existing policy engine selects.
        </p>

        <div className="form-grid">
          <label>
            Sender
            <select
              value={sender}
              onChange={(e) => setSender(e.target.value)}
            >
              {people.data?.map((p) => (
                <option key={p.email} value={p.email}>
                  {p.name} ({p.department})
                </option>
              ))}
            </select>
          </label>

          <label>
            Recipients
            <input
              value={recipients}
              placeholder="buyer@example.com"
              onChange={(e) => setRecipients(e.target.value)}
            />
            <small>Separate multiple recipients with commas.</small>
          </label>

          <label>
            Email type
            <select
              value={messageType}
              onChange={(e) => setMessageType(e.target.value)}
            >
              <option value="new">New email</option>
              <option value="reply">Reply</option>
              <option value="forward">Forward</option>
            </select>
          </label>

          <div className="row">
            <button onClick={test} disabled={testing || !sender}>
              {testing ? "Testing..." : "Run policy simulation"}
            </button>
          </div>
        </div>

        {result && (
          <div
            style={{
              border: "1px solid var(--border, #ddd)",
              borderRadius: 10,
              padding: 18,
              marginTop: 20,
            }}
          >
            <div style={{ marginBottom: 12 }}>
              <Badge>
                {result.policy_name
                  ? "Policy matched"
                  : "No policy matched"}
              </Badge>
            </div>

            <h3>
              {result.template_name ?? "No signature applied"}
            </h3>

            <p>
              <strong>Selected policy:</strong>{" "}
              {result.policy_name ?? "None"}
            </p>

            <p>
              <strong>Recipient classification:</strong>{" "}
              {result.recipient_type}
            </p>

            <p>
              <strong>Reason:</strong> {result.reason}
            </p>

            {result.warnings?.length > 0 && (
              <div>
                <strong>Warnings</strong>
                <ul>
                  {result.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}

            {result.html && (
              <>
                <h3>Signature preview</h3>
                <SignaturePreview html={result.html} />
              </>
            )}
          </div>
        )}
      </div>
    </Page>
  );
}
