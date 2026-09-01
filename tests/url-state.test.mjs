import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyUrl } from '../src/url.js';
import { initialState, reduceState } from '../src/state.js';

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

test('each scan failure gets its own message', () => {
  const scanning = reduceState(initialState, { type: 'scan-start' });
  const messages = ['scan-empty', 'scan-no-media', 'scan-unreadable', 'scan-timeout']
    .map(type => reduceState(scanning, { type }).message);
  assert.equal(new Set(messages).size, 4, 'failure messages must be distinguishable');
  for (const message of messages) assert.ok(message.length > 0);
});

test('unreadable pixels are not reported as a missing QR code', () => {
  const scanning = reduceState(initialState, { type: 'scan-start' });
  const unreadable = reduceState(scanning, { type: 'scan-unreadable' });
  assert.equal(unreadable.phase, 'error');
  assert.doesNotMatch(unreadable.message, /未发现二维码/);
  assert.match(unreadable.message, /无法读取/);
});

test('timeout suggests a smaller selection instead of blaming the code', () => {
  const timeout = reduceState(initialState, { type: 'scan-timeout' });
  assert.match(timeout.message, /超时/);
  assert.match(timeout.message, /更小的区域/);
});

