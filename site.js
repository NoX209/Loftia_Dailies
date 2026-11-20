// Behaviour of all pages. Without JavaScript the pages still show everything,
// they just do not remember ticks, and offer no column switch and no auto reload.
// Loaded in <head>, so the saved column mode applies before the page is drawn.
// Everything is kept in this browser only (localStorage): no cookies, nothing sent.

const COLUMNS_KEY = "loftia-dailies/columns";
const AUTORELOAD_KEY = "loftia-dailies/autoreload";
const INTERVAL_KEY = "loftia-dailies/autoreload-interval";

function load(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

function save(key, value) {
  try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch (e) {}
}

// --- Column mode: auto (by screen width), 1 or 2; kept for all days. ---------

const COLUMN_MODES = [["auto", "Auto"], ["1", "1 Spalte"], ["2", "2 Spalten"]];

function applyColumns(mode) {
  if (mode === "1" || mode === "2") document.documentElement.dataset.columns = mode;
  else delete document.documentElement.dataset.columns;
}

function setUpColumnSwitch(button) {
  button.hidden = false; // shown only when JavaScript runs; without it the screen width decides
  const show = (mode) => {
    applyColumns(mode);
    button.textContent = (COLUMN_MODES.find(([m]) => m === mode) || COLUMN_MODES[0])[1];
    button.dataset.mode = mode;
  };
  show(load(COLUMNS_KEY) || "auto");
  button.addEventListener("click", () => {
    const index = COLUMN_MODES.findIndex(([m]) => m === button.dataset.mode);
    const mode = COLUMN_MODES[(index + 1) % COLUMN_MODES.length][0];
    show(mode);
    save(COLUMNS_KEY, mode === "auto" ? null : mode);
  });
}

// --- Ticks: a temporary help, kept per day. ----------------------------------

function setUpTicks(day) {
  const prefix = "loftia-dailies/" + day + "/";
  for (const box of document.querySelectorAll("input[data-key]")) {
    const key = prefix + box.dataset.key;
    box.checked = load(key) === "1";
    box.addEventListener("change", () => save(key, box.checked ? "1" : null));
  }
}

// Delivered implies made; taking back made also takes back delivered.
function linkMadeAndDelivered() {
  const tick = (box, checked) => {
    if (box.checked === checked) return;
    box.checked = checked;
    box.dispatchEvent(new Event("change"));
  };
  for (const item of document.querySelectorAll("li.item")) {
    const made = item.querySelector(".made");
    const delivered = item.querySelector(".delivered");
    delivered.addEventListener("change", () => { if (delivered.checked) tick(made, true); });
    made.addEventListener("change", () => { if (!made.checked) tick(delivered, false); });
  }
}

// --- Auto reload --------------------------------------------------------------
// Counts down; at 0 a HEAD request asks whether the page changed. Only then the
// new page is fetched and its content swapped in: no flicker, the scroll
// position stays, the ticks come back from localStorage. If the shared style
// or script changed, the page is reloaded fully instead.
// The left part switches on/off, the right part steps through the waiting times.
// Once every area of the day has its screenshot (data-complete), nothing new can
// come: auto reload switches itself off for good; switching it on again is up to you.

const INTERVALS = [60, 300, 10, 30]; // the order of the steps when clicked
const DEFAULT_INTERVAL = 60;

const autoReload = {
  on: load(AUTORELOAD_KEY) === "on",
  interval: INTERVALS.includes(Number(load(INTERVAL_KEY))) ? Number(load(INTERVAL_KEY)) : DEFAULT_INTERVAL,
  remaining: 0,
  version: null,
  checking: false,
  timer: null,
};

function pageUrl() {
  return location.href.split("#")[0];
}

function versionOf(response) {
  const headers = response.headers;
  return [headers.get("ETag"), headers.get("Last-Modified"), headers.get("Content-Length")].join("|");
}

async function currentVersion() {
  return versionOf(await fetch(pageUrl(), { method: "HEAD", cache: "no-store" }));
}

function assetsOf(doc) {
  return [...doc.querySelectorAll("link[rel=stylesheet], script[src]")]
    .map((element) => element.getAttribute("href") || element.getAttribute("src"))
    .join(" ");
}

async function swapInNewPage() {
  const response = await fetch(pageUrl(), { cache: "no-store" });
  const fresh = new DOMParser().parseFromString(await response.text(), "text/html");
  if (assetsOf(fresh) !== assetsOf(document)) {
    location.reload();
    return;
  }
  autoReload.version = versionOf(response);
  document.title = fresh.title;
  const day = fresh.documentElement.dataset.day;
  if (day) document.documentElement.dataset.day = day;
  else delete document.documentElement.dataset.day;
  if (fresh.documentElement.hasAttribute("data-complete")) document.documentElement.dataset.complete = "";
  else delete document.documentElement.dataset.complete;
  document.querySelector("main").replaceWith(fresh.querySelector("main"));
  setUpPage();
  switchOffWhenComplete();
}

async function checkForChange() {
  if (autoReload.checking) return;
  autoReload.checking = true;
  try {
    const version = await currentVersion();
    if (autoReload.version === null) autoReload.version = version;
    else if (version !== autoReload.version) await swapInNewPage();
  } catch (e) {
    // Server not reachable or page opened from disk: just try again next round.
  } finally {
    autoReload.checking = false;
  }
}

function showAutoReload() {
  const toggle = document.getElementById("autoreload");
  const interval = document.getElementById("autoreload-interval");
  toggle.textContent = autoReload.on ? "↻ " + autoReload.remaining : "↻ aus";
  toggle.setAttribute("aria-pressed", String(autoReload.on));
  interval.textContent = autoReload.interval < 60 ? autoReload.interval + " s" : autoReload.interval / 60 + " min";
}

function countDown() {
  autoReload.remaining -= 1;
  if (autoReload.remaining <= 0) {
    autoReload.remaining = autoReload.interval;
    checkForChange();
  }
  showAutoReload();
}

function startAutoReload() {
  autoReload.remaining = autoReload.interval;
  autoReload.version = null;
  checkForChange(); // remembers the version of the page as it is now
  clearInterval(autoReload.timer);
  autoReload.timer = setInterval(countDown, 1000);
}

function stopAutoReload() {
  clearInterval(autoReload.timer);
  autoReload.timer = null;
}

function switchAutoReload(on) {
  autoReload.on = on;
  save(AUTORELOAD_KEY, on ? "on" : null);
  on ? startAutoReload() : stopAutoReload();
  showAutoReload();
}

function dayIsComplete() {
  return document.documentElement.hasAttribute("data-complete");
}

function switchOffWhenComplete() {
  if (autoReload.on && dayIsComplete()) switchAutoReload(false);
}

function setUpAutoReload() {
  const toggle = document.getElementById("autoreload");
  const interval = document.getElementById("autoreload-interval");
  toggle.parentElement.hidden = false; // shown only when JavaScript runs
  toggle.addEventListener("click", () => switchAutoReload(!autoReload.on));
  interval.addEventListener("click", () => {
    autoReload.interval = INTERVALS[(INTERVALS.indexOf(autoReload.interval) + 1) % INTERVALS.length];
    autoReload.remaining = autoReload.interval;
    save(INTERVAL_KEY, String(autoReload.interval));
    showAutoReload();
  });
  showAutoReload();
}

// Back in a tab that was in the background: look at once, timers were slowed down.
document.addEventListener("visibilitychange", () => {
  if (autoReload.on && document.visibilityState === "visible") {
    autoReload.remaining = autoReload.interval;
    checkForChange();
  }
});

// --- Start --------------------------------------------------------------------

function setUpPage() {
  setUpColumnSwitch(document.getElementById("columns"));
  setUpAutoReload();
  const day = document.documentElement.dataset.day;
  if (day) {
    setUpTicks(day);
    linkMadeAndDelivered();
  }
}

applyColumns(load(COLUMNS_KEY));
document.addEventListener("DOMContentLoaded", () => {
  if (autoReload.on && !dayIsComplete()) startAutoReload();
  setUpPage();
  switchOffWhenComplete();
});
