/**
 * 进度条控件
 *
 * ch(0).push(value) 中的 value 为百分比（0.0 ~ 100.0）。
 * 脚本负责将原始数据映射到 0~100 范围后推入。
 */

/* ── 示例 1：ADC 值 → 百分比（0~4095 → 0~100%） ── */
const FUNC_CODE = 0x0C;

if (frame.func !== FUNC_CODE) return;
if (frame.data.length < 3) return;

const raw    = readUint16BE(1);         // ADC 值（0~4095）
const pct    = raw / 4095 * 100;
ch(0).push(pct);

/* ── 示例 2：float32 直接作为百分比（取消注释使用） ──
if (frame.func !== 0x10) return;
const pct = Math.min(100, Math.max(0, readFloat32BE(0)));
ch(0).push(pct);
*/

/* ── 示例 3：uint8 进度字节（0~255 → 0~100%） ──
if (frame.func !== 0x10) return;
ch(0).push(frame.data[0] / 255 * 100);
*/
