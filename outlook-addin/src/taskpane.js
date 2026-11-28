/* global Office, sgPost, sgRequest, sgInsert */

function show(id, text) {
  document.getElementById(id).textContent = text || "–";
}

function refresh() {
  var item = Office.context.mailbox.item;
  show("status", "Checking…");
  sgRequest(item)
    // The pane may show a Microsoft sign-in pop-up if Outlook can't sign in silently.
    .then(function (body) { return sgPost("/addin/signature", body, true); })
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
      return sgInsert(item, sig);
    })
    .catch(function (err) {
      show("status", "Could not get your signature from SignGuard: " + (err && err.message ? err.message : err));
    });
}

Office.onReady(function () {
  document.getElementById("refresh").addEventListener("click", refresh);
  refresh();
});
