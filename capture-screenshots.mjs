import puppeteer from "puppeteer-core";
import { execFile } from "child_process";
import { mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "images");
const WIDTH = 1280;
const HEIGHT = 720;
const GEO = { latitude: 35.5951, longitude: -82.5515 };

const CHROME =
  "/Users/Mark/.cache/puppeteer/chrome/mac-149.0.7827.22/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";

const APPS = [
  {
    name: "moon-phase-app",
    url: "http://127.0.0.1:8001/",
    waitMs: 2500,
    geo: false,
  },
  {
    name: "moon-phase-beta",
    url: "http://127.0.0.1:8002/",
    waitMs: 2500,
    geo: false,
  },
  {
    name: "solar-light-app",
    url: "http://127.0.0.1:8003/",
    waitMs: 4000,
    geo: true,
  },
  {
    name: "us-elevation-map",
    url: "http://127.0.0.1:8004/",
    waitMs: 6000,
    geo: true,
  },
  {
    name: "orbital-view",
    url: "http://127.0.0.1:3005/",
    waitMs: 3000,
    geo: false,
    waitForLoaded: true,
  },
  {
    name: "weight-of-air",
    url: "http://127.0.0.1:8006/",
    waitMs: 2000,
    geo: true,
    waitForPressure: true,
    viewport: { width: 1280, height: 800 },
    exportSize: { width: 720, height: 720, crop: "top-center" },
  },
];

async function waitForServer(url, timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok || res.status < 500) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Server not ready: ${url}`);
}

async function capture(browser, app) {
  const page = await browser.newPage();
  const viewport = app.viewport ?? { width: WIDTH, height: HEIGHT };
  await page.setViewport({ ...viewport, deviceScaleFactor: 2 });

  if (app.geo) {
    const context = browser.defaultBrowserContext();
    await context.overridePermissions(app.url, ["geolocation"]);
    await page.setGeolocation(GEO);
  }

  await page.goto(app.url, { waitUntil: "domcontentloaded", timeout: 60000 });

  if (app.fitCover || app.exportSize) {
    await page.addStyleTag({
      content:
        ".fit-stage { padding: 0 !important; } .app { padding: 0 !important; }",
    });
  }

  if (app.waitForLoaded) {
    await page.waitForFunction(
      () => !document.body.innerText.includes("Loading satellite catalog"),
      { timeout: 120000 },
    );
    await new Promise((r) => setTimeout(r, 4000));
  } else if (app.waitForPressure) {
    await page.waitForFunction(
      () => {
        const el = document.getElementById("pressure-inline");
        return el && el.textContent && !el.textContent.includes("—");
      },
      { timeout: 30000 },
    );
    await page.waitForFunction(
      () => document.getElementById("app")?.classList.contains("is-fitted"),
      { timeout: 10000 },
    );
    await new Promise((r) => setTimeout(r, app.waitMs));
  } else {
    await new Promise((r) => setTimeout(r, app.waitMs));
  }

  if (app.fitCover) {
    const coverBoost = app.coverBoost ?? 1;
    await page.evaluate((boost) => {
      const appEl = document.getElementById("app");
      const stage = document.getElementById("fit-stage");
      if (!appEl || !stage) return;

      const availH = stage.clientHeight;
      const availW = stage.clientWidth;
      appEl.style.width = `${availW}px`;
      appEl.style.transform = "translate(-50%, -50%) scale(1)";
      const naturalH = appEl.offsetHeight;
      const naturalW = appEl.offsetWidth;
      const scale = Math.max(availH / naturalH, availW / naturalW) * boost;
      appEl.style.transform = `translate(-50%, -50%) scale(${scale})`;
    }, coverBoost);
    await new Promise((r) => setTimeout(r, 200));
  }

  const outPath = path.join(OUT_DIR, `${app.name}.png`);
  await page.screenshot({
    path: outPath,
    type: "png",
    clip: { x: 0, y: 0, width: viewport.width, height: viewport.height },
  });

  console.log(`Saved ${outPath}`);

  if (app.exportSize) {
    const webpPath = path.join(OUT_DIR, `${app.name}.webp`);
    const { width, height, crop } = app.exportSize;
    const cropLines =
      crop === "top-center"
        ? [
            "side = min(w, h)",
            "left = (w - side) // 2",
            "im = im.crop((left, 0, left + side, side))",
          ]
        : [];
    await execFileAsync("python3", [
      "-c",
      [
        "from PIL import Image",
        `im = Image.open(${JSON.stringify(outPath)}).convert('RGB')`,
        "w, h = im.size",
        ...cropLines,
        `im = im.resize((${width}, ${height}), Image.Resampling.LANCZOS)`,
        `im.save(${JSON.stringify(webpPath)}, 'WEBP', quality=85)`,
      ].join("\n"),
    ]);
    console.log(`Saved ${webpPath}`);
  }

  await page.close();
}

async function main() {
  const only = process.argv[2];
  const apps = only ? APPS.filter((app) => app.name === only) : APPS;
  if (!apps.length) {
    throw new Error(only ? `Unknown app: ${only}` : "No apps configured");
  }

  await mkdir(OUT_DIR, { recursive: true });

  console.log("Waiting for app servers...");
  for (const app of apps) {
    await waitForServer(app.url);
    console.log(`  ready: ${app.url}`);
  }

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--use-gl=angle"],
  });

  try {
    for (const app of apps) {
      await capture(browser, app);
    }
  } finally {
    await browser.close();
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});