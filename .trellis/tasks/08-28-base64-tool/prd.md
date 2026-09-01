# Base64 encode/decode tool

## Goal

在现有的 Tampermonkey QR Scanner 脚本中增加一个独立的 Base64 编解码工具。用户点击 Tampermonkey 菜单中的 "Base64" 菜单项，弹出一个独立 panel，可以将普通文本编码为 Base64，或将 Base64 字符串解码为原始文本。所有处理在本地完成，不上传任何内容。

## Background

QR Scanner 脚本已有一个通过 Shadow DOM 渲染的 UI panel（`src/ui.js`），通过 `GM_registerMenuCommand('QR Scanner')` 注册菜单项。Base64 功能采用完全独立的 panel 和菜单项，不修改现有二维码扫描流程。

## Requirements

1. **菜单入口**：在 Tampermonkey 菜单中新增 "Base64" 菜单项（`GM_registerMenuCommand('Base64', ...)`），与现有的 "QR Scanner" 并列
2. **独立 Panel**：Base64 拥有自己独立的 Shadow DOM panel，UI 风格与二维码扫描器一致（固定定位右下角、相同的颜色/字体/圆角/阴影体系）
3. **编码功能**：用户在输入框中输入文本，点击"编码"按钮，下方显示 Base64 编码结果
4. **解码功能**：用户在输入框中输入 Base64 字符串，点击"解码"按钮，下方显示解码后的原始文本。解码失败时显示友好的错误提示
5. **结果可复制**：提供"复制结果"按钮，将编/解码结果复制到剪贴板
6. **本地处理**：所有编解码在浏览器本地完成，使用 `btoa` / `atob` 或 `TextEncoder`/`TextDecoder` 处理后端 Unicode 场景
7. **关闭按钮**：panel 右上角有关闭按钮

## Acceptance Criteria

- [x] Tampermonkey 菜单中出现 "Base64" 菜单项，点击后弹出独立 panel
- [x] "QR Scanner" 菜单项和 panel 功能不受影响
- [x] 输入纯 ASCII 文本，点击编码，输出正确的 Base64 字符串
- [x] 输入包含中文/emoji 的文本，点击编码，输出正确的 Base64 字符串（使用 TextEncoder → btoa 路径）
- [x] 输入有效的 Base64 字符串，点击解码，输出正确的原始文本
- [x] 输入无效的 Base64 字符串，点击解码，显示友好的错误提示
- [x] 点击"复制结果"按钮，编/解码结果被复制到剪贴板
- [x] 点击关闭按钮，panel 隐藏
- [x] Panel UI 风格与二维码扫描器一致（颜色、字体、圆角、阴影）
- [x] 测试通过：`npm test`

## Out of Scope

- 文件上传/拖拽进行 Base64 编解码
- Base64 图片解码/预览
- 与二维码扫描器共享状态或 UI
- 其他编码格式（Base32、Hex 等）