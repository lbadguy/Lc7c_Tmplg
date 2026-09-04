import { hasArea, normalizeSelection } from './selection.js';

const STYLE = `
:host { all: initial; }
.qr-panel { position: fixed; right: 18px; bottom: 18px; z-index: 2147483647; width: min(360px, calc(100vw - 36px)); padding: 14px; border: 1px solid #c8d5dc; border-radius: 8px; color: #16303b; background: #fff; box-shadow: 0 8px 28px #0003; font: 14px system-ui,sans-serif; }
.qr-panel[hidden], .qr-mask[hidden] { display: none; }
.qr-title { margin: 0 0 8px; font-weight: 700; }
.qr-close { position: absolute; top: 8px; right: 8px; width: 30px; height: 30px; border: 0; color: #45616d; background: transparent; font: 22px/1 system-ui,sans-serif; cursor: pointer; }
.qr-message { margin: 8px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.qr-notice { margin: 8px 0; color: #8a5200; line-height: 1.5; white-space: pre-wrap; }
.qr-notice:empty { display: none; }
.qr-results { margin: 8px 0 12px; display: flex; flex-direction: column; gap: 10px; }
.qr-results:empty { display: none; }
.qr-result-card { border: 1px solid #d7e3e8; border-radius: 6px; padding: 10px; background: #f7fafb; }
.qr-result-text { margin: 0 0 8px; word-break: break-all; font-size: 13px; line-height: 1.4; }
.qr-result-notice { margin: 0 0 8px; color: #8a5200; font-size: 12px; line-height: 1.4; }
.qr-result-notice:empty { display: none; }
.qr-result-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.qr-result-actions button { border: 1px solid #9eb5bf; border-radius: 4px; padding: 5px 8px; color: #16303b; background: #fff; font: inherit; font-size: 12px; cursor: pointer; }
.qr-result-actions button:hover { background: #e8f2f5; }
.qr-result-actions button[hidden] { display: none; }
.qr-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.qr-actions button { border: 1px solid #9eb5bf; border-radius: 6px; padding: 7px 10px; color: #16303b; background: #f7fafb; font: inherit; cursor: pointer; }
.qr-actions button:hover { background: #e8f2f5; }
.qr-actions button[hidden] { display: none; }
.qr-mask { position: fixed; inset: 0; z-index: 2147483646; cursor: crosshair; background: #06131a33; touch-action: none; }
.qr-selection { position: absolute; border: 2px solid #f6c344; background: #f6c34433; pointer-events: none; }
`;

export function createScannerUI({ onCurrent, onSelect, onCancel, onCopy, onOpen }) {
  const host = document.createElement('div');
  host.id = 'qr-scanner-root';
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  const shadow = host.attachShadow ? host.attachShadow({ mode: 'closed' }) : host;
  const style = document.createElement('style');
  style.textContent = STYLE;
  shadow.append(style);
  const panel = document.createElement('section');
  panel.className = 'qr-panel'; panel.hidden = true; panel.setAttribute('role', 'status'); panel.style.pointerEvents = 'auto';
  const title = document.createElement('h2'); title.className = 'qr-title'; title.textContent = '二维码扫描器';
  const close = document.createElement('button'); close.className = 'qr-close'; close.type = 'button'; close.textContent = '×'; close.title = '关闭'; close.setAttribute('aria-label', '关闭二维码扫描器');
  const message = document.createElement('div'); message.className = 'qr-message';
  const notice = document.createElement('div'); notice.className = 'qr-notice';
  const results = document.createElement('div'); results.className = 'qr-results';
  const actions = document.createElement('div'); actions.className = 'qr-actions';
  const current = makeButton('扫描当前页', onCurrent);
  const select = makeButton('框选区域', onSelect);
  const cancel = makeButton('取消', onCancel); cancel.hidden = true;
  actions.append(current, select, cancel);
  panel.append(title, close, message, notice, results, actions);
  const mask = document.createElement('div'); mask.className = 'qr-mask'; mask.hidden = true; mask.tabIndex = 0; mask.setAttribute('aria-label', '框选二维码区域'); mask.style.pointerEvents = 'auto';
  const selection = document.createElement('div'); selection.className = 'qr-selection'; mask.append(selection);
  shadow.append(panel, mask);
  document.documentElement.append(host);

  let selectionPromise = null;
  let resolveSelection = null;
  let start = null;

  close.addEventListener('click', () => { panel.hidden = true; });
  mask.addEventListener('pointerdown', event => {
    start = { x: event.clientX, y: event.clientY };
    selection.style.cssText = `left:${start.x}px;top:${start.y}px;width:0;height:0`;
    mask.setPointerCapture?.(event.pointerId);
  });
  mask.addEventListener('pointermove', event => {
    if (!start) return;
    const rect = normalizeSelection(start, { x: event.clientX, y: event.clientY }, { right: innerWidth, bottom: innerHeight });
    selection.style.cssText = `left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px`;
  });
  mask.addEventListener('pointerup', event => {
    if (!start) return;
    const rect = normalizeSelection(start, { x: event.clientX, y: event.clientY }, { right: innerWidth, bottom: innerHeight });
    start = null; mask.hidden = true; mask.style.pointerEvents = 'none';
    resolveSelection?.(hasArea(rect) ? rect : null); resolveSelection = null; selectionPromise = null;
  });
  mask.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!selectionPromise) return;
      start = null; mask.hidden = true; mask.style.pointerEvents = 'none';
      resolveSelection?.(null); resolveSelection = null; selectionPromise = null;
    }
  });

  function makeButton(label, handler) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    if (handler) button.addEventListener('click', handler); return button;
  }

  return {
    showPanel() { panel.hidden = false; },
    showNotice(text) { notice.textContent = text; panel.hidden = false; },
    setState(state) {
      panel.hidden = false; message.textContent = state.message; notice.textContent = '';
      const busy = state.phase === 'scanning';
      current.disabled = busy; select.disabled = busy; cancel.hidden = !busy;
      results.innerHTML = '';
      if (state.results?.length) {
        const prefix = state.partial ? '扫描超时，已找到 ' : '识别到 ';
        message.textContent = `${prefix}${state.results.length} 个二维码:`;
        if (state.partial) {
          notice.textContent = '部分二维码未能在时间内解码。可尝试框选更小区域重新扫描。';
        }
        state.results.forEach(result => {
          const card = document.createElement('div');
          card.className = 'qr-result-card';
          const text = document.createElement('p');
          text.className = 'qr-result-text';
          text.textContent = result.text;
          const resultNotice = document.createElement('p');
          resultNotice.className = 'qr-result-notice';
          resultNotice.textContent = result.notice || '';
          const resultActions = document.createElement('div');
          resultActions.className = 'qr-result-actions';
          const copyBtn = makeButton('复制', () => onCopy(result.text));
          resultActions.append(copyBtn);
          if (result.openUrl) {
            const openBtn = makeButton(result.openLabel || '打开', () => onOpen(result));
            resultActions.append(openBtn);
          }
          card.append(text, resultNotice, resultActions);
          results.append(card);
        });
      }
    },
    selectRegion() {
      if (selectionPromise) return selectionPromise;
      panel.hidden = true; mask.hidden = false; mask.style.pointerEvents = 'auto';
      selectionPromise = new Promise(resolve => { resolveSelection = resolve; });
      mask.focus();
      return selectionPromise;
    },
    cancelSelection() {
      if (!selectionPromise) return;
      start = null; mask.hidden = true; mask.style.pointerEvents = 'none'; resolveSelection?.(null); resolveSelection = null; selectionPromise = null;
    },
    destroy() { host.remove(); }
  };
}
