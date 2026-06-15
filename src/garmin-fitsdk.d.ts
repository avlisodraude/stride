// Minimal ambient declarations for the parts of @garmin/fitsdk that Stride uses.
// The package ships as plain ESM JavaScript without bundled type definitions.
declare module '@garmin/fitsdk' {
  export class Stream {
    static fromByteArray(bytes: Uint8Array | number[]): Stream
    static fromBuffer(buffer: Uint8Array): Stream
  }

  export interface DecoderReadResult {
    messages: Record<string, Array<Record<string, unknown>>>
    errors: unknown[]
  }

  export class Decoder {
    constructor(stream: Stream)
    static isFIT(stream: Stream): boolean
    checkIntegrity(): boolean
    read(options?: Record<string, unknown>): DecoderReadResult
  }

  export class Encoder {
    constructor(options?: Record<string, unknown>)
    writeMesg(mesg: Record<string, unknown>): void
    onMesg(mesgNum: number, mesg: Record<string, unknown>): void
    close(): Uint8Array
  }

  export const Profile: {
    MesgNum: Record<string, number>
    [key: string]: unknown
  }
  export const Utils: Record<string, unknown>
  export const CrcCalculator: Record<string, unknown>
}
