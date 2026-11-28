/*
 * SignGuard event handlers. Outlook runs this file on its own (no task pane open):
 *  - in a browser runtime on Outlook on the web, new Outlook and Mac (via commands.html)
 *  - in a JavaScript-only runtime on classic Outlook for Windows (this file directly)
 * Classic Outlook needs a single plain script: no imports, no modules. serve.js therefore
 * serves /launchevent.js as one file: the MSAL browser library, then SIGNGUARD_ORIGIN, then this.
 */
/* global Office, msal, SIGNGUARD_ORIGIN */

// The add-in host also proxies /api to the SignGuard backend, so the API is on the same origin.
var SIGNGUARD_API = (typeof SIGNGUARD_ORIGIN !== "undefined" ? SIGNGUARD_ORIGIN : "https://localhost:3000") + "/api";

function sgAsync(fn) {
  return new Promise(function (resolve, reject) {
    fn(function (result) {
      if (result.status === Office.AsyncResultStatus.Succeeded) resolve(result.value);
      else reject(result.error);
    });
  });
}

// ---------------------------------------------------------------- sign-in

var sgConfigPromise = null;
var sgMsalPromise = null;

/** {mode: "dev"} or {mode: "entra", tenant_id, client_id, scopes}, from the backend (public IDs only). */
function sgConfig() {
  if (!sgConfigPromise) {
    sgConfigPromise = fetch(SIGNGUARD_API + "/auth/config").then(function (res) {
      if (!res.ok) throw new Error("SignGuard sign-in settings unavailable (" + res.status + ")");
      return res.json();
    });
    sgConfigPromise.catch(function () { sgConfigPromise = null; });
  }
  return sgConfigPromise;
}

function sgNaaSupported() {
  try {
    return Office.context.requirements.isSetSupported("NestedAppAuth", "1.1");
  } catch (e) {
    return false;
  }
}

/** MSAL with nested app authentication: Outlook signs the user in; no password or pop-up in events. */
function sgMsal(cfg) {
  if (!sgMsalPromise) {
    if (typeof msal === "undefined" || !msal.createNestablePublicClientApplication) {
      return Promise.reject(new Error("MSAL library not loaded"));
    }
    sgMsalPromise = msal.createNestablePublicClientApplication({
      auth: { clientId: cfg.client_id, authority: "https://login.microsoftonline.com/" + cfg.tenant_id },
      cache: { cacheLocation: "localStorage" },
    });
    sgMsalPromise.catch(function () { sgMsalPromise = null; });
  }
  return sgMsalPromise;
}

/**
 * An access token for the SignGuard API. interactive=true may show a Microsoft sign-in pop-up,
 * which is only allowed from the task pane, never from an event handler.
 */
function sgToken(interactive) {
  return sgConfig().then(function (cfg) {
    if (cfg.mode !== "entra") return null;
    if (!sgNaaSupported()) throw new Error("This version of Outlook can't sign in to add-ins (nested app authentication). Update Outlook, or use Copy to Outlook in SignGuard.");
    return sgMsal(cfg).then(function (app) {
      var request = { scopes: cfg.scopes };
      return app.acquireTokenSilent(request).catch(function (err) {
        if (!interactive) throw err;
        return app.acquireTokenPopup(request);
      });
    }).then(function (result) { return result.accessToken; });
  });
}

function sgHeaders(interactive) {
  return Promise.all([sgConfig(), sgToken(interactive)]).then(function (parts) {
    var headers = { "Content-Type": "application/json" };
    if (parts[0].mode === "dev") {
      // Development backends only. A backend in Microsoft mode refuses this header.
      headers["X-Dev-User"] = Office.context.mailbox.userProfile.emailAddress;
    } else {
      headers.Authorization = "Bearer " + parts[1];
    }
    return headers;
  });
}

function sgPost(path, body, interactive) {
  return sgHeaders(interactive).then(function (headers) {
    return fetch(SIGNGUARD_API + path, { method: "POST", headers: headers, body: JSON.stringify(body) });
  }).then(function (res) {
    if (!res.ok) throw new Error("SignGuard API " + res.status);
    return res.json();
  });
}

// ---------------------------------------------------------------- reading the message

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

/** "new", "reply" or "forward" (Mailbox 1.10). Older clients: a conversation means reply or forward. */
function sgComposeType(item) {
  if (item.getComposeTypeAsync) {
    return sgAsync(function (cb) { item.getComposeTypeAsync(cb); })
      .then(function (v) {
        var t = v && v.composeType;
        return t === "reply" ? "reply" : t === "forward" ? "forward" : "new";
      })
      .catch(function () { return item.conversationId ? "reply" : "new"; });
  }
  return Promise.resolve(item.conversationId ? "reply" : "new");
}

function sgSessionGet(item, key) {
  if (!item.sessionData) return Promise.resolve(null);
  return sgAsync(function (cb) { item.sessionData.getAsync(key, cb); }).catch(function () { return null; });
}

function sgSessionSet(item, key, value) {
  if (!item.sessionData) return Promise.resolve();
  return sgAsync(function (cb) { item.sessionData.setAsync(key, value || "", cb); }).catch(function () {});
}

function sgNotify(item, text, isError) {
  if (!item.notificationMessages) return Promise.resolve();
  return sgAsync(function (cb) {
    item.notificationMessages.replaceAsync("signguard", {
      type: isError
        ? Office.MailboxEnums.ItemNotificationMessageType.ErrorMessage
        : Office.MailboxEnums.ItemNotificationMessageType.InformationalMessage,
      message: String(text).slice(0, 150),
      icon: "Icon.16x16",
      persistent: false,
    }, cb);
  }).catch(function () {});
}

/** Everything the API needs about the open message. */
function sgRequest(item) {
  return Promise.all([sgRecipients(item), sgFromAddress(item), sgSessionGet(item, "sgCode"), sgComposeType(item)])
    .then(function (parts) {
      return {
        recipients: parts[0],
        from_email: parts[1],
        previous_code: parts[2] || null,
        message_type: parts[3],
        client: "outlook",
      };
    });
}

/** Put the HTML in Outlook's signature area. It replaces SignGuard's previous signature, never stacks. */
function sgInsert(item, sig) {
  var steps = [sgSessionSet(item, "sgCode", sig.verification_code)];
  if (sig.warnings && sig.warnings.length) steps.push(sgNotify(item, sig.warnings[0], false));
  if (sig.html) {
    steps.push(sgAsync(function (cb) {
      item.body.setSignatureAsync(sig.html, { coercionType: Office.CoercionType.Html }, cb);
    }));
  }
  return Promise.all(steps);
}

/** Ask SignGuard for the right signature and put it in the email. */
function sgApplySignature(event) {
  var item = Office.context.mailbox.item;
  sgRequest(item)
    .then(function (body) { return sgPost("/addin/signature", body, false); })
    .then(function (sig) { return sgInsert(item, sig); })
    .catch(function (err) {
      console.error("SignGuard: could not set the signature", err);
      return sgNotify(item, "SignGuard couldn't add your signature. Open SignGuard on the ribbon to sign in or see why.", true);
    })
    .then(function () { event.completed(); });
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
      return sgPost("/addin/sent", { verification_code: parts[0], subject: parts[1] || "" }, false);
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
