/** 牌局地址。开发页在 5173，房间在同一台机器的 2567；正式页面和隧道跟当前网址走。 */
export function resolveServerUrl(page: {
  configured?: string;
  protocol: string;
  hostname: string;
  port: string;
  origin: string;
}): string {
  const configured = page.configured?.trim();
  if (configured) return configured.replace(/\/$/, "");
  if (page.port === "5173") {
    const scheme = page.protocol === "https:" ? "https:" : "http:";
    return `${scheme}//${page.hostname}:2567`;
  }
  return page.origin;
}
