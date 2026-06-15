/**
 * 脚本解码器控件 — 通用调试模板
 *
 * 脚本解码器是最灵活的控件，可做任意逻辑：
 *   - 过滤特定帧并打印到控制台（调试用）
 *   - 同时向多种控件推数据
 *   - 将数据转发给其他通道
 *
 * 此模板演示：打印所有收到的帧内容（调试模式）。
 * 在浏览器开发者工具（Ctrl+Shift+I）的 Console 中查看输出。
 */

/* ── 示例 1：打印所有帧（调试用） ── */
const hex = (b) => b.toString(16).padStart(2, '0').toUpperCase();
const dataHex = Array.from(frame.data).map(hex).join(' ');

console.log(
    `[RX] func=0x${hex(frame.func)} stat=0x${hex(frame.stat)}` +
    ` addr=0x${hex(frame.addr)} data=[${dataHex}]`
);

/* ── 示例 2：只打印特定功能码（取消注释使用） ──
if (frame.func !== 0x0A) return;
console.log('温度帧:', readFloat32BE(0).toFixed(2), '°C');
*/

/* ── 示例 3：将一帧的多个字段分发给多个波形图 ──
 *   需要画布上同时有多个波形图控件，
 *   但脚本解码器本身不含波形，适合做路由中转。
 *   （实际上每个波形图控件直接写自己的脚本更简单）
if (frame.func !== 0x30) return;
ch(0).push(readFloat32BE(0));   // 分发到解码器自身 ch0（无实际显示）
ch(1).push(readFloat32BE(4));   // ch1
// 波形图有自己的脚本，这里只做日志
*/
