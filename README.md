# ActionBus v3.1

轻量级主从串行通信协议 + 全栈参考实现。  
协议层运行在 STM32，上位机为 Electron 桌面应用，双向通信基于 CRC-16/MODBUS 校验的二进制帧。

---

## 目录结构

```
ActionBus/
├── ActionBus_Upper/          # Electron 上位机
│   ├── src/
│   │   ├── index.html        # 主界面（帧日志、拓扑图、手动发送栏）
│   │   ├── renderer/app.js   # 渲染进程逻辑
│   │   └── styles/main.css   # 主题系统（8 套主题）
│   ├── main.js               # Electron 主进程
│   ├── preload.js            # 预加载脚本
│   ├── serial_test.py        # Python 自动化测试脚本
│   └── TEST_GUIDE.md         # 详细测试手册
│
├── Stm32Project/ActionBus/   # STM32F407ZET6 固件
│   ├── Core/
│   │   ├── Inc/
│   │   │   ├── actionbus.h   # 协议库头文件
│   │   │   ├── ab_file.h     # 文件传输子协议
│   │   │   └── test_tasks.h  # 测试任务
│   │   └── Src/
│   │       ├── main.c        # 入口（UART 中断接收）
│   │       ├── actionbus.c   # 协议解析 / 发送
│   │       ├── ab_file.c     # 文件传输实现
│   │       └── test_tasks.c  # 8 个测试功能码实现
│   ├── Makefile
│   └── ActionBus.ioc         # CubeMX 工程文件
│
└── README.md                 # 本文件（协议规范 + 项目说明）
```

---

## 硬件

| 项目 | 配置 |
|------|------|
| MCU | STM32F407ZET6，Cortex-M4 @ 168MHz |
| 时钟 | HSE 8MHz，PLLM=4 PLLN=168 PLLP=2 |
| 串口 | USART1，PA9(TX) / PA10(RX)，115200 8N1 |
| LED1 | PF9，高电平亮 |
| LED2 | PF10，高电平亮 |

**接线（USB 串口模块 → STM32）**

```
模块 TX  →  PA10 (USART1_RX)
模块 RX  ←  PA9  (USART1_TX)
模块 GND —  GND
```

---

## 固件

### 编译

```bash
cd Stm32Project/ActionBus
make -j4
```

输出：`build/ActionBus.elf`，约 12KB。

### 烧录

```bash
openocd -f interface/stlink.cfg -f target/stm32f4x.cfg \
        -c "program build/ActionBus.elf verify reset exit"
```

### 已实现功能码

| 功能码 | 名称 | 类型 |
|--------|------|------|
| 0x01 | LED 控制 | 单次 |
| 0x02 | LED 闪烁订阅 | 订阅 |
| 0x0A | 温度上报订阅 | 订阅 |
| 0x0B | IMU 姿态订阅 | 订阅 |
| 0x0C | ADC 单次读取 | 单次 |
| 0x0D | 设备状态查询 | 单次 |
| 0x10 | 文件接收 | 流式 |
| 0x20 | Echo 回环 | 单次 |

### CubeMX 注意事项

所有用户代码必须在 `/* USER CODE BEGIN xxx */` 和 `/* USER CODE END xxx */` 之间，否则重新生成代码时会丢失。

---

## 上位机

### 安装依赖

```bash
cd ActionBus_Upper
npm install
```

### 启动

```bash
npm start
```

功能：
- 实时帧日志（原始帧 + 解码）
- 可视化拓扑图
- 手动发送栏（组帧模式自动补 CRC，原始模式直发）
- 左侧边栏拖拽 / 收起，底栏拖拽高度
- 8 套主题（深蓝 / 紫 / 青 / 绿 / 橙 / 中国红 / 琥珀 / 纯黑）

---

## 测试

详见 [`ActionBus_Upper/TEST_GUIDE.md`](ActionBus_Upper/TEST_GUIDE.md)。

### 快速验证

```bash
# 需要先接好 USB 串口模块（TX→PA10，RX→PA9，GND→GND）
python3 ActionBus_Upper/serial_test.py
```

脚本依次测试全部 8 个功能码，输出 PASS / FAIL 汇总。

> **当前状态**：固件编译通过，STM32 端测试尚未完成。

---

## 协议规范

### 帧格式

```
┌──────┬──────┬──────┬──────────┬──────┬──────────────────┬─────────────┐
│  AA  │  55  │ Addr │ FuncCode │ Stat │  Data[0..Len-1]  │ CRC_H CRC_L │
│  1B  │  1B  │  1B  │    1B    │  1B  │     Len 字节     │    2B BE    │
└──────┴──────┴──────┴──────────┴──────┴──────────────────┴─────────────┘
总长度 = 6 + Len + 2，最大 263 字节（Len≤255）
```

### Stat 字节

```
Bit 7 | Bits 6-5 | Bit 4 | Bits 3-1 | Bit 0
 ERR  |  RES(0)  |  DIR  |  RES(0)  |  SW
```

| Stat | 含义 |
|------|------|
| `0x11` | 主机 ON，请求启动 |
| `0x10` | 主机 OFF，请求停止 |
| `0x01` | 从机 ON，运行中 / 确认 |
| `0x00` | 从机 OFF，已停止 / 已完成 |
| `0x80` | 从机错误，Data[0]=错误码 |

### 地址

| 值 | 含义 |
|----|------|
| `0x01–0xFE` | 单播 |
| `0xFF` | 广播（危险操作禁止使用） |

### 功能码空间

| 范围 | 说明 |
|------|------|
| `0x00` | 协议保留 |
| `0x01–0xEF` | 用户空间，`ActionBus_Register()` 注册 |
| `0xF0` | 通用查询（GET_PROTOCOL_VERSION 等） |
| `0xFE` | Action 描述表枚举 |
| `0xF1–0xFD, 0xFF` | 保留 |

### CRC-16/MODBUS

| 参数 | 值 |
|------|----|
| 多项式 | 0x8005（等效反转 0xA001） |
| 初始值 | 0xFFFF |
| 计算范围 | Addr 到最后一个数据字节 |
| 线上字节序 | 大端，CRC_H 先发 |

```c
uint16_t crc16modbus(const uint8_t *data, size_t len) {
    uint16_t crc = 0xFFFF;
    for (size_t i = 0; i < len; i++) {
        crc ^= data[i];
        for (int j = 0; j < 8; j++)
            crc = (crc & 1) ? (crc >> 1) ^ 0xA001 : crc >> 1;
    }
    return crc;
}
```

### 错误码

| 值 | 符号 | 含义 |
|----|------|------|
| 0x01 | AB_ERR_INVALID_PARAMETER | 参数非法 |
| 0x02 | AB_ERR_LEN_OR_PAYLOAD | 长度或载荷错误 |
| 0x03 | AB_ERR_NOT_SUPPORTED | 功能码未注册 |
| 0x04 | AB_ERR_WRONG_STATE | 状态不匹配 |
| 0x05 | AB_ERR_BUSY | 资源忙 |
| 0x06 | AB_ERR_INTERNAL | 内部错误 |
| 0x07 | AB_ERR_PERMISSION | 权限拒绝 |
| 0x08 | AB_ERR_TIMEOUT | 超时 |
| 0x09 | AB_ERR_CRC | 应用层 CRC 错误 |

### C API 速查

```c
// 初始化
void ActionBus_Init(void);
void ActionBus_SetSendCallback(ActionBus_SendBytes_t fn);
void ActionBus_SetDeviceAddress(uint8_t addr);

// 注册功能码
uint8_t ActionBus_Register(uint8_t func, const char *desc,
                            ActionCallback_t cb, void *ctx);

// 接收（在 UART 中断中调用）
void ActionBus_RxHandler(uint8_t byte);

// 主循环处理
void ActionBus_ProcessPending(void);

// 发送
uint8_t ActionBus_Report(uint8_t func, const uint8_t *data, uint8_t len);
uint8_t ActionBus_Send_Frame(uint8_t func, uint8_t stat,
                              const uint8_t *data, uint8_t len);
void    ActionBus_TaskClose(uint8_t func);
```

### 任务模型

| 模式 | 行为 |
|------|------|
| 单次 | 主机 `0x11` → 从机执行 → `ActionBus_TaskClose()` → 发 `0x00` |
| 订阅 | 主机 `0x11` → 从机循环 `ActionBus_Report()` → 主机发 `0x10` → 从机停止 |

---

## 更改日志

### v3.1（2026-06-15）

- 新增 ab_file 文件传输子协议（INIT / DATA / END / ABORT）
- 修复发送路径长度溢出（`uint8_t` → `uint16_t`）
- 新增 STM32 测试固件（8 个功能码 + 传感器模拟）
- 新增 Electron 上位机（主题系统、手动发送栏、拖拽布局）

### v3.0（初始版本）

- 确立帧格式与 Stat 字节三位语义（ERR / DIR / SW）
- 功能码空间划分，内置 `0xF0` 查询与 `0xFE` 描述表
- CRC-16/MODBUS 大端校验
- 标准错误码体系
