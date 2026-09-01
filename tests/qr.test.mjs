import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSelection, hasArea } from '../src/selection.js';
import { classifyUrl } from '../src/url.js';
import { canUseMainThreadDecoder, decodeImageData } from '../src/decode.js';
import { intersectRects } from '../src/capture.js';
import { initialState, reduceState } from '../src/state.js';
import { base64Encode, base64Decode } from '../src/base64-codec.js';

test('base64 ASCII round-trip', () => {
  const original = 'Hello, World!';
  const encoded = base64Encode(original);
  assert.equal(typeof encoded, 'string');
  assert.ok(encoded.length > 0);
  const decoded = base64Decode(encoded);
  assert.equal(decoded, original);
});

test('base64 Unicode (Chinese) round-trip', () => {
  const original = '你好，世界！';
  const encoded = base64Encode(original);
  const decoded = base64Decode(encoded);
  assert.equal(decoded, original);
});

test('base64 Unicode (emoji) round-trip', () => {
  const original = 'Hello 🎉🌟 世界';
  const encoded = base64Encode(original);
  const decoded = base64Decode(encoded);
  assert.equal(decoded, original);
});

test('base64 encode known values', () => {
  assert.equal(base64Encode('f'), 'Zg==');
  assert.equal(base64Encode('fo'), 'Zm8=');
  assert.equal(base64Encode('foo'), 'Zm9v');
});

test('base64 decode known values', () => {
  assert.equal(base64Decode('Zm9v'), 'foo');
  assert.equal(base64Decode('5L2g5aW9'), '你好');
});

test('base64 decode throws on invalid input', () => {
  assert.throws(() => base64Decode('!!!not-base64!!!'), { message: /解码失败/ });
});

test('base64 encode empty string', () => {
  assert.equal(base64Encode(''), '');
});

test('base64 decode whitespace-only input', () => {
  assert.throws(() => base64Decode('   '), { message: /解码失败/ });
});

test('normalizes reverse drag and clamps to viewport', () => {
  const rect = normalizeSelection({ x: 220, y: 180 }, { x: -20, y: 40 }, { right: 200, bottom: 160 });
  assert.deepEqual(rect, { x: 0, y: 40, width: 200, height: 120 });
  assert.equal(hasArea(rect), true);
});

test('classifies only HTTP(S) URLs', () => {
  assert.deepEqual(classifyUrl(' https://example.com/a '), {
    text: ' https://example.com/a ', isUrl: true, url: 'https://example.com/a',
    openMode: 'web', openUrl: 'https://example.com/a', openLabel: '新标签打开', notice: ''
  });
  assert.equal(classifyUrl('javascript:alert(1)').isUrl, false);
  assert.equal(classifyUrl('hello world').isUrl, false);
});

test('classifies WeChat follow QR links as client-only actions', () => {
  const result = classifyUrl('http://weixin.qq.com/r/GnWOll7E1gOprRr19yAI');
  assert.equal(result.openMode, 'wechat-follow');
  assert.equal(result.openUrl, 'weixin://dl/officialaccounts');
  assert.equal(result.openLabel, '尝试唤起微信');
  assert.match(result.notice, /扫码关注/);
});

test('allows official WeChat mini-program schemes but rejects arbitrary schemes', () => {
  const miniProgram = classifyUrl('weixin://dl/business/?appid=wx123&path=pages/index');
  assert.equal(miniProgram.openMode, 'wechat-scheme');
  assert.equal(miniProgram.openLabel, '在微信打开');
  assert.equal(classifyUrl('weixin://evil/action').isUrl, false);
});

test('scan state transitions are explicit', () => {
  const scanning = reduceState(initialState, { type: 'scan-start' });
  assert.equal(scanning.phase, 'scanning');
  const success = reduceState(scanning, { type: 'scan-success', result: { text: 'x', isUrl: false } });
  assert.equal(success.phase, 'success');
  assert.equal(reduceState(scanning, { type: 'scan-empty' }).phase, 'empty');
  assert.equal(reduceState(scanning, { type: 'scan-cancel' }).phase, 'cancelled');
});

test('decoder exceptions do not break the scan flow', async () => {
  const calls = [];
  const result = await decodeImageData({ data: new Uint8ClampedArray(16), width: 2, height: 2 }, {
    decoder: (_data, _width, _height, options) => {
      calls.push(options?.inversionAttempts ?? 'default');
      throw new TypeError("Cannot read properties of undefined (reading 'height')");
    }
  });
  assert.equal(result, null);
  assert.deepEqual(calls, ['default']);
});

test('intersects a selected region with a visible media element', () => {
  assert.deepEqual(
    intersectRects(
      { x: 100, y: 50, width: 300, height: 200 },
      { x: 250, y: 0, width: 200, height: 180 }
    ),
    { x: 250, y: 50, width: 150, height: 130 }
  );
});

test('keeps large images off the main-thread decoder', () => {
  assert.equal(canUseMainThreadDecoder({ width: 1000, height: 1000 }), true);
  assert.equal(canUseMainThreadDecoder({ width: 1600, height: 1000 }), false);
});

test('uses the worker decoder before the main-thread fallback', async () => {
  let mainThreadCalls = 0;
  const result = await decodeImageData({ data: new Uint8ClampedArray(16), width: 2, height: 2 }, {
    canvasFactory: () => ({}),
    qrDecoder: { scanImage: async () => ({ data: 'https://example.com/dense' }) },
    decoder: () => { mainThreadCalls++; return null; }
  });
  assert.equal(result?.url, 'https://example.com/dense');
  assert.equal(mainThreadCalls, 0);
});
