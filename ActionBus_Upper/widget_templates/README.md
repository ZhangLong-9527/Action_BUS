# 控件脚本模板

各控件参考脚本，拖入控件后在右侧属性面板→「绑定脚本」处粘贴使用。

## 文件列表

| 文件 | 控件类型 | 说明 |
|------|----------|------|
| `waveform_float32.js` | 波形图 | 单通道，float32 BE |
| `waveform_float32_multichannel.js` | 波形图 | 多通道，同帧多个 float32 |
| `waveform_int16_scaled.js` | 波形图 | int16 × 比例系数（Roll/Pitch/Yaw） |
| `waveform_uint16_adc.js` | 波形图 | uint16 ADC 转电压，按通道号分路 |
| `attitude.js` | 3D 姿态 | int16×100 或 float32 四元数 |
| `number.js` | 数字显示 / 仪表盘 | float32 / int16 / uint32 / 单字节 |
| `progressbar.js` | 进度条 | ADC→% / float→% / uint8→% |
| `statuslight.js` | 状态灯 | 监控 SW 位 / 错误位 / 字段值 |
| `text.js` | 文本标签 | ASCII 字符串 / 格式化数值 |
| `xy_scatter.js` | XY 散点图 | 两路 float32 → X/Y |
| `switch.js` | 开关按键 | **属性面板配置说明**（无脚本） |
| `slider.js` | 滑块 | **属性面板配置说明**（无脚本） |
| `script_decoder.js` | 脚本解码器 | 通用调试，打印所有帧到控制台 |

---

## 脚本 API 速查

```javascript
// ── 输入 ──────────────────────────────────────────────────
frame.func               // 功能码（number）
frame.stat               // Stat 字节（number）
frame.addr               // 来源地址（number）
frame.data               // 载荷（Uint8Array）

// ── 输出 ──────────────────────────────────────────────────
output(value)            // 等同于 ch(0).push(value)
ch(n).push(value, opts?) // 推入第 n 通道（n = 0~31）

// opts 可选参数：
// { color: '#3b82f6', lineWidth: 1.5, label: 'Ch0' }
// color 和 lineWidth 仅波形图通道有效

// ── 数据读取辅助函数 ─────────────────────────────────────
readFloat32BE(offset)    // 4 字节大端 float
readFloat32LE(offset)    // 4 字节小端 float
readInt16BE(offset)      // 2 字节有符号大端整数
readInt16LE(offset)      // 2 字节有符号小端整数
readUint16BE(offset)     // 2 字节无符号大端整数
readUint16LE(offset)     // 2 字节无符号小端整数
readUint32BE(offset)     // 4 字节无符号大端整数
readInt32BE(offset)      // 4 字节有符号大端整数
```

---

## 使用流程

1. 从左侧「控件库」拖入控件到画布
2. 点击控件 → 右侧属性面板弹出
3. 「绑定脚本」区域粘贴或导入模板文件
4. 点击「应用」按钮使脚本生效
5. 连接串口后，下位机发帧时脚本自动触发

---

## 快速定制

```javascript
// 典型三行模板：
if (frame.func !== 0xXX) return;  // 1. 过滤功能码
const val = readFloat32BE(0);      // 2. 解析数据
output(val);                       // 3. 推送到控件
```
