/* 破天宗 · 宗门场景渲染层
 * Canvas 2D 水墨剖面：山体十层 + 山脚破天城，建筑为可点击主体。
 * 静态部分预渲染到离屏画布，逐帧只画云、雾、人物与光晕，
 * 因此低端设备也能维持 30 帧以上；画质四档可按设备能力探测降级。
 */
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* 建筑表：layer 0 为山脚，1-10 为山体十层 */
export const BUILDINGS = [
  { key: 'gate', name: '山门', panel: 'tasks', type: 'gate', layer: 0, u: -1.02, w: 124, h: 66 },
  { key: 'city', name: '破天城', panel: 'world', type: 'city', layer: 0, u: 1.04, w: 146, h: 76 },
  { key: 'pavilion', name: '破天阁', panel: 'autonomy', type: 'pavilion', layer: 1, u: 0.56, w: 62, h: 48 },
  { key: 'hut', name: '庐舍', panel: 'disciples', type: 'hut', layer: 1, u: -0.36, w: 70, h: 44 },
  { key: 'field', name: '灵田', panel: 'workshop', type: 'field', layer: 2, u: 0.0, w: 126, h: 34 },
  { key: 'workshop', name: '工坊', panel: 'workshop', type: 'workshop', layer: 3, u: -0.3, w: 80, h: 48 },
  { key: 'arena', name: '演武场', panel: 'battle', type: 'arena', layer: 4, u: 0.22, w: 98, h: 38 },
  { key: 'library', name: '藏经阁', panel: 'disciples', type: 'library', layer: 5, u: -0.18, w: 64, h: 64 },
  { key: 'dorm', name: '弟子居', panel: 'disciples', type: 'dorm', layer: 6, u: 0.26, w: 100, h: 44 },
  { key: 'hall', name: '护法堂', panel: 'org', type: 'hall', layer: 7, u: -0.24, w: 90, h: 52 },
  { key: 'council', name: '长老会', panel: 'org', type: 'hall', layer: 8, u: 0.18, w: 94, h: 56 },
  { key: 'temple', name: '祖师殿', panel: 'temple', type: 'temple', layer: 9, u: -0.02, w: 108, h: 68 },
  { key: 'altar', name: '问天台', panel: 'chronicle', type: 'altar', layer: 10, u: 0, w: 86, h: 48 },
];

const QUALITY = [
  { name: '极简', dpr: 1, clouds: 0, mist: 1, figures: 12, smoke: false, glow: false, birds: 0, detail: false },
  { name: '流畅', dpr: 1, clouds: 2, mist: 2, figures: 20, smoke: false, glow: true, birds: 2, detail: false },
  { name: '标准', dpr: 1.5, clouds: 3, mist: 3, figures: 30, smoke: true, glow: true, birds: 3, detail: true },
  { name: '精细', dpr: 2, clouds: 5, mist: 4, figures: 42, smoke: true, glow: true, birds: 4, detail: true },
];

const C = {
  ink: '#2f2a24', ink2: '#4a4238', line: 'rgba(78,66,50,.55)',
  rockTop: '#efe4ce', rockMid: '#ddcfb4', rockLow: '#c4b092', rockDark: '#a8927a',
  paper: '#f4ecdd', mist: '246,239,227',
  roof: '#3b342c', roof2: '#5a5145', wall: '#f2e7d2', column: '#8f3a2e',
  jade: '#47695a', gold: '#a8863f', seal: '#9d2b22',
};

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export class Scene {
  constructor({ canvas, overlay, onOpen, onSelect }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.overlay = overlay;
    this.onOpen = onOpen || (() => {});
    this.onSelect = onSelect || (() => {});
    this.model = { layers: 1, badges: {}, floaters: {}, figures: [], day: 0 };
    this.q = 2;
    this.motion = true;
    this.selected = null;
    this.hovered = null;
    this.t = 0;
    this.hotspots = {};
    this._bg = null;
    /* 云雾单独一层离屏：每帧重建渐变最费，而云雾分不出 20 帧与 30 帧 */
    this._mid = null;
    this._midT = -1;
    this._raf = 0;
    this._frames = 0;
    this._fpsAcc = 0;
    this._lowCount = 0;
    this.onDowngrade = null;
    this._bound = false;
    this._dirty = true;
    this.paused = false;
    this._drawAt = 0;
  }

  mount() {
    if (this._bound) return;
    this._bound = true;
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(this.canvas.parentElement);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { cancelAnimationFrame(this._raf); this._raf = 0; }
      else if (!this.paused) { this._drawAt = 0; this.play(); }
    });
    this.resize();
    this.buildOverlay();
    this.positionHotspots();
    this.play();
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    if (this._ro) this._ro.disconnect();
  }

  setQuality(q, motion) {
    this.q = clamp(Number(q) || 0, 0, 3);
    this.motion = motion !== false;
    this.resize();
    this.play();
  }

  setModel(model) {
    const prev = this.model;
    this.model = Object.assign({}, prev, model || {});
    if (prev.layers !== this.model.layers) { this._bg = null; this._mid = null; }
    this.updateBadges();
    this._dirty = true;
    if (!this.motion) this.frame(0, true);
  }

  /* ---------- 尺寸与布局 ---------- */
  resize() {
    const host = this.canvas.parentElement;
    if (!host) return;
    const w = host.clientWidth || 800;
    const h = host.clientHeight || 600;
    const dpr = Math.min(window.devicePixelRatio || 1, QUALITY[this.q].dpr);
    this.W = w; this.H = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.layout();
    this._bg = null;
    this._mid = null;
    this.positionHotspots();
    if (!this.motion) this.frame(0, true);
  }

  layout() {
    const W = this.W, H = this.H;
    const mobile = W < 760;
    const cx = W * (mobile ? 0.5 : 0.44);
    const baseY = H * (mobile ? 0.9 : 0.895);
    const peakY = H * (mobile ? 0.09 : 0.1);
    const span = baseY - peakY;
    const step = span / 10;
    const baseHalf = Math.min(W * (mobile ? 0.44 : 0.315), 430);
    /* 山体不做等比例收分：左缓右陡，中途有肩，才像山而非台 */
    const taperL = [1, 0.895, 0.807, 0.727, 0.651, 0.582, 0.513, 0.454, 0.39, 0.329];
    const taperR = [0.985, 0.88, 0.795, 0.716, 0.641, 0.573, 0.505, 0.447, 0.384, 0.324];
    /* 层高不等：近处厚、远处薄，再叠随机起伏，破掉等距横条 */
    const hFrac = [0.115, 0.108, 0.1, 0.102, 0.096, 0.099, 0.094, 0.098, 0.096, 0.092];
    const hSum = hFrac.reduce((a, b) => a + b, 0);
    const rand = rng(20261109);
    const levels = [];
    let ly = baseY;
    for (let i = 0; i < 10; i++) {
      const jl = 1 + (rand() - 0.5) * 0.045;
      const jr = 1 + (rand() - 0.5) * 0.055;
      levels.push({
        i: i + 1,
        y: ly,
        step: (hFrac[i] / hSum) * span,
        hl: baseHalf * taperL[i] * jl,
        hr: baseHalf * taperR[i] * jr,
        trees: [],
      });
      ly -= (hFrac[i] / hSum) * span;
    }
    /* 每层固定的松树位置（只生成一次，避免逐帧抖动） */
    for (const lv of levels) {
      const n = 2 + Math.floor(rand() * 3);
      for (let k = 0; k < n; k++) {
        const side = rand() > 0.5 ? 1 : -1;
        lv.trees.push({ p: side * (0.55 + rand() * 0.4), s: 0.7 + rand() * 0.6 });
      }
    }
    this.L = { cx, baseY, peakY, step, baseHalf, levels, mobile };
    this.pos = {};
    const groundHalf = mobile ? baseHalf * 0.82 : baseHalf;
    for (const b of BUILDINGS) {
      const lv = b.layer ? levels[b.layer - 1] : null;
      const half = lv ? (b.u < 0 ? lv.hl : lv.hr) : groundHalf;
      const sc = clamp((lv ? Math.min(lv.hl, lv.hr) : baseHalf) / 250, 0.6, 1.18);
      const w = b.w * sc * 1.34;
      const h = b.h * sc * 1.34;
      let x = cx + b.u * half;
      /* 山脚建筑贴边时要收进来，竖屏也不出画 */
      if (!b.layer) {
        const m = w / 2 + 6;
        x = clamp(x, m, Math.max(m, this.W - m));
      }
      const y = b.layer ? lv.y - 4 : baseY + step * 0.46;
      this.pos[b.key] = { x, y, w, h, sc, b, layer: b.layer };
    }
  }

  /* ---------- 热区（DOM，可聚焦、可读屏） ---------- */
  buildOverlay() {
    if (this._overlayBuilt) return;
    this._overlayBuilt = true;
    const frag = document.createDocumentFragment();
    for (const b of BUILDINGS) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'hs';
      el.dataset.key = b.key;
      el.setAttribute('aria-label', b.name);
      el.innerHTML = `<span class="hs-name">${b.name}</span><span class="hs-note">再点一次进入</span>`;
      el.addEventListener('click', (e) => { e.stopPropagation(); this.pick(b.key); });
      el.addEventListener('pointerenter', () => { this.hovered = b.key; this.refreshHover(); });
      el.addEventListener('pointerleave', () => { if (this.hovered === b.key) { this.hovered = null; this.refreshHover(); } });
      frag.appendChild(el);
      this.hotspots[b.key] = el;
    }
    for (const k of ['field', 'workshop']) {
      const f = document.createElement('div');
      f.className = 'floater';
      f.dataset.fk = k;
      frag.appendChild(f);
      this.hotspots['f_' + k] = f;
    }
    this.overlay.appendChild(frag);
  }

  positionHotspots() {
    if (!this.hotspots || !this.pos) return;
    for (const b of BUILDINGS) {
      const p = this.pos[b.key];
      const el = this.hotspots[b.key];
      if (p && el) {
        el.style.transform = `translate3d(${Math.round(p.x - Math.max(p.w, 34) / 2)}px, ${Math.round(p.y - p.h)}px, 0)`;
        el.style.width = Math.round(Math.max(p.w, 34)) + 'px';
        el.style.height = Math.round(Math.max(p.h, 26)) + 'px';
      }
    }
    for (const k of ['field', 'workshop']) {
      const p = this.pos[k];
      const el = this.hotspots['f_' + k];
      if (p && el) {
        el.style.transform = `translate3d(${Math.round(p.x - p.w / 2)}px, ${Math.round(p.y - p.h - 22)}px, 0)`;
      }
    }
  }

  locked(key) {
    const b = BUILDINGS.find((x) => x.key === key);
    return !!b && b.layer > 0 && b.layer > (this.model.layers || 1);
  }

  updateBadges() {
    const badges = this.model.badges || {};
    for (const b of BUILDINGS) {
      const el = this.hotspots[b.key];
      if (!el) continue;
      const bd = badges[b.key];
      const locked = b.layer > 0 && b.layer > (this.model.layers || 1);
      el.classList.toggle('is-locked', locked);
      el.style.display = locked ? 'none' : '';
      el.tabIndex = locked ? -1 : 0;
      if (locked) el.setAttribute('aria-hidden', 'true');
      else el.removeAttribute('aria-hidden');
      el.classList.toggle('lv1', !!bd && bd.level === 1);
      el.classList.toggle('lv2', !!bd && bd.level === 2);
      el.classList.toggle('lv3', !!bd && bd.level === 3);
      let dot = el.querySelector('.hs-dot');
      if (bd) {
        if (!dot) { dot = document.createElement('span'); dot.className = 'hs-dot'; el.appendChild(dot); }
        dot.textContent = bd.count > 1 ? bd.count : '';
      } else if (dot) dot.remove();
    }
    const fl = this.model.floaters || {};
    for (const k of ['field', 'workshop']) {
      const el = this.hotspots['f_' + k];
      if (!el) continue;
      const f = fl[k];
      const locked = (k === 'field' ? 2 : 3) > (this.model.layers || 1);
      el.classList.toggle('is-off', locked || !f);
      el.innerHTML = f ? `<b>${f.k}</b><span>${f.v}</span><em>日</em>` : '';
    }
    this.refreshHover();
  }

  refreshHover() {
    for (const k of Object.keys(this.hotspots)) {
      const el = this.hotspots[k];
      if (!el || !el.classList.contains('hs')) continue;
      el.classList.toggle('is-hover', this.hovered === k || this.selected === k);
      el.classList.toggle('is-sel', this.selected === k);
    }
    this._dirty = true;
    if (!this.motion) this.frame(0, true);
  }

  pick(key) {
    if (this.selected === key) {
      this.selected = null;
      this.refreshHover();
      this.onOpen(key);
      return;
    }
    this.selected = key;
    this.onSelect && this.onSelect(key);
    this.refreshHover();
  }

  clearSelection() {
    if (!this.selected) return;
    this.selected = null;
    this.refreshHover();
  }

  /* ---------- 循环 ---------- */
  play() {
    cancelAnimationFrame(this._raf);
    this._raf = 0;
    if (!this.motion) { this.frame(0, true); return; }
    if (this.paused || document.hidden) return;
    const step = (ts) => {
      this._raf = requestAnimationFrame(step);
      if (this.paused || document.hidden) return;
      /* 限帧：场景是静态水墨底 + 几处缓动。
         有飘字、有选中、有悬停时 30 帧；什么都没动就降到 20 帧 —— 省电也省合成。 */
      const busy = this.selected || this.hovered
        || (this.model && this.model.floaters && Object.keys(this.model.floaters).length > 0);
      const gap = ts - (this._drawAt || 0);
      if (gap < 1000 / (busy ? 30 : 20)) return;
      const dt = Math.min(96, gap);
      this._drawAt = ts;
      this.frame(dt / 1000, false);
      this.monitor(dt);
    };
    this._raf = requestAnimationFrame(step);
  }

  /* 抽屉打开、切到祖师殿、页面隐藏时停掉绘制 */
  pause() {
    if (this.paused) return;
    this.paused = true;
    cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this._drawAt = 0;
    this._last = 0;
    this.play();
  }

  monitor(dt) {
    this._frames++;
    this._fpsAcc += dt;
    if (this._fpsAcc < 1500) return;
    const fps = this._frames / this._fpsAcc * 1000;
    this._frames = 0; this._fpsAcc = 0;
    if (fps < 26 && this.q > 0) {
      this._lowCount++;
      if (this._lowCount >= 2) {
        this._lowCount = 0;
        this.setQuality(this.q - 1, this.motion);
        this.onDowngrade && this.onDowngrade(this.q);
      }
    } else if (fps > 45) this._lowCount = 0;
  }

  frame(dt, force) {
    if (!this.W) return;
    if (!this.motion && !force && !this._dirty) return;
    this._dirty = false;
    this.t += dt;
    if (!this._bg) this.renderBackdrop();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.drawImage(this._bg, 0, 0, this.W, this.H);
    /* 云雾层：20 帧重画一次就够，中间帧直接贴图，省掉一半路径与渐变 */
    if (!this._mid) {
      const mc = document.createElement('canvas');
      mc.width = Math.round(this.W * this.dpr);
      mc.height = Math.round(this.H * this.dpr);
      mc.getContext('2d').setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this._mid = mc;
      this._midT = -1;
    }
    if (!this.motion || this.t - this._midT > 0.05) {
      const mg = this._mid.getContext('2d');
      mg.clearRect(0, 0, this.W, this.H);
      this.drawClouds(mg);
      this.drawMist(mg);
      this._midT = this.t;
    }
    ctx.drawImage(this._mid, 0, 0, this.W, this.H);
    this.drawFigures(ctx);
    this.drawGlow(ctx);
    this.drawSelection(ctx);
  }

  /* ---------- 背景（缓存） ---------- */
  renderBackdrop() {
    const c = document.createElement('canvas');
    c.width = Math.round(this.W * this.dpr);
    c.height = Math.round(this.H * this.dpr);
    const g = c.getContext('2d');
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.paintSky(g);
    this.paintFarPeaks(g);
    this.paintMountain(g);
    this.paintFoot(g);
    for (const b of BUILDINGS) {
      if (!b.layer || b.layer <= (this.model ? (this.model.layers || 1) : 1)) this.paintBuilding(g, b);
    }
    this.paintFog(g);
    this._bg = c;
  }

  paintSky(g) {
    const { W, H } = this;
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#f9f4e9');
    sky.addColorStop(0.42, '#f4ecda');
    sky.addColorStop(1, '#e7d9bf');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);

    const mx = W * 0.83, my = H * 0.15, mr = Math.max(18, Math.min(W, H) * 0.042);
    const halo = g.createRadialGradient(mx, my, mr * 0.3, mx, my, mr * 4.2);
    halo.addColorStop(0, 'rgba(255,252,242,.95)');
    halo.addColorStop(0.35, 'rgba(255,250,236,.45)');
    halo.addColorStop(1, 'rgba(255,250,236,0)');
    g.fillStyle = halo;
    g.beginPath(); g.arc(mx, my, mr * 4.2, 0, TAU); g.fill();
    const disc = g.createRadialGradient(mx, my, mr * 0.2, mx, my, mr);
    disc.addColorStop(0, 'rgba(255,252,244,.92)');
    disc.addColorStop(0.72, 'rgba(253,246,232,.62)');
    disc.addColorStop(1, 'rgba(251,242,226,0)');
    g.fillStyle = disc;
    g.beginPath(); g.arc(mx, my, mr, 0, TAU); g.fill();
  }

  paintFarPeaks(g) {
    const { W, H } = this;
    const rand = rng(1337);
    const specs = [
      { y: H * 0.58, amp: H * 0.19, alpha: 0.09, n: 4 },
      { y: H * 0.66, amp: H * 0.14, alpha: 0.14, n: 5 },
      { y: H * 0.74, amp: H * 0.1, alpha: 0.2, n: 6 },
    ];
    for (const s of specs) {
      g.beginPath();
      g.moveTo(-30, H);
      g.lineTo(-30, s.y);
      let x = -30;
      const seg = (W + 80) / s.n;
      while (x < W + 60) {
        const peakX = x + seg * (0.34 + rand() * 0.32);
        const peakY = s.y - s.amp * (0.45 + rand() * 0.75);
        g.quadraticCurveTo(x + seg * 0.18, peakY + s.amp * 0.2, peakX, peakY);
        const nx = peakX + seg * (0.28 + rand() * 0.24);
        g.quadraticCurveTo(nx - seg * 0.18, peakY + s.amp * 0.5, nx, s.y - s.amp * (0.05 + rand() * 0.15));
        x = nx;
      }
      g.lineTo(W + 60, H);
      g.closePath();
      g.fillStyle = `rgba(108,96,78,${s.alpha})`;
      g.fill();
    }
    /* 山脚远雾 */
    const fog = g.createLinearGradient(0, H * 0.52, 0, H * 0.82);
    fog.addColorStop(0, 'rgba(255,252,245,0)');
    fog.addColorStop(1, 'rgba(255,252,245,.55)');
    g.fillStyle = fog;
    g.fillRect(0, H * 0.52, W, H * 0.3);
  }

  /* 山体：整座岩山 + 十层凿入山腹的台地 */
  paintMountain(g) {
    const { L } = this;
    const rand = rng(90210);
    const lv = L.levels;
    const cx = L.cx;
    const step = L.step;
    const lift = 4;
    const half = L.baseHalf;

    /* 山体轮廓：连续收分的岩体，带起伏与石棱，不再是等距台阶 */
    const spanY = L.baseY + step * 0.55 - L.peakY;
    const mw = (t) => half * (1.18 - 0.74 * Math.pow(clamp(t, 0, 1), 0.85));
    const wob = (t) => Math.sin(t * 17.3) * 5.2 + Math.sin(t * 7.4 + 1.1) * 4.4 + Math.sin(t * 29.7) * 2.1;

    const left = [];
    const right = [];
    const N = 40;
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const y = L.baseY + step * 0.55 - t * spanY;
      const w = Math.max(26, mw(t) + wob(t));
      left.push([cx - w, y]);
      right.push([cx + w * 0.985 + Math.sin(t * 11.7) * 3, y]);
    }

    /* 峰顶：岩冠错落，主峰偏左 */
    const topY = L.peakY;
    const tw = 0.44 * half;
    const crest = [
      [cx - tw, topY + step * 0.12],
      [cx - tw * 0.82, topY - step * 0.1],
      [cx - tw * 0.66, topY + step * 0.02],
      [cx - tw * 0.48, topY - step * 0.26],
      [cx - tw * 0.26, topY - step * 0.14],
      [cx - tw * 0.05, topY - step * 0.42],
      [cx + tw * 0.16, topY - step * 0.2],
      [cx + tw * 0.36, topY - step * 0.3],
      [cx + tw * 0.58, topY - step * 0.06],
      [cx + tw * 0.8, topY - step * 0.2],
      [cx + tw, topY + step * 0.12],
    ];

    const outline = (ctx) => {
      ctx.beginPath();
      ctx.moveTo(left[0][0], left[0][1]);
      for (let k = 1; k < left.length; k++) ctx.lineTo(left[k][0], left[k][1]);
      for (const p of crest) ctx.lineTo(p[0], p[1]);
      for (let k = right.length - 1; k >= 0; k--) ctx.lineTo(right[k][0], right[k][1]);
      ctx.closePath();
    };

    g.save();
    outline(g);
    const mg = g.createLinearGradient(cx - half * 0.6, L.peakY, cx + half * 0.9, L.baseY + 20);
    mg.addColorStop(0, '#f0e6cf');
    mg.addColorStop(0.3, '#ddd0b4');
    mg.addColorStop(0.66, '#cdb997');
    mg.addColorStop(1, '#b9a07a');
    g.fillStyle = mg;
    g.fill();
    g.clip();

    /* 明暗：左上受光、右下背光，压出整座山的体积 */
    const shade = g.createLinearGradient(cx - half * 1.15, L.peakY, cx + half * 1.15, L.baseY);
    shade.addColorStop(0, 'rgba(255,250,236,.3)');
    shade.addColorStop(0.28, 'rgba(255,250,236,.05)');
    shade.addColorStop(0.62, 'rgba(74,58,40,.08)');
    shade.addColorStop(1, 'rgba(66,52,36,.26)');
    g.fillStyle = shade;
    g.fillRect(0, 0, this.W, this.H);
    const footShade = g.createLinearGradient(0, L.baseY - step * 3, 0, L.baseY + step);
    footShade.addColorStop(0, 'rgba(92,74,50,0)');
    footShade.addColorStop(1, 'rgba(86,68,44,.24)');
    g.fillStyle = footShade;
    g.fillRect(0, L.baseY - step * 3, this.W, step * 4.2);

    /* 竖向石棱：从顶到底通到山脚，是"岩壁"的关键 */
    for (let k = 0; k < 26; k++) {
      const t = rand();
      const y0 = L.baseY + step * 0.5 - t * spanY;
      const len = 40 + rand() * 150;
      const x = cx + (rand() - 0.5) * mw(t) * 2.1;
      const w = 5 + rand() * 16;
      const a = 0.03 + rand() * 0.05;
      const gr = g.createLinearGradient(x, y0, x, y0 - len);
      gr.addColorStop(0, `rgba(76,59,40,${a})`);
      gr.addColorStop(0.6, `rgba(76,59,40,${a * 0.5})`);
      gr.addColorStop(1, 'rgba(76,59,40,0)');
      g.strokeStyle = gr;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(x, y0);
      g.quadraticCurveTo(x + (rand() - 0.5) * 18, y0 - len * 0.5, x + (rand() - 0.5) * 26, y0 - len);
      g.stroke();
    }

    /* 披麻皴：顺坡而下的长笔，山才有骨 */
    for (let i = 0; i < 40; i++) {
      const t = 0.04 + rand() * 0.9;
      const w = mw(t);
      const x0 = cx + (rand() - 0.5) * w * 1.75;
      const y0 = L.baseY + step * 0.35 - t * spanY;
      const len = 50 + rand() * 130;
      const drift = (x0 < cx ? -1 : 1) * (6 + rand() * 22);
      g.strokeStyle = `rgba(88,70,50,${0.08 + rand() * 0.12})`;
      g.lineWidth = 1.2 + rand() * 1.8;
      g.beginPath();
      g.moveTo(x0, y0);
      g.bezierCurveTo(x0 + drift * 0.3, y0 + len * 0.32, x0 + drift * 0.8, y0 + len * 0.68, x0 + drift, y0 + len);
      g.stroke();
    }
    /* 皴笔 */
    g.strokeStyle = 'rgba(92,74,52,.16)';
    g.lineWidth = 1;
    for (let i = 0; i < 150; i++) {
      const t = rand();
      const w = mw(t);
      const x = cx + (rand() - 0.5) * w * 1.9;
      const y = L.baseY + step * 0.4 - t * spanY * 0.98;
      const len = 8 + rand() * 20;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + len * 0.4, y - len * 0.18, x + len * 0.78, y + len * 0.28);
      g.stroke();
    }
    /* 苔点 */
    for (let i = 0; i < 130; i++) {
      const t = rand();
      const w = mw(t);
      const x = cx + (rand() - 0.5) * w * 1.85;
      const y = L.baseY + step * 0.4 - t * spanY * 0.96;
      g.fillStyle = rand() > 0.55 ? 'rgba(62,92,72,.2)' : 'rgba(100,80,52,.17)';
      g.beginPath(); g.arc(x, y, 0.8 + rand() * 2, 0, TAU); g.fill();
    }
    /* 大块墨晕 */
    for (let i = 0; i < 12; i++) {
      const t = 0.1 + rand() * 0.85;
      const w = mw(t);
      const x = cx + (rand() - 0.5) * w * 1.7;
      const y = L.baseY + step * 0.3 - t * spanY;
      const r = 80 + rand() * 130;
      const a = 0.1 + rand() * 0.1;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(74,58,40,${a})`);
      gr.addColorStop(1, 'rgba(74,58,40,0)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
    g.restore();

    /* 轮廓墨线 */
    g.strokeStyle = 'rgba(70,56,38,.5)';
    g.lineWidth = 1.5;
    outline(g);
    g.stroke();
    g.save();
    g.translate(1.2, 0);
    g.strokeStyle = 'rgba(252,246,232,.24)';
    g.lineWidth = 1;
    outline(g);
    g.stroke();
    g.restore();

    /* 台地：只画已开辟的层。未开辟的山体只留形，不凿台，免得叠出一排白条 */
    const shown = Math.max(1, Math.min(10, this.model.layers || 1));
    for (let i = 0; i < shown; i++) {
      const l = lv[i];
      const yt = l.y - lift;
      const hw = 5 + (i % 4);
      const leftX = cx - l.hl;
      const rightX = cx + l.hr;
      const wide = rightX - leftX;

      const np = 6;
      const arc = -6 + rand() * 10;
      const edge = [];
      for (let k = 0; k <= np; k++) {
        const x = leftX + (wide * k) / np;
        const bow = Math.sin(Math.PI * (k / np)) * arc;
        const dy = k === 0 || k === np ? 0 : (rand() - 0.5) * 3;
        edge.push([x, yt - hw + bow + dy]);
      }

      /* 台面：靠两端淡出，像凿进岩体而不是架空一条板 */
      const top = g.createLinearGradient(leftX, 0, rightX, 0);
      top.addColorStop(0, 'rgba(186,166,134,0)');
      top.addColorStop(0.12, 'rgba(202,183,150,.72)');
      top.addColorStop(0.5, 'rgba(193,173,140,.78)');
      top.addColorStop(0.88, 'rgba(202,183,150,.72)');
      top.addColorStop(1, 'rgba(186,166,134,0)');
      g.fillStyle = top;
      g.beginPath();
      g.moveTo(edge[0][0], edge[0][1]);
      for (let k = 1; k <= np; k++) g.lineTo(edge[k][0], edge[k][1]);
      g.lineTo(rightX - 2, yt + 1);
      g.lineTo(leftX + 2, yt + 1);
      g.closePath();
      g.fill();

      /* 口沿高光：只 2px，交代石台的厚度 */
      const lipHi = g.createLinearGradient(leftX, 0, rightX, 0);
      lipHi.addColorStop(0, 'rgba(250,242,224,0)');
      lipHi.addColorStop(0.2, 'rgba(250,242,224,.5)');
      lipHi.addColorStop(0.8, 'rgba(250,242,224,.5)');
      lipHi.addColorStop(1, 'rgba(250,242,224,0)');
      g.strokeStyle = lipHi;
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(edge[0][0], edge[0][1] + 1.4);
      for (let k = 1; k <= np; k++) g.lineTo(edge[k][0], edge[k][1] + 1.4);
      g.stroke();

      /* 台沿墨线：中段实、两端虚 */
      const lip = g.createLinearGradient(leftX, 0, rightX, 0);
      lip.addColorStop(0, 'rgba(70,55,38,0)');
      lip.addColorStop(0.1, 'rgba(70,55,38,.42)');
      lip.addColorStop(0.5, 'rgba(66,50,34,.55)');
      lip.addColorStop(0.9, 'rgba(70,55,38,.42)');
      lip.addColorStop(1, 'rgba(70,55,38,0)');
      g.strokeStyle = lip;
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(edge[0][0], edge[0][1]);
      for (let k = 1; k <= np; k++) g.lineTo(edge[k][0], edge[k][1]);
      g.stroke();

      /* 台沿下的立面投影 */
      const sDepth = Math.min(step * 0.4, 22);
      const sh = g.createLinearGradient(0, yt, 0, yt + sDepth);
      sh.addColorStop(0, 'rgba(64,49,32,.28)');
      sh.addColorStop(1, 'rgba(64,49,32,0)');
      g.fillStyle = sh;
      g.fillRect(leftX + 2, yt + 1, wide - 4, sDepth);

      /* 台沿两端与山体的接缝：一块暗色石角，避免"悬空一条线" */
      for (const side of [0, 1]) {
        const ex = side ? rightX : leftX;
        const d = side ? 1 : -1;
        const ey = side ? edge[np][1] : edge[0][1];
        g.fillStyle = 'rgba(148,126,96,.55)';
        g.beginPath();
        g.moveTo(ex, ey);
        g.lineTo(ex + d * (10 + rand() * 8), ey + 3);
        g.lineTo(ex + d * (6 + rand() * 6), yt + sDepth * 0.45);
        g.lineTo(ex - d * 2, yt + 2);
        g.closePath();
        g.fill();
      }

      /* 台沿草木 */
      const tufts = 4 + Math.floor(rand() * 7);
      for (let k = 0; k < tufts; k++) {
        const x = leftX + 8 + rand() * Math.max(20, wide - 16);
        this.tuft(g, x, yt - hw + 1.5 + (rand() - 0.5) * 2, 1 + rand() * 1.1);
      }
      if (QUALITY[this.q].detail) {
        for (const t of l.trees) {
          const x = cx + t.p * (t.p < 0 ? l.hl : l.hr) * 0.94;
          this.pine(g, x, yt - hw + 1, 7 * t.s);
        }
      }
    }

    /* 未开辟的层：只留一道极淡的凿痕线，保留十层的结构暗示 */
    g.save();
    for (let i = shown; i < 10; i++) {
      const l = lv[i];
      g.strokeStyle = 'rgba(96,78,54,.10)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(cx - l.hl + 6, l.y - lift);
      g.quadraticCurveTo(cx, l.y - lift + 3, cx + l.hr - 6, l.y - lift);
      g.stroke();
    }
    g.restore();

    /* 坡面散树：只在高档位，补空山 */
    if (QUALITY[this.q].detail) {
      const rr = rng(5150);
      for (let i = 0; i < 16; i++) {
        const t = 0.08 + rr() * 0.84;
        const l = lv[Math.min(9, Math.floor(t * 10))];
        const side = rr() > 0.5 ? 1 : -1;
        const x = cx + side * (Math.min(l.hl, l.hr) * (1.06 + rr() * 0.16));
        const y = l.y - 4 - rr() * l.step * 0.5;
        this.pine(g, x, y, 5 + rr() * 5);
      }
    }

    /* 山道：只在低三层折转，避开主建筑 */
    g.strokeStyle = 'rgba(104,84,58,.26)';
    g.lineWidth = 1.7;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx - lv[0].hl * 0.6, lv[0].y + 3);
    g.quadraticCurveTo(cx - lv[0].hl * 0.86, lv[0].y - lv[0].step * 0.5, cx - lv[1].hl * 0.64, lv[1].y - lift - 4);
    g.quadraticCurveTo(cx - lv[1].hl * 0.42, lv[1].y - lv[1].step * 0.5, cx - lv[2].hl * 0.58, lv[2].y - lift - 4);
    g.quadraticCurveTo(cx - lv[2].hl * 0.78, lv[2].y - lv[2].step * 0.5, cx - lv[3].hl * 0.58, lv[3].y - lift - 4);
    g.stroke();
    g.lineCap = 'butt';
  }

  pine(g, x, y, s) {
    g.fillStyle = 'rgba(72,88,70,.55)';
    g.beginPath(); g.moveTo(x, y); g.lineTo(x - s * 0.55, y); g.lineTo(x, y - s * 0.7); g.lineTo(x + s * 0.55, y); g.closePath(); g.fill();
    g.fillStyle = 'rgba(62,80,64,.6)';
    g.beginPath(); g.moveTo(x, y - s * 0.5); g.lineTo(x - s * 0.42, y - s * 0.5); g.lineTo(x, y - s * 1.1); g.lineTo(x + s * 0.42, y - s * 0.5); g.closePath(); g.fill();
    g.fillStyle = 'rgba(52,70,56,.7)';
    g.beginPath(); g.moveTo(x, y - s * 0.95); g.lineTo(x - s * 0.3, y - s * 0.95); g.lineTo(x, y - s * 1.45); g.lineTo(x + s * 0.3, y - s * 0.95); g.closePath(); g.fill();
  }

  /* 台沿草丛：几根疏密不等的草叶 */
  tuft(g, x, y, s) {
    const n = 3 + ((x | 0) % 3);
    g.strokeStyle = `rgba(66,88,66,${0.3 + (s - 0.6) * 0.16})`;
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const dx = (i - (n - 1) / 2) * 2.1 * s;
      const hh = (4 + ((i * 7 + (x | 0)) % 5)) * s;
      g.moveTo(x + dx, y);
      g.quadraticCurveTo(x + dx + dx * 0.4, y - hh * 0.6, x + dx + dx * 0.9, y - hh);
    }
    g.stroke();
  }

  paintFoot(g) {
    const { L } = this;
    const y = L.baseY + L.step * 0.62;
    const grad = g.createLinearGradient(0, y - 16, 0, this.H);
    grad.addColorStop(0, '#dfcfb0');
    grad.addColorStop(1, '#c8b490');
    g.fillStyle = grad;
    g.fillRect(0, y, this.W, this.H - y);
    g.strokeStyle = 'rgba(80,66,48,.4)';
    g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(0, y); g.lineTo(this.W, y); g.stroke();

    const rand = rng(4711);
    g.fillStyle = 'rgba(66,92,74,.24)';
    for (let i = 0; i < 90; i++) {
      const x = rand() * this.W;
      const h = 5 + rand() * 16;
      g.beginPath();
      g.moveTo(x, y + 2); g.lineTo(x + 2, y + 2 - h); g.lineTo(x + 4, y + 2);
      g.closePath(); g.fill();
    }
    /* 溪流 */
    g.strokeStyle = 'rgba(126,148,146,.32)';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(-10, y + 30);
    g.bezierCurveTo(this.W * 0.28, y + 14, this.W * 0.62, y + 44, this.W + 10, y + 20);
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.35)';
    g.lineWidth = 1.2;
    g.stroke();
  }

  /* ---------- 建筑绘制 ---------- */
  paintBuilding(g, b) {
    const p = this.pos[b.key];
    if (!p) return;
    const { x, y, w, h } = p;
    g.save();
    /* 落影 */
    g.fillStyle = 'rgba(70,56,38,.10)';
    g.beginPath();
    g.ellipse(x + w * 0.06, y + 2, w * 0.52, Math.max(2.5, w * 0.045), 0, 0, TAU);
    g.fill();
    g.translate(x, y);
    switch (b.type) {
      case 'hut': this.drawHut(g, w, h); break;
      case 'pavilion': this.drawPavilion(g, w, h); break;
      case 'field': this.drawField(g, w, h); break;
      case 'workshop': this.drawWorkshop(g, w, h); break;
      case 'arena': this.drawArena(g, w, h); break;
      case 'library': this.drawPagoda(g, w, h); break;
      case 'dorm': this.drawDorm(g, w, h); break;
      case 'hall': this.drawHall(g, w, h, b.layer >= 8 ? 2 : 1); break;
      case 'temple': this.drawTemple(g, w, h); break;
      case 'altar': this.drawAltar(g, w, h); break;
      case 'gate': this.drawGate(g, w, h); break;
      case 'city': this.drawCity(g, w, h); break;
      default: break;
    }
    g.restore();
  }

  roof(g, w, h, opts = {}) {
    const eave = opts.eave == null ? 0.24 : opts.eave;
    const top = 0.11;
    g.beginPath();
    g.moveTo(-w / 2, 0);
    g.quadraticCurveTo(-w * 0.36, -h * 0.46, -w * top, -h);
    g.lineTo(w * top, -h);
    g.quadraticCurveTo(w * 0.36, -h * 0.46, w / 2, 0);
    g.quadraticCurveTo(0, -h * eave, -w / 2, 0);
    g.closePath();
    const gr = g.createLinearGradient(0, -h, 0, 0);
    gr.addColorStop(0, C.roof2);
    gr.addColorStop(0.7, C.roof);
    gr.addColorStop(1, '#2e2822');
    g.fillStyle = gr;
    g.fill();
    g.strokeStyle = 'rgba(20,16,12,.65)';
    g.lineWidth = 1;
    g.stroke();
    /* 翘角 */
    g.strokeStyle = 'rgba(20,16,12,.7)';
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(-w / 2, 0);
    g.quadraticCurveTo(-w / 2 - w * 0.05, -h * 0.12, -w / 2 - w * 0.085, -h * 0.3);
    g.moveTo(w / 2, 0);
    g.quadraticCurveTo(w / 2 + w * 0.05, -h * 0.12, w / 2 + w * 0.085, -h * 0.3);
    g.stroke();
    /* 瓦垄 */
    g.strokeStyle = 'rgba(236,226,205,.22)';
    g.lineWidth = 0.8;
    for (let i = -3; i <= 3; i++) {
      g.beginPath();
      g.moveTo(w * top * 0.9 * i / 3, -h + 1);
      g.quadraticCurveTo(w * 0.18 * i / 3, -h * 0.5, w * 0.34 * i / 3, -h * 0.06);
      g.stroke();
    }
    /* 正脊 */
    g.strokeStyle = 'rgba(244,234,214,.55)';
    g.lineWidth = 1.3;
    g.beginPath();
    g.moveTo(-w * top, -h);
    g.lineTo(w * top, -h);
    g.stroke();
  }

  base(g, w, h, col) {
    const gr = g.createLinearGradient(0, -h, 0, 0);
    gr.addColorStop(0, col || C.wall);
    gr.addColorStop(1, 'rgba(206,190,163,.95)');
    g.fillStyle = gr;
    g.fillRect(-w / 2, -h, w, h);
    g.strokeStyle = 'rgba(58,48,36,.5)';
    g.lineWidth = 1;
    g.strokeRect(-w / 2, -h, w, h);
  }

  window(g, x, y, s = 1, lit = false) {
    g.fillStyle = lit ? 'rgba(222,176,90,.95)' : 'rgba(66,58,46,.8)';
    g.fillRect(x - 2.2 * s, y - 2.8 * s, 4.4 * s, 5.6 * s);
    if (lit) {
      const gr = g.createRadialGradient(x, y, 0, x, y, 8 * s);
      gr.addColorStop(0, 'rgba(240,196,110,.45)');
      gr.addColorStop(1, 'rgba(240,196,110,0)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(x, y, 8 * s, 0, TAU); g.fill();
    }
  }

  drawHut(g, w, h) {
    this.base(g, w * 0.7, h * 0.48, '#f4e9d4');
    g.save(); g.translate(0, -h * 0.48); this.roof(g, w, h * 0.56, { eave: 0.32 }); g.restore();
    this.window(g, -w * 0.13, -h * 0.24, 1, true);
    this.window(g, w * 0.14, -h * 0.24, 1, false);
    /* 柴堆与陶瓮 */
    g.strokeStyle = 'rgba(96,78,56,.7)';
    g.lineWidth = 1.6;
    for (let i = 0; i < 3; i++) {
      g.beginPath(); g.moveTo(w * 0.33, -2 - i * 2.6); g.lineTo(w * 0.44, -2 - i * 2.6); g.stroke();
    }
    g.fillStyle = 'rgba(122,102,76,.8)';
    g.beginPath(); g.ellipse(-w * 0.4, -3, 3.4, 3.4, 0, 0, TAU); g.fill();
  }

  drawPavilion(g, w, h) {
    g.fillStyle = '#ded0b2';
    g.fillRect(-w * 0.34, -3, w * 0.68, 3);
    g.strokeStyle = C.column; g.lineWidth = 2;
    for (const dx of [-0.27, -0.09, 0.09, 0.27]) {
      g.beginPath(); g.moveTo(w * dx, -3); g.lineTo(w * dx, -h * 0.56); g.stroke();
    }
    g.save(); g.translate(0, -h * 0.56); this.roof(g, w * 0.96, h * 0.3, { eave: 0.34 }); g.restore();
    g.save(); g.translate(0, -h * 0.74); this.roof(g, w * 0.52, h * 0.18, { eave: 0.3 }); g.restore();
    g.fillStyle = 'rgba(168,134,63,.9)';
    g.beginPath(); g.arc(0, -h * 0.38, w * 0.06, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(60,48,36,.6)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, -h * 0.38); g.lineTo(0, -h * 0.46); g.stroke();
  }

  drawField(g, w, h) {
    const tiers = 3;
    for (let i = 0; i < tiers; i++) {
      const y = -i * (h / tiers) - 1;
      const ww = w * (1 - i * 0.07);
      const hh = h / tiers - 1;
      /* 水田 */
      const gr = g.createLinearGradient(0, y - hh, 0, y);
      gr.addColorStop(0, 'rgba(126,158,132,.55)');
      gr.addColorStop(1, 'rgba(88,124,104,.55)');
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(-ww / 2, y);
      g.lineTo(ww / 2, y);
      g.lineTo(ww / 2 - 5, y - hh);
      g.lineTo(-ww / 2 + 5, y - hh);
      g.closePath();
      g.fill();
      /* 田埂 */
      g.strokeStyle = 'rgba(84,66,44,.55)';
      g.lineWidth = 1.2;
      g.stroke();
      /* 秧行 */
      g.strokeStyle = 'rgba(46,78,58,.5)';
      g.lineWidth = 0.9;
      const rows = 5;
      for (let r = 0; r < rows; r++) {
        const t = (r + 0.5) / rows;
        const yy = y - hh * t;
        const half = (ww / 2) - (5 * t);
        g.beginPath();
        g.moveTo(-half + 2, yy);
        g.lineTo(half - 2, yy);
        g.stroke();
      }
      /* 水面反光 */
      g.strokeStyle = 'rgba(255,255,255,.35)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(-ww * 0.3, y - hh * 0.35);
      g.lineTo(ww * 0.05, y - hh * 0.35);
      g.stroke();
    }
    /* 稻草人 */
    const sx = w * 0.36;
    g.strokeStyle = 'rgba(92,74,52,.7)';
    g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(sx, 0); g.lineTo(sx, -h * 1.05); g.stroke();
    g.beginPath(); g.moveTo(sx - w * 0.045, -h * 0.8); g.lineTo(sx + w * 0.045, -h * 0.8); g.stroke();
    g.fillStyle = 'rgba(150,120,76,.85)';
    g.beginPath(); g.arc(sx, -h * 1.12, 2.4, 0, TAU); g.fill();
  }

  drawWorkshop(g, w, h) {
    this.base(g, w * 0.84, h * 0.54, '#eee2ca');
    g.save(); g.translate(0, -h * 0.54); this.roof(g, w, h * 0.34, { eave: 0.2 }); g.restore();
    this.window(g, -w * 0.22, -h * 0.26, 1.1, true);
    this.window(g, w * 0.04, -h * 0.26, 1.1, true);
    /* 炉口 */
    g.fillStyle = 'rgba(157,43,34,.55)';
    g.fillRect(-w * 0.06, -h * 0.16, w * 0.12, h * 0.16);
    g.fillStyle = 'rgba(226,160,70,.5)';
    g.fillRect(-w * 0.04, -h * 0.1, w * 0.08, h * 0.1);
    /* 烟囱 */
    g.fillStyle = '#8d7c60';
    g.fillRect(w * 0.3, -h * 1.0, 4.5, h * 0.42);
    g.strokeStyle = 'rgba(58,48,36,.5)'; g.lineWidth = 1;
    g.strokeRect(w * 0.3, -h * 1.0, 4.5, h * 0.42);
    /* 铁砧 */
    g.fillStyle = '#6d6357';
    g.fillRect(-w * 0.46, -4, 9, 4);
    g.fillRect(-w * 0.43, -7, 5, 3);
  }

  drawArena(g, w, h) {
    g.fillStyle = '#d9c9ac';
    g.beginPath();
    g.moveTo(-w / 2, 0); g.lineTo(w / 2, 0);
    g.lineTo(w * 0.43, -h * 0.55); g.lineTo(-w * 0.43, -h * 0.55);
    g.closePath(); g.fill();
    g.strokeStyle = 'rgba(80,68,52,.45)'; g.lineWidth = 1; g.stroke();
    g.strokeStyle = 'rgba(80,68,52,.22)';
    for (let i = 1; i < 4; i++) {
      const t = i / 4;
      g.beginPath();
      g.moveTo(-w * 0.44 * (1 - t * 0.06), -h * 0.55 * t);
      g.lineTo(w * 0.44 * (1 - t * 0.06), -h * 0.55 * t);
      g.stroke();
    }
    /* 兵器架 */
    g.strokeStyle = 'rgba(88,70,50,.7)';
    g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(-w * 0.3, -h * 0.55); g.lineTo(-w * 0.3, -h * 0.95);
    g.moveTo(-w * 0.36, -h * 0.78); g.lineTo(-w * 0.24, -h * 0.78); g.stroke();
    /* 旗 */
    for (const dx of [-0.4, 0.4]) {
      g.strokeStyle = '#5b4f3e'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(w * dx, -h * 0.5); g.lineTo(w * dx, -h * 1.45); g.stroke();
      g.fillStyle = dx < 0 ? 'rgba(157,43,34,.85)' : 'rgba(71,105,90,.85)';
      g.beginPath();
      g.moveTo(w * dx, -h * 1.45);
      g.quadraticCurveTo(w * dx + 10, -h * 1.34, w * dx + 15, -h * 1.2);
      g.quadraticCurveTo(w * dx + 8, -h * 1.24, w * dx, -h * 1.16);
      g.closePath(); g.fill();
    }
  }

  drawPagoda(g, w, h) {
    const tiers = 4;
    for (let i = 0; i < tiers; i++) {
      const tw = w * (1 - i * 0.14);
      const ty = -h * (0.2 * i);
      const bh = h * 0.2 - 1;
      this.base(g, tw * 0.62, bh, i % 2 ? '#f0e5cf' : '#f5ead6');
      g.save(); g.translate(0, ty - bh + 1); this.roof(g, tw, h * 0.13, { eave: 0.28 }); g.restore();
      if (i < 3) this.window(g, 0, ty - bh * 0.5, 0.8, i === 0);
    }
    /* 塔刹 */
    g.fillStyle = C.gold;
    g.beginPath(); g.arc(0, -h * 0.9, 2.4, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(92,74,52,.7)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, -h * 0.9); g.lineTo(0, -h * 1.02); g.stroke();
  }

  drawDorm(g, w, h) {
    for (let i = 0; i < 3; i++) {
      const dx = (i - 1) * w * 0.31;
      g.save();
      g.translate(dx, 0);
      this.base(g, w * 0.23, h * 0.42, '#f2e7d2');
      g.save(); g.translate(0, -h * 0.42); this.roof(g, w * 0.33, h * 0.34, { eave: 0.3 }); g.restore();
      this.window(g, 0, -h * 0.2, 0.85, i !== 1);
      g.restore();
    }
    /* 院墙 */
    g.strokeStyle = 'rgba(157,43,34,.5)';
    g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(-w * 0.47, 0); g.lineTo(-w * 0.47, -h * 0.55); g.stroke();
  }

  drawHall(g, w, h, tiers) {
    this.base(g, w * 0.86, h * 0.48, '#f0e4cd');
    g.strokeStyle = C.column;
    g.lineWidth = 2;
    const cols = 5;
    for (let i = 0; i < cols; i++) {
      const x = -w * 0.38 + (w * 0.76 / (cols - 1)) * i;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, -h * 0.48); g.stroke();
    }
    g.fillStyle = 'rgba(70,62,50,.55)';
    g.fillRect(-w * 0.13, -h * 0.44, w * 0.26, h * 0.42);
    g.fillStyle = 'rgba(210,166,84,.45)';
    g.fillRect(-w * 0.1, -h * 0.4, w * 0.2, h * 0.34);
    /* 檐下斗拱 */
    g.fillStyle = 'rgba(96,78,56,.35)';
    for (let i = 0; i < cols; i++) {
      const x = -w * 0.38 + (w * 0.76 / (cols - 1)) * i;
      g.fillRect(x - 2, -h * 0.5, 4, 2.4);
    }
    g.save(); g.translate(0, -h * 0.48); this.roof(g, w, h * 0.36, { eave: 0.18 }); g.restore();
    if (tiers > 1) {
      g.save(); g.translate(0, -h * 0.76); this.roof(g, w * 0.62, h * 0.2, { eave: 0.22 }); g.restore();
    }
  }

  drawTemple(g, w, h) {
    /* 台基与踏跺 */
    g.fillStyle = '#dccdae';
    g.beginPath();
    g.moveTo(-w * 0.58, 0); g.lineTo(w * 0.58, 0);
    g.lineTo(w * 0.5, -h * 0.15); g.lineTo(-w * 0.5, -h * 0.15);
    g.closePath(); g.fill();
    g.strokeStyle = 'rgba(80,68,52,.4)'; g.lineWidth = 1; g.stroke();
    g.strokeStyle = 'rgba(80,68,52,.22)';
    for (let i = 1; i < 4; i++) {
      g.beginPath();
      g.moveTo(-w * 0.5 + i * 1.6, -h * 0.15 + i * 1.8);
      g.lineTo(w * 0.5 - i * 1.6, -h * 0.15 + i * 1.8);
      g.stroke();
    }
    g.save(); g.translate(0, -h * 0.15);
    this.base(g, w * 0.82, h * 0.44, '#f5ead6');
    g.strokeStyle = C.column; g.lineWidth = 2.1;
    for (let i = 0; i < 5; i++) {
      const x = -w * 0.37 + (w * 0.74 / 4) * i;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, -h * 0.44); g.stroke();
    }
    g.fillStyle = 'rgba(64,56,44,.6)';
    g.fillRect(-w * 0.14, -h * 0.42, w * 0.28, h * 0.4);
    g.fillStyle = 'rgba(206,162,78,.5)';
    g.fillRect(-w * 0.11, -h * 0.38, w * 0.22, h * 0.32);
    /* 匾 */
    g.fillStyle = '#241f19';
    g.fillRect(-w * 0.115, -h * 0.55, w * 0.23, h * 0.105);
    g.fillStyle = 'rgba(212,170,86,.9)';
    g.fillRect(-w * 0.098, -h * 0.536, w * 0.196, h * 0.076);
    g.fillStyle = '#3a2f1e';
    for (let i = 0; i < 3; i++) g.fillRect(-w * 0.05 + i * w * 0.04, -h * 0.515, 2.4, h * 0.04);
    g.save(); g.translate(0, -h * 0.44); this.roof(g, w * 0.96, h * 0.32, { eave: 0.16 }); g.restore();
    g.save(); g.translate(0, -h * 0.7); this.roof(g, w * 0.62, h * 0.22, { eave: 0.2 }); g.restore();
    g.restore();
    /* 石灯 */
    for (const dx of [-0.52, 0.52]) {
      g.fillStyle = 'rgba(120,104,82,.85)';
      g.fillRect(w * dx - 1.8, -9, 3.6, 9);
      g.fillStyle = 'rgba(232,186,100,.95)';
      g.beginPath(); g.arc(w * dx, -11, 2.4, 0, TAU); g.fill();
    }
  }

  drawAltar(g, w, h) {
    g.fillStyle = '#d5c4a4';
    g.beginPath(); g.ellipse(0, 0, w * 0.48, h * 0.17, 0, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(80,68,52,.45)'; g.lineWidth = 1; g.stroke();
    g.fillStyle = '#e6d9bd';
    g.beginPath(); g.ellipse(0, -h * 0.13, w * 0.35, h * 0.13, 0, 0, TAU); g.fill();
    g.stroke();
    /* 石阶 */
    g.strokeStyle = 'rgba(80,68,52,.3)';
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.moveTo(-w * (0.2 + i * 0.05), -h * (0.04 + i * 0.04));
      g.lineTo(w * (0.2 + i * 0.05), -h * (0.04 + i * 0.04));
      g.stroke();
    }
    /* 印环 */
    g.strokeStyle = 'rgba(168,134,63,.6)';
    g.lineWidth = 1.5;
    g.beginPath(); g.ellipse(0, -h * 0.66, w * 0.25, h * 0.1, 0, 0, TAU); g.stroke();
    g.strokeStyle = 'rgba(157,43,34,.5)';
    g.lineWidth = 1.2;
    g.beginPath(); g.ellipse(0, -h * 0.66, w * 0.13, h * 0.26, 0, 0, TAU); g.stroke();
    g.fillStyle = 'rgba(157,43,34,.85)';
    g.beginPath(); g.arc(0, -h * 0.66, 3, 0, TAU); g.fill();
    const gr = g.createRadialGradient(0, -h * 0.66, 0, 0, -h * 0.66, w * 0.4);
    gr.addColorStop(0, 'rgba(200,160,80,.18)');
    gr.addColorStop(1, 'rgba(200,160,80,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(0, -h * 0.66, w * 0.4, 0, TAU); g.fill();
  }

  drawGate(g, w, h) {
    g.fillStyle = '#cbb99a';
    g.fillRect(-w * 0.48, -4, w * 0.96, 4);
    g.strokeStyle = 'rgba(80,66,48,.4)'; g.lineWidth = 1;
    g.strokeRect(-w * 0.48, -4, w * 0.96, 4);
    g.strokeStyle = C.column; g.lineWidth = 3.2;
    g.beginPath(); g.moveTo(-w * 0.35, 0); g.lineTo(-w * 0.35, -h * 0.6); g.stroke();
    g.beginPath(); g.moveTo(w * 0.35, 0); g.lineTo(w * 0.35, -h * 0.6); g.stroke();
    g.strokeStyle = 'rgba(90,74,54,.75)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(-w * 0.35, -h * 0.5); g.lineTo(w * 0.35, -h * 0.5); g.stroke();
    /* 门槛与石狮 */
    g.strokeStyle = 'rgba(90,74,54,.5)'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(-w * 0.35, -3); g.lineTo(w * 0.35, -3); g.stroke();
    g.fillStyle = 'rgba(110,94,72,.85)';
    g.fillRect(-w * 0.44, -8, 5, 8);
    g.fillRect(w * 0.39, -8, 5, 8);
    g.save(); g.translate(0, -h * 0.6); this.roof(g, w * 0.94, h * 0.28, { eave: 0.24 }); g.restore();
    g.fillStyle = '#241f19';
    g.fillRect(-w * 0.105, -h * 0.71, w * 0.21, h * 0.1);
    g.fillStyle = 'rgba(212,170,86,.85)';
    g.fillRect(-w * 0.09, -h * 0.698, w * 0.18, h * 0.072);
  }

  drawCity(g, w, h) {
    g.fillStyle = '#d9c9aa';
    g.fillRect(-w / 2, -h * 0.5, w, h * 0.5);
    g.strokeStyle = 'rgba(70,58,44,.5)'; g.lineWidth = 1;
    g.strokeRect(-w / 2, -h * 0.5, w, h * 0.5);
    /* 垛口 */
    for (let i = 0; i < 9; i++) {
      g.fillStyle = i % 2 ? '#cfbd9c' : '#d5c5a4';
      g.fillRect(-w / 2 + i * (w / 9), -h * 0.58, w / 18, h * 0.08);
    }
    /* 砖缝 */
    g.strokeStyle = 'rgba(90,74,54,.16)';
    for (let i = 1; i < 8; i++) {
      g.beginPath(); g.moveTo(-w / 2, -h * 0.5 + i * (h * 0.5 / 8)); g.lineTo(w / 2, -h * 0.5 + i * (h * 0.5 / 8)); g.stroke();
    }
    /* 城门洞 */
    g.fillStyle = 'rgba(44,38,30,.78)';
    g.beginPath();
    g.moveTo(-w * 0.1, 0); g.lineTo(-w * 0.1, -h * 0.24);
    g.quadraticCurveTo(0, -h * 0.4, w * 0.1, -h * 0.24);
    g.lineTo(w * 0.1, 0); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(226,216,196,.45)'; g.lineWidth = 1;
    g.stroke();
    /* 城楼 */
    g.save(); g.translate(0, -h * 0.5);
    this.base(g, w * 0.42, h * 0.26, '#e9dcc1');
    g.fillStyle = 'rgba(157,43,34,.35)';
    g.fillRect(-w * 0.05, -h * 0.2, w * 0.1, h * 0.2);
    this.roof(g, w * 0.58, h * 0.24, { eave: 0.24 });
    g.restore();
    /* 城内屋顶与灯 */
    g.fillStyle = 'rgba(120,104,82,.55)';
    for (let i = 0; i < 3; i++) {
      const bx = -w * 0.28 + i * w * 0.2;
      g.beginPath();
      g.moveTo(bx - 6, -h * 0.5); g.lineTo(bx + 6, -h * 0.5); g.lineTo(bx, -h * 0.6);
      g.closePath(); g.fill();
    }
    g.fillStyle = 'rgba(232,186,100,.9)';
    for (let i = 0; i < 5; i++) {
      g.beginPath(); g.arc(-w * 0.4 + i * (w * 0.2), -h * 0.2, 1.8, 0, TAU); g.fill();
    }
  }

  /* 未开辟的山：整片淡墨压过去，只压一层，不逐级刷白条 */
  /* 未开辟的山：只压一层薄雾，让山形与岩壁透出来。
     之前压得太重（.46），六层存档的上半座山直接白成一张纸。 */
  paintFog(g) {
    const layers = this.model.layers || 1;
    if (layers >= 10) return;
    const { L } = this;
    const top = L.levels[Math.min(9, layers)] ? L.levels[Math.min(9, layers)].y : L.peakY;
    const grd = g.createLinearGradient(0, L.peakY - 20, 0, top + 10);
    grd.addColorStop(0, 'rgba(247,241,229,.30)');
    grd.addColorStop(0.55, 'rgba(246,239,226,.16)');
    grd.addColorStop(1, 'rgba(244,236,221,0)');
    g.fillStyle = grd;
    g.fillRect(-20, L.peakY - 40, this.W + 40, top - L.peakY + 60);

    /* 云带：横着缠两道，把空山断开，别让上半部整片空着 */
    const band = (y, h, a) => {
      const c = g.createLinearGradient(0, y - h, 0, y + h);
      c.addColorStop(0, 'rgba(250,246,236,0)');
      c.addColorStop(0.45, `rgba(252,248,240,${a})`);
      c.addColorStop(0.62, `rgba(248,243,232,${a * 0.8})`);
      c.addColorStop(1, 'rgba(250,246,236,0)');
      g.fillStyle = c;
      g.beginPath();
      g.ellipse(L.cx + (this.W * 0.04), y, this.W * 0.42, h, 0, 0, TAU);
      g.fill();
    };
    const peakGap = (top - L.peakY) || 1;
    band(L.peakY + peakGap * 0.26, Math.max(16, peakGap * 0.075), 0.72);
    if (peakGap > 380) band(L.peakY + peakGap * 0.52, Math.max(13, peakGap * 0.06), 0.58);

    /* 雾中远景：未开辟的层画极淡的屋脊剪影，让上半座山看着"已经在那里"，
       而不是一片待填的白。只画形，不画热点，点不到。 */
    g.save();
    g.strokeStyle = 'rgba(96,80,58,.16)';
    g.fillStyle = 'rgba(120,102,76,.055)';
    g.lineWidth = 1;
    for (let i = layers; i < 10; i++) {
      const lv = L.levels[i];
      if (!lv) continue;
      const w = Math.min(lv.hl, lv.hr);
      if (w < 60) continue;
      const y = lv.y - 2;
      /* 每层三座，错开一点都不至于排成队 */
      const offs = [-0.42, 0.02, 0.4];
      for (let k = 0; k < offs.length; k++) {
        const bw = w * (0.13 + ((i + k) % 3) * 0.03);
        const bh = bw * 0.62;
        const x = L.cx + offs[k] * w * 0.86;
        g.beginPath();
        g.moveTo(x - bw * 0.62, y);
        g.lineTo(x - bw * 0.62, y - bh * 0.62);
        g.lineTo(x, y - bh);
        g.lineTo(x + bw * 0.62, y - bh * 0.62);
        g.lineTo(x + bw * 0.62, y);
        g.closePath();
        g.fill();
        g.stroke();
      }
    }
    g.restore();
  }

  /* ---------- 逐帧动画层 ---------- */
  drawClouds(g) {
    const n = QUALITY[this.q].clouds;
    if (!n) return;
    for (let i = 0; i < n; i++) {
      const seed = i * 97 + 13;
      const speed = 4 + (i % 3) * 2.5;
      const span = this.W + 420;
      const x = ((this.t * speed + seed * 53) % span) - 210;
      const y = this.H * (0.07 + (i % 4) * 0.05);
      const w = 130 + (i % 3) * 70;
      const h = 10 + (i % 2) * 5;
      for (let k = 0; k < 3; k++) {
        g.fillStyle = `rgba(255,253,246,${0.22 + k * 0.05})`;
        g.beginPath();
        g.ellipse(x + k * w * 0.42, y + k * 3, w * (1 - k * 0.16), h * (1 - k * 0.12), 0, 0, TAU);
        g.fill();
      }
    }
  }

  drawMist(g) {
    const n = QUALITY[this.q].mist;
    const { L } = this;
    for (let i = 0; i < n; i++) {
      const y = L.peakY + (L.baseY - L.peakY) * (0.28 + i * 0.2);
      const drift = this.motion ? Math.sin(this.t * 0.16 + i * 1.7) * 16 : 0;
      const grd = g.createLinearGradient(0, y - 22, 0, y + 22);
      grd.addColorStop(0, `rgba(${C.mist},0)`);
      grd.addColorStop(0.5, `rgba(${C.mist},${0.4 - i * 0.04})`);
      grd.addColorStop(1, `rgba(${C.mist},0)`);
      g.fillStyle = grd;
      g.fillRect(-20 + drift, y - 22, this.W + 40, 44);
    }
  }

  drawFigures(g) {
    const list = (this.model.figures || []).slice(0, QUALITY[this.q].figures);
    const { L } = this;
    for (const f of list) {
      const lv = L.levels[clamp(f.t, 0, 9)];
      if (!lv) continue;
      const half = f.u < 0.5 ? lv.hl : lv.hr;
      const x = L.cx + (f.u * 2 - 1) * half * 0.78;
      const baseY = lv.y - 4;
      const t = this.t * (f.kind === 'servant' ? 1.2 : 0.85) + f.seed;
      const walking = f.kind === 'servant' || f.kind === 'away';
      const off = walking && this.motion ? Math.sin(t * 1.5) * half * 0.08 : 0;
      const bob = walking && this.motion ? Math.abs(Math.sin(t * 3.1)) * 1.1 : 0;
      this.drawFigure(g, x + off, baseY - bob, f, t);
    }
  }

  drawFigure(g, x, y, f, t) {
    const s = clamp(this.L.baseHalf / 320, 0.85, 1.3);
    const h = (f.kind === 'formal' ? 17 : 14) * s;
    const robe = {
      formal: '#5d757e',
      servant: '#8a6f4c',
      staff: '#8a3d33',
      injured: '#8c867c',
      away: '#5f6675',
    }[f.kind] || '#6f6a5f';
    /* 影子 */
    g.fillStyle = 'rgba(60,50,38,.18)';
    g.beginPath(); g.ellipse(x, y + 1, h * 0.3, 1.8, 0, 0, TAU); g.fill();
    /* 袍 */
    g.fillStyle = robe;
    g.beginPath();
    g.moveTo(x - h * 0.26, y);
    g.quadraticCurveTo(x - h * 0.2, y - h * 0.5, x - h * 0.13, y - h * 0.72);
    g.lineTo(x + h * 0.13, y - h * 0.72);
    g.quadraticCurveTo(x + h * 0.2, y - h * 0.5, x + h * 0.26, y);
    g.closePath();
    g.fill();
    /* 腰带 */
    g.fillStyle = 'rgba(240,232,214,.5)';
    g.fillRect(x - h * 0.15, y - h * 0.46, h * 0.3, Math.max(1, h * 0.05));
    /* 头与发髻 */
    g.fillStyle = 'rgba(226,208,180,.95)';
    g.beginPath(); g.arc(x, y - h * 0.82, h * 0.12, 0, TAU); g.fill();
    g.fillStyle = 'rgba(48,40,32,.85)';
    g.beginPath(); g.arc(x, y - h * 0.86, h * 0.13, Math.PI, TAU); g.fill();
    g.beginPath(); g.arc(x, y - h * 0.95, h * 0.05, 0, TAU); g.fill();
    /* 修炼者：呼吸光晕 */
    if (f.kind === 'formal' && QUALITY[this.q].glow) {
      const pulse = this.motion ? 0.22 + Math.abs(Math.sin(t * 0.8)) * 0.26 : 0.26;
      const gr = g.createRadialGradient(x, y - h * 0.6, 0, x, y - h * 0.6, h * 1.3);
      gr.addColorStop(0, `rgba(118,166,146,${pulse * 0.5})`);
      gr.addColorStop(1, 'rgba(118,166,146,0)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(x, y - h * 0.6, h * 1.3, 0, TAU); g.fill();
    }
    /* 伤者：倚杖 */
    if (f.kind === 'injured') {
      g.strokeStyle = 'rgba(120,90,60,.65)';
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(x + h * 0.34, y); g.lineTo(x + h * 0.34, y - h * 0.8); g.stroke();
    }
    /* 外派：负笈 */
    if (f.kind === 'away') {
      g.fillStyle = 'rgba(92,74,52,.8)';
      g.fillRect(x - h * 0.42, y - h * 0.66, h * 0.14, h * 0.18);
    }
  }

  drawGlow(g) {
    if (!QUALITY[this.q].glow) return;
    const badges = this.model.badges || {};
    const pulse = this.motion ? 0.72 + Math.sin(this.t * 2.2) * 0.28 : 1;
    for (const key of Object.keys(badges)) {
      const p = this.pos[key];
      if (!p || this.locked(key)) continue;
      const level = badges[key].level;
      const col = level === 3 ? '157,43,34' : level === 2 ? '168,134,63' : '71,105,90';
      const r = Math.max(p.w, p.h) * (level === 3 ? 1.1 : 0.98);
      const gr = g.createRadialGradient(p.x, p.y - p.h * 0.4, r * 0.12, p.x, p.y - p.h * 0.4, r);
      gr.addColorStop(0, `rgba(${col},${0.32 * pulse})`);
      gr.addColorStop(0.55, `rgba(${col},${0.14 * pulse})`);
      gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr;
      g.beginPath(); g.arc(p.x, p.y - p.h * 0.4, r, 0, TAU); g.fill();
      g.strokeStyle = `rgba(${col},${0.5 * pulse})`;
      g.lineWidth = level === 3 ? 1.8 : 1.2;
      g.beginPath(); g.ellipse(p.x, p.y + 2, p.w * 0.58, 5.5, 0, 0, TAU); g.stroke();
    }
  }

  drawSelection(g) {
    const key = this.hovered || this.selected;
    if (!key) return;
    const p = this.pos[key];
    if (!p || this.locked(key)) return;
    const active = this.selected === key;
    g.strokeStyle = active ? 'rgba(157,43,34,.9)' : 'rgba(90,80,64,.45)';
    g.lineWidth = active ? 1.8 : 1.1;
    g.setLineDash(active ? [] : [4, 4]);
    g.beginPath();
    g.ellipse(p.x, p.y + 3, p.w * 0.64, 7, 0, 0, TAU);
    g.stroke();
    g.setLineDash([]);
    if (active) {
      const gr = g.createRadialGradient(p.x, p.y - p.h * 0.5, 0, p.x, p.y - p.h * 0.5, p.w * 1.15);
      gr.addColorStop(0, 'rgba(157,43,34,.1)');
      gr.addColorStop(1, 'rgba(157,43,34,0)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(p.x, p.y - p.h * 0.5, p.w * 1.15, 0, TAU); g.fill();
    }
  }
}

export { QUALITY };
