// Face ID / Touch ID sign-in (passkeys), shared by the sign-in page and the members app.
// Needs /webauthn.js loaded first.
(function () {
  const W = window.SimpleWebAuthnBrowser;
  const supported = !!(window.PublicKeyCredential && W);
  const ua = navigator.userAgent;
  // What people call it on their device
  const name = /iPhone|iPad/.test(ua) ? "Face ID" : /Macintosh/.test(ua) ? "Touch ID" : /Android/.test(ua) ? "your fingerprint" : /Windows/.test(ua) ? "Windows Hello" : "a passkey";
  const FLAG = "sh-passkey-here";   // this device has one set up
  const here = () => { try { return localStorage.getItem(FLAG) === "1"; } catch { return false; } };
  const mark = () => { try { localStorage.setItem(FLAG, "1"); } catch {} };
  const unmark = () => { try { localStorage.removeItem(FLAG); } catch {} };
  const SKIP = "sh-passkey-skip";   // said "Not now" to setting it up
  const skipped = () => { try { return localStorage.getItem(SKIP) === "1"; } catch { return false; } };
  const skip = () => { try { localStorage.setItem(SKIP, "1"); } catch {} };
  const post = async (path, body) => {
    const r = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.message || "Something went wrong. Please try again."), { code: d.error });
    return d;
  };

  // Sign in. With autofill, the device offers the passkey in the email field's keyboard suggestions.
  async function signIn(autofill = false) {
    const o = await post("/api/passkey/login/options");
    let response;
    try { response = await W.startAuthentication({ optionsJSON: o.options, useBrowserAutofill: autofill }); }
    catch (e) {
      // Autofill waits quietly in the background: if it can't run, say nothing
      if (autofill || (e && (e.name === "AbortError" || e.code === "ERROR_CEREMONY_ABORTED"))) throw Object.assign(new Error(""), { code: "aborted" });
      unmark();   // maybe it isn't set up here after all: lead with email next time
      throw Object.assign(new Error("That didn't go through, or it isn't set up for Stag Hunt on this device yet. Use email instead."), { code: "cancelled" });
    }
    try { await post("/api/passkey/login/verify", { challengeId: o.challengeId, response }); }
    catch (e) {
      // The account no longer has this passkey: tell the device to forget it
      if (e.code === "unknown_passkey") unmark();
      if (e.code === "unknown_passkey" && PublicKeyCredential.signalUnknownCredential)
        PublicKeyCredential.signalUnknownCredential({ rpId: o.options.rpId, credentialId: response.id }).catch(() => {});
      throw e;
    }
    mark();
  }

  async function setUp() {
    const o = await post("/api/passkey/register/options");
    let response;
    try { response = await W.startRegistration({ optionsJSON: o.options }); }
    catch (e) {
      if (e && e.name === "InvalidStateError") { mark(); return; }   // already set up on this device
      throw new Error("Set-up was cancelled.");
    }
    await post("/api/passkey/register/verify", { challengeId: o.challengeId, response });
    mark();
  }

  // Whether this device has Face ID, Touch ID or similar built in
  const available = () => (supported ? W.platformAuthenticatorIsAvailable().catch(() => false) : Promise.resolve(false));
  window.Passkey = { supported, name, here, skipped, skip, signIn, setUp, available, autofill: () => (supported ? W.browserSupportsWebAuthnAutofill() : Promise.resolve(false)) };
})();
