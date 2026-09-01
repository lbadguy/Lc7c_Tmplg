export const initialState = { phase: 'idle', result: null, message: '' };

export function reduceState(state, action) {
  switch (action.type) {
    case 'scan-start': return { phase: 'scanning', result: null, message: '正在读取页面中的二维码…' };
    case 'scan-success': return { phase: 'success', result: action.result, message: '' };
    case 'scan-empty': return { phase: 'empty', result: null, message: '未发现二维码。' };
    case 'scan-error': return { phase: 'error', result: null, message: action.message || '识别失败。' };
    case 'scan-cancel': return { phase: 'cancelled', result: null, message: '已取消识别。' };
    case 'reset': return initialState;
    default: return state;
  }
}
