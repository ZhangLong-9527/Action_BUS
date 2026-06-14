# ActionBus 协议规范 v3.0

ActionBus 是一种轻量级主从串行通信协议，面向嵌入式/IoT 场景设计，强调帧结构对称、任务模型简洁、可扩展性强。

---

## 一、帧格式

```
总长度 = 6（帧头） + Len（数据） + 2（CRC）
最大帧长 = 6 + 255 + 2 = 263 字节
```

| 字节偏移 | 字段      | 长度 | 说明                                   |
|----------|-----------|------|----------------------------------------|
| 0        | Head_H    | 1    | 帧头高字节，固定 `0xAA`                |
| 1        | Head_L    | 1    | 帧头低字节，固定 `0x55`                |
| 2        | Addr      | 1    | 设备地址 `0x01–0xFE` 单播，`0xFF` 广播 |
| 3        | FuncCode  | 1    | 功能码 / Action ID                     |
| 4        | Stat      | 1    | 状态控制字节（见下节）                 |
| 5        | Len       | 1    | 纯数据长度（不含帧头和 CRC）           |
| 6…       | Data      | N    | 用户载荷，N = Len                      |
| 6+N      | CRC_H     | 1    | CRC-16 高字节（大端先发）              |
| 7+N      | CRC_L     | 1    | CRC-16 低字节                          |

---

## 二、Stat 控制字节

```
Bit 7 | Bits 6-5 | Bit 4 | Bits 3-1 | Bit 0
 ERR  |  RES(0)  |  DIR  |  RES(0)  |  SW
```

| 位   | 名称 | 含义                                              |
|------|------|---------------------------------------------------|
| Bit7 | ERR  | `1` = 错误帧，此时 Data[0] 为错误码              |
| Bit6-5 | RES | 保留，必须为 0                                  |
| Bit4 | DIR  | `1` = 主机发出（请求），`0` = 从机发出（响应）   |
| Bit3-1 | RES | 保留，必须为 0                                  |
| Bit0 | SW   | `1` = 启动/运行中，`0` = 停止/完成              |

**常用组合：**

| Stat | 含义                        |
|------|-----------------------------|
| `0x11` | 主机 ON，请求启动任务     |
| `0x10` | 主机 OFF，请求停止任务    |
| `0x01` | 从机 ON，运行中 / 确认    |
| `0x00` | 从机 OFF，已停止 / 已完成 |
| `0x80` | 从机错误，Data[0] = 错误码 |

> 接收方必须忽略保留位（Bit 6-5、3-1），仅判断已定义位，以保证向后兼容。

---

## 三、地址字段

| 值          | 含义                           |
|-------------|--------------------------------|
| `0x01–0xFE` | 单播，从机地址须精确匹配       |
| `0xFF`      | 广播，所有从机接收；默认不回复 |

广播安全原则：**危险操作（写 NVM、复位、进 Bootloader）禁止使用广播**，除非上层有令牌/会话保护。

---

## 四、功能码空间

| 范围        | 类型       | 说明                             |
|-------------|------------|----------------------------------|
| `0x00`      | 协议保留   | 不可注册                         |
| `0x01–0xEF` | 用户空间   | 通过 `ActionBus_Register()` 注册 |
| `0xF0–0xFF` | 协议固定   | 见下表                           |

**协议保留功能码：**

| 码     | 建议符号         | 语义                                     |
|--------|------------------|------------------------------------------|
| `0xF0` | `FUNC_QUERY`     | 通用只读查询入口，子命令见 §4.1           |
| `0xF1` | `FUNC_DEVICE_CTRL` | 设备控制（SAVE_NVM / SOFT_RESET / ENTER_BOOTLOADER） |
| `0xF2–0xFD` | —           | 保留                                     |
| `0xFE` | `FUNC_ACTION_DESC` | Action 描述表枚举，子命令见 §4.2        |
| `0xFF` | —                | 保留，不可使用                           |

### 4.1 查询子命令（`0xF0`）

主机发 `Stat=0x11`，`Data[0]` = 子命令：

| SubCmd | 名称                   | 从机响应数据                        |
|--------|------------------------|-------------------------------------|
| `0x00` | GET_PROTOCOL_VERSION   | `major(1) minor(1)`，如 `03 00`    |
| `0x01` | GET_DEVICE_ID          | `vendor_id(2) product_id(2) hw_rev(1)` |
| `0x02` | GET_ACTION_COUNT       | `count(1)`，已注册 Action 数量      |
| `0x03` | GET_UPTIME_MS          | `uptime_ms(4)`，上电毫秒数          |
| `0x04` | GET_BUS_ADDRESS        | `address(1)`，当前单播地址          |
| `0x05–0x7F` | —                 | 标准保留，返回错误 `0x01` 或 `0x03` |
| `0x80–0xFF` | —                 | 厂商自定义                          |

### 4.2 Action 描述表（`0xFE`）

从机按 `func_code` 升序排列已注册 Action，以 `index`（0 到 N-1）访问：

| SubCmd | 名称           | 主机 Data     | 从机响应数据                                                      |
|--------|----------------|---------------|-------------------------------------------------------------------|
| `0x00` | SCHEMA_VERSION | 无            | `Data[0]=0x01`                                                    |
| `0x01` | GET_ENTRY      | `Data[1]=index` | `Data[0]=func_code, Data[1]=desc_len, Data[2..]=UTF-8描述` |
| `0x02–0x7F` | —         | —             | 返回错误                                                          |
| `0x80–0xFF` | —         | —             | 厂商自定义                                                        |

---

## 五、CRC-16/MODBUS 校验

| 参数     | 值       |
|----------|----------|
| 多项式   | `0x8005`（等效反转 `0xA001`） |
| 初始值   | `0xFFFF` |
| 输入反转 | 是（LSB 先） |
| 输出反转 | 是       |
| 异或输出 | `0x0000` |
| 计算范围 | 从 Byte 0（Head_H）到最后一个数据字节 |
| 线上字节序 | **大端**，CRC_H 先发，CRC_L 后发 |

**示例：**
```
原始帧（6字节无数据）: AA 55 01 01 11 00
计算 CRC = 0x7148
完整帧: AA 55 01 01 11 00 71 48
```

---

## 六、错误码（`Stat=0x80` 时 Data[0]）

| 值     | 建议符号                | 含义                                         |
|--------|-------------------------|----------------------------------------------|
| `0x00` | AB_ERR_OK               | 保留，不得用于错误帧                         |
| `0x01` | AB_ERR_INVALID_PARAMETER | 参数非法、越界或不支持的枚举值              |
| `0x02` | AB_ERR_LEN_OR_PAYLOAD   | 长度不匹配或缺少必要字段                     |
| `0x03` | AB_ERR_NOT_SUPPORTED    | 功能码未实现、未注册或子命令未知             |
| `0x04` | AB_ERR_WRONG_STATE      | 状态不匹配（如重复启动、重复停止）           |
| `0x05` | AB_ERR_BUSY             | 资源忙，非重入操作进行中                     |
| `0x06` | AB_ERR_INTERNAL         | 从机内部错误（存储、外设故障）               |
| `0x07` | AB_ERR_PERMISSION       | 权限拒绝（写保护、需要解锁）                 |
| `0x08` | AB_ERR_TIMEOUT          | 内部或外设超时                               |
| `0x09` | AB_ERR_CRC              | 应用层 CRC 校验失败（链路层 CRC 已通过）     |
| `0x0A–0x7F` | —                   | 标准保留                                     |
| `0x80–0xFF` | —                   | 厂商自定义（须在产品规格书中说明）           |

---

## 七、任务模型

ActionBus 不定义任务类型，由用户逻辑决定：

| 模式       | 从机行为                                               |
|------------|--------------------------------------------------------|
| 单次执行   | 主机 `0x11` → 从机完成后调用 `ActionBus_TaskClose()` → 发 `0x00` |
| 持续运行   | 主机 `0x11` → 从机进入循环，定期调用 `ActionBus_Report()` → 主机发 `0x10` → 从机停止发 `0x00` |

**状态规则：**

| 事件                      | 从机行为                                    |
|---------------------------|---------------------------------------------|
| 主机 ON，从机空闲         | 正常处理，响应 `0x01`（运行中）或 `0x00`（已完成）|
| 主机 ON，从机已在运行     | 返回 `AB_ERR_BUSY(0x05)`（推荐）或文档化幂等策略 |
| 主机 OFF，从机运行中      | 停止任务，响应 `0x00`                       |
| 主机 OFF，从机已停止      | 幂等响应 `0x00`                             |
| 主机发送非法参数          | 返回 `0x80` + 错误码，不影响运行中任务      |

---

## 八、通信示例

### 单次任务（LED 控制）

```
主机 → AA 55 01 01 11 00 71 48       (Stat=0x11 启动, Len=0)
从机 ← AA 55 01 01 00 00 [CRC]       (Stat=0x00 完成)
```

### 长时任务（电机旋转）

```
主机 → AA 55 01 0A 11 02 05 DC [CRC] (速度=1500, Stat=0x11)
从机 ← AA 55 01 0A 01 00 [CRC]       (Stat=0x01 运行中)
  (电机转动中...)
从机 ← AA 55 01 0A 00 00 [CRC]       (1秒后自停: Stat=0x00)
```

### 连续流（传感器订阅）

```
主机 → AA 55 01 0B 11 02 00 64 [CRC]              (订阅, 间隔=100ms)
从机 ← AA 55 01 0B 01 00 [CRC]                    (Stat=0x01 已订阅)
从机 ← AA 55 01 0B 01 04 01 2C 02 58 [CRC]        (数据帧1)
从机 ← AA 55 01 0B 01 04 02 58 03 85 [CRC]        (数据帧2, 约100ms后)
  (每隔 ~100ms 持续上报...)
主机 → AA 55 01 0B 10 00 [CRC]                    (主机 OFF)
从机 ← AA 55 01 0B 00 00 [CRC]                    (Stat=0x00 已停止)
```

### 错误响应

```
主机 → AA 55 01 0C 11 00 [CRC]        (缺少必要参数)
从机 ← AA 55 01 0C 80 01 02 [CRC]     (Stat=0x80 错误, Data[0]=0x02 参数长度错误)
```

---

## 九、文件接收协议

文件接收是一种应用层会话机制，用于向从机传输任意二进制文件（固件、配置、资源等）。协议层只定义传输过程，**不关心文件内容和用途**——如何处理接收到的文件（写 Flash、更新配置、触发重启）完全由从机的应用层决定。

使用一个用户功能码（如 `0x10`），Data[0] 为子命令。

### 主机 → 从机

**INIT（SubCmd=`0x00`）— 发起传输**

| 字节偏移 | 字段       | 类型              | 说明                         |
|----------|------------|-------------------|------------------------------|
| 0        | SubCmd     | uint8             | 固定 `0x00`                  |
| 1–4      | size       | uint32，大端      | 文件总字节数                 |
| 5        | type       | uint8             | 文件类型，由应用层定义，协议层透传 |
| 6        | name_len   | uint8             | 文件名字节长度               |
| 7…       | name       | UTF-8，N 字节     | 文件名，长度 = name_len      |

**DATA（SubCmd=`0x01`）— 传输数据块**

| 字节偏移 | 字段       | 类型              | 说明                               |
|----------|------------|-------------------|------------------------------------|
| 0        | SubCmd     | uint8             | 固定 `0x01`                        |
| 1–2      | seq        | uint16，大端      | 块序号，从 0 开始递增              |
| 3…       | chunk      | 1–252 字节        | 本块数据（每帧最多 252 字节）      |

**END（SubCmd=`0x02`）— 结束并校验**

| 字节偏移 | 字段       | 类型              | 说明                         |
|----------|------------|-------------------|------------------------------|
| 0        | SubCmd     | uint8             | 固定 `0x02`                  |
| 1–2      | total_crc  | uint16，大端      | 整个文件的 CRC-16/MODBUS     |

**ABORT（SubCmd=`0x03`）— 取消传输**

| 字节偏移 | 字段       | 类型  | 说明                         |
|----------|------------|-------|------------------------------|
| 0        | SubCmd     | uint8 | 固定 `0x03`，无附加数据      |

> `type` 字段由应用层定义，协议层透传。例如：`0x01` = 固件、`0x02` = 配置、`0x03` = 资源文件。

### 从机 → 主机（`ActionBus_Report`，`Stat=0x01`）

**RSP_READY（SubCmd=`0x00`）— 就绪**

| 字节偏移 | 字段   | 类型  | 说明                             |
|----------|--------|-------|----------------------------------|
| 0        | SubCmd | uint8 | 固定 `0x00`，无附加数据          |

**RSP_ACK（SubCmd=`0x01`）— 块接收成功**

| 字节偏移 | 字段   | 类型         | 说明                     |
|----------|--------|--------------|--------------------------|
| 0        | SubCmd | uint8        | 固定 `0x01`              |
| 1–2      | seq    | uint16，大端 | 已成功写入的块序号       |

**RSP_DONE（SubCmd=`0x02`）— 传输完成**（Stat=`0x00`）

| 字节偏移 | 字段   | 类型  | 说明                             |
|----------|--------|-------|----------------------------------|
| 0        | SubCmd | uint8 | 固定 `0x02`，无附加数据          |

**RSP_NAK（SubCmd=`0xFF`）— 序号错误，请求重发**

| 字节偏移 | 字段         | 类型         | 说明                         |
|----------|--------------|--------------|------------------------------|
| 0        | SubCmd       | uint8        | 固定 `0xFF`                  |
| 1–2      | expected_seq | uint16，大端 | 期望收到的块序号，从此处重发 |

### 传输流程（停等协议）

```
主机              从机
─ INIT ─────────→  (准备接收缓冲区)
← RSP_READY ──────
─ DATA seq=0 ───→  (写入块0)
← RSP_ACK 0 ──────
─ DATA seq=1 ───→  (写入块1)
← RSP_ACK 1 ──────
  (循环直到全部块发完...)
─ END(total_crc) →  (校验整文件 CRC)
← RSP_DONE ───────  (文件接收完毕，应用层自行处理)
```

### 完整示例

以传输一个 **500 字节固件文件 `fw.bin`** 为例，分块大小 252 字节，共 2 块。

#### 第一步：INIT

**主机发：**

```
AA 55 01 10 11 0A 00 00 00 01 F4 01 06 66 77 2E 62 69 6E [CRC_H CRC_L]
```

| 字节 | 值 | 含义 |
|------|----|------|
| `AA 55` | 帧头 | 固定魔数 |
| `01` | Addr | 从机地址 |
| `10` | FuncCode | 文件传输功能码 |
| `11` | Stat | 主机 ON |
| `0A` | Len | 数据长度 10 字节 |
| `00` | SubCmd | INIT |
| `00 00 01 F4` | size | 500 字节，uint32 大端 |
| `01` | type | 固件 |
| `06` | name_len | 文件名 6 字节 |
| `66 77 2E 62 69 6E` | name | "fw.bin" 的 ASCII |

**从机回 RSP_READY：**

```
AA 55 01 10 01 01 00 [CRC_H CRC_L]
```

| 字节 | 值 | 含义 |
|------|----|------|
| `01` | Stat | 从机 ON |
| `01` | Len | 1 字节 |
| `00` | SubCmd | RSP_READY，缓冲区就绪 |

#### 第二步：DATA 块0（252 字节）

**主机发：**

```
AA 55 01 10 11 FF 01 00 00 [252字节数据...] [CRC_H CRC_L]
```

| 字节 | 值 | 含义 |
|------|----|------|
| `FF` | Len | 3（SubCmd+seq）+ 252 = 255 |
| `01` | SubCmd | DATA |
| `00 00` | seq | 块序号 0 |
| `...` | chunk | 252 字节固件数据 |

**从机回 RSP_ACK：**

```
AA 55 01 10 01 03 01 00 00 [CRC_H CRC_L]
```

| 字节 | 值 | 含义 |
|------|----|------|
| `03` | Len | 3 字节 |
| `01` | SubCmd | RSP_ACK |
| `00 00` | seq | 块 0 已写入 |

#### 第三步：DATA 块1（248 字节）

**主机发：**

```
AA 55 01 10 11 FB 01 00 01 [248字节数据...] [CRC_H CRC_L]
```

| 字节 | 值 | 含义 |
|------|----|------|
| `FB` | Len | 3 + 248 = 251 |
| `01` | SubCmd | DATA |
| `00 01` | seq | 块序号 1 |

**从机回 RSP_ACK：**

```
AA 55 01 10 01 03 01 00 01 [CRC_H CRC_L]
```

#### 第四步：END

假设整文件 CRC-16 为 `0x1A2B`：

**主机发：**

```
AA 55 01 10 11 03 02 1A 2B [CRC_H CRC_L]
```

| 字节 | 值 | 含义 |
|------|----|------|
| `03` | Len | 3 字节 |
| `02` | SubCmd | END |
| `1A 2B` | total_crc | 整文件 CRC-16 |

**从机校验通过，回 RSP_DONE：**

```
AA 55 01 10 00 01 02 [CRC_H CRC_L]
```

| 字节 | 值 | 含义 |
|------|----|------|
| `00` | Stat | 从机 OFF（传输结束） |
| `01` | Len | 1 字节 |
| `02` | SubCmd | RSP_DONE，文件接收完毕 |

#### 出错场景：RSP_NAK 重发

若块 1 数据损坏，从机回：

```
AA 55 01 10 01 03 FF 00 01 [CRC_H CRC_L]
```

| 字节 | 值 | 含义 |
|------|----|------|
| `FF` | SubCmd | RSP_NAK |
| `00 01` | expected_seq | 期望重发块 1 |

主机从 seq=1 重新发，直到收到 RSP_ACK 再继续。

### 应用层扩展示例

```
// OTA 固件升级：从机在 RSP_DONE 后自行写 Flash 并重启
// 配置更新：从机在 RSP_DONE 后将文件解析并写入 NVM
// 资源下载：从机在 RSP_DONE 后将文件存入文件系统
```

---

## 十、C 语言 API 参考

### 初始化

```c
void ActionBus_Init(void);
void ActionBus_SetSendCallback(ActionBus_SendBytes_t send_fn);
void ActionBus_SetDeviceAddress(uint8_t addr);
void ActionBus_SetDeviceId(const uint8_t *id, uint8_t len);
void ActionBus_SetUptimeCallback(ActionBus_GetUptime_t cb);
```

### 注册

```c
uint8_t ActionBus_Register(uint8_t func_code, const char *desc,
                            ActionCallback_t callback, void *context);
uint8_t ActionBus_IsRegistered(uint8_t func_code);
uint8_t ActionBus_GetRegisteredList(uint8_t *codes, uint8_t max_codes);
uint8_t ActionBus_GetRegisteredEntry(uint8_t index, uint8_t *func_code,
                                     char *desc_buf, uint8_t desc_buf_size);
```

### 接收（字节流驱动）

```c
void ActionBus_RxHandler(uint8_t byte);  // 在 UART 中断或轮询中逐字节喂入
uint8_t ActionBus_HasFrame(void);         // 是否有完整帧待处理
const AbFrame_t *ActionBus_GetFrame(void); // 获取解析好的帧
```

### 处理（主循环）

```c
void ActionBus_ProcessPending(void);  // 处理一个待处理帧，在主循环中反复调用
```

### 发送

```c
uint8_t ActionBus_Send_Frame(uint8_t func_code, uint8_t stat,
                              const uint8_t *data, uint8_t len);
uint8_t ActionBus_Report(uint8_t func_code, const uint8_t *data, uint8_t len);
uint8_t ActionBus_Send_Error(uint8_t func_code, uint8_t err_code,
                              const uint8_t *extra_data, uint8_t extra_len);
void    ActionBus_TaskClose(uint8_t func_code);
```

### CRC 计算

```c
uint16_t ActionBus_CRC16(const uint8_t *data, size_t length);
uint16_t ActionBus_CRC16_Update(uint16_t crc, const uint8_t *data, size_t length);
```

### 回调函数签名

```c
typedef uint8_t (*ActionCallback_t)(const AbFrame_t *frame, void *context);
// 返回 AB_ERR_OK(0) 表示无错误；非零值触发自动发送错误帧
```

---

## 十一、设计要点

- **对称帧结构**：单一帧格式双向复用，DIR 位区分方向
- **纯载荷设计**：`Len` 仅计数据部分，不含帧头和 CRC，无偏移混淆
- **任务模型开放**：单次/流式由用户逻辑决定，协议层不约束
- **保留位容忍**：接收方忽略未定义位，协议可平滑演进
- **工业级校验**：CRC-16/MODBUS，大端线上字节序
- **内置自描述**：`0xF0` 查询 + `0xFE` 描述表，支持主机工具自动发现
- **文件接收协议**：通用应用层文件传输机制，序号 + CRC 双重保障；OTA、配置更新等场景均可复用

---

## 十二、更改日志

### v3.1（2026-06-15）

- **新增** 文件接收协议（§九），将原 OTA 专属机制抽象为通用文件传输层，应用层通过 `type` 字段区分用途
- **修复** 发送路径长度溢出 bug：`ActionBus_SendBytes_t` 回调参数、`g_tx_len`、`Send_Frame` 内部索引均由 `uint8_t` 改为 `uint16_t`，确保最大 263 字节帧不截断

### v3.0（初始版本）

- 确立帧格式：`AA 55 | Addr | FuncCode | Stat | Len | Data | CRC_H CRC_L`
- Stat 字节三位语义：ERR（Bit7）/ DIR（Bit4）/ SW（Bit0）
- 功能码空间划分：用户区 `0x01–0xEF`，协议保留 `0xF0–0xFF`
- 内置 `0xF0` 通用查询（5条子命令）与 `0xFE` Action 描述表
- CRC-16/MODBUS，大端线上字节序
- 标准错误码 10 条（`0x00–0x09`）
