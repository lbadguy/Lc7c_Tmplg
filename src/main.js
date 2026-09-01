import { captureVisiblePage } from './capture.js';
import { decodeImageData } from './decode.js';
import { createScannerUI } from './ui.js';
import { createBase64UI } from './base64.js';
import { initialState, reduceState } from './state.js';

// Upper bound on one scan's main-thread work. jsQR is synchronous, so without
// a ceiling a page full of large images could freeze the tab for minutes.
const SCAN_BUDGET_MS = 2500;

function start() {
  if (!document.body || document.getElementById('qr-scanner-root')) return;
  let state = initialState;
  let controller = null;
  let ui;
  const setState = action => { state = reduceState(state, action); ui.setState(state); };
  const cancel = () => {
    controller?.abort(); controller = null; ui.cancelSelection();
    if (state.phase === 'scanning') setState({ type: 'scan-cancel' });
  };
  const runScan = async rect => {
    cancel();
    controller = new AbortController();
    setState({ type: 'scan-start' });
    const stats = {};
    const startedAt = Date.now();
    const remaining = () => SCAN_BUDGET_MS - (Date.now() - startedAt);
    try {
      let result = null;
      let timedOut = false;
      for await (const pixels of captureVisiblePage({ rect, signal: controller.signal, stats })) {
        if (remaining() <= 0) { timedOut = true; break; }
        result = await decodeImageData(pixels, { signal: controller.signal, remainingBudget: remaining() });
        if (result) break;
      }
      if (result) setState({ type: 'scan-success', result });
      else if (timedOut) setState({ type: 'scan-timeout' });
      else if (!stats.candidates) setState({ type: 'scan-no-media' });
      else if (!stats.read) setState({ type: 'scan-unreadable' });
      else setState({ type: 'scan-empty' });
    } catch (error) {
      if (error?.name === 'AbortError') setState({ type: 'scan-cancel' });
      else setState({ type: 'scan-error', message: error?.message || '识别失败，请重试。' });
    } finally {
      controller = null;
    }
  };
  ui = createScannerUI({
    onCurrent: () => runScan({ x: 0, y: 0, width: innerWidth, height: innerHeight }),
    onSelect: async () => { const rect = await ui.selectRegion(); if (rect) runScan(rect); else setState({ type: 'scan-error', message: '未选择有效区域。' }); },
    onCancel: cancel,
    onCopy: async () => {
      const text = ui.result?.text; if (!text) return;
      try { await navigator.clipboard.writeText(text); ui.setState({ ...state, message: '已复制二维码内容。' }); }
      catch { const area = document.createElement('textarea'); area.value = text; area.style.position = 'fixed'; area.style.opacity = '0'; document.body.append(area); area.select(); document.execCommand('copy'); area.remove(); ui.setState({ ...state, message: '已复制二维码内容。' }); }
    },
    onOpen: () => {
      const result = ui.result; if (!result?.openUrl) return;
      if (result.openMode === 'web') {
        const popup = window.open(result.openUrl, '_blank', 'noopener,noreferrer');
        if (!popup) ui.showNotice('浏览器阻止了新标签页，请允许弹窗后重试。');
        return;
      }
      ui.showNotice(result.openMode === 'wechat-follow'
        ? '已尝试唤起微信。公众号扫码 token 仍需由微信扫码流程处理，无法保证自动进入公众号。'
        : '已尝试把链接交给微信客户端。');
      window.location.href = result.openUrl;
    }
  });
  const base64UI = createBase64UI();
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('QR Scanner', () => ui.showPanel());
    GM_registerMenuCommand('Base64', () => base64UI.showPanel());
  } else if (typeof GM !== 'undefined' && typeof GM.registerMenuCommand === 'function') {
    GM.registerMenuCommand('QR Scanner', () => ui.showPanel());
    GM.registerMenuCommand('Base64', () => base64UI.showPanel());
  } else {
    ui.showPanel();
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
