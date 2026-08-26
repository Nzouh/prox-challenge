const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";

/** Build-time path prefix used when Arc is mounted at zouhari.dev/arc. */
export const APP_BASE_PATH =
  configuredBasePath === "/" ? "" : configuredBasePath.replace(/\/$/, "");

export function withBasePath(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${APP_BASE_PATH}${normalizedPath}`;
}
