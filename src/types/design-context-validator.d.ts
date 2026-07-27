declare module "*/design-context-validator.mjs" {
  export function validateDesignContext(context: {
    product: string;
    design: string;
    brief: string;
  }): Array<{ code: string; file: string; message: string }>;
}
