# ActionBus v3.1 测试指南

目标板：STM32F407ZET6 · 设备地址 0x01 · 串口 USART1 @ 115200 8N1

---

## 1. 接线检查

```
USB串口模块 (CH340/CP2102/FTDI)        STM32F407
        TX  ──────────────────────→  PA10  (USART1_RX)
        RX  ←──────────────────────  PA9   (USART1_TX)
       GND  ──────────────────────   GND
```

> **TX / RX 必须交叉**，同名相连（TX→TX）是最常见的接线错误。

### 1.1 环回自测（验证适配器本身）

暂时将 USB 串口模块的 TX 和 RX 用杜邦线短接，运行：

```bash
python3 - << 'EOF'
import serial, time
with serial.Serial('/dev/ttyUSB0', 115200, timeout=0.5) as s:
    s.reset_input_buffer()
    s.write(b'\xAA\x55\x01\x20\x11\x03\x48\x69\x21\xB9\x9E')
    rx = s.read(64)
    print('OK' if rx else 'FAIL', rx.hex(' ').upper() if rx else '')
EOF
```

收到相同数据 → 适配器正常；无数据 → 适配器故障或未短接。

---

## 2. 帧格式

```
┌──────┬──────┬──────┬──────────┬──────┬────────────────┬────────────┐
│  AA  │  55  │ Addr │ FuncCode │ Stat │  Data[0..Len-1]│ CRC_H CRC_L│
│ 1B   │  1B  │  1B  │    1B    │  1B  │    Len 字节    │   2B BE    │
└──────┴──────┴──────┴──────────┴──────┴────────────────┴────────────┘
```

**Stat 字节**

| Bit | 名称 | 说明 |
|-----|------|------|
| 7   | ERR  | 1=错误响应 |
| 4   | DIR  | **1=主机→设备**，0=设备→主机 |
| 0   | SW   | **1=开启/发送**，0=关闭/停止 |

- 主机发送普通命令：`Stat = 0x11`（DIR=1, SW=1）
- 主机发送停止命令：`Stat = 0x10`（DIR=1, SW=0）
- 设备正常响应：`Stat = 0x01`（DIR=0, SW=1）

**CRC：CRC-16/MODBUS**，多项式 0x8005，初值 0xFFFF，覆盖 `[Addr, FuncCode, Stat, Len, Data...]`，结果**大端**附在帧尾。

---

## 3. 测试工具

### 方式 A：Python 脚本（推荐）

```bash
cd /home/zephyr/AilongProject/ActionBus/ActionBus_Upper
python3 serial_test.py
```

见第 7 节自动化测试脚本。

### 方式 B：minicom 手动测试

```bash
minicom -D /dev/ttyUSB0 -b 115200
```

进入后：
- `Ctrl-A A`：切换追加换行
- `Ctrl-A H`：切换十六进制显示（**必须开启**）
- `Ctrl-A W`：发送十六进制字符串（输入不带空格的十六进制，如 `AA5501011101016988`）
- `Ctrl-A X`：退出

### 方式 C：上位机 Electron 应用

```bash
cd /home/zephyr/AilongProject/ActionBus/ActionBus_Upper
npm start
```

在底部**手动发送栏**：
- **组帧模式**（开关打开）：只需填写 Func 和 Data，CRC 自动计算
- **原始模式**（开关关闭）：粘贴完整帧十六进制字符串

---

## 4. 测试用例

设备地址固定 `0x01`，所有帧均已预计算 CRC，可直接发送。

---

### 4.1 Echo 回环（0x20）—— 首先测试链路连通性

**用途**：验证收发链路是否正常，设备原样回传 Data。

| 方向 | 帧（十六进制） | 说明 |
|------|----------------|------|
| 发送 | `AA 55 01 20 11 03 48 69 21 B9 9E` | 发送 "Hi!" |
| 期望 | `AA 55 01 20 01 03 48 69 21 xx xx` | 回传 "Hi!"，Stat=0x01 |
| 发送 | `AA 55 01 20 11 02 41 42 90 94` | 发送 "AB" |
| 发送 | `AA 55 01 20 10 00 D2 0D` | SW=0，关闭 Echo |

**判断**：回传 Data 与发送 Data 完全相同 → 链路正常。

**组帧模式**：Func=`0x20`，Data=`48 69 21`

---

### 4.2 LED 控制（0x01）—— 单次命令

**Data[0]**：LED 掩码（bit0=LED1/PF9，bit1=LED2/PF10）

| 功能 | 发送帧 |
|------|--------|
| LED1 亮 | `AA 55 01 01 11 01 01 69 88` |
| LED2 亮 | `AA 55 01 01 11 01 02 68 C8` |
| 两灯全亮 | `AA 55 01 01 11 01 03 A8 09` |
| 全灭（SW=0）| `AA 55 01 01 10 00 D8 5D` |

**判断**：发送后板子上对应 LED 立即亮/灭（无 UART 响应，为单次命令）。

**组帧模式**：
- LED1 亮：Func=`0x01`，Data=`01`
- 全灭：Func=`0x01`，Data 留空，发送时在上位机将 SW 置 0

---

### 4.3 LED 闪烁订阅（0x02）

**Data[0]**：LED 掩码；**Data[1]**：间隔 ×100ms（0 表示 500ms）

| 功能 | 发送帧 |
|------|--------|
| LED1 闪烁 200ms | `AA 55 01 02 11 02 01 02 A7 5C` |
| LED2 闪烁 500ms | `AA 55 01 02 11 02 02 05 95 1D` |
| 两灯闪烁 500ms | `AA 55 01 02 11 02 03 05 05 1C` |
| 停止闪烁（SW=0）| `AA 55 01 02 10 00 D8 AD` |

**期望**：
- 发送开始后设备立即回传确认帧：`AA 55 01 02 01 02 [mask] [interval] xx xx`
- LED 开始以指定间隔闪烁
- 发送停止帧后 LED 熄灭

**组帧模式**：Func=`0x02`，Data=`03 05`（两灯，500ms）

---

### 4.4 温度订阅（0x0A）

**Data[0:1]**：上报间隔 ms（uint16 大端，0 默认 1000ms）  
**响应 Data**：`[temp_H, temp_L]`，int16 大端，单位 0.01°C  
范围：2300～2500（23.00～25.00°C），周期 12s 三角波

| 功能 | 发送帧 |
|------|--------|
| 订阅，间隔 1000ms | `AA 55 01 0A 11 02 03 E8 89 3D` |
| 订阅，间隔 500ms | `AA 55 01 0A 11 02 01 F4 20 3D` |
| 停止（SW=0） | `AA 55 01 0A 10 00 1A 2C` |

**期望响应**（周期重复）：
```
AA 55 01 0A 01 02 [T_H] [T_L] xx xx
```
解析示例：`T_H=0x09, T_L=0x1C` → 0x091C = 2332 → **23.32°C**

**组帧模式**：Func=`0x0A`，Data=`03 E8`

---

### 4.5 IMU 姿态订阅（0x0B）

**Data[0:1]**：间隔 ms（uint16 大端，0 默认 100ms，最小 20ms）  
**响应 Data**：`[Roll_H Roll_L Pitch_H Pitch_L Yaw_H Yaw_L]`，int16 大端，单位 0.01°

| 轴 | 范围 | 周期 |
|----|------|------|
| Roll  | ±10.00° | 6s |
| Pitch | ±5.00°  | 4s |
| Yaw   | ±180°   | 持续递增，约 0.36°/s |

| 功能 | 发送帧 |
|------|--------|
| 订阅，间隔 100ms | `AA 55 01 0B 11 02 00 64 1C 01` |
| 订阅，间隔 200ms | `AA 55 01 0B 11 02 00 C8 61 01` |
| 停止（SW=0） | `AA 55 01 0B 10 00 DA 7D` |

**期望响应**：
```
AA 55 01 0B 01 06 [R_H R_L] [P_H P_L] [Y_H Y_L] xx xx
```
解析示例：`03 E8 FF CE 07 D0` → Roll=+10.00°，Pitch=-0.50°，Yaw=+20.00°

**组帧模式**：Func=`0x0B`，Data=`00 64`

---

### 4.6 ADC 单次读取（0x0C）

**Data[0]**：通道号 0～3  
**响应 Data**：`[ch, val_H, val_L]`，uint16 大端，范围 0～4095

| 功能 | 发送帧 |
|------|--------|
| 读 ch0 | `AA 55 01 0C 11 01 00 05 4B` |
| 读 ch1 | `AA 55 01 0C 11 01 01 C5 8A` |
| 读 ch2 | `AA 55 01 0C 11 01 02 C4 CA` |
| 读 ch3 | `AA 55 01 0C 11 01 03 04 0B` |

**期望响应**：
```
AA 55 01 0C 01 03 [ch] [val_H] [val_L] xx xx
```
解析示例：`00 0F FF` → ch=0，ADC=4095（满量程）

**组帧模式**：Func=`0x0C`，Data=`00`

---

### 4.7 设备状态查询（0x0D）

无 Data，单次查询。

| 功能 | 发送帧 |
|------|--------|
| 查询状态 | `AA 55 01 0D 11 00 4B 9C` |

**期望响应**（8 字节 Data）：
```
AA 55 01 0D 01 08 [uptime:4B] [cpu_temp:2B] [tasks:1B] [addr:1B] xx xx
```

| 字段 | 字节 | 说明 |
|------|------|------|
| uptime | [0:3] | 运行时间 ms，uint32 大端 |
| cpu_temp | [4:5] | CPU温度×100，int16 大端（约比环境高 7°C） |
| tasks | [6] | 当前活跃订阅数 |
| addr | [7] | 总线地址（应为 0x01） |

解析示例：`00 00 27 10 09 A4 02 01`  
→ uptime=10000ms(10s)，cpu_temp=0x09A4=2468→24.68°C，tasks=2，addr=0x01

**组帧模式**：Func=`0x0D`，Data 留空

---

### 4.8 文件传输（0x10）

使用 ab_file 子协议，**Data[0]** 为子命令：

| 子命令 | 值 | 说明 |
|--------|----|------|
| INIT   | 0x00 | Data=[0x00, size_H, size_L, filename...] |
| DATA   | 0x01 | Data=[0x01, seq_H, seq_L, payload...] |
| END    | 0x02 | Data=[0x02]，结束传输 |
| ABORT  | 0x03 | Data=[0x03]，中止传输 |

**完整传输流程（以 64 字节文件 test.bin 为例）：**

```
Step 1 INIT   → AA 55 01 10 11 0B 00 00 40 74 65 73 74 2E 62 69 6E F5 F7
Step 2 DATA0  → AA 55 01 10 11 07 01 00 00 DE AD BE EF 1E 09
       DATA1  → AA 55 01 10 11 07 01 00 01 CA FE BA BE xx xx   ← 自行计算CRC
       ...（每包最多 64 字节 payload）
Step 3 END    → AA 55 01 10 11 01 02 54 CD
```

**期望 LED 行为**：
- INIT 成功：LED1 常亮（传输进行中）
- 每收到一包 DATA：LED2 切换一次
- END 成功：LED1 灭，LED2 亮 3 秒后自动灭
- 完成后设备上报：`AA 55 01 10 01 04 [total_bytes:4B] xx xx`

```
Step 4 ABORT  → AA 55 01 10 11 01 03 94 0C   （中止用，替代 END）
```

---

## 5. 响应解析速查

```
AA 55 01 [FC] [Stat] [Len] [Data...] [CRC_H] [CRC_L]
```

| Stat 值 | 含义 |
|---------|------|
| `0x01`  | 设备正常响应（SW=1） |
| `0x00`  | 设备 SW=0 响应（确认停止） |
| `0x81`  | 设备错误响应（ERR=1） |

---

## 6. 常见问题

| 现象 | 可能原因 | 解决 |
|------|----------|------|
| 发送无任何响应 | TX/RX 接反 | 交叉接线：模块TX→PA10，模块RX→PA9 |
| 发送无响应 | GND 未共地 | 连接模块 GND 和板子 GND |
| 有响应但 CRC 错误 | 波特率不对 | 确认 115200，8N1，无校验 |
| LED 不亮 | 极性反接 | 修改 test_tasks.c 中 LED_ON/LED_OFF 定义 |
| 订阅无数据 | 忘记开启订阅 | 需先发送 SW=1 的帧才开始上报 |

---

## 7. 自动化测试脚本

```python
# serial_test.py — 保存到 ActionBus_Upper/ 目录下运行
import serial, time, sys

PORT = '/dev/ttyUSB0'
BAUD = 115200
PASS = 0; FAIL = 0

def crc16modbus(data):
    crc = 0xFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if (crc & 1) else crc >> 1
    return crc

def make(addr, func, stat, data=b''):
    data = bytes(data)
    p = bytes([addr, func, stat, len(data)]) + data
    c = crc16modbus(p)
    return b'\xAA\x55' + p + bytes([c >> 8, c & 0xFF])

def recv(ser, timeout=1.2):
    buf = bytearray(); t0 = time.time()
    while time.time()-t0 < timeout:
        b = ser.read(1)
        if b:
            buf += b
            if len(buf) >= 2 and buf[0] == 0xAA and buf[1] == 0x55 and len(buf) >= 6:
                need = 6 + buf[5] + 2
                if len(buf) >= need:
                    return bytes(buf[:need])
    return None

def check(name, tx, expect_func=None, expect_data_len=None):
    global PASS, FAIL
    ser.write(tx)
    r = recv(ser)
    ok = r is not None
    if ok and expect_func is not None:
        ok = ok and (r[3] == expect_func)
    if ok and expect_data_len is not None:
        ok = ok and (r[5] == expect_data_len)
    status = "PASS" if ok else "FAIL"
    if ok: PASS += 1
    else:  FAIL += 1
    rx_str = r.hex(' ').upper() if r else "<无响应>"
    print(f"[{status}] {name:30s}  RX: {rx_str}")
    return r

with serial.Serial(PORT, BAUD, timeout=0.1) as ser:
    time.sleep(0.2); ser.reset_input_buffer()
    
    print("=" * 70)
    print("ActionBus v3.1 自动测试")
    print("=" * 70)
    
    # 0x20 Echo
    check("Echo 'Hi!'",          make(1,0x20,0x11,b'Hi!'), 0x20, 3)
    
    # 0x0D 设备状态
    check("设备状态查询",          make(1,0x0D,0x11),        0x0D, 8)
    
    # 0x01 LED
    check("LED1 亮",              make(1,0x01,0x11,[0x01]),  None, None)
    time.sleep(0.5)
    check("LED2 亮",              make(1,0x01,0x11,[0x02]),  None, None)
    time.sleep(0.5)
    check("全灭",                 make(1,0x01,0x10),         None, None)
    time.sleep(0.3)
    
    # 0x0C ADC
    check("ADC ch0",              make(1,0x0C,0x11,[0x00]),  0x0C, 3)
    check("ADC ch1",              make(1,0x0C,0x11,[0x01]),  0x0C, 3)
    check("ADC ch2",              make(1,0x0C,0x11,[0x02]),  0x0C, 3)
    check("ADC ch3",              make(1,0x0C,0x11,[0x03]),  0x0C, 3)
    
    # 0x0A 温度订阅
    check("温度订阅启动(1s)",     make(1,0x0A,0x11,[0x03,0xE8]), None, None)
    time.sleep(2.5)
    r = recv(ser, timeout=0.1)
    if r and r[3]==0x0A and r[5]==2:
        t = int.from_bytes(r[6:8], 'big', signed=True)
        PASS += 1; print(f"[PASS] 温度上报                           {t/100:.2f}°C")
    else:
        FAIL += 1; print("[FAIL] 温度上报                           <未收到>")
    check("温度订阅停止",         make(1,0x0A,0x10), None, None)
    
    # 0x0B IMU 订阅
    check("IMU订阅启动(200ms)",   make(1,0x0B,0x11,[0x00,0xC8]), None, None)
    time.sleep(0.5)
    r = recv(ser, timeout=0.1)
    if r and r[3]==0x0B and r[5]==6:
        roll  = int.from_bytes(r[6:8],  'big', signed=True)
        pitch = int.from_bytes(r[8:10], 'big', signed=True)
        yaw   = int.from_bytes(r[10:12],'big', signed=True)
        PASS += 1; print(f"[PASS] IMU上报                            R={roll/100:.2f}° P={pitch/100:.2f}° Y={yaw/100:.2f}°")
    else:
        FAIL += 1; print("[FAIL] IMU上报                            <未收到>")
    check("IMU订阅停止",          make(1,0x0B,0x10), None, None)
    
    # 0x02 LED 闪烁
    check("LED两灯闪烁500ms",     make(1,0x02,0x11,[0x03,0x05]), 0x02, 2)
    time.sleep(2)
    check("LED闪烁停止",          make(1,0x02,0x10), None, None)
    
    # 0x10 文件传输
    fname = b'hello.bin'
    payload = b'\x01\x02\x03\x04' * 4  # 16 bytes
    check("文件INIT",  make(1,0x10,0x11,bytes([0x00,0x00,len(payload)])+fname), None, None)
    time.sleep(0.1)
    check("文件DATA0", make(1,0x10,0x11,bytes([0x01,0x00,0x00])+payload), None, None)
    time.sleep(0.1)
    r = check("文件END",   make(1,0x10,0x11,[0x02]), 0x10, 4)
    if r:
        n = int.from_bytes(r[6:10], 'big')
        print(f"       → 已接收 {n} 字节")
    
    # 0x20 Echo 停止
    check("Echo关闭(SW=0)",       make(1,0x20,0x10), None, None)
    
    print("=" * 70)
    print(f"结果：PASS={PASS}  FAIL={FAIL}  总计={PASS+FAIL}")
    print("=" * 70)
    sys.exit(0 if FAIL == 0 else 1)
```

运行：

```bash
cd /home/zephyr/AilongProject/ActionBus/ActionBus_Upper
python3 serial_test.py
```

---

## 8. 测试顺序建议

```
1. 接线检查（第 1 节环回自测）
2. Echo 链路验证（4.1）
3. LED 控制（4.2）— 肉眼确认 LED 反应
4. 设备状态（4.7）— 验证数值解析
5. ADC 读取（4.6）— 验证单次响应
6. 温度订阅（4.4）— 验证周期上报
7. IMU 订阅（4.5）— 验证多字段解析
8. LED 闪烁（4.3）— 验证订阅控制
9. 文件传输（4.8）— 验证大数据流
```
