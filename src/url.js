const WECHAT_FOLLOW_HOST = 'weixin.qq.com';
const WECHAT_FOLLOW_PATH = '/r/';
const WECHAT_OFFICIAL_ACCOUNTS_ENTRY = 'weixin://dl/officialaccounts';
const WECHAT_MINI_PROGRAM_PREFIX = 'weixin://dl/business/';

function textResult(text) {
  return { text, isUrl: false, url: null, openMode: null, openUrl: null, openLabel: null, notice: '' };
}

export function classifyUrl(value) {
  const text = String(value ?? '');
  const candidate = text.trim();
  if (candidate.toLowerCase().startsWith(WECHAT_MINI_PROGRAM_PREFIX)) {
    return {
      text,
      isUrl: true,
      url: candidate,
      openMode: 'wechat-scheme',
      openUrl: candidate,
      openLabel: '在微信打开',
      notice: '这是微信小程序 URL Scheme，将交给已安装的微信客户端处理。'
    };
  }
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return textResult(text);
    const isWechatFollow = parsed.hostname.toLowerCase() === WECHAT_FOLLOW_HOST && parsed.pathname.startsWith(WECHAT_FOLLOW_PATH);
    if (isWechatFollow) {
      return {
        text,
        isUrl: true,
        url: parsed.href,
        openMode: 'wechat-follow',
        openUrl: WECHAT_OFFICIAL_ACCOUNTS_ENTRY,
        openLabel: '尝试唤起微信',
        notice: '这是公众号“扫码关注”链接。普通浏览器会跳到微信官网；可尝试唤起微信，但该扫码 token 无法保证自动定位到公众号。'
      };
    }
    return {
      text,
      isUrl: true,
      url: parsed.href,
      openMode: 'web',
      openUrl: parsed.href,
      openLabel: '新标签打开',
      notice: ''
    };
  } catch {
    // QR payloads are commonly arbitrary text, so malformed URLs are valid results.
    return textResult(text);
  }
}
