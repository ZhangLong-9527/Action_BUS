/**
 * ActionBus v3.0 嵌入式通信协议库
 *
 * 帧结构: Head_H(0xAA) + Head_L(0x55) + Addr + FuncCode + Stat + Len + Data[N] + CRC_H + CRC_L
 * Stat位定义: Bit7=ERR, Bit4=DIR(1=主机发送,0=从机发送), Bit0=SW(1=开启,0=关闭)
 * CRC-16/MODBUS: 多项式0x8005, 初值0xFFFF, 大端序(先发高字节)
 */

#ifndef ACTIONBUS_H
#define ACTIONBUS_H

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/*=============================================*/
/* 基础定义                                      */
/*=============================================*/

#define AB_FRAME_HEAD_H    0xAA
#define AB_FRAME_HEAD_L    0x55
#define AB_ADDR_BROADCAST  0xFF
#define AB_FUNCCODE_RESERVED 0x00
#define AB_FUNCCODE_USER_MAX 0xEF

/* 协议保留功能码 */
#define AB_FUNC_QUERY        0xF0
#define AB_FUNC_ACTION_DESC  0xFE

#define AB_PROTOCOL_MAJOR    3
#define AB_PROTOCOL_MINOR    0
#define AB_DESC_SCHEMA_VER   1

/* 0xF0 查询子命令 */
#define AB_QUERY_GET_PROTOCOL_VERSION 0x00
#define AB_QUERY_GET_DEVICE_ID        0x01
#define AB_QUERY_GET_ACTION_COUNT     0x02
#define AB_QUERY_GET_UPTIME_MS        0x03
#define AB_QUERY_GET_BUS_ADDRESS      0x04

/* 0xFE 描述表子命令 */
#define AB_DESC_SCHEMA_VERSION_CMD    0x00
#define AB_DESC_GET_ENTRY             0x01

/* Stat 位掩码 */
#define AB_STAT_ERR       (1 << 7)   /* 错误标志 */
#define AB_STAT_DIR       (1 << 4)    /* 方向: 1=主机发送, 0=从机发送 */
#define AB_STAT_SW        (1 << 0)   /* 开关: 1=开启, 0=关闭 */

/* 常用Stat组合 */
#define AB_STAT_HOST_ON   (AB_STAT_DIR | AB_STAT_SW)       /* 0x11: 主机请求开启 */
#define AB_STAT_HOST_OFF  (AB_STAT_DIR)                    /* 0x10: 主机请求关闭 */
#define AB_STAT_SLAVE_ON  (AB_STAT_SW)                     /* 0x01: 从机运行中 */
#define AB_STAT_SLAVE_OFF (0x00)                           /* 0x00: 从机停止/完成 */
#define AB_STAT_SLAVE_ERR (AB_STAT_ERR)                    /* 0x80: 从机错误 */

/*=============================================*/
/* 错误码                                        */
/*=============================================*/

typedef enum {
    AB_ERR_OK                  = 0x00,  /* 保留,勿在错误帧使用 */
    AB_ERR_INVALID_PARAMETER   = 0x01,  /* 参数非法 */
    AB_ERR_LEN_OR_PAYLOAD      = 0x02,  /* 长度与约定不符 */
    AB_ERR_NOT_SUPPORTED       = 0x03,  /* 功能码未实现/未注册 */
    AB_ERR_WRONG_STATE         = 0x04,  /* 状态不允许 */
    AB_ERR_BUSY                = 0x05,  /* 资源忙 */
    AB_ERR_INTERNAL            = 0x06,  /* 内部错误 */
    AB_ERR_PERMISSION          = 0x07,  /* 权限不足 */
    AB_ERR_TIMEOUT             = 0x08,  /* 超时 */
    AB_ERR_CRC                 = 0x09,  /* CRC校验失败 */
} AbErr_t;

/*=============================================*/
/* 帧结构                                        */
/*=============================================*/

/* 帧头索引 */
#define AB_IDX_HEAD_H   0
#define AB_IDX_HEAD_L  1
#define AB_IDX_ADDR    2
#define AB_IDX_FUNC    3
#define AB_IDX_STAT    4
#define AB_IDX_LEN     5
#define AB_IDX_DATA    6
#define AB_HEADER_SIZE 6

/* 最大帧长: 6(header) + 255(data) + 2(crc) = 263 */
#define AB_FRAME_MAX_SIZE 263

typedef struct {
    uint8_t  addr;                     /* 设备地址 */
    uint8_t  func_code;                /* 功能码 */
    uint8_t  stat;                     /* 状态/控制字 */
    uint8_t  len;                      /* 数据长度 */
    uint8_t  data[255];                /* 载荷数据 */
    uint16_t crc;                      /* CRC值(大端序) */
    uint8_t  raw[AB_FRAME_MAX_SIZE];   /* 原始数据缓存 */
} AbFrame_t;

/*=============================================*/
/* 解析状态机                                    */
/*=============================================*/

typedef enum {
    AB_PARSE_WAIT_HEAD_H,  /* 等待帧头高字节 0xAA */
    AB_PARSE_WAIT_HEAD_L,  /* 等待帧头低字节 0x55 */
    AB_PARSE_WAIT_ADDR,    /* 等待地址字节 */
    AB_PARSE_WAIT_FUNC,    /* 等待功能码 */
    AB_PARSE_WAIT_STAT,    /* 等待状态字 */
    AB_PARSE_WAIT_LEN,     /* 等待长度字节 */
    AB_PARSE_WAIT_DATA,   /* 等待数据载荷 */
    AB_PARSE_WAIT_CRC_H,   /* 等待CRC高字节 */
    AB_PARSE_WAIT_CRC_L,   /* 等待CRC低字节 */
} AbParseState_t;

/*=============================================*/
/* 回调类型                                      */
/*=============================================*/

/**
 * ActionBus 回调函数类型
 * @param frame  收到的完整帧(不含CRC)
 * @param context 用户注册的上下文指针
 * @return 0=成功, 其他=错误码(将发送ERR帧)
 */
typedef uint8_t (*ActionCallback_t)(const AbFrame_t *frame, void *context);

/*=============================================*/
/* 注册表条目                                    */
/*=============================================*/

typedef struct {
    uint8_t           func_code;      /* 功能码 */
    ActionCallback_t  callback;       /* 回调函数 */
    void             *context;       /* 用户上下文 */
    char              desc[128];     /* 描述字符串(UTF-8) */
    uint8_t           registered;    /* 注册标志 */
} AbHandlerEntry_t;

/*=============================================*/
/* 发送接口类型                                  */
/*=============================================*/

/**
 * 底层字节发送函数类型
 * 用户需要在初始化后注册此函数
 * @param data 数据缓冲区
 * @param len 数据长度
 */
typedef void (*ActionBus_SendBytes_t)(const uint8_t *data, uint16_t len);

/**
 * 注册底层发送接口
 * @param send_fn 发送函数指针
 */
void ActionBus_SetSendCallback(ActionBus_SendBytes_t send_fn);

/**
 * 设置设备ID（最多5字节），用于响应 QUERY_GET_DEVICE_ID
 * 初始默认值 {0x00,0x00,0x00,0x01,0x01}，Init() 不重置此值
 */
void ActionBus_SetDeviceId(const uint8_t *id, uint8_t len);

/**
 * 注册获取系统运行时间(ms)的回调，用于响应 QUERY_GET_UPTIME_MS
 * 不设置则始终返回 0，Init() 不重置此值
 */
typedef uint32_t (*ActionBus_GetUptime_t)(void);
void ActionBus_SetUptimeCallback(ActionBus_GetUptime_t cb);

/*=============================================*/
/* CRC API                                      */
/*=============================================*/

/**
 * 计算CRC-16/MODBUS校验码（一次性）
 * @param data 数据缓冲区
 * @param length 数据长度
 * @return CRC值(大端序,发送时需拆分高低字节)
 */
uint16_t ActionBus_CRC16(const uint8_t *data, size_t length);

/**
 * 增量更新CRC-16/MODBUS（用于大数据分块校验）
 * 初始值传 0xFFFF，之后每块传上次返回值
 * @param crc   当前CRC状态（首次传0xFFFF）
 * @param data  本块数据
 * @param length 本块长度
 * @return 更新后的CRC状态
 */
uint16_t ActionBus_CRC16_Update(uint16_t crc, const uint8_t *data, size_t length);

/*=============================================*/
/* 核心API                                       */
/*=============================================*/

/**
 * 初始化ActionBus库
 * 必须在其他API之前调用
 */
void ActionBus_Init(void);

/**
 * 注册功能码处理回调
 * @param func_code 功能码(仅支持0x01-0xEF)
 * @param desc 描述字符串(上位机枚举用,最大127字节UTF-8)
 * @param callback 回调函数
 * @param context 用户上下文指针
 * @return 0=成功, 其他=错误码
 */
uint8_t ActionBus_Register(uint8_t func_code, const char *desc,
                           ActionCallback_t callback, void *context);

/**
 * 查询指定功能码是否已注册
 * @param func_code 功能码
 * @return 1=已注册, 0=未注册
 */
uint8_t ActionBus_IsRegistered(uint8_t func_code);

/**
 * 获取已注册功能码列表
 * @param codes 输出缓冲区
 * @param max_codes 缓冲区最大条目数
 * @return 实际返回的条目数
 */
uint8_t ActionBus_GetRegisteredList(uint8_t *codes, uint8_t max_codes);

/**
 * 按 func_code 升序取第 index 条注册项（与 GET_ACTION_COUNT / GET_ENTRY 一致）
 * @return 0=成功, 其他=错误码
 */
uint8_t ActionBus_GetRegisteredEntry(uint8_t index, uint8_t *func_code,
                                    char *desc_buf, uint8_t desc_buf_size);

/**
 * 设置本机总线地址（应答帧 Addr 字段及 GET_BUS_ADDRESS）
 */
void ActionBus_SetDeviceAddress(uint8_t addr);

uint8_t ActionBus_GetDeviceAddress(void);

/**
 * 处理一帧待处理接收数据（协议 0xF0/0xFE + 用户功能码）
 * 建议在主循环中调用，替代对每个 func_code 单独 Poll
 */
void ActionBus_ProcessPending(void);

/**
 * 串口接收字节处理器(放入UART中断或轮询中调用)
 * @param byte 接收到的字节
 */
void ActionBus_RxHandler(uint8_t byte);

/**
 * 检查是否有完整帧等待处理
 * @return 1=有帧待处理, 0=无
 */
uint8_t ActionBus_HasFrame(void);

/**
 * 获取最近解析完成的帧(调用HasFrame返回1时有效)
 * @return 帧结构指针(内部静态buffer,下次RxHandler调用后会覆盖)
 */
const AbFrame_t *ActionBus_GetFrame(void);

/**
 * 主循环轮询(放入main while循环)
 * @param func_code 要轮询的功能码（仅当待处理帧功能码匹配时派发）
 * @deprecated 推荐主循环只调用 ActionBus_ProcessPending()
 */
void ActionBus_Poll(uint8_t func_code);

/**
 * 任务自行关闭(单次任务完成或主动结束时调用)
 * 从机发送SW=0的停止帧(通常为0x00)
 * @param func_code 要关闭的功能码
 */
void ActionBus_TaskClose(uint8_t func_code);

/**
 * 主动发送帧(从机上报或主机发送)
 * @param func_code 功能码
 * @param stat 状态字
 * @param data 数据载荷
 * @param len 数据长度
 * @return 0=成功, 其他=错误码
 */
uint8_t ActionBus_Send_Frame(uint8_t func_code, uint8_t stat,
                              const uint8_t *data, uint8_t len);

/**
 * 从机主动上报(封装Send_Frame, stat固定为SLAVE_ON=0x01)
 * @param func_code 功能码
 * @param data 数据载荷
 * @param len 数据长度
 * @return 0=成功, 其他=错误码
 */
uint8_t ActionBus_Report(uint8_t func_code, const uint8_t *data, uint8_t len);

/**
 * 从机发送错误响应帧
 * @param func_code 功能码
 * @param err_code 错误码(见AbErr_t)
 * @param extra_data 额外错误信息(可选,传NULL则仅发送错误码)
 * @param extra_len 额外数据长度
 * @return 0=成功, 其他=错误码
 */
uint8_t ActionBus_Send_Error(uint8_t func_code, uint8_t err_code,
                              const uint8_t *extra_data, uint8_t extra_len);

#ifdef __cplusplus
}
#endif

#endif /* ACTIONBUS_H */
