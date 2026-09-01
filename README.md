# Tampermonkey QR Scanner

离线 userscript，可扫描当前网页可见区域，或拖拽框选网页区域识别二维码。二维码内容只在本地处理，不上传截图或结果。

## 安装与构建

```powershell
npm install
npm run build
```

将 `dist/qr-scanner.user.js` 导入 Tampermonkey。脚本仅匹配 `http://` 和 `https://` 页面，不在网页中常驻按钮。使用时点击 Tampermonkey 图标，再点击脚本菜单中的 `QR Scanner`。

更新脚本后如果旧的“新建用户脚本”仍显示右下角按钮，请在 Tampermonkey 的“已安装脚本”中停用旧脚本，只保留 `QR Scanner (offline)`。新版本可能在安装时请求一次跨域图片读取权限，这是为了读取页面已经展示的图片，不是标签页共享权限。

扫描结果可复制。普通 `http:` / `https:` 地址显示“新标签打开”；公众号 `weixin.qq.com/r/...` 链接显示“尝试唤起微信”并解释浏览器限制；官方微信小程序 Scheme 显示“在微信打开”。框选使用指针拖拽，空选区可取消并会显示提示。

## 已知限制

脚本逐张读取页面中可见图片、Canvas 和 SVG 的原始像素，优先在 Worker 中解码，成功后立即停止；跨域图片由 Tampermonkey 直接读取原图，因此无需每次授权标签页画面。纯 CSS 背景以及仅存在于跨域 iframe 内部的二维码无法读取。脚本不会上传截图或二维码结果。
