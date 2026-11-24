/*
 * SignGuard event handlers. Outlook runs this file on its own (no task pane open):
 *  - in a browser runtime on Outlook on the web, new Outlook and Mac (via commands.html)
 *  - in a JavaScript-only runtime on classic Outlook for Windows (this file directly)
 * Classic Outlook needs a single plain script: no imports, no modules.
 */
/* global Office */

// Same origin as this file: the dev server proxies /api to the SignGuard backend.
var SIGNGUARD_API = "https://localhost:3000/api";
// "dev" sends the user's address as X-Dev-User. Switch to "entra" once Entra sign-in is set up.
var SIGNGUARD_AUTH_MODE = "dev";

function sgAsync(fn) {
  return new Promise(function (resolve, reject) {
    fn(function (result) {
      if (result.status === Office.AsyncResultStatus.Succeeded) resolve(result.value);
      else reject(result.error);
    });
  });
}

function sgHeaders() {
  var headers = { "Content-Type": "application/json" };
  if (SIGNGUARD_AUTH_MODE === "dev") {
    headers["X-Dev-User"] = Office.context.mailbox.userProfile.emailAddress;
  }
  // TODO(entra): get a token with MSAL nested app authentication and send
  // headers.Authorization = "Bearer " + token;
  return headers;
}

function sgPost(path, body) {
  return fetch(SIGNGUARD_API + path, {
    method: "POST",
    headers: sgHeaders(),
    body: JSON.stringify(body),
  }).then(function (res) {
    if (!res.ok) throw new Error("SignGuard API " + res.status);
    return res.json();
  });
}

function sgRecipients(item) {
  var fields = [item.to, item.cc, item.bcc].filter(Boolean);
  return Promise.all(
    fields.map(function (f) {
      return sgAsync(function (cb) { f.getAsync(cb); }).catch(function () { return []; });
    })
  ).then(function (lists) {
    var out = [];
    lists.forEach(function (list) {
      (list || []).forEach(function (r) { if (r.emailAddress) out.push(r.emailAddress); });
    });
    return out;
  });
}

function sgFromAddress(item) {
  if (!item.from || !item.from.getAsync) return Promise.resolve(null);
  return sgAsync(function (cb) { item.from.getAsync(cb); })
    .then(function (from) { return from && from.emailAddress ? from.emailAddress : null; })
    .catch(function () { return null; });
}

function sgSessionGet(item, key) {
  if (!item.sessionData) return Promise.resolve(null);
  return sgAsync(function (cb) { item.sessionData.getAsync(key, cb); }).catch(function () { return null; });
}

function sgSessionSet(item, key, value) {
  if (!item.sessionData) return Promise.resolve();
  return sgAsync(function (cb) { item.sessionData.setAsync(key, value || "", cb); }).catch(function () {});
}

/** Ask SignGuard for the right signature and put it in the email. */
function sgApplySignature(event) {
  var item = Office.context.mailbox.item;
  // In compose, a new message has no conversation yet; replies and forwards do.
  var messageType = item.conversationId ? "reply" : "new";

  Promise.all([sgRecipients(item), sgFromAddress(item), sgSessionGet(item, "sgCode")])
    .then(function (parts) {
      return sgPost("/addin/signature", {
        recipients: parts[0],
        from_email: parts[1],
        message_type: messageType,
        previous_code: parts[2] || null,
      });
    })
    .then(function (sig) {
      var steps = [sgSessionSet(item, "sgCode", sig.verification_code)];
      if (sig.warnings && sig.warnings.length) {
        steps.push(
          sgAsync(function (cb) {
            item.notificationMessages.replaceAsync("signguard", {
              type: Office.MailboxEnums.ItemNotificationMessageType.InformationalMessage,
              message: sig.warnings[0].slice(0, 150),
              icon: "Icon.16x16",
              persistent: false,
            }, cb);
          }).catch(function () {})
        );
      }
      if (!sig.html) return Promise.all(steps);
      steps.push(
        sgAsync(function (cb) {
          item.body.setSignatureAsync(sig.html, { coercionType: Office.CoercionType.Html }, cb);
        })
      );
      return Promise.all(steps);
    })
    .catch(function (err) {
      console.error("SignGuard: could not set the signature", err);
    })
    .then(function () {
      event.completed();
    });
}

function onNewMessageComposeHandler(event) {
  var item = Office.context.mailbox.item;
  // Stop Outlook adding the user's own signature on top of ours (Mailbox 1.10).
  if (item.disableClientSignatureAsync) {
    item.disableClientSignatureAsync(function () { sgApplySignature(event); });
  } else {
    sgApplySignature(event);
  }
}

function onMessageRecipientsChangedHandler(event) {
  sgApplySignature(event);
}

function onMessageFromChangedHandler(event) {
  sgApplySignature(event);
}

/** Record that the code was sent. Never blocks sending, even if SignGuard is down. */
function onMessageSendHandler(event) {
  var item = Office.context.mailbox.item;
  Promise.all([sgSessionGet(item, "sgCode"), sgAsync(function (cb) { item.subject.getAsync(cb); }).catch(function () { return ""; })])
    .then(function (parts) {
      if (!parts[0]) return null;
      return sgPost("/addin/sent", { verification_code: parts[0], subject: parts[1] || "" });
    })
    .catch(function (err) { console.error("SignGuard: could not record send", err); })
    .then(function () { event.completed({ allowEvent: true }); });
}

// The task pane loads this file for its helpers; only the event runtime registers handlers.
if (typeof SG_TASKPANE === "undefined") {
  Office.onReady(function () {});
  Office.actions.associate("onNewMessageComposeHandler", onNewMessageComposeHandler);
  Office.actions.associate("onMessageRecipientsChangedHandler", onMessageRecipientsChangedHandler);
  Office.actions.associate("onMessageFromChangedHandler", onMessageFromChangedHandler);
  Office.actions.associate("onMessageSendHandler", onMessageSendHandler);
}
