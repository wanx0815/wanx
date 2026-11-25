/* 纸上观象 · 落稿交互 */
(() => {
  'use strict';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const canvas = $('#designCanvas');
  const board = $('#boardContent');
  const solarEl = $('#inkSolar');
  const lunarEl = $('#inkLunar');
  const pillarsEl = $('#inkPillars');
  const factsEl = $('#inkFacts');
  const notesEl = $('#inkNotes');
  const questionInput = $('#inkQuestion');
  const panel = $('#controlPanel');
  const caseDrawer = $('#caseDrawer');
  const scrim = $('#sheetScrim');
  const body = document.body;
  const NOTES_KEY = 'ink.notes.v1';
  let notesSaveTimer = null;
  // 批注按盘式各存一份，换盘式只读自己那一份。
  const notesTemplate = () => document.querySelector('.template-tab.active')?.dataset.template || 'all';
  const notesKey = () => `${NOTES_KEY}.${notesTemplate()}`;

  /* 1440 × 900 画布等比缩放；手机走独立布局 */
  function fitCanvas() {
    if (!canvas) return;
    if (innerWidth <= 900) {
      canvas.style.setProperty('--canvas-scale', '1');
      return;
    }
    const scale = Math.min(innerWidth / 1440, innerHeight / 900);
    canvas.style.setProperty('--canvas-scale', String(Math.max(0.4, scale)));
  }
  fitCanvas();
  addEventListener('resize', fitCanvas);

  /* 右侧题签同步：直接从当前盘面读数，不改动排盘逻辑 */
  const clean = value => (value || '').replace(/\s+/g, ' ').trim();

  function renderPillars(labels, stems, branches) {
    if (!pillarsEl || labels.length < 4) return;
    pillarsEl.innerHTML = labels.map((label, index) => `
      <div class="pil"><span>${label}</span><b>${stems[index] || ''}</b><i>${branches[index] || ''}</i></div>
    `).join('');
  }

  function syncMargin() {
    if (!board) return;
    const dates = $$('.qimen-date', board).map(el => clean(el.textContent)).filter(Boolean);
    if (dates.length) {
      if (solarEl) solarEl.textContent = dates[0];
      if (lunarEl) lunarEl.textContent = dates[1] || '';
    }

    const baziBoard = $('.bazi-board', board);
    if (baziBoard) {
      const pickers = $$('.bazi-character-picker', baziBoard);
      if (pickers.length >= 12) {
        const stems = pickers.slice(0, 6).map(node => clean(node.value));
        const branches = pickers.slice(6, 12).map(node => clean(node.value));
        const columns = [2, 3, 4, 5];
        renderPillars(['年柱', '月柱', '日柱', '时柱'], columns.map(index => stems[index]), columns.map(index => branches[index]));
        const dayStem = stems[4] || '';
        const kong = $$('.bazi-kong', baziBoard).map(node => clean(node.textContent));
        if (factsEl) {
          factsEl.innerHTML = [
            dayStem ? `<span>日主 <b>${dayStem}</b></span>` : '',
            kong[4] ? `<span>空亡 <b>${kong[4]}</b></span>` : '',
          ].join('');
        }
      }
    } else {
      const pillarWrap = $('.qimen-pillars', board);
      if (pillarWrap) {
        const spans = $$('span', pillarWrap).map(el => clean(el.textContent)).filter(Boolean);
        if (spans.length >= 12) renderPillars(spans.slice(0, 4), spans.slice(4, 8), spans.slice(8, 12));
      }

      if ($('.meihua-board', board)) {
        if (factsEl) factsEl.innerHTML = '<span>起卦 <b>梅花易数</b></span>';
      } else {
        const factNodes = $$('.qimen-fact', board);
        if (factNodes.length && factsEl) {
          factsEl.innerHTML = factNodes.map(node => {
            const key = clean($('.qimen-k', node)?.textContent).replace(/:$/, '');
            const value = clean($('.qimen-v', node)?.textContent);
            return key && value ? `<span>${key} <b>${value}</b></span>` : '';
          }).join('');
        }
      }
    }

    const sourceQuestion = $('.qimen-question, .liuren-question', board);
    if (sourceQuestion && questionInput && document.activeElement !== questionInput) {
      questionInput.value = sourceQuestion.value || '';
    }
  }

  let syncTimer = null;
  function scheduleSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncMargin, 60);
  }
  if (board) {
    new MutationObserver(scheduleSync).observe(board, { childList: true, subtree: true });
    scheduleSync();
  }
  $$('.template-tab').forEach(tab => tab.addEventListener('click', scheduleSync));

  /* 设计稿的井线与选框：固定 SVG，选框按选中宫平移 */
  const exactGrid = $('#inkExactGrid');
  const exactFrame = $('#inkSelectedFrame');
  function syncExactFrame() {
    const qimen = board?.querySelector('.qimen-board');
    if (exactGrid) exactGrid.style.display = qimen ? '' : 'none';
    if (!exactFrame) return;
    const selected = qimen?.querySelector('.qimen-cell.selected');
    if (!qimen || !selected) {
      exactFrame.style.display = 'none';
      return;
    }
    const boardRect = qimen.getBoundingClientRect();
    const cellRect = selected.getBoundingClientRect();
    const scale = 560 / boardRect.width;
    const left = (cellRect.left - boardRect.left) * scale;
    const top = (cellRect.top - boardRect.top) * scale;
    // 设计稿的框以震4为基准：left 0 / top 186.66。
    exactFrame.setAttribute('transform', `translate(${left.toFixed(2)} ${(top - 186.66).toFixed(2)})`);
    exactFrame.style.display = '';
  }
  syncExactFrame();
  addEventListener('resize', () => requestAnimationFrame(syncExactFrame));
  if (board) {
    new MutationObserver(syncExactFrame).observe(board, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['class'],
    });
  }
  $$('.template-tab').forEach(tab => tab.addEventListener('click', () => requestAnimationFrame(syncExactFrame)));

  /* 所问之事：底栏输入同步到盘内隐藏 textarea */
  questionInput?.addEventListener('input', () => {
    const target = $('.qimen-question, .liuren-question', board);
    if (!target) return;
    target.value = questionInput.value;
    target.dispatchEvent(new Event('input', { bubbles: true }));
  });

  /* 底部笔头 → 现有动效按钮 */
  $$('.brush-dot[data-effect]').forEach(button => {
    button.addEventListener('click', () => {
      const effect = button.dataset.effect;
      $(`.effect-button[data-effect="${effect}"]`)?.click();
    });
  });

  /* 批注：直接写在纸上；点击行首输入，Enter 确认一行并新起一行 */
  function loadNotes() {
    try {
      const saved = JSON.parse(localStorage.getItem(notesKey()) || 'null');
      if (Array.isArray(saved) && saved.length) return saved.map(String);
    } catch (error) { /* 忽略 */ }
    return [''];
  }
  let noteLines = loadNotes();

  function saveNotesSoon() {
    clearTimeout(notesSaveTimer);
    notesSaveTimer = setTimeout(() => {
      noteLines = $$('.note-line', notesEl).map(line => line.textContent.replace(/\u00a0/g, ' ').trim());
      try { localStorage.setItem(notesKey(), JSON.stringify(noteLines)); } catch (error) { /* 忽略 */ }
    }, 220);
  }

  function createLine(text = '', focus = false) {
    const line = document.createElement('div');
    line.className = 'note-line';
    line.contentEditable = 'true';
    line.spellcheck = false;
    line.textContent = text;
    notesEl.append(line);
    line.addEventListener('input', saveNotesSoon);
    line.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const next = document.createElement('div');
        next.className = 'note-line';
        next.contentEditable = 'true';
        next.spellcheck = false;
        line.after(next);
        bindLine(next);
        next.focus();
        saveNotesSoon();
      }
    });
    if (focus) requestAnimationFrame(() => line.focus());
    return line;
  }

  function bindLine(line) {
    line.addEventListener('input', saveNotesSoon);
    line.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const next = document.createElement('div');
      next.className = 'note-line';
      next.contentEditable = 'true';
      next.spellcheck = false;
      line.after(next);
      bindLine(next);
      next.focus();
      saveNotesSoon();
    });
  }

  function renderNotes() {
    if (!notesEl) return;
    notesEl.innerHTML = '';
    noteLines.forEach((text, index) => {
      const line = createLine(text, false);
      if (index === noteLines.length - 1 && !text) {
        // 留一个空行给点击输入
      }
    });
  }
  renderNotes();

  /* 换盘式：旧盘式的批注先按旧键落盘，再读新盘式自己的那一份。 */
  let notesFor = notesTemplate();
  $$('.template-tab').forEach(tab => tab.addEventListener('click', () => {
    const next = tab.dataset.template;
    if (!next || next === notesFor) return;
    clearTimeout(notesSaveTimer);
    const lines = $$('.note-line', notesEl).map(line => line.textContent.replace(/\s+/g, ' ').trim());
    try { localStorage.setItem(`${NOTES_KEY}.${notesFor}`, JSON.stringify(lines)); } catch (error) { /* 忽略 */ }
    notesFor = next;
    noteLines = loadNotes();
    renderNotes();
  }));
  // 首帧后补一次：初始盘式的 active 由 demo.js 渲染时才挂上。
  requestAnimationFrame(() => {
    const current = notesTemplate();
    if (current === notesFor) return;
    notesFor = current;
    noteLines = loadNotes();
    renderNotes();
  });

  notesEl?.addEventListener('click', event => {
    if (event.target.closest('.note-line')) return;
    const lines = $$('.note-line', notesEl);
    const last = lines[lines.length - 1];
    if (last && !last.textContent.trim()) { last.focus(); return; }
    createLine('', true);
    saveNotesSoon();
  });

  /* 纸张浮层：面板 / 案例共用一个遮罩 */
  function syncSheet() {
    const open = (panel && !panel.classList.contains('hidden')) || caseDrawer?.classList.contains('open');
    body.classList.toggle('sheet-open', Boolean(open));
  }
  [panel, caseDrawer].forEach(node => {
    if (node) new MutationObserver(syncSheet).observe(node, { attributes: true, attributeFilter: ['class'] });
  });
  syncSheet();
  scrim?.addEventListener('click', () => {
    if (caseDrawer?.classList.contains('open')) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    } else if (panel && !panel.classList.contains('hidden')) {
      $('#panelClose')?.click();
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && panel && !panel.classList.contains('hidden')) {
      $('#panelClose')?.click();
    }
  });

  /* 画布外点击不误触 */
  document.addEventListener('pointerdown', event => {
    if (event.target.closest('.design-canvas, .control-panel, .case-drawer, .bazi-date-modal, .toast')) return;
    if (body.classList.contains('sheet-open')) return;
  });
})();
