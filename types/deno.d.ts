// APIs de Deno usadas por esta función; solo para comprobación estática con tsc.
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};
