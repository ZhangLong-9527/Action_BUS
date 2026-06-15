/**
 * 波形图 — 单通道 Float32 BE
 *
 * 适用场景：下位机发送一个 4 字节大端 float，绑定到波形图单通道。
 * 拖入波形图控件 → 右侧属性面板 → 粘贴此脚本 → 点击「应用」
 *
 * 修改说明：
 *   FUNC_CODE  改为实际功能码（十六进制数字，不是字符串）
 *   OFFSET     float32 在 data[] 中的起始字节偏移
 *   GAIN       增益系数，原始值 × GAIN 后绘制
 */

const FUNC_CODE = 0x10;   // ← 改为实际功能码
const OFFSET    = 0;      // ← float32 起始偏移（字节）
const GAIN      = 1.0;    // ← 增益，如 0.001 表示毫米→米

if (frame.func !== FUNC_CODE) return;

const raw = readFloat32BE(OFFSET);
const val = raw * GAIN;

ch(0).push(val, {
    color:     '#3b82f6',   // 线条颜色
    lineWidth: 1.5,         // 线宽
    label:     'Ch0',       // 图例名称
});
