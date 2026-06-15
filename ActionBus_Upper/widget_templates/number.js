/**
 * 数字显示控件 / 仪表盘控件
 *
 * 使用 output(value) 或 ch(0).push(value) 更新显示值。
 * 控件直接显示推入的数字（保留 4 位小数）。
 */

/* ── 示例 1：float32 单值（温度、压力等） ── */
const FUNC_CODE = 0x0A;
const OFFSET    = 0;
const GAIN      = 1.0;    // 如需单位换算，修改此处

if (frame.func !== FUNC_CODE) return;

const val = readFloat32BE(OFFSET) * GAIN;
output(val);

/* ── 示例 2：int16 × 0.01（取消注释使用） ──
if (frame.func !== 0x0A) return;
if (frame.data.length < 2) return;
output(readInt16BE(0) * 0.01);
*/

/* ── 示例 3：uint32 BE 设备运行时间（毫秒→秒） ──
if (frame.func !== 0x0D) return;
if (frame.data.length < 4) return;
output(readUint32BE(0) / 1000);
*/

/* ── 示例 4：从帧数据第 N 个字节取单字节值 ──
if (frame.func !== 0x05) return;
output(frame.data[2]);          // 取 data[2] 的值
*/
