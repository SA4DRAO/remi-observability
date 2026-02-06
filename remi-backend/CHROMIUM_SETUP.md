# Chromium Setup Guide

If you're getting errors like "Chromium not found" or "Browser launch failed", follow this guide to fix it.

## Problem: "Chromium not found"

When you start the backend, you might see:
```
Error: Failed to launch browser: Error: Could not find Chromium
```

This happens when Puppeteer can't find Chromium/Chrome on your system.

## Solutions

### Solution 1: Install Chromium/Chrome (Recommended)

#### For macOS (Homebrew)
```bash
# Install Google Chrome
brew install google-chrome

# Or install Chromium
brew install chromium
```

#### For Ubuntu/Debian
```bash
sudo apt-get update
sudo apt-get install chromium-browser
# Or
sudo apt-get install google-chrome-stable
```

#### For Windows
- **Google Chrome**: Download from https://www.google.com/chrome/
- **Chromium**: Download from https://download-chromium.appspot.com/

### Solution 2: Set Custom Chromium Path

If Chromium is installed but Puppeteer can't find it, set the path manually:

#### Find Chromium Path

**macOS:**
```bash
# Google Chrome
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome

# Chromium
/Applications/Chromium.app/Contents/MacOS/Chromium
```

**Linux:**
```bash
# Find the executable
which chromium-browser
# Or
which google-chrome
# Or
which chromium
```

**Windows:**
```cmd
# Google Chrome
C:\Program Files\Google\Chrome\Application\chrome.exe
# Or
C:\Program Files (x86)\Google\Chrome\Application\chrome.exe

# Chromium
C:\Users\YourUsername\AppData\Local\Chromium\Application\chrome.exe
```

#### Set Environment Variable

Create or edit `.env` in the backend folder:

```env
BROWSER_EXECUTABLE_PATH=/path/to/chromium
```

**Examples:**

**macOS (Google Chrome):**
```env
BROWSER_EXECUTABLE_PATH=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
```

**Linux:**
```env
BROWSER_EXECUTABLE_PATH=/usr/bin/chromium-browser
```

**Windows (PowerShell):**
```env
BROWSER_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
```

### Solution 3: Run with Docker

Docker handles all dependencies, so you don't need Chromium installed:

```bash
# Build Docker image
docker build -t remi-backend .

# Run container
docker run -p 3100:3100 \
  -e OPENAI_API_KEY=your_key \
  remi-backend

# Or with docker-compose
docker-compose up --build
```

### Solution 4: Use Puppeteer's Chromium

Puppeteer can download its own Chromium:

```bash
# Make sure puppeteer is installed
npm install puppeteer

# Puppeteer will download Chromium automatically
npm start
```

## Troubleshooting

### Still not working?

1. **Verify installation:**
   ```bash
   # macOS
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --version
   
   # Linux
   chromium-browser --version
   # or
   google-chrome --version
   
   # Windows (PowerShell)
   & "C:\Program Files\Google\Chrome\Application\chrome.exe" --version
   ```

2. **Check logs:**
   ```bash
   # Set log level to debug
   LOG_LEVEL=debug npm start
   ```

3. **Try different browser:**
   - If Chrome doesn't work, try Chromium
   - If Chromium doesn't work, try Chrome

4. **Docker debugging:**
   ```bash
   # Run with interactive shell
   docker run -it remi-backend bash
   
   # Inside container, check if chrome is installed
   which chromium-browser
   or
   which google-chrome
   ```

## Quick Fix Checklist

- [ ] Is Chrome/Chromium installed?
- [ ] Is the path correct? (Try `which chromium` or `which google-chrome`)
- [ ] Is `BROWSER_EXECUTABLE_PATH` set correctly in `.env`?
- [ ] Did you restart the backend after changing `.env`?
- [ ] Does the path have spaces? (Escape them with backslashes or quotes)
- [ ] Are you using Docker? (Docker includes Chrome)

## Environment Variables Reference

```env
# Browser launch settings
BROWSER_HEADLESS=true              # Run in headless mode (no UI)
BROWSER_TIMEOUT=15000              # Timeout in milliseconds
BROWSER_SANDBOX=false              # Disable sandbox for local dev
BROWSER_EXECUTABLE_PATH=/path      # Custom chromium/chrome path
```

## Testing Browser Launch

Create a test file to verify browser setup:

**test-browser.js:**
```javascript
const puppeteer = require('puppeteer');

async function testBrowser() {
  try {
    console.log('Testing browser launch...');
    
    const options = {};
    if (process.env.BROWSER_EXECUTABLE_PATH) {
      options.executablePath = process.env.BROWSER_EXECUTABLE_PATH;
      console.log(`Using custom path: ${options.executablePath}`);
    }
    
    const browser = await puppeteer.launch(options);
    console.log('✅ Browser launched successfully!');
    
    const page = await browser.newPage();
    await page.goto('https://example.com', { waitUntil: 'networkidle2' });
    const title = await page.title();
    console.log(`✅ Page loaded successfully: ${title}`);
    
    await browser.close();
    console.log('✅ All tests passed!');
  } catch (error) {
    console.error('❌ Browser test failed:');
    console.error(error.message);
    process.exit(1);
  }
}

testBrowser();
```

Run it:
```bash
node test-browser.js
```

## Still Need Help?

1. Check the backend logs: `npm start` (look for error messages)
2. Verify Chrome/Chromium is running: `ps aux | grep chrome` (macOS/Linux)
3. Check file permissions: `ls -la /path/to/chrome`
4. Try running in Docker for a clean environment
5. Update Node.js: `node --version` (should be 20+)
6. Reinstall dependencies: `rm -rf node_modules && npm install`

---

**Common Working Configurations:**

| OS | Browser | Path |
|----|---------|------|
| macOS | Chrome | `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` |
| macOS | Chromium | `/Applications/Chromium.app/Contents/MacOS/Chromium` |
| Ubuntu | Chromium | `/usr/bin/chromium-browser` |
| Ubuntu | Chrome | `/usr/bin/google-chrome` |
| Windows | Chrome | `C:\Program Files\Google\Chrome\Application\chrome.exe` |
| Docker | Chrome | `/usr/bin/google-chrome` (pre-installed) |

