// Shared effect layer for both mockups. Colours come from CSS vars --fx (accent) and --fx2 (alert).
(() => {
  const css = getComputedStyle(document.documentElement);
  const FX = css.getPropertyValue("--fx").trim() || "#ffb020";
  const FX2 = css.getPropertyValue("--fx2").trim() || "#ff4d3d";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = matchMedia("(pointer: fine)").matches;

  // Split-flap: [data-flap] flips through a drum to its text.
  const DRUM = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:·%-+./,−";
  document.querySelectorAll("[data-flap]").forEach((el, n) => {
    const target = el.textContent.toUpperCase();
    el.textContent = "";
    el.classList.add("flap");
    const cells = [...target].map(() => { const c = document.createElement("span"); c.textContent = " "; el.append(c); return c; });
    let f = 0;
    const tick = () => {
      f++;
      let done = true;
      cells.forEach((c, i) => {
        const want = target[i];
        if (c.textContent === want || f < i * 1.5 + n * 2) { if (c.textContent !== want) done = false; return; }
        const a = DRUM.indexOf(c.textContent), b = DRUM.indexOf(want);
        if (a < 0 || b < 0) { c.textContent = want; return; }
        const d = (b - a + DRUM.length) % DRUM.length;
        c.textContent = DRUM[(a + Math.min(2, d)) % DRUM.length];
        c.style.animation = "none"; void c.offsetWidth; c.style.animation = "";
        if (d > 2) done = false;
      });
      if (!done && f < 120) setTimeout(tick, 40);
    };
    reduce ? cells.forEach((c, i) => (c.textContent = target[i])) : setTimeout(tick, 300);
  });

  // Tech text: letters near the pointer turn to outline.
  document.querySelectorAll("[data-tech]").forEach((el) => {
    const t = el.textContent; el.textContent = "";
    const spans = [...t].map((ch) => { const s = document.createElement("span"); s.textContent = ch === " " ? " " : ch; el.append(s); return s; });
    el.addEventListener("pointermove", (e) => spans.forEach((s) => {
      const r = s.getBoundingClientRect(); s.classList.toggle("wire", Math.abs(e.clientX - (r.left + r.width / 2)) < 22);
    }));
    el.addEventListener("pointerleave", () => spans.forEach((s) => s.classList.remove("wire")));
  });

  // Glow border: .gb panels light their edge toward the pointer.
  const gb = [...document.querySelectorAll(".gb")];
  addEventListener("pointermove", (e) => gb.forEach((el) => {
    const r = el.getBoundingClientRect();
    const dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right), dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
    el.style.setProperty("--gx", e.clientX - r.left + "px"); el.style.setProperty("--gy", e.clientY - r.top + "px");
    el.style.setProperty("--ga", Math.max(0, 1 - Math.hypot(dx, dy) / 160).toFixed(2));
  }), { passive: true });

  // Cursor grid + swarm + glow over [data-field] (the map).
  const host = document.querySelector("[data-field]");
  if (host && fine && !reduce) {
    const cv = document.createElement("canvas"); cv.className = "field"; host.append(cv);
    const g = cv.getContext("2d"); const dpr = Math.min(devicePixelRatio, 1.5);
    let W = 0, H = 0, mx = -999, my = -999, idle = 0;
    const fit = () => { W = host.clientWidth; H = host.clientHeight; cv.width = W * dpr; cv.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0); };
    fit(); addEventListener("resize", fit);
    const cells = new Map(); const C = 28;
    const P = Array.from({ length: 48 }, (_, i) => ({ a: (i / 48) * 6.283, r: 14 + (i % 6) * 6, s: 0.6 + (i % 5) * 0.25, x: 0, y: 0 }));
    host.addEventListener("pointermove", (e) => { const r = host.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; idle = 0; cells.set(`${Math.floor(mx / C)},${Math.floor(my / C)}`, 1); });
    host.addEventListener("pointerleave", () => { mx = my = -999; });
    const loop = () => {
      g.clearRect(0, 0, W, H); idle++;
      if (mx > -999) { const gr = g.createRadialGradient(mx, my, 0, mx, my, 130); gr.addColorStop(0, FX + "22"); gr.addColorStop(1, FX + "00"); g.fillStyle = gr; g.fillRect(mx - 130, my - 130, 260, 260); }
      g.strokeStyle = FX;
      for (const [k, v] of cells) { const [cx, cy] = k.split(",").map(Number); g.globalAlpha = v * 0.5; g.strokeRect(cx * C + 0.5, cy * C + 0.5, C - 1, C - 1); const nv = v - 0.02; nv <= 0 ? cells.delete(k) : cells.set(k, nv); }
      g.globalAlpha = 1; g.fillStyle = FX;
      if (mx > -999) for (const p of P) { p.a += 0.02 * p.s; const tx = mx + Math.cos(p.a) * p.r, ty = my + Math.sin(p.a * 1.3) * p.r; p.x += (tx - p.x) * 0.12; p.y += (ty - p.y) * 0.12; g.globalAlpha = 0.7; g.fillRect(p.x, p.y, 2, 2); }
      g.globalAlpha = 1;
      requestAnimationFrame(loop);
    };
    loop();
  }

  // Letter glitch: [data-glitch] canvas strip of shifting glyphs, a few in the alert colour.
  document.querySelectorAll("[data-glitch]").forEach((cv) => {
    const g = cv.getContext("2d"); const S = 14; const chars = "ABCDEF0123456789#%/<>[]=+*";
    const fit = () => { cv.width = cv.clientWidth; cv.height = cv.clientHeight; }; fit();
    const draw = () => {
      g.font = "11px JetBrains Mono, IBM Plex Mono, monospace";
      for (let k = 0; k < 40; k++) {
        const x = Math.floor(Math.random() * (cv.width / S)) * S, y = Math.floor(Math.random() * (cv.height / S)) * S;
        g.clearRect(x, y, S, S); g.fillStyle = Math.random() < 0.05 ? FX2 : css.getPropertyValue("--glyph").trim() || "#ffffff22";
        g.fillText(chars[Math.floor(Math.random() * chars.length)], x + 2, y + 11);
      }
      if (!reduce) setTimeout(draw, 70);
    };
    draw();
  });

  // Branched menu: trace line from trunk to the chosen branch.
  document.querySelectorAll(".branch").forEach((menu) => {
    const items = [...menu.querySelectorAll("button")];
    const trace = menu.querySelector(".trace");
    const pick = (b) => { items.forEach((x) => x.classList.toggle("on", x === b)); trace.style.height = b.offsetTop + b.offsetHeight / 2 + "px"; trace.style.setProperty("--w", "14px"); };
    items.forEach((b) => b.addEventListener("click", () => pick(b))); pick(items[0]);
  });

  // Folder float: click a folder, its files fan out.
  document.querySelectorAll(".folder").forEach((f) => f.querySelector(".fhead").addEventListener("click", () => f.classList.toggle("open")));

  // Infinite spiral: [data-spiral] 24 hourly plates on a turning helix.
  document.querySelectorAll("[data-spiral]").forEach((st) => {
    const H = 24; let wind = 18; const plates = [];
    for (let h = 0; h < H; h++) {
      const v = 0.25 + 0.6 * Math.exp(-((h - 9.5) ** 2) / 3) + 0.7 * Math.exp(-((h - 18.5) ** 2) / 4);
      const b = document.createElement("button"); b.className = "plate";
      b.innerHTML = `<span>${String(h).padStart(2, "0")}:00</span><i style="--v:${Math.min(1, v)};--c:${v > 0.8 ? FX2 : v > 0.6 ? FX : "#8a909766"}"></i><span>${Math.round(v * 9)}</span>`;
      st.append(b); plates.push(b);
    }
    const lay = () => plates.forEach((p, i) => {
      const pos = ((((i - wind) % H) + H + H / 2) % H) - H / 2; const ang = pos * 22; const dep = Math.cos((ang * Math.PI) / 180);
      p.style.transform = `translate(-50%,-50%) translateY(${pos * 22}px) rotateY(${ang}deg) translateZ(110px)`;
      p.style.opacity = Math.max(0, (1.1 - Math.abs(pos) / 7) * (0.3 + 0.7 * Math.max(0, dep))); p.style.zIndex = Math.round(dep * 100);
    });
    st.addEventListener("wheel", (e) => { e.preventDefault(); wind += e.deltaY / 120; lay(); }, { passive: false });
    lay(); if (!reduce) setInterval(() => { wind += 0.01; lay(); }, 50);
  });
})();
