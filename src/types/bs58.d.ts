// bs58 4.x ships no types; this is the part of its API the app uses
declare module 'bs58' {
  const bs58: { encode(bytes: Uint8Array | number[]): string; decode(text: string): Uint8Array }
  export default bs58
}
