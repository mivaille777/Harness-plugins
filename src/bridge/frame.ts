import {
  IPC_MAX_FRAME_BYTES,
  IpcProtocolError,
  parseIpcMessage,
  stringifyIpcMessage,
  type IpcMessage,
} from './protocol.js'

export const IPC_FRAME_HEADER_BYTES = 4

/** Encode one IPC message as a 4-byte big-endian length prefix plus UTF-8 JSON. */
export function encodeIpcFrame(message: IpcMessage): Buffer {
  const payload = Buffer.from(stringifyIpcMessage(message), 'utf8')
  if (payload.byteLength > IPC_MAX_FRAME_BYTES) {
    throw new IpcProtocolError(
      'FRAME_TOO_LARGE',
      `IPC frame payload is ${payload.byteLength} bytes; maximum is ${IPC_MAX_FRAME_BYTES}`,
    )
  }

  const frame = Buffer.allocUnsafe(IPC_FRAME_HEADER_BYTES + payload.byteLength)
  frame.writeUInt32BE(payload.byteLength, 0)
  payload.copy(frame, IPC_FRAME_HEADER_BYTES)
  return frame
}

/** Decode exactly one complete IPC frame. */
export function decodeIpcFrame(frame: Uint8Array): IpcMessage {
  const buffer = Buffer.from(frame)
  if (buffer.byteLength < IPC_FRAME_HEADER_BYTES) {
    throw new IpcProtocolError('FRAME_LENGTH_MISMATCH', 'IPC frame is shorter than its 4-byte header')
  }

  const payloadLength = buffer.readUInt32BE(0)
  if (payloadLength > IPC_MAX_FRAME_BYTES) {
    throw new IpcProtocolError(
      'FRAME_TOO_LARGE',
      `IPC frame declares ${payloadLength} bytes; maximum is ${IPC_MAX_FRAME_BYTES}`,
    )
  }

  if (buffer.byteLength !== IPC_FRAME_HEADER_BYTES + payloadLength) {
    throw new IpcProtocolError(
      'FRAME_LENGTH_MISMATCH',
      `IPC frame declares ${payloadLength} payload bytes but contains ${buffer.byteLength - IPC_FRAME_HEADER_BYTES}`,
    )
  }

  return parseIpcMessage(buffer.subarray(IPC_FRAME_HEADER_BYTES).toString('utf8'))
}

/** Incremental decoder suitable for a byte-stream transport such as a Windows named pipe. */
export class IpcFrameDecoder {
  private buffer = Buffer.alloc(0)

  push(chunk: Uint8Array): readonly IpcMessage[] {
    if (chunk.byteLength === 0) return []
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)])
    const messages: IpcMessage[] = []

    while (this.buffer.byteLength >= IPC_FRAME_HEADER_BYTES) {
      const payloadLength = this.buffer.readUInt32BE(0)
      if (payloadLength > IPC_MAX_FRAME_BYTES) {
        this.buffer = Buffer.alloc(0)
        throw new IpcProtocolError(
          'FRAME_TOO_LARGE',
          `IPC frame declares ${payloadLength} bytes; maximum is ${IPC_MAX_FRAME_BYTES}`,
        )
      }

      const frameLength = IPC_FRAME_HEADER_BYTES + payloadLength
      if (this.buffer.byteLength < frameLength) break

      const frame = this.buffer.subarray(0, frameLength)
      this.buffer = this.buffer.subarray(frameLength)
      messages.push(decodeIpcFrame(frame))
    }

    return messages
  }

  reset(): void {
    this.buffer = Buffer.alloc(0)
  }

  get bufferedBytes(): number {
    return this.buffer.byteLength
  }
}
