// Vite handles these imports. Declared here rather than through vite/client,
// whose types would reach the whole browser program.
declare module "*.css";
declare module "*?raw" {
  const content: string;
  export default content;
}
