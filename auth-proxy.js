const http = require("http");
const https = require("https");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { URL, URLSearchParams } = require("url");
const os = require("os");

// --- User-Agent for outbound requests ---
const osArch = `${os.platform()}/${os.arch()}`;
const USER_AGENT = `blaxel/template/openclaw/1.0 (${osArch})`;

// --- Configuration ---
const PORT = parseInt(process.env.PORT || "80", 10);
const UPSTREAM_PORT = parseInt(process.env.UPSTREAM_PORT || "8080", 10);
const UPSTREAM = `http://127.0.0.1:${UPSTREAM_PORT}`;
const BL_CLOUD = process.env.BL_CLOUD === "true";
const BL_ENV = process.env.BL_ENV || "prod";

// Basic auth config
const PROXY_USER = process.env.PROXY_USER;
const PROXY_PASSWORD = process.env.PROXY_PASSWORD;

// If proxy credentials are explicitly set, use basic auth even on Blaxel cloud
const AUTH_MODE = (PROXY_USER && PROXY_PASSWORD) ? "basic" : (BL_CLOUD ? "oauth2" : "basic");

// URL the proxy uses server-side (email login, profile)
const AUTH_BASE_INTERNAL =
  process.env.OAUTH_INTERNAL_URL ||
  process.env.OAUTH_BASE_URL ||
  (BL_ENV === "dev"
    ? "https://api.blaxel.dev/v0"
    : "https://api.blaxel.ai/v0");
// URL the browser is redirected to (authorize endpoint, SSO)
const AUTH_BASE =
  process.env.OAUTH_BASE_URL ||
  (BL_ENV === "dev"
    ? "https://api.blaxel.dev/v0"
    : "https://api.blaxel.ai/v0");

// Workspace restriction (only allow users who belong to this workspace)
const BL_WORKSPACE = process.env.BL_WORKSPACE || "";

// OpenClaw SVG favicon (inline, no external file needed)
const OPENCLAW_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><path d="M60 10 C30 10 15 35 15 55 C15 75 30 95 45 100 L45 110 L55 110 L55 100 C55 100 60 102 65 100 L65 110 L75 110 L75 100 C90 95 105 75 105 55 C105 35 90 10 60 10Z" fill="#ff4040"/><path d="M20 45 C5 40 0 50 5 60 C10 70 20 65 25 55 C28 48 25 45 20 45Z" fill="#ff4040"/><path d="M100 45 C115 40 120 50 115 60 C110 70 100 65 95 55 C92 48 95 45 100 45Z" fill="#ff4040"/><path d="M45 15 Q35 5 30 8" stroke="#ff6b5a" stroke-width="2" stroke-linecap="round" fill="none"/><path d="M75 15 Q85 5 90 8" stroke="#ff6b5a" stroke-width="2" stroke-linecap="round" fill="none"/><circle cx="45" cy="35" r="6" fill="#050810"/><circle cx="75" cy="35" r="6" fill="#050810"/><circle cx="46" cy="34" r="2" fill="#00e5cc"/><circle cx="76" cy="34" r="2" fill="#00e5cc"/></svg>`;

const COOKIE_SECRET =
  process.env.COOKIE_SECRET || crypto.randomBytes(32).toString("hex");
const COOKIE_NAME = "__bl_session";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h

if (AUTH_MODE === "basic" && (!PROXY_USER || !PROXY_PASSWORD)) {
  console.error(
    "ERROR: PROXY_USER and PROXY_PASSWORD are required for basic auth mode."
  );
  process.exit(1);
}

// --- In-memory stores ---
const sessions = new Map(); // sessionId -> { user, accessToken, expiresAt }
// Cleanup expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of sessions) {
    if (now > v.expiresAt) sessions.delete(k);
  }
}, 5 * 60 * 1000);

// --- Helpers ---
function signCookie(sessionId) {
  const sig = crypto
    .createHmac("sha256", COOKIE_SECRET)
    .update(sessionId)
    .digest("hex");
  return `${sessionId}.${sig}`;
}

function verifyCookie(value) {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot < 0) return null;
  const sessionId = value.substring(0, dot);
  const sig = value.substring(dot + 1);
  const expected = crypto
    .createHmac("sha256", COOKIE_SECRET)
    .update(sessionId)
    .digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
    return null;
  return sessionId;
}

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  header.split(";").forEach((c) => {
    const [k, ...v] = c.trim().split("=");
    if (k) cookies[k.trim()] = v.join("=").trim();
  });
  return cookies;
}

function getSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies[COOKIE_NAME];
  const sessionId = verifyCookie(raw);
  if (!sessionId) return null;
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    return null;
  }
  return session;
}

function getOrigin(req) {
  const proto =
    req.headers["x-forwarded-proto"] ||
    (req.socket.encrypted ? "https" : "http");
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function isSecure(req) {
  return (
    req.headers["x-forwarded-proto"] === "https" || req.socket.encrypted
  );
}

function setCookie(res, req, sessionId) {
  const value = signCookie(sessionId);
  let cookie = `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`;
  if (isSecure(req)) cookie += "; Secure";
  res.setHeader("Set-Cookie", cookie);
}

function clearCookie(res, req) {
  let cookie = `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  if (isSecure(req)) cookie += "; Secure";
  res.setHeader("Set-Cookie", cookie);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function fetchRaw(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === "https:" ? https : http;
    const reqOpts = {
      method: options.method || "GET",
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      headers: { "User-Agent": USER_AGENT, ...options.headers },
    };
    const req = mod.request(reqOpts, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          rawBody: data,
        });
      });
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function fetchJSON(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === "https:" ? https : http;
    const reqOpts = {
      method: options.method || "GET",
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      headers: { "User-Agent": USER_AGENT, ...options.headers },
    };
    const req = mod.request(reqOpts, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: JSON.parse(data),
          });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// Check if user belongs to the BL_WORKSPACE workspace
// Uses the access token (OAuth) or session cookie (email) to call the controlplane API
async function checkWorkspaceMembership(accessToken, sessionCookie) {
  if (!BL_WORKSPACE) return { ok: true }; // No workspace restriction

  const headers = {};
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  } else if (sessionCookie) {
    headers["Cookie"] = sessionCookie;
  } else {
    return { ok: false, error: "No credentials to verify workspace membership" };
  }

  try {
    const wsRes = await fetchJSON(
      `${AUTH_BASE_INTERNAL}/workspaces/${encodeURIComponent(BL_WORKSPACE)}`,
      { headers }
    );
    if (wsRes.status === 200) {
      return { ok: true };
    }
    if (wsRes.status === 403) {
      console.error(`[auth] User does not have access to workspace "${BL_WORKSPACE}"`);
      return { ok: false, error: `You do not have access to workspace "${BL_WORKSPACE}"` };
    }
    if (wsRes.status === 404) {
      console.error(`[auth] Workspace "${BL_WORKSPACE}" not found`);
      return { ok: false, error: `Workspace "${BL_WORKSPACE}" not found` };
    }
    console.error(`[auth] Workspace check returned status ${wsRes.status}:`, wsRes.body);
    return { ok: false, error: "Failed to verify workspace membership" };
  } catch (err) {
    console.error("[auth] Workspace membership check failed:", err.message);
    return { ok: false, error: "Unable to verify workspace membership" };
  }
}

function createSession(res, req, user, accessToken) {
  const sessionId = crypto.randomBytes(24).toString("hex");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(sessionId, { user, accessToken: accessToken || null, expiresAt });
  setCookie(res, req, sessionId);
  console.log(`[auth] User logged in: ${user}`);
}

// =====================
// Login page HTML
// =====================
function getLoginPageHTML(error, emailSent) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign in - OpenClaw</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a;
      color: #e5e5e5;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      width: 100%;
      max-width: 400px;
      padding: 2rem;
    }
    .logo {
      text-align: center;
      margin-bottom: 2rem;
    }
    .logo img {
      height: 40px;
      margin-bottom: 0.75rem;
    }
    .logo h1 {
      font-size: 1.5rem;
      font-weight: 600;
      color: #fff;
    }
    .logo p {
      font-size: 0.875rem;
      color: #888;
      margin-top: 0.25rem;
    }
    .card {
      background: #141414;
      border: 1px solid #262626;
      border-radius: 12px;
      padding: 1.5rem;
    }
    .error {
      background: #2d1212;
      border: 1px solid #5c2020;
      color: #f87171;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      font-size: 0.875rem;
      margin-bottom: 1rem;
    }
    .success {
      background: #0d2818;
      border: 1px solid #1a5c2e;
      color: #4ade80;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      font-size: 0.875rem;
      margin-bottom: 1rem;
    }
    .divider {
      display: flex;
      align-items: center;
      margin: 1.25rem 0;
      color: #525252;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .divider::before, .divider::after {
      content: '';
      flex: 1;
      border-top: 1px solid #262626;
    }
    .divider span { padding: 0 0.75rem; }
    .form-group { margin-bottom: 1rem; }
    .form-group label {
      display: block;
      font-size: 0.875rem;
      color: #a3a3a3;
      margin-bottom: 0.375rem;
    }
    input[type="email"], input[type="text"] {
      width: 100%;
      padding: 0.625rem 0.75rem;
      background: #0a0a0a;
      border: 1px solid #333;
      border-radius: 8px;
      color: #fff;
      font-size: 0.9375rem;
      outline: none;
      transition: border-color 0.15s;
    }
    input:focus { border-color: #666; }
    .btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      width: 100%;
      padding: 0.625rem 1rem;
      border-radius: 8px;
      font-size: 0.9375rem;
      font-weight: 500;
      cursor: pointer;
      border: 1px solid #333;
      transition: background 0.15s, border-color 0.15s;
      text-decoration: none;
    }
    .btn-primary {
      background: #fff;
      color: #0a0a0a;
      border-color: #fff;
    }
    .btn-primary:hover { background: #e5e5e5; border-color: #e5e5e5; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-outline {
      background: transparent;
      color: #e5e5e5;
    }
    .btn-outline:hover { background: #1a1a1a; border-color: #444; }
    #email-step, #code-step { display: none; }
    #email-step.active, #code-step.active { display: block; }
    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      color: #888;
      font-size: 0.8125rem;
      cursor: pointer;
      margin-bottom: 1rem;
      border: none;
      background: none;
      padding: 0;
    }
    .back-link:hover { color: #ccc; }
    .code-hint {
      font-size: 0.8125rem;
      color: #888;
      margin-bottom: 1rem;
    }
    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid #666;
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <img src="/assets/blaxel-logo.png" alt="Blaxel" onerror="this.style.display='none'">
      <h1>Sign in to OpenClaw</h1>
      <p>Authenticate to access your workspace</p>
    </div>
    <div class="card">
      ${error ? `<div class="error">${error}</div>` : ""}
      <div id="error-box" class="error" style="display:none"></div>

      <div id="email-step" class="${emailSent ? "" : "active"}">
        <form id="email-form" action="/auth/email" method="POST">
          <div class="form-group">
            <label for="email">Email address</label>
            <input type="email" id="email" name="email" placeholder="you@example.com" required autofocus>
          </div>
          <button type="submit" class="btn btn-primary" id="email-submit">
            Continue with Email
          </button>
        </form>
      </div>

      <div id="code-step" class="${emailSent ? "active" : ""}">
        <button class="back-link" onclick="showEmailStep()">&#8592; Back</button>
        <p class="code-hint">We sent a sign-in code to <strong id="sent-email">${emailSent || ""}</strong>. Check your inbox and enter it below.</p>
        <form id="code-form" action="/auth/email/verify" method="POST">
          <input type="hidden" name="email" value="${emailSent || ""}">
          <div class="form-group">
            <label for="code">Verification code</label>
            <input type="text" id="code" name="code" placeholder="Enter code" required autofocus autocomplete="one-time-code">
          </div>
          <button type="submit" class="btn btn-primary" id="code-submit">
            Sign in
          </button>
        </form>
      </div>
    </div>
  </div>
  <script>
    function showError(msg) {
      const box = document.getElementById('error-box');
      box.textContent = msg;
      box.style.display = 'block';
    }
    function hideError() {
      document.getElementById('error-box').style.display = 'none';
    }
    function showEmailStep() {
      document.getElementById('email-step').classList.add('active');
      document.getElementById('code-step').classList.remove('active');
      hideError();
    }
    document.getElementById('email-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      hideError();
      const btn = document.getElementById('email-submit');
      const email = document.getElementById('email').value;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Sending...';
      try {
        const res = await fetch('/auth/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const data = await res.json();
        if (!res.ok) {
          showError(data.error || 'Failed to send code');
          btn.disabled = false;
          btn.textContent = 'Continue with Email';
          return;
        }
        document.getElementById('sent-email').textContent = email;
        document.querySelector('#code-form input[name="email"]').value = email;
        document.getElementById('email-step').classList.remove('active');
        document.getElementById('code-step').classList.add('active');
        document.getElementById('code').focus();
      } catch (err) {
        showError('Network error. Please try again.');
      }
      btn.disabled = false;
      btn.textContent = 'Continue with Email';
    });
    document.getElementById('code-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      hideError();
      const btn = document.getElementById('code-submit');
      const code = document.getElementById('code').value;
      const email = document.querySelector('#code-form input[name="email"]').value;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Verifying...';
      try {
        const res = await fetch('/auth/email/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, email }),
        });
        const data = await res.json();
        if (!res.ok) {
          showError(data.error || 'Verification failed');
          btn.disabled = false;
          btn.textContent = 'Sign in';
          return;
        }
        window.location.href = '/';
      } catch (err) {
        showError('Network error. Please try again.');
      }
      btn.disabled = false;
      btn.textContent = 'Sign in';
    });
  </script>
</body>
</html>`;
}

// =====================
// Basic Auth
// =====================
function checkBasicAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Basic ")) return null;
  const decoded = Buffer.from(authHeader.slice(6), "base64").toString();
  const colon = decoded.indexOf(":");
  if (colon < 0) return null;
  const user = decoded.substring(0, colon);
  const pass = decoded.substring(colon + 1);
  if (user === PROXY_USER && pass === PROXY_PASSWORD) return user;
  return null;
}

function sendBasicAuthChallenge(res) {
  res.writeHead(401, {
    "WWW-Authenticate": 'Basic realm="OpenClaw"',
    "Content-Type": "text/plain",
  });
  res.end("Unauthorized");
}

// =====================
// OAuth2 / SSO Routes
// =====================

// =====================
// Email login routes
// =====================

// POST /auth/email - Send verification code to email
async function handleEmailSend(req, res) {
  let body;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid request body" }));
    return;
  }

  const email = (body.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Valid email address is required" }));
    return;
  }

  // Call controlplane login/email endpoint
  try {
    const cpRes = await fetchJSON(`${AUTH_BASE_INTERNAL}/login/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    if (cpRes.status !== 200) {
      const errMsg =
        (cpRes.body && (cpRes.body.message || cpRes.body.error)) ||
        "Failed to send verification code";
      console.error("[auth] Email send error:", cpRes.status, cpRes.body);
      res.writeHead(cpRes.status >= 400 ? cpRes.status : 500, {
        "Content-Type": "application/json",
      });
      res.end(JSON.stringify({ error: errMsg }));
      return;
    }
  } catch (err) {
    console.error("[auth] Email send failed:", err.message);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unable to contact authentication server" }));
    return;
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
}

// POST /auth/email/verify - Verify the code and create session
async function handleEmailVerify(req, res) {
  let body;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid request body" }));
    return;
  }

  const code = (body.code || "").trim();
  const email = (body.email || "").trim().toLowerCase();

  if (!code) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Verification code is required" }));
    return;
  }

  if (!email || !email.includes("@")) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Valid email address is required" }));
    return;
  }

  // Call controlplane's email finalize endpoint server-side
  // This endpoint sets a session cookie and redirects - we capture the Set-Cookie
  try {
    const finalizeUrl = `${AUTH_BASE_INTERNAL}/login/email/finalize?code=${encodeURIComponent(code)}&email=${encodeURIComponent(email)}`;
    const cpRes = await fetchRaw(finalizeUrl, {
      method: "GET",
      headers: { Accept: "text/html" },
    });

    // The finalize endpoint may redirect (302) with a session cookie
    // Or return an error
    const setCookieHeader = cpRes.headers["set-cookie"];

    if (!setCookieHeader && cpRes.status >= 400) {
      console.error("[auth] Email verify error:", cpRes.status, cpRes.rawBody);
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid or expired verification code" }));
      return;
    }

    // Extract session cookie from the controlplane response
    let cpSessionCookie = "";
    if (setCookieHeader) {
      const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
      for (const c of cookies) {
        // Capture the session cookie name=value pair
        const match = c.match(/^([^=]+=[^;]+)/);
        if (match) {
          cpSessionCookie += (cpSessionCookie ? "; " : "") + match[1];
        }
      }
    }

    if (!cpSessionCookie) {
      // Try to parse as JSON error
      console.error("[auth] No session cookie from finalize:", cpRes.status, cpRes.rawBody);
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid or expired verification code" }));
      return;
    }

    // Use the controlplane session to fetch the user's profile
    const profileRes = await fetchJSON(`${AUTH_BASE_INTERNAL}/profile`, {
      headers: { Cookie: cpSessionCookie },
    });

    if (profileRes.status !== 200 || !profileRes.body) {
      console.error("[auth] Profile fetch failed:", profileRes.status, profileRes.body);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to retrieve user profile" }));
      return;
    }

    const user = profileRes.body.email || email;

    // Check workspace membership before creating session
    const wsCheck = await checkWorkspaceMembership(null, cpSessionCookie);
    if (!wsCheck.ok) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: wsCheck.error }));
      return;
    }

    // Create a local session for this user
    createSession(res, req, user, null);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, user }));
  } catch (err) {
    console.error("[auth] Email verify failed:", err.message);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unable to verify code" }));
  }
}

// =====================
// Logout
// =====================
function handleLogout(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies[COOKIE_NAME];
  const sessionId = verifyCookie(raw);
  if (sessionId) sessions.delete(sessionId);
  clearCookie(res, req);
  res.writeHead(302, { Location: "/login" });
  res.end();
}

// =====================
// Reverse Proxy
// =====================
function proxyRequest(req, res, user) {
  const url = new URL(req.url, UPSTREAM);
  const proxyHeaders = { ...req.headers };

  proxyHeaders["x-forwarded-user"] = user;
  proxyHeaders["x-forwarded-for"] =
    req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  proxyHeaders["x-forwarded-proto"] =
    req.headers["x-forwarded-proto"] ||
    (req.socket.encrypted ? "https" : "http");
  proxyHeaders["user-agent"] = USER_AGENT;

  // Keep the original Host header so OpenClaw's origin check
  // (dangerouslyAllowHostHeaderOriginFallback) matches the browser's Origin
  const proxyReq = http.request(
    {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: req.method,
      headers: proxyHeaders,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    }
  );

  proxyReq.on("error", (err) => {
    console.error("[proxy] upstream error:", err.message);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Bad Gateway");
    }
  });

  req.pipe(proxyReq, { end: true });
}

// =====================
// WebSocket Upgrade
// =====================
function handleUpgrade(req, socket, head) {
  let user;

  if (AUTH_MODE === "oauth2") {
    const session = getSession(req);
    if (!session) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    user = session.user;
  } else {
    user = checkBasicAuth(req);
    if (!user) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
  }

  const url = new URL(req.url, UPSTREAM);
  const proxyHeaders = { ...req.headers };
  proxyHeaders["x-forwarded-user"] = user;
  proxyHeaders["user-agent"] = USER_AGENT;

  const proxyReq = http.request({
    hostname: url.hostname,
    port: url.port,
    path: url.pathname + url.search,
    method: "GET",
    headers: proxyHeaders,
  });

  proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\n` +
        Object.entries(proxyRes.headers)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\r\n") +
        "\r\n\r\n"
    );
    if (proxyHead.length) socket.write(proxyHead);
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });

  proxyReq.on("error", (err) => {
    console.error("[ws-proxy] upstream error:", err.message);
    socket.destroy();
  });

  proxyReq.end();
}

// =====================
// Authentication middleware
// =====================
function authenticate(req, res) {
  if (AUTH_MODE === "oauth2") {
    const session = getSession(req);
    if (session) return session.user;
    // For non-HTML requests, return 401 instead of redirect
    const accept = req.headers.accept || "";
    if (!accept.includes("text/html") || req.headers.upgrade === "websocket") {
      res.writeHead(401, { "Content-Type": "text/plain" });
      res.end("Unauthorized");
      return null;
    }
    // Redirect to our login page
    res.writeHead(302, { Location: "/login" });
    res.end();
    return null;
  }

  // Basic auth mode
  const user = checkBasicAuth(req);
  if (user) return user;
  sendBasicAuthChallenge(res);
  return null;
}

// =====================
// Server
// =====================
const server = http.createServer(async (req, res) => {
  let pathname;
  try {
    pathname = new URL(req.url, "http://localhost").pathname;
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Bad Request");
    return;
  }

  // Health check (always unauthenticated)
  if (pathname === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  // Favicon
  if (pathname === "/favicon.svg") {
    res.writeHead(200, {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400",
    });
    res.end(OPENCLAW_FAVICON_SVG);
    return;
  }
  if (pathname === "/favicon.ico") {
    res.writeHead(302, { Location: "/favicon.svg" });
    res.end();
    return;
  }

  // Static assets (only serve our own logo files, let the rest go to upstream)
  if (pathname === "/assets/blaxel-logo.png" || pathname === "/assets/openclaw-logo.png") {
    const safeName = path.basename(pathname);
    const filePath = path.join("/assets", safeName);
    try {
      const stat = fs.statSync(filePath);
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": stat.size,
        "Cache-Control": "public, max-age=86400",
      });
      fs.createReadStream(filePath).pipe(res);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    }
    return;
  }

  // OAuth2 / auth routes (only in oauth2 mode)
  if (AUTH_MODE === "oauth2") {
    // Login page
    if (pathname === "/login" && req.method === "GET") {
      // If already authenticated, redirect to home
      const session = getSession(req);
      if (session) {
        res.writeHead(302, { Location: "/" });
        res.end();
        return;
      }
      const errorParam = new URL(req.url, "http://localhost").searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(getLoginPageHTML(errorParam));
      return;
    }

    // Email auth routes
    if (pathname === "/auth/email" && req.method === "POST") return handleEmailSend(req, res);
    if (pathname === "/auth/email/verify" && req.method === "POST") return handleEmailVerify(req, res);

    // Logout
    if (pathname === "/logout" || pathname === "/oauth/logout") return handleLogout(req, res);
  }

  // Authenticate
  const user = authenticate(req, res);
  if (!user) return; // response already sent

  proxyRequest(req, res, user);
});

server.on("upgrade", handleUpgrade);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[auth-proxy] Listening on port ${PORT}`);
  console.log(`[auth-proxy] Auth mode: ${AUTH_MODE}`);
  if (AUTH_MODE === "oauth2") {
    console.log(
      `[auth-proxy] OAuth2 provider: ${AUTH_BASE}` +
        (AUTH_BASE_INTERNAL !== AUTH_BASE
          ? ` (internal: ${AUTH_BASE_INTERNAL})`
          : "")
    );
    if (BL_WORKSPACE) {
      console.log(`[auth-proxy] Workspace restriction: ${BL_WORKSPACE}`);
    }
  } else {
    console.log(`[auth-proxy] Basic auth user: ${PROXY_USER}`);
  }
  console.log(`[auth-proxy] Upstream: ${UPSTREAM}`);
});
