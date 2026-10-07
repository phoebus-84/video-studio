// The bundler turns a font file into its URL (asset/resource).
declare module '*.woff2' {
  const url: string;
  export default url;
}
