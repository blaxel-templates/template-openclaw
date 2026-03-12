const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 80;
const AUTH_FILE = process.env.AUTH_FILE || "/root/.openclaw/proxy-auth.json";
const BL_CLOUD = process.env.BL_CLOUD === "true";
const NEED_BLAXEL = !BL_CLOUD && (!process.env.BL_API_KEY || !process.env.BL_WORKSPACE);
const NEED_CREDENTIALS = !BL_CLOUD; // Basic auth credentials needed when not on Blaxel

const PROVIDERS = {
  anthropic: {
    name: "Anthropic",
    envVar: "ANTHROPIC_API_KEY",
    models: [
      "anthropic/claude-opus-4-6",
      "anthropic/claude-sonnet-4-6",
      "anthropic/claude-haiku-4-5",
    ],
  },
  openai: {
    name: "OpenAI",
    envVar: "OPENAI_API_KEY",
    models: [
      "openai/gpt-4.1",
      "openai/gpt-4.1-mini",
      "openai/o3",
      "openai/o4-mini",
    ],
  },
  gemini: {
    name: "Google Gemini",
    envVar: "GEMINI_API_KEY",
    models: [
      "gemini/gemini-2.5-pro",
      "gemini/gemini-2.5-flash",
    ],
  },
};

const SETUP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenClaw - Setup</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: #09090b;
      color: #e4e4e7;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    body::before {
      content: '';
      position: fixed;
      top: -40%;
      left: -20%;
      width: 80%;
      height: 80%;
      background: radial-gradient(ellipse, rgba(253,123,53,0.06) 0%, transparent 70%);
      pointer-events: none;
    }
    body::after {
      content: '';
      position: fixed;
      bottom: -30%;
      right: -20%;
      width: 70%;
      height: 70%;
      background: radial-gradient(ellipse, rgba(239,68,68,0.04) 0%, transparent 70%);
      pointer-events: none;
    }

    .container {
      width: 100%;
      max-width: 520px;
      padding: 2rem;
      position: relative;
      z-index: 1;
    }

    /* Header */
    .header {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 1.25rem;
      margin-bottom: 2.5rem;
    }
    .header-brand {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .header-brand img, .header-brand svg {
      width: 70px;
      height: 70px;
      border-radius: 14px;
    }
    .header-brand svg {
      --coral-bright: #ff6b5a;
      --logo-gradient-start: #ff4040;
      --logo-gradient-end: #cc2020;
    }
    .header-brand span {
      font-size: 0.95rem;
      font-weight: 600;
      color: #a1a1aa;
      letter-spacing: -0.01em;
    }
    .header-sep {
      width: 1px;
      height: 24px;
      background: #27272a;
    }

    /* Card */
    .card {
      background: #111113;
      border: 1px solid #1e1e22;
      border-radius: 16px;
      padding: 2rem;
      position: relative;
      box-shadow: 0 0 0 1px rgba(255,255,255,0.02), 0 24px 48px rgba(0,0,0,0.4);
    }

    /* Progress */
    .progress {
      display: flex;
      gap: 6px;
      margin-bottom: 2rem;
    }
    .progress-bar {
      flex: 1;
      height: 2px;
      border-radius: 1px;
      background: #27272a;
      overflow: hidden;
      position: relative;
    }
    .progress-bar::after {
      content: '';
      position: absolute;
      left: 0; top: 0;
      width: 100%; height: 100%;
      background: #FD7B35;
      transform: scaleX(0);
      transform-origin: left;
      transition: transform 0.4s cubic-bezier(0.4,0,0.2,1);
    }
    .progress-bar.active::after,
    .progress-bar.done::after {
      transform: scaleX(1);
    }
    .progress-bar.done::after {
      background: #FD7B35;
    }
    .progress-bar.active::after {
      background: linear-gradient(90deg, #FD7B35, #fb923c);
    }

    /* Error */
    .error {
      background: rgba(239,68,68,0.08);
      border: 1px solid rgba(239,68,68,0.2);
      color: #fca5a5;
      padding: 0.625rem 0.875rem;
      border-radius: 10px;
      font-size: 0.8125rem;
      margin-bottom: 1.25rem;
      display: none;
      line-height: 1.5;
    }

    /* Steps */
    .step { display: none; animation: fadeIn 0.3s ease; }
    .step.active { display: block; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    .step h2 {
      font-size: 1.125rem;
      font-weight: 600;
      color: #fafafa;
      margin-bottom: 0.375rem;
      letter-spacing: -0.02em;
    }
    .step .subtitle {
      color: #71717a;
      font-size: 0.8125rem;
      margin-bottom: 1.5rem;
      line-height: 1.5;
    }
    .step .subtitle a { color: #a1a1aa; text-decoration: underline; text-underline-offset: 2px; }
    .step .subtitle a:hover { color: #d4d4d8; }

    /* Fields */
    .field { margin-bottom: 1.25rem; }
    .field label {
      display: block;
      font-size: 0.75rem;
      font-weight: 500;
      color: #71717a;
      margin-bottom: 0.5rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .field input, .field select {
      width: 100%;
      padding: 0.6875rem 0.875rem;
      background: #09090b;
      border: 1px solid #27272a;
      border-radius: 10px;
      color: #fafafa;
      font-family: inherit;
      font-size: 0.875rem;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
      -webkit-appearance: none;
    }
    .field input:focus, .field select:focus {
      border-color: #FD7B35;
      box-shadow: 0 0 0 3px rgba(253,123,53,0.1);
    }
    .field input::placeholder { color: #3f3f46; }
    .field select { cursor: pointer; }
    .field select option { background: #18181b; color: #fafafa; }

    /* Provider grid */
    .provider-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 0.75rem;
      margin-bottom: 0.5rem;
    }
    .provider-btn {
      padding: 1.25rem 0.75rem 1rem;
      background: #09090b;
      border: 1.5px solid #27272a;
      border-radius: 12px;
      color: #a1a1aa;
      font-family: inherit;
      font-size: 0.75rem;
      font-weight: 500;
      cursor: pointer;
      text-align: center;
      transition: all 0.2s cubic-bezier(0.4,0,0.2,1);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.625rem;
      letter-spacing: -0.01em;
    }
    .provider-btn:hover {
      border-color: #3f3f46;
      color: #e4e4e7;
      background: #0f0f12;
      transform: translateY(-1px);
    }
    .provider-btn.selected {
      border-color: #FD7B35;
      color: #fafafa;
      background: rgba(253,123,53,0.05);
      box-shadow: 0 0 0 3px rgba(253,123,53,0.08);
    }
    .provider-btn .provider-icon {
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .provider-btn svg { width: 28px; height: 28px; }

    /* Buttons */
    .btn-row { display: flex; gap: 0.625rem; margin-top: 0.25rem; }
    button {
      flex: 1;
      padding: 0.6875rem;
      background: #FD7B35;
      color: #fff;
      border: none;
      border-radius: 10px;
      font-family: inherit;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      letter-spacing: -0.01em;
    }
    button:hover { background: #e8692d; }
    button:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-secondary {
      background: transparent;
      color: #71717a;
      border: 1px solid #27272a;
    }
    .btn-secondary:hover { background: #18181b; color: #a1a1aa; border-color: #3f3f46; }

    /* Success */
    .success {
      text-align: center;
      display: none;
      padding: 2rem 0;
    }
    .success-icon {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: rgba(253,123,53,0.1);
      border: 1.5px solid rgba(253,123,53,0.3);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 1rem;
    }
    .success-icon svg { width: 24px; height: 24px; color: #FD7B35; }
    .success h2 { color: #fafafa; font-size: 1.125rem; font-weight: 600; margin-bottom: 0.375rem; letter-spacing: -0.02em; }
    .success p { color: #71717a; font-size: 0.8125rem; }

    /* Info footer */
    .info {
      margin-top: 1.5rem;
      padding-top: 1.25rem;
      border-top: 1px solid #1e1e22;
    }
    .info p { font-size: 0.75rem; color: #52525b; line-height: 1.6; }
    .info a { color: #71717a; text-decoration: underline; text-underline-offset: 2px; }
    .info a:hover { color: #a1a1aa; }
    .info code {
      background: #18181b;
      padding: 0.125rem 0.375rem;
      border-radius: 4px;
      font-size: 0.6875rem;
      font-family: 'SF Mono', 'Fira Code', monospace;
      color: #71717a;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-brand">
        <img src="/assets/blaxel-logo.png" alt="Blaxel" />
        <span>Blaxel</span>
      </div>
      <div class="header-sep"></div>
      <div class="header-brand">
        <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M60 10 C30 10 15 35 15 55 C15 75 30 95 45 100 L45 110 L55 110 L55 100 C55 100 60 102 65 100 L65 110 L75 110 L75 100 C90 95 105 75 105 55 C105 35 90 10 60 10Z" fill="url(#lg)"/><path d="M20 45 C5 40 0 50 5 60 C10 70 20 65 25 55 C28 48 25 45 20 45Z" fill="url(#lg)"/><path d="M100 45 C115 40 120 50 115 60 C110 70 100 65 95 55 C92 48 95 45 100 45Z" fill="url(#lg)"/><path d="M45 15 Q35 5 30 8" stroke="var(--coral-bright)" stroke-width="2" stroke-linecap="round"/><path d="M75 15 Q85 5 90 8" stroke="var(--coral-bright)" stroke-width="2" stroke-linecap="round"/><circle cx="45" cy="35" r="6" fill="#050810"/><circle cx="75" cy="35" r="6" fill="#050810"/><circle cx="46" cy="34" r="2" fill="#00e5cc"/><circle cx="76" cy="34" r="2" fill="#00e5cc"/><defs><linearGradient id="lg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="var(--logo-gradient-start)"/><stop offset="100%" stop-color="var(--logo-gradient-end)"/></linearGradient></defs></svg>
        <span>OpenClaw</span>
      </div>
    </div>
    <div class="card">
      <div class="progress" id="step-dots"></div>

      <div class="error" id="error"></div>

      <!-- Step 1: Provider -->
      <div class="step active" id="step-0">
        <h2>Choose a Provider</h2>
        <p class="subtitle">Select the LLM provider you want to use</p>
        <div class="provider-grid">
          <div class="provider-btn" data-provider="anthropic">
            <div class="provider-icon"><svg viewBox="0 0 256 176" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M147.487 0l69.21 175.636h39.303L186.79 0h-39.303zm-78.274 0L0 175.636h39.304l14.278-36.252h73.478l14.278 36.252h39.304L111.43 0H69.213zm5.252 104.78l23.41-59.432 23.41 59.431H74.465z" fill="currentColor"/></svg></div>
            Anthropic
          </div>
          <div class="provider-btn" data-provider="openai">
            <div class="provider-icon"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.98 4.186a5.998 5.998 0 0 0-3.998 2.9 6.047 6.047 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.345-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" fill="currentColor"/></svg></div>
            OpenAI
          </div>
          <div class="provider-btn" data-provider="gemini">
            <div class="provider-icon"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 24C12 20.8 11.1 18.15 9.3 16.05C7.65 14.1 5.4 12.75 2.55 12C5.4 11.25 7.65 9.9 9.3 7.95C11.1 5.85 12 3.2 12 0C12 3.2 12.9 5.85 14.7 7.95C16.35 9.9 18.6 11.25 21.45 12C18.6 12.75 16.35 14.1 14.7 16.05C12.9 18.15 12 20.8 12 24Z" fill="currentColor"/></svg></div>
            Gemini
          </div>
        </div>
      </div>

      <!-- Step 2: API Key -->
      <div class="step" id="step-1">
        <h2>API Key</h2>
        <p class="subtitle">Enter your <span id="provider-name"></span> API key</p>
        <div class="field">
          <label for="apikey" id="apikey-label">API Key</label>
          <input type="password" id="apikey" placeholder="sk-..." />
        </div>
        <div class="btn-row">
          <button class="btn-secondary">Back</button>
          <button id="btn-step1">Continue</button>
        </div>
      </div>

      <!-- Step 3: Model -->
      <div class="step" id="step-2">
        <h2>Select Model</h2>
        <p class="subtitle">Choose or enter a model identifier</p>
        <div class="field">
          <label for="model-select">Model</label>
          <select id="model-select"></select>
        </div>
        <div class="field" id="custom-model-field" style="display:none;">
          <label for="custom-model">Custom Model</label>
          <input type="text" id="custom-model" placeholder="provider/model-name" />
        </div>
        <div class="btn-row">
          <button class="btn-secondary">Back</button>
          <button id="btn-step2">Continue</button>
        </div>
      </div>

      <!-- Step 4: Blaxel (conditional) -->
      <div class="step" id="step-blaxel">
        <h2>Blaxel Sandbox</h2>
        <p class="subtitle">Connect to <a href="https://blaxel.ai" target="_blank">Blaxel</a> for cloud code execution</p>
        <div class="field">
          <label for="bl-workspace">Workspace</label>
          <input type="text" id="bl-workspace" placeholder="my-workspace" />
        </div>
        <div class="field">
          <label for="bl-apikey">API Key</label>
          <input type="password" id="bl-apikey" placeholder="bl_..." />
        </div>
        <div class="btn-row">
          <button class="btn-secondary" id="btn-blaxel-back">Back</button>
          <button id="btn-blaxel-next">Continue</button>
        </div>
      </div>

      <!-- Step 5: Credentials (only when not on Blaxel) -->
      <div class="step" id="step-creds">
        <h2>Access Credentials</h2>
        <p class="subtitle">Set a username and password to protect your instance</p>
        <div class="field">
          <label for="username">Username</label>
          <input type="text" id="username" autocomplete="username" />
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input type="password" id="password" autocomplete="new-password" />
        </div>
        <div class="field">
          <label for="confirm">Confirm Password</label>
          <input type="password" id="confirm" autocomplete="new-password" />
        </div>
        <div class="btn-row">
          <button class="btn-secondary">Back</button>
          <button id="btn-finish">Complete Setup</button>
        </div>
        <div class="info">
          <p>
            Settings can be overridden with env vars:
            <code>PROXY_USER</code>, <code>PROXY_PASSWORD</code>,
            <code>OPENCLAW_MODEL</code>, <code>ANTHROPIC_API_KEY</code>,
            <code>OPENAI_API_KEY</code>, <code>GEMINI_API_KEY</code>.
            <br><br>
            <a href="https://docs.blaxel.ai/Tutorials/OpenClaw" target="_blank">View documentation</a>
          </p>
        </div>
      </div>

      <!-- Success -->
      <div class="success" id="success-view">
        <div class="success-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <h2>Setup Complete</h2>
        <p>Redirecting to your OpenClaw instance...</p>
      </div>
    </div>
  </div>
  <script>
    const providers = ${JSON.stringify(PROVIDERS)};
    const needBlaxel = ${NEED_BLAXEL};
    const needCredentials = ${NEED_CREDENTIALS};
    let selectedProvider = null;

    // Build step sequence dynamically
    const stepIds = ['step-0', 'step-1', 'step-2'];
    if (needBlaxel) stepIds.push('step-blaxel');
    if (needCredentials) stepIds.push('step-creds');

    // Remove unused steps from DOM
    if (!needBlaxel) document.getElementById('step-blaxel').remove();
    if (!needCredentials) document.getElementById('step-creds').remove();

    // Build progress bars
    const dotsContainer = document.getElementById('step-dots');
    stepIds.forEach((_, i) => {
      const bar = document.createElement('div');
      bar.className = 'progress-bar' + (i === 0 ? ' active' : '');
      dotsContainer.appendChild(bar);
    });
    const bars = dotsContainer.querySelectorAll('.progress-bar');

    const errorEl = document.getElementById('error');
    let currentStepIndex = 0;

    function showError(msg) {
      errorEl.textContent = msg;
      errorEl.style.display = msg ? 'block' : 'none';
    }

    function goToIndex(idx) {
      showError('');
      currentStepIndex = idx;
      document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
      document.getElementById(stepIds[idx]).classList.add('active');
      bars.forEach((b, i) => {
        b.classList.remove('active', 'done');
        if (i < idx) b.classList.add('done');
        if (i === idx) b.classList.add('active');
      });
    }

    function nextStep() { goToIndex(currentStepIndex + 1); }
    function prevStep() { goToIndex(currentStepIndex - 1); }

    // Step 0: Provider selection
    function selectProvider(providerKey) {
      document.querySelectorAll('.provider-btn').forEach(b => b.classList.remove('selected'));
      document.querySelector('[data-provider="' + providerKey + '"]').classList.add('selected');
      selectedProvider = providerKey;

      const p = providers[selectedProvider];
      document.getElementById('provider-name').textContent = p.name;
      document.getElementById('apikey-label').textContent = p.envVar;
      document.getElementById('apikey').placeholder = selectedProvider === 'anthropic' ? 'sk-ant-...' : selectedProvider === 'openai' ? 'sk-...' : 'AI...';

      const sel = document.getElementById('model-select');
      sel.innerHTML = '';
      p.models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m; opt.textContent = m;
        sel.appendChild(opt);
      });
      const customOpt = document.createElement('option');
      customOpt.value = '__custom__'; customOpt.textContent = 'Custom model...';
      sel.appendChild(customOpt);

      nextStep();
      setTimeout(() => document.getElementById('apikey').focus(), 100);
    }

    document.querySelectorAll('.provider-btn').forEach(btn => {
      btn.addEventListener('click', () => selectProvider(btn.dataset.provider));
    });

    // Step 1: API Key
    document.getElementById('btn-step1').addEventListener('click', () => {
      const key = document.getElementById('apikey').value.trim();
      if (!key) { showError('API key is required.'); return; }
      nextStep();
    });

    // Step 2: Model
    const modelSelect = document.getElementById('model-select');
    modelSelect.addEventListener('change', () => {
      document.getElementById('custom-model-field').style.display =
        modelSelect.value === '__custom__' ? 'block' : 'none';
    });

    const isModelLastStep = !needBlaxel && !needCredentials;

    document.getElementById('btn-step2').addEventListener('click', () => {
      const model = modelSelect.value === '__custom__'
        ? document.getElementById('custom-model').value.trim()
        : modelSelect.value;
      if (!model) { showError('Please select or enter a model.'); return; }
      if (isModelLastStep) {
        submitSetup();
      } else {
        nextStep();
      }
    });

    // Update button text if model step is the final step
    if (isModelLastStep) {
      document.getElementById('btn-step2').textContent = 'Complete Setup';
    }

    // Blaxel step
    if (needBlaxel) {
      const isBlaxelLastStep = !needCredentials;
      document.getElementById('btn-blaxel-back').addEventListener('click', prevStep);
      document.getElementById('btn-blaxel-next').addEventListener('click', () => {
        const ws = document.getElementById('bl-workspace').value.trim();
        const key = document.getElementById('bl-apikey').value.trim();
        if (!ws || !key) { showError('Blaxel workspace and API key are required.'); return; }
        if (isBlaxelLastStep) {
          submitSetup();
        } else {
          nextStep();
        }
      });
      if (isBlaxelLastStep) {
        document.getElementById('btn-blaxel-next').textContent = 'Complete Setup';
      }
    }

    // Submit setup
    async function submitSetup() {
      showError('');
      const model = modelSelect.value === '__custom__'
        ? document.getElementById('custom-model').value.trim()
        : modelSelect.value;
      const apiKey = document.getElementById('apikey').value.trim();

      const payload = {
        provider: selectedProvider,
        apiKey,
        model,
      };

      if (needBlaxel) {
        payload.blWorkspace = document.getElementById('bl-workspace').value.trim();
        payload.blApiKey = document.getElementById('bl-apikey').value.trim();
      }

      if (needCredentials) {
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        const confirmPw = document.getElementById('confirm').value;
        if (!username || !password) { showError('Username and password are required.'); return; }
        if (password !== confirmPw) { showError('Passwords do not match.'); return; }
        if (password.length < 4) { showError('Password must be at least 4 characters.'); return; }
        payload.username = username;
        payload.password = password;
      }

      // Disable the active submit button
      const btn = document.getElementById('btn-finish')
        || document.getElementById('btn-blaxel-next')
        || document.getElementById('btn-step2');
      btn.disabled = true;
      btn.textContent = 'Setting up...';

      try {
        const res = await fetch('/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Setup failed');

        document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
        bars.forEach(b => { b.classList.remove('active'); b.classList.add('done'); });
        document.getElementById('success-view').style.display = 'block';
        showError('');
        setTimeout(() => { window.location.href = '/'; }, 2000);
      } catch (err) {
        showError(err.message);
        btn.disabled = false;
        btn.textContent = 'Complete Setup';
      }
    }

    if (needCredentials) {
      document.getElementById('btn-finish').addEventListener('click', submitSetup);
    }

    // Back buttons
    document.querySelectorAll('.btn-secondary:not(#btn-blaxel-back)').forEach(btn => {
      btn.addEventListener('click', prevStep);
    });

    // Enter key handler
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (e.target.tagName === 'SELECT') return;
      const currentId = stepIds[currentStepIndex];
      if (currentId === 'step-0') return;
      if (currentId === 'step-1') { e.preventDefault(); document.getElementById('btn-step1').click(); return; }
      if (currentId === 'step-2') { e.preventDefault(); document.getElementById('btn-step2').click(); return; }
      if (currentId === 'step-blaxel') { e.preventDefault(); document.getElementById('btn-blaxel-next').click(); return; }
      if (currentId === 'step-creds') { e.preventDefault(); submitSetup(); return; }
    });
  </script>
</body>
</html>`;

const ASSETS_DIR = "/assets";

const server = http.createServer((req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(SETUP_HTML);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/assets/")) {
    const filePath = path.join(ASSETS_DIR, path.basename(req.url));
    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath).toLowerCase();
      const types = { ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
      res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream", "Cache-Control": "public, max-age=3600" });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
  }

  if (req.method === "POST" && req.url === "/setup") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const { provider, apiKey, model, blWorkspace, blApiKey, username, password } = JSON.parse(body);

        if (!provider || !apiKey || !model) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Provider, API key, and model are required" }));
          return;
        }

        const providerInfo = PROVIDERS[provider];
        if (!providerInfo) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unknown provider" }));
          return;
        }

        const config = {
          provider,
          apiKeyEnvVar: providerInfo.envVar,
          apiKey,
          model,
        };

        if (username) config.username = username;
        if (password) config.password = password;

        if (blWorkspace) config.blWorkspace = blWorkspace;
        if (blApiKey) config.blApiKey = blApiKey;

        const dir = path.dirname(AUTH_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(AUTH_FILE, JSON.stringify(config, null, 2));

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));

        setTimeout(() => process.exit(0), 500);
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal error" }));
      }
    });
    return;
  }

  res.writeHead(302, { Location: "/" });
  res.end();
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Setup server listening on port ${PORT}`);
});
