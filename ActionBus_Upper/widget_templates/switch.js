/**
 * 开关控件 — 属性面板配置说明
 *
 * 开关控件不使用脚本，通过右侧属性面板配置发送帧。
 * 此文件作为配置参考，供复制帧参数时使用。
 *
 * ── 属性面板填写方式 ──────────────────────────────
 *
 * ON 帧（按下 ON 按钮时发送）：
 *   Func:  0x01          ← 功能码（十六进制）
 *   Stat:  11            ← 固定 11（主机 ON 请求）
 *   Data:  01            ← 参数字节，空格分隔
 *
 * OFF 帧（按下 OFF 按钮时发送）：
 *   Func:  0x01
 *   Stat:  10            ← 固定 10（主机 OFF 请求）
 *   Data:                ← 可以为空
 *
 * ── 常用配置示例 ──────────────────────────────────
 *
 * 控制 LED1（ActionBus 0x01）：
 *   ON  → Func=0x01  Stat=11  Data=01
 *   OFF → Func=0x01  Stat=10  Data=
 *
 * 控制 LED1 + LED2 同时亮灭（mask=0x03）：
 *   ON  → Func=0x01  Stat=11  Data=03
 *   OFF → Func=0x01  Stat=10  Data=
 *
 * 启动 / 停止温度订阅（0x0A，间隔 500ms = 0x01F4）：
 *   ON  → Func=0x0A  Stat=11  Data=01 F4
 *   OFF → Func=0x0A  Stat=10  Data=
 *
 * 自定义单次命令（开关等效于一次性触发）：
 *   ON  → Func=0x05  Stat=11  Data=AA BB CC
 *   OFF → Func=0x05  Stat=10  Data=
 *
 * ── Stat 字节含义 ─────────────────────────────────
 *   0x11  主机发送，SW=1（ON，启动）
 *   0x10  主机发送，SW=0（OFF，停止）
 *   0x01  从机回复，SW=1（运行中）
 *   0x00  从机回复，SW=0（已停止）
 *   0x80  从机回复，ERR=1（错误）
 */
