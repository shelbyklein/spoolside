// Types for the app, which shares this module with the server.
export const COLORWAYS: Record<string, string>;
export function colorwayName(name: string | null | undefined): string;
export function lab(hex: string): [number, number, number];
export function deltaE(hexA: string, hexB: string): number;
export function colorFamily(hex: string): string;
export function matchesColorway(hex: string | null | undefined, colorway: string | null | undefined): boolean;
