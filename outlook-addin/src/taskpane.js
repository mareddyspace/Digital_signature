/* global Office, sgPost, sgRecipients, sgFromAddress, sgSessionGet, sgSessionSet, sgAsync */

function show(id, text) {
  document.getElementById(id).textContent = text || "–";
}

function refresh() {
  var item = Office.context.mailbox.item;
  show("status", "Checking…");
  Promise.all([sgRecipients(item), sgFromAddress(item), sgSessionGet(item, "sgCode")])
    .then(function (parts) {
      return sgPost("/addin/signature", {
        recipients: parts[0],
        from_email: parts[1],
        message_type: item.conversationId ? "reply" : "new",
        previous_code: parts[2] || null,
      });
    })
    .then(function (sig) {
      show("template", sig.template_name || "No signature");
      show("reason", sig.reason);
      show("rtype", sig.recipient_type === "internal" ? "Colleagues only" : "Includes people outside the company");
      show("code", sig.verification_code || "Not needed for colleagues");
      var w = document.getElementById("warnings");
      w.innerHTML = "";
      var box = document.createElement("div");
      if (sig.warnings && sig.warnings.length) {
        box.className = "warn";
        box.textContent = sig.warnings.join(" ");
      } else if (sig.on_behalf_of) {
        box.className = "ok";
        box.textContent = "Approved: you are sending on behalf of " + sig.on_behalf_of + ".";
      }
      if (box.textContent) w.appendChild(box);
      // Sandboxed so template HTML can never run script inside the add-in.
      document.getElementById("preview").srcdoc = sig.html || "";
      show("status", "");
      var steps = [sgSessionSet(item, "sgCode", sig.verification_code)];
      if (sig.html) {
        steps.push(sgAsync(function (cb) {
          item.body.setSignatureAsync(sig.html, { coercionType: Office.CoercionType.Html }, cb);
        }));
      }
      return Promise.all(steps);
    })
    .catch(function (err) {
      show("status", "Could not reach SignGuard: " + (err && err.message ? err.message : err));
    });
}

Office.onReady(function () {
  document.getElementById("refresh").addEventListener("click", refresh);
  refresh();
});
