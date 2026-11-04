/* ============================================================
   Traffic Bot — site interactions
   Vanilla JS, no dependencies.
   ============================================================ */
(function () {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------------------------------------------------
     1. Toast
     --------------------------------------------------------- */
  const toast = $("#toast");
  const toastText = $("#toastText");
  let toastTimer;

  function showToast(msg) {
    if (!toast) return;
    toastText.textContent = msg;
    toast.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-on"), 1900);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (err) {
        ok = false;
      }
      document.body.removeChild(ta);
      return ok;
    }
  }

  /* ---------------------------------------------------------
     2. Header state + scroll progress
     --------------------------------------------------------- */
  const header = $("#header");
  const progress = $("#progress");

  function onScroll() {
    const y = window.scrollY;
    if (header) header.classList.toggle("is-stuck", y > 12);
    if (progress) {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      const p = h > 0 ? Math.min(1, y / h) : 0;
      progress.style.transform = "scaleX(" + p + ")";
    }
  }

  let ticking = false;
  window.addEventListener(
    "scroll",
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        onScroll();
        ticking = false;
      });
    },
    { passive: true }
  );
  onScroll();

  /* ---------------------------------------------------------
     3. Mobile menu
     --------------------------------------------------------- */
  const burger = $("#burger");
  const mobileMenu = $("#mobileMenu");

  function setMenu(open) {
    if (!burger || !mobileMenu) return;
    burger.setAttribute("aria-expanded", String(open));
    burger.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    mobileMenu.dataset.open = String(open);
  }

  if (burger) {
    burger.addEventListener("click", () => {
      setMenu(burger.getAttribute("aria-expanded") !== "true");
    });
    $$("a", mobileMenu).forEach((a) => a.addEventListener("click", () => setMenu(false)));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setMenu(false);
    });
  }

  /* ---------------------------------------------------------
     4. Scroll reveal
     --------------------------------------------------------- */
  const revealEls = $$(".reveal");
  if ("IntersectionObserver" in window && !reduceMotion) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("is-in"));
  }

  /* ---------------------------------------------------------
     5. Active nav link on scroll
     --------------------------------------------------------- */
  const navLinks = $$(".nav__link");
  const sections = navLinks
    .map((link) => {
      const id = link.getAttribute("href");
      const el = id && id.startsWith("#") ? $(id) : null;
      return el ? { link, el } : null;
    })
    .filter(Boolean);

  if ("IntersectionObserver" in window && sections.length) {
    const spy = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          navLinks.forEach((l) => l.classList.remove("is-active"));
          const match = sections.find((s) => s.el === entry.target);
          if (match) match.link.classList.add("is-active");
        });
      },
      { rootMargin: "-45% 0px -50% 0px", threshold: 0 }
    );
    sections.forEach((s) => spy.observe(s.el));
  }

  /* ---------------------------------------------------------
     6. Card spotlight (pointer-follow highlight)
     --------------------------------------------------------- */
  if (window.matchMedia("(hover: hover)").matches && !reduceMotion) {
    $$(".card").forEach((card) => {
      card.addEventListener("pointermove", (e) => {
        const r = card.getBoundingClientRect();
        card.style.setProperty("--mx", ((e.clientX - r.left) / r.width) * 100 + "%");
        card.style.setProperty("--my", ((e.clientY - r.top) / r.height) * 100 + "%");
      });
    });
  }

  /* ---------------------------------------------------------
     7. Mode tabs
     --------------------------------------------------------- */
  const tabs = $$(".mode-tab");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => {
        const on = t === tab;
        t.setAttribute("aria-selected", String(on));
        const panel = $("#" + t.getAttribute("aria-controls"));
        if (panel) panel.hidden = !on;
      });
    });
    tab.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      const i = tabs.indexOf(tab);
      const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      next.click();
    });
  });

  /* ---------------------------------------------------------
     8. Code tabs + copy
     --------------------------------------------------------- */
  const codeButtons = $$(".code-card__tabs button[data-code]");
  let currentCodeId = "clone";

  function rawCode(id) {
    const panel = $("#code-" + id);
    return panel ? panel.innerText : "";
  }

  codeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      currentCodeId = btn.dataset.code;
      codeButtons.forEach((b) => b.setAttribute("aria-selected", String(b === btn)));
      $$(".code-panel").forEach((p) => {
        p.hidden = p.id !== "code-" + currentCodeId;
      });
    });
  });

  const copyBtn = $("#copyBtn");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const ok = await copyText(rawCode(currentCodeId).trim());
      showToast(ok ? "Copied to clipboard" : "Copy failed — select manually");
    });
  }

  /* ---------------------------------------------------------
     9. Live lab simulation
     --------------------------------------------------------- */
  const sim = $("#sim");
  if (sim) {
    const el = {
      state: $("#simState"),
      clock: $("#simClock"),
      session: $("#mSession"),
      success: $("#mSuccess"),
      failed: $("#mFailed"),
      proxy: $("#mProxy"),
      log: $("#simLog"),
      line: $("#chartLine"),
      area: $("#chartArea"),
      run: $("#simRun"),
      count: $("#cCount"),
      proxies: $("#cProxies"),
      pause: $("#cPause"),
      mode: $("#cMode"),
      oCount: $("#oCount"),
      oProxies: $("#oProxies"),
      oPause: $("#oPause")
    };

    const W = 600;
    const H = 156;
    const MAX_POINTS = 60;
    let points = [];
    let timer = null;
    let running = false;
    let elapsed = 0;
    let tick = 0;
    let state = {};

    function fill(range) {
      const min = +range.min;
      const max = +range.max;
      const pct = ((+range.value - min) / (max - min)) * 100;
      range.style.setProperty("--fill", pct + "%");
    }

    function syncLabels() {
      el.oCount.textContent = el.count.value;
      el.oProxies.textContent = el.proxies.value;
      el.oPause.textContent = el.pause.value + "s";
      [el.count, el.proxies, el.pause].forEach(fill);
    }

    [el.count, el.proxies, el.pause].forEach((r) =>
      r.addEventListener("input", () => {
        syncLabels();
        if (!running) resetChart();
      })
    );

    function log(msg, cls) {
      const div = document.createElement("div");
      div.className = cls || "sys-t";
      const t = String(Math.floor(elapsed / 60)).padStart(2, "0") + ":" + String(elapsed % 60).padStart(2, "0");
      div.textContent = "[" + t + "] " + msg;
      el.log.appendChild(div);
      while (el.log.childElementCount > 7) el.log.removeChild(el.log.firstElementChild);
    }

    function resetChart() {
      points = [];
      drawChart();
    }

    function drawChart() {
      if (!points.length) {
        el.line.setAttribute("d", "");
        el.area.setAttribute("d", "");
        return;
      }
      const stepX = W / Math.max(MAX_POINTS - 1, 1);
      const maxY = Math.max(6, state.total || 6);
      const coords = points.map((v, i) => {
        const x = i * stepX;
        const y = H - 8 - (v / maxY) * (H - 24);
        return [x, y];
      });
      let d = "";
      coords.forEach((c, i) => {
        if (i === 0) {
          d += "M" + c[0].toFixed(1) + " " + c[1].toFixed(1);
        } else {
          const prev = coords[i - 1];
          const cx = (prev[0] + c[0]) / 2;
          d += " C" + cx.toFixed(1) + " " + prev[1].toFixed(1) + " " + cx.toFixed(1) + " " + c[1].toFixed(1) + " " + c[0].toFixed(1) + " " + c[1].toFixed(1);
        }
      });
      el.line.setAttribute("d", d);
      const last = coords[coords.length - 1];
      el.area.setAttribute("d", d + " L" + last[0].toFixed(1) + " " + H + " L0 " + H + " Z");
    }

    function reset() {
      clearInterval(timer);
      timer = null;
      running = false;
      elapsed = 0;
      tick = 0;
      el.clock.textContent = "00:00";
      el.session.textContent = "0/0";
      el.success.textContent = "0";
      el.failed.textContent = "0";
      el.proxy.textContent = "—";
      el.log.innerHTML = "";
      sim.classList.remove("is-running", "is-done");
      el.run.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 3 14 9-14 9V3Z"/></svg> Start simulation';
      resetChart();
    }

    function start() {
      reset();
      const count = +el.count.value;
      const pool = +el.proxies.value;
      const pause = +el.pause.value;
      const mode = el.mode.value;

      state = {
        total: count,
        pool,
        pause,
        mode,
        done: 0,
        ok: 0,
        fail: 0,
        proxy: 0,
        startedAt: null
      };

      running = true;
      sim.classList.add("is-running");
      el.session.textContent = "0/" + count;
      el.run.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2"/></svg> Stop run';
      el.state.textContent = "Running — mode " + mode;
      log("run started · mode=" + mode + " sessions=" + count + " pool=" + pool, "info-t");
      const first = "http://" + randIp() + ":" + (8000 + (Math.random() * 900 | 0));
      log("proxy selected · " + first, "ok-t");

      // Speed: each tick ≈ 260ms real time, but represents a compressed session.
      timer = setInterval(() => {
        tick++;
        elapsed++;

        // proxies rotate every few sessions
        if (tick % 1 === 0) {
          state.proxy = (state.proxy + 1) % state.pool;
          const ip = "http://" + randIp() + ":" + (8000 + (Math.random() * 900 | 0));
          if (tick % 3 === 1) log("proxy rotated · " + ip, "sys-t");
        }

        state.done++;
        const failChance = 0.03 + Math.min(0.22, (state.done / state.total) * 0.05);
        const failed = Math.random() < failChance;
        if (failed) {
          state.fail++;
          const reasons = ["proxy timeout", "navigation error", "element not found", "session aborted"];
          log("session " + state.done + " failed · " + reasons[(Math.random() * reasons.length) | 0], "warn-t");
        } else {
          state.ok++;
          const actions = mode === "Direct" ? ["landed", "scrolled", "dwell 3.2s"] : ["serp loaded", "result clicked", "scrolled 2x"];
          log("session " + state.done + " ok · " + actions[(Math.random() * actions.length) | 0], "ok-t");
        }

        points.push(state.ok);
        if (points.length > MAX_POINTS) points.shift();
        drawChart();

        el.session.textContent = String(state.done) + "/" + state.total;
        el.success.textContent = phaseCount(state.ok, state.done);
        el.failed.textContent = state.fail;
        el.proxy.textContent = state.proxy + 1 + "/" + state.pool;

        if (state.done % 5 === 0 || state.done === state.total) ring(state.ok, state.done);

        if (state.done >= state.total) finish();
      }, 260);
    }

    // animate counters
    const shown = { ok: 0, fail: 0 };
    function phaseCount(value, total) {
      // count-up feel without lagging behind real state
      shown.ok = value;
      el.success.textContent = shown.ok;
      return value;
    }

    function ring(ok, done) {
      const rate = done ? Math.round((ok / done) * 100) : 0;
      log("checkpoint · " + rate + "% success rate", "info-t");
    }

    function finish() {
      clearInterval(timer);
      timer = null;
      running = false;
      sim.classList.remove("is-running");
      sim.classList.add("is-done");
      const rate = state.done ? Math.round((state.ok / state.done) * 100) : 0;
      el.state.textContent = "Done — " + rate + "% success";
      log("run completed · " + state.ok + " ok / " + state.fail + " failed", "info-t");
      log("telegram report sent", "ok-t");
      el.run.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9"/><path d="M3 3v6h6"/></svg> Run again';
    }

    el.run.addEventListener("click", () => {
      if (running) {
        clearInterval(timer);
        timer = null;
        running = false;
        sim.classList.remove("is-running");
        el.state.textContent = "Stopped at " + state.done + "/" + state.total;
        log("run stopped by user", "warn-t");
        el.run.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 3 14 9-14 9V3Z"/></svg> Resume';
      } else {
        start();
      }
    });

    const clockInt = setInterval(() => {
      if (!running) return;
      el.clock.textContent =
        String(Math.floor(elapsed / 60)).padStart(2, "0") + ":" + String(elapsed % 60).padStart(2, "0");
    }, 250);
    window.addEventListener("beforeunload", () => clearInterval(clockInt));

    syncLabels();
    reset();
  }

  function randIp() {
    return [1 + ((Math.random() * 200) | 0), (Math.random() * 255) | 0, (Math.random() * 255) | 0, 1 + ((Math.random() * 253) | 0)].join(".");
  }

  /* ---------------------------------------------------------
     10. GitHub stars (best effort, cached)
     --------------------------------------------------------- */
  (async function stars() {
    const nodes = $$("[data-stars]");
    if (!nodes.length) return;
    const CACHE = "tb:stars";
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE) || "null");
      if (cached && Date.now() - cached.t < 36e5) {
        nodes.forEach((n) => (n.textContent = "★ " + cached.n.toLocaleString()));
        return;
      }
    } catch (e) {}
    try {
      const res = await fetch("https://api.github.com/repos/zougar99/traffic-bot", { headers: { Accept: "application/vnd.github+json" } });
      if (!res.ok) throw new Error("http " + res.status);
      const data = await res.json();
      const n = data.stargazers_count || 0;
      nodes.forEach((node) => (node.textContent = "★ " + n.toLocaleString()));
      try {
        localStorage.setItem(CACHE, JSON.stringify({ t: Date.now(), n }));
      } catch (e) {}
    } catch (e) {
      nodes.forEach((n) => (n.textContent = "★ —"));
    }
  })();

  /* ---------------------------------------------------------
     11. Misc: year + smooth anchor offsets handled by CSS
     --------------------------------------------------------- */
  const year = $("#year");
  if (year) year.textContent = "© " + new Date().getFullYear() + " Traffic Bot";
})();
