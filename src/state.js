export const initialState = { phase: 'idle', results: [], message: '' };

export function reduceState(state, action) {
  switch (action.type) {
    case 'scan-start': return { phase: 'scanning', results: [], message: '正在读取页面中的二维码…' };
    case 'scan-success': return { phase: 'success', results: action.results, partial: !!action.partial, message: '' };
    case 'scan-empty': return { phase: 'empty', results: [], message: '未发现二维码。' };
    case 'scan-no-media': return { phase: 'empty', results: [], message: '选定区域中没有可读取的图片、Canvas 或 SVG。' };
    case 'scan-unreadable': return { phase: 'error', results: [], message: '无法读取选定区域的图片像素,可能受跨域限制。' };
    case 'scan-timeout': return { phase: 'error', results: [], message: '扫描超时。请框选更小的区域,或只框住单个二维码。' };
    case 'scan-error': return { phase: 'error', results: [], message: action.message || '识别失败。' };
    case 'scan-cancel': return { phase: 'cancelled', results: [], message: '已取消识别。' };
    case 'reset': return initialState;
    default: return state;
  }
}
