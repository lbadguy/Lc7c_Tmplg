import test from 'node:test';
import assert from 'node:assert/strict';
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
