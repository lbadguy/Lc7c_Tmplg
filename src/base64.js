import { base64Encode, base64Decode } from './base64-codec.js';

const STYLE = `
:host { all: initial; }
.b64-panel { position: fixed; right: 18px; bottom: 18px; z-index: 2147483647; width: min(380px, calc(100vw - 36px)); padding: 14px; border: 1px solid #c8d5dc; border-radius: 8px; color: #16303b; background: #fff; box-shadow: 0 8px 28px #0003; font: 14px system-ui,sans-serif; }
.b64-panel[hidden] { display: none; }
.b64-title { margin: 0 0 8px; font-weight: 700; }
.b64-close { position: absolute; top: 8px; right: 8px; width: 30px; height: 30px; border: 0; color: #45616d; background: transparent; font: 22px/1 system-ui,sans-serif; cursor: pointer; }
.b64-input { box-sizing: border-box; width: 100%; min-height: 80px; resize: vertical; margin: 0 0 8px; padding: 8px; border: 1px solid #9eb5bf; border-radius: 6px; color: #16303b; background: #f7fafb; font: inherit; }
.b64-input:focus { outline: none; border-color: #45616d; }
.b64-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 8px; }
.b64-actions button { border: 1px solid #9eb5bf; border-radius: 6px; padding: 7px 10px; color: #16303b; background: #f7fafb; font: inherit; cursor: pointer; }
.b64-actions button:hover { background: #e8f2f5; }
.b64-actions button[hidden] { display: none; }
.b64-result-label { font-weight: 600; margin: 0 0 4px; }
.b64-result { margin: 0 0 8px; padding: 8px; border: 1px solid #c8d5dc; border-radius: 6px; background: #f7fafb; min-height: 2em; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-all; }
.b64-error { margin: 0 0 8px; padding: 8px; border-radius: 6px; color: #b33030; background: #fff0f0; }
.b64-error:empty { display: none; }
.b64-status { margin: 0 0 8px; padding: 8px; border-radius: 6px; color: #2a7d2a; background: #f0fff0; }
.b64-status:empty { display: none; }
`;

export function createBase64UI() {
  const host = document.createElement('div');
  host.id = 'base64-root';
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  const shadow = host.attachShadow ? host.attachShadow({ mode: 'closed' }) : host;
  const style = document.createElement('style');
  style.textContent = STYLE;
  shadow.append(style);

  const panel = document.createElement('section');
  panel.className = 'b64-panel';
  panel.hidden = true;
  panel.style.pointerEvents = 'auto';

  const title = document.createElement('h2');
  title.className = 'b64-title';
  title.textContent = 'Base64 编解码';

  const close = document.createElement('button');
  close.className = 'b64-close';
  close.type = 'button';
  close.textContent = '×';
  close.title = '关闭';
  close.setAttribute('aria-label', '关闭 Base64 工具');

  const input = document.createElement('textarea');
  input.className = 'b64-input';
  input.placeholder = '输入文本或 Base64 字符串...';

  const actions = document.createElement('div');
  actions.className = 'b64-actions';

  const encodeBtn = document.createElement('button');
  encodeBtn.type = 'button';
  encodeBtn.textContent = '编码';

  const decodeBtn = document.createElement('button');
  decodeBtn.type = 'button';
  decodeBtn.textContent = '解码';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.textContent = '复制结果';
  copyBtn.hidden = true;

  actions.append(encodeBtn, decodeBtn, copyBtn);

  const error = document.createElement('div');
  error.className = 'b64-error';
  error.setAttribute('role', 'alert');

  const status = document.createElement('div');
  status.className = 'b64-status';
  status.setAttribute('role', 'status');

  const resultLabel = document.createElement('div');
  resultLabel.className = 'b64-result-label';
  resultLabel.hidden = true;

  const result = document.createElement('div');
  result.className = 'b64-result';

  panel.append(title, close, input, actions, error, status, resultLabel, result);
  shadow.append(panel);
  document.documentElement.append(host);

  let latestResult = '';

  function showError(msg) {
    error.textContent = msg;
    status.textContent = '';
    resultLabel.hidden = true;
    result.textContent = '';
    copyBtn.hidden = true;
    latestResult = '';
  }

  function showResult(label, text) {
    error.textContent = '';
    status.textContent = '';
    resultLabel.textContent = label;
    resultLabel.hidden = false;
    result.textContent = text;
    copyBtn.hidden = false;
    latestResult = text;
  }

  function showStatus(msg) {
    error.textContent = '';
    status.textContent = msg;
  }

  function handleEncode() {
    const text = input.value;
    if (!text) {
      showError('请输入要编码的文本。');
      return;
    }
    try {
      showResult('编码结果：', base64Encode(text));
    } catch (e) {
      showError(e.message);
    }
  }

  function handleDecode() {
    const text = input.value;
    if (!text) {
      showError('请输入要解码的 Base64 字符串。');
      return;
    }
    try {
      showResult('解码结果：', base64Decode(text));
    } catch (e) {
      showError(e.message);
    }
  }

  async function handleCopy() {
    if (!latestResult) return;
    try {
      await navigator.clipboard.writeText(latestResult);
      showStatus('已复制结果。');
    } catch {
      const area = document.createElement('textarea');
      area.value = latestResult;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      showStatus('已复制结果。');
    }
  }

  encodeBtn.addEventListener('click', handleEncode);
  decodeBtn.addEventListener('click', handleDecode);
  copyBtn.addEventListener('click', handleCopy);
  close.addEventListener('click', () => { panel.hidden = true; });

  return {
    showPanel() { panel.hidden = false; input.focus(); },
    destroy() { host.remove(); }
  };
}