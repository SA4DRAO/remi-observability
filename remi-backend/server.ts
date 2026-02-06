// @ts-nocheck
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const dotenv = require('dotenv');
const fs = require('fs/promises');
const path = require('path');

dotenv.config();

const app = express();
const port = 3100;

let browser = null;
const pages = new Map();
let sessionId = Date.now().toString();

const OpenAI = require('openai');
const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY 
});

async function initBrowser() {
  if (!browser) {
    const executablePath = process.env.BROWSER_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
    const headlessEnv = process.env.BROWSER_HEADLESS;
    const headless = typeof headlessEnv === 'string' ? headlessEnv.toLowerCase() === 'true' : false; // default false for debug server

    const launchOptions: any = {
      headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-blink-features=AutomationControlled'
      ]
    };

    if (executablePath) {
      launchOptions.executablePath = executablePath;
      console.log(`Using system browser at: ${executablePath}`);
    }

    browser = await puppeteer.launch(launchOptions);
  }
  return browser;
}

async function getPage(pageId = 'default') {
  await initBrowser();
  
  if (!pages.has(pageId)) {
    const newPage = await browser.newPage();
    await newPage.setViewport({ width: 1366, height: 768 });
    await newPage.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    // Enable better selector handling
    await newPage.setDefaultTimeout(15000);
    pages.set(pageId, newPage);
  }
  
  return pages.get(pageId);
}

async function executeAction(p, action) {
  try {
    switch (action.type) {
      case 'goto':
        if (action.url) {
          await p.goto(action.url, { 
            waitUntil: 'domcontentloaded', // Faster than networkidle2
            timeout: 30000 
          });
          return `✅ Navigated to ${action.url}`;
        }
        break;

      case 'click':
        if (action.selector) {
          try {
            await p.waitForSelector(action.selector, { timeout: 8000 });
            // Use more reliable click method
            await p.evaluate((sel) => {
              const el = document.querySelector(sel);
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.click();
              }
            }, action.selector);
            return `🖱️ Clicked ${action.selector}`;
          } catch (e) {
            // Fallback: try clicking anyway
            await p.click(action.selector, { 
              force: true,
              waitUntil: 'no-wait-after'
            });
            return `🖱️ Force-clicked ${action.selector}`;
          }
        }
        break;

      case 'type':
        if (action.selector && action.text !== undefined) {
          try {
            await p.waitForSelector(action.selector, { timeout: 8000, visible: true });
            await p.click(action.selector);
            // Clear field first
            await p.evaluate((sel) => {
              const el = document.querySelector(sel);
              if (el) el.value = '';
            }, action.selector);
            await p.type(action.selector, action.text);
            return `⌨️ Typed "${action.text.substring(0, 30)}${action.text.length > 30 ? '...' : ''}"`;
          } catch (e) {
            // Fallback: try to set value directly via evaluate if selector exists
            try {
              const exists = await p.evaluate((sel) => !!document.querySelector(sel), action.selector);
              if (exists) {
                await p.evaluate((sel, text) => {
                  const el = document.querySelector(sel);
                  if (el) {
                    el.focus();
                    el.value = '';
                    el.value = text;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                  }
                }, action.selector, action.text);
                return `⌨️ Set value for ${action.selector} (fallback)`;
              } else {
                // Save screenshot for debugging
                const debugPath = `./screenshots/error-type-${Date.now()}.png`;
                await fs.mkdir('./screenshots', { recursive: true });
                await p.screenshot({ path: debugPath, fullPage: true });
                return `❌ Type failed: selector not found. Screenshot: ${path.basename(debugPath)}`;
              }
            } catch (e2) {
              return `❌ Type failed: ${e2.message}`;
            }
          }
        }
        break;

      case 'keys':
        if (action.text) {
          await p.keyboard.type(action.text);
          return `⌨️ Keys: ${action.text}`;
        }
        break;

      case 'scroll':
        const scrollAmount = action.direction === 'down' ? 500 : -500;
        await p.evaluate((amount) => {
          window.scrollBy(0, amount);
        }, scrollAmount);
        return `📜 Scrolled ${action.direction || 'down'}`;

      case 'wait':
        // FIXED: Use p.waitForTimeout (Puppeteer v19+)
        await p.waitForTimeout(action.timeout || 1000);
        return `⏳ Waited ${action.timeout || 1000}ms`;

      case 'pressEnter':
        await p.keyboard.press('Enter');
        return '⏎ Pressed Enter';

      case 'pressEscape':
        await p.keyboard.press('Escape');
        return '⎋ Pressed Escape';

      case 'screenshot':
        const screenshotPath = `./screenshots/screenshot-${Date.now()}.png`;
        await fs.mkdir('./screenshots', { recursive: true });
        await p.screenshot({ path: screenshotPath, fullPage: true });
        return `📸 Screenshot: ${path.basename(screenshotPath)}`;

      default:
        return '❓ Unknown action';
    }
  } catch (e) {
    return `❌ Error: ${e.message}`;
  }
}

async function getBrowserActions(message) {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: "json_object" }, // FORCES VALID JSON!
      messages: [{
        role: 'system',
        content: `Convert to browser actions. Respond as JSON object with "actions" array only.

Example: {"actions": [{"type":"goto","url":"https://google.com"}]}

Available actions:
- goto: {type:"goto", url:"https://example.com"}
- type: {type:"type", selector:"input[name=\\"q\\"]", text:"query"} 
- wait: {type:"wait", timeout:1500}
- pressEnter: {type:"pressEnter"}
- click: {type:"click", selector:"#button"}
- scroll: {type:"scroll", direction:"down"}

User instruction: "${message}"`
      }],
      temperature: 0
    });

    const content = completion.choices[0]?.message?.content;
    console.log('🤖 OpenAI JSON response:', content);
    
    if (content) {
      const parsed = JSON.parse(content);
      return parsed.actions || [];
    }
  } catch (e) {
    console.error('OpenAI error:', e);
    // Safe fallback
    return [{type: 'wait', timeout: 1000}];
  }
  return [];
}

// Middleware
app.use(cors({ 
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
  credentials: true 
}));
app.use(express.json({ limit: '10mb' }));
app.use('/screenshots', express.static('screenshots'));

// ROUTES (unchanged)
app.post('/agent', async (req, res) => {
  const pageId = req.body.pageId || req.query.pageId || 'default';
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ success: false, error: 'Message required' });
  }

  try {
    const p = await getPage(pageId);
    const actions = await getBrowserActions(message);
    const actionsLog = [];

    console.log(`🤖 [${pageId}] Processing: "${message}" (${actions.length} actions)`);

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const result = await executeAction(p, action);
      actionsLog.push(`${i + 1}. ${result}`);
      console.log(`   ${result}`);
      
      if (i < actions.length - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    const currentUrl = await p.url();
    res.json({ 
      success: true,
      reply: `Executed ${actions.length} actions on page "${pageId}"`,
      sessionId,
      pageId,
      actionsLog,
      actionCount: actions.length,
      currentUrl
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/pages', async (req, res) => {
  res.json({ 
    pages: Array.from(pages.keys()), 
    sessionId,
    totalPages: pages.size 
  });
});

app.get('/status/:pageId', async (req, res) => {
  const pageId = req.params.pageId;
  const page = pages.get(pageId);
  
  if (!page) {
    return res.json({ exists: false, error: 'Page not found' });
  }

  try {
    const [url, title] = await Promise.all([page.url(), page.title()]);
    res.json({ exists: true, pageId, url, title });
  } catch (e) {
    res.json({ exists: false, error: e.message });
  }
});

app.delete('/pages/:pageId', async (req, res) => {
  const pageId = req.params.pageId;
  const page = pages.get(pageId);
  
  if (page) {
    await page.close();
    pages.delete(pageId);
    return res.json({ success: true, message: `Closed page ${pageId}` });
  }
  
  res.status(404).json({ success: false, error: 'Page not found' });
});

app.post('/screenshot/:pageId', async (req, res) => {
  const pageId = req.params.pageId;
  const p = await getPage(pageId);
  
  const timestamp = Date.now();
  const filename = `screenshot-${pageId}-${timestamp}.png`;
  const filepath = `./screenshots/${filename}`;
  
  await fs.mkdir('./screenshots', { recursive: true });
  await p.screenshot({ path: filepath, fullPage: true });
  
  res.json({ 
    success: true, 
    filename, 
    url: `http://localhost:${port}/screenshots/${filename}`
  });
});

// Return page HTML and candidate input selectors for diagnosis
app.get('/html/:pageId', async (req, res) => {
  const pageId = req.params.pageId;
  const page = pages.get(pageId);

  if (!page) {
    return res.status(404).json({ success: false, error: 'Page not found' });
  }

  try {
    const html = await page.content();

    const candidates = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]'));
      return elements.map((el) => {
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : null;
        const name = el.getAttribute && el.getAttribute('name') ? `input[name="${el.getAttribute('name')}"]` : null;
        const classes = el.classList && el.classList.length ? `${tag}.${Array.from(el.classList).join('.').trim()}` : null;
        const placeholder = el.getAttribute && el.getAttribute('placeholder') ? el.getAttribute('placeholder') : null;
        return { selectorHints: [name, id, classes].filter(Boolean), tag, placeholder };
      });
    });

    res.json({ success: true, pageId, htmlLength: html.length, htmlSnippet: html.slice(0, 2000), candidates });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    sessionId, 
    pages: pages.size,
    timestamp: new Date().toISOString()
  });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  for (const [id, page] of pages) {
    console.log(`Closing page: ${id}`);
    await page.close();
  }
  if (browser) {
    await browser.close();
  }
  process.exit(0);
});

(async () => {
  await fs.mkdir('./screenshots', { recursive: true });
})();

app.listen(port, () => {
  console.log(`\n🚀 FIXED Browser Agent running at http://localhost:${port}`);
  console.log(`📱 Frontend: http://localhost:5173`);
});
