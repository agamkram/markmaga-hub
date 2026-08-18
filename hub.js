import { APPS } from "./apps.js";

const MODE_KEY = "markmaga-hub-mode";

const gridEl = document.getElementById("app-grid");
const gridPage = document.getElementById("grid-page");
const sphereViewport = document.getElementById("sphere-viewport");
const modeBtn = document.getElementById("mode-btn");
const homeLine = document.getElementById("intro-home");

let mode = "grid";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function readSavedMode() {
  try {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved === "sphere" || saved === "grid") return saved;
  } catch (_) {}
  return "grid";
}

function saveMode(next) {
  try {
    localStorage.setItem(MODE_KEY, next);
  } catch (_) {}
}

function renderGrid() {
  if (!gridEl) return;
  const frag = document.createDocumentFragment();
  APPS.forEach(function (app, index) {
    const li = document.createElement("li");
    li.className = "grid-item";
    const eager = index < 8;
    const hint = app.hintHtml || escapeHtml(app.hint);
    li.innerHTML =
      '<a class="card" href="' +
      escapeHtml(app.href) +
      '" data-app="' +
      escapeHtml(app.id) +
      '" aria-label="' +
      escapeHtml(app.name) +
      '">' +
      '<span class="card-media">' +
      '<img src="' +
      escapeHtml(app.img) +
      '" alt="" width="' +
      (app.imgW || 900) +
      '" height="' +
      (app.imgH || 1855) +
      '" loading="' +
      (eager ? "eager" : "lazy") +
      '"' +
      (eager ? ' fetchpriority="high"' : "") +
      ' decoding="async" />' +
      "</span>" +
      "</a>" +
      '<p class="card-hint">' +
      hint +
      "</p>";
    frag.appendChild(li);
  });
  gridEl.replaceChildren(frag);
}

function setMode(next) {
  mode = next;
  const sphere = mode === "sphere";
  document.body.classList.toggle("mode-sphere", sphere);
  document.body.classList.toggle("mode-grid", !sphere);
  if (gridPage) gridPage.hidden = sphere;
  if (sphereViewport) sphereViewport.hidden = !sphere;
  if (homeLine) homeLine.hidden = sphere;
  if (modeBtn) modeBtn.textContent = sphere ? "Grid" : "Spherical";
  saveMode(mode);
}

async function goSphere() {
  setMode("sphere");
  const mod = await import("./sphere.js?v=5");
  await mod.enterSphere();
}

async function goGrid() {
  try {
    const mod = await import("./sphere.js?v=5");
    mod.leaveSphere();
  } catch (_) {}
  setMode("grid");
  window.scrollTo(0, 0);
}

async function toggleMode() {
  if (mode === "grid") await goSphere();
  else await goGrid();
}

renderGrid();

if (readSavedMode() === "sphere") {
  goSphere();
} else {
  setMode("grid");
}

function isBackForwardNav() {
  try {
    const nav = performance.getEntriesByType("navigation")[0];
    if (nav && nav.type === "back_forward") return true;
  } catch (_) {}
  return false;
}

/* Drop Safari’s forward entry so a right-edge swipe doesn’t reopen the last app. */
function burnForwardHistory() {
  try {
    history.pushState({ markmagaHub: 1 }, "", location.href);
  } catch (_) {}
}

window.addEventListener("pageshow", function (e) {
  if (e.persisted || isBackForwardNav()) burnForwardHistory();
  if (readSavedMode() === "sphere" && mode !== "sphere") goSphere();
});

modeBtn?.addEventListener("click", function () {
  toggleMode();
});
