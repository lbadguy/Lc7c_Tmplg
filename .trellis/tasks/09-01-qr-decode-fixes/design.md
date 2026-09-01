# Design: QR decode accuracy and code quality fixes

## 根因分析

"框了一个码却提示未发现二维码"由三个独立缺陷叠加造成,任一单独出现都可能失败:

1. **选区未参与裁剪。** `captureCandidate` 解码整个元素。一张大图里的小码,在整图尺度上模块尺寸不足 1px 时无法定位。
2. **像素闸门反向生效。** `MAX_MAIN_THREAD_PIXELS = 1200000` 让 1920×1080 及以上的输入跳过 jsQR 回退。图越大越难解,而此时恰好只剩一次机会。
3. **降采样破坏模块边缘。** `MAX_RASTER_SIDE = 2048` 把 4K 图里 200px 的码压到 102px。version 10 以上的码(57×57 模块)在 102px 下每模块不足 2px,低于 jsQR 可靠工作的下限。

三者共同解释了"偶发"的形状:小图小码能过,大图掉。

## 性能与准确率是同一个问题

实测 jsQR 耗时随像素数超线性增长(3000×2000 配 `attemptBoth` 需 24 秒,主线程)。这推翻了初版设计中"删除 `MAX_MAIN_THREAD_PIXELS` 闸门"的决定——删掉它会把偶发的解码失败换成必然的页面冻结,后者更糟。

关键在于:**裁剪同时解决准确率和性能**。24 秒的成本来自"拿整张大图去解";裁剪到选区后典型输入 512×512,耗时 85ms —— 快 280 倍。裁剪不是拖慢解码的额外步骤,而是让解码变快的前提。

因此闸门保留,但判断时机从"原图尺寸"改为"裁剪后尺寸"。裁剪后几乎总能过闸门,只有裁不了的情况(`object-fit` 非 fill)才受限——而那种情况本就该降级。

## 核心决策

### D1. 裁剪到交集,坐标按元素缩放换算

`captureCandidate` 接收选区,计算选区与元素 bounding box 的交集,换算到元素的原始像素坐标系后裁剪。

换算比例来自元素显示尺寸与原始像素尺寸之比:

```
scaleX = naturalWidth / boundsWidth
scaleY = naturalHeight / boundsHeight
```

**`object-fit` 的处理:** 当 `object-fit` 为 `contain` / `cover` 时,上式不成立——图片在盒子内有 letterbox 或被裁掉。这种情况下强行按比例换算会裁错位置,是比不裁更坏的结果。因此:检测计算样式,当 `object-fit` 不是 `fill`(默认值)时**放弃裁剪,回退到解码整个元素**。宁可少一次优化,不能裁错区域。

`canvas` 元素用 `canvas.width/height` 对 `getBoundingClientRect()`;`svg` 按 bounding box 光栅化后本身就是 1:1。

### D2. 按需放大,不按需缩小

引入目标尺度:裁剪后的区域若最短边小于 `MIN_DECODE_SIDE`(512),按整数倍放大到该尺寸以上,`imageSmoothingEnabled = false` 保持模块边缘锐利。插值平滑会把黑白边界糊成灰阶,反而降低二值化质量。

`MAX_RASTER_SIDE` 保留但只作用于**未裁剪**的整元素输入(控制内存),裁剪后的小块不再经过它。

### D3. 闸门保留,判断时机后移;反色按需付费

`MAX_MAIN_THREAD_PIXELS` **保留**,但在裁剪与缩放之后才判断。原实现拿原图尺寸判断,导致大图直接丧失机会;改为判断实际送进解码器的那块像素。

同一块像素只跑一次 jsQR 无意义(`qr-scanner` 内部就是 jsQR)。真正的多次机会来自**不同的像素**与**不同的算法**:

尝试顺序(任一命中即停):
1. **原生 `BarcodeDetector`**(若可用)—— 独立实现,通常硬件加速,零体积成本
2. **jsQR `dontInvert`,裁剪后尺度** —— 主路径
3. **jsQR `dontInvert`,放大后** —— 救小码
4. **jsQR `onlyInvert`,裁剪后尺度** —— 救深底浅码

反色不用 `attemptBoth`,而是作为独立的第 4 步:`attemptBoth` 无条件付双倍成本(1920×1080 从 813ms 涨到 1.9s),而深底浅码是少数情况。先 `dontInvert` 快速通过,失败了再单独 `onlyInvert`,总成本与 `attemptBoth` 相当但常见情况快一倍。

每步执行前检查剩余时间预算(见 D6)。

### D6. 时间预算

单次扫码给一个总预算 `SCAN_BUDGET_MS`(2500ms)。`main.js` 记录起始时间,每个候选、每次解码尝试前检查剩余预算:

- 预算耗尽 → 停止遍历,反馈"扫描超时,请框选更小的区域"(可操作的建议,而非"未发现二维码")
- 单块像素超 `MAX_MAIN_THREAD_PIXELS` 且无法再缩小 → 跳过该候选,记入"跳过"统计

预算与 `AbortController` 并存:预算是自动上界,取消是用户主动中断。

### D7. 候选排序纳入解码成本

现有 `mediaScore` 按"接近正方形 + 重叠比例 + 元素类型"排序。补一项:裁剪后像素数小的优先。小块解码快,先试小块能在预算内尝试更多候选。

### D8. 消除重复打包

产物 447 KiB 里 `jsqr`(251 KiB 未压缩)与 `qr-scanner` legacy(68.5 KiB,内部同样是 jsQR)算法重复。

方案:只保留 `jsqr` 直接依赖,不再引入 `qr-scanner` 的完整构建。原生 `BarcodeDetector` 直接调用浏览器 API(`new BarcodeDetector({formats:['qr_code']})`),不需要 `qr-scanner` 做封装——它的价值主要在摄像头视频流场景,本项目只解静态像素。

这同时移除了 `qr-scanner` 的 Worker 相关代码路径,与 D3 的"同一库跑两遍无意义"结论一致。

### D4. 失败原因分层

`captureVisiblePage` 当前用 `throw` 表达"没有候选"和"读不到像素",与"读到了但没解出"在 `main.js` 里混成同一条错误路径。改为:generator 记录读取统计(尝试数、成功读到像素数),`main.js` 据此区分:

- 无候选元素 → "选定区域中没有可读取的图片、Canvas 或 SVG。"
- 有候选但全部读取失败 → "无法读取图片像素(可能是跨域限制)。"
- 读到像素但未解出 → "未发现二维码。"

### D5. Base64 抽为独立模块

新建 `src/base64-codec.js` 导出 `base64Encode` / `base64Decode`。`src/base64.js` 与测试都从它导入。UI 的成功态改用独立的 `.b64-status` 元素,不再靠 inline style 切换 `.b64-error` 的语义。

## 模块变更

| 文件 | 变更 |
|---|---|
| `src/capture.js` | `captureCandidate` 接收 rect;新增交集裁剪与 `object-fit` 检测;读取统计;候选排序纳入像素数 |
| `src/decode.js` | 移除 `qr-scanner` 依赖;闸门判断后移;`BarcodeDetector` 优先;分步尝试(dontInvert → 放大 → onlyInvert);接收时间预算;修正注释 |
| `src/scale.js` (新) | `cropRectForElement`、`upscaleImageData` 等纯函数,便于测试 |
| `src/base64-codec.js` (新) | Base64 单一实现 |
| `src/base64.js` | 导入 codec;统一分号风格;独立 status 元素 |
| `src/main.js` | 时间预算包络;按失败分层+超时选择提示 |
| `tests/` | 拆分为 codec / 几何 / 解码三组;补 R5–R8、R11–R12 断言 |
| `package.json` | 移除 `qr-scanner` 依赖 |

## 兼容性与回滚

- 无外部接口变更,userscript 元数据与菜单命令不变。
- `@grant` 与 `@connect` 不变,不引入新权限。
- 纯函数集中在 `src/scale.js`,可在 Node 下测试,不需要浏览器环境。
- 回滚点:每个 R 一个提交,失败可单独 revert。
