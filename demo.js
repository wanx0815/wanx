/*
 * Deterministic Motion Lab demo runtime.
 * This browser-only runtime mirrors the TypeScript effect contract in ../src.
 * No random numbers are used for layout, path generation, timing, or visual output.
 */
(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const LOGICAL_W = 1920;
  const LOGICAL_H = 1080;
  const stageBoard = $('#stageBoard');
  const stageSurface = $('#stageSurface');
  const overlay = $('#motionOverlay');
  const boardContent = $('#boardContent');
  const panel = $('#controlPanel');
  const appShell = $('#appShell');
  const handles = new Map();
  const intensityLevels = new Map();
  let lastPalaceClick = null;
  let lastBaziClick = null;
  let lastMeihuaClick = null;
  // 聚光多选时按点击顺序记录目标，前三个同步到动效控制的目标位。
  let focusOrder = [];
  let focusAutoTimer = null;
  let qimenPatternTimer = null;
  let palaceEffectStep = 0;
  // The native dblclick window follows the OS setting (often ~500ms) and fires
  // while two slow clicks still mean two selections; use a tighter window.
  const ANCHOR_DOUBLE_MS = 220;
  let lastAnchorPress = { id: null, time: 0 };
  let qimenDualEditor = null;
  // Palace annotations (rings / one flying horse) are decorations, not motion effects:
  // they survive effect clearing and template switches.
  const qimenPatterns = { mode: null, rings: new Set(), horse: null };
  let dateMode = 'solar';
  let lunarLoadPromise = null;
  let selectedId = 'qimen.palace.center';
  let currentTemplate = 'qimen';
  let sequence = 0;
  let composition = null;
  let toastTimer = null;

  const definitions = {
    'highlight.focus': { min: 1, max: 1, defaultDuration: 900, minDuration: 250, maxDuration: 5000 },
    'element.lift': { min: 1, max: 1, defaultDuration: 900, minDuration: 300, maxDuration: 4000 },
    'element.layerReveal': { min: 1, max: 1, defaultDuration: 1100, minDuration: 300, maxDuration: 5000 },
    'element.layerSeparate': { min: 1, max: 1, defaultDuration: 1200, minDuration: 400, maxDuration: 6000 },
    'relation.flow': { min: 2, max: 3, defaultDuration: 1500, minDuration: 400, maxDuration: 8000 },
    'relation.suppress': { min: 2, max: 3, defaultDuration: 1300, minDuration: 400, maxDuration: 8000 },
    'relation.converge': { min: 3, max: 3, defaultDuration: 1700, minDuration: 500, maxDuration: 9000 },
    'relation.path': { min: 2, max: 8, defaultDuration: 2600, minDuration: 700, maxDuration: 15000 },
    'state.intensity': { min: 1, max: 1, defaultDuration: 600, minDuration: 200, maxDuration: 3000 },
    'imagery.wood.growth': { min: 1, max: 1, defaultDuration: 2200, minDuration: 500, maxDuration: 10000 },
    'imagery.fire.flare': { min: 1, max: 1, defaultDuration: 1800, minDuration: 500, maxDuration: 10000 },
    'imagery.water.flow': { min: 1, max: 1, defaultDuration: 2200, minDuration: 500, maxDuration: 10000 },
    'imagery.metal.glint': { min: 1, max: 1, defaultDuration: 1200, minDuration: 300, maxDuration: 8000 },
    'imagery.earth.gather': { min: 1, max: 1, defaultDuration: 1800, minDuration: 500, maxDuration: 10000 },
    'imagery.door.open': { min: 1, max: 1, defaultDuration: 1500, minDuration: 400, maxDuration: 8000 },
    'imagery.road.extend': { min: 1, max: 1, defaultDuration: 1800, minDuration: 500, maxDuration: 9000 },
    'imagery.person.reveal': { min: 1, max: 1, defaultDuration: 1600, minDuration: 400, maxDuration: 8000 },
    'imagery.vehicle.appear': { min: 1, max: 1, defaultDuration: 1500, minDuration: 400, maxDuration: 8000 },
    'imagery.house.reveal': { min: 1, max: 1, defaultDuration: 1900, minDuration: 500, maxDuration: 9000 },
    'imagery.mountain.rise': { min: 1, max: 1, defaultDuration: 1800, minDuration: 500, maxDuration: 9000 },
    'decorative.gold.particles': { min: 1, max: 1, defaultDuration: 2400, minDuration: 600, maxDuration: 10000 },
    'decorative.mist.rise': { min: 1, max: 1, defaultDuration: 2600, minDuration: 700, maxDuration: 10000 },
    'decorative.compass.rotate': { min: 1, max: 1, defaultDuration: 2200, minDuration: 600, maxDuration: 9000 },
  };
  const toneColors = { gold: '#D9B875', wood: '#78B79A', fire: '#DF8354', water: '#6F9FC8', metal: '#E1D7BF', earth: '#B99868', vermilion: '#E16B50' };
  // 浅色底上沿用深色版的金/白会直接消失，换成同色相的深阶。
  const paperToneColors = { gold: '#82632c', wood: '#2f6b45', fire: '#a33b28', water: '#2f5a82', metal: '#5b554a', earth: '#8a4a1f', vermilion: '#a83a26' };
  const isPaperTheme = () => document.documentElement.dataset.theme === 'paper';
  const themeToneColors = () => isPaperTheme()
    ? { ...paperToneColors, gold: (getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || paperToneColors.gold) }
    : toneColors;

  function notify(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2100);
  }
  function nextId() { sequence += 1; return `demo-motion-${sequence}`; }
  function svg(tag) { return document.createElementNS(SVG_NS, tag); }
  function logicalRect(element) {
    // Anchors are laid out inside stageSurface. Walk offsetParent geometry rather than
    // using transformed client rects: this remains stable when the whole 16:9 stage is
    // scaled or fullscreened. The SVG overlay uses the same
    // stageSurface padding-box dimensions as its viewBox.
    let node = element;
    let x = 0;
    let y = 0;
    while (node && node !== stageSurface) {
      const parent = node.offsetParent;
      if (!parent) break;
      x += node.offsetLeft - (parent.scrollLeft || 0);
      y += node.offsetTop - (parent.scrollTop || 0);
      node = parent;
    }
    if (node === stageSurface && overlay.clientWidth > 0 && overlay.clientHeight > 0) {
      const scaleX = LOGICAL_W / overlay.clientWidth;
      const scaleY = LOGICAL_H / overlay.clientHeight;
      return {
        x: x * scaleX,
        y: y * scaleY,
        width: element.offsetWidth * scaleX,
        height: element.offsetHeight * scaleY,
      };
    }
    // Fallback for a host anchor mounted outside the canonical stageSurface subtree.
    const matrix = overlay.getScreenCTM();
    if (!matrix) throw new Error('无法读取动效舞台坐标矩阵。');
    const rect = element.getBoundingClientRect();
    const inverse = matrix.inverse();
    const points = [
      new DOMPoint(rect.left, rect.top), new DOMPoint(rect.right, rect.top),
      new DOMPoint(rect.right, rect.bottom), new DOMPoint(rect.left, rect.bottom),
    ].map(point => point.matrixTransform(inverse));
    const xs = points.map(point => point.x), ys = points.map(point => point.y);
    const left = Math.min(...xs), top = Math.min(...ys);
    return { x: left, y: top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
  }
  function center(rect) { return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; }
  // 盘面外接框：所有宫位的并集，用来判断某个宫位哪条边在盘外。
  function boardBounds() {
    let box = null; const cells = [];
    $$('[data-element-id]', boardContent).forEach(cell => {
      const r = logicalRect(cell);
      cells.push(r);
      if (!box) { box = { x: r.x, y: r.y, width: r.width, height: r.height }; return; }
      const right = Math.max(box.x + box.width, r.x + r.width);
      const bottom = Math.max(box.y + box.height, r.y + r.height);
      box.x = Math.min(box.x, r.x); box.y = Math.min(box.y, r.y);
      box.width = right - box.x; box.height = bottom - box.y;
    });
    if (box) box.cells = cells;
    return box;
  }
  function boundaryPoints(source, target, board) {
    const a = center(source), b = center(target);
    const dx = b.x-a.x, dy = b.y-a.y, distance = Math.hypot(dx,dy);
    if (distance < .001) throw new Error('关系起点与终点重合，无法生成连接路径。');
    // 两端都靠盘边的宫位：从外侧绕行，不横穿中间那一宫。
    // 相邻且不同边的（斜角相邻）交给下面的斜角规则，其余一律走盘外。
    if (board) {
      const tol = 6, near = (value, edge) => Math.abs(value - edge) < tol;
      const sidesOf = rect => {
        const list = [];
        if (near(rect.y, board.y)) list.push('top');
        if (near(rect.y + rect.height, board.y + board.height)) list.push('bottom');
        if (near(rect.x, board.x)) list.push('left');
        if (near(rect.x + rect.width, board.x + board.width)) list.push('right');
        return list;
      };
      const sidesA = sidesOf(source), sidesB = sidesOf(target);
      if (sidesA.length && sidesB.length) {
        const gapX = Math.abs(dx) - (source.width + target.width) / 2;
        const gapY = Math.abs(dy) - (source.height + target.height) / 2;
        const adjacent = gapX < Math.min(source.width, target.width) * .6 && gapY < Math.min(source.height, target.height) * .6;
        const shared = sidesA.filter(side => sidesB.includes(side));
        // 隔着别的宫位：直连。两端落在各自宫位里的空白处，中间别的宫位可以穿过。
        if (!adjacent) return { start: blankPoint(source, b), end: blankPoint(target, a), inner: true };
        if (shared.length) {
          let best = null;
          sidesA.forEach(sideA => sidesB.forEach(sideB => {
            const len = perimeterDistance(sideA, sideB, board);
            if (!best || len < best.len) best = { sideA, sideB, len };
          }));
          return {
            start: edgeMid(source, best.sideA, 0), end: edgeMid(target, best.sideB, 0),
            outer: best.sideA, outerEnd: best.sideB,
          };
        }
      }
    }
    // 同一行/同一列但不共外边的宫位（中宫四邻、隔着中宫的同排宫位、梅花上下相邻）也走宫内直连，
    // 和隔宫、斜角保持同一种弧线形态。
    return { start: blankPoint(source, b), end: blankPoint(target, a), inner: true };
  }
  function edgeMid(rect, side, pad) {
    const c = center(rect);
    return side === 'top' ? { x:c.x, y:rect.y - pad } :
      side === 'bottom' ? { x:c.x, y:rect.y + rect.height + pad } :
      side === 'left' ? { x:rect.x - pad, y:c.y } : { x:rect.x + rect.width + pad, y:c.y };
  }
  // 朝向对方那条射线与宫位边框的交点，再往宫内收三成，线头落在宫位里。
  function innerPoint(rect, other, factor = .7) {
    const c = center(rect), dx = other.x - c.x, dy = other.y - c.y;
    const reach = 1 / Math.max(Math.abs(dx) / (rect.width / 2), Math.abs(dy) / (rect.height / 2));
    return { x: c.x + dx * reach * factor, y: c.y + dy * reach * factor };
  }
  // 线头落在宫内、朝向对方的空白处：以「宫心→对方宫心」射线上、离边三成的点（innerPoint）为基准，
  // 在 ±70 范围内挑点。除了够空，还要看「沿行进方向能走多远不碰字」——手画的线都是顺着字缝走的。
  function blankPoint(rect, other) {
    // 梅花这类宫位是卡内的小槽位，没有空白可言，退回原来的射线取点。
    if (rect.width < 120 || rect.height < 120) return innerPoint(rect, other);
    const base = innerPoint(rect, other, .45);
    const blocked = textRects().filter(t => {
      const p = { x: t.x + t.width / 2, y: t.y + t.height / 2 };
      return p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height;
    }).concat(ringRects());
    const rectDist = (p, r) => Math.hypot(Math.max(r.x - p.x, 0, p.x - r.x - r.width), Math.max(r.y - p.y, 0, p.y - r.y - r.height));
    const gap = p => blocked.length ? Math.min(...blocked.map(r => rectDist(p, r))) : 99;
    const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
    const dx = other.x - cx, dy = other.y - cy, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    let best = null;
    for (let ox = -70; ox <= 70; ox += 10) {
      for (let oy = -70; oy <= 70; oy += 10) {
        const p = { x: base.x + ox, y: base.y + oy };
        if (p.x < rect.x + 12 || p.x > rect.x + rect.width - 12 || p.y < rect.y + 12 || p.y > rect.y + rect.height - 12) continue;
        const clearance = gap(p);
        if (clearance < 10) continue;
        let sight = 0;
        for (let k = 12; k <= 120; k += 12) {
          if (gap({ x: p.x + ux * k, y: p.y + uy * k }) < 10) break;
          sight = k;
        }
        const score = Math.min(sight, 60) * .5 + Math.min(clearance, 24) - .25 * Math.hypot(ox, oy);
        if (!best || score > best.score) best = { score, p };
      }
    }
    return best ? best.p : base;
  }
  // 两条外边的中段沿盘面外圈的距离，用来挑最短的绕行方向。
  function perimeterDistance(sideA, sideB, board) {
    const W = board.width, H = board.height, P = 2 * (W + H);
    const t = { top: W / 2, right: W + H / 2, bottom: 1.5 * W + H, left: 2 * W + 1.5 * H };
    const gap = Math.abs(t[sideA] - t[sideB]);
    return Math.min(gap, P - gap);
  }
  // 盘外绕行的曲线：两端沿外法线外扩后相连，整条线走在盘面之外。
  function outerPath(bounds, margin = 70) {
    const { start, end, outer } = bounds;
    const n = outer === 'top' ? [0,-1] : outer === 'bottom' ? [0,1] : outer === 'left' ? [-1,0] : [1,0];
    return `M ${start.x} ${start.y} C ${start.x+n[0]*margin} ${start.y+n[1]*margin}, ${end.x+n[0]*margin} ${end.y+n[1]*margin}, ${end.x} ${end.y}`;
  }
  // 两条不同的外边：沿盘外接框走直角绕行，转角用二次曲线抹圆。
  function perimeterPath(bounds, board, margin = 70) {
    const x0 = board.x - margin, y0 = board.y - margin;
    const x1 = board.x + board.width + margin, y1 = board.y + board.height + margin;
    const W = x1 - x0, H = y1 - y0, P = 2 * (W + H);
    const normal = { top:[0,-1], bottom:[0,1], left:[-1,0], right:[1,0] };
    const offset = (p, side) => ({ x: p.x + normal[side][0] * margin, y: p.y + normal[side][1] * margin });
    const edgeT = p =>
      Math.abs(p.y - y0) < .5 ? p.x - x0 :
      Math.abs(p.x - x1) < .5 ? W + (p.y - y0) :
      Math.abs(p.y - y1) < .5 ? W + H + (x1 - p.x) : 2 * W + H + (y1 - p.y);
    const start = offset(bounds.start, bounds.outer), end = offset(bounds.end, bounds.outerEnd);
    const tStart = edgeT(start);
    const forward = ((edgeT(end) - tStart) % P + P) % P;
    const clockwise = forward <= P - forward;
    const corners = [
      { t: 0, x: x0, y: y0 }, { t: W, x: x1, y: y0 },
      { t: W + H, x: x1, y: y1 }, { t: 2 * W + H, x: x0, y: y1 },
    ].map(corner => ({ ...corner, along: clockwise ? ((corner.t - tStart + P) % P) : ((tStart - corner.t + P) % P) }))
      .filter(corner => corner.along > .5 && corner.along < (clockwise ? forward : P - forward) - .5)
      .sort((p, q) => p.along - q.along);
    const points = [bounds.start, start, ...corners, end, bounds.end];
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length - 1; i++) {
      d += ` Q ${points[i].x} ${points[i].y} ${(points[i].x + points[i+1].x) / 2} ${(points[i].y + points[i+1].y) / 2}`;
    }
    return d + ` L ${points[points.length-1].x} ${points[points.length-1].y}`;
  }
  function connectorPath(bounds, obstacles, board) {
    if (bounds.inner) return innerPath(bounds.start, bounds.end, board);
    if (!bounds.outer) return relationPath(bounds.start, bounds.end, obstacles);
    return bounds.outer === bounds.outerEnd ? outerPath(bounds) : perimeterPath(bounds, board);
  }
  function relationPath(a, b, obstacles = [], strength = 1) {
    const dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx,dy);
    // 两宫位挨得近时弯度必须跟着收，否则会甩出一个小钩。
    const bendBase = Math.min(160 * strength, Math.max(1.5, distance * .18 * strength));
    const nx = distance ? -dy / distance : 0, ny = distance ? dx / distance : -1;
    const pointAt = (t,c1,c2) => {
      const mt = 1-t;
      return {x:mt**3*a.x+3*mt**2*t*c1.x+3*mt*t**2*c2.x+t**3*b.x,y:mt**3*a.y+3*mt**2*t*c1.y+3*mt*t**2*c2.y+t**3*b.y};
    };
    const candidates=[];
    [1,-1].forEach(sign => [1,1.45,1.95].forEach(multiplier => {
      const bend=bendBase*multiplier*sign;
      const c1={x:a.x+dx*.32+nx*bend,y:a.y+dy*.32+ny*bend};
      const c2={x:a.x+dx*.68+nx*bend,y:a.y+dy*.68+ny*bend};
      let collisions=0;
      for(let sample=1;sample<24;sample++){
        const point=pointAt(sample/24,c1,c2);
        for(const rect of obstacles){const margin=14;if(point.x>=rect.x-margin&&point.x<=rect.x+rect.width+margin&&point.y>=rect.y-margin&&point.y<=rect.y+rect.height+margin)collisions++;}
      }
      const d=`M ${a.x.toFixed(2)} ${a.y.toFixed(2)} C ${(a.x+dx*.32+nx*bend).toFixed(2)} ${(a.y+dy*.32+ny*bend).toFixed(2)}, ${(a.x+dx*.68+nx*bend).toFixed(2)} ${(a.y+dy*.68+ny*bend).toFixed(2)}, ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
      candidates.push({d,score:collisions*1000+Math.abs(bend)*.1});
    }));
    return candidates.sort((x,y)=>x.score-y.score)[0].d;
  }
  function obstaclesFor(ignoredIds) {
    const ignored = new Set(ignoredIds);
    return $$('[data-element-id]', boardContent).filter(el => !ignored.has(el.dataset.elementId)).map(logicalRect);
  }
  // 宫位里的文字节点用客户端矩形换算：offsetLeft 累加在深层节点上会算错位置。
  function visualRect(element) {
    const matrix = overlay.getScreenCTM();
    const rect = element.getBoundingClientRect();
    if (!matrix || !rect.width || !rect.height) return null;
    const inverse = matrix.inverse();
    const a = new DOMPoint(rect.left, rect.top).matrixTransform(inverse);
    const b = new DOMPoint(rect.right, rect.bottom).matrixTransform(inverse);
    return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
  }
  // 宫位里真正有字的元素框：宫内直连按这些框避让，尽量不压住文字。
  function textRects() {
    const rects = [];
    $$('[data-element-id]', boardContent).forEach(cell => {
      cell.querySelectorAll('*').forEach(node => {
        if (node.children.length || !node.textContent.trim()) return;
        const r = visualRect(node);
        if (r) rects.push(r);
      });
    });
    return rects;
  }
  // 空亡圆圈与马星标记：连线要绕开，但可以穿过没被选中的宫位。
  function ringRects() {
    return $$('.qimen-ring-slot, .qimen-horse-slot', boardContent).map(visualRect).filter(Boolean);
  }
  // 隔宫直连：一条弧线从空白处到空白处，只避让两端所选宫位里的字和空亡/马星标记。
  function innerPath(start, end, board) {
    const cells = board && board.cells || [];
    const contains = (r, p) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
    const home = cells.filter(r => contains(r, start) || contains(r, end));
    const blocked = textRects()
      .filter(t => home.some(r => contains(r, { x: t.x + t.width / 2, y: t.y + t.height / 2 })))
      .concat(ringRects());
    const dx = end.x - start.x, dy = end.y - start.y, distance = Math.hypot(dx, dy) || 1;
    const nx = -dy / distance, ny = dx / distance;
    const at = (t, c1, c2) => {
      const mt = 1 - t;
      return { x: mt ** 3 * start.x + 3 * mt ** 2 * t * c1.x + 3 * mt * t ** 2 * c2.x + t ** 3 * end.x,
               y: mt ** 3 * start.y + 3 * mt ** 2 * t * c1.y + 3 * mt * t ** 2 * c2.y + t ** 3 * end.y };
    };
    let best = null;
    // 一律带弯（手画的连线都是弧线，直线像随手拉的），弯度约 8%~13% 弦长；
    // 先往盘面中心那一侧弯，压到字才换另一侧。
    const midX = (start.x + end.x) / 2, midY = (start.y + end.y) / 2;
    const centerX = board ? board.x + board.width / 2 : midX, centerY = board ? board.y + board.height / 2 : midY;
    // 两行布局（四柱、梅花）里朝盘心弯会把弧线挤进中间那条带子，改成朝外——弧线贴上下两侧。
    const rows = new Set(cells.map(r => Math.round(r.y))).size;
    const side = ((centerX - midX) * nx + (centerY - midY) * ny >= 0 ? 1 : -1) * (rows > 0 && rows <= 2 ? -1 : 1);
    // 控制点夹在盘面内：三次贝塞尔不会超出控制点凸包，弧顶就不会甩到盘外。
    const clamp = p => board ? {
      x: Math.min(Math.max(p.x, board.x), board.x + board.width),
      y: Math.min(Math.max(p.y, board.y), board.y + board.height),
    } : p;
    // 弯度按档位优先：默认 16%，压字才退到 24%/34%，都压字才用近乎直线的 2%。
    [.16, .24, .34, .02].forEach((mag, rank) => [side, -side].forEach(sign => {
      const k = mag * sign;
      const bow = distance * k;
      const c1 = clamp({ x: start.x + dx * .33 + nx * bow, y: start.y + dy * .33 + ny * bow });
      const c2 = clamp({ x: start.x + dx * .67 + nx * bow, y: start.y + dy * .67 + ny * bow });
      let hits = 0;
      for (let s = 1; s < 30; s++) {
        const p = at(s / 30, c1, c2);
        hits += blocked.filter(r => p.x >= r.x - 10 && p.x <= r.x + r.width + 10 && p.y >= r.y - 10 && p.y <= r.y + r.height + 10).length;
      }
      const score = hits * 1000 + rank;
      if (!best || score < best.score) best = { score, c1, c2 };
    }));
    return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} C ${best.c1.x.toFixed(2)} ${best.c1.y.toFixed(2)}, ${best.c2.x.toFixed(2)} ${best.c2.y.toFixed(2)}, ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
  }
  function addRoot(id) {
    const root = svg('g');
    root.dataset.motionHandle = id;
    root.setAttribute('pointer-events', 'none');
    overlay.appendChild(root);
    return root;
  }
  function glow(el, color) { el.setAttribute('filter', `drop-shadow(0 0 10px ${color})`); }
  function addArrowMarker(root, color, suffix) {
    const id = `motion-arrow-${String(suffix).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    const defs = svg('defs');
    const marker = svg('marker');
    marker.setAttribute('id', id); marker.setAttribute('viewBox', '0 0 12 12');
    marker.setAttribute('markerWidth', '14'); marker.setAttribute('markerHeight', '14');
    marker.setAttribute('refX', '10'); marker.setAttribute('refY', '6');
    marker.setAttribute('orient', 'auto'); marker.setAttribute('markerUnits', 'userSpaceOnUse');
    const arrow = svg('path'); arrow.setAttribute('d', 'M 0 1 L 11 6 L 0 11 L 2.8 6 Z');
    arrow.setAttribute('fill', color); arrow.setAttribute('filter', `drop-shadow(0 0 4px ${color})`);
    marker.appendChild(arrow); defs.appendChild(marker); root.appendChild(defs);
    return id;
  }
  function animate(el, frames, duration, easing = 'ease-in-out', delay = 0) {
    if (el instanceof SVGElement) { el.style.transformBox = 'fill-box'; el.style.transformOrigin = 'center'; }
    return el.animate(frames, { duration, easing, fill: 'forwards', delay });
  }
  function findTarget(id) { return $(`[data-element-id="${CSS.escape(id)}"]`, boardContent); }
  function getTone() { const colors = themeToneColors(); return colors[$('#toneSelect').value] || colors.gold; }
  function activePolicy() { return $('#playbackPolicy').value === 'autoReset' ? 'autoReset' : 'replace'; }
  let renderDurationOverride = null;
  function animationDuration() { return renderDurationOverride == null ? Number($('#durationRange').value) : renderDurationOverride; }

  function renderLayerReveal(id) {
    const target = findTarget(id);
    const surface = $('[data-motion-surface], .motion-surface', target) || target;
    const layers = $$('[data-motion-layer]', surface);
    const parts = layers.length ? layers : [...surface.children];
    if (!parts.length) throw new Error('此元素没有可分层揭示的内容层。');
    const requestedStagger = 120;
    const stagger = Math.min(requestedStagger, animationDuration() * .32 / Math.max(1, parts.length - 1));
    const baseDuration = Math.max(120, animationDuration() - stagger * Math.max(0, parts.length - 1));
    const animations = parts.map((part, index) => animate(part, [
      { transform: 'translateY(8px) scale(.985)', opacity: .55, filter: 'blur(1px)' },
      { transform: 'translateY(0) scale(1)', opacity: 1, filter: 'blur(0)' },
    ], baseDuration, 'cubic-bezier(.18,.72,.18,1)', index * stagger));
    const root = addRoot(nextId());
    return { root, animations };
  }
  function renderLayerSeparate(id) {
    const target = findTarget(id);
    const surface = $('[data-motion-surface], .motion-surface', target) || target;
    const layers = $$('[data-motion-layer]', surface);
    const parts = layers.length ? layers : [...surface.children];
    if (parts.length < 2) throw new Error('宫内层级分离至少需要两个内容层。');
    const step = 5;
    const stagger = Math.min(80, animationDuration() * .28 / Math.max(1, parts.length - 1));
    const baseDuration = Math.max(150, animationDuration() - stagger * (parts.length - 1));
    const animations = parts.map((part,index) => {
      const depth = index * step;
      return animate(part,[
        {transform:'translateY(0) scale(1)',filter:'drop-shadow(0 0 0 rgba(217,184,117,0))'},
        {transform:`translateY(${-depth}px) scale(1.008)`,filter:`drop-shadow(0 ${Math.max(1,depth*.35)}px ${Math.max(2,depth*.8)}px rgba(0,0,0,.28)`},
      ],baseDuration,'cubic-bezier(.18,.72,.18,1)',index*stagger);
    });
    const root = addRoot(nextId());
    return {root,animations};
  }
  function renderRelation(sourceId, targetId, suppress) {
    const board = boardBounds();
    const boundary = boundaryPoints(logicalRect(findTarget(sourceId)), logicalRect(findTarget(targetId)), board);
    const a = boundary.start;
    const b = boundary.end;
    const root = addRoot(nextId());
    root.dataset.relationEffect = 'true';
    const path = svg('path');
    path.setAttribute('d', connectorPath(boundary, obstaclesFor([sourceId,targetId]), board)); path.setAttribute('fill', 'none');
    const color = getTone();
    path.setAttribute('stroke', color); path.setAttribute('stroke-width', isPaperTheme() ? (suppress ? '5' : '4') : (suppress ? '4' : '3'));
    path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-dasharray', '10 12'); path.setAttribute('opacity', '.92');
    const markerId = addArrowMarker(root, color, nextId()); path.setAttribute('marker-end', `url(#${markerId})`);
    glow(path, color + 'aa'); root.appendChild(path);
    const length = path.getTotalLength(); path.style.strokeDasharray = String(length); path.style.strokeDashoffset = String(length);
    const lineAnimation = animate(path, [{ strokeDashoffset: length, opacity: .25 }, { strokeDashoffset: 0, opacity: 1 }], animationDuration(), 'cubic-bezier(.25,.72,.2,1)');
    const endpoint = svg('circle'); endpoint.setAttribute('cx', b.x); endpoint.setAttribute('cy', b.y); endpoint.setAttribute('r', suppress ? '8' : '6'); endpoint.setAttribute('fill', color); glow(endpoint, color); root.appendChild(endpoint);
    const endAnim = animate(endpoint, [{ opacity: .15, transform: 'scale(.7)' }, { opacity: 1, transform: 'scale(1.35)', offset: .78 }, { opacity: .85, transform: 'scale(1)' }], animationDuration(), 'ease-out');
    const animations = [lineAnimation, endAnim];
    if (suppress) {
      const impact = svg('circle'); impact.setAttribute('cx', b.x); impact.setAttribute('cy', b.y); impact.setAttribute('r', '10'); impact.setAttribute('fill', 'none'); impact.setAttribute('stroke', color); impact.setAttribute('stroke-width', '3'); root.appendChild(impact);
      animations.push(animate(impact, [{ opacity: .85, transform: 'scale(.55)' }, { opacity: 0, transform: 'scale(3.8)' }], animationDuration(), 'ease-out'));
    }
    return { root, animations };
  }
  function renderConverge(sourceA, sourceB, targetId) {
    const targetRect = logicalRect(findTarget(targetId));
    const board = boardBounds();
    const routes = [
      {source:sourceA,bounds:boundaryPoints(logicalRect(findTarget(sourceA)),targetRect,board)},
      {source:sourceB,bounds:boundaryPoints(logicalRect(findTarget(sourceB)),targetRect,board)},
    ];
    const root = addRoot(nextId());
    root.dataset.relationEffect = 'true';
    const color = getTone();
    const animations = [];
    routes.forEach((route,index) => {
      const p = svg('path'); p.setAttribute('d',connectorPath(route.bounds,obstaclesFor([route.source,targetId]),board)); p.setAttribute('fill','none');
      p.setAttribute('stroke',color); p.setAttribute('stroke-width',isPaperTheme() ? '4' : '3'); p.setAttribute('stroke-linecap','round'); p.setAttribute('stroke-dasharray','9 11');
      const markerId=addArrowMarker(root,color,nextId()); p.setAttribute('marker-end',`url(#${markerId})`); glow(p,color+'aa'); root.appendChild(p);
      const length=p.getTotalLength(); p.style.strokeDasharray=length; p.style.strokeDashoffset=length;
      animations.push(animate(p,[{strokeDashoffset:length,opacity:.2},{strokeDashoffset:0,opacity:1}],animationDuration(),'cubic-bezier(.25,.72,.2,1)'));
    });
    const end=center(targetRect);
    const ring=svg('circle'); ring.setAttribute('cx',end.x); ring.setAttribute('cy',end.y); ring.setAttribute('r','12'); ring.setAttribute('fill','none'); ring.setAttribute('stroke',color); ring.setAttribute('stroke-width','3'); glow(ring,color); root.appendChild(ring);
    animations.push(animate(ring,[{opacity:0,transform:'scale(.5)'},{opacity:1,transform:'scale(1.4)',offset:.75},{opacity:.8,transform:'scale(1)'}],animationDuration(),'ease-out'));
    return {root,animations};
  }
  function renderRelationPath(ids, suppress = false) {
    const rects = ids.map(id => logicalRect(findTarget(id)));
    const root = addRoot(nextId());
    root.dataset.relationEffect = 'true';
    const color = getTone();
    const segment = animationDuration() / Math.max(1, ids.length - 1);
    const animations = [];
    const board = boardBounds();
    for (let index=0; index<ids.length-1; index++) {
      const bounds = boundaryPoints(rects[index],rects[index+1],board);
      const p = svg('path'); p.setAttribute('d',connectorPath(bounds,obstaclesFor([ids[index],ids[index+1]]),board)); p.setAttribute('fill','none'); p.setAttribute('stroke',color); p.setAttribute('stroke-width',suppress ? '4' : '3.2'); p.setAttribute('stroke-linecap','round'); p.setAttribute('stroke-dasharray','9 10'); p.setAttribute('opacity','.92');
      const markerId = addArrowMarker(root,color,nextId()); p.setAttribute('marker-end',`url(#${markerId})`); glow(p,color+'aa'); root.appendChild(p);
      const length=p.getTotalLength(); p.style.strokeDasharray=length; p.style.strokeDashoffset=length;
      animations.push(animate(p,[{strokeDashoffset:length,opacity:.18},{strokeDashoffset:0,opacity:1}],segment,'cubic-bezier(.25,.72,.2,1)',index*segment));
    }
    const last = center(rects[rects.length-1]);
    const ring=svg('circle'); ring.setAttribute('cx',last.x); ring.setAttribute('cy',last.y); ring.setAttribute('r',suppress ? '12' : '11'); ring.setAttribute('fill','none'); ring.setAttribute('stroke',color); ring.setAttribute('stroke-width','3'); glow(ring,color); root.appendChild(ring);
    animations.push(animate(ring,[{opacity:0,transform:'scale(.55)'},{opacity:1,transform:'scale(1.3)'}],Math.min(700,animationDuration()*.3),'ease-out',animationDuration()*.7));
    if (suppress) {
      const impact=svg('circle'); impact.setAttribute('cx',last.x); impact.setAttribute('cy',last.y); impact.setAttribute('r','10'); impact.setAttribute('fill','none'); impact.setAttribute('stroke',color); impact.setAttribute('stroke-width','3'); root.appendChild(impact);
      animations.push(animate(impact,[{opacity:.85,transform:'scale(.55)'},{opacity:0,transform:'scale(3.8)'}],animationDuration(),'ease-out'));
    }
    return {root,animations};
  }
  function renderImagery(id, kind) {
    const r = logicalRect(findTarget(id));
    const root = addRoot(nextId());
    const g = svg('g');
    const scale = Math.min(r.width, r.height) / 150;
    g.setAttribute('transform', `translate(${r.x + r.width / 2} ${r.y + r.height / 2}) scale(${scale})`); root.appendChild(g);
    const tones = themeToneColors();
    const colors = { wood: tones.wood, fire: tones.fire, water: tones.water, metal: tones.metal, earth: tones.earth };
    const areaFill = isPaperTheme() ? 'rgba(130,99,44,.09)' : 'rgba(217,184,117,.07)';
    const color = colors[kind];
    const isFiveElement = ['wood', 'fire', 'water', 'metal', 'earth'].includes(kind);
    const level = intensityLevels.get(id) ?? 2;
    root.dataset.targetId = id;
    root.dataset.fiveElement = String(isFiveElement);
    root.dataset.effectId = ({ wood: 'imagery.wood.growth', fire: 'imagery.fire.flare', water: 'imagery.water.flow', metal: 'imagery.metal.glint', earth: 'imagery.earth.gather' })[kind] || '';
    const art = svg('g');
    art.dataset.imageryArt = 'true';
    art.setAttribute('transform', `scale(${[.68,.84,1,1.18][level]})`);
    art.style.filter = `brightness(${[.72,.90,1.12,1.34][level]}) drop-shadow(0 0 ${[3,6,10,16][level]}px ${color || tones.gold})`;
    art.style.opacity = String([.62,.82,.96,1][level]);
    g.appendChild(art);
    const animations = [];
    const path = (d, width = 4, opacity = .9) => {
      const p = svg('path'); p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', color); p.setAttribute('stroke-width', width); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round'); p.setAttribute('opacity', opacity); glow(p, color + '99'); art.appendChild(p);
      const length = p.getTotalLength(); p.style.strokeDasharray = length; p.style.strokeDashoffset = length;
      animations.push(animate(p, [{ strokeDashoffset: length, opacity: .12 }, { strokeDashoffset: 0, opacity }], animationDuration(), 'ease-out'));
      return p;
    };
    if (kind === 'wood') {
      path('M 0 64 C -4 34 -2 2 0 -54',5); path('M -1 22 C -28 4 -42 -10 -50 -32',3); path('M 1 8 C 26 -7 40 -23 46 -43',3); path('M -1 -7 C -20 -22 -23 -37 -22 -52',2.5);
      [[-44,-29,-25],[42,-40,28],[-20,-50,-32],[24,-13,25]].forEach(([lx,ly,rot]) => {
        const leaf = svg('ellipse'); leaf.setAttribute('cx',lx); leaf.setAttribute('cy',ly); leaf.setAttribute('rx','9'); leaf.setAttribute('ry','4'); leaf.setAttribute('fill',color); leaf.setAttribute('opacity','.8'); leaf.setAttribute('transform',`rotate(${rot} ${lx} ${ly})`); art.appendChild(leaf);
        animations.push(animate(leaf,[{opacity:0,transform:`rotate(${rot} ${lx} ${ly}) scale(.4)`},{opacity:.86,transform:`rotate(${rot} ${lx} ${ly}) scale(1)`}],animationDuration(),'ease-out'));
      });
    } else if (kind === 'fire') {
      path('M 0 66 C -40 30 -28 -5 -2 -60 C 1 -26 36 -16 24 18 C 44 -2 49 35 0 66 Z',3,.98);
      const inner = svg('path'); inner.setAttribute('d','M 0 48 C -18 22 -7 1 5 -22 C 5 0 24 13 14 34 C 11 41 6 45 0 48 Z'); inner.setAttribute('fill','#F4C47B'); inner.setAttribute('opacity','.72'); art.appendChild(inner);
      animations.push(animate(inner,[{opacity:.3,transform:'scale(.88)'},{opacity:.9,transform:'scale(1.05)'},{opacity:.55,transform:'scale(.96)'}],animationDuration(),'ease-in-out'));
    } else if (kind === 'water') {
      path('M -72 -28 C -42 -52 -12 -4 18 -28 S 58 -52 74 -28',4); path('M -76 0 C -42 -24 -10 24 20 0 S 58 -24 78 0',5); path('M -70 30 C -40 8 -10 52 20 30 S 54 8 72 30',3);
    } else if (kind === 'metal') {
      const diamond = svg('polygon'); diamond.setAttribute('points','0,-66 56,0 0,66 -56,0'); diamond.setAttribute('fill', isPaperTheme() ? 'rgba(130,99,44,.06)' : 'rgba(225,215,191,.035)'); diamond.setAttribute('stroke',color); diamond.setAttribute('stroke-width','3'); glow(diamond,color); art.appendChild(diamond);
      animations.push(animate(diamond,[{opacity:.25,transform:'scale(.82)'},{opacity:1,transform:'scale(1.04)'},{opacity:.82,transform:'scale(1)'}],animationDuration(),'ease-out'));
      path('M -48 38 L 48 -38',3,.8); path('M -24 58 L 24 -58',1.5,.5);
    } else if (kind === 'door') {
      path('M -58 64 L -58 -62 L 58 -62 L 58 64', 4, .95);
      const left = svg('rect'); left.setAttribute('x','-52'); left.setAttribute('y','-55'); left.setAttribute('width','50'); left.setAttribute('height','112'); left.setAttribute('rx','2'); left.setAttribute('fill', areaFill); left.setAttribute('stroke',color); left.setAttribute('stroke-width','3'); art.appendChild(left);
      const right = svg('rect'); right.setAttribute('x','2'); right.setAttribute('y','-55'); right.setAttribute('width','50'); right.setAttribute('height','112'); right.setAttribute('rx','2'); right.setAttribute('fill', areaFill); right.setAttribute('stroke',color); right.setAttribute('stroke-width','3'); art.appendChild(right);
      const lp = svg('rect'); lp.setAttribute('x','-43'); lp.setAttribute('y','-43'); lp.setAttribute('width','32'); lp.setAttribute('height','88'); lp.setAttribute('fill','none'); lp.setAttribute('stroke',color); lp.setAttribute('stroke-width','1.5'); art.appendChild(lp);
      const rp = svg('rect'); rp.setAttribute('x','11'); rp.setAttribute('y','-43'); rp.setAttribute('width','32'); rp.setAttribute('height','88'); rp.setAttribute('fill','none'); rp.setAttribute('stroke',color); rp.setAttribute('stroke-width','1.5'); art.appendChild(rp);
      [[left,-14],[lp,-14],[right,14],[rp,14]].forEach(([el,dx]) => animations.push(animate(el,[{transform:'translateX(0)'},{transform:`translateX(${dx}px)`}],animationDuration(),'cubic-bezier(.2,.75,.2,1)')));
    } else if (kind === 'road') {
      path('M -34 68 C -27 22 -15 -18 -8 -68',4,.95); path('M 34 68 C 27 22 15 -18 8 -68',4,.95); path('M 0 66 C 0 18 0 -24 0 -68',2.2,.68).setAttribute('stroke-dasharray','5 9');
      const horizon=svg('path'); horizon.setAttribute('d','M -74 -68 Q 0 -80 74 -68'); horizon.setAttribute('stroke',color); horizon.setAttribute('stroke-width','1.5'); horizon.setAttribute('fill','none'); horizon.setAttribute('opacity','.45'); art.appendChild(horizon);
    } else if (kind === 'person') {
      const head=svg('circle'); head.setAttribute('cx','0'); head.setAttribute('cy','-49'); head.setAttribute('r','13'); head.setAttribute('fill','none'); head.setAttribute('stroke',color); head.setAttribute('stroke-width','4'); art.appendChild(head);
      path('M 0 -34 C -4 -8 -4 10 0 34',4,.95); path('M 0 -18 C -22 -8 -31 2 -39 18',3.5,.9); path('M 0 -18 C 22 -8 31 2 39 18',3.5,.9); path('M 0 34 C -16 48 -23 58 -30 68',4,.95); path('M 0 34 C 16 48 23 58 30 68',4,.95);
      animations.push(animate(head,[{opacity:0,transform:'scale(.6)'},{opacity:1,transform:'scale(1)'}],animationDuration(),'ease-out'));
    } else if (kind === 'vehicle') {
      const trail=svg('path'); trail.setAttribute('d','M -72 39 L -35 39'); trail.setAttribute('fill','none'); trail.setAttribute('stroke',color); trail.setAttribute('stroke-width','2'); trail.setAttribute('stroke-linecap','round'); trail.setAttribute('opacity','.45'); art.appendChild(trail);
      const body=svg('path'); body.setAttribute('d','M -56 22 L -46 -10 Q -42 -20 -30 -20 L 27 -20 Q 41 -20 47 -5 L 58 22 L 58 42 L -56 42 Z'); body.setAttribute('fill', areaFill); body.setAttribute('stroke',color); body.setAttribute('stroke-width','3.5'); body.setAttribute('stroke-linejoin','round'); art.appendChild(body);
      const win=svg('path'); win.setAttribute('d','M -32 -16 L 25 -16 Q 34 -16 40 -3 L -39 -3 Z'); win.setAttribute('fill', isPaperTheme() ? 'rgba(47,90,130,.14)' : 'rgba(107,159,199,.13)'); win.setAttribute('stroke',color); win.setAttribute('stroke-width','2'); art.appendChild(win);
      [-32,34].forEach(wx=>{const wheel=svg('circle');wheel.setAttribute('cx',wx);wheel.setAttribute('cy','42');wheel.setAttribute('r','10');wheel.setAttribute('fill','#11161a');wheel.setAttribute('stroke',color);wheel.setAttribute('stroke-width','3');art.appendChild(wheel);animations.push(animate(wheel,[{transform:'rotate(0deg)'},{transform:'rotate(24deg)'}],animationDuration(),'ease-out'));});
      animations.push(animate(body,[{opacity:0,transform:'translateX(-18px) scale(.94)'},{opacity:1,transform:'translateX(0) scale(1)'}],animationDuration(),'cubic-bezier(.2,.75,.2,1)')); animations.push(animate(win,[{opacity:0},{opacity:1}],animationDuration()*.62,'ease-out'));
    } else if (kind === 'house') {
      path('M -68 -8 L 0 -63 L 68 -8',4,.95); path('M -54 -15 L -54 62 L 54 62 L 54 -15',4,.95);
      const door=svg('rect'); door.setAttribute('x','-12'); door.setAttribute('y','20'); door.setAttribute('width','24'); door.setAttribute('height','42'); door.setAttribute('fill', areaFill); door.setAttribute('stroke',color); door.setAttribute('stroke-width','2.5'); art.appendChild(door);
      [-36,36].forEach(xPos=>{const win=svg('rect');win.setAttribute('x',xPos-8);win.setAttribute('y','2');win.setAttribute('width','16');win.setAttribute('height','17');win.setAttribute('fill', isPaperTheme() ? 'rgba(47,90,130,.10)' : 'rgba(107,159,199,.09)');win.setAttribute('stroke',color);win.setAttribute('stroke-width','2');art.appendChild(win);animations.push(animate(win,[{opacity:0},{opacity:.95}],animationDuration()*.5,'ease-out'));});
      animations.push(animate(door,[{opacity:0},{opacity:1}],animationDuration()*.66,'ease-out'));
    } else if (kind === 'mountain') {
      path('M -76 58 L -38 -12 L -14 20 L 20 -54 L 76 58 Z',4,.95); path('M -38 -12 L -25 11 L -14 20',2,.72); path('M 20 -54 L 35 -22 L 46 -5',2,.72);
      const sun=svg('circle');sun.setAttribute('cx','0');sun.setAttribute('cy','-55');sun.setAttribute('r','17');sun.setAttribute('fill', areaFill);sun.setAttribute('stroke',color);sun.setAttribute('stroke-width','2.5');art.appendChild(sun);animations.push(animate(sun,[{opacity:0,transform:'translateY(18px) scale(.8)'},{opacity:.85,transform:'translateY(0) scale(1)'}],animationDuration()*.72,'ease-out'));
    } else {
      [26,46,66].forEach((rad) => { const ring = svg('ellipse'); ring.setAttribute('cx','0'); ring.setAttribute('cy','16'); ring.setAttribute('rx',rad); ring.setAttribute('ry',rad*.35); ring.setAttribute('fill','none'); ring.setAttribute('stroke',color); ring.setAttribute('stroke-width','3'); ring.setAttribute('opacity','.72'); art.appendChild(ring); animations.push(animate(ring,[{opacity:0,transform:'scale(.72)'},{opacity:.8,transform:'scale(1)'}],animationDuration(),'ease-out')); });
      path('M -66 42 Q 0 70 66 42',3,.85);
    }
    return { root, animations };
  }

  function renderDecorative(id, kind) {
    const r = logicalRect(findTarget(id));
    const root = addRoot(nextId());
    const g = svg('g');
    const scale = Math.min(r.width, r.height) / 150;
    g.setAttribute('transform', `translate(${r.x + r.width / 2} ${r.y + r.height / 2}) scale(${scale})`);
    root.appendChild(g);
    const animations = [];
    const gold = themeToneColors().gold;
    if (kind === 'particles') {
      const points = [[-58,-42,3],[-26,-58,2],[12,-55,2.5],[48,-38,3],[-68,-4,2],[-35,8,2.5],[0,-8,3],[36,2,2],[64,26,2.5],[-48,42,2],[2,52,2.5],[42,48,2]];
      points.forEach(([x,y,radius], index) => {
        const dot=svg('circle');dot.setAttribute('cx',x);dot.setAttribute('cy',y);dot.setAttribute('r',radius);dot.setAttribute('fill',gold);dot.setAttribute('filter',`drop-shadow(0 0 5px ${gold}aa)`);g.appendChild(dot);
        const delay=animationDuration()*index/(points.length*1.8); const dur=Math.max(120,animationDuration()-delay);
        animations.push(animate(dot,[{opacity:0,transform:'translateY(7px) scale(.65)'},{opacity:.92,transform:'translateY(-3px) scale(1)',offset:.45},{opacity:.08,transform:'translateY(-15px) scale(.72)'}],dur,'ease-out',delay));
      });
    } else if (kind === 'mist') {
      [{x:-34,y:25,rx:47,ry:13,delay:0},{x:18,y:4,rx:54,ry:16,delay:animationDuration()*.12},{x:-4,y:-25,rx:39,ry:12,delay:animationDuration()*.24}].forEach(c=>{
        const cloud=svg('ellipse');cloud.setAttribute('cx',c.x);cloud.setAttribute('cy',c.y);cloud.setAttribute('rx',c.rx);cloud.setAttribute('ry',c.ry);cloud.setAttribute('fill',`${gold}2b`);cloud.setAttribute('stroke',`${gold}61`);cloud.setAttribute('stroke-width','1.2');cloud.setAttribute('filter','blur(7px)');g.appendChild(cloud);
        animations.push(animate(cloud,[{opacity:0,transform:'translateY(15px) scale(.94)'},{opacity:.78,transform:'translateY(0) scale(1)',offset:.48},{opacity:.06,transform:'translateY(-20px) scale(1.08)'}],Math.max(120,animationDuration()-c.delay),'ease-in-out',c.delay));
      });
    } else {
      const outer=svg('circle');outer.setAttribute('cx','0');outer.setAttribute('cy','0');outer.setAttribute('r','66');outer.setAttribute('fill','none');outer.setAttribute('stroke',gold);outer.setAttribute('stroke-width','1.8');outer.setAttribute('opacity','.78');g.appendChild(outer);
      const inner=svg('circle');inner.setAttribute('cx','0');inner.setAttribute('cy','0');inner.setAttribute('r','52');inner.setAttribute('fill','none');inner.setAttribute('stroke',gold);inner.setAttribute('stroke-width','1');inner.setAttribute('opacity','.48');g.appendChild(inner);
      for(let i=0;i<16;i++){const a=Math.PI*2*i/16,major=i%4===0;const line=svg('line');line.setAttribute('x1',Math.sin(a)*(major?49:55));line.setAttribute('y1',-Math.cos(a)*(major?49:55));line.setAttribute('x2',Math.sin(a)*63);line.setAttribute('y2',-Math.cos(a)*63);line.setAttribute('stroke',gold);line.setAttribute('stroke-width',major?2.5:1.2);line.setAttribute('opacity',major?'.9':'.56');g.appendChild(line);}
      const needle=svg('g');const north=svg('path');north.setAttribute('d','M 0 -44 L 8 4 L 0 -2 L -8 4 Z');north.setAttribute('fill',gold);needle.appendChild(north);const south=svg('path');south.setAttribute('d','M 0 44 L 8 -4 L 0 2 L -8 -4 Z');south.setAttribute('fill','#8C6B43');needle.appendChild(south);const hub=svg('circle');hub.setAttribute('cx','0');hub.setAttribute('cy','0');hub.setAttribute('r','5');hub.setAttribute('fill',gold);needle.appendChild(hub);g.appendChild(needle);
      animations.push(animate(needle,[{transform:'rotate(-12deg)'},{transform:'rotate(12deg)'}],animationDuration(),'ease-in-out'));
      animations.push(animate(outer,[{opacity:.35,transform:'scale(.94)'},{opacity:.82,transform:'scale(1)'}],animationDuration(),'ease-out'));
    }
    return {root,animations};
  }

  function playEffect(effectId, targetIds, extra = {}) {
    if (effectId === 'state.intensity') {
      applyIntensity(targetIds[0], Number($('#intensityRange').value), false);
      return null;
    }
    const def = definitions[effectId];
    if (!def) { notify(`未注册效果：${effectId}`); return null; }
    if (targetIds.length < def.min || targetIds.length > def.max) { notify(`该效果需要 ${def.min} 个目标。`); return null; }
    for (const id of targetIds) if (!findTarget(id)) { notify(`目标元素不存在：${id}`); return null; }
    const policy = extra.policy || activePolicy();
    const duration = Math.max(def.minDuration, Math.min(def.maxDuration, extra.duration || animationDuration() || def.defaultDuration));
    // 任何新动画都撤掉上一动画，防止视觉图层永久叠加。
    clearAllEffectsQuiet();
    const id = nextId();
    let rendered;
    try {
      renderDurationOverride = duration;
      if (effectId === 'highlight.focus') { applyQuickState([targetIds[0]], 'quick-spotlight'); return null; }
      else if (effectId === 'element.lift') { applyQuickState([targetIds[0]], 'quick-lift'); return null; }
      else if (effectId === 'element.layerReveal') rendered = renderLayerReveal(targetIds[0]);
      else if (effectId === 'element.layerSeparate') rendered = renderLayerSeparate(targetIds[0]);
      else if (effectId === 'relation.flow') {
        // 多方汇聚：第一个、第二个都连线到第三个；没有第三个时退化为两点单向。
        applyQuickState(targetIds, 'quick-lift');
        rendered = targetIds.length > 2
          ? renderConverge(targetIds[0], targetIds[1], targetIds[2])
          : renderRelation(targetIds[0], targetIds[1], false);
      }
      else if (effectId === 'relation.suppress') {
        // 作用制化：保留聚光高亮，其余宫位变暗。
        applyQuickState(targetIds, 'quick-spotlight', true);
        rendered = targetIds.length > 2 ? renderRelationPath(targetIds, true) : renderRelation(targetIds[0], targetIds[1], true);
      }
      else if (effectId === 'relation.converge') rendered = renderConverge(targetIds[0], targetIds[1], targetIds[2]);
      else if (effectId === 'relation.path') rendered = renderRelationPath(targetIds);
      else if (effectId === 'state.intensity') throw new Error('五行强度已由控制档位直接调整，不再生成独立光圈。');
      else if (effectId.startsWith('imagery.')) {
        const imageryKind = ({
          'imagery.wood.growth':'wood', 'imagery.fire.flare':'fire', 'imagery.water.flow':'water',
          'imagery.metal.glint':'metal', 'imagery.earth.gather':'earth', 'imagery.door.open':'door',
          'imagery.road.extend':'road', 'imagery.person.reveal':'person', 'imagery.vehicle.appear':'vehicle',
          'imagery.house.reveal':'house', 'imagery.mountain.rise':'mountain',
        })[effectId];
        if (!imageryKind) throw new Error('尚未实现该象意效果');
        rendered = renderImagery(targetIds[0], imageryKind);
      }
      else if (effectId === 'decorative.gold.particles') rendered = renderDecorative(targetIds[0], 'particles');
      else if (effectId === 'decorative.mist.rise') rendered = renderDecorative(targetIds[0], 'mist');
      else if (effectId === 'decorative.compass.rotate') rendered = renderDecorative(targetIds[0], 'compass');
      else throw new Error('效果未实现');
    } catch (error) { notify(error.message); return null; }
    finally { renderDurationOverride = null; }

    const record = { id, effectId, targetIds, policy, rendered, animations: rendered.animations, duration, remaining: duration, startedAt: performance.now(), timer: null, status: 'playing' };
    record.timer = setTimeout(() => finishHandle(id), duration);
    handles.set(id, record);
    return id;
  }
  function finishHandle(id) {
    const record = handles.get(id); if (!record) return;
    record.timer = null; record.status = 'completed';
    if (record.policy === 'autoReset') {
      record.animations.forEach(a => a.cancel()); record.rendered.root.remove(); handles.delete(id);
    }
  }
  function pauseHandle(id) {
    const record = handles.get(id); if (!record || record.status !== 'playing') return;
    record.remaining = Math.max(0, record.remaining - (performance.now() - record.startedAt));
    clearTimeout(record.timer); record.timer = null; record.animations.forEach(a => a.pause()); record.status = 'paused';
  }
  function resumeHandle(id) {
    const record = handles.get(id); if (!record || record.status !== 'paused') return;
    record.animations.forEach(a => a.play()); record.startedAt = performance.now(); record.timer = setTimeout(() => finishHandle(id), record.remaining); record.status = 'playing';
  }
  function stopHandle(id, restore = true) {
    const record = handles.get(id); if (!record) return;
    clearTimeout(record.timer);
    if (restore) { record.animations.forEach(a => a.cancel()); record.rendered.root.remove(); }
    else record.animations.forEach(a => a.pause());
    record.status = 'stopped'; handles.delete(id);
  }
  function clearAllEffects() {
    clearAllEffectsQuiet();
    notify('已恢复原始总览。案例内容没有被修改。');
  }
  function undoLast() {
    clearAllEffectsQuiet();
    notify('已清除当前效果。');
  }
  function applyIntensity(id, level, announce = true) {
    if (!id) return;
    const safeLevel = Math.max(0, Math.min(3, Math.round(Number(level) || 0)));
    intensityLevels.set(id, safeLevel);
    const scales = [.68, .84, 1, 1.18];
    const brightness = [.72, .90, 1.12, 1.34];
    const blur = [3, 6, 10, 16];
    $$('[data-five-element="true"][data-target-id]', overlay).forEach(root => {
      if (root.dataset.targetId !== id) return;
      const art = $('[data-imagery-art="true"]', root);
      if (!art) return;
      const tones = themeToneColors();
      const color = ({
        'imagery.wood.growth':tones.wood, 'imagery.fire.flare':tones.fire,
        'imagery.water.flow':tones.water, 'imagery.metal.glint':tones.metal,
        'imagery.earth.gather':tones.earth,
      })[root.dataset.effectId] || tones.gold;
      art.setAttribute('transform', `scale(${scales[safeLevel]})`);
      art.style.filter = `brightness(${brightness[safeLevel]}) drop-shadow(0 0 ${blur[safeLevel]}px ${color})`;
      art.style.opacity = String([.62,.82,.96,1][safeLevel]);
    });
    $('#intensityOutput').textContent = `${safeLevel} / 3`;
    if (announce) notify(`五行象意强度已调整为 ${safeLevel} / 3。`);
  }
  function refreshRelationTone() {
    const color = getTone();
    $$('[data-relation-effect="true"]', overlay).forEach(root => {
      $$('[stroke]', root).forEach(el => {
        const old = el.getAttribute('stroke');
        if (old && old !== 'none') {
          el.setAttribute('stroke', color);
          el.setAttribute('filter', `drop-shadow(0 0 10px ${color}aa)`);
        }
      });
      $$('[fill]', root).forEach(el => {
        const old = el.getAttribute('fill');
        if (old && old !== 'none' && old !== 'transparent') {
          el.setAttribute('fill', color);
          el.setAttribute('filter', `drop-shadow(0 0 6px ${color}aa)`);
        }
      });
    });
  }
  const quickCellSelector = () =>
    currentTemplate === 'qimen' ? '.qimen-cell' : currentTemplate === 'bazi' ? '.bazi-cell' : '.hex-card';
  // 放大特写退场：先挂退出动画类，等缩回原尺寸后再清掉定位变量。
  function releaseZoom(cell) {
    if (!cell.classList.contains('quick-zoom') && !cell.classList.contains('quick-zoom-out')) return;
    cell.classList.remove('quick-zoom');
    cell.classList.add('quick-zoom-out');
    clearTimeout(cell._zoomOutTimer);
    cell._zoomOutTimer = setTimeout(() => {
      cell._zoomOutTimer = null;
      cell.classList.remove('quick-zoom-out');
      cell.style.removeProperty('--focus-x');
      cell.style.removeProperty('--focus-y');
    }, 320);
  }
  function clearPalaceQuickFocus() {
    $$('.qimen-board, .bazi-board, .meihua-board', boardContent).forEach(board => {
      board.classList.remove('quick-focus-active', 'quick-dim-others');
      $$('.qimen-cell, .bazi-cell, .hex-card', board).forEach(el => {
        el.classList.remove('quick-focus','quick-spotlight','quick-lift');
        if (el.classList.contains('quick-zoom')) { releaseZoom(el); return; }
        el.style.removeProperty('--focus-x');
        el.style.removeProperty('--focus-y');
      });
    });
    lastPalaceClick = null;
    lastBaziClick = null;
    lastMeihuaClick = null;
    palaceEffectStep = 0;
    focusOrder = [];
    clearTimeout(focusAutoTimer);
    focusAutoTimer = null;
  }
  // 高亮与浮起共用一套 CSS 状态：面板按钮、再次单击轮转、自动效果都走这里。
  function applyQuickState(ids, kind, dim = false) {
    const board = $('.qimen-board, .bazi-board, .meihua-board', boardContent);
    if (!board) return;
    board.classList.add('quick-focus-active');
    $$(quickCellSelector(), board).forEach(el => {
      el.classList.remove('quick-focus','quick-spotlight','quick-lift');
      if (el.classList.contains('quick-zoom')) releaseZoom(el);
    });
    ids.forEach(id => findTarget(id)?.classList.add('quick-focus', kind));
    board.classList.toggle('quick-dim-others', dim);
    // 面板按钮与自动效果也落到轮转的同一阶段，后续点击继续多选并重新计时。
    palaceEffectStep = kind === 'quick-lift' ? 1 : 2;
    focusOrder = ids.slice(0, 3);
    if (currentTemplate === 'qimen') lastPalaceClick = ids[0];
    else if (currentTemplate === 'bazi') lastBaziClick = ids[0];
    else lastMeihuaClick = ids[0];
  }
  function scheduleFocusAutoEffect() {
    clearTimeout(focusAutoTimer);
    focusAutoTimer = null;
    if (palaceEffectStep !== 1 && palaceEffectStep !== 2) return;
    const step = palaceEffectStep;
    focusAutoTimer = setTimeout(() => {
      focusAutoTimer = null;
      const ids = focusOrder.slice(0, 3);
      if (step === 1) {
        // 局部浮起阶段：停手后自动多方汇聚，其余保持明亮。
        if (ids.length < 2) return;
        playEffect('relation.flow', ids);
        notify('停顿 1.5 秒：已自动触发多方汇聚。');
      } else {
        // 聚光高亮阶段：停手后自动作用制化，其余变暗。
        if (ids.length < 2) return;
        playEffect('relation.suppress', ids);
        notify('停顿 1.5 秒：已自动触发作用制化。');
      }
    }, 1500);
  }
  function applyPalaceQuickFocus(id, dir = 1) {
    const board = $('.qimen-board, .bazi-board, .meihua-board', boardContent);
    if (!board) return;
    const cell = findTarget(id);
    if (!cell) return;
    const cellSelector = quickCellSelector();
    palaceEffectStep = dir > 0 ? palaceEffectStep % 3 + 1 : (palaceEffectStep + 1) % 3 + 1;
    board.classList.add('quick-focus-active');
    $$(cellSelector, board).forEach(el => {
      el.classList.remove('quick-focus','quick-spotlight','quick-lift');
      if (el.classList.contains('quick-zoom')) { releaseZoom(el); return; }
      el.style.removeProperty('--focus-x');
      el.style.removeProperty('--focus-y');
    });
    cell.classList.add('quick-focus');
    if (palaceEffectStep === 1) cell.classList.add('quick-lift');
    else if (palaceEffectStep === 2) cell.classList.add('quick-spotlight');
    if (palaceEffectStep === 3) {
      cell.classList.add('quick-spotlight');
      const boardRect = board.getBoundingClientRect();
      const cellRect = cell.getBoundingClientRect();
      const dx = boardRect.left + boardRect.width / 2 - (cellRect.left + cellRect.width / 2);
      const dy = boardRect.top + boardRect.height / 2 - (cellRect.top + cellRect.height / 2);
      cell.style.setProperty('--focus-x', `${dx}px`);
      cell.style.setProperty('--focus-y', `${dy}px`);
      clearTimeout(cell._zoomOutTimer);
      cell._zoomOutTimer = null;
      cell.classList.remove('quick-zoom-out');
      cell.classList.add('quick-zoom');
    }
    board.classList.toggle('quick-dim-others', palaceEffectStep === 3);
    const unit = currentTemplate === 'qimen' ? '宫位' : '对象';
    const labels = ['',`局部浮起（可继续点其他${unit}多选）`,`聚光高亮（文字浮动，其他${unit}保持明亮）`,`${unit}放大特写（1.5 倍居中）`];
    focusOrder = [id];
    syncFocusTargets();
    scheduleFocusAutoEffect();
    notify(labels[palaceEffectStep]);
  }
  function isQimenCorner(key) { return qimenCornerKeys.has(key); }
  function exitQimenPatternMode() {
    qimenPatterns.mode = null;
    clearTimeout(qimenPatternTimer);
    qimenPatternTimer = null;
    $('.qimen-board', boardContent)?.classList.remove('pattern-mode');
    $$('[data-qimen-pattern]', boardContent).forEach(btn => btn.classList.remove('active'));
  }
  function setQimenPatternMode(mode) {
    const next = qimenPatterns.mode === mode ? null : mode;
    clearTimeout(qimenPatternTimer);
    qimenPatternTimer = null;
    qimenPatterns.mode = next;
    $('.qimen-board', boardContent)?.classList.toggle('pattern-mode', !!next);
    $$('[data-qimen-pattern]', boardContent).forEach(btn =>
      btn.classList.toggle('active', btn.dataset.qimenPattern === next));
    notify(next === 'circle' ? '圆圈：1 秒内可连续点选多个宫位。'
      : next === 'horse' ? '飞马：点一个角宫放置（单选）。' : '已退出图案添加。');
  }
  function applyQimenPattern(id) {
    const key = id.split('.').pop();
    const cell = findTarget(id);
    if (!cell) return;
    if (qimenPatterns.mode === 'circle') {
      const on = !qimenPatterns.rings.has(key);
      if (on) qimenPatterns.rings.add(key); else qimenPatterns.rings.delete(key);
      const existing = cell.querySelector('.qimen-ring-slot');
      if (on && !existing) {
        const ring = document.createElement('span');
        ring.className = 'qimen-ring-slot';
        ring.setAttribute('aria-hidden', 'true');
        cell.appendChild(ring);
      } else if (!on) existing?.remove();
      clearTimeout(qimenPatternTimer);
      qimenPatternTimer = setTimeout(exitQimenPatternMode, 1000);
      notify(on ? `已为${cell.dataset.label}添加圆圈。` : `已移除${cell.dataset.label}的圆圈。`);
      return;
    }
    if (qimenPatterns.mode === 'horse') {
      if (!isQimenCorner(key)) { notify('飞马只能放在乾、艮、巽、坤四宫。'); return; }
      const next = qimenPatterns.horse === key ? null : key;
      qimenPatterns.horse = next;
      $$('.qimen-horse-slot', boardContent).forEach(el => el.remove());
      if (next) {
        const horse = document.createElement('span');
        horse.className = 'qimen-horse-slot';
        horse.setAttribute('aria-hidden', 'true');
        horse.textContent = '♞';
        cell.appendChild(horse);
      }
      exitQimenPatternMode();
      notify(next ? `已在${cell.dataset.label}外角放置飞马。` : '已移除飞马。');
    }
  }
  function wireQimenPatterns() {
    $$('[data-qimen-pattern]', boardContent).forEach(btn =>
      btn.addEventListener('click', () => setQimenPatternMode(btn.dataset.qimenPattern)));
    $('.qimen-board', boardContent)?.classList.toggle('pattern-mode', !!qimenPatterns.mode);
    $$('[data-qimen-pattern]', boardContent).forEach(btn =>
      btn.classList.toggle('active', btn.dataset.qimenPattern === qimenPatterns.mode));
  }
  // The second click on the same anchor fires at once. A double click cancels the
  // highlight it just started (qimen classes / the bazi highlight handle).
  function handleAnchorSecondary(id) {
    const lastClick = currentTemplate === 'qimen' ? lastPalaceClick
      : currentTemplate === 'bazi' ? lastBaziClick : lastMeihuaClick;
    if (id === selectedId && lastClick === id) applyPalaceQuickFocus(id);
  }
  function handleAnchorClick(id, target) {
    if (currentTemplate === 'qimen' && qimenPatterns.mode && id.startsWith('qimen.palace.')) {
      applyQimenPattern(id);
      return;
    }
    const now = performance.now();
    const isDouble = id === lastAnchorPress.id && now - lastAnchorPress.time < ANCHOR_DOUBLE_MS;
    lastAnchorPress = { id: isDouble ? null : id, time: now };
    if (isDouble) { openAnchorEditor(id, target); return; }
    const cellPrefix = currentTemplate === 'qimen' ? 'qimen.palace.'
      : currentTemplate === 'bazi' ? 'bazi.' : 'meihua.slot.';
    if (id.startsWith(cellPrefix)) {
      const board = $('.qimen-board, .bazi-board, .meihua-board', boardContent);
      const cell = findTarget(id);
      const lastClick = currentTemplate === 'qimen' ? lastPalaceClick
        : currentTemplate === 'bazi' ? lastBaziClick : lastMeihuaClick;
      if (board?.classList.contains('quick-focus-active') && cell) {
        const focused = cell.classList.contains('quick-focus');
        // Clicking the primary focus cell again advances the focus sequence.
        if (focused && id === lastClick) { handleAnchorSecondary(id); return; }
        if (focused) {
          cell.classList.remove('quick-focus', 'quick-spotlight');
          if (cell.classList.contains('quick-zoom')) releaseZoom(cell);
          else {
            cell.style.removeProperty('--focus-x');
            cell.style.removeProperty('--focus-y');
          }
          if (!$$(`${quickCellSelector()}.quick-focus`, board).length) { clearPalaceQuickFocus(); return; }
          focusOrder = focusOrder.filter(entry => entry !== id);
        } else {
          cell.classList.add('quick-focus', palaceEffectStep === 1 ? 'quick-lift' : 'quick-spotlight');
          $$(`${quickCellSelector()}.quick-zoom`, board).forEach(el => releaseZoom(el));
          if (palaceEffectStep === 3) board.classList.add('quick-dim-others');
          if (!focusOrder.length) focusOrder = $$(`${quickCellSelector()}.quick-focus`, board).map(el => el.dataset.elementId);
          focusOrder.push(id);
        }
        syncFocusTargets();
        scheduleFocusAutoEffect();
        notify(focused ? '已移出聚光。' : (palaceEffectStep === 1 ? '已加入局部浮起。' : '已加入聚光，文字浮动。'));
        return;
      }
    }
    const repeat = id === selectedId && ((currentTemplate === 'qimen' && lastPalaceClick === id)
      || (currentTemplate === 'bazi' && lastBaziClick === id)
      || (currentTemplate === 'meihua' && lastMeihuaClick === id));
    if (repeat) { handleAnchorSecondary(id); return; }
    clearPalaceQuickFocus();
    if (currentTemplate === 'qimen') lastPalaceClick = id;
    else if (currentTemplate === 'bazi') lastBaziClick = id;
    else lastMeihuaClick = id;
    selectElement(id);
  }
  // 内外盘分界线：按宫格实际间隙取中线，窗口/栏宽变化后重算（offset* 不受动效缩放影响）。
  function layoutDunLine() {
    const board = boardContent.querySelector('.qimen-board');
    const path = board && board.querySelector('.qimen-dun-line path');
    if (!path) return;
    const box = key => {
      const el = board.querySelector(`[data-element-id="qimen.palace.${key}"]`);
      if (!el) return null;
      const l = el.offsetLeft, t = el.offsetTop;
      return { l, t, r: l + el.offsetWidth, b: t + el.offsetHeight };
    };
    const a = box('xun'), m = box('li'), c = box('kun'), mid = box('zhen'), bottom = box('gen');
    if (!a || !m || !c || !mid || !bottom || !board.clientWidth) return;
    const sx = 300 / board.clientWidth;
    const sy = 300 / board.clientHeight;
    const x1 = ((a.r + m.l) / 2) * sx;
    const x2 = ((m.r + c.l) / 2) * sx;
    const y1 = ((a.b + mid.t) / 2) * sy;
    const y2 = ((mid.b + bottom.t) / 2) * sy;
    const cut = qimenMeta.isYangDun ? y1 : y2;
    path.setAttribute('d', `M${x1.toFixed(2)} 0V${cut.toFixed(2)}H${x2.toFixed(2)}V300`);
  }
  function fitStageBoard() {
    const slot = $('.stage-board-slot');
    if (!slot) return;
    const width = slot.clientWidth;
    const height = slot.clientHeight;
    if (!width || !height) return;
    const boardWidth = Math.min(width, height * 16 / 9);
    const boardHeight = boardWidth * 9 / 16;
    stageBoard.style.width = `${boardWidth}px`;
    stageBoard.style.height = `${boardHeight}px`;
    overlay.setAttribute('viewBox', `0 0 ${LOGICAL_W} ${LOGICAL_H}`);
    overlay.setAttribute('preserveAspectRatio', 'none');
    layoutDunLine();
  }

  // Nine-grid reading order follows the user's requested anchor: 乾1 at bottom-right,
  // 坎2 at bottom-middle, then the remaining palaces are numbered around the outer ring.
  // Defaults are the 2026-10-07 23:00 拆补 chart (阴一局) so the demo opens on real data;
  // 排盘 replaces them from 年月日时. State letters follow each palace's own branches:
  // 四隅宫两支只按该宫地盘干的阴阳取一支，状态仍是一个字。
  const qimenPalaces = [
    { key:'xun', name:'巽', number:5, heaven:'乙', heavenState:'沐', earth:'丁', earthState:'帝', extra:'癸', extraState:'胎', extraEarth:'', extraEarthState:'', deity:'九天', star:'天芮', starState:'囚', door:'生门', doorState:'制' },
    { key:'li', name:'离', number:6, heaven:'辛', heavenState:'病', earth:'己', earthState:'临', extra:'', extraState:'', deity:'九地', star:'天柱', starState:'囚', door:'伤门', doorState:'相' },
    { key:'kun', name:'坤', number:7, heaven:'壬', heavenState:'养', earth:'乙', earthState:'养', extra:'', extraState:'', extraEarth:'癸', extraEarthState:'墓', deity:'玄武', star:'天心', starState:'废', door:'杜门', doorState:'迫' },
    { key:'zhen', name:'震', number:4, heaven:'己', heavenState:'病', earth:'丙', earthState:'沐', extra:'', extraState:'', deity:'值符', star:'天英', starState:'废', door:'休门', doorState:'相' },
    { key:'center', name:'中', number:9, heaven:'', heavenState:'', earth:'', earthState:'', extra:'', extraState:'', deity:'', star:'', starState:'', door:'', doorState:'' },
    { key:'dui', name:'兑', number:8, heaven:'戊', heavenState:'死', earth:'辛', earthState:'临', extra:'', extraState:'', deity:'白虎', star:'天蓬', starState:'废', door:'景门', doorState:'迫' },
    { key:'gen', name:'艮', number:3, heaven:'丁', heavenState:'死', earth:'庚', earthState:'绝', extra:'', extraState:'', deity:'腾蛇', star:'天辅', starState:'休', door:'开门', doorState:'义' },
    { key:'kan', name:'坎', number:2, heaven:'丙', heavenState:'胎', earth:'戊', earthState:'胎', extra:'', extraState:'', deity:'太阴', star:'天冲', starState:'废', door:'惊门', doorState:'相' },
    { key:'qian', name:'乾', number:1, heaven:'庚', heavenState:'衰', earth:'壬', earthState:'冠', extra:'', extraState:'', deity:'六合', star:'天任', starState:'旺', door:'死门', doorState:'相' },
  ];
  const qimenElements = qimenPalaces.map(p => [`qimen.palace.${p.key}`, `${p.name}${p.number}宫`, '九宫宫位']);
  // 左侧记录 / 右侧盘面信息；默认值即上面这张示例盘，起局后整体替换。
  const qimenMeta = {
    solar: '2026年10月7日 23:00',
    lunar: '二〇二六年八月廿七 子时',
    pillars: [['年', '丙午'], ['月', '丁酉'], ['日', '乙卯'], ['时', '丙子']],
    xunShou: '甲戌己',
    zhiFu: '天英',
    zhiShi: '景门',
    kongWang: '申酉',
    horse: '寅',
    question: '',
    // 开局盘是阴遁 1 局；起局后按实际局数改写。
    isYangDun: false,
  };
  const baziStems = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'];
  const baziBranches = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
  const lifeStates = ['长生','沐浴','冠带','临官','帝旺','衰','病','死','墓','绝','胎','养'];
  const lifeIndex = state => lifeStates.findIndex(name => name[0] === state);
  const starStates = ['旺','相','休','囚','废'];
  const doorStates = ['和','相','义','制','迫'];
  // ── 奇门排盘后的推导表 ───────────────────────────
  // 十二长生: 阳干顺行、阴干逆行; 土按本盘约定戊起寅、己起酉 (与样例盘逐宫一致).
  const lifeStartBranch = { 甲:'亥', 乙:'午', 丙:'寅', 丁:'酉', 戊:'寅', 己:'酉', 庚:'巳', 辛:'子', 壬:'申', 癸:'卯' };
  const yangStems = new Set(['甲','丙','戊','庚','壬']);
  const yangBranches = new Set(['子','寅','辰','午','申','戌']);
  const palaceBranches = { kan:['子'], gen:['丑','寅'], zhen:['卯'], xun:['辰','巳'], li:['午'], kun:['未','申'], dui:['酉'], qian:['戌','亥'], center:[] };
  const qimenCornerKeys = new Set(['qian', 'gen', 'xun', 'kun']);
  const palaceElement = { kan:'水', gen:'土', zhen:'木', xun:'木', li:'火', kun:'土', dui:'金', qian:'金', center:'土' };
  const starElement = { 天蓬:'水', 天芮:'土', 天冲:'木', 天辅:'木', 天禽:'土', 天心:'金', 天柱:'金', 天任:'土', 天英:'火' };
  const doorElement = { 休门:'水', 生门:'土', 伤门:'木', 杜门:'木', 景门:'火', 死门:'土', 惊门:'金', 开门:'金' };
  const generates = { 木:'火', 火:'土', 土:'金', 金:'水', 水:'木' };
  const qimenKeyByName = { 坎:'kan', 坤:'kun', 震:'zhen', 巽:'xun', 中:'center', 乾:'qian', 兑:'dui', 艮:'gen', 离:'li' };
  // 四隅宫有两支时，按参考干支的阴阳取支（阳取阳支、阴取阴支）；四正宫只有一支。
  // 十二长生看地盘干、旬首关系看旬支，都走这一套。
  function palaceBranch(key, isYang) {
    const branches = palaceBranches[key] || [];
    if (branches.length < 2) return branches[0] || '';
    return branches.find(branch => yangBranches.has(branch) === isYang) || branches[0];
  }
  function lifeBranch(refStem, key) {
    return palaceBranch(key, yangStems.has(refStem));
  }
  function lifeText(stem, key, refStem = stem) {
    if (!stem || !lifeStartBranch[stem]) return '';
    const branch = lifeBranch(refStem || stem, key);
    const start = baziBranches.indexOf(lifeStartBranch[stem]);
    const index = baziBranches.indexOf(branch);
    if (index < 0) return '';
    const step = yangStems.has(stem) ? (index - start + 12) % 12 : (start - index + 12) % 12;
    return lifeStates[step][0];
  }
  // 九星旺衰按与宫位五行的关系; 八门和相义制迫同法, 二者方向不同 (对照样例盘).
  function starStateFor(star, key) {
    const s = starElement[star]; const p = palaceElement[key];
    if (!s || !p) return '';
    if (s === p) return '相';
    if (generates[s] === p) return '旺';
    if (beats(s, p)) return '休';
    if (generates[p] === s) return '废';
    return '囚';
  }
  function beats(a, b) { const overcomes = { 木:'土', 土:'水', 水:'火', 火:'金', 金:'木' }; return overcomes[a] === b; }
  function doorStateFor(door, key) {
    const d = doorElement[door]; const p = palaceElement[key];
    if (!d || !p) return '';
    if (d === p) return '和';
    if (generates[d] === p) return '相';
    if (generates[p] === d) return '义';
    return beats(d, p) ? '迫' : '制';
  }
  // ── 宫位格局 ───────────────────────────────────
  // 十干克应（天盘干+地盘干，81 组），名称与断语按通行本整理。
  const qimenKeCheng = {
    '乙乙': ['日奇伏吟', '不宜谒贵求名，只可安分守身。', '凶'],
    '乙丙': ['奇仪顺遂', '吉事为迁官进职；凶事为夫妻离别。', '吉'],
    '乙丁': ['奇仪相佐', '文书事吉，百事皆可为。', '吉'],
    '乙戊': ['利阴害阳', '门逢凶迫，财破人伤。', '凶'],
    '乙己': ['日奇入雾', '被土暗昧，门凶必凶；得开门为地遁。', '凶'],
    '乙庚': ['日奇被刑', '争讼败产，夫妻怀私。', '凶'],
    '乙辛': ['青龙逃走', '奴仆拐带，六畜皆伤。', '凶'],
    '乙壬': ['日奇入地', '尊卑悖乱，官讼是非。', '凶'],
    '乙癸': ['华盖逢星', '遁迹修道，隐匿藏形，避灾避难为吉。', '平'],
    '丙乙': ['日月并行', '公谋私为皆吉。', '吉'],
    '丙丙': ['月奇悖师', '文书逼迫，破耗遗失。', '凶'],
    '丙丁': ['月奇朱雀', '贵人文书吉利，常人平静；得生门为天遁。', '吉'],
    '丙戊': ['飞鸟跌穴', '谋为百事吉顺洞彻，可不劳而获。', '吉'],
    '丙己': ['火悖入刑', '囚人刑杖，文书不行；吉门得吉，凶门转凶。', '凶'],
    '丙庚': ['荧入太白', '门户破败，盗贼耗失。', '凶'],
    '丙辛': ['丙辛相合', '谋事能成，病人不凶。', '吉'],
    '丙壬': ['火入天罗', '为客不利，是非颇多。', '凶'],
    '丙癸': ['华盖悖师', '阴人害事，灾祸频生。', '凶'],
    '丁乙': ['人遁吉格', '贵人加官进爵，常人婚姻财喜。', '吉'],
    '丁丙': ['星随月转', '贵人越级高升；常人乐中生悲。', '平'],
    '丁丁': ['奇入太阴', '文书即至，喜事遂心。', '吉'],
    '丁戊': ['青龙转光', '贵人升迁，常人威昌。', '吉'],
    '丁己': ['火入勾陈', '奸私仇冤，事因女人。', '凶'],
    '丁庚': ['文书阻隔', '行人必归。', '平'],
    '丁辛': ['朱雀入狱', '罪人释囚，官人失位。', '平'],
    '丁壬': ['五神互合', '贵人恩诏，讼狱公平。', '吉'],
    '丁癸': ['朱雀投江', '音信沉溺，文书口舌是非，词讼不利。', '凶'],
    '戊乙': ['青龙合灵', '门吉事吉，门凶事凶。', '门定'],
    '戊丙': ['青龙返首', '动作大吉；若逢墓迫击刑，吉事成凶。', '吉'],
    '戊丁': ['青龙耀明', '谒贵求名吉利；若值墓迫，招惹是非。', '吉'],
    '戊戊': ['青龙伏吟', '凡事闭塞阻滞，静守为吉。', '凶'],
    '戊己': ['贵人入狱', '公私皆不利。', '凶'],
    '戊庚': ['值符飞宫', '吉事不吉，凶事更凶，主换地方。', '凶'],
    '戊辛': ['青龙折足', '吉门生助尚可谋为；凶门招灾失财、防足疾。', '凶'],
    '戊壬': ['青龙入天牢', '阴阳事皆不吉。', '凶'],
    '戊癸': ['青龙华盖', '门吉多招福，门凶多破败。', '门定'],
    '己乙': ['墓神不明', '地户逢星，宜遁迹隐形。', '平'],
    '己丙': ['火悖地户', '阳人冤冤相害，阴人必致淫污。', '凶'],
    '己丁': ['朱雀入墓', '文状词讼，先曲后直。', '平'],
    '己戊': ['犬遇青龙', '门吉谋望遂意，门凶枉费心机。', '门定'],
    '己己': ['地户逢鬼', '病者必死，百事不遂。', '凶'],
    '己庚': ['刑格返名', '词讼先动者不利，阴星有谋害之情。', '凶'],
    '己辛': ['游魂入墓', '易遇阴邪鬼魅作祟。', '凶'],
    '己壬': ['地网高张', '狡童佚女，奸情伤杀。', '凶'],
    '己癸': ['地刑玄武', '男女疾病垂危，囚狱词讼之灾。', '凶'],
    '庚乙': ['太白蓬星', '退吉进凶。', '凶'],
    '庚丙': ['太白入荧', '占贼必来，为客进利，为主破财。', '凶'],
    '庚丁': ['亭亭之格', '因私匿起官司，门吉有救。', '凶'],
    '庚戊': ['天乙伏宫', '谋为百事皆凶。', '凶'],
    '庚己': ['刑格', '官讼判刑，牢狱更凶。', '凶'],
    '庚庚': ['太白同宫', '又名战格：官灾横祸，兄弟雷攻。', '凶'],
    '庚辛': ['白虎干格', '远行必凶，车折马伤；求财大凶。', '凶'],
    '庚壬': ['上格', '又名小格、移荡格：远行迷失道路，音信难通。', '凶'],
    '庚癸': ['大格', '行人不至，官司不止，多主车祸，大凶。', '凶'],
    '辛乙': ['白虎猖狂', '人亡家败，远得多殃，尊长不喜，车船俱伤。', '凶'],
    '辛丙': ['干合悖师', '占事必因财致讼。', '凶'],
    '辛丁': ['狱神得奇', '经商获倍利，囚人逢赦宥。', '吉'],
    '辛戊': ['困龙被伤', '官司破败，屈抑守分吉，妄动祸殃。', '凶'],
    '辛己': ['入狱自刑', '奴仆背主，讼诉难伸。', '凶'],
    '辛庚': ['白虎出力', '刀刃相接，主客相残。', '凶'],
    '辛辛': ['伏吟天庭', '公废私就，讼狱自罹罪名。', '凶'],
    '辛壬': ['凶蛇入狱', '两男争女，讼狱不息，先动失理。', '凶'],
    '辛癸': ['天牢华盖', '日月失明，误入天网，动止乖张。', '凶'],
    '壬乙': ['小蛇日奇', '女子柔顺，男人嗟叹；占孕生子，禄马光华。', '吉'],
    '壬丙': ['水蛇入火', '官灾刑禁，络绎不绝。', '凶'],
    '壬丁': ['干合蛇刑', '文书牵连，贵人匆匆，男吉女凶。', '平'],
    '壬戊': ['小蛇化龙', '男人发达，女产婴童。', '吉'],
    '壬己': ['反吟蛇刑', '大祸将至，顺守斯吉，词讼理屈。', '凶'],
    '壬庚': ['太白擒蛇', '刑狱公平，立剖邪正。', '平'],
    '壬辛': ['腾蛇相缠', '纵得吉门亦不能安；谋望被人欺瞒。', '凶'],
    '壬壬': ['蛇入地罗', '外人缠绕，内事索索。', '凶'],
    '壬癸': ['幼女奸淫', '家有丑声，门吉星凶。', '凶'],
    '癸乙': ['华盖蓬星', '贵人禄位，常人平安。', '吉'],
    '癸丙': ['华盖悖师', '贵贱逢之皆不利，唯上人见喜。', '平'],
    '癸丁': ['腾蛇夭矫', '文书官司，火焚莫逃。', '凶'],
    '癸戊': ['天乙会合', '财喜婚姻，吉人赞助；门凶迫制反招官非。', '门定'],
    '癸己': ['华盖地户', '男女占之，音信皆阻，躲灾避难为吉。', '平'],
    '癸庚': ['太白入网', '以暴争讼力平。', '凶'],
    '癸辛': ['网盖天牢', '占病占讼，死罪莫逃。', '凶'],
    '癸壬': ['复见腾蛇', '嫁娶重婚，后嫁无子，不保年华。', '凶'],
    '癸癸': ['天网四张', '行人失伴，病讼皆伤。', '凶'],
  };
  const qimenJiXing = { 戊:'zhen', 己:'kun', 庚:'gen', 辛:'li', 壬:'xun', 癸:'xun' };
  // 旬首关系：六仪各为旬首（甲子戊、甲戌己、甲申庚、甲午辛、甲辰壬、甲寅癸），
  // 用旬支对宫位地支判六害、六冲、六合；三奇不是旬首，不参与。
  const qimenXunBranch = { 戊:'子', 己:'戌', 庚:'申', 辛:'午', 壬:'辰', 癸:'寅' };
  // 每个六仪只有一个固定受害宫，例如甲子戊落坤宫为子未害。
  const qimenLiuHai = { 戊:'未', 己:'酉', 庚:'亥', 辛:'丑', 壬:'卯', 癸:'巳' };
  const qimenLiuChong = [['子','午'],['丑','未'],['寅','申'],['卯','酉'],['辰','戌'],['巳','亥']];
  const qimenLiuHe = [['子','丑'],['寅','亥'],['卯','戌'],['辰','酉'],['巳','申'],['午','未']];
  const branchPairHit = (pairs, a, b) => pairs.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
  // 害、冲、合：用该宫实际落到的那一支判——取支与十二长生同一套（按地盘干的阴阳，
  // 阳干取阳支、阴干取阴支），不是拿宫位所带的两支都比一遍。
  const qimenRelation = (stem, key, refStem) => {
    const xun = qimenXunBranch[stem];
    if (!xun) return '';
    const branch = palaceBranch(key, yangStems.has(refStem || stem));
    if (!branch) return '';
    if (qimenLiuHai[stem] === branch) return 'hai';
    if (branchPairHit(qimenLiuChong, xun, branch)) return 'chong';
    if (branchPairHit(qimenLiuHe, xun, branch)) return 'he';
    return '';
  };
  const QIMEN_HAI_MARK = '<svg class="qimen-hai-slot" viewBox="0 0 10 9" aria-hidden="true"><path d="M5 0 10 9H0z"/></svg>';
  const QIMEN_JIXING_MARK = '<svg class="qimen-jixing-slot" viewBox="0 0 10 14" aria-hidden="true"><path d="M6.2 0 0 8.2h3.6L2.6 14 9.6 5.4H6z"/></svg>';
  const qimenRuMu = { 乙:'qian', 丙:'qian', 丁:'gen' };
  const starHome = { 天蓬:'kan', 天芮:'kun', 天冲:'zhen', 天辅:'xun', 天禽:'center', 天心:'qian', 天柱:'dui', 天任:'gen', 天英:'li' };
  const doorHome = { 休门:'kan', 生门:'gen', 伤门:'zhen', 杜门:'xun', 景门:'li', 死门:'kun', 惊门:'dui', 开门:'qian' };
  const palaceOpposite = { kan:'li', li:'kan', zhen:'dui', dui:'zhen', xun:'qian', qian:'xun', gen:'kun', kun:'gen', center:'center' };
  const starStateNote = { 旺:'星气得势', 相:'与宫同气', 休:'星气已退', 囚:'受宫制约', 废:'星气尽' };
  const doorStateNote = { 和:'门宫同气', 相:'门生宫，吉', 义:'宫生门，吉', 制:'宫克门，门力受制', 迫:'门克宫，为门迫，凶' };
  const qimenLevelClass = { 吉:'ji', 凶:'xiong', 平:'ping', 门定:'men' };
  let qimenPatternPanel = null;
  function closeQimenPatternPanel() {
    qimenPatternPanel?.remove();
    qimenPatternPanel = null;
  }
  function qimenRow(kind, main, note) {
    return `<div class="qpp-row"><span class="qpp-k">${kind}</span><span class="qpp-v">${escapeAttr(main)}</span>${note ? `<span class="qpp-t">${escapeAttr(note)}</span>` : ''}</div>`;
  }
  function qimenKeChengRow(kind, up, down) {
    const kc = up && down ? qimenKeCheng[`${up}${down}`] : null;
    if (!kc) return '';
    return `<div class="qpp-row"><span class="qpp-k">${kind}</span><span class="qpp-v">【${up}+${down}】${kc[0]}<i class="qpp-tag ${qimenLevelClass[kc[2]] || 'ping'}">${kc[2]}</i></span><span class="qpp-t">${escapeAttr(kc[1])}</span></div>`;
  }
  function qimenPalaceRows(p) {
    const rows = [];
    [
      qimenKeChengRow('十干克应', p.heaven, p.earth),
      qimenKeChengRow('天盘寄', p.extra, p.earth),
      qimenKeChengRow('地盘寄', p.heaven, p.extraEarth),
    ].forEach(row => { if (row) rows.push(row); });
    if (p.door) rows.push(qimenRow('门宫', `${p.door}临${p.name}宫 · ${p.doorState || '—'}`, doorStateNote[p.doorState] || ''));
    if (p.star) rows.push(qimenRow('星宫', `${p.star}临${p.name}宫 · ${p.starState || '—'}`, starStateNote[p.starState] || ''));
    const branches = palaceBranches[p.key] || [];
    if (qimenJiXing[p.heaven] === p.key) rows.push(qimenRow('击刑', `${p.heaven}落${p.name}宫 · 六仪击刑`, '主刑伤、官讼、内耗。'));
    if (qimenRuMu[p.heaven] === p.key) rows.push(qimenRow('入墓', `${p.heaven}奇落${p.name}宫`, '吉事不显，凶事难解。'));
    const kong = (qimenMeta.kongWang || '').split('').filter(ch => branches.includes(ch));
    if (kong.length) rows.push(qimenRow('空亡', `${p.name}宫 ${branches.join('')} 逢空`, '空则事虚，宜待时。'));
    if (qimenMeta.horse && branches.includes(qimenMeta.horse)) rows.push(qimenRow('马星', `马星在${p.name}宫`, '主动、主远行、主变动。'));
    if (p.star && p.star === qimenMeta.zhiFu) rows.push(qimenRow('值符', `值符星${p.star}落本宫`, '全盘主事之神。'));
    if (p.door && p.door === qimenMeta.zhiShi) rows.push(qimenRow('值使', `值使门${p.door}落本宫`, '全盘执行之门。'));
    if (starHome[p.star] === p.key || doorHome[p.door] === p.key) rows.push(qimenRow('伏吟', '星或门仍在本宫', '伏吟主静、主迟。'));
    if (palaceOpposite[starHome[p.star]] === p.key || palaceOpposite[doorHome[p.door]] === p.key) rows.push(qimenRow('反吟', '星或门落对宫', '反吟主动、主反复。'));
    return rows;
  }
  function qimenPatternHtml(p) {
    const head = `<div class="qpp-head"><b>${p.name}${p.number}宫</b><i>${palaceElement[p.key] || '土'}</i><button class="qpp-close" data-qpp-close type="button" aria-label="关闭">×</button></div>`;
    if (p.key === 'center') return `${head}<div class="qpp-sub">中宫无门无星，天禽寄坤二宫，地盘干寄坤。</div>`;
    const sub = `${p.deity || '—'} · ${p.star || '—'}${p.starState ? `（${p.starState}）` : ''} · ${p.door || '—'}${p.doorState ? `（${p.doorState}）` : ''}`;
    const stems = `天盘 ${p.heaven || '—'}　地盘 ${p.earth || '—'}${p.extra ? `　天盘寄 ${p.extra}` : ''}${p.extraEarth ? `　地盘寄 ${p.extraEarth}` : ''}`;
    const rows = qimenPalaceRows(p).join('');
    return `${head}<div class="qpp-sub">${escapeAttr(sub)}</div><div class="qpp-stems">${escapeAttr(stems)}</div><div class="qpp-body">${rows || '<div class="qpp-empty">本宫无特殊格局。</div>'}</div>`;
  }
  function openQimenPatternPanel(cell, p) {
    closeQimenPatternPanel();
    const panel = document.createElement('div');
    panel.className = 'qimen-pattern-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', `${p.name}${p.number}宫格局`);
    panel.innerHTML = qimenPatternHtml(p);
    document.body.appendChild(panel);
    const rect = cell.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    let left = rect.right + 12;
    if (left + width > window.innerWidth - 12) left = rect.left - width - 12;
    if (left < 12) left = Math.max(12, window.innerWidth - width - 12);
    const top = Math.min(Math.max(12, rect.top), Math.max(12, window.innerHeight - height - 12));
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
    panel.querySelector('[data-qpp-close]')?.addEventListener('click', closeQimenPatternPanel);
    qimenPatternPanel = panel;
  }
  document.addEventListener('pointerdown', (event) => {
    if (qimenPatternPanel && !qimenPatternPanel.contains(event.target)) closeQimenPatternPanel();
  });
  const deityOptions = ['值符','腾蛇','太阴','六合','白虎','玄武','九地','九天'];
  const starOptions = ['天蓬','天芮','天冲','天辅','天禽','天心','天柱','天任','天英'];
  const doorOptions = ['休门','生门','伤门','杜门','景门','死门','惊门','开门','中门'];
  const trigramOptions = [
    { value: '乾', symbol: '☰', name: '乾' }, { value: '兑', symbol: '☱', name: '兑' },
    { value: '离', symbol: '☲', name: '离' }, { value: '震', symbol: '☳', name: '震' },
    { value: '巽', symbol: '☴', name: '巽' }, { value: '坎', symbol: '☵', name: '坎' },
    { value: '艮', symbol: '☶', name: '艮' }, { value: '坤', symbol: '☷', name: '坤' },
  ];
  const trigramElement = { 乾: '金', 兑: '金', 震: '木', 巽: '木', 坎: '水', 离: '火', 艮: '土', 坤: '土' };
  // Top-to-bottom lines, 1 = solid, 0 = broken. SVG ink is exactly centred in the cell.
  const trigramLines = {
    乾: [1, 1, 1], 兑: [0, 1, 1], 离: [1, 0, 1], 震: [0, 0, 1],
    巽: [1, 1, 0], 坎: [0, 1, 0], 艮: [1, 0, 0], 坤: [0, 0, 0],
  };
  function trigramSVG(name, moveIndex) {
    const bars = (trigramLines[name] || trigramLines.坎).map((solid, i) => {
      const y = i * 33;
      const cls = i === moveIndex ? ' class="is-moving"' : '';
      return solid
        ? `<rect${cls} x="0" y="${y}" width="120" height="12"/>`
        : `<rect${cls} x="0" y="${y}" width="48" height="12"/><rect${cls} x="72" y="${y}" width="48" height="12"/>`;
    }).join('');
    return `<svg class="trigram-svg" viewBox="0 0 120 78" aria-hidden="true">${bars}</svg>`;
  }
  // 先天八卦数 1..8，用于梅花起卦；trigramLines 是自上而下，起卦要按自下而上的爻序。
  const meihuaTrigramOrder = ['乾', '兑', '离', '震', '巽', '坎', '艮', '坤'];
  const meihuaBranchOrder = { 子: 1, 丑: 2, 寅: 3, 卯: 4, 辰: 5, 巳: 6, 午: 7, 未: 8, 申: 9, 酉: 10, 戌: 11, 亥: 12 };
  // 六十四卦全名，按「上卦 → 下卦」查。
  const meihuaGuaNames = {
    乾: { 乾: '乾为天', 兑: '天泽履', 离: '天火同人', 震: '天雷无妄', 巽: '天风姤', 坎: '天水讼', 艮: '天山遁', 坤: '天地否' },
    兑: { 乾: '泽天夬', 兑: '兑为泽', 离: '泽火革', 震: '泽雷随', 巽: '泽风大过', 坎: '泽水困', 艮: '泽山咸', 坤: '泽地萃' },
    离: { 乾: '火天大有', 兑: '火泽睽', 离: '离为火', 震: '火雷噬嗑', 巽: '火风鼎', 坎: '火水未济', 艮: '火山旅', 坤: '火地晋' },
    震: { 乾: '雷天大壮', 兑: '雷泽归妹', 离: '雷火丰', 震: '震为雷', 巽: '雷风恒', 坎: '雷水解', 艮: '雷山小过', 坤: '雷地豫' },
    巽: { 乾: '风天小畜', 兑: '风泽中孚', 离: '风火家人', 震: '风雷益', 巽: '巽为风', 坎: '风水涣', 艮: '风山渐', 坤: '风地观' },
    坎: { 乾: '水天需', 兑: '水泽节', 离: '水火既济', 震: '水雷屯', 巽: '水风井', 坎: '坎为水', 艮: '水山蹇', 坤: '水地比' },
    艮: { 乾: '山天大畜', 兑: '山泽损', 离: '山火贲', 震: '山雷颐', 巽: '山风蛊', 坎: '山水蒙', 艮: '艮为山', 坤: '山地剥' },
    坤: { 乾: '地天泰', 兑: '地泽临', 离: '地火明夷', 震: '地雷复', 巽: '地风升', 坎: '地水师', 艮: '地山谦', 坤: '坤为地' },
  };
  const meihuaMovingLabel = ['初爻', '二爻', '三爻', '四爻', '五爻', '上爻'];
  // 中宫：素材库的罗盘动画（透明底）替代宫位字段。
  const baziPillars = [
    { key: 'year', title: '年', stem: '己', branch: '巳', star: '伤官', xunKong: '戌亥', hidden: [{ gan: '丙', ss: '比肩' }, { gan: '庚', ss: '偏财' }, { gan: '戊', ss: '食神' }] },
    { key: 'month', title: '月', stem: '丙', branch: '子', star: '比肩', xunKong: '申酉', hidden: [{ gan: '癸', ss: '正官' }] },
    { key: 'day', title: '日', stem: '丙', branch: '寅', star: '元男', xunKong: '戌亥', hidden: [{ gan: '甲', ss: '偏印' }, { gan: '丙', ss: '比肩' }, { gan: '戊', ss: '食神' }] },
    { key: 'hour', title: '时', stem: '戊', branch: '子', star: '食神', xunKong: '午未', hidden: [{ gan: '癸', ss: '正官' }] },
  ];
  // 流年 / 大运：illustration defaults; 排盘后替换为 lunar-javascript 的大运、流年。
  const baziFortune = [
    { key: 'liunian', title: '流年', stem: '丙', branch: '午', star: '比肩', xunKong: '寅卯', hidden: [{ gan: '丁', ss: '劫财' }, { gan: '己', ss: '伤官' }] },
    { key: 'dayun', title: '大运', stem: '癸', branch: '酉', star: '正官', xunKong: '戌亥', hidden: [{ gan: '辛', ss: '正财' }] },
  ];
  let baziChart = null;
  // 四柱左上角出生日期：排盘或载入案例后写入，公历取阳历输入，农历由历法组件换算。
  let baziMeta = { solar: '', lunar: '' };
  const stemElement = { 甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土', 己: '土', 庚: '金', 辛: '金', 壬: '水', 癸: '水' };
  const branchElement = { 子: '水', 丑: '土', 寅: '木', 卯: '木', 辰: '土', 巳: '火', 午: '火', 未: '土', 申: '金', 酉: '金', 戌: '土', 亥: '水' };
  const wuxingClass = value => `wx-${stemElement[value] || branchElement[value] || '土'}`;
  const elementClass = element => `wx-${element || '土'}`;
  const baziElements = [
    ...baziPillars.map(p => [`bazi.pillar.${p.key}.stem`, `${p.title}干`, '十天干']),
    ...baziPillars.map(p => [`bazi.pillar.${p.key}.branch`, `${p.title}支`, '十二地支']),
    ...baziFortune.map(p => [`bazi.fortune.${p.key}.stem`, `${p.title}干`, '十天干']),
    ...baziFortune.map(p => [`bazi.fortune.${p.key}.branch`, `${p.title}支`, '十二地支']),
  ];
  // 六格 = 本卦 / 互卦 / 变卦 × 上卦 / 下卦。起卦后写入，也可手动下拉改卦。
  const meihuaSlots = [
    { id: 'meihua.slot.01', title: '本卦上', value: '坎' },
    { id: 'meihua.slot.02', title: '互卦上', value: '坤' },
    { id: 'meihua.slot.03', title: '变卦上', value: '震' },
    { id: 'meihua.slot.04', title: '本卦下', value: '巽' },
    { id: 'meihua.slot.05', title: '互卦下', value: '乾' },
    { id: 'meihua.slot.06', title: '变卦下', value: '兑' },
  ];
  const meihuaElements = [...meihuaSlots.map(slot => [slot.id, slot.title, '本互变']), ['meihua.effect', '象意动效位', '装饰']];
  // 最近一次起卦结果；为空时六格只是展示用，不标动爻与体用。
  let meihuaChart = null;
  let meihuaMeta = null;
  let meihuaMode = 'time';
  // 六壬方盘外圈顺时针：上排 巳午未申，右列 酉戌，下排 亥子丑寅，左列 卯辰。
  const liurenSeats = ['巳','午','未','申','酉','戌','亥','子','丑','寅','卯','辰'];
  const liurenElements = [
    ...liurenSeats.map(branch => [`liuren.palace.${branch}`, `${branch}宫`, '天地盘']),
    ['liuren.pass.0', '初传', '三传'], ['liuren.pass.1', '中传', '三传'], ['liuren.pass.2', '末传', '三传'],
    ['liuren.lesson.0', '第一课', '四课'], ['liuren.lesson.1', '第二课', '四课'],
    ['liuren.lesson.2', '第三课', '四课'], ['liuren.lesson.3', '第四课', '四课'],
  ];
  const allTemplates = { qimen: qimenElements, bazi: baziElements, liuren: liurenElements, meihua: meihuaElements };
  function nodeAttrs(id, label, note) { return `tabindex="0" role="group" aria-label="${label}"`; }
  function makeOptions(options, selected) {
    return options.map(value => `<option value="${value}" ${value === selected ? 'selected' : ''}>${value}</option>`).join('');
  }
  // 下拉的完整选项等打开时再填：切换模板时少建几百个 option 节点，平板上明显更快。
  function lazyOptions(options, selected) {
    const current = selected || options[0];
    return `<option value="${current}" selected>${current}</option>`;
  }
  function expandPicker(select) {
    if (!select || select.dataset.expanded === '1' || !select.dataset.opts) return;
    const current = select.value;
    select.innerHTML = makeOptions(select.dataset.opts.split(' '), current);
    select.dataset.expanded = '1';
    if (current) select.value = current;
  }
  // Cell text is abbreviated: deities and stars keep one character, doors their first.
  const deityShort = { 值符:'符', 腾蛇:'蛇', 螣蛇:'蛇', 太阴:'阴', 六合:'合', 白虎:'虎', 玄武:'玄', 九地:'地', 九天:'天' };
  const shortDeity = value => deityShort[value] || value.slice(-1);
  const escapeAttr = value => String(value).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  // 日期里的年/月/日/时按单位字上色，与右侧"标签深黄、内容浅黄"一致；奇门与四柱共用。
  const dateHtml = value => String(value).replace(/[年月日时]/g, ch => `<span class="qimen-unit">${ch}</span>`);
  const shortStar = value => value.slice(-1);
  const shortDoor = value => value.slice(0, 1);
  function shortQimenValue(key, value) {
    if (key === 'deity') return shortDeity(value);
    if (key === 'star') return shortStar(value);
    if (key === 'door') return shortDoor(value);
    return value;
  }
  // 奇门只给八门、九星、天干着色；八神保持金色。开关关闭时不挂 wx-* 类。
  let qimenWuxing = true;
  const qimenElement = value => starElement[value] || doorElement[value] || stemElement[value] || '';
  const qimenWxAttr = (key, value) => {
    if (key === 'deity') return '';
    const element = qimenElement(value);
    return element ? ` data-wx="${element}"` : '';
  };
  const qimenWxClass = (key, value) => {
    if (!qimenWuxing || key === 'deity') return '';
    const element = qimenElement(value);
    return element ? ` wx-${element}` : '';
  };
  function renderQimen() {
    // Each stem shows its own 十二长生 string: one character in every palace;
    // corner palaces pick the branch from the palace's 地盘干 yin/yang.
    // Double-clicking a state opens the 12-state panel for that stem alone.
    const field = (p, key, value, options, stateKey, name, marks = '') => {
      const state = !stateKey ? '' : `<span class="qimen-state" data-qimen-edit="${stateKey}" data-qimen-display="${stateKey}">${p[stateKey] || ''}</span>`;
      return `<span class="qimen-glyph qimen-${key}" data-qimen-edit="${key}"><span class="qimen-line">${marks}<span class="qimen-value${qimenWxClass(key,value)}"${qimenWxAttr(key,value)} data-qimen-display="${key}">${shortQimenValue(key,value)}</span></span>${state}<select class="qimen-picker" data-qimen-field="${key}" data-opts="${options.join(' ')}" aria-label="${p.name}宫${name}">${lazyOptions(options,value)}</select></span>`;
    };
    // 寄宫 sits in its own centre column so the stem lines up with 九星/天盘 (row 2)
    // or 八门/地盘 (row 3).
    const jiField = (p, key, slot, name, marks = '') => !p[key] ? '' : `<span class="qimen-glyph qimen-ji qimen-ji-${slot}" data-qimen-edit="${key}"><span class="qimen-line">${marks}<span class="qimen-value${qimenWxClass(key,p[key])}"${qimenWxAttr(key,p[key])} data-qimen-display="${key}">${p[key]}</span></span><span class="qimen-state" data-qimen-edit="${key}State" data-qimen-display="${key}State">${p[key + 'State'] || ''}</span><select class="qimen-picker" data-qimen-field="${key}" data-opts="${baziStems.join(' ')}" aria-label="${p.name}宫${name}">${lazyOptions(baziStems,p[key])}</select></span>`;
    const emblem = `<div class="qimen-emblem" aria-hidden="true"><img src="assets/library/qimen_bagua.svg" alt="" /></div>`;
    // 旬首是地盘上的那个六仪；值使是当前落宫的八门。
    const xunShouStem = (qimenMeta.xunShou || '').slice(-1);
    // 阳遁 1/8/3/4 宫为内盘，阴遁 9/2/7/6 宫为内盘，内盘连中五宫一起圈住。
    const dunPath = qimenMeta.isYangDun ? 'M100 0V100H200V300' : 'M100 0V200H200V300';
    // 标记贴在触发的字旁边：天干类放左侧（天盘/地盘干靠宫边，左侧留白多），值使门放门字右侧。
    // 绝对定位，不占行内空间，宫内的字不会因为标记出现而挪位。
    const markStack = (tags, side) => tags.length ? `<span class="qimen-mark-stack qimen-mark-${side}">${tags.join('')}</span>` : '';
    const stemTags = (p, field) => {
      const stem = p[field] || '';
      const tags = [];
      // 击刑按天盘六仪（含天盘寄宫干）落宫判断。
      if ((field === 'heaven' || field === 'extra') && qimenJiXing[stem] === p.key) tags.push(QIMEN_JIXING_MARK);
      const relation = qimenRelation(stem, p.key, p.earth);
      if (relation === 'hai') tags.push(QIMEN_HAI_MARK);
      else if (relation === 'chong') tags.push('<i class="qimen-chong-slot">冲</i>');
      else if (relation === 'he') tags.push('<i class="qimen-he-slot">合</i>');
      if (xunShouStem && (field === 'earth' || field === 'extraEarth') && stem === xunShouStem) tags.push('<i class="qimen-xun-slot"></i>');
      return markStack(tags, 'left');
    };
    const doorTags = p => markStack(p.door && p.door === qimenMeta.zhiShi ? ['<i class="qimen-shi-slot"></i>'] : [], 'right');
    const board = `<div class="qimen-board"><svg class="qimen-dun-line" viewBox="0 0 300 300" preserveAspectRatio="none" aria-hidden="true"><path d="${dunPath}"/></svg>${qimenPalaces.map(p => {
      const id = `qimen.palace.${p.key}`;
      const label = `${p.name}${p.number}宫`;
      if (p.key === 'center') {
        return `<div ${nodeAttrs(id,label,'奇门宫位')} class="anchor-node qimen-cell center-cell" data-element-id="${id}" data-label="${label}"><div class="motion-surface" data-motion-surface>${emblem}</div></div>`;
      }
      const core = field(p,'deity',p.deity,deityOptions,null,'八神')
        + field(p,'star',p.star,starOptions,'starState','九星')
        + field(p,'heaven',p.heaven,baziStems,'heavenState','天盘',stemTags(p,'heaven'))
        + field(p,'door',p.door,doorOptions,'doorState','八门',doorTags(p))
        + field(p,'earth',p.earth,baziStems,'earthState','地盘',stemTags(p,'earth'))
        + jiField(p,'extra','heaven','天盘寄宫',stemTags(p,'extra'))
        + jiField(p,'extraEarth','earth','地盘寄宫',stemTags(p,'extraEarth'));
      // Marks exist only after the operator adds them; no empty slots on the palaces.
      const marks = `${qimenPatterns.rings.has(p.key) ? '<span class="qimen-ring-slot" aria-hidden="true"></span>' : ''}${qimenPatterns.horse === p.key ? '<span class="qimen-horse-slot" aria-hidden="true">♞</span>' : ''}`;
      return `<div ${nodeAttrs(id,label,'奇门宫位')} class="anchor-node qimen-cell" data-element-id="${id}" data-label="${label}">${marks}<div class="motion-surface" data-motion-surface><div class="qimen-palace-heading" data-motion-layer>${p.name}</div><div class="qimen-core">${core}</div></div></div>`;
    }).join('')}</div>`;
    const tools = `<div class="qimen-pattern-tools" role="group" aria-label="宫殿图案添加">
      <button type="button" data-qimen-pattern="circle" title="圆圈（1 秒内可多选）" aria-label="圆圈"><b>◯</b></button>
      <button type="button" data-qimen-pattern="horse" title="飞马（单选）" aria-label="飞马"><b>♞</b></button>
    </div>`;
    // 左侧记起卦日期与所问之事；右侧列四柱、旬首与盘面要点。
    const left = `<aside class="qimen-side qimen-side-left" aria-label="起卦记录">
      <div class="qimen-date">${dateHtml(qimenMeta.solar)}</div>
      <div class="qimen-date">${dateHtml(qimenMeta.lunar)}</div>
      <textarea class="qimen-question" rows="1" placeholder="所问之事" aria-label="所问之事">${escapeAttr(qimenMeta.question)}</textarea>
    </aside>`;
    // 右栏四柱分三行：年月日时、天干、地支；要点分两行，标签与内容不同颜色。
    const pillarRow = pick => qimenMeta.pillars.map(([label, value]) => `<span>${pick(label, value)}</span>`).join('');
    const fact = (key, value) => `<span class="qimen-fact"><span class="qimen-k">${key}:</span><span class="qimen-v">${value}</span></span>`;
    const right = `<aside class="qimen-side qimen-side-right" aria-label="四柱与盘面要点">
      <div class="qimen-pillars">
        ${pillarRow(label => label)}
        ${pillarRow((label, value) => value[0])}
        ${pillarRow((label, value) => value[1])}
      </div>
      <div class="qimen-facts">
        <div class="qimen-factline">${fact('旬首', qimenMeta.xunShou)}${fact('值符', qimenMeta.zhiFu)}</div>
        <div class="qimen-factline">${fact('值使', qimenMeta.zhiShi)}${fact('马星', qimenMeta.horse)}${fact('空', qimenMeta.kongWang)}</div>
      </div>
    </aside>`;
    return `<div class="qimen-stage">${left}${board}${tools}${right}</div>`;
  }
  function baziCard(kind, item, field) {
    const isStem = field === 'stem';
    const id = `bazi.${kind}.${item.key}.${field}`;
    const title = `${item.title}${isStem ? '干' : '支'}`;
    const value = item[field];
    const options = isStem ? baziStems : baziBranches;
    const holder = `${kind === 'fortune' ? 'data-fortune' : 'data-pillar'}="${item.key}"`;
    return `<div ${nodeAttrs(id, title, isStem ? '十天干' : '十二地支')} class="anchor-node bazi-cell ${isStem ? 'stem-cell' : 'branch-cell'}${kind === 'fortune' ? ' fortune-cell' : ''}" data-element-id="${id}" data-label="${title} · ${value}"><div class="motion-surface" data-motion-surface><select class="bazi-character-picker ${wuxingClass(value)}" data-bazi-value="${field}" ${holder} data-opts="${options.join(' ')}" aria-label="${title}">${lazyOptions(options,value)}</select></div></div>`;
  }
  // 流年 runs 10 consecutive years from the selected 大运, so the pre-luck
  // DaYun 0 (a single year) still fills the whole strip.
  function baziLiuNianList(index, chart = baziChart) {
    if (!chart) return [];
    const start = Math.max(0, chart.daYun.findIndex(d => d.getIndex() === index));
    return chart.daYun.slice(start).flatMap(d => d.getLiuNian(10)).slice(0, 10);
  }
  // 大运/流年格：年份与岁数在上，天干、地支各占一行排在其下（对照参考排盘）。
  const luckGanZhi = (ganZhi, fallback) => {
    const gan = ganZhi?.[0] || '';
    if (!gan) return `<em class="luck-chip-empty">${fallback}</em>`;
    return `<em class="${wuxingClass(gan)}">${gan}</em><em class="${wuxingClass(ganZhi[1])}">${ganZhi[1]}</em>`;
  };
  function renderBaziLuck() {
    if (!baziChart) return '<div class="bazi-luck" hidden></div>';
    const { daYun, daYunIndex, liuNianYear } = baziChart;
    const liuNian = baziLiuNianList(daYunIndex);
    const currentNian = liuNian.find(l => l.getYear() === liuNianYear) || liuNian[0];
    const liuYue = currentNian?.getLiuYue?.() || [];
    const dayunChips = daYun.map(d => `<button type="button" class="luck-chip${d.getIndex() === 0 ? ' luck-chip-pre' : ''}${d.getIndex() === daYunIndex ? ' active' : ''}" data-dayun="${d.getIndex()}"><b>${d.getStartYear()}</b><span>${d.getStartAge()}岁</span>${luckGanZhi(d.getGanZhi(), '起运前')}</button>`).join('');
    const liunianChips = liuNian.map(l => `<button type="button" class="luck-chip${l.getYear() === liuNianYear ? ' active' : ''}" data-liunian="${l.getYear()}"><b>${l.getYear()}</b><span>${l.getAge()}</span>${luckGanZhi(l.getGanZhi(), '')}</button>`).join('');
    // 流月按节气月排，月份标阳历（寅月=2月 … 丑月=1月）。
    const liuyueChips = liuYue.map((m, i) => `<div class="luck-chip luck-chip-month"><b>${(i + 1) % 12 + 1}月</b><span class="luck-month-gz">${[...m.getGanZhi()].map(ch => `<i class="${wuxingClass(ch)}">${ch}</i>`).join('')}</span></div>`).join('');
    // One band under the chart: 流年 on the left, 大运 on the right, 流月 across the bottom.
    return `<div class="bazi-luck"><div class="bazi-luck-row"><span class="bazi-luck-label">流年</span><div class="bazi-luck-track" data-luck-track="liunian">${liunianChips}</div></div><div class="bazi-luck-row"><span class="bazi-luck-label">大运</span><div class="bazi-luck-track" data-luck-track="dayun">${dayunChips}</div></div><div class="bazi-luck-row"><span class="bazi-luck-label">流月</span><div class="bazi-luck-track" data-luck-track="liuyue">${liuyueChips}</div></div></div>`;
  }
  function renderBazi() {
    const columns = [
      { kind: 'fortune', item: baziFortune[0], head: '流年' },
      { kind: 'fortune', item: baziFortune[1], head: '大运' },
      ...baziPillars.map(item => ({ kind: 'pillar', item, head: `${item.title}柱` })),
    ];
    // A 0-width column + one empty cell per row doubles the gap between 大运 and 年柱
    // (10 + 10) so the divider is spaced like the other columns.
    const spacer = '<div class="bazi-spacer" aria-hidden="true"></div>';
    const cellsAt = render => columns.map((c, i) => render(c) + (i === 1 ? spacer : '')).join('');
    const headText = ['日期', ...columns.map(c => c.head)];
    headText.splice(3, 0, '');
    const head = headText.map((text, i) => `<div class="bazi-head${i === 0 ? ' bazi-corner' : ''}">${text}</div>`).join('');
    const row = (label, cells) => `<div class="bazi-rowlabel">${label}</div>${cells}`;
    const stars = row('主星', cellsAt(c => `<div class="bazi-star" data-motion-layer>${c.item.star || ''}</div>`));
    const stems = row('天干', cellsAt(c => baziCard(c.kind, c.item, 'stem')));
    const branches = row('地支', cellsAt(c => baziCard(c.kind, c.item, 'branch')));
    const hidden = row('藏干', cellsAt(c => `<div class="bazi-hidden" data-motion-layer>${(c.item.hidden || []).map(h => `<span class="bazi-hidden-item ${wuxingClass(h.gan)}">${h.gan}${h.ss || ''}</span>`).join('')}</div>`));
    const kongWang = row('空亡', cellsAt(c => `<div class="bazi-kong" data-motion-layer>${c.item.xunKong || ''}</div>`));
    // 左上角出生日期，排盘或载入案例后才有内容。
    const dateLines = [baziMeta.solar, baziMeta.lunar].filter(Boolean).map(value => `<div class="qimen-date">${dateHtml(value)}</div>`).join('');
    const dates = dateLines ? `<aside class="bazi-side" aria-label="出生日期">${dateLines}</aside>` : '';
    return `<div class="bazi-stage">${dates}<div class="bazi-board">${head}${stars}${stems}${branches}${hidden}${kongWang}</div>${renderBaziLuck()}</div>`;
  }
  // 旬空：由干支在六十甲子中的位置推所在旬，取该旬余下两支。
  function xunKongOf(ganZhi) {
    const gan = baziStems.indexOf(ganZhi?.[0]);
    const zhi = baziBranches.indexOf(ganZhi?.[1]);
    if (gan < 0 || zhi < 0) return '';
    let index = 0;
    while (index < 60 && !(index % 10 === gan && index % 12 === zhi)) index++;
    const head = index - (index % 10);
    return baziBranches[(head + 10) % 12] + baziBranches[(head + 11) % 12];
  }
  function fortuneFromGanZhi(ganzhi) {
    if (!ganzhi) return null;
    const [stem, branch] = ganzhi;
    const dayGan = baziPillars[2].stem;
    const shiShen = gan => window.LunarUtil?.SHI_SHEN?.[dayGan + gan] || '';
    return { stem, branch, star: shiShen(stem), xunKong: xunKongOf(ganzhi), hidden: (window.LunarUtil?.ZHI_HIDE_GAN?.[branch] || []).map(gan => ({ gan, ss: shiShen(gan) })) };
  }
  function setFortune(key, ganzhi) {
    const item = baziFortune.find(f => f.key === key);
    const next = fortuneFromGanZhi(ganzhi);
    if (item && next) Object.assign(item, next);
  }
  function selectDaYun(index) {
    if (!baziChart) return;
    const target = baziChart.daYun.find(d => d.getIndex() === index);
    if (!target) return;
    baziChart.daYunIndex = index;
    const years = baziLiuNianList(index);
    const nowYear = new Date().getFullYear();
    const pick = years.find(l => l.getYear() === nowYear) || years[0];
    baziChart.liuNianYear = pick?.getYear();
    // DaYun 0 has no stem/branch, so the 大运 column keeps the nearest real one.
    const shown = target.getGanZhi() ? target : baziChart.daYun.find(d => d.getIndex() > 0);
    setFortune('dayun', shown?.getGanZhi());
    setFortune('liunian', pick?.getGanZhi());
    renderTemplate('bazi');
    notify(target.getGanZhi() ? `大运已切换到 ${target.getGanZhi()}。` : '已切到起运前：该阶段无大运干支，流年照常显示。');
  }
  function selectLiuNian(year) {
    const target = baziLiuNianList(baziChart?.daYunIndex).find(l => l.getYear() === year);
    if (!target) return;
    baziChart.liuNianYear = year;
    setFortune('liunian', target.getGanZhi());
    renderTemplate('bazi');
    notify(`流年已切换到 ${year} ${target.getGanZhi()}。`);
  }
  function wireBaziLuck() {
    $$('[data-dayun]', boardContent).forEach(btn => btn.addEventListener('click', () => selectDaYun(Number(btn.dataset.dayun))));
    $$('[data-liunian]', boardContent).forEach(btn => btn.addEventListener('click', () => selectLiuNian(Number(btn.dataset.liunian))));
    // 聚亮高光：流年 / 大运会整块重渲染，所以要等下一帧再找新节点。
    if (boardContent.dataset.luckFlare) return;
    boardContent.dataset.luckFlare = '1';
    const flash = el => {
      if (!el) return;
      // 同一行只留一个高光：点下一个时把同行上一个立刻收掉。
      el.closest('.bazi-luck-track')?.querySelectorAll('.is-flaring').forEach(n => { if (n !== el) n.classList.remove('is-flaring'); });
      el.classList.remove('is-flaring');
      void el.offsetWidth;
      el.classList.add('is-flaring');
    };
    boardContent.addEventListener('click', event => {
      const chip = event.target.closest('.luck-chip');
      if (!chip) return;
      const key = chip.dataset.dayun ? `[data-dayun="${chip.dataset.dayun}"]`
        : chip.dataset.liunian ? `[data-liunian="${chip.dataset.liunian}"]` : null;
      if (key) requestAnimationFrame(() => flash(boardContent.querySelector(key)));
      else flash(chip);
    });
    boardContent.addEventListener('animationend', event => {
      if (event.target.classList?.contains('is-flaring')) event.target.classList.remove('is-flaring');
    });
  }
  // ── 梅花起卦 ───────────────────────────────────
  // 先天数余 0 取满数（八卦取 8、六爻取 6），这是梅花起卦的通行处理。
  function meihuaWrapped(value, base) { const rest = value % base; return rest === 0 ? base : rest; }
  // trigramLines 自上而下存，起卦按自下而上的爻序数，所以统一翻转成 [初,二,三]。
  const meihuaBottomUp = name => trigramLines[name].slice().reverse();
  function meihuaTrigramFromLines(bottomUp) {
    const key = bottomUp.slice().reverse().join('');
    return meihuaTrigramOrder.find(name => trigramLines[name].join('') === key) || '乾';
  }
  function meihuaBuildChart(upper, lower, moving) {
    const lines = [];
    meihuaBottomUp(lower).forEach((line, i) => { lines[i + 1] = line; });  // 1 初 2 二 3 三
    meihuaBottomUp(upper).forEach((line, i) => { lines[i + 4] = line; });  // 4 四 5 五 6 上
    const changed = lines.slice();
    changed[moving] = changed[moving] ? 0 : 1;
    const useIsUpper = moving >= 4;   // 动爻所在之卦为用，另一为体
    return {
      upper, lower, moving,
      mutualLower: meihuaTrigramFromLines([lines[2], lines[3], lines[4]]),
      mutualUpper: meihuaTrigramFromLines([lines[3], lines[4], lines[5]]),
      changedLower: meihuaTrigramFromLines([changed[1], changed[2], changed[3]]),
      changedUpper: meihuaTrigramFromLines([changed[4], changed[5], changed[6]]),
      yong: useIsUpper ? upper : lower,
      ti: useIsUpper ? lower : upper,
    };
  }
  function applyMeihuaChart(chart, meta) {
    meihuaChart = chart;
    meihuaMeta = meta;
    meihuaSlots[0].value = chart.upper;
    meihuaSlots[1].value = chart.mutualUpper;
    meihuaSlots[2].value = chart.changedUpper;
    meihuaSlots[3].value = chart.lower;
    meihuaSlots[4].value = chart.mutualLower;
    meihuaSlots[5].value = chart.changedLower;
    renderTemplate('meihua');
  }
  function setMeihuaMode(mode) {
    meihuaMode = mode;
    $$('[data-meihua-mode]').forEach(btn => btn.classList.toggle('active', btn.dataset.meihuaMode === mode));
    $$('[data-meihua-panel]').forEach(panel => { panel.hidden = panel.dataset.meihuaPanel !== mode; });
    const summary = $('#meihuaChartSummary');
    summary.classList.remove('error');
    summary.textContent = '选择起卦方式并填入内容，点击起卦。';
  }
  function openMeihuaChartModal() {
    const now = new Date();
    const pad = value => String(value).padStart(2, '0');
    $('#meihuaDateInput').value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    $('#meihuaTimeInput').value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const summary = $('#meihuaChartSummary');
    summary.classList.remove('error');
    summary.textContent = '选择起卦方式并填入内容，点击起卦。';
    $('#meihuaChartModal').classList.add('open');
    $('#meihuaChartModal').setAttribute('aria-hidden', 'false');
  }
  function closeMeihuaChartModal() {
    $('#meihuaChartModal').classList.remove('open');
    $('#meihuaChartModal').setAttribute('aria-hidden', 'true');
  }
  // 左上公历农历：样式与奇门左侧一致，起卦后换成起卦时刻。
  let meihuaDates = { solar: '', lunar: '' };
  function meihuaClock() {
    const now = new Date();
    const pad = value => String(value).padStart(2, '0');
    return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }
  // 农历要历法组件才换算得出，异步补一次；失败就只留公历。
  function meihuaFillLunar() {
    if (meihuaDates.lunar || !window.Solar) return;
    loadLunarLibrary().then(() => {
      if (meihuaDates.lunar) return;
      const now = new Date();
      const solar = window.Solar.fromYmdHms(now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), 0);
      const lunar = solar.getLunar();
      meihuaDates.lunar = `${lunar.getYearInChinese()}年${lunar.getMonthInChinese()}月${lunar.getDayInChinese()} ${lunar.getTimeInGanZhi()[1]}时`;
      if (currentTemplate === 'meihua') renderTemplate('meihua');
    }).catch(() => {});
  }
  async function calculateMeihua() {
    const summary = $('#meihuaChartSummary');
    summary.classList.remove('error');
    summary.textContent = '正在起卦…';
    try {
      let upperNo, lowerNo, moving, modeText;
      if (meihuaMode === 'time') {
        await loadLunarLibrary();
        const dateValue = $('#meihuaDateInput').value;
        if (!dateValue) throw new Error('请先选择公历日期。');
        const [year, month, day] = dateValue.split('-').map(Number);
        const [hour, minute] = ($('#meihuaTimeInput').value || '12:00').split(':').map(Number);
        const solar = window.Solar.fromYmdHms(year, month, day, hour, minute, 0);
        const lunar = solar.getLunar();
        const yearNo = meihuaBranchOrder[lunar.getYearInGanZhi()[1]] || 1;
        const monthNo = Math.abs(lunar.getMonth());
        const dayNo = lunar.getDay();
        const hourBranch = lunar.getTimeInGanZhi()[1];
        const hourNo = meihuaBranchOrder[hourBranch] || 1;
        const sum = yearNo + monthNo + dayNo;
        upperNo = meihuaWrapped(sum, 8);
        lowerNo = meihuaWrapped(sum + hourNo, 8);
        moving = meihuaWrapped(sum + hourNo, 6);
        modeText = `时间起卦 · 农历${lunar.getYearInChinese()}年${lunar.getMonthInChinese()}月${lunar.getDayInChinese()} ${hourBranch}时 · 数 年${yearNo} 月${monthNo} 日${dayNo} 时${hourNo}`;
        const pad = value => String(value).padStart(2, '0');
        meihuaDates.solar = `${solar.getYear()}年${solar.getMonth()}月${solar.getDay()}日 ${pad(hour)}:${pad(minute)}`;
        meihuaDates.lunar = `${lunar.getYearInChinese()}年${lunar.getMonthInChinese()}月${lunar.getDayInChinese()} ${hourBranch}时`;
      } else if (meihuaMode === 'char') {
        const text = ($('#meihuaCharInput').value || '').replace(/\s+/g, '');
        const count = [...text].length;
        if (count < 3) throw new Error('汉字起卦至少三个字；一两个字需按笔画起卦，本工具未带笔画库。');
        const lowerCount = Math.ceil(count / 2);   // 天轻地重：上卦取少的一半
        const upperCount = count - lowerCount;
        upperNo = meihuaWrapped(upperCount, 8);
        lowerNo = meihuaWrapped(lowerCount, 8);
        moving = meihuaWrapped(count, 6);
        modeText = `汉字起卦 · ${escapeAttr(text)} · ${count} 字，上${upperCount}下${lowerCount}`;
      } else {
        const a = Math.trunc(Number($('#meihuaNumA').value));
        const b = Math.trunc(Number($('#meihuaNumB').value));
        if (!(a > 0) || !(b > 0)) throw new Error('请填写两个大于 0 的整数。');
        upperNo = meihuaWrapped(a, 8);
        lowerNo = meihuaWrapped(b, 8);
        moving = meihuaWrapped(a + b, 6);
        modeText = `数字起卦 · ${a} / ${b}`;
      }
      // 汉字 / 数字起卦按当前时刻记日期；农历异步补。
      if (meihuaMode !== 'time') {
        meihuaDates.solar = meihuaClock();
        meihuaDates.lunar = '';
        meihuaFillLunar();
      }
      const upper = meihuaTrigramOrder[upperNo - 1];
      const lower = meihuaTrigramOrder[lowerNo - 1];
      const chart = meihuaBuildChart(upper, lower, moving);
      const guaName = (u, l) => meihuaGuaNames[u][l];
      const meta = { lines: [
        modeText,
        `本卦 <b>${guaName(upper, lower)}</b>（${upper}上${lower}下）· 互卦 <b>${guaName(chart.mutualUpper, chart.mutualLower)}</b> · 变卦 <b>${guaName(chart.changedUpper, chart.changedLower)}</b>`,
        `${meihuaMovingLabel[moving - 1]}动 · 体 <b>${chart.ti}${trigramElement[chart.ti]}</b> 用 <b>${chart.yong}${trigramElement[chart.yong]}</b>`,
      ] };
      applyMeihuaChart(chart, meta);
      summary.textContent = `${guaName(upper, lower)} · ${meihuaMovingLabel[moving - 1]}动 · 体${chart.ti} 用${chart.yong}`;
      notify(`梅花起卦完成：${guaName(upper, lower)}，${meihuaMovingLabel[moving - 1]}动。`);
      closeMeihuaChartModal();
    } catch (error) {
      summary.classList.add('error');
      summary.textContent = error?.message || '起卦失败，请检查输入。';
    }
  }
  function renderMeihua() {
    // Empty placement slot (no frame) for 象意动效, level with the top row.
    const effectSlot = `<div class="meihua-effect-slot" data-element-id="meihua.effect" data-label="象意动效位" tabindex="0" role="group" aria-label="象意动效位"></div>`;
    const chart = meihuaChart;
    // 上排前两格是本卦上 / 变卦上，动爻在上卦（4–6）时高亮对应那条线；下排同理。
    const moveIndexOf = i => {
      if (!chart) return null;
      if (i === 0 || i === 2) return chart.moving >= 4 ? 6 - chart.moving : null;
      if (i === 3 || i === 5) return chart.moving <= 3 ? 3 - chart.moving : null;
      return null;
    };
    const roleOf = i => {
      if (!chart || (i !== 0 && i !== 3)) return '';
      if (chart.moving >= 4) return i === 0 ? '用' : '体';
      return i === 0 ? '体' : '用';
    };
    const cards = meihuaSlots.map((slot, i) => {
      const caption = `<div class="trigram-caption wx-${trigramElement[slot.value]}" data-motion-layer>${slot.value}</div>`;
      const role = roleOf(i);
      return `<div ${nodeAttrs(slot.id,slot.title,'本互变独立格')} class="anchor-node hex-card ${i < 3 ? 'row-top' : 'row-bottom'}" data-element-id="${slot.id}" data-label="${slot.title} · ${slot.value}"><div class="motion-surface" data-motion-surface>${caption}<div class="trigram-glyph" data-motion-layer>${trigramSVG(slot.value, moveIndexOf(i))}</div><select class="hex-picker-overlay" data-trigram-slot="${i}" aria-label="修改${slot.title}卦象">${trigramOptions.map(item => `<option value="${item.value}" ${item.value === slot.value ? 'selected' : ''}>${item.name}</option>`).join('')}</select></div>${chart ? `<span class="hex-tag">${slot.title}</span>` : ''}${role ? `<span class="hex-role">${role}</span>` : ''}</div>`;
    }).join('');
    const meta = meihuaMeta ? `<div class="meihua-meta">${meihuaMeta.lines.map(line => `<span class="meihua-meta-line">${line}</span>`).join('')}</div>` : '';
    // 左上公历农历：与奇门左侧同一样式，未起卦时先显示当前时刻，农历补到后再重绘。
    if (!meihuaDates.solar) { meihuaDates.solar = meihuaClock(); meihuaFillLunar(); }
    const dateLines = [meihuaDates.solar, meihuaDates.lunar].filter(Boolean).map(value => `<div class="qimen-date">${dateHtml(value)}</div>`).join('');
    return `<div class="meihua-board">${effectSlot}${cards}${meta}<aside class="meihua-dates" aria-label="起卦日期">${dateLines}</aside></div>`;
  }
  // ── 大六壬 ─────────────────────────────────────
  // 方盘 4×4：外圈 12 支顺时针，中心 2×2 放月将与占时。
  const liurenSeat = {
    巳:[1,1], 午:[1,2], 未:[1,3], 申:[1,4], 酉:[2,4], 戌:[3,4],
    亥:[4,4], 子:[4,3], 丑:[4,2], 寅:[4,1], 卯:[3,1], 辰:[2,1],
  };
  const liurenGeneralShort = { 贵人:'贵', 螣蛇:'蛇', 朱雀:'朱', 六合:'合', 勾陈:'勾', 青龙:'青', 天空:'空', 白虎:'虎', 太常:'常', 玄武:'玄', 太阴:'阴', 天后:'后' };
  const liurenSixShort = { 妻财:'财', 父母:'父', 兄弟:'兄', 官鬼:'官', 子孙:'子' };
  // 十二天将五行：贵勾空常属土，蛇朱属火，合龙属木，虎阴属金，玄后属水。
  const liurenGeneralElement = { 贵人:'土', 螣蛇:'火', 朱雀:'火', 六合:'木', 勾陈:'土', 青龙:'木', 天空:'土', 白虎:'金', 太常:'土', 玄武:'水', 太阴:'金', 天后:'水' };
  const liurenJiangName = { 亥:'登明', 戌:'河魁', 酉:'从魁', 申:'传送', 未:'小吉', 午:'胜光', 巳:'太乙', 辰:'天罡', 卯:'太冲', 寅:'功曹', 丑:'大吉', 子:'神后' };
  const liurenMeta = {
    solar: '2026年10月7日 23:00',
    lunar: '二〇二六年八月廿七 子时',
    question: '',
    dayStem: '乙', dayBranch: '卯', hourBranch: '子', monthBranch: '酉', moonGeneral: '辰', dayNight: 'night',
  };
  // 引擎是同步纯函数，首屏直接用占位干支出盘，等历法库就绪后再按当前时间重排。
  let liurenChart = null;
  function rebuildLiurenChart() {
    if (!window.LiurenEngine) return;
    try {
      liurenChart = window.LiurenEngine.build({
        dayStem: liurenMeta.dayStem, dayBranch: liurenMeta.dayBranch,
        hourBranch: liurenMeta.hourBranch, moonGeneral: liurenMeta.moonGeneral,
        monthBranch: liurenMeta.monthBranch, dayNight: liurenMeta.dayNight,
      });
    } catch (error) {
      liurenChart = null;
      console.warn('[六壬]', error);
    }
  }
  rebuildLiurenChart();

  function renderLiuren() {
    const chart = liurenChart;
    const left = `<aside class="liuren-side liuren-side-left" aria-label="起课记录">
      <div class="qimen-date">${dateHtml(liurenMeta.solar)}</div>
      <div class="qimen-date">${dateHtml(liurenMeta.lunar)}</div>
      <textarea class="liuren-question" rows="1" placeholder="所问之事" aria-label="所问之事">${escapeAttr(liurenMeta.question)}</textarea>
    </aside>`;
    if (!chart) {
      return `<div class="liuren-stage">${left}<div class="liuren-center"><div class="liuren-empty">六壬排盘组件未加载。</div></div></div>`;
    }
    const cells = chart.palaces.map(p => {
      const seat = liurenSeat[p.earth];
      const id = `liuren.palace.${p.earth}`;
      const label = `${p.earth}宫 · 天盘${p.heaven}${p.general ? ' ' + p.general : ''}`;
      return `<div ${nodeAttrs(id, label)} class="anchor-node liuren-cell${p.dun ? '' : ' liuren-kong'}" data-element-id="${id}" data-label="${label}" style="grid-row:${seat[0]};grid-column:${seat[1]}">
        <div class="motion-surface" data-motion-surface>
          <span class="liuren-gen ${elementClass(liurenGeneralElement[p.general])}">${liurenGeneralShort[p.general] || ''}</span>
          <span class="liuren-heaven ${wuxingClass(p.heaven)}">${p.heaven}</span>
          <span class="liuren-foot"><i class="liuren-dun ${p.dun ? wuxingClass(p.dun) : 'liuren-is-kong'}">${p.dun || '空'}</i><b class="liuren-earth">${p.earth}</b></span>
        </div>
      </div>`;
    }).join('');
    const core = `<div class="liuren-core" style="grid-row:2 / 4;grid-column:2 / 4">
      <em>${chart.principle}</em>
      <div class="liuren-core-line"><b>${liurenMeta.moonGeneral}</b><span>将</span><i>加</i><b>${liurenMeta.hourBranch}</b><span>时</span></div>
    </div>`;
    const passLabel = ['初传', '中传', '末传'];
    const passes = chart.passes.map((p, i) => `<div ${nodeAttrs(`liuren.pass.${i}`, passLabel[i])} class="anchor-node liuren-pass" data-element-id="liuren.pass.${i}" data-label="${passLabel[i]} · ${p.branch}">
        <div class="motion-surface" data-motion-surface>
          <span class="liuren-pass-six">${liurenSixShort[p.six] || p.six}</span>
          <span class="liuren-pass-dun ${p.dun ? wuxingClass(p.dun) : 'liuren-is-kong'}">${p.dun || '空'}</span>
          <span class="liuren-pass-branch ${wuxingClass(p.branch)}">${p.branch}</span>
          <span class="liuren-pass-gen ${elementClass(liurenGeneralElement[p.general])}">${liurenGeneralShort[p.general] || ''}</span>
        </div>
      </div>`).join('');
    const lessonNo = ['一', '二', '三', '四'];
    // 四课独立成块，按 四三二一 自左向右排列。
    const lessons = [3, 2, 1, 0].map(i => {
      const l = chart.lessons[i];
      const general = chart.officials.byHeaven[l.top] || '';
      return `<div ${nodeAttrs(`liuren.lesson.${i}`, `${lessonNo[i]}课`)} class="anchor-node liuren-lesson" data-element-id="liuren.lesson.${i}" data-label="${lessonNo[i]}课 · ${l.bottom}上${l.top}">
        <div class="motion-surface" data-motion-surface>
          <span class="liuren-lesson-gen ${elementClass(liurenGeneralElement[general])}">${liurenGeneralShort[general] || ''}</span>
          <b class="liuren-lesson-top ${wuxingClass(l.top)}">${l.top}</b>
          <span class="liuren-lesson-bottom ${wuxingClass(l.bottom)}">${l.bottom}</span>
        </div>
      </div>`;
    }).join('');
    const wang = chart.wang;
    const fact = (key, value) => `<div class="liuren-factline"><span class="liuren-k">${key}</span><span class="liuren-v">${value}</span></div>`;
    const right = `<aside class="liuren-side liuren-side-right" aria-label="盘面要点">
      <div class="liuren-side-top">
        <div class="liuren-pillars">${(liurenMeta.pillars || []).map(([label, value]) => `<span><i>${label}</i><b>${value}</b></span>`).join('')}</div>
        <div class="liuren-facts">
          ${fact('旬首', chart.xunShou)}
          ${fact('空亡', chart.kong.join(''))}
          ${fact('月将', `${liurenMeta.moonGeneral} · ${liurenJiangName[liurenMeta.moonGeneral] || ''}`)}
          ${fact('占时', `${liurenMeta.hourBranch}时 · ${chart.officials.dayNight}贵${chart.officials.noble}`)}
          ${fact('课体', chart.principle)}
        </div>
      </div>
      <div class="liuren-wang">
        <span class="liuren-wang-head">${chart.season} · 四时旺相</span>
        <div class="liuren-wang-row">${['旺', '相', '休', '囚', '死'].map(key => `<span class="liuren-wang-item"><i>${key}</i><b class="${wuxingClass(wang[key])}">${wang[key]}</b></span>`).join('')}</div>
      </div>
    </aside>`;
    return `<div class="liuren-stage">${left}
      <div class="liuren-center">
        <div class="liuren-top">
          <section class="liuren-block"><div class="liuren-block-head"><span>三传</span></div><div class="liuren-pass-row">${passes}</div></section>
          <section class="liuren-block"><div class="liuren-block-head"><span>四课</span></div><div class="liuren-lesson-row">${lessons}</div></section>
        </div>
        <section class="liuren-block liuren-plate-block"><div class="liuren-plate">${cells}${core}</div></section>
      </div>
      ${right}</div>`;
  }
  function wireLiurenQuestion() {
    const question = $('.liuren-question', boardContent);
    if (question) question.addEventListener('input', () => { liurenMeta.question = question.value; });
  }
  function renderTemplate(template) {
    const previousTemplate = currentTemplate;
    clearPalaceQuickFocus();
    closeQimenStateEditor();
    closeQimenPatternPanel();
    lastAnchorPress = { id: null, time: 0 };
    lastBaziClick = null;
    focusOrder = [];
    clearTimeout(qimenPatternTimer);
    qimenPatternTimer = null;
    if (template !== 'qimen') { qimenPatterns.mode = null; }
    currentTemplate = template;
    const elementList = allTemplates[template];
    const renderers = { qimen: renderQimen, bazi: renderBazi, liuren: renderLiuren, meihua: renderMeihua };
    boardContent.innerHTML = renderers[template]();
    stageSurface.classList.remove('template-qimen','template-bazi','template-liuren','template-meihua');
    stageSurface.classList.add(`template-${template}`);
    $('#stageTitle').textContent = ({ qimen: '奇门九宫', bazi: '四柱', liuren: '大六壬', meihua: '梅花卦象' })[template];
    $('#stageSubtitle').textContent = '';
    $('#baziEntryTrigger').hidden = template !== 'bazi';
    $('#qimenChartTrigger').hidden = template !== 'qimen';
    $('#liurenChartTrigger').hidden = template !== 'liuren';
    $('#meihuaChartTrigger').hidden = template !== 'meihua';
    $('#qimenWuxingOption').hidden = template !== 'qimen';
    $$('.template-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.template === template));
    selectedId = template === 'qimen' ? 'qimen.palace.center' : template === 'liuren' ? 'liuren.palace.子' : elementList[0][0];
    // 连接下拉在这里一次建好，wireTemplateEditors 不再重复重建。
    refreshTargetOptions({ source: selectedId, target: elementList.find(e => e[0] !== selectedId)[0], converge: '' });
    wireAnchors();
    wireTemplateEditors();
    wireQimenEditors();
    wireBaziLuck();
    if (template === 'qimen') wireQimenPatterns();
    if (template === 'liuren') wireLiurenQuestion();
    updateSelected();
    clearAllEffectsQuiet();
    // 案例库按模板分开：只有真正切换模板才重置抽屉；同模板重绘（切换大运/流年、重排盘）保留当前反馈页。
    if (caseDrawer?.classList.contains('open') && template !== previousTemplate) { caseDraft = null; caseFeedbackId = null; caseFilter = '全部'; renderCaseDrawer(); }
    requestAnimationFrame(() => requestAnimationFrame(fitStageBoard));
  }
  function refreshTargetOptions(fallback) {
    const list = allTemplates[currentTemplate];
    const previous = fallback || {
      source: $('#sourceTarget').value || selectedId,
      target: $('#targetTarget').value,
      converge: $('#convergeTarget').value,
    };
    const options = list.map(entry => {
      const anchor = findTarget(entry[0]);
      const label = anchor?.dataset.label || entry[1];
      return `<option value="${entry[0]}">${label} · ${entry[2]}</option>`;
    }).join('');
    ['#sourceTarget'].forEach(selector => { $(selector).innerHTML = options; });
    $('#targetTarget').innerHTML = `<option value="">（未选）</option>${options}`;
    $('#convergeTarget').innerHTML = `<option value="">无（单向）</option>${options}`;
    $('#sourceTarget').value = list.some(entry => entry[0] === previous.source) ? previous.source : list[0][0];
    $('#targetTarget').value = previous.target === '' || list.some(entry => entry[0] === previous.target) ? previous.target : list.find(entry => entry[0] !== $('#sourceTarget').value)[0][0];
    $('#convergeTarget').value = previous.converge === '' || list.some(entry => entry[0] === previous.converge) ? previous.converge : '';
  }
  function wireTemplateEditors() {
    $$('[data-bazi-value]', boardContent).forEach(select => {
      select.addEventListener('change', () => {
        const anchor = select.closest('[data-element-id]');
        if (!anchor) return;
        const isFortune = !!select.dataset.fortune;
        const holderKey = select.dataset.fortune || select.dataset.pillar;
        const holder = (isFortune ? baziFortune : baziPillars).find(item => item.key === holderKey);
        if (holder) holder[select.dataset.baziValue] = select.value;
        select.classList.remove('wx-木', 'wx-火', 'wx-土', 'wx-金', 'wx-水');
        select.classList.add(wuxingClass(select.value));
        const title = isFortune
          ? baziFortune.find(item => item.key === holderKey)?.title
          : ({ year: '年', month: '月', day: '日', hour: '时' })[holderKey];
        anchor.dataset.label = `${title}${select.dataset.baziValue === 'stem' ? '干' : '支'} · ${select.value}`;
        refreshTargetOptions();
        updateSelected();
        notify(`${anchor.dataset.label} 已修改。`);
      });
    });
    $$('[data-trigram-slot]', boardContent).forEach(select => {
      select.addEventListener('change', () => {
        const anchor = select.closest('[data-element-id]');
        const trigram = trigramOptions.find(item => item.value === select.value);
        const slot = meihuaSlots[Number(select.dataset.trigramSlot)];
        if (!anchor || !trigram || !slot) return;
        slot.value = trigram.name;
        // 手动改卦即脱离起卦结果：动爻高亮与体用标号会失真，整盘重绘清掉。
        if (meihuaChart) {
          meihuaChart = null;
          meihuaMeta = null;
          renderTemplate('meihua');
          notify(`${slot.title} 已改为 ${trigram.name}，已脱离起卦结果。`);
          return;
        }
        anchor.querySelector('.trigram-glyph').innerHTML = trigramSVG(trigram.name);
        const caption = anchor.querySelector('.trigram-caption');
        caption.textContent = trigram.name;
        caption.className = `trigram-caption wx-${trigramElement[trigram.name]}`;
        anchor.dataset.label = `${slot.title} · ${trigram.name}`;
        refreshTargetOptions();
        updateSelected();
        notify(`${anchor.dataset.label} 已修改。`);
      });
    });
  }
  function wireQimenEditors() {
    const question = $('.qimen-question', boardContent);
    if (question) question.addEventListener('input', () => { qimenMeta.question = question.value; });
    $$('[data-qimen-field]', boardContent).forEach(select => {
      select.addEventListener('change', () => {
        const anchor = select.closest('[data-element-id]');
        if (!anchor) return;
        const palaceKey = anchor.dataset.elementId.split('.').pop();
        const palace = qimenPalaces.find(item => item.key === palaceKey);
        const key = select.dataset.qimenField;
        if (palace) palace[key] = select.value;
        $$(`[data-qimen-display="${key}"]`, anchor).forEach(display => {
          display.textContent = shortQimenValue(key, select.value);
        });
        updateSelected();
        notify(`${anchor.dataset.label} 内容已更新。`);
      });
    });
  }

  function loadLunarLibrary() {
    if (window.Solar && window.Lunar) return Promise.resolve();
    if (lunarLoadPromise) return lunarLoadPromise;
    const sources = [
      './vendor/lunar.js',
      '../node_modules/lunar-javascript/lunar.js',
      'https://cdn.jsdelivr.net/npm/lunar-javascript@1.7.7/lunar.js',
      'https://unpkg.com/lunar-javascript@1.7.7/lunar.js',
    ];
    lunarLoadPromise = new Promise((resolve, reject) => {
      const trySource = index => {
        if (window.Solar && window.Lunar) { resolve(); return; }
        if (index >= sources.length) { reject(new Error('历法组件下载失败，请检查网络连接后重试。')); return; }
        const script = document.createElement('script');
        script.src = sources[index];
        script.async = true;
        script.onload = () => window.Solar && window.Lunar ? resolve() : trySource(index + 1);
        script.onerror = () => trySource(index + 1);
        document.head.appendChild(script);
      };
      trySource(0);
    }).catch(error => { lunarLoadPromise = null; throw error; });
    return lunarLoadPromise;
  }
  function setBaziDateMode(mode) {
    dateMode = mode;
    $('#solarDateFields').hidden = mode !== 'solar';
    $('#lunarDateFields').hidden = mode !== 'lunar';
    $$('.date-mode-switch button').forEach(button => button.classList.toggle('active', button.dataset.dateMode === mode));
    $('#baziDateSummary').classList.remove('error');
  }
  function openBaziDateModal() {
    $('#baziDateModal').classList.add('open');
    $('#baziDateModal').setAttribute('aria-hidden','false');
    setDateDefaultsIfEmpty();
  }
  function closeBaziDateModal() {
    $('#baziDateModal').classList.remove('open');
    $('#baziDateModal').setAttribute('aria-hidden','true');
  }
  function setDateDefaultsIfEmpty() {
    if (!$('#solarDateInput').value) {
      const now = new Date();
      $('#solarDateInput').value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    }
  }
  function setBaziPillars(parts, gender) {
    const dayGan = parts[2].stem;
    const shiShen = gan => window.LunarUtil?.SHI_SHEN?.[dayGan + gan] || '';
    parts.forEach((part, index) => {
      const pillar = baziPillars[index];
      if (!pillar) return;
      pillar.stem = part.stem;
      pillar.branch = part.branch;
      pillar.star = index === 2 ? (Number(gender) === 1 ? '元男' : '元女') : shiShen(part.stem);
      pillar.xunKong = part.xunKong || '';
      pillar.hidden = (window.LunarUtil?.ZHI_HIDE_GAN?.[part.branch] || []).map(gan => ({ gan, ss: shiShen(gan) }));
    });
  }
  async function calculateBaziFromDate() {
    const summary = $('#baziDateSummary');
    summary.classList.remove('error');
    summary.textContent = '正在加载历法组件并计算四柱…';
    try {
      await loadLunarLibrary();
      const timeValue = $('#birthTimeInput').value || '12:00';
      const [hour,minute] = timeValue.split(':').map(Number);
      let solar;
      let lunar;
      if (dateMode === 'solar') {
        const dateValue = $('#solarDateInput').value;
        if (!dateValue) throw new Error('请先选择公历日期。');
        const [year,month,day] = dateValue.split('-').map(Number);
        solar = window.Solar.fromYmdHms(year,month,day,hour,minute,0);
        lunar = solar.getLunar();
      } else {
        const year = Number($('#lunarYearInput').value);
        const monthAbs = Number($('#lunarMonthInput').value);
        const day = Number($('#lunarDayInput').value);
        if (!year || !monthAbs || !day) throw new Error('请完整填写农历年、月、日。');
        const month = $('#lunarLeapInput').checked ? -monthAbs : monthAbs;
        lunar = window.Lunar.fromYmdHms(year,month,day,hour,minute,0);
        solar = lunar.getSolar();
      }
      const eight = lunar.getEightChar();
      const sect = Number($('#baziSectInput').value || 2);
      eight.setSect(sect);
      const parts = [
        {stem:eight.getYearGan(),branch:eight.getYearZhi(),xunKong:eight.getYearXunKong()},
        {stem:eight.getMonthGan(),branch:eight.getMonthZhi(),xunKong:eight.getMonthXunKong()},
        {stem:eight.getDayGan(),branch:eight.getDayZhi(),xunKong:eight.getDayXunKong()},
        {stem:eight.getTimeGan(),branch:eight.getTimeZhi(),xunKong:eight.getTimeXunKong()},
      ];
      if (parts.some(part => !part.stem || !part.branch)) throw new Error('历法组件未返回完整四柱，请检查输入。');
      const gender = Number($('#baziGenderInput').value || 1);
      setBaziPillars(parts, gender);
      const yun = eight.getYun(gender, sect);
      const daYun = yun.getDaYun(10);
      const nowYear = new Date().getFullYear();
      const current = daYun.find(item => nowYear >= item.getStartYear() && nowYear <= item.getEndYear())
        || daYun.find(item => item.getIndex() > 0);
      const years = baziLiuNianList(current?.getIndex(), { daYun });
      const liuNian = years.find(item => item.getYear() === nowYear) || years[0];
      baziChart = { gender, daYun, daYunIndex: current?.getIndex(), liuNianYear: liuNian?.getYear() };
      const shownDayun = current?.getGanZhi() ? current : daYun.find(d => d.getIndex() > 0);
      setFortune('dayun', shownDayun?.getGanZhi());
      setFortune('liunian', liuNian?.getGanZhi());
      baziMeta = {
        solar: `${solar.getYear()}年${solar.getMonth()}月${solar.getDay()}日 ${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`,
        lunar: `${lunar.getYearInChinese()}年${lunar.getMonthInChinese()}月${lunar.getDayInChinese()} ${parts[3].branch}时`,
      };
      renderTemplate('bazi');
      const lunarMonth = Math.abs(lunar.getMonth());
      const lunarPrefix = lunar.getMonth() < 0 ? '闰' : '';
      const solarText = `${solar.getYear()}-${String(solar.getMonth()).padStart(2,'0')}-${String(solar.getDay()).padStart(2,'0')} ${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
      const lunarText = `${lunar.getYear()}年${lunarPrefix}${lunarMonth}月${lunar.getDay()}日`;
      summary.textContent = `公历 ${solarText} · 农历 ${lunarText} · ${gender === 1 ? '男' : '女'} · 四柱 ${parts.map(part=>part.stem+part.branch).join('  ')} · 大运${yun.isForward() ? '顺行' : '逆行'} · 子时规则：流派${sect}`;
      notify('四柱、十神、藏干与大运流年已填入。');
      closeBaziDateModal();
    } catch (error) {
      summary.classList.add('error');
      summary.textContent = error?.message || '排盘失败，请检查输入日期和时间。';
    }
  }
  function jiaziIndex(gz) {
    const stem = baziStems.indexOf(gz[0]);
    const branch = baziBranches.indexOf(gz[1]);
    for (let i = 0; i < 60; i++) if (i % 10 === stem && i % 12 === branch) return i;
    return 0;
  }
  function openQimenChartModal() {
    // 每次起卦都从当前时间开始。
    const now = new Date();
    $('#qimenDateInput').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    $('#qimenTimeInput').value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    $('#qimenChartModal').classList.add('open');
    $('#qimenChartModal').setAttribute('aria-hidden', 'false');
  }
  function closeQimenChartModal() {
    $('#qimenChartModal').classList.remove('open');
    $('#qimenChartModal').setAttribute('aria-hidden', 'true');
  }
  // Fill the nine palaces from one 时家 排盘: 天盘/地盘 stems, 寄宫 stem, 九星,
  // 八门, 八神, plus the derived 十二长生 / 旺相休囚废 / 和相义制迫 states.
  function applyQimenChart(chart) {
    const byName = new Map(chart.palaces.map(p => [p.palaceName, p]));
    const centerStem = byName.get('中')?.skyStem || '';
    qimenPalaces.forEach(palace => {
      const data = byName.get(palace.name);
      if (!data || palace.key === 'center') return;
      // Engine naming is inverted: earthStem carries 天盘干, skyStem carries 地盘干.
      palace.heaven = data.earthStem || '';
      palace.earth = data.skyStem || '';
      palace.star = data.star || '';
      palace.door = data.door || '';
      palace.deity = data.god || '';
      // 天盘寄宫: 天禽 rides with 天芮. 地盘寄宫: 中宫地盘干 寄坤二宫.
      palace.extra = data.jiGanStem || '';
      palace.extraEarth = palace.key === 'kun' ? centerStem : '';
      // 地盘干的十二长生取支按天盘干的阴阳定（阳取阳支、阴取阴支）；天盘缺省时回落地盘。
      const lifeRef = palace.heaven || palace.earth;
      palace.heavenState = lifeText(palace.heaven, palace.key, palace.earth);
      palace.earthState = lifeText(palace.earth, palace.key, lifeRef);
      palace.extraState = palace.extra ? lifeText(palace.extra, palace.key, palace.earth) : '';
      palace.extraEarthState = palace.extraEarth ? lifeText(palace.extraEarth, palace.key, lifeRef) : '';
      palace.starState = starStateFor(palace.star, palace.key);
      palace.doorState = doorStateFor(palace.door, palace.key);
    });
    // 空亡 → 圆圈, 驿马 → 飞马, as on the reference chart.
    qimenPatterns.rings = new Set(chart.palaces
      .filter(p => p.palaceNumber !== 5 && (p.marks || []).includes('空'))
      .map(p => qimenKeyByName[p.palaceName]));
    const yiMa = { 申:'寅', 子:'寅', 辰:'寅', 寅:'申', 午:'申', 戌:'申', 巳:'亥', 酉:'亥', 丑:'亥', 亥:'巳', 卯:'巳', 未:'巳' };
    const horseBranch = yiMa[chart.fourPillars.hour.zhi] || '';
    qimenPatterns.horse = Object.keys(palaceBranches).find(key => palaceBranches[key].includes(horseBranch)) || null;
    qimenMeta.horse = horseBranch;
    qimenPatterns.mode = null;
  }
  async function calculateQimenFromDate(options = {}) {
    const silent = !!options.silent;
    const summary = $('#qimenChartSummary');
    summary.classList.remove('error');
    if (!silent) summary.textContent = '正在加载历法组件并起局…';
    try {
      await loadLunarLibrary();
      if (!window.QimenEngine) throw new Error('奇门排盘组件未加载，请检查 demo/vendor/qimen-engine.js。');
      const dateValue = $('#qimenDateInput').value;
      if (!dateValue) throw new Error('请先选择公历日期。');
      const [year, month, day] = dateValue.split('-').map(Number);
      const [hour, minute] = ($('#qimenTimeInput').value || '12:00').split(':').map(Number);
      const solar = window.Solar.fromYmdHms(year, month, day, hour, minute, 0);
      const lunar = solar.getLunar();
      const prevTerm = lunar.getPrevJieQi();
      const nextTerm = lunar.getNextJieQi();
      const term = prevTerm.getName();
      const daysSince = Math.floor(solar.getJulianDay() - prevTerm.getSolar().getJulianDay());
      const daysToNext = Math.ceil(nextTerm.getSolar().getJulianDay() - solar.getJulianDay());
      // 起局用当天日干支 (23 时由取局法自行进位), 显示用历法组件的整日干支.
      const wallDay = lunar.getDayInGanZhiExact2();
      const exactDay = lunar.getDayInGanZhiExact();
      const method = $('#qimenMethodInput').value;
      const ju = method === 'zhirun'
        ? window.QimenEngine.zhiRunJu(term, jiaziIndex(wallDay), daysSince, nextTerm.getName(), daysToNext)
        : window.QimenEngine.chaiBuJu(term, baziStems.indexOf(wallDay[0]), baziBranches.indexOf(wallDay[1]), hour);
      const hourGz = lunar.getTimeInGanZhi();
      const yearGz = lunar.getYearInGanZhi();
      const monthGz = lunar.getMonthInGanZhi();
      const chart = window.QimenEngine.shiJiaGenerate(hourGz[0], hourGz[1], ju.juNumber, ju.isYangDun ? 'yang' : 'yin', {
        year: { gan: yearGz[0], zhi: yearGz[1] },
        month: { gan: monthGz[0], zhi: monthGz[1] },
        day: { gan: exactDay[0], zhi: exactDay[1] },
        hour: { gan: hourGz[0], zhi: hourGz[1] },
      }, term);
      applyQimenChart(chart);
      qimenMeta.solar = `${year}年${month}月${day}日 ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      qimenMeta.lunar = `${lunar.getYearInChinese()}年${lunar.getMonthInChinese()}月${lunar.getDayInChinese()} ${hourGz[1]}时`;
      qimenMeta.pillars = [['年', yearGz], ['月', monthGz], ['日', exactDay], ['时', hourGz]];
      qimenMeta.xunShou = ['甲子戊', '甲戌己', '甲申庚', '甲午辛', '甲辰壬', '甲寅癸'][Math.floor(jiaziIndex(hourGz) / 10)];
      qimenMeta.zhiFu = chart.zhiFuStar;
      qimenMeta.zhiShi = chart.zhiShiDoor;
      qimenMeta.kongWang = chart.kongWang.join('');
      qimenMeta.isYangDun = ju.isYangDun;
      renderTemplate('qimen');
      summary.textContent = `${term}${ju.yuan}元 · ${ju.isYangDun ? '阳' : '阴'}遁${ju.juNumber}局 · ${yearGz}年 ${monthGz}月 ${exactDay}日 ${hourGz}时 · 空亡 ${chart.kongWang.join('')} · 值符${chart.zhiFuStar} 值使${chart.zhiShiDoor}`;
      if (!silent) {
        notify(`${method === 'zhirun' ? '置闰' : '拆补'}起局完成：${ju.isYangDun ? '阳' : '阴'}遁${ju.juNumber}局，九宫已填入。`);
        closeQimenChartModal();
      }
    } catch (error) {
      summary.classList.add('error');
      summary.textContent = error?.message || '起局失败，请检查输入日期和时间。';
      if (silent) console.warn('[自动起局]', error);
    }
  }
  function openLiurenChartModal() {
    const now = new Date();
    const pad = value => String(value).padStart(2, '0');
    $('#liurenDateInput').value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    $('#liurenTimeInput').value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const summary = $('#liurenChartSummary');
    summary.classList.remove('error');
    summary.textContent = '选择日期和时间后，点击起课。';
    $('#liurenChartModal').classList.add('open');
    $('#liurenChartModal').setAttribute('aria-hidden', 'false');
  }
  function closeLiurenChartModal() {
    $('#liurenChartModal').classList.remove('open');
    $('#liurenChartModal').setAttribute('aria-hidden', 'true');
  }
  async function calculateLiurenFromDate(options = {}) {
    const silent = !!options.silent;
    const summary = $('#liurenChartSummary');
    summary.classList.remove('error');
    if (!silent) summary.textContent = '正在加载历法组件并起课…';
    try {
      await loadLunarLibrary();
      if (!window.LiurenEngine) throw new Error('六壬排盘组件未加载，请检查 demo/vendor/liuren-engine.js。');
      const dateValue = $('#liurenDateInput').value;
      if (!dateValue) throw new Error('请先选择公历日期。');
      const [year, month, day] = dateValue.split('-').map(Number);
      const [hour, minute] = ($('#liurenTimeInput').value || '12:00').split(':').map(Number);
      const solar = window.Solar.fromYmdHms(year, month, day, hour, minute, 0);
      const lunar = solar.getLunar();
      const dayGz = lunar.getDayInGanZhiExact();
      const hourGz = lunar.getTimeInGanZhi();
      const yearGz = lunar.getYearInGanZhi();
      const monthGz = lunar.getMonthInGanZhi();
      // 中气换将；占时取正时。昼夜贵人固定按 卯–申 为昼。
      const prevQi = lunar.getPrevQi();
      const hourBranch = hourGz[1];
      liurenMeta.dayStem = dayGz[0];
      liurenMeta.dayBranch = dayGz[1];
      liurenMeta.hourBranch = hourBranch;
      liurenMeta.monthBranch = monthGz[1];
      liurenMeta.moonGeneral = (prevQi && window.LiurenEngine.QI_JIANG[prevQi.getName()]) || '亥';
      liurenMeta.dayNight = '卯辰巳午未申'.indexOf(hourBranch) >= 0 ? 'day' : 'night';
      liurenMeta.solar = `${year}年${month}月${day}日 ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      liurenMeta.lunar = `${lunar.getYearInChinese()}年${lunar.getMonthInChinese()}月${lunar.getDayInChinese()} ${hourBranch}时`;
      liurenMeta.pillars = [['年', yearGz], ['月', monthGz], ['日', dayGz], ['时', hourGz]];
      rebuildLiurenChart();
      renderTemplate('liuren');
      const chart = liurenChart;
      summary.textContent = `${dayGz}日 ${hourBranch}时 · 月将${liurenMeta.moonGeneral} · ${chart.principle} · 三传 ${chart.passes.map(p => p.branch).join('')} · 空亡 ${chart.kong.join('')}`;
      if (!silent) {
        notify(`起课完成：${chart.principle}，三传 ${chart.passes.map(p => p.branch).join(' → ')}。`);
        closeLiurenChartModal();
      }
    } catch (error) {
      summary.classList.add('error');
      summary.textContent = error?.message || '起课失败，请检查输入日期和时间。';
      if (silent) console.warn('[六壬自动起课]', error);
    }
  }
  function clearAllEffectsQuiet() {
    [...handles.keys()].forEach(id => stopHandle(id, true));
    overlay.innerHTML = '';
    stageSurface.getAnimations().forEach(a => a.cancel());
    stageSurface.style.transform = '';
    clearPalaceQuickFocus();
  }
  // No single-click delay: selection is immediate; only the repeated-click
  // highlight waits briefly so a double click can open the editor instead.
  function wireAnchors() {
    $$('[data-element-id]', boardContent).forEach(el => {
      el.addEventListener('click', event => handleAnchorClick(el.dataset.elementId, event.target));
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleAnchorClick(el.dataset.elementId, el); } });
      // 点选或已进入效果后，光标停在本格内滚动滚轮即可前后切换阶段（下滚前进、上滚后退）。
      let wheelAt = 0;
      el.addEventListener('wheel', event => {
        if (!el.classList.contains('selected') && !el.classList.contains('quick-focus')) return;
        if (Math.abs(event.deltaY) < 8) return;
        event.preventDefault();
        const now = performance.now();
        if (now - wheelAt < 180) return;
        wheelAt = now;
        applyPalaceQuickFocus(el.dataset.elementId, Math.sign(event.deltaY));
      }, { passive: false });
    });
  }
  function selectElement(id) {
    selectedId = id;
    focusOrder = [id];
    $('#sourceTarget').value = id;
    updateSelected();
  }
  // 聚光多选按点击顺序填入主目标 / 关系目标 / 多方关系目标；第四项起只高亮不连线。
  function syncFocusTargets() {
    const slots = focusOrder.slice(0, 3);
    $('#sourceTarget').value = slots[0] || selectedId;
    $('#targetTarget').value = slots[1] || '';
    $('#convergeTarget').value = slots[2] || '';
    selectedId = slots[0] || selectedId;
    updateSelected();
  }
  function updateSelected() {
    $$('[data-element-id]', boardContent).forEach(el => el.classList.toggle('selected', el.dataset.elementId === selectedId));
    const el = findTarget(selectedId);
    const label = el?.dataset.label || '未选择';
    $('#selectedLabel').textContent = label;
    $('#selectedHint').textContent = `当前主目标：${label}。点击其他位置可以切换；关系效果需要再选择一个终点。`;
  }
  function getTargets(effectId) {
    // 关系效果共用一个目标序列：主目标 → 关系目标 → 多方关系目标（留空即单向）。
    if (effectId === 'relation.flow' || effectId === 'relation.suppress') {
      const ids = [$('#sourceTarget').value, $('#targetTarget').value];
      const third = $('#convergeTarget').value;
      if (third) ids.push(third);
      return ids;
    }
    return [$('#sourceTarget').value];
  }
  function run(effectId) {
    const ids = getTargets(effectId);
    if (effectId === 'relation.flow' || effectId === 'relation.suppress') {
      if (!ids[0] || !ids[1]) { notify('关系效果需要先选择主目标和关系目标。'); return null; }
      if (new Set(ids).size !== ids.length) { notify('关系路径不能包含重复位置。'); return null; }
    }
    const id = playEffect(effectId, ids);
    const labels = { 'highlight.focus': '聚光高亮', 'element.lift': '局部浮起', 'relation.flow': '多方汇聚', 'relation.suppress': '作用 / 制化' };
    if (id) notify(`已触发：${labels[effectId] || effectId}`);
    else if (labels[effectId]) notify(`已触发：${labels[effectId]}`);
    return id;
  }

  function playComposition() {
    stopComposition();
    const source = $('#sourceTarget').value;
    let target = $('#targetTarget').value;
    if (target === source) target = (allTemplates[currentTemplate].find(e => e[0] !== source) || [source])[0];
    $('#targetTarget').value = target;
    const policy = activePolicy();
    const events = [
      { at: 0, effect: 'highlight.focus', targets: [source], policy },
      { at: 800, effect: 'relation.flow', targets: [source, target], policy },
      { at: 2300, effect: 'imagery.fire.flare', targets: [target], policy },
    ];
    composition = { events, startedAt: performance.now(), elapsed: 0, timers: [], handles: [], status: 'playing' };
    scheduleCompositionEvents();
    notify('示例组合已开始：高亮 → 关系流动 → 象意焰光。');
  }
  function scheduleCompositionEvents() {
    if (!composition) return;
    const comp = composition;
    comp.events.forEach((event, index) => {
      if (event.done) return;
      const delay = Math.max(0, event.at - comp.elapsed);
      const timer = setTimeout(() => {
        if (!composition || composition !== comp || comp.status !== 'playing') return;
        event.done = true;
        const id = playEffect(event.effect, event.targets, { policy: event.policy, duration: event.effect === 'highlight.focus' ? 750 : event.effect === 'relation.flow' ? 1300 : 1700 });
        if (id) comp.handles.push(id);
      }, delay);
      comp.timers.push(timer);
    });
    const end = Math.max(...comp.events.map(e => e.at + 1800));
    comp.timers.push(setTimeout(() => { if (composition === comp && comp.status === 'playing') comp.status = 'completed'; }, Math.max(0, end - comp.elapsed)));
  }
  function pauseComposition() {
    if (!composition || composition.status !== 'playing') return;
    const comp = composition;
    comp.elapsed += performance.now() - comp.startedAt;
    comp.timers.forEach(clearTimeout); comp.timers = [];
    comp.handles.forEach(pauseHandle);
    comp.status = 'paused'; notify('组合已暂停。');
  }
  function resumeComposition() {
    if (!composition || composition.status !== 'paused') return;
    const comp = composition;
    comp.handles.forEach(resumeHandle);
    comp.startedAt = performance.now(); comp.status = 'playing'; scheduleCompositionEvents(); notify('组合继续播放。');
  }
  function stopComposition() {
    if (!composition) return;
    composition.timers.forEach(clearTimeout);
    composition.handles.forEach(id => stopHandle(id, true));
    composition.status = 'stopped'; composition = null;
  }

  // 先让标签自己亮起来，再把重建盘面推到下一帧，点击不会看起来没反应。
  $$('.template-tab').forEach(btn => btn.addEventListener('click', () => {
    if (btn.dataset.template === currentTemplate) return;
    $$('.template-tab').forEach(b => b.classList.toggle('active', b === btn));
    requestAnimationFrame(() => renderTemplate(btn.dataset.template));
    if (btn.dataset.template === 'liuren') autoLiurenToNow().catch(() => {});
  }));
  function openFieldPicker(select) {
    if (!select) return;
    expandPicker(select);
    if (typeof select.showPicker === 'function') {
      try { select.showPicker(); return; } catch { /* fall through */ }
    }
    // Browsers without showPicker: reveal the picker so it can be clicked directly.
    select.classList.add('picker-fallback');
    select.focus();
  }
  // A tight double click opens the editor; the first click already selected the anchor.
  // 奇门与四柱改为自动排盘，双击不再改字：奇门弹宫位格局，四柱无动作。
  function openAnchorEditor(id, target) {
    if (currentTemplate === 'qimen' && qimenPatterns.mode) return;
    const cell = findTarget(id);
    if (!cell) return;
    clearPalaceQuickFocus();
    if (currentTemplate === 'qimen') {
      const palace = qimenPalaces.find(p => `qimen.palace.${p.key}` === id);
      if (palace) openQimenPatternPanel(cell, palace);
      return;
    }
    if (currentTemplate === 'bazi') return;
    const select = cell.querySelector('.bazi-character-picker, .hex-picker-overlay');
    if (select) openFieldPicker(select);
  }
  function closeQimenStateEditor() {
    qimenDualEditor?.panel.remove();
    qimenDualEditor = null;
  }
  // One stem's 十二长生 string holds one or two characters; the panel edits that
  // string alone, keeping the paired characters in 长生 order.
  function openQimenStateEditor(cell, palace, key) {
    closeQimenStateEditor();
    const panel = document.createElement('div');
    panel.className = 'qimen-state-editor';
    panel.setAttribute('role', 'listbox');
    panel.setAttribute('aria-multiselectable', 'true');
    panel.setAttribute('aria-label', `${palace.name}宫十二长生`);
    panel.innerHTML = lifeStates.map(state => `<button type="button" role="option" data-state="${state}">${state}</button>`).join('');
    document.body.appendChild(panel);
    qimenDualEditor = { panel, cell, palace };
    const sync = () => {
      const text = palace[key] || '';
      $$(`[data-qimen-display="${key}"]`, cell).forEach(el => { el.textContent = text; });
      $$('[data-state]', panel).forEach(btn => {
        const on = text.includes(btn.dataset.state[0]);
        btn.classList.toggle('on', on);
        btn.setAttribute('aria-selected', String(on));
      });
    };
    const rect = cell.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - panel.offsetWidth - 8))}px`;
    panel.style.top = `${Math.min(rect.bottom + 6, innerHeight - panel.offsetHeight - 8)}px`;
    sync();
    panel.addEventListener('click', event => {
      const btn = event.target.closest('[data-state]');
      if (!btn) return;
      const picked = String(palace[key] || '').split('').filter(Boolean);
      const state = btn.dataset.state[0];
      const at = picked.indexOf(state);
      if (at > -1) picked.splice(at, 1);
      else { picked.push(state); if (picked.length > 2) picked.shift(); }
      palace[key] = picked.sort((a, b) => lifeIndex(a) - lifeIndex(b)).join('');
      sync();
      updateSelected();
      notify(`${palace.name}宫状态：${palace[key]}`);
    });
  }
  document.addEventListener('pointerdown', event => {
    if (qimenDualEditor && !qimenDualEditor.panel.contains(event.target)) closeQimenStateEditor();
  });
  $$('.effect-button, .imagery-button').forEach(btn => btn.addEventListener('click', () => run(btn.dataset.effect)));
  $('#sourceTarget').addEventListener('change', () => { selectedId = $('#sourceTarget').value; updateSelected(); });
  $('#targetTarget').addEventListener('change', () => {});
  $('#durationRange').addEventListener('input', e => { $('#durationOutput').textContent = `${(Number(e.target.value)/1000).toFixed(1)} 秒`; });
  $('#intensityRange').addEventListener('input', e => applyIntensity(selectedId, Number(e.target.value), false));
  $('#toneSelect').addEventListener('change', refreshRelationTone);
  $('#qimenWuxingToggle').addEventListener('change', event => {
    qimenWuxing = event.target.checked;
    $$('.qimen-value[data-wx]').forEach(el => el.classList.toggle(`wx-${el.dataset.wx}`, qimenWuxing));
  });
  $('#undoBtn').addEventListener('click', undoLast);
  $('#clearAllBtn').addEventListener('click', () => { stopComposition(); clearAllEffects(); });
  // Clicking blank stage space clears every running effect; controls and anchors are exempt.
  document.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('[data-element-id], .motion-panel, .bazi-date-modal, .stage-toolbar, button, select, input, label, a')) return;
    const quick = stageSurface.querySelector('.quick-zoom, .quick-spotlight, .quick-dim-others, .quick-lift');
    if (!overlay.children.length && !composition && !quick) return;
    stopComposition();
    clearAllEffects();
  });
  $('#playCompositionBtn').addEventListener('click', playComposition);
  $('#pauseCompositionBtn').addEventListener('click', pauseComposition);
  $('#resumeCompositionBtn').addEventListener('click', resumeComposition);
  $('#stopCompositionBtn').addEventListener('click', () => { stopComposition(); notify('组合播放已打断，并恢复本次组合效果。'); });
  // 窄屏下控制面板是右侧抽屉：初始收起，.hidden 与 .open 必须同步，否则点 × 关不掉。
  const narrowPanel = matchMedia('(max-width: 900px)');
  const setPanelOpen = open => {
    panel.classList.toggle('hidden', !open);
    panel.classList.toggle('open', open);
  };
  if (narrowPanel.matches) setPanelOpen(false);
  narrowPanel.addEventListener('change', () => { if (narrowPanel.matches) setPanelOpen(false); });
  $('#panelToggle').addEventListener('click', () => {
    const open = panel.classList.contains('hidden');
    setPanelOpen(open);
    if (open) toggleCaseDrawer(false);
  });
  $('#panelClose').addEventListener('click', () => setPanelOpen(false));
  function togglePresentation() {
    const isOn = appShell.classList.toggle('presentation-mode');
    $('#presentationBtn').textContent = isOn ? '退出展示模式' : '◫ 展示模式';
    if (isOn && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
    if (!isOn && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
  $('#presentationBtn').addEventListener('click', togglePresentation);
  $('#exitPresentationBtn').addEventListener('click', togglePresentation);
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && appShell.classList.contains('presentation-mode')) {
      appShell.classList.remove('presentation-mode');
      $('#presentationBtn').textContent = '◫ 展示模式';
    }
    requestAnimationFrame(() => requestAnimationFrame(fitStageBoard));
  });
  window.addEventListener('resize', () => requestAnimationFrame(fitStageBoard));
  const stageSlot = $('.stage-board-slot');
  if (window.ResizeObserver && stageSlot) {
    const stageResizeObserver = new ResizeObserver(() => requestAnimationFrame(fitStageBoard));
    stageResizeObserver.observe(stageSlot);
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && appShell.classList.contains('presentation-mode') && !document.fullscreenElement) { appShell.classList.remove('presentation-mode'); $('#presentationBtn').textContent = '◫ 展示模式'; } });

  // Bazi birth-date entry and calendar conversion controls.
  $('#baziEntryTrigger').addEventListener('click', openBaziDateModal);
  $('#baziDateClose').addEventListener('click', closeBaziDateModal);
  $('#baziDateCancel').addEventListener('click', closeBaziDateModal);
  $('#baziCalculateBtn').addEventListener('click', calculateBaziFromDate);
  $$('.date-mode-switch button').forEach(button => button.addEventListener('click', () => setBaziDateMode(button.dataset.dateMode)));
  $('#baziDateModal').addEventListener('click', event => { if (event.target === $('#baziDateModal')) closeBaziDateModal(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && $('#baziDateModal').classList.contains('open')) closeBaziDateModal(); });
  $('#qimenChartTrigger').addEventListener('click', openQimenChartModal);
  $('#qimenChartClose').addEventListener('click', closeQimenChartModal);
  $('#qimenChartCancel').addEventListener('click', closeQimenChartModal);
  $('#qimenCalculateBtn').addEventListener('click', calculateQimenFromDate);
  $('#liurenChartTrigger').addEventListener('click', openLiurenChartModal);
  $('#liurenChartClose').addEventListener('click', closeLiurenChartModal);
  $('#liurenChartCancel').addEventListener('click', closeLiurenChartModal);
  $('#liurenCalculateBtn').addEventListener('click', calculateLiurenFromDate);
  $('#qimenChartModal').addEventListener('click', event => { if (event.target === $('#qimenChartModal')) closeQimenChartModal(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && $('#qimenChartModal').classList.contains('open')) closeQimenChartModal(); });
  $('#meihuaChartTrigger').addEventListener('click', openMeihuaChartModal);
  $('#meihuaChartClose').addEventListener('click', closeMeihuaChartModal);
  $('#meihuaCancel').addEventListener('click', closeMeihuaChartModal);
  $('#meihuaCalculateBtn').addEventListener('click', calculateMeihua);
  $$('[data-meihua-mode]').forEach(btn => btn.addEventListener('click', () => setMeihuaMode(btn.dataset.meihuaMode)));
  $('#meihuaChartModal').addEventListener('click', event => { if (event.target === $('#meihuaChartModal')) closeMeihuaChartModal(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && $('#meihuaChartModal').classList.contains('open')) closeMeihuaChartModal(); });
  $('#lunarMonthInput').innerHTML = '<option value="" selected>选择月份</option>' + Array.from({length:12},(_,i)=>`<option value="${i+1}">${i+1}月</option>`).join('');
  setDateDefaultsIfEmpty();
  setBaziDateMode('solar');

  // ── 案例库：四柱 / 奇门 / 梅花各存一套 ──────────────────────────
  // 本机启动器会提供 /api/cases，案例落到程序旁的 data/cases.json；
  // 用纯静态服务器或 file:// 打开时接口不可用，退回浏览器 localStorage。
  const CASE_KEY = 'motion.cases.v1';
  const CASE_API = '/api/cases';
  const CASE_TEMPLATES = { bazi: '四柱', qimen: '奇门', meihua: '梅花' };
  const caseDrawer = $('#caseDrawer');
  const caseToggle = $('#caseToggle');
  let caseData = { bazi: [], qimen: [], meihua: [], cats: { bazi: [], qimen: [], meihua: [] } };
  let caseApiOk = false;
  let caseFilter = '全部';
  let caseQuery = '';
  let caseDraft = null;
  let caseFeedbackId = null;
  const mergeCases = saved => {
    if (!saved) return;
    caseData = { ...caseData, ...saved, cats: { ...caseData.cats, ...(saved.cats || {}) } };
  };
  try {
    mergeCases(JSON.parse(window.localStorage.getItem(CASE_KEY) || 'null'));
  } catch (error) { /* 本地存储不可用时按空库处理 */ }

  function persistCases() {
    const body = JSON.stringify(caseData);
    try { window.localStorage.setItem(CASE_KEY, body); }
    catch (error) { notify('浏览器本地存储不可用，案例只在本次会话保留。'); }
    if (!caseApiOk) return;
    fetch(CASE_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
      .then(response => { if (!response.ok) throw new Error('save failed'); })
      .catch(() => { caseApiOk = false; notify('写入本机案例文件失败，后续改动只保留在浏览器缓存。'); });
  }

  // 本机文件是权威副本：启动后用它覆盖浏览器缓存。
  fetch(CASE_API, { cache: 'no-store' })
    .then(response => (response.ok ? response.json() : null))
    .then(saved => {
      if (!saved || typeof saved !== 'object') return;
      caseApiOk = true;
      mergeCases(saved);
      if (caseDrawer?.classList.contains('open')) renderCaseDrawer();
    })
    .catch(() => { /* 无接口时保持 localStorage 行为 */ });

  // 当前盘面快照，用于「存为当前盘面」。
  const pad2 = n => String(n).padStart(2, '0');
  function localToday() { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
  // qimenMeta.solar 形如「2026年10月7日 23:00」，取回日期与时刻。
  function qimenSnapshotTime() {
    const match = /^(\d+)年(\d+)月(\d+)日\s+(\d+):(\d+)/.exec(qimenMeta.solar || '');
    if (!match) return { solar: localToday(), time: '12:00' };
    return { solar: `${match[1]}-${pad2(match[2])}-${pad2(match[3])}`, time: `${pad2(match[4])}:${match[5]}` };
  }
  function caseSnapshot() {
    if (currentTemplate === 'bazi') return {
      stems: baziPillars.map(p => p.stem), branches: baziPillars.map(p => p.branch),
      gender: baziChart?.gender === 0 ? '女' : '男',
      solar: $('#solarDateInput')?.value || localToday(),
      // 排盘后的出生时刻随案例一起保存，供左上角日期与再次载入使用。
      time: / (\d{2}:\d{2})$/.exec(baziMeta.solar)?.[1] || '',
    };
    if (currentTemplate === 'qimen') return {
      stems: qimenMeta.pillars.map(([, value]) => value[0]), branches: qimenMeta.pillars.map(([, value]) => value[1]),
      gender: '男', ...qimenSnapshotTime(), method: $('#qimenMethodInput')?.value || 'chaibu',
      question: qimenMeta.question || '',
    };
    return { trigrams: meihuaSlots.map(slot => slot.value), gender: '男', solar: localToday() };
  }

  const caseGzText = item => item.trigrams
    ? item.trigrams.join(' ')
    : (item.stems || []).map((stem, i) => stem + (item.branches?.[i] || '')).join(' ');

  function caseCategories() {
    const own = caseData.cats[currentTemplate] || [];
    const used = (caseData[currentTemplate] || []).map(item => item.category).filter(Boolean);
    return ['全部', ...new Set([...own, ...used])];
  }

  function caseCardHtml(item) {
    const initial = (item.name || '未')[0];
    const hasLog = !!(item.feedback || item.puzzle);
    return `<article class="case-card" data-case-load="${item.id}">
      <div class="case-avatar">${escapeAttr(initial)}</div>
      <div class="case-body">
        <div class="case-title"><b>${escapeAttr(item.name || '未命名')}</b>${item.category ? `<i>${escapeAttr(item.category)}</i>` : ''}${hasLog ? '<i class="case-dot" title="有反馈" aria-label="有反馈">●</i>' : ''}</div>
        <div class="case-meta">阳历：${escapeAttr(item.solar || '—')}${item.gender ? ` · ${escapeAttr(item.gender)}` : ''}</div>
        <div class="case-gz">${caseGzText(item)}</div>
      </div>
      <button class="case-more" data-case-more="${item.id}" type="button" aria-label="编辑案例">⋮</button>
    </article>`;
  }

  // 载入案例后弹出的反馈面板：记录对方反馈与看不懂的问题。
  function caseFeedbackHtml() {
    const item = (caseData[currentTemplate] || []).find(entry => entry.id === caseFeedbackId);
    if (!item) { caseFeedbackId = null; return ''; }
    return `<div class="case-head">
        <div><div class="panel-kicker">FEEDBACK LOG</div><h2>反馈记录</h2></div>
        <button class="icon-button" data-case-close type="button" aria-label="关闭案例库">×</button>
      </div>
      <div class="case-scope"><span class="active">${escapeAttr(item.name || '未命名')}</span><span>阳历 ${escapeAttr(item.solar || '—')}</span></div>
      <div class="case-form">
        <label>反馈详情<textarea id="caseFeedbackInput" rows="6" placeholder="对方说了什么、有什么反应、有没有应验">${escapeAttr(item.feedback || '')}</textarea></label>
        <label>断语思路<textarea id="casePuzzleInput" rows="4" placeholder="对方没听懂、或需要再解释的点">${escapeAttr(item.puzzle || '')}</textarea></label>
        <div class="case-form-actions">
          <button data-case-feedback-save type="button">保存反馈</button>
          <button class="ghost" data-case-feedback-back type="button">返回列表</button>
        </div>
      </div>`;
  }

  function saveCaseFeedback() {
    const item = (caseData[currentTemplate] || []).find(entry => entry.id === caseFeedbackId);
    if (!item) return;
    item.feedback = $('#caseFeedbackInput', caseDrawer)?.value || '';
    item.puzzle = $('#casePuzzleInput', caseDrawer)?.value || '';
    persistCases();
    notify('反馈已保存。');
  }

  function caseFormHtml() {
    const draft = caseDraft;
    const cats = caseCategories().filter(name => name !== '全部');
    const trigrams = ['乾', '兑', '离', '震', '巽', '坎', '艮', '坤'];
    const fields = currentTemplate === 'meihua'
      ? `<label>六卦<div class="case-gz-grid six">${meihuaSlots.map((slot, i) => `<select data-draft-tri="${i}" aria-label="${slot.title}">${makeOptions(trigrams, draft.trigrams?.[i] || slot.value)}</select>`).join('')}</div></label>`
      : `<label>四柱（年月日时）<div class="case-gz-grid">${[0, 1, 2, 3].map(i => `<div class="case-gz-col"><select data-draft-stem="${i}" aria-label="天干">${makeOptions(baziStems, draft.stems?.[i] || '')}</select><select data-draft-branch="${i}" aria-label="地支">${makeOptions(baziBranches, draft.branches?.[i] || '')}</select></div>`).join('')}</div></label>`;
    // 四柱与奇门按案例时刻排盘，编辑页可改时辰；梅花没有时辰。
    const timeField = currentTemplate === 'meihua' ? '' : `<label>时辰<input id="caseTimeInput" type="time" value="${escapeAttr(draft.time || '')}" /></label>`;
    return `<div class="case-head">
        <div><div class="panel-kicker">CASE EDIT</div><h2>${draft.id ? '编辑案例' : '新建案例'}</h2></div>
        <button class="icon-button" data-case-close type="button" aria-label="关闭案例库">×</button>
      </div>
      <div class="case-form">
        <label>名称<input id="caseNameInput" type="text" value="${escapeAttr(draft.name || '')}" placeholder="例如：人生如梦" /></label>
        <label>分类<input id="caseCategoryInput" type="text" list="caseCatList" value="${escapeAttr(draft.category || '')}" placeholder="如：身边" /><datalist id="caseCatList">${cats.map(name => `<option value="${escapeAttr(name)}"></option>`).join('')}</datalist></label>
        <label>性别<select id="caseGenderInput"><option value="男"${draft.gender === '男' ? ' selected' : ''}>男</option><option value="女"${draft.gender === '女' ? ' selected' : ''}>女</option></select></label>
        <label>阳历日期<input id="caseSolarInput" type="date" value="${escapeAttr(draft.solar || '')}" /></label>
        ${timeField}
        ${fields}
        <div class="case-form-actions">
          <button data-case-save type="button">保存</button>
          <button class="ghost" data-case-cancel type="button">取消</button>
          ${draft.id ? '<button class="danger" data-case-delete type="button">删除</button>' : ''}
        </div>
      </div>`;
  }

  function renderCaseDrawer() {
    if (caseDraft) { caseDrawer.innerHTML = caseFormHtml(); return; }
    if (caseFeedbackId) { caseDrawer.innerHTML = caseFeedbackHtml(); return; }
    const items = (caseData[currentTemplate] || []).filter(item =>
      (caseFilter === '全部' || item.category === caseFilter)
      && (!caseQuery || `${item.name || ''} ${item.solar || ''} ${caseGzText(item)}`.includes(caseQuery)));
    caseDrawer.innerHTML = `<div class="case-head">
        <div><div class="panel-kicker">CASE LIBRARY</div><h2>${CASE_TEMPLATES[currentTemplate]}案例</h2></div>
        <button class="icon-button" data-case-close type="button" aria-label="关闭案例库">×</button>
      </div>
      <div class="case-scope"><span class="active">${CASE_TEMPLATES[currentTemplate]}</span><span>共 ${items.length} 条</span></div>
      <div class="case-search"><input id="caseSearch" type="search" placeholder="搜索名称、日期或四柱" value="${escapeAttr(caseQuery)}" /></div>
      <div class="case-cats">
        ${caseCategories().map(name => `<button class="case-chip${name === caseFilter ? ' active' : ''}" data-case-cat="${escapeAttr(name)}" type="button">${escapeAttr(name)}</button>`).join('')}
        <button class="case-chip add" data-case-addcat type="button" title="新建分类">＋</button>
        <button class="case-chip add" data-case-delcat type="button" title="删除当前分类">－</button>
      </div>
      <div class="case-list">${items.length ? items.map(caseCardHtml).join('') : '<div class="case-empty">这个模板下还没有案例<br />点下方按钮把当前盘面存进来</div>'}</div>
      <div class="case-foot"><button data-case-new type="button">＋ 存为当前盘面</button></div>`;
  }

  let panelWasOpen = false;
  function toggleCaseDrawer(open) {
    const next = open === undefined ? !caseDrawer.classList.contains('open') : open;
    if (next) {
      // 与控制面板互斥，两者共用右侧同一列。
      panelWasOpen = !panel.classList.contains('hidden');
      panel.classList.add('hidden');
      caseDraft = null; caseFeedbackId = null; caseFilter = '全部'; renderCaseDrawer();
    } else if (panelWasOpen) {
      panel.classList.remove('hidden');
      panelWasOpen = false;
    }
    caseDrawer.classList.toggle('open', next);
    caseDrawer.setAttribute('aria-hidden', String(!next));
    caseToggle.setAttribute('aria-expanded', String(next));
  }

  function openCaseEditor(id) {
    const existing = id ? (caseData[currentTemplate] || []).find(item => item.id === id) : null;
    caseDraft = existing ? { ...existing } : { id: '', name: '', category: caseFilter === '全部' ? '' : caseFilter, ...caseSnapshot() };
    renderCaseDrawer();
  }

  function deleteCaseDraft() {
    if (!caseDraft?.id) return;
    caseData[currentTemplate] = (caseData[currentTemplate] || []).filter(item => item.id !== caseDraft.id);
    persistCases();
    caseDraft = null;
    renderCaseDrawer();
    notify('案例已删除。');
  }

  function saveCaseDraft() {
    const timeInput = $('#caseTimeInput', caseDrawer);
    // 以原记录为底再覆盖表单字段，避免编辑时丢掉表单上没有的反馈、断语等。
    const draft = {
      ...caseDraft,
      id: caseDraft.id || `c${Date.now().toString(36)}`,
      name: ($('#caseNameInput', caseDrawer)?.value || '').trim() || '未命名',
      category: ($('#caseCategoryInput', caseDrawer)?.value || '').trim(),
      gender: $('#caseGenderInput', caseDrawer)?.value || '',
      solar: $('#caseSolarInput', caseDrawer)?.value || '',
      // 梅花没有时辰输入框，保留原值；其余模板以输入框为准，允许清空。
      time: timeInput ? timeInput.value : (caseDraft.time || ''),
      method: caseDraft.method,
    };
    if (currentTemplate === 'meihua') draft.trigrams = $$('[data-draft-tri]', caseDrawer).map(el => el.value);
    else {
      draft.stems = $$('[data-draft-stem]', caseDrawer).map(el => el.value);
      draft.branches = $$('[data-draft-branch]', caseDrawer).map(el => el.value);
    }
    const list = caseData[currentTemplate] || (caseData[currentTemplate] = []);
    const index = list.findIndex(item => item.id === draft.id);
    if (index >= 0) list[index] = draft; else list.unshift(draft);
    if (draft.category) {
      const cats = caseData.cats[currentTemplate] || (caseData.cats[currentTemplate] = []);
      if (!cats.includes(draft.category)) cats.push(draft.category);
    }
    persistCases();
    caseDraft = null;
    caseFilter = '全部';
    renderCaseDrawer();
    notify(index >= 0 ? '案例已更新。' : '案例已保存。');
  }

  // 案例存阳历日期与时辰；农历在历法组件可用时换算，取不到就只显示阳历。
  async function baziMetaFromCase(item) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(item.solar || '');
    if (!match) { baziMeta = { solar: '', lunar: '' }; baziChart = null; return; }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(item.time || '');
    const hour = timeMatch ? Number(timeMatch[1]) : null;
    const minute = timeMatch ? Number(timeMatch[2]) : 0;
    const clock = hour === null ? '' : ` ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    baziMeta = { solar: `${year}年${month}月${day}日${clock}`, lunar: '' };
    try {
      await loadLunarLibrary();
      const lunar = hour === null
        ? window.Solar.fromYmd(year, month, day).getLunar()
        : window.Solar.fromYmdHms(year, month, day, hour, minute, 0).getLunar();
      baziMeta.lunar = `${lunar.getYearInChinese()}年${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}${hour === null ? '' : ` ${lunar.getTimeZhi()}时`}`;
      // 载入案例时同样按出生时刻重排大运流年；不重排会停在上一盘或示例盘。
      const eight = lunar.getEightChar();
      const sect = 2;
      eight.setSect(sect);
      const gender = item.gender === '女' ? 0 : 1;
      const daYun = eight.getYun(gender, sect).getDaYun(10);
      const nowYear = new Date().getFullYear();
      const current = daYun.find(d => nowYear >= d.getStartYear() && nowYear <= d.getEndYear())
        || daYun.find(d => d.getIndex() > 0);
      const years = baziLiuNianList(current?.getIndex(), { daYun });
      const liuNian = years.find(d => d.getYear() === nowYear) || years[0];
      baziChart = { gender, daYun, daYunIndex: current?.getIndex(), liuNianYear: liuNian?.getYear() };
      const shownDayun = current?.getGanZhi() ? current : daYun.find(d => d.getIndex() > 0);
      setFortune('dayun', shownDayun?.getGanZhi());
      setFortune('liunian', liuNian?.getGanZhi());
    } catch (error) { baziChart = null; /* 无历法组件时仅显示阳历 */ }
  }

  async function loadCaseById(id) {
    const item = (caseData[currentTemplate] || []).find(entry => entry.id === id);
    if (!item) return;
    try {
      if (currentTemplate === 'bazi') {
        setBaziPillars([0, 1, 2, 3].map(i => ({ stem: item.stems?.[i] || '甲', branch: item.branches?.[i] || '子' })), item.gender === '女' ? 0 : 1);
        await baziMetaFromCase(item);
        renderTemplate('bazi');
      } else if (currentTemplate === 'qimen') {
        $('#qimenDateInput').value = item.solar || '';
        $('#qimenTimeInput').value = item.time || '12:00';
        $('#qimenMethodInput').value = item.method || 'chaibu';
        // 所问之事随案例走：先取案例里存的题目；老案例没有这个字段，用例名当题目。
        qimenMeta.question = item.question || item.name || '';
        await calculateQimenFromDate();
      } else {
        // 案例只存六卦，起卦方式与动爻没有记录，载入后按展示态呈现。
        meihuaChart = null;
        meihuaMeta = null;
        (item.trigrams || []).forEach((value, i) => { if (meihuaSlots[i]) meihuaSlots[i].value = value; });
        renderTemplate('meihua');
      }
      notify(`已载入案例「${item.name}」。`);
      caseFeedbackId = item.id;
      renderCaseDrawer();
    } catch (error) {
      notify(`载入失败：${error?.message || '未知错误'}`);
    }
  }

  caseToggle?.addEventListener('click', () => {
    // 在反馈页或编辑页时，先回到案例列表。
    if (caseDrawer?.classList.contains('open') && (caseDraft || caseFeedbackId)) {
      caseDraft = null; caseFeedbackId = null; renderCaseDrawer(); return;
    }
    toggleCaseDrawer();
  });
  caseDrawer?.addEventListener('click', event => {
    if (event.target.closest('[data-case-close]')) { toggleCaseDrawer(false); return; }
    const more = event.target.closest('[data-case-more]');
    if (more) { openCaseEditor(more.dataset.caseMore); return; }
    if (event.target.closest('[data-case-new]')) { openCaseEditor(''); return; }
    if (event.target.closest('[data-case-save]')) { saveCaseDraft(); return; }
    if (event.target.closest('[data-case-cancel]')) { caseDraft = null; renderCaseDrawer(); return; }
    if (event.target.closest('[data-case-feedback-save]')) { saveCaseFeedback(); return; }
    if (event.target.closest('[data-case-feedback-back]')) { caseFeedbackId = null; renderCaseDrawer(); return; }
    if (event.target.closest('[data-case-delete]')) { deleteCaseDraft(); return; }
    if (event.target.closest('[data-case-addcat]')) {
      const name = (window.prompt('新分类名称') || '').trim();
      if (!name) return;
      const cats = caseData.cats[currentTemplate] || (caseData.cats[currentTemplate] = []);
      if (!cats.includes(name)) cats.push(name);
      persistCases();
      caseFilter = name;
      renderCaseDrawer();
      return;
    }
    if (event.target.closest('[data-case-delcat]')) {
      if (caseFilter === '全部') { notify('先在分类里选一个，再点 － 删除。'); return; }
      const removed = caseFilter;
      (caseData[currentTemplate] || []).forEach(item => { if (item.category === removed) item.category = ''; });
      caseData.cats[currentTemplate] = (caseData.cats[currentTemplate] || []).filter(name => name !== removed);
      persistCases();
      caseFilter = '全部';
      renderCaseDrawer();
      return;
    }
    const chip = event.target.closest('[data-case-cat]');
    if (chip) { caseFilter = chip.dataset.caseCat; renderCaseDrawer(); return; }
    const card = event.target.closest('[data-case-load]');
    if (card) loadCaseById(card.dataset.caseLoad);
  });
  caseDrawer?.addEventListener('input', event => {
    if (event.target.id !== 'caseSearch') return;
    caseQuery = event.target.value;
    const caret = event.target.selectionStart;
    renderCaseDrawer();
    const input = $('#caseSearch', caseDrawer);
    if (input) { input.focus(); input.setSelectionRange(caret, caret); }
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (qimenPatternPanel) { closeQimenPatternPanel(); return; }
    if (caseDrawer?.classList.contains('open')) toggleCaseDrawer(false);
  });

  /* ===== 区域配色与预设 ===== */
  const PALETTE_VARS = {
    bg: '--bg', panel: '--panel', panel2: '--panel-2', stage: '--stage', stageTop: '--stage-top',
    tile1: '--tile-1', tile2: '--tile-2', tile3: '--tile-3', hover: '--tile-hover',
    tileBorder: '--tile-border', line: '--line', lineStrong: '--line-strong',
    ink: '--ink', sub: '--sub', muted: '--muted', accent: '--accent', topbar: '--topbar',
    drawer: '--drawer', shadow: '--shadow-soft',
  };
  // 内置预设与 index.html 里 paper 变量块保持一致；冷白 / 暖米为深色外框。
  const BUILTIN_PALETTES = {
    paper: {
      chrome: 'light',
      vars: {
        bg: '#f4f0e7', panel: '#fcf9f3', panel2: '#f7f2e8', stage: '#faf7f0', stageTop: '#fdfbf6',
        tile1: '#ffffff', tile2: '#ffffff', tile3: '#ffffff', hover: '#fdfaf3',
        tileBorder: 'rgba(151,124,80,.32)', line: 'rgba(130,105,65,.16)', lineStrong: 'rgba(130,105,65,.30)',
        ink: '#262119', sub: '#5f5039', muted: '#786b54', accent: '#82632c',
        topbar: 'rgba(252,250,245,.97)', drawer: '#fcf9f3', shadow: 'rgba(115,90,55,.10)',
      },
    },
    cool: {
      chrome: 'dark',
      vars: {
        bg: '#1d2f45', panel: '#22364e', panel2: '#1a2a3e', stage: '#c9d9ea', stageTop: '#e0eaf6',
        tile1: '#eaf2f7', tile2: '#d8e5f0', tile3: '#c4d6e6', hover: '#f4f9fd',
        tileBorder: 'rgba(30,62,98,.26)', line: 'rgba(30,62,98,.16)', lineStrong: 'rgba(30,62,98,.30)',
        ink: '#16243a', sub: '#3b5170', muted: '#5d7592', accent: '#2a5b8a',
        topbar: 'rgba(24,38,56,.98)', drawer: '#e4eef8', shadow: 'rgba(4,14,28,.40)',
      },
    },
    warm: {
      chrome: 'dark',
      vars: {
        bg: '#1d2f45', panel: '#22364e', panel2: '#1a2a3e', stage: '#bfd0e0', stageTop: '#d8e3ee',
        tile1: '#eceae4', tile2: '#eceae4', tile3: '#eceae4', hover: '#f5f3ef',
        tileBorder: 'rgba(40,58,84,.28)', line: 'rgba(40,58,84,.16)', lineStrong: 'rgba(40,58,84,.32)',
        ink: '#1c2836', sub: '#414f60', muted: '#626f80', accent: '#2c5f8a',
        topbar: 'rgba(24,38,56,.98)', drawer: '#f0e8d8', shadow: 'rgba(4,14,28,.42)',
      },
    },
  };
  const customPalettes = () => {
    try { return JSON.parse(localStorage.getItem('motion.presets.v1') || '[]'); } catch (error) { return []; }
  };
  const saveCustomPalettes = list => {
    try { localStorage.setItem('motion.presets.v1', JSON.stringify(list)); } catch (error) {}
  };
  const findPalette = id => BUILTIN_PALETTES[id] || customPalettes().find(item => item.id === id) || null;
  const resolvePalette = theme => theme === 'paper'
    ? BUILTIN_PALETTES.paper
    : theme.startsWith('preset:') ? findPalette(theme.slice(7)) : null;

  const hexToRgba = (hex, alpha) => {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  };
  // <input type="color"> 只认 #rrggbb；预设里的 rgba 值读回来要转一次。
  const toHex = value => {
    const v = String(value || '').trim();
    if (v.startsWith('#')) return v.length === 4 ? '#' + v.slice(1).split('').map(c => c + c).join('') : v.slice(0, 7);
    const match = v.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
    return match ? '#' + [match[1], match[2], match[3]].map(n => Number(n).toString(16).padStart(2, '0')).join('') : '#000000';
  };

  function setPaletteVars(vars) {
    const style = document.documentElement.style;
    Object.entries(PALETTE_VARS).forEach(([key, name]) => {
      if (vars[key]) style.setProperty(name, vars[key]);
    });
  }
  function clearPaletteVars() {
    const style = document.documentElement.style;
    Object.values(PALETTE_VARS).forEach(name => style.removeProperty(name));
    delete document.documentElement.dataset.chrome;
  }

  const paletteInputs = $$('#paletteGrid input[type="color"]');
  let activeTheme = 'paper';
  let editingVars = { ...BUILTIN_PALETTES.paper.vars };
  let editingChrome = 'light';

  function syncPaletteEditor() {
    paletteInputs.forEach(input => {
      input.value = toHex(editingVars[input.dataset.paletteKey] || '#000000');
    });
    const toggle = $('#chromeToggle');
    if (toggle) toggle.checked = editingChrome === 'dark';
    const remove = $('#deletePresetBtn');
    if (remove) remove.hidden = !(activeTheme.startsWith('preset:') && !BUILTIN_PALETTES[activeTheme.slice(7)]);
  }

  function applyTheme(theme) {
    const preset = resolvePalette(theme);
    const base = theme === 'ink' || theme === 'cinnabar' ? theme : 'paper';
    activeTheme = theme;
    clearPaletteVars();
    document.documentElement.dataset.theme = base;
    document.documentElement.style.colorScheme = base === 'paper' ? 'light' : 'dark';
    if (preset) {
      setPaletteVars(preset.vars);
      if (preset.chrome === 'dark') document.documentElement.dataset.chrome = 'dark';
    }
    $$('.theme-switch .theme-option').forEach(btn => {
      const active = btn.dataset.theme ? btn.dataset.theme === theme : theme === 'preset:' + btn.dataset.preset;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    try { localStorage.setItem('motion.theme.v1', theme); } catch (error) {}
    editingVars = { ...(preset ? preset.vars : BUILTIN_PALETTES.paper.vars) };
    editingChrome = preset ? preset.chrome : 'light';
    syncPaletteEditor();
    requestAnimationFrame(() => requestAnimationFrame(fitStageBoard));
  }

  // 面板里调色时不落库、不高亮任何主题按钮；要留存必须保存成预设。
  function applyEditingPalette() {
    activeTheme = 'draft';
    clearPaletteVars();
    document.documentElement.dataset.theme = 'paper';
    document.documentElement.style.colorScheme = 'light';
    setPaletteVars(editingVars);
    if (editingChrome === 'dark') document.documentElement.dataset.chrome = 'dark';
    $$('.theme-switch .theme-option').forEach(btn => {
      btn.classList.remove('active');
      btn.setAttribute('aria-pressed', 'false');
    });
    try { localStorage.setItem('motion.theme.v1', 'draft'); } catch (error) {}
    syncPaletteEditor();
    requestAnimationFrame(() => requestAnimationFrame(fitStageBoard));
  }

  paletteInputs.forEach(input => {
    input.addEventListener('input', () => {
      const key = input.dataset.paletteKey;
      editingVars[key] = input.value;
      if (key === 'accent') {
        editingVars.line = hexToRgba(input.value, .16);
        editingVars.lineStrong = hexToRgba(input.value, .30);
        editingVars.tileBorder = hexToRgba(input.value, .32);
      }
      applyEditingPalette();
    });
  });
  $('#chromeToggle').addEventListener('change', event => {
    editingChrome = event.target.checked ? 'dark' : 'light';
    applyEditingPalette();
  });
  $('#resetPaletteBtn').addEventListener('click', () => applyTheme('paper'));
  $('#savePresetBtn').addEventListener('click', () => {
    const nameInput = $('#presetName');
    const name = nameInput.value.trim() || '自定义配色';
    const preset = {
      id: 'c' + Date.now().toString(36),
      name,
      chrome: editingChrome,
      vars: { ...editingVars },
      swatch: toHex(editingVars.tile2),
    };
    saveCustomPalettes([...customPalettes(), preset]);
    renderPresetButtons();
    nameInput.value = '';
    applyTheme('preset:' + preset.id);
    notify(`已保存预设「${name}」`);
  });
  $('#deletePresetBtn').addEventListener('click', () => {
    if (!activeTheme.startsWith('preset:')) return;
    const id = activeTheme.slice(7);
    saveCustomPalettes(customPalettes().filter(item => item.id !== id));
    renderPresetButtons();
    applyTheme('paper');
    notify('已删除该预设');
  });

  function renderPresetButtons() {
    const wrap = $('#presetSwitch');
    if (!wrap) return;
    wrap.textContent = '';
    customPalettes().forEach(preset => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'theme-option';
      btn.dataset.preset = preset.id;
      btn.setAttribute('aria-pressed', 'false');
      const swatch = document.createElement('i');
      swatch.style.setProperty('--swatch', preset.swatch || '#d8b56d');
      btn.append(swatch, preset.name);
      wrap.append(btn);
    });
  }

  $('.theme-switch').addEventListener('click', event => {
    const btn = event.target.closest('.theme-option');
    if (!btn) return;
    applyTheme(btn.dataset.preset ? 'preset:' + btn.dataset.preset : btn.dataset.theme);
  });

  renderPresetButtons();
  const storedTheme = (() => {
    try { return localStorage.getItem('motion.theme.v1'); } catch (error) { return null; }
  })() || document.documentElement.dataset.theme || 'paper';
  const knownTheme = storedTheme === 'ink' || storedTheme === 'cinnabar' || storedTheme === 'paper'
    || (storedTheme.startsWith('preset:') && findPalette(storedTheme.slice(7)));
  applyTheme(knownTheme ? storedTheme : 'paper');

  // 宫位主字字体：雅黑 / 瘦金，切换只改根节点 data-font，由 CSS 覆盖 .qimen-value。
  function applyFont(font) {
    const next = font === 'shoujin' ? 'shoujin' : 'yahei';
    document.documentElement.dataset.font = next;
    $$('.font-switch .theme-option').forEach(btn => {
      const active = btn.dataset.font === next;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    try { localStorage.setItem('motion.font.v1', next); } catch (error) {}
  }
  $('.font-switch').addEventListener('click', event => {
    const btn = event.target.closest('.theme-option');
    if (btn && btn.dataset.font) applyFont(btn.dataset.font);
  });
  applyFont((() => {
    try { return localStorage.getItem('motion.font.v1'); } catch (error) { return null; }
  })());

  renderTemplate('qimen');
  $('#durationOutput').textContent = '1.5 秒';
  requestAnimationFrame(() => requestAnimationFrame(fitStageBoard));
  // 首屏按当前时间自动起局；示例盘只作为历法库下载完成前的占位。
  autoQimenToNow().catch(() => {});
  notify('奇门双击宫位查看格局；梅花双击改卦；再次点击触发高亮。');

  async function autoQimenToNow() {
    await loadLunarLibrary();
    const now = new Date();
    const pad = value => String(value).padStart(2, '0');
    $('#qimenDateInput').value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    $('#qimenTimeInput').value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    await calculateQimenFromDate({ silent: true });
  }
  // 首次切到六壬时按当前时间起课；示例盘只当日历法库下载完成前的占位。
  let liurenAuto = false;
  async function autoLiurenToNow() {
    if (liurenAuto) return;
    liurenAuto = true;
    await loadLunarLibrary();
    const now = new Date();
    const pad = value => String(value).padStart(2, '0');
    $('#liurenDateInput').value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    $('#liurenTimeInput').value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    await calculateLiurenFromDate({ silent: true });
  }
})();
