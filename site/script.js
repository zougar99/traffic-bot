/* ============================================================
   Traffic Bot — site v2 interactions
   Vanilla JS. No dependencies, no network calls except the
   optional GitHub star count (cached, fail-silent).
   ============================================================ */
(function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var rnd = function (a, b) { return a + Math.random() * (b - a); };
  var int = function (a, b) { return Math.floor(rnd(a, b + 1)); };
  var pad = function (n) { return String(n).padStart(2, "0"); };

  /* ---------------------------------------------------------
     1. Theme
     --------------------------------------------------------- */
  var root = document.documentElement;
  var themeBtn = $("#themeToggle");

  function setTheme(name) {
    root.setAttribute("data-theme", name);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", name === "light" ? "#f6f8fb" : "#06090e");
    try { localStorage.setItem("tb:theme", name); } catch (e) {}
  }

  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      setTheme(root.getAttribute("data-theme") === "light" ? "dark" : "light");
    });
  }

  /* ---------------------------------------------------------
     2. Toast
     --------------------------------------------------------- */
  var toast = $("#toast");
  var toastText = $("#toastText");
  var toastTimer;

  function showToast(msg) {
    if (!toast) return;
    toastText.textContent = msg;
    toast.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove("is-on"); }, 1900);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, fallback);
    }
    return Promise.resolve(fallback());

    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      return ok;
    }
  }

  /* ---------------------------------------------------------
     3. Header, progress, drawer, active link
     --------------------------------------------------------- */
  var header = $("#header");
  var progress = $("#progress");
  var ticking = false;

  function onScroll() {
    var y = window.scrollY;
    if (header) header.classList.toggle("is-stuck", y > 10);
    if (progress) {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      progress.style.transform = "scaleX(" + (max > 0 ? Math.min(1, y / max) : 0) + ")";
    }
  }

  window.addEventListener("scroll", function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () { onScroll(); ticking = false; });
  }, { passive: true });

  onScroll();

  var burger = $("#burger");
  var drawer = $("#drawer");

  function setDrawer(open) {
    if (!burger || !drawer) return;
    burger.setAttribute("aria-expanded", String(open));
    burger.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    drawer.dataset.open = String(open);
  }

  if (burger) {
    burger.addEventListener("click", function () {
      setDrawer(burger.getAttribute("aria-expanded") !== "true");
    });
    $$("a", drawer).forEach(function (a) {
      a.addEventListener("click", function () { setDrawer(false); });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") setDrawer(false);
    });
  }

  var navLinks = $$(".nav__link");
  var watched = navLinks.map(function (link) {
    var href = link.getAttribute("href");
    var el = href && href.charAt(0) === "#" ? $(href) : null;
    return el ? { link: link, el: el } : null;
  }).filter(Boolean);

  if ("IntersectionObserver" in window && watched.length) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        navLinks.forEach(function (l) { l.classList.remove("is-active"); });
        var hit = watched.filter(function (w) { return w.el === entry.target; })[0];
        if (hit) hit.link.classList.add("is-active");
      });
    }, { rootMargin: "-45% 0px -50% 0px", threshold: 0 });
    watched.forEach(function (w) { spy.observe(w.el); });
  }

  /* ---------------------------------------------------------
     4. Reveal on scroll
     --------------------------------------------------------- */
  var reveals = $$(".reveal");
  if ("IntersectionObserver" in window && !reduced) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        io.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.06 });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("is-in"); });
  }

  /* ---------------------------------------------------------
     5. Mode tabs
     --------------------------------------------------------- */
  var modeTabs = $$(".mode-btn");
  modeTabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      modeTabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute("aria-selected", String(on));
        var panel = $("#" + t.getAttribute("aria-controls"));
        if (panel) panel.hidden = !on;
      });
    });
    tab.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      var i = modeTabs.indexOf(tab);
      var next = modeTabs[(i + (e.key === "ArrowRight" ? 1 : modeTabs.length - 1)) % modeTabs.length];
      next.focus();
      next.click();
    });
  });

  /* ---------------------------------------------------------
     6. Code tabs + copy
     --------------------------------------------------------- */
  var codeBtns = $$(".code__tabs button[data-code]");
  var currentCode = "clone";

  codeBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      currentCode = btn.dataset.code;
      codeBtns.forEach(function (b) { b.setAttribute("aria-selected", String(b === btn)); });
      $$(".pane").forEach(function (p) { p.hidden = p.id !== "code-" + currentCode; });
    });
  });

  var copyBtn = $("#copyBtn");
  if (copyBtn) {
    copyBtn.addEventListener("click", function () {
      var pane = $("#code-" + currentCode);
      Promise.resolve(copyText(pane ? pane.innerText.trim() : "")).then(function (ok) {
        showToast(ok ? "Snippet copied" : "Copy failed — select manually");
      });
    });
  }

  /* ---------------------------------------------------------
     7. Hero console — simulated session stream
     --------------------------------------------------------- */
  var stream = $("#heroStream");
  if (stream) {
    var heroMode = $("#heroMode");
    var heroProxy = $("#heroProxy");
    var heroSession = $("#heroSession");
    var heroFoot = $("#heroFoot");
    var TOTAL = 25;
    var done = 0;
    var ok = 0;
    var fails = 0;
    var started = Date.now();

    var steps = {
      Direct: [
        ["ok", "landed on target"],
        ["info", "scrolled 3 sections"],
        ["sys", "dwell 2.6s"]
      ],
      Google: [
        ["info", "serp loaded · 10 results"],
        ["ok", "target found · position 3"],
        ["ok", "result clicked"],
        ["sys", "dwell 3.1s"]
      ],
      Proxy: [
        ["info", "remote fetch ok"],
        ["ok", "target matched"],
        ["ok", "clicked through"],
        ["sys", "dwell 2.4s"]
      ]
    };

    function line(kind, tag, msg) {
      var el = document.createElement("div");
      el.className = "stream__line stream__line--" + kind;
      var t = new Date();
      el.innerHTML =
        '<span class="t">' + pad(t.getHours()) + ":" + pad(t.getMinutes()) + ":" + pad(t.getSeconds()) + "</span>" +
        '<span class="tag">' + tag + "</span>" +
        '<span class="msg">' + msg + "</span>";
      stream.appendChild(el);
      while (stream.children.length > 9) stream.removeChild(stream.firstElementChild);
    }

    function ip() {
      return [int(2, 220), int(0, 255), int(0, 255), int(2, 250)].join(".");
    }

    function newProxy() {
      var p = "http://" + ip() + ":" + int(8000, 8999);
      if (heroProxy) heroProxy.textContent = ip().slice(0, 9) + "…";
      return p;
    }

    function tick() {
      if (document.hidden) return;

      done += 1;
      var mode = int(0, 2);
      var modeName = ["Direct", "Google", "Proxy"][mode];
      if (heroMode) heroMode.textContent = modeName;

      var p = newProxy();
      line("sys", "proxy", p + " · session " + done);

      var set = steps[modeName];
      var pick = set[int(0, set.length - 1)];
      var failed = Math.random() < 0.07;

      if (failed) {
        fails += 1;
        line("warn", "fail", ["proxy timeout", "navigation error", "element not found", "serp blocked"][int(0, 3)]);
      } else {
        ok += 1;
        line(pick[0], pick[0] === "ok" ? "ok" : pick[0], pick[1]);
        if (Math.random() > 0.72) {
          line("sys", "engage", Math.random() > 0.5 ? "comment posted" : "like registered");
        }
      }

      if (heroSession) heroSession.textContent = done + "/" + TOTAL;
      var secs = Math.round((Date.now() - started) / 1000);
      if (heroFoot) {
        heroFoot.textContent =
          ok + " ok · " + fails + " failed · " + Math.floor(secs / 60) + "m" + pad(secs % 60) + "s";
      }

      if (done >= TOTAL) {
        line("info", "done", "run completed · " + Math.round((ok / done) * 100) + "% success");
        line("ok", "telegram", "report delivered");
        done = 0; ok = 0; fails = 0;
        started = Date.now();
      }
    }

    if (reduced) {
      line("sys", "proxy", "http://91.204.18.7:8123 · session 1");
      line("info", "serp", "serp loaded · 10 results");
      line("ok", "ok", "target found · position 3");
      line("ok", "ok", "result clicked");
      line("sys", "dwell", "dwell 3.1s");
    } else {
      setTimeout(function () {
        line("sys", "boot", "traffic-bot v1.0.0 · proxy pool 8 nodes");
        line("info", "mode", "Google · 25 sessions queued");
        tick();
        setInterval(tick, 1700);
      }, 600);
    }
  }

  /* ---------------------------------------------------------
     8. Session timeline — plays while in view
     --------------------------------------------------------- */
  var timeline = $("#timeline");
  if (timeline) {
    var stages = $$(".stage", timeline);
    var playTimer = null;

    function resetStages() {
      stages.forEach(function (s) { s.classList.remove("is-on", "is-done"); });
    }

    function play() {
      resetStages();
      stages.forEach(function (s, i) {
        setTimeout(function () {
          stages.forEach(function (x, j) {
            x.classList.toggle("is-on", j === i);
            if (j < i) x.classList.add("is-done");
          });
          if (i === stages.length - 1) {
            setTimeout(function () {
              stages.forEach(function (x) { x.classList.remove("is-on"); x.classList.add("is-done"); });
              playTimer = setTimeout(play, 2200);
            }, 900);
          }
        }, i * 780);
      });
    }

    if (!reduced && "IntersectionObserver" in window) {
      var tl = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            if (!playTimer) play();
          } else {
            clearTimeout(playTimer);
            playTimer = null;
            resetStages();
          }
        });
      }, { threshold: 0.35 });
      tl.observe(timeline);
    } else {
      stages.forEach(function (x) { x.classList.add("is-done"); });
    }
  }

  /* ---------------------------------------------------------
     9. Live lab simulator
     --------------------------------------------------------- */
  var sim = $("#sim");
  if (sim) {
    var el = {
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
      runLabel: $("#simRunLabel"),
      count: $("#cCount"),
      pool: $("#cPool"),
      pause: $("#cPause"),
      mode: $("#cMode"),
      oCount: $("#oCount"),
      oPool: $("#oPool"),
      oPause: $("#oPause")
    };

    var W = 600, H = 158, MAX = 60;
    var points = [], timer = null, running = false, elapsed = 0, st = {};

    function fill(range) {
      var pct = ((+range.value - +range.min) / (+range.max - +range.min)) * 100;
      range.style.setProperty("--fill", pct + "%");
    }

    function sync() {
      el.oCount.textContent = el.count.value;
      el.oPool.textContent = el.pool.value;
      el.oPause.textContent = el.pause.value + "s";
      [el.count, el.pool, el.pause].forEach(fill);
    }

    [el.count, el.pool, el.pause].forEach(function (r) {
      r.addEventListener("input", function () {
        sync();
        if (!running) draw();
      });
    });

    function log(msg, cls) {
      var d = document.createElement("div");
      d.className = cls || "sys-t";
      d.textContent = "[" + pad(Math.floor(elapsed / 60)) + ":" + pad(elapsed % 60) + "] " + msg;
      el.log.appendChild(d);
      while (el.log.children.length > 6) el.log.removeChild(el.log.firstElementChild);
    }

    function draw() {
      if (!points.length) {
        el.line.setAttribute("d", "");
        el.area.setAttribute("d", "");
        return;
      }
      var stepX = W / Math.max(MAX - 1, 1);
      var maxY = Math.max(6, st.total || 6);
      var co = points.map(function (v, i) {
        return [i * stepX, H - 8 - (v / maxY) * (H - 24)];
      });
      var d = "";
      co.forEach(function (c, i) {
        if (!i) { d += "M" + c[0].toFixed(1) + " " + c[1].toFixed(1); return; }
        var p = co[i - 1], cx = (p[0] + c[0]) / 2;
        d += " C" + cx.toFixed(1) + " " + p[1].toFixed(1) + " " + cx.toFixed(1) + " " + c[1].toFixed(1) + " " + c[0].toFixed(1) + " " + c[1].toFixed(1);
      });
      el.line.setAttribute("d", d);
      var last = co[co.length - 1];
      el.area.setAttribute("d", d + " L" + last[0].toFixed(1) + " " + H + " L0 " + H + " Z");
    }

    function reset() {
      clearInterval(timer);
      timer = null;
      running = false;
      elapsed = 0;
      points = [];
      el.clock.textContent = "00:00";
      el.session.textContent = "0/0";
      el.success.textContent = "0";
      el.failed.textContent = "0";
      el.proxy.textContent = "—";
      el.log.innerHTML = "";
      el.runLabel.textContent = "Start simulation";
      sim.classList.remove("is-running", "is-done");
      draw();
    }

    function start() {
      reset();
      var count = +el.count.value;
      var pool = +el.pool.value;
      var pause = +el.pause.value;
      var mode = el.mode.value;

      st = { total: count, pool: pool, done: 0, ok: 0, fail: 0, idx: 0 };

      running = true;
      sim.classList.add("is-running");
      el.session.textContent = "0/" + count;
      el.runLabel.textContent = "Stop run";
      el.state.textContent = "Running — " + mode;
      log("run started · mode=" + mode + " sessions=" + count + " pool=" + pool, "info-t");

      timer = setInterval(function () {
        elapsed += 1;
        st.done += 1;
        st.idx = (st.idx + 1) % st.pool;

        var failed = Math.random() < 0.03 + Math.min(0.2, (st.done / st.total) * 0.05);

        if (failed) {
          st.fail += 1;
          log("session " + st.done + " failed · " + ["proxy timeout", "navigation error", "element not found", "session aborted"][int(0, 3)], "warn-t");
        } else {
          st.ok += 1;
          var act = mode === "Direct"
            ? ["landed", "scrolled", "dwell 3.2s"][int(0, 2)]
            : ["serp loaded", "result clicked", "scrolled 2×"][int(0, 2)];
          log("session " + st.done + " ok · " + act, "ok-t");
        }

        if (st.done % 3 === 0) log("proxy rotated · node " + (st.idx + 1) + "/" + st.pool, "sys-t");

        points.push(st.ok);
        if (points.length > MAX) points.shift();
        draw();

        el.session.textContent = st.done + "/" + st.total;
        el.success.textContent = st.ok;
        el.failed.textContent = st.fail;
        el.proxy.textContent = st.idx + 1 + "/" + st.pool;

        if (st.done >= st.total) finish();
      }, 260);
    }

    function finish() {
      clearInterval(timer);
      timer = null;
      running = false;
      sim.classList.remove("is-running");
      sim.classList.add("is-done");
      var rate = st.done ? Math.round((st.ok / st.done) * 100) : 0;
      el.state.textContent = "Done — " + rate + "% success";
      el.runLabel.textContent = "Run again";
      log("run completed · " + st.ok + " ok / " + st.fail + " failed", "info-t");
      log("telegram report sent", "ok-t");
    }

    el.run.addEventListener("click", function () {
      if (!running) { start(); return; }
      clearInterval(timer);
      timer = null;
      running = false;
      sim.classList.remove("is-running");
      el.state.textContent = "Stopped at " + st.done + "/" + st.total;
      el.runLabel.textContent = "Run again";
      log("run stopped by user", "warn-t");
    });

    setInterval(function () {
      if (running) el.clock.textContent = pad(Math.floor(elapsed / 60)) + ":" + pad(elapsed % 60);
    }, 250);

    sync();
    reset();
  }

  /* ---------------------------------------------------------
     10. GitHub stars (cached 1h, fail-silent)
     --------------------------------------------------------- */
  (function stars() {
    var nodes = $$("[data-stars]");
    if (!nodes.length) return;
    var KEY = "tb:stars";
    var paint = function (n) {
      nodes.forEach(function (x) { x.textContent = "★ " + n.toLocaleString(); });
    };
    try {
      var c = JSON.parse(localStorage.getItem(KEY) || "null");
      if (c && Date.now() - c.t < 36e5) { paint(c.n); return; }
    } catch (e) {}
    fetch("https://api.github.com/repos/zougar99/traffic-bot", { headers: { Accept: "application/vnd.github+json" } })
      .then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
      .then(function (d) {
        var n = d.stargazers_count || 0;
        paint(n);
        try { localStorage.setItem(KEY, JSON.stringify({ t: Date.now(), n: n })); } catch (e) {}
      })
      .catch(function () { nodes.forEach(function (x) { x.textContent = "★ —"; }); });
  })();

  /* ---------------------------------------------------------
     11. Misc
     --------------------------------------------------------- */
  var year = $("#year");
  if (year) year.textContent = "© " + new Date().getFullYear() + " Traffic Bot";

  /* keep the theme in sync if the OS preference changes and nothing was chosen */
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", function (e) {
      var stored = null;
      try { stored = localStorage.getItem("tb:theme"); } catch (err) {}
      if (!stored) setTheme(e.matches ? "light" : "dark");
    });
  }
})();
