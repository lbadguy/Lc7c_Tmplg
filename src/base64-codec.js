export function base64Encode(text) {
  try {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  } catch {
    throw new Error('编码失败，输入内容无法转换为 Base64。');
  }
}

export function base64Decode(base64) {
  try {
    if (!base64 || typeof base64 !== 'string') throw new Error();
    const trimmed = base64.trim();
    if (!trimmed) throw new Error();
    const binary = atob(trimmed);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    throw new Error('解码失败，请检查输入的 Base64 字符串是否有效。');
  }
}
