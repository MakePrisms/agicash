/**
 * Safely parse a JSON string.
 * @returns Success and data if parsing is successful, or failure if it is not.
 */
export const safeJsonParse = <T = unknown>(
  jsonString: string,
): { success: true; data: T } | { success: false } => {
  try {
    return { success: true, data: JSON.parse(jsonString) };
  } catch {
    return { success: false };
  }
};
