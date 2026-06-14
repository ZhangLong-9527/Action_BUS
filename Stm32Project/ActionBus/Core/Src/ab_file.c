/**
 * ActionBus 文件接收协议实现
 */

#include "ab_file.h"

/*=============================================*/
/* 内部发送辅助                                  */
/*=============================================*/

static void send_ready(AbFileCtx_t *ctx)
{
    uint8_t buf[1] = {AB_FILE_RSP_READY};
    ActionBus_Report(ctx->func_code, buf, 1);
}

static void send_ack(AbFileCtx_t *ctx, uint16_t seq)
{
    uint8_t buf[3];
    buf[0] = AB_FILE_RSP_ACK;
    buf[1] = (uint8_t)(seq >> 8);
    buf[2] = (uint8_t)(seq & 0xFF);
    ActionBus_Report(ctx->func_code, buf, 3);
}

static void send_nak(AbFileCtx_t *ctx, uint16_t expected_seq)
{
    uint8_t buf[3];
    buf[0] = AB_FILE_RSP_NAK;
    buf[1] = (uint8_t)(expected_seq >> 8);
    buf[2] = (uint8_t)(expected_seq & 0xFF);
    ActionBus_Report(ctx->func_code, buf, 3);
}

static void send_done(AbFileCtx_t *ctx)
{
    uint8_t buf[1] = {AB_FILE_RSP_DONE};
    ActionBus_Send_Frame(ctx->func_code, AB_STAT_SLAVE_OFF, buf, 1);
}

/*=============================================*/
/* 内部状态操作                                  */
/*=============================================*/

static void reset_ctx(AbFileCtx_t *ctx)
{
    ctx->state        = AB_FILE_STATE_IDLE;
    ctx->next_seq     = 0;
    ctx->running_crc  = 0xFFFF;
    ctx->written_bytes = 0;
    ctx->total_size   = 0;
    ctx->file_type    = 0;
    ctx->file_name[0] = '\0';
}

static void do_abort(AbFileCtx_t *ctx)
{
    reset_ctx(ctx);
    if (ctx->on_abort) {
        ctx->on_abort(ctx);
    }
    ActionBus_TaskClose(ctx->func_code);
}

/*=============================================*/
/* 子命令处理                                    */
/*=============================================*/

static uint8_t handle_init(AbFileCtx_t *ctx, const AbFrame_t *frame)
{
    uint8_t name_len;
    uint8_t copy_len;
    uint8_t i;

    /* [SubCmd(1)][size(4)][type(1)][name_len(1)] = 最少 7 字节 */
    if (frame->len < 7) {
        return AB_ERR_LEN_OR_PAYLOAD;
    }
    if (ctx->state != AB_FILE_STATE_IDLE) {
        return AB_ERR_WRONG_STATE;
    }

    ctx->total_size = ((uint32_t)frame->data[1] << 24) |
                      ((uint32_t)frame->data[2] << 16) |
                      ((uint32_t)frame->data[3] << 8)  |
                      ((uint32_t)frame->data[4]);
    ctx->file_type = frame->data[5];

    name_len = frame->data[6];
    if (frame->len < (uint8_t)(7 + name_len)) {
        return AB_ERR_LEN_OR_PAYLOAD;
    }

    copy_len = (name_len < (uint8_t)(sizeof(ctx->file_name) - 1))
               ? name_len
               : (uint8_t)(sizeof(ctx->file_name) - 1);
    for (i = 0; i < copy_len; i++) {
        ctx->file_name[i] = (char)frame->data[7 + i];
    }
    ctx->file_name[copy_len] = '\0';

    ctx->written_bytes = 0;
    ctx->next_seq      = 0;
    ctx->running_crc   = 0xFFFF;

    if (ctx->on_ready) {
        uint8_t ret = ctx->on_ready(ctx);
        if (ret != AB_ERR_OK) {
            reset_ctx(ctx);
            return ret;
        }
    }

    ctx->state = AB_FILE_STATE_RECEIVING;
    send_ready(ctx);
    return AB_ERR_OK;
}

static uint8_t handle_data(AbFileCtx_t *ctx, const AbFrame_t *frame)
{
    uint16_t seq;
    uint8_t  chunk_len;
    const uint8_t *chunk;
    uint8_t ret;

    /* [SubCmd(1)][seq(2)][chunk(>=1)] = 最少 4 字节 */
    if (frame->len < 4) {
        return AB_ERR_LEN_OR_PAYLOAD;
    }
    if (ctx->state != AB_FILE_STATE_RECEIVING) {
        return AB_ERR_WRONG_STATE;
    }

    seq       = ((uint16_t)frame->data[1] << 8) | frame->data[2];
    chunk_len = (uint8_t)(frame->len - 3);
    chunk     = &frame->data[3];

    if (seq != ctx->next_seq) {
        send_nak(ctx, ctx->next_seq);
        return AB_ERR_OK;
    }

    ret = ctx->on_data(ctx, seq, chunk, chunk_len);
    if (ret != AB_ERR_OK) {
        do_abort(ctx);
        return ret;
    }

    ctx->running_crc = ActionBus_CRC16_Update(ctx->running_crc, chunk, chunk_len);
    ctx->written_bytes += chunk_len;
    ctx->next_seq++;

    send_ack(ctx, seq);
    return AB_ERR_OK;
}

static uint8_t handle_end(AbFileCtx_t *ctx, const AbFrame_t *frame)
{
    uint16_t expected_crc;

    /* [SubCmd(1)][total_crc(2)] = 3 字节 */
    if (frame->len < 3) {
        return AB_ERR_LEN_OR_PAYLOAD;
    }
    if (ctx->state != AB_FILE_STATE_RECEIVING) {
        return AB_ERR_WRONG_STATE;
    }

    expected_crc = ((uint16_t)frame->data[1] << 8) | frame->data[2];

    if (ctx->running_crc != expected_crc) {
        do_abort(ctx);
        return AB_ERR_CRC;
    }

    ctx->state = AB_FILE_STATE_IDLE;

    if (ctx->on_done) {
        ctx->on_done(ctx);
    }

    send_done(ctx);
    return AB_ERR_OK;
}

/*=============================================*/
/* ActionBus 回调入口                            */
/*=============================================*/

static uint8_t file_callback(const AbFrame_t *frame, void *context)
{
    AbFileCtx_t *ctx = (AbFileCtx_t *)context;

    if (frame->len < 1) {
        return AB_ERR_LEN_OR_PAYLOAD;
    }

    /* 主机发 OFF（SW=0）视为 ABORT */
    if (!(frame->stat & AB_STAT_SW)) {
        do_abort(ctx);
        return AB_ERR_OK;
    }

    switch (frame->data[0]) {
    case AB_FILE_SUBCMD_INIT:
        return handle_init(ctx, frame);
    case AB_FILE_SUBCMD_DATA:
        return handle_data(ctx, frame);
    case AB_FILE_SUBCMD_END:
        return handle_end(ctx, frame);
    case AB_FILE_SUBCMD_ABORT:
        do_abort(ctx);
        return AB_ERR_OK;
    default:
        return AB_ERR_NOT_SUPPORTED;
    }
}

/*=============================================*/
/* 公开 API                                     */
/*=============================================*/

uint8_t AbFile_Register(AbFileCtx_t *ctx, uint8_t func_code)
{
    if (!ctx || !ctx->on_data || !ctx->on_done) {
        return AB_ERR_INVALID_PARAMETER;
    }

    ctx->func_code = func_code;
    reset_ctx(ctx);

    return ActionBus_Register(func_code, "文件接收", file_callback, ctx);
}
