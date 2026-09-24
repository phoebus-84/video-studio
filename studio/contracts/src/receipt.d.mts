export declare const SIGNED_FIELDS: readonly ["stageId", "decision", "origin", "binding", "at"];
export declare function canonicalJson(value: unknown): string;
export declare function planHashOf(definition: object): string;
export declare function signReceipt<T extends object>(review: T, key: string): T & { signature: string };
export declare function verifyReceipt(review: object, key: string): boolean;
