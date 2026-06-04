/**
 * Returns typed value from cookie or null if not found
 * @param request current request
 * @param name name of the cookie value
 * @returns cookie value or null
 */
export function getCookieValue<T extends string>(
  request: Request,
  name: string,
): T | null {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;

  const cookies = Object.fromEntries(
    cookieHeader.split('; ').map((v) => v.split(/="?([^"]+)"?/)),
  );
  return (cookies[name] as T) || null;
}
