/**
 * 波形图 — Uint16 BE（ADC / 无符号 16 位整数）
 *
 * 适用场景：ADC 采样值、无符号计数器、PWM 占空比等。
 *           示例将 ADC 原始值转换为电压（假设 3.3V / 12 位 ADC）。
 *
 * 示例帧结构（ActionBus 0x0C ADC 回复）：
 *   data[0]    = 通道号
 *   data[1..2] = ADC 值 (uint16 BE, 0–4095)
 */

const FUNC_CODE   = 0x0C;
const ADC_REF     = 3.3;    // 参考电压（V）
const ADC_BITS    = 12;     // 分辨率

if (frame.func !== FUNC_CODE) return;
if (frame.data.length < 3) return;

const ch_idx = frame.data[0];          // 通道号作为波形通道索引
const raw    = readUint16BE(1);        // ADC 原始值
const volt   = raw / ((1 << ADC_BITS) - 1) * ADC_REF;

ch(ch_idx).push(volt, {
    label: `ADC ch${ch_idx}`,
    color: ['#3b82f6','#f97316','#10b981','#f59e0b'][ch_idx % 4],
    lineWidth: 1.5,
});
