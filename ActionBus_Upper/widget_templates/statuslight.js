/**
 * 状态灯控件
 *
 * ch(0).push(value)：
 *   value > 0  → 绿灯亮（同时显示 value 的字符串）
 *   value === 0 → 灯灭（显示 "—"）
 *
 * 可用于监控任务运行状态、连接状态、错误状态等。
 */

/* ── 示例 1：监控特定功能码的 SW 位（Bit0 of Stat） ──
 *   Stat 0x01 = 从机运行中 → 亮
 *   Stat 0x00 = 从机已停止 → 灭
 */
const FUNC_CODE = 0x0A;   // ← 监控哪个功能码

if (frame.func !== FUNC_CODE) return;

const running = (frame.stat & 0x01) !== 0;
ch(0).push(running ? 1 : 0);

/* ── 示例 2：监控任意功能码的错误位（Stat Bit7） ──
if (frame.func !== 0x0B) return;
const hasErr = (frame.stat & 0x80) !== 0;
ch(0).push(hasErr ? 0 : 1);    // 有错误→灭，无错误→亮
*/

/* ── 示例 3：监控 data[0] 是否为特定值 ──
if (frame.func !== 0x05) return;
ch(0).push(frame.data[0] === 0x01 ? 1 : 0);
*/
