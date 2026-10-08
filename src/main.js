import { captureVisiblePage } from './capture.js';
import { decodeImageData } from './decode.js';
import { createScannerUI } from './ui.js';
import { createBase64UI } from './base64.js';
import { initialState, reduceState } from './state.js';

// Budget for one scan's main-thread work. Without a ceiling, a page full of
// large images could freeze the tab for minutes.
//
// This is a checkpoint budget, not a hard deadline: jsQR runs synchronously and
// cannot be interrupted once started, so the budget is tested between
// candidates and between decode strategies. A candidate that starts just under
// the limit still runs to completion - worst case measured at the pixel gate
// (1.2M px, no code, attemptBoth) is ~870ms.
//
// "Scan current page" gets a longer budget because the user expects all codes
// in the viewport to be found. "Select region" keeps the shorter budget since
// it usually targets a single code.
const SCAN_BUDGET_SELECTION_MS = 2500;
const SCAN_BUDGET_VIEWPORT_MS = 5000;
const LINUX_DO_NEW_TAB_KEY = 'linuxDoTopicLinksNewTab';

function setupLinuxDoTopicNewTab() {
  if (location.hostname !== 'linux.do') return;
  if (typeof GM_registerMenuCommand !== 'function'
    || typeof GM_getValue !== 'function'
    || typeof GM_setValue !== 'function') return;

  let menuCommandId = null;
  const registerMenuCommand = () => {
    if (menuCommandId !== null && typeof GM_unregisterMenuCommand === 'function') {
      GM_unregisterMenuCommand(menuCommandId);
    }
    const enabled = GM_getValue(LINUX_DO_NEW_TAB_KEY, false) === true;
    menuCommandId = GM_registerMenuCommand(
      `Linux.do 帖子新标签页：${enabled ? '开启' : '关闭'}`,
      () => {
        GM_setValue(LINUX_DO_NEW_TAB_KEY, GM_getValue(LINUX_DO_NEW_TAB_KEY, false) !== true);
        registerMenuCommand();
      },
      { autoClose: false }
    );
  };

  document.addEventListener('click', event => {
    if (!event.isTrusted || event.defaultPrevented || event.button !== 0
      || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey
      || GM_getValue(LINUX_DO_NEW_TAB_KEY, false) !== true) return;

    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    const row = target?.closest('.topic-list-item, .latest-topic-list-item');
    if (!row) return;

    const clickedLink = target.closest('a[href]');
    if (clickedLink && !clickedLink.matches('a.title[href]')) return;
    if (target.closest('button, input, select, textarea, [role="button"], [contenteditable="true"], .bulk-select')) return;

    const link = clickedLink || row.querySelector('a.title[href]');
    if (!link) return;
    if (link.target && link.target.toLowerCase() !== '_self') return;

    let topicUrl;
    try {
      topicUrl = new URL(link.href, location.href);
    } catch {
      return;
    }
    if (topicUrl.origin !== location.origin
      || !/^\/t\/(?:[^/]+\/)?\d+(?:\/\d+)?\/?$/.test(topicUrl.pathname)
      || (topicUrl.pathname === location.pathname && topicUrl.hash)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    if (typeof GM_openInTab === 'function') {
      GM_openInTab(topicUrl.href, { active: true, insert: true });
    } else {
      window.open(topicUrl.href, '_blank', 'noopener,noreferrer');
    }
  }, true);

  registerMenuCommand();
}

function start() {
  if (!document.body || document.getElementById('qr-scanner-root')) return;
  setupLinuxDoTopicNewTab();
  let state = initialState;
  let controller = null;
  let ui;
  const setState = action => { state = reduceState(state, action); ui.setState(state); };
  const cancel = () => {
    controller?.abort(); controller = null; ui.cancelSelection();
    if (state.phase === 'scanning') setState({ type: 'scan-cancel' });
  };
  const runScan = async (rect, budgetMs = SCAN_BUDGET_SELECTION_MS) => {
    cancel();
    controller = new AbortController();
    setState({ type: 'scan-start' });
    const stats = {};
    const startedAt = Date.now();
    const remaining = () => budgetMs - (Date.now() - startedAt);
    try {
      const results = [];
      let timedOut = false;
      for await (const pixels of captureVisiblePage({ rect, signal: controller.signal, stats })) {
        if (remaining() <= 0) { timedOut = true; break; }
        const found = await decodeImageData(pixels, { signal: controller.signal, remainingBudget: remaining() });
        if (found?.length) results.push(...found);
      }
      // Partial results beat a bare timeout message: the user can act on what
      // was found and re-scan a smaller region for the rest.
      if (results.length) setState({ type: 'scan-success', results, partial: timedOut });
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
    onCurrent: () => runScan({ x: 0, y: 0, width: innerWidth, height: innerHeight }, SCAN_BUDGET_VIEWPORT_MS),
    onSelect: async () => { const rect = await ui.selectRegion(); if (rect) runScan(rect, SCAN_BUDGET_SELECTION_MS); else setState({ type: 'scan-error', message: '未选择有效区域。' }); },
    onSystemTextCapture: () => {
      // Windows handles this URI by opening the Snipping Tool selection UI.
      // A custom-protocol navigation is used instead of a synthetic key event:
      // browsers do not let page scripts generate trusted OS keyboard input.
      const link = document.createElement('a');
      link.href = 'ms-screenclip:';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      ui.showNotice('已打开 Windows 截图工具。选取区域后，可在工具栏中使用“文本操作”。');
    },
    onCancel: cancel,
    onCopy: async (text) => {
      if (!text) return;
      try { await navigator.clipboard.writeText(text); ui.showNotice('已复制二维码内容。'); }
      catch { const area = document.createElement('textarea'); area.value = text; area.style.position = 'fixed'; area.style.opacity = '0'; document.body.append(area); area.select(); document.execCommand('copy'); area.remove(); ui.showNotice('已复制二维码内容。'); }
    },
    onOpen: (result) => {
      if (!result?.openUrl) return;
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

  // 微信公众号文章页面自动弹出扫码器，省去手动点击菜单的步骤。
  if (location.href.startsWith('https://mp.weixin.qq.com/')) {
    ui.showPanel();
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
