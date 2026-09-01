# Implementation plan: QR decode accuracy and code quality fixes

按依赖顺序:先修仓库(基线)→ 几何纯函数 → Base64 去重 → 移除 qr-scanner 依赖 → 裁剪接入 → 解码链重写 → 失败分层+超时 → 文档。每步结束跑 `npm test`。

## 步骤

### 1. R9 前置:抢救版本控制

- [ ] `git init`,确认默认分支为 `main`
- [ ] 写 `.gitignore`:`node_modules/`、`dist/`
- [ ] 首个提交:现有代码原样入库(**改动前**的快照,保证后续每步可 diff、可 revert)

理由:先建立基线,后面每步才有回滚点。

### 2. R8 Base64 去重(不影响解码链,先清理)

- [ ] 新建 `src/base64-codec.js`,导出 `base64Encode` / `base64Decode`
- [ ] `src/base64.js` 改为导入;补齐分号统一风格
- [ ] 新增 `.b64-status` 元素承载成功态,移除 inline style 语义切换(STYLE 与 DOM 创建代码都改)
- [ ] `tests/qr.test.mjs` 中删除副本,改为从 `src/base64-codec.js` 导入
- [ ] 确认 `base64Encode` 全仓库仅一处定义:`grep -rn "function base64Encode" src tests`

**提交:** "refactor(base64): extract codec to shared module"

验证:`npm test`,8 个 base64 测试全过

### 3. R5 几何:新建 `src/scale.js`

- [ ] `cropRectForElement(selectionRect, bounds, naturalSize, objectFit)` → 元素原始像素坐标系下的裁剪矩形,或 `null` 表示不裁剪
  - `objectFit` 非 `fill` 时返回 `null`(D1 决策:宁可不裁,不能裁错)
  - 选区完全覆盖元素时返回 `null`(无需裁剪)
  - 交集为空时返回 `null`
- [ ] `upscaleFactor(width, height, minSide)` → 整数放大倍数(≥1)
- [ ] 单元测试(新建 `tests/geometry.test.mjs`):1:1、2x DPI 缩放、部分覆盖、完全覆盖、`object-fit: cover` 放弃裁剪、空交集

**提交:** "feat(scale): add crop and upscale utilities"

验证:`npm test`

### 4. R12 移除 qr-scanner 依赖

- [ ] `package.json` 移除 `"qr-scanner": "^1.4.2"`
- [ ] `npm install` 确认依赖已删
- [ ] `src/decode.js` 删除 `import QrScanner from 'qr-scanner/...'` 那一行
- [ ] 此时 decode.js 顶部只剩 `import jsQR from 'jsqr'`
- [ ] 注释掉 decode.js 中调用 `qrDecoder?.scanImage` 的那一段(先注释,下一步会重写整个函数)
- [ ] `npm test` —— 应该通过(因为测试里用的是 mock decoder)
- [ ] `npm run build` 记录体积:应从 447 KiB 降到约 380 KiB(移除 68.5 KiB 的 qr-scanner 构建)

**提交:** "refactor(decode): remove qr-scanner dependency"

验证:`npm test` 全绿;产物体积下降

### 5. R5 接入 `src/capture.js`

- [ ] `drawSource` 增加可选 `crop` 参数,用 `drawImage` 的 9 参形式裁剪:`ctx.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, dstW, dstH)`
- [ ] `captureCandidate(element, rect, signal)` 透传选区
- [ ] `captureImage` / `captureSvg` / canvas 三条路径各自算 crop
  - 图片走 `getComputedStyle(el).objectFit || 'fill'`
  - canvas 用 `canvas.width/height` 作为 naturalSize
  - svg 光栅化本身 1:1,crop 直接用交集
- [ ] 跨域回退路径(`gmRequestBlob` 取回原图)也要裁剪——注意此时尺寸是原图尺寸,与页面显示尺寸的比例需重算
- [ ] `MAX_RASTER_SIDE` 只在 crop 为 `null` 时生效
- [ ] `mediaScore` 增加一项:裁剪后像素数(小的排前面,配合提前退出能在预算内试更多候选)

**提交:** "feat(capture): crop to selection intersection"

验证:`npm test`

### 6. R6 + R11 解码链:改写 `src/decode.js`

整个 `decodeImageData` 重写,因为改动太多无法增量修。

**新签名:** `decodeImageData(imageData, { signal, remainingBudget })`

**逻辑:**
1. 尝试原生 `BarcodeDetector`(若 `window.BarcodeDetector` 存在且 `remainingBudget > 0`)
2. jsQR(`dontInvert`, 裁剪后尺度) —— 仅当像素数 ≤ `MAX_MAIN_THREAD_PIXELS` 且 `remainingBudget > 0`
3. jsQR(`dontInvert`, 放大后) —— 仅当原尺度小于 `MIN_DECODE_SIDE` 且 `remainingBudget > 0`
4. jsQR(`onlyInvert`, 裁剪后尺度) —— 仅当未解出、像素数 ≤ 闸门 且 `remainingBudget > 0`

每步前检查 `remainingBudget`,记录耗时并扣减。

删除:
- [ ] `canUseMainThreadDecoder` 函数及其测试
- [ ] `imageDataToCanvas` 与 `qrDecoder` 相关代码(已无 qr-scanner 依赖)

新增测试(独立文件 `tests/decode.test.mjs`):
- [ ] 大尺寸输入仍走到 jsQR 回退(因为裁剪后变小了)
- [ ] 小块被放大
- [ ] 反色仅在第一轮失败后触发
- [ ] `BarcodeDetector` 可用时被优先调用(mock)
- [ ] `remainingBudget <= 0` 时直接返回 `null` 不尝试

修正注释:不再声称"worker already missed"

**提交:** "feat(decode): refactor decode chain with budget and BarcodeDetector"

验证:`npm test` —— 旧的 "uses the worker decoder before..." 测试被删;新的断言通过

### 7. R7 + R11 失败分层与超时

- [ ] `state.js` 增加 `scan-timeout` 与 `scan-unreadable`
- [ ] `captureVisiblePage` 记录读取统计(尝试数、成功数),在最后 yield 完或提前退出时用闭包对象返回
- [ ] `main.js` 增加 `SCAN_BUDGET_MS = 2500`,记录 `startTime`,每个候选前检查 `remainingBudget = SCAN_BUDGET_MS - elapsed`
- [ ] 超时 → `setState({ type: 'scan-timeout' })`,提示"扫描超时,请框选更小的区域或单个二维码。"
- [ ] 按统计区分:"无候选" / "有候选但全部读取失败(unreadable)" / "读到了但未解出(empty)"
- [ ] 测试:三类失败 + 超时产生不同 message

**提交:** "feat(scan): add timeout budget and failure classification"

验证:`npm test`

### 8. R10 文档

- [ ] README 增补 `@connect *` / `GM_xmlhttpRequest` 权限说明(在"安装与构建"下新增"权限说明"小节)
- [ ] README "已知限制" 补 `object-fit` 非 fill 时不裁剪,多码时可能解出非框选的那个
- [ ] README 增补性能说明:单次扫码最多 2.5s,超时会提示;框选能显著提升准确率与速度

**提交:** "docs: update permissions and limitations"

### 9. 测试整理

- [ ] `tests/qr.test.mjs` 拆为 `codec.test.mjs` / `geometry.test.mjs` / `decode.test.mjs` 三个文件
- [ ] `package.json` 的 test 脚本不用改(已经是 `tests/*.test.mjs` glob)
- [ ] `npm test` 确认全绿

**提交:** "test: split into codec/geometry/decode test suites"

### 10. 全量验证

- [ ] `npm test` 全绿
- [ ] `npm run build` 成功,记录产物体积(应比 447 KiB 更小,目标 ≤380 KiB)
- [ ] 人工验证清单交给用户(见下)

**提交:** "chore: record bundle size after optimization"

## 人工验证清单

自动化测试覆盖不到真实页面渲染,以下需用户在浏览器确认:

1. 大截图(≥1920px 宽)里框选一个中等尺寸二维码 → 应能解出(这是原 bug 的核心场景)
2. 深色背景上的浅色二维码 → 应能解出(反色路径)
3. 一张图里有多个码,框选其中一个 → 应解出被框的那个,而非另一个
4. 框选空白区域 → 提示"没有可读取的图片",而非"未发现二维码"
5. 跨域图片 → 仍能通过 GM 回退读取
6. `object-fit: cover` 的图片里的码 → 解出整图中的码(不裁剪,可能解出非框选的那个,已知取舍)
7. Base64 面板编解码 + 复制成功提示
8. 扫描 8 个大尺寸候选 → 2.5s 内超时,提示"请框选更小的区域",页面无长时间冻结

## 验证命令

```bash
npm test
npm run build
grep -rn "function base64Encode" src tests  # 应只有一处
ls -lh dist/qr-scanner.user.js  # 记录体积
```

## 回滚点

每个步骤一个提交。步骤 6(解码链重写)风险最高——它重写了整个 `decodeImageData`;若真实页面出现新的失败模式,单独 revert 该提交即可回到裁剪已生效但解码链未改的状态。

步骤 4(移除 qr-scanner)是体积优化的关键;若发现原生 `BarcodeDetector` 覆盖不足,可 revert 步骤 4 与 6,恢复 qr-scanner 作为快路径。

