# Test Skill

End-to-end test for the OpenClaw template using Playwright. Tests the full flow from setup wizard (including Blaxel config) to chat with Blaxel sandbox.

## Prerequisites

- The Playwright MCP server must be available
- A `.env` file at the project root with LLM API keys only (NO `PROXY_USER`, `PROXY_PASSWORD`, `OPENCLAW_MODEL`, `BL_API_KEY`, or `BL_WORKSPACE` - all configured via the setup wizard)

## Steps

### 1. Prepare `.env`

Read the `.env` file. It should contain only LLM API keys (e.g. `ANTHROPIC_API_KEY`).

If it contains `PROXY_USER`, `PROXY_PASSWORD`, `OPENCLAW_MODEL`, `BL_API_KEY`, or `BL_WORKSPACE`, note their values (you need `ANTHROPIC_API_KEY`, `BL_API_KEY`, and `BL_WORKSPACE` for the wizard), then remove those lines so the setup wizard is triggered for everything.

The `.env` passed to docker should only have the provider API keys (ANTHROPIC_API_KEY, etc.) - nothing else.

### 2. Build and start the container

```bash
docker stop openclaw-test 2>/dev/null; docker rm -v openclaw-test 2>/dev/null
docker build -t openclaw-test .
docker run -d --name openclaw-test -p 8888:80 --env-file .env openclaw-test
```

Wait ~5 seconds for the setup server to start:
```bash
sleep 5 && docker logs openclaw-test 2>&1 | tail -5
```

You should see "Setup server listening on port 80" - this means the wizard is ready.

### 3. Complete the setup wizard with Playwright

Navigate to `http://localhost:8888` (no auth needed for the wizard).

#### Step 0: Choose Provider
- Take a snapshot to see the wizard
- Click the "Anthropic" provider button
- Click "Continue"

#### Step 1: API Key
- The API key field should show. Use the ANTHROPIC_API_KEY value you read from `.env`
- Fill in the API key
- Click "Continue"

#### Step 2: Select Model
- The model dropdown should show Anthropic models
- Select `anthropic/claude-sonnet-4-6` (or leave default)
- Click "Continue"

#### Step 3: Blaxel Sandbox
- This step appears because BL_API_KEY and BL_WORKSPACE are not set
- Fill workspace with the BL_WORKSPACE value you noted earlier
- Fill API key with the BL_API_KEY value you noted earlier
- Click "Continue"

#### Step 4: Access Credentials
- Fill username: `admin`
- Fill password: `testpass123`
- Fill confirm password: `testpass123`
- Click "Complete Setup"

#### After setup
- The wizard shows "Setup Complete" and redirects after 2 seconds
- Wait ~15 seconds for OpenClaw gateway to start behind the scenes
- Check `docker logs openclaw-test` to confirm gateway is listening

### 4. Open the app with auth

After the gateway is running, navigate with basic auth credentials:

```js
async (page) => {
  const context = page.context();
  await context.setHTTPCredentials({ username: 'admin', password: 'testpass123' });
  await page.goto('http://localhost:8888');
  await page.waitForTimeout(4000);
  return await page.title();
}
```

**Important**: Do NOT put credentials in the URL (causes SecurityError in the SPA). Always use `context.setHTTPCredentials()`.

### 5. Verify the UI loaded

Take a snapshot and check:
- Page title is "OpenClaw Control"
- Health shows "OK"
- Version shows a version number
- Chat textbox is enabled (not disabled)

If Health shows "Offline" or "Disconnected", wait a few more seconds and retry.

### 6. Test chat with Blaxel sandbox

Send this message in the chat:
> Create a sandbox named "test-fib" using the blaxel/py-app image and run this python script: a = [0,1]; [a.append(a[-2]+a[-1]) for _ in range(8)]; print(a). If there is any error, show it.

To send: use `browser_fill_form` on the chat textbox, then `browser_click` on the Send button.

Wait for the response to complete by polling until the "Stop" button disappears:
```js
async (page) => {
  for (let i = 0; i < 90; i++) {
    const hasStop = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button')];
      return buttons.some(b => b.textContent.includes('Stop'));
    });
    if (!hasStop) return 'done';
    await page.waitForTimeout(2000);
  }
  return 'timeout';
}
```

### 7. Verify the response

Take a snapshot and check ALL of the following:
- The assistant responded (there is an assistant message in the chat log)
- A "Sandbox Create" tool call is visible (proves the Blaxel sandbox plugin was used)
- A "Sandbox Exec" or "Sandbox Run Code" tool call is visible (proves code was executed in the sandbox)
- The output contains the Fibonacci sequence: `[0, 1, 1, 2, 3, 5, 8, 13, 21, 34]`
- No authentication errors in the tool results

### 8. Report results

Summarize test results as:
- **Setup Wizard**: PASS/FAIL (wizard loaded, all steps completed including Blaxel, setup saved)
- **UI**: PASS/FAIL (loaded after setup, Health OK)
- **Chat**: PASS/FAIL (message sent, response received)
- **Blaxel Sandbox**: PASS/FAIL (sandbox created, code executed)
- **Output**: PASS/FAIL (correct Fibonacci sequence)

If any step fails, check `docker logs openclaw-test` for container errors and report them.

### 9. Cleanup

```bash
docker stop openclaw-test 2>/dev/null; docker rm -v openclaw-test 2>/dev/null
```
