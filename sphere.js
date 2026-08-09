/**
 * WebGL app sphere (Three.js) — same path on Mac / iPad / phone.
 *
 * Viewer at center. Yaw spins the shell (equator stays horizontal).
 * Pitch tilts the camera up/down to other rings — no sphere tumble/roll.
 * 5 rings: 16 equator + inner/outer ghost bands (14 / 9 by cos packing).
 * Focus zoom on EVERY seat: scale ∝ angular distance from look direction
 * (same L–R weight curve as the old Mac CSS path).
 */
import * as THREE from "./vendor/three.module.min.js";
import { APPS } from "./apps.js";

const REAL = 16;
const EQUATOR_SLOT_DEG = 360 / REAL;
const CARD_ASPECT = 1855 / 900;
/** Peak scale = 1 + FOCUS_BOOST when fully centered */
const FOCUS_BOOST = 1.5;
/* Touch only — Mac stays 1:1 with input for snappy focus */
const FOCUS_LERP_TOUCH = 0.22;
const INNER_N = 14;
const OUTER_N = 9;
const LAT_INNER_DEG = (Math.acos(INNER_N / REAL) * 180) / Math.PI;
const LAT_OUTER_DEG = (Math.acos(OUTER_N / REAL) * 180) / Math.PI;
/* Look up/down far enough for outer rings; equator stays horizontal */
const PITCH_MAX = LAT_OUTER_DEG + 18;
/*
 * Card GPU texture width — match ss-*.webp (900px) 1:1.
 * 16 live + 1 shared ghost is still light on phone / pad / Mac.
 */
const TEX_W = 900;
/* Full card: padding + screenshot (phone aspect) + hint band */
const TEX_PAD = Math.round(TEX_W * 0.045);
const TEX_HINT = Math.round(TEX_W * 0.14);
const TEX_MEDIA_W = TEX_W - TEX_PAD * 2;
const TEX_MEDIA_H = Math.round(TEX_MEDIA_W * CARD_ASPECT);
const TEX_H = TEX_PAD + TEX_MEDIA_H + TEX_HINT + TEX_PAD;

const viewport = document.getElementById("sphere-viewport");
if (!viewport) throw new Error("missing #sphere-viewport");

let sphereActive = false;
let bootPromise = null;

const hasTouch = "ontouchstart" in window || (navigator.maxTouchPoints || 0) > 0;
const finePointer =
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: fine)").matches;
/* Smooth focus ramp only when there’s no fine pointer (phone / pad) */
const smoothFocus = !finePointer;

function wrap180(deg) {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

function clampPitch(p) {
  return Math.max(-PITCH_MAX, Math.min(PITCH_MAX, p));
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function wrapHint(ctx, text, maxWidth) {
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let line = "";
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + " " + words[i] : words[i];
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = words[i];
      if (lines.length >= 3) break;
    } else {
      line = test;
    }
  }
  if (line && lines.length < 3) lines.push(line);
  return lines;
}

function paintCard(ctx, opts) {
  const { img, hint, ghost } = opts;
  const pad = TEX_PAD;
  const radius = Math.round(TEX_W * 0.055);
  ctx.clearRect(0, 0, TEX_W, TEX_H);

  roundRect(ctx, 1, 1, TEX_W - 2, TEX_H - 2, radius);
  ctx.fillStyle = ghost ? "rgba(16, 22, 34, 0.28)" : "rgba(6, 8, 13, 0.94)";
  ctx.fill();
  ctx.strokeStyle = ghost ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.5)";
  ctx.lineWidth = 2;
  ctx.stroke();

  const mediaW = TEX_MEDIA_W;
  const mediaH = TEX_MEDIA_H;
  const mx = pad;
  const my = pad;

  roundRect(ctx, mx, my, mediaW, mediaH, radius * 0.65);
  ctx.save();
  ctx.clip();
  if (img) {
    /* Media box matches screenshot aspect — full width/height, no L/R crop */
    ctx.drawImage(img, mx, my, mediaW, mediaH);
  } else if (ghost) {
    /* ~10% fill — starfield reads through */
    ctx.fillStyle = "rgba(80, 100, 130, 0.10)";
    ctx.fillRect(mx, my, mediaW, mediaH);
  } else {
    ctx.fillStyle = "rgba(40, 52, 72, 0.95)";
    ctx.fillRect(mx, my, mediaW, mediaH);
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.font = "600 " + Math.round(TEX_W * 0.12) + "px DM Sans, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("·", TEX_W / 2, my + mediaH / 2);
  }
  ctx.restore();

  ctx.fillStyle = ghost ? "rgba(139,149,168,0.35)" : "rgba(232,236,242,0.82)";
  ctx.font = "500 " + Math.round(TEX_W * 0.042) + "px DM Sans, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const lines = ghost ? [] : wrapHint(ctx, hint, mediaW - 8);
  const lineH = Math.round(TEX_W * 0.048);
  let ty = my + mediaH + Math.round(TEX_HINT * 0.12);
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], TEX_W / 2, ty + i * lineH);
  }
}

function loadImage(src) {
  return new Promise(function (resolve, reject) {
    const img = new Image();
    img.decoding = "async";
    img.onload = function () {
      resolve(img);
    };
    img.onerror = function () {
      reject(new Error("img " + src));
    };
    img.src = src;
  });
}

function makeTexture(paintFn) {
  const canvas = document.createElement("canvas");
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext("2d");
  paintFn(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/* —— Scene —— */
const scene = new THREE.Scene();
const shell = new THREE.Group();
scene.add(shell);

const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 200);
camera.position.set(0, 0, 0);
camera.rotation.order = "YXZ";

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x000000, 0);
const bootMsg = document.getElementById("sphere-boot");
if (bootMsg) bootMsg.remove();
viewport.appendChild(renderer.domElement);
renderer.domElement.className = "sphere-canvas";
renderer.domElement.setAttribute("aria-hidden", "true");

renderer.domElement.addEventListener(
  "webglcontextlost",
  function (e) {
    e.preventDefault();
  },
  false
);
renderer.domElement.addEventListener(
  "webglcontextrestored",
  function () {
    /* Context restore after rotate — relayout without network refetch */
    if (seats.length) relayoutSeats();
    else buildSphere().catch(function () {});
  },
  false
);

const seats = [];
let radius = 10;
let cardW = 1;
let cardH = 2;
let yaw = 0;
let pitch = 0;
let velYaw = 0;
let velPitch = 0;
let dragging = false;
let moved = false;
let blockClick = false;
let ignoreOpenUntil = 0;
let lastX = 0;
let lastY = 0;
let downX = 0;
let downY = 0;
let lastT = 0;
let activeId = null;
let coasting = false;
/* Recent drag samples for flick coast (last ~100ms only — not whole gesture) */
const flickSamples = [];
let pullMax = 2.8;
/** 0 = viewer at center; grows as user pinches out past the shell */
let camDist = 0;
const _lookDir = new THREE.Vector3();
const _worldPos = new THREE.Vector3();
const _outTarget = new THREE.Vector3();

function maxCamDist() {
  return radius * 2.75;
}

function clampCamDist(d) {
  return Math.max(0, Math.min(maxCamDist(), d));
}

function focusWeight(lon, lat) {
  /* Shell yaw + camera pitch: lookLon = yaw, lookLat = pitch (north = +) */
  const lookLon = yaw;
  const lookLat = pitch;
  const dLon = Math.abs(wrap180(lon - lookLon));
  const dLat = Math.abs(wrap180(lat - lookLat));
  /*
   * Elliptical focus (not a tiny circular cone):
   * halfLon — equator seat width (slightly wide so staggered ghost seats still catch)
   * halfLat — ~½ ring spacing so bands hand off instead of a dead zone
   */
  const halfLon = EQUATOR_SLOT_DEG * 0.75;
  const halfLat = LAT_INNER_DEG * 0.62;
  const nx = dLon / halfLon;
  const ny = dLat / halfLat;
  const d = Math.hypot(nx, ny);
  return d >= 1 ? 0 : 1 - d;
}

function placeSeat(pivot, lonDeg, latDeg, r, faceOutward) {
  const lon = (lonDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  const cl = Math.cos(lat);
  pivot.position.set(Math.sin(lon) * cl * r, Math.sin(lat) * r, -Math.cos(lon) * cl * r);
  if (faceOutward) {
    /* Front faces away from center — correct when viewed from outside */
    _outTarget.copy(pivot.position).multiplyScalar(2);
    shell.localToWorld(_outTarget);
    pivot.lookAt(_outTarget);
  } else {
    /* Front faces center — correct from inside / far-side see-through */
    pivot.lookAt(0, 0, 0);
  }
}

function addSeat(lonDeg, latDeg, texture, meta) {
  const geo = new THREE.PlaneGeometry(cardW, cardH);
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: true,
    side: THREE.FrontSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData = meta;
  /* Pivot holds pose; mesh scale stays uniform (avoids lookAt + scale skew) */
  const pivot = new THREE.Group();
  pivot.add(mesh);
  placeSeat(pivot, lonDeg, latDeg, radius, false);
  shell.add(pivot);
  seats.push({
    pivot: pivot,
    mesh: mesh,
    lon: lonDeg,
    lat: latDeg,
    baseR: radius,
    lastScale: -1,
    dispW: 0,
    live: !!meta.live,
    href: meta.href || null,
  });
  return mesh;
}

function clearSeats() {
  const maps = new Set();
  for (let i = 0; i < seats.length; i++) {
    const s = seats[i];
    shell.remove(s.pivot);
    s.mesh.geometry.dispose();
    if (s.mesh.material.map) maps.add(s.mesh.material.map);
    s.mesh.material.dispose();
  }
  maps.forEach(function (map) {
    map.dispose();
  });
  seats.length = 0;
}

function layoutMetrics() {
  /* World units: packing drives card size; R grows until latitude bands clear */
  radius = 10;
  const seat = (2 * Math.PI) / REAL;
  /* Seat fill — large enough to read, clear of title / Grok line */
  const FILL = 0.45;
  cardW = 2 * radius * Math.tan((seat * FILL) / 2);
  cardH = cardW * (TEX_H / TEX_W);

  const minStep = Math.min(LAT_INNER_DEG, LAT_OUTER_DEG - LAT_INNER_DEG);
  const gapFrac = 0.12;
  for (let guard = 0; guard < 16; guard++) {
    const angH = (2 * Math.atan(cardH / 2 / radius) * 180) / Math.PI;
    const need = angH * (1 + gapFrac);
    if (need <= minStep) break;
    const grow = (need / minStep) * 1.02;
    radius *= grow;
    cardW *= grow;
    cardH *= grow;
  }

  pullMax = radius * 0.26;
  camera.fov = hasTouch ? 76 : 70;
  camera.near = Math.max(0.05, radius * 0.02);
  camera.far = radius * 10;
  camera.updateProjectionMatrix();
}

function chromeTopPx() {
  const intro = document.querySelector(".intro");
  if (!intro) return Math.round(window.innerHeight * 0.1);
  return Math.ceil(intro.getBoundingClientRect().bottom + 8);
}

function resize() {
  const w = viewport.clientWidth || window.innerWidth;
  const h = Math.max(1, viewport.clientHeight || window.innerHeight);
  viewport.style.top = "";
  viewport.style.bottom = "";
  viewport.style.left = "";
  viewport.style.right = "";

  /*
   * Full-bleed canvas. Optical center under title/sub (tuned 0.42 — not
   * too low). Peak scale stays at FOCUS_BOOST (was already the right size).
   */
  const topReserve = chromeTopPx();
  const shiftY = Math.max(0, topReserve * 0.42);

  camera.aspect = w / h;
  camera.setViewOffset(w, h, 0, -shiftY, w, h);
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}

function updateFocus() {
  /* Ease off focus zoom as you leave the center so the shell reads as a globe */
  const fade =
    camDist <= 0.001
      ? 1
      : Math.max(0, 1 - camDist / (radius * 0.85));
  /*
   * Outside the shell: near-hemisphere cards face out, far-hemisphere stay
   * facing in — so both the close “outside” faces and the distant “inside”
   * faces read correctly. Cheap (same lookAt we already do per seat).
   */
  const outside = camDist > radius * 1.02;
  const lerp = smoothFocus ? FOCUS_LERP_TOUCH : 1;
  let settling = false;
  shell.updateMatrixWorld(true);
  for (let i = 0; i < seats.length; i++) {
    const s = seats[i];
    const target = focusWeight(s.lon, s.lat) * fade;
    if (lerp >= 1) {
      s.dispW = target;
    } else {
      s.dispW += (target - s.dispW) * lerp;
      if (Math.abs(target - s.dispW) < 0.002) s.dispW = target;
      else settling = true;
    }
    const w = s.dispW;
    const scale = 1 + w * FOCUS_BOOST;
    const r = s.baseR - pullMax * w;
    let faceOut = false;
    if (outside) {
      const lon = (s.lon * Math.PI) / 180;
      const lat = (s.lat * Math.PI) / 180;
      const cl = Math.cos(lat);
      _worldPos.set(Math.sin(lon) * cl * r, Math.sin(lat) * r, -Math.cos(lon) * cl * r);
      shell.localToWorld(_worldPos);
      faceOut = _worldPos.dot(camera.position) > 0;
    }
    placeSeat(s.pivot, s.lon, s.lat, r, faceOut);
    if (Math.abs(scale - s.lastScale) >= 0.002) {
      s.lastScale = scale;
      s.mesh.scale.setScalar(scale);
    }
    s.mesh.renderOrder = Math.round(w * 1000);
  }
  return settling;
}

function applyPose() {
  /* Shell: yaw only — equator plane stays world-horizontal */
  shell.rotation.set(0, (yaw * Math.PI) / 180, 0);
  const pr = (pitch * Math.PI) / 180;
  /*
   * Look dir matches camera-at-center Rx(pitch): (0, sin p, −cos p).
   * Pinch-out backs along −look → through the far side → outside the sphere.
   */
  _lookDir.set(0, Math.sin(pr), -Math.cos(pr));
  if (camDist < 0.02) {
    camera.position.set(0, 0, 0);
    camera.rotation.set(pr, 0, 0);
  } else {
    camera.position.copy(_lookDir).multiplyScalar(-camDist);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
  }
  camera.near = Math.max(0.05, Math.abs(camDist - radius) * 0.02 + 0.05);
  camera.far = Math.max(radius * 10, camDist + radius * 4);
  camera.updateProjectionMatrix();
  return updateFocus();
}

function stopCoast() {
  coasting = false;
}

function startCoast() {
  /* Soft stop stays put; a real horizontal flick keeps spinning (yaw only). */
  const minV = hasTouch ? 0.55 : 0.1;
  if (Math.abs(velYaw) < minV) {
    velYaw = 0;
    velPitch = 0;
    return;
  }
  const cap = 20;
  velYaw = Math.max(-cap, Math.min(cap, velYaw));
  velPitch = 0;
  coasting = true;
  ensureAnimLoop();
}

let focusRaf = 0;

function ensureAnimLoop() {
  if (focusRaf) return;
  function loop() {
    focusRaf = 0;
    if (coasting && !dragging && !pinching) {
      const friction = 0.93;
      if (Math.abs(velYaw) < 0.04) {
        velYaw = 0;
        velPitch = 0;
        coasting = false;
      } else {
        yaw += velYaw;
        velYaw *= friction;
      }
    }
    const settling = applyPose();
    renderer.render(scene, camera);
    if (settling || dragging || coasting || pinching) {
      focusRaf = requestAnimationFrame(loop);
    }
  }
  focusRaf = requestAnimationFrame(loop);
}

function render() {
  const settling = applyPose();
  renderer.render(scene, camera);
  if (settling || dragging || coasting || pinching) ensureAnimLoop();
}

function isChromeTarget(t) {
  return !!(
    t &&
    t.closest &&
    t.closest(".site-chrome, .about-dialog, .intro-cta, .menu-dropdown, dialog")
  );
}

function dragSigns() {
  /* Mac: look-steer. Phone/pad: drag-the-world. Flip both when outside so feel matches inside. */
  const outside = camDist > radius * 1.02;
  let yawSign = hasTouch ? -1 : 1;
  let pitchSign = hasTouch ? 1 : -1;
  if (outside) {
    yawSign *= -1;
    pitchSign *= -1;
  }
  return { yawSign: yawSign, pitchSign: pitchSign, sens: hasTouch ? 0.18 : 0.26 };
}

function onDown(x, y, id, target) {
  if (!sphereActive || pinching) return false;
  if (isChromeTarget(target)) return false;
  dragging = true;
  moved = false;
  blockClick = false;
  activeId = id;
  lastX = x;
  lastY = y;
  downX = x;
  downY = y;
  lastT = performance.now();
  velYaw = 0;
  velPitch = 0;
  flickSamples.length = 0;
  flickSamples.push({ t: lastT, x: x, y: y });
  stopCoast();
  viewport.classList.add("is-dragging");
  return true;
}

function onMove(x, y) {
  if (!dragging) return;
  const now = performance.now();
  const dt = Math.max(8, Math.min(48, now - lastT));
  const dx = x - lastX;
  const dy = y - lastY;
  /* From finger-down (not per-frame) so a slow nudge isn’t a tap */
  if (Math.hypot(x - downX, y - downY) > (hasTouch ? 12 : 6)) {
    moved = true;
    blockClick = true;
  }
  const signs = dragSigns();
  const dYaw = signs.yawSign * dx * signs.sens;
  const dPitch = signs.pitchSign * dy * signs.sens;
  yaw += dYaw;
  pitch = clampPitch(pitch + dPitch);
  velYaw = dYaw * (16 / dt);
  velPitch = dPitch * (16 / dt);
  flickSamples.push({ t: now, x: x, y: y });
  while (flickSamples.length > 16) flickSamples.shift();
  while (flickSamples.length > 2 && now - flickSamples[0].t > 100) {
    flickSamples.shift();
  }
  lastX = x;
  lastY = y;
  lastT = now;
  render();
}

function flickReleaseVelocity() {
  /*
   * Only the last ~70ms of motion. Using peak speed from earlier in the
   * drag made a centered card “bounce” away on finger-up.
   */
  let ry = 0;
  if (flickSamples.length >= 2) {
    const end = flickSamples[flickSamples.length - 1];
    let start = flickSamples[0];
    for (let i = flickSamples.length - 2; i >= 0; i--) {
      if (end.t - flickSamples[i].t >= 56) {
        start = flickSamples[i];
        break;
      }
    }
    const dt = Math.max(16, end.t - start.t);
    const dx = end.x - start.x;
    const signs = dragSigns();
    ry = signs.yawSign * dx * signs.sens * (16 / dt);
  }
  return { yaw: ry, pitch: 0 };
}

const POSE_KEY = "markmaga-hub-sphere-pose";

function saveSpherePose() {
  try {
    sessionStorage.setItem(
      POSE_KEY,
      JSON.stringify({
        yaw: yaw,
        pitch: pitch,
        camDist: camDist,
      })
    );
  } catch (_) {}
}

function restoreSpherePose() {
  try {
    const raw = sessionStorage.getItem(POSE_KEY);
    if (!raw) return;
    const pose = JSON.parse(raw);
    if (typeof pose.yaw === "number") yaw = pose.yaw;
    if (typeof pose.pitch === "number") pitch = clampPitch(pose.pitch);
    if (typeof pose.camDist === "number") camDist = clampCamDist(pose.camDist);
    velYaw = 0;
    velPitch = 0;
    stopCoast();
    /* Reset focus blend so cards match the restored look immediately */
    for (let i = 0; i < seats.length; i++) {
      seats[i].dispW = 0;
      seats[i].lastScale = -1;
    }
  } catch (_) {}
}

function openFocusedLive() {
  /* Same as before momentum work: open the most-centered live card.
   * Works inside or outside the shell — no raycast / edge dead-zones. */
  if (!sphereActive || blockClick || moved) return;
  if (performance.now() < ignoreOpenUntil) return;
  let best = null;
  let bestW = 0.55;
  for (let i = 0; i < seats.length; i++) {
    const s = seats[i];
    if (!s.live || !s.href) continue;
    if (s.dispW > bestW) {
      bestW = s.dispW;
      best = s;
    }
  }
  if (best && best.href) {
    saveSpherePose();
    location.assign(best.href);
  }
}

function onUp() {
  if (!dragging) return;
  const shouldOpen = !moved && !blockClick;
  const flick = flickReleaseVelocity();
  dragging = false;
  activeId = null;
  viewport.classList.remove("is-dragging");
  flickSamples.length = 0;
  velYaw = flick.yaw;
  velPitch = flick.pitch;
  startCoast();
  if (shouldOpen) openFocusedLive();
  if (blockClick) {
    setTimeout(function () {
      blockClick = false;
      moved = false;
    }, 80);
  }
}

function relayoutSeats() {
  /*
   * Orientation / window change: update packing + mesh size in place.
   * Do NOT rebuild textures or re-fetch images (that hung local HTTPS / PWA).
   */
  layoutMetrics();
  for (let i = 0; i < seats.length; i++) {
    const s = seats[i];
    s.baseR = radius;
    s.mesh.geometry.dispose();
    s.mesh.geometry = new THREE.PlaneGeometry(cardW, cardH);
    s.lastScale = -1;
  }
  resize();
  render();
}

async function buildSphere() {
  layoutMetrics();
  clearSeats();

  const ghostTex = makeTexture(function (ctx) {
    paintCard(ctx, { img: null, hint: "·", ghost: true });
  });

  function addGhostRing(latDeg, n, stagger) {
    const step = 360 / n;
    const offset = stagger ? step * 0.5 : 0;
    for (let i = 0; i < n; i++) {
      addSeat(i * step + offset, latDeg, ghostTex, { live: false });
    }
  }

  addGhostRing(LAT_INNER_DEG, INNER_N, true);
  addGhostRing(-LAT_INNER_DEG, INNER_N, true);
  addGhostRing(LAT_OUTER_DEG, OUTER_N, false);
  addGhostRing(-LAT_OUTER_DEG, OUTER_N, false);

  /* Live equator last so they win depth ties when focused */
  const images = await Promise.all(
    APPS.map(function (app) {
      return loadImage(app.img).catch(function () {
        return null;
      });
    })
  );

  for (let i = 0; i < APPS.length; i++) {
    const app = APPS[i];
    const img = images[i];
    const tex = makeTexture(function (ctx) {
      paintCard(ctx, { img: img, hint: app.hint, ghost: false });
    });
    addSeat(i * EQUATOR_SLOT_DEG, 0, tex, {
      live: true,
      name: app.name,
      href: app.href,
    });
  }

  for (let i = 0; i < seats.length; i++) {
    seats[i].baseR = radius;
  }

  resize();
  render();
}

/* —— Input —— */
let pinching = false;
let pinchStartSep = 0;
let pinchStartDist = 0;

function touchSep(t0, t1) {
  return Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
}

function onPinchStart(t0, t1) {
  pinching = true;
  /* Cancel one-finger drag so pointer + pinch don’t fight */
  if (dragging) {
    dragging = false;
    activeId = null;
    viewport.classList.remove("is-dragging");
    flickSamples.length = 0;
  }
  stopCoast();
  pinchStartSep = Math.max(1, touchSep(t0, t1));
  pinchStartDist = camDist;
  velYaw = 0;
  velPitch = 0;
}

function onPinchMove(t0, t1) {
  if (!pinching) return;
  const sep = Math.max(1, touchSep(t0, t1));
  /* Phone/pad: pinch-in → fly outward; spread → return toward center */
  if (pinchStartDist < 0.05) {
    camDist = clampCamDist((pinchStartSep - sep) * 0.05);
  } else {
    camDist = clampCamDist(pinchStartDist * (pinchStartSep / sep));
  }
  render();
}

function onPinchEnd() {
  pinching = false;
}

/*
 * Phone/pad: touch drag (high-rate moves) + pinch.
 * Mac: pointer drag. Avoid dual-binding — iOS fires both and would double-spin.
 */
if (hasTouch) {
  viewport.addEventListener(
    "touchstart",
    function (e) {
      if (e.touches.length === 2) {
        onPinchStart(e.touches[0], e.touches[1]);
        return;
      }
      if (e.touches.length !== 1 || pinching) return;
      const t = e.touches[0];
      onDown(t.clientX, t.clientY, t.identifier, e.target);
    },
    { passive: true }
  );
  viewport.addEventListener(
    "touchmove",
    function (e) {
      if (e.touches.length >= 2) {
        e.preventDefault();
        if (!pinching) onPinchStart(e.touches[0], e.touches[1]);
        onPinchMove(e.touches[0], e.touches[1]);
        return;
      }
      if (pinching || !dragging || e.touches.length !== 1) return;
      const t = e.touches[0];
      if (activeId != null && t.identifier !== activeId) return;
      e.preventDefault();
      onMove(t.clientX, t.clientY);
    },
    { passive: false }
  );
  viewport.addEventListener(
    "touchend",
    function (e) {
      if (pinching) {
        if (e.touches.length < 2) onPinchEnd();
        if (e.touches.length === 1) {
          const t = e.touches[0];
          onDown(t.clientX, t.clientY, t.identifier, e.target);
        }
        return;
      }
      if (e.touches.length === 0) onUp();
    },
    { passive: true }
  );
  viewport.addEventListener(
    "touchcancel",
    function () {
      onPinchEnd();
      onUp();
    },
    { passive: true }
  );
} else {
  viewport.addEventListener(
    "pointerdown",
    function (e) {
      if (!sphereActive || pinching) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (!onDown(e.clientX, e.clientY, e.pointerId, e.target)) return;
      try {
        viewport.setPointerCapture(e.pointerId);
      } catch (_) {}
    },
    { passive: true }
  );
  viewport.addEventListener(
    "pointermove",
    function (e) {
      if (!dragging || pinching || e.pointerId !== activeId) return;
      onMove(e.clientX, e.clientY);
    },
    { passive: true }
  );
  function endPointer(e) {
    if (activeId != null && e.pointerId !== activeId) return;
    onUp();
    try {
      viewport.releasePointerCapture(e.pointerId);
    } catch (_) {}
  }
  viewport.addEventListener("pointerup", endPointer, { passive: true });
  viewport.addEventListener("pointercancel", endPointer, { passive: true });
}

viewport.addEventListener(
  "click",
  function (e) {
    if (blockClick || moved) {
      e.preventDefault();
      e.stopPropagation();
    }
  },
  true
);

viewport.addEventListener(
  "wheel",
  function (e) {
    e.preventDefault();
    stopCoast();
    /* Trackpad pinch (ctrl+wheel) or explicit pinch → dolly out/in */
    if (e.ctrlKey || e.metaKey) {
      camDist = clampCamDist(camDist + e.deltaY * 0.04);
      velYaw = 0;
      velPitch = 0;
      render();
      return;
    }
    const outside = camDist > radius * 1.02;
    const yawSign = outside ? -1 : 1;
    const pitchSign = outside ? -1 : 1;
    yaw += yawSign * e.deltaX * 0.1;
    pitch = clampPitch(pitch - pitchSign * e.deltaY * 0.08);
    velYaw = 0;
    velPitch = 0;
    render();
  },
  { passive: false }
);

let resizeTimer = 0;
function onViewportChange() {
  /* Suppress ghost taps / clicks that iOS synthesizes across orientation */
  ignoreOpenUntil = performance.now() + 900;
  blockClick = true;
  moved = true;
  dragging = false;
  pinching = false;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(function () {
    if (!seats.length) return;
    const y = yaw;
    const p = pitch;
    const d = camDist;
    relayoutSeats();
    yaw = y;
    pitch = p;
    camDist = clampCamDist(d);
    render();
    ignoreOpenUntil = performance.now() + 400;
    setTimeout(function () {
      blockClick = false;
      moved = false;
    }, 450);
  }, 150);
}
window.addEventListener("resize", onViewportChange, { passive: true });
window.addEventListener("orientationchange", onViewportChange, { passive: true });
/* Capture-phase: kill click/touchend opens during the ignore window */
document.addEventListener(
  "click",
  function (e) {
    if (performance.now() < ignoreOpenUntil) {
      e.preventDefault();
      e.stopPropagation();
    }
  },
  true
);

window.addEventListener("keydown", function (e) {
  if (e.target.closest && e.target.closest("input, textarea, dialog")) return;
  const step = e.shiftKey ? 18 : 8;
  let used = true;
  if (e.key === "ArrowLeft") yaw -= step;
  else if (e.key === "ArrowRight") yaw += step;
  else if (e.key === "ArrowUp") pitch = clampPitch(pitch + step);
  else if (e.key === "ArrowDown") pitch = clampPitch(pitch - step);
  else if (e.key === "Home") {
    yaw = 0;
    pitch = 0;
    camDist = 0;
  } else used = false;
  if (used) {
    e.preventDefault();
    stopCoast();
    render();
  }
});

export function initSphere() {
  if (bootPromise) return bootPromise;
  const boot = document.getElementById("sphere-boot");
  bootPromise = buildSphere()
    .then(function () {
      if (boot) boot.remove();
    })
    .catch(function (err) {
      console.error(err);
      viewport.innerHTML =
        '<p class="sphere-fallback">Could not start the WebGL sphere.</p>';
    });
  return bootPromise;
}

export async function enterSphere() {
  sphereActive = true;
  viewport.hidden = false;
  await initSphere();
  restoreSpherePose();
  resize();
  render();
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      if (!sphereActive) return;
      resize();
      render();
    });
  }
}

export function leaveSphere() {
  if (sphereActive) saveSpherePose();
  sphereActive = false;
  stopCoast();
  dragging = false;
  pinching = false;
  viewport.classList.remove("is-dragging");
  viewport.hidden = true;
}

window.addEventListener(
  "pagehide",
  function () {
    if (sphereActive) saveSpherePose();
  },
  { passive: true }
);
