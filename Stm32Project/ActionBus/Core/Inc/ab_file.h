/**
 * ActionBus 文件接收协议 v3.1
 *
 * 应用层文件传输会话，基于 ActionBus 用户功能码实现。
 * 协议层只负责可靠传输，不关心文件内容和用途。
 *
 * 帧数据格式（Data[0] 为子命令）：
 *   INIT  [0x00][size:uint32 BE][type:uint8][name_len:uint8][name:N B]
 *   DATA  [0x01][seq:uint16 BE][chunk:1-252 B]
 *   END   [0x02][total_crc:uint16 BE]
 *   ABORT [0x03]
 */

#ifndef AB_FILE_H
#define AB_FILE_H

#include "actionbus.h"

#ifdef __cplusplus
extern "C" {
#endif

/*=============================================*/
/* 子命令定义                                    */
/*=============================================*/

/* 主机 → 从机 */
#define AB_FILE_SUBCMD_INIT   0x00
#define AB_FILE_SUBCMD_DATA   0x01
#define AB_FILE_SUBCMD_END    0x02
#define AB_FILE_SUBCMD_ABORT  0x03

/* 从机 → 主机 */
#define AB_FILE_RSP_READY  0x00
#define AB_FILE_RSP_ACK    0x01
#define AB_FILE_RSP_DONE   0x02
#define AB_FILE_RSP_NAK    0xFF

/*=============================================*/
/* 状态机                                        */
/*=============================================*/

typedef enum {
    AB_FILE_STATE_IDLE,       /* 等待 INIT */
    AB_FILE_STATE_RECEIVING,  /* 接收数据块中 */
} AbFileState_t;

/*=============================================*/
/* 上下文结构体                                  */
/*=============================================*/

typedef struct AbFileCtx_s AbFileCtx_t;

/**
 * INIT 收到后调用，用户可在此准备存储缓冲区。
 * 返回 AB_ERR_OK 接受传输；返回其他错误码拒绝。
 */
typedef uint8_t (*AbFile_OnReady_t)(AbFileCtx_t *ctx);

/**
 * 每个 DATA 块到达后调用，用户负责将数据写入目标存储。
 * @param seq   块序号（从 0 开始）
 * @param data  本块数据指针
 * @param len   本块数据字节数
 * 返回 AB_ERR_OK 写入成功；其他值中止传输。
 */
typedef uint8_t (*AbFile_OnData_t)(AbFileCtx_t *ctx, uint16_t seq,
                                    const uint8_t *data, uint8_t len);

/**
 * END 收到且 CRC 验证通过后调用，文件已完整接收。
 * 用户在此处触发后续操作（写 Flash、更新配置等）。
 */
typedef void (*AbFile_OnDone_t)(AbFileCtx_t *ctx);

/**
 * 传输被 ABORT 或发生内部错误时调用，用户负责释放资源。
 */
typedef void (*AbFile_OnAbort_t)(AbFileCtx_t *ctx);

struct AbFileCtx_s {
    /* 用户注册前填写 */
    AbFile_OnReady_t  on_ready;   /* 可选 */
    AbFile_OnData_t   on_data;    /* 必须 */
    AbFile_OnDone_t   on_done;    /* 必须 */
    AbFile_OnAbort_t  on_abort;   /* 可选 */

    /* INIT 后可读，传输期间只读 */
    uint32_t total_size;          /* 文件总字节数 */
    uint32_t written_bytes;       /* 已接收字节数 */
    uint8_t  file_type;           /* 文件类型（应用层定义） */
    char     file_name[64];       /* 文件名（UTF-8，截断至63字节） */

    /* 库内部使用，用户勿修改 */
    AbFileState_t state;
    uint16_t      next_seq;       /* 期望收到的下一块序号 */
    uint16_t      running_crc;    /* 滚动 CRC，END 时与 total_crc 比对 */
    uint8_t       func_code;      /* 注册的功能码 */
};

/*=============================================*/
/* API                                          */
/*=============================================*/

/**
 * 注册文件接收处理器
 * @param ctx       已填写回调的上下文（on_data / on_done 必须非 NULL）
 * @param func_code 用户功能码（0x01–0xEF）
 * @return AB_ERR_OK 或错误码
 */
uint8_t AbFile_Register(AbFileCtx_t *ctx, uint8_t func_code);

#ifdef __cplusplus
}
#endif

#endif /* AB_FILE_H */
