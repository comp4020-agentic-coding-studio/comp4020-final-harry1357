// esbuild inlines an SVG as its source text (--loader:.svg=text).
declare module "*.svg" {
  const source: string;
  export default source;
}
