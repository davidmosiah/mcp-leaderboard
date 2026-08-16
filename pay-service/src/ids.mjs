import { randomBytes } from "node:crypto";

export function unguessableCode() {
  return randomBytes(32).toString("base64url");
}
